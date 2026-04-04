"""
RSends Backend — Celery Sweep Tasks.

Tasks:
  process_incoming_tx(payload)     — parse webhook, find rules, create batch,
                                     enqueue execute_distribution.
                                     MUST be FAST (<500ms), no RPC calls.

  execute_distribution(batch_id)   — load batch, pre-flight checks, calculate
                                     distribution, execute, post-execution.
                                     Retry: 3 attempts, 10s/30s/90s backoff.

  confirm_tx(batch_id, tx_hash)    — wait for receipt, update status.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.celery_app import celery

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
#  Helpers — run async code in sync Celery tasks
# ═══════════════════════════════════════════════════════════════

def _run_async(coro):
    """Run an async coroutine from a sync Celery task."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


# ═══════════════════════════════════════════════════════════════
#  Task 1: process_incoming_tx
# ═══════════════════════════════════════════════════════════════

@celery.task(
    name="app.tasks.sweep_tasks.process_incoming_tx",
    bind=True,
    max_retries=1,
    default_retry_delay=5,
)
def process_incoming_tx(self, payload: dict) -> dict:
    """Parse incoming webhook payload, find matching rules, create batch records.

    This task must be FAST (<500ms). No RPC calls. Database reads only.

    Args:
        payload: Webhook payload with keys:
            - tx_hash (str): incoming transaction hash
            - from_address (str): sender address
            - to_address (str): recipient (our monitored address)
            - value_wei (str): amount in Wei
            - chain_id (int): EVM chain ID
            - token_address (str|None): ERC-20 contract or None for ETH
            - token_symbol (str): "ETH" or token symbol
            - block_number (int): block number

    Returns:
        dict with batch_id and status, or skip reason.
    """
    return _run_async(_process_incoming_tx_async(self, payload))


async def _process_incoming_tx_async(task, payload: dict) -> dict:
    """Async implementation of process_incoming_tx."""
    from sqlalchemy import select
    from app.db.session import async_session
    from app.models.forwarding_models import ForwardingRule
    from app.models.command_models import SweepBatch, SweepBatchItem
    from app.services.audit_service import log_event

    tx_hash = payload.get("tx_hash", "")
    from_address = payload.get("from_address", "")
    to_address = payload.get("to_address", "")
    value_wei = payload.get("value_wei", "0")
    chain_id = payload.get("chain_id", 8453)
    token_address = payload.get("token_address")
    token_symbol = payload.get("token_symbol", "ETH")

    logger.info(
        "Processing incoming TX: hash=%s from=%s to=%s value=%s chain=%d",
        tx_hash, from_address, to_address, value_wei, chain_id,
    )

    async with async_session() as session:
        async with session.begin():
            # ── Idempotency: check if batch already exists for this tx ──
            existing = await session.execute(
                select(SweepBatch).where(
                    SweepBatch.incoming_tx_hash == tx_hash
                )
            )
            if existing.scalar_one_or_none() is not None:
                logger.info("Duplicate TX ignored: %s", tx_hash)
                return {"status": "duplicate", "tx_hash": tx_hash}

            # ── Find matching forwarding rules ──
            query = (
                select(ForwardingRule)
                .where(
                    ForwardingRule.source_wallet == to_address.lower(),
                    ForwardingRule.chain_id == chain_id,
                    ForwardingRule.is_active == True,  # noqa: E712
                    ForwardingRule.is_paused == False,  # noqa: E712
                )
            )
            result = await session.execute(query)
            rules = result.scalars().all()

            if not rules:
                logger.info(
                    "No matching rules for %s on chain %d", to_address, chain_id
                )
                return {"status": "no_rules", "to_address": to_address}

            # ── Filter rules by token and threshold ──
            matched_rules = []
            amount_int = int(value_wei)

            for rule in rules:
                # Token filter: if rule has a token_address, it must match
                if token_address:
                    if rule.token_address and rule.token_address.lower() != token_address.lower():
                        continue
                else:
                    # Native ETH — skip rules that target a specific token
                    if rule.token_address:
                        continue

                # Threshold check (min_threshold is in ETH, convert)
                threshold_wei = int(rule.min_threshold * 10**18)
                if amount_int < threshold_wei:
                    continue

                matched_rules.append(rule)

            if not matched_rules:
                logger.info(
                    "No rules matched filters for TX %s", tx_hash
                )
                return {"status": "filtered_out", "tx_hash": tx_hash}

            # ── Use the first (highest priority) matching rule ──
            rule = matched_rules[0]

            # ── Create SweepBatch record ──
            batch_id = uuid.uuid4()
            batch = SweepBatch(
                id=batch_id,
                incoming_tx_hash=tx_hash,
                source_address=to_address.lower(),
                chain_id=chain_id,
                total_amount_wei=value_wei,
                token_address=token_address,
                token_symbol=token_symbol,
                status="PENDING",
                forwarding_rule_id=rule.id,
                distribution_list_id=rule.distribution_list_id,
                metadata_={
                    "from_address": from_address,
                    "block_number": payload.get("block_number"),
                    "rule_label": rule.label,
                },
            )
            session.add(batch)

            # ── Create batch items from distribution list or single dest ──
            if rule.distribution_list_id and rule.distribution_list:
                dist_list = rule.distribution_list
                active_recipients = [
                    r for r in dist_list.recipients if r.is_active
                ]

                for recipient in active_recipients:
                    # Integer math for Wei distribution
                    item_amount = (amount_int * recipient.percent_bps) // 10000
                    item = SweepBatchItem(
                        id=uuid.uuid4(),
                        batch_id=batch_id,
                        recipient_address=recipient.address,
                        amount_wei=str(item_amount),
                        percent_bps=recipient.percent_bps,
                        status="PENDING",
                    )
                    session.add(item)
            else:
                # Single destination
                dest = rule.destination_wallet
                if not dest:
                    logger.error(
                        "Rule %d has no destination and no distribution list",
                        rule.id,
                    )
                    return {"status": "error", "reason": "no_destination"}

                # Handle split routing
                if rule.split_enabled and rule.split_destination:
                    primary_bps = rule.split_percent * 100  # percent → bps
                    split_bps = 10000 - primary_bps

                    primary_amount = (amount_int * primary_bps) // 10000
                    split_amount = amount_int - primary_amount

                    session.add(SweepBatchItem(
                        id=uuid.uuid4(),
                        batch_id=batch_id,
                        recipient_address=dest,
                        amount_wei=str(primary_amount),
                        percent_bps=primary_bps,
                        status="PENDING",
                    ))
                    session.add(SweepBatchItem(
                        id=uuid.uuid4(),
                        batch_id=batch_id,
                        recipient_address=rule.split_destination,
                        amount_wei=str(split_amount),
                        percent_bps=split_bps,
                        status="PENDING",
                    ))
                else:
                    session.add(SweepBatchItem(
                        id=uuid.uuid4(),
                        batch_id=batch_id,
                        recipient_address=dest,
                        amount_wei=value_wei,
                        percent_bps=10000,
                        status="PENDING",
                    ))

            # ── Audit log ──
            await log_event(
                session,
                event_type="TX_CREATED",
                entity_type="sweep_batch",
                entity_id=str(batch_id),
                actor_type="system",
                actor_id="process_incoming_tx",
                changes={
                    "incoming_tx_hash": tx_hash,
                    "source": to_address,
                    "amount_wei": value_wei,
                    "rule_id": rule.id,
                },
            )

    # ── Enqueue execution (outside transaction) ──
    execute_distribution.apply_async(
        args=[str(batch_id)],
        countdown=2,  # slight delay for DB commit propagation
    )

    logger.info(
        "Batch created: batch_id=%s tx=%s rule=%d",
        batch_id, tx_hash, rule.id,
    )

    return {
        "status": "queued",
        "batch_id": str(batch_id),
        "rule_id": rule.id,
        "tx_hash": tx_hash,
    }


# ═══════════════════════════════════════════════════════════════
#  Task 2: execute_distribution
# ═══════════════════════════════════════════════════════════════

@celery.task(
    name="app.tasks.sweep_tasks.execute_distribution",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=90,
    default_retry_delay=10,
)
def execute_distribution(self, batch_id: str) -> dict:
    """Load batch, run pre-flight checks, execute distribution, post-execution.

    Pre-flight checks:
      1. Circuit breaker (RPC healthy)
      2. Spending policy (multi-tier limits)
      3. Wallet balance (enough for gas + value)
      4. Gas price (within limit)
      5. Rule cooldown (not too frequent)

    Execution:
      - <=5 recipients: sequential ETH transfers
      - >5 recipients: batch (sequential with nonce management)

    Post-execution:
      - Update DB (batch + items)
      - Update spending counters
      - WebSocket notification
      - Telegram alert

    Retry: 3 attempts with 10s/30s/90s backoff.
    """
    return _run_async(_execute_distribution_async(self, batch_id))


async def _execute_distribution_async(task, batch_id: str) -> dict:
    """Async implementation of execute_distribution."""
    from sqlalchemy import select, update
    from app.db.session import async_session
    from app.models.command_models import SweepBatch, SweepBatchItem
    from app.models.forwarding_models import ForwardingRule
    from app.services.circuit_breaker import get_circuit_breaker, CircuitOpenError
    from app.services.spending_policy import get_spending_policy
    from app.services.wallet_manager import get_wallet_manager
    from app.services.nonce_manager import get_nonce_manager
    from app.services.key_manager import get_signer
    from app.services.rpc_manager import get_rpc_manager
    from app.services.audit_service import log_event
    from app.services.cache_service import get_redis

    batch_uuid = uuid.UUID(batch_id)

    # ── Load batch ────────────────────────────────────────
    async with async_session() as session:
        result = await session.execute(
            select(SweepBatch).where(SweepBatch.id == batch_uuid)
        )
        batch = result.scalar_one_or_none()

        if batch is None:
            logger.error("Batch not found: %s", batch_id)
            return {"status": "error", "reason": "batch_not_found"}

        if batch.status not in ("PENDING", "PROCESSING"):
            logger.info("Batch %s already in status %s, skipping", batch_id, batch.status)
            return {"status": "skipped", "reason": f"status={batch.status}"}

        # Load items
        items_result = await session.execute(
            select(SweepBatchItem)
            .where(SweepBatchItem.batch_id == batch_uuid)
            .where(SweepBatchItem.status == "PENDING")
        )
        items = items_result.scalars().all()

        if not items:
            logger.info("No pending items in batch %s", batch_id)
            return {"status": "completed", "reason": "no_pending_items"}

        chain_id = batch.chain_id
        source_address = batch.source_address
        total_amount_wei = batch.total_amount_wei

    # ══════════════════════════════════════════════════════
    #  PRE-FLIGHT CHECKS
    # ══════════════════════════════════════════════════════

    # ── 1. Circuit breaker ────────────────────────────────
    rpc_cb = get_circuit_breaker(f"rpc_alchemy_{chain_id}")
    if rpc_cb is None:
        rpc_cb = get_circuit_breaker(f"rpc_base_primary_{chain_id}")

    if rpc_cb is not None:
        try:
            await rpc_cb.check()
        except CircuitOpenError as e:
            logger.warning("Circuit breaker OPEN, deferring batch %s: %s", batch_id, e)
            raise  # will trigger retry

    # ── 2. Spending policy ────────────────────────────────
    policy = get_spending_policy()
    spend_result = await policy.check_and_reserve(
        source=source_address,
        amount_wei=total_amount_wei,
        chain_id=chain_id,
    )
    if not spend_result.allowed:
        logger.warning(
            "Spending policy denied batch %s: %s", batch_id, spend_result.reason,
        )
        async with async_session() as session:
            async with session.begin():
                await session.execute(
                    update(SweepBatch)
                    .where(SweepBatch.id == batch_uuid)
                    .values(
                        status="FAILED",
                        error_message=f"Spending policy: {spend_result.reason}",
                    )
                )
                await log_event(
                    session,
                    event_type="TX_FAILED",
                    entity_type="sweep_batch",
                    entity_id=batch_id,
                    actor_type="system",
                    actor_id="execute_distribution",
                    changes={"reason": spend_result.reason, "tier": spend_result.tier},
                )
        return {"status": "denied", "reason": spend_result.reason}

    spending_reserved = True

    try:
        # ── 3. Wallet balance check ──────────────────────
        wm = get_wallet_manager(chain_id)
        gas_estimate = await wm.estimate_sweep_gas(
            recipient_count=len(items),
            mode="erc20" if batch.token_address else "eth",
        )

        if not await wm.check_hot_sufficient(gas_estimate):
            raise RuntimeError(
                f"Insufficient hot wallet balance for gas ({gas_estimate} wei)"
            )

        # ── 4. Gas price check ────────────────────────────
        rpc = get_rpc_manager(chain_id)
        gas_price_hex = await rpc.call("eth_gasPrice", [])
        gas_price_wei = int(gas_price_hex, 16)
        gas_price_gwei = gas_price_wei / 10**9

        # Check against rule gas limit if available
        if batch.forwarding_rule_id:
            async with async_session() as session:
                rule_result = await session.execute(
                    select(ForwardingRule).where(
                        ForwardingRule.id == batch.forwarding_rule_id
                    )
                )
                rule = rule_result.scalar_one_or_none()
                if rule and gas_price_gwei > rule.gas_limit_gwei:
                    raise RuntimeError(
                        f"Gas price {gas_price_gwei:.1f} gwei > limit "
                        f"{rule.gas_limit_gwei} gwei"
                    )

        # ── 5. Cooldown check ─────────────────────────────
        if batch.forwarding_rule_id:
            r = await get_redis()
            cooldown_key = f"cooldown:{chain_id}:{batch.forwarding_rule_id}"
            if await r.exists(cooldown_key):
                raise RuntimeError(
                    f"Rule {batch.forwarding_rule_id} is in cooldown"
                )

        # ══════════════════════════════════════════════════
        #  EXECUTION
        # ══════════════════════════════════════════════════

        # Update batch status to PROCESSING
        async with async_session() as session:
            async with session.begin():
                await session.execute(
                    update(SweepBatch)
                    .where(SweepBatch.id == batch_uuid)
                    .values(
                        status="PROCESSING",
                        gas_price_wei=str(gas_price_wei),
                    )
                )
                await log_event(
                    session,
                    event_type="TX_STATE_CHANGE",
                    entity_type="sweep_batch",
                    entity_id=batch_id,
                    actor_type="system",
                    actor_id="execute_distribution",
                    changes={"from": "PENDING", "to": "PROCESSING"},
                )

        # ── Get nonces and sign transactions ──────────────
        nm = get_nonce_manager(chain_id)
        signer = get_signer()
        hot_address = await signer.get_address()

        # Reserve nonce range for all items
        start_nonce, end_nonce = await nm.reserve_range(len(items))

        completed_items = []
        failed_items = []
        tx_hashes = []

        for i, item in enumerate(items):
            nonce = start_nonce + i
            try:
                tx_hash = await _execute_single_transfer(
                    signer=signer,
                    rpc=rpc,
                    chain_id=chain_id,
                    nonce=nonce,
                    to_address=item.recipient_address,
                    amount_wei=int(item.amount_wei),
                    gas_price_wei=gas_price_wei,
                    token_address=batch.token_address,
                    from_address=hot_address,
                )

                # Update item status
                async with async_session() as session:
                    async with session.begin():
                        await session.execute(
                            update(SweepBatchItem)
                            .where(SweepBatchItem.id == item.id)
                            .values(
                                status="SUBMITTED",
                                tx_hash=tx_hash,
                                nonce=nonce,
                                executed_at=datetime.now(timezone.utc),
                            )
                        )

                completed_items.append(item)
                tx_hashes.append(tx_hash)

            except Exception as exc:
                logger.error(
                    "Failed to execute item %s in batch %s: %s",
                    item.id, batch_id, exc,
                )
                async with async_session() as session:
                    async with session.begin():
                        await session.execute(
                            update(SweepBatchItem)
                            .where(SweepBatchItem.id == item.id)
                            .values(
                                status="FAILED",
                                error_message=str(exc)[:500],
                            )
                        )
                failed_items.append(item)

        # ══════════════════════════════════════════════════
        #  POST-EXECUTION
        # ══════════════════════════════════════════════════

        # Determine final batch status
        if not completed_items:
            final_status = "FAILED"
        elif failed_items:
            final_status = "PARTIAL"
        else:
            final_status = "COMPLETED"

        total_gas_cost = gas_estimate  # approximate

        async with async_session() as session:
            async with session.begin():
                await session.execute(
                    update(SweepBatch)
                    .where(SweepBatch.id == batch_uuid)
                    .values(
                        status=final_status,
                        total_gas_cost_wei=str(total_gas_cost),
                        completed_at=datetime.now(timezone.utc),
                        error_message=(
                            f"{len(failed_items)} items failed"
                            if failed_items else None
                        ),
                    )
                )

                event_type = "TX_COMPLETED" if final_status == "COMPLETED" else "TX_FAILED"
                await log_event(
                    session,
                    event_type=event_type,
                    entity_type="sweep_batch",
                    entity_id=batch_id,
                    actor_type="system",
                    actor_id="execute_distribution",
                    changes={
                        "status": final_status,
                        "completed": len(completed_items),
                        "failed": len(failed_items),
                        "tx_hashes": tx_hashes[:10],
                    },
                )

        # ── Set cooldown on rule ──────────────────────────
        if batch.forwarding_rule_id:
            try:
                r = await get_redis()
                cooldown_key = f"cooldown:{chain_id}:{batch.forwarding_rule_id}"
                if rule:
                    await r.setex(cooldown_key, rule.cooldown_sec, "1")
            except Exception:
                pass

        # ── WebSocket notification ────────────────────────
        try:
            await _notify_websocket(
                owner_address=source_address,
                event_type="sweep_completed" if final_status == "COMPLETED" else "sweep_error",
                data={
                    "batch_id": batch_id,
                    "status": final_status,
                    "tx_hashes": tx_hashes,
                    "total_amount_wei": total_amount_wei,
                    "completed": len(completed_items),
                    "failed": len(failed_items),
                },
            )
        except Exception as exc:
            logger.warning("WebSocket notify failed: %s", exc)

        # ── Telegram notification ─────────────────────────
        try:
            await _notify_telegram(batch_id, final_status, tx_hashes, total_amount_wei)
        except Exception as exc:
            logger.warning("Telegram notify failed: %s", exc)

        # ── Enqueue confirmations for submitted items ─────
        for tx_hash in tx_hashes:
            confirm_tx.apply_async(
                args=[batch_id, tx_hash],
                countdown=15,  # wait ~15s for block confirmation
            )

        return {
            "status": final_status,
            "batch_id": batch_id,
            "completed": len(completed_items),
            "failed": len(failed_items),
            "tx_hashes": tx_hashes,
        }

    except Exception:
        # Release spending reservation on failure
        if spending_reserved:
            try:
                await policy.release(source_address, total_amount_wei, chain_id)
            except Exception as rel_exc:
                logger.error("Failed to release spending: %s", rel_exc)
        raise  # Celery will retry


# ═══════════════════════════════════════════════════════════════
#  Task 3: confirm_tx
# ═══════════════════════════════════════════════════════════════

@celery.task(
    name="app.tasks.sweep_tasks.confirm_tx",
    bind=True,
    max_retries=10,
    default_retry_delay=15,
)
def confirm_tx(self, batch_id: str, tx_hash: str) -> dict:
    """Wait for transaction receipt and update item status.

    Polls for receipt with retries. Updates batch item to CONFIRMED
    or FAILED based on receipt status.

    Retry: up to 10 attempts (covers ~2.5 min of block time).
    """
    return _run_async(_confirm_tx_async(self, batch_id, tx_hash))


async def _confirm_tx_async(task, batch_id: str, tx_hash: str) -> dict:
    """Async implementation of confirm_tx."""
    from sqlalchemy import select, update
    from app.db.session import async_session
    from app.models.command_models import SweepBatch, SweepBatchItem
    from app.services.rpc_manager import get_rpc_manager
    from app.services.audit_service import log_event

    batch_uuid = uuid.UUID(batch_id)

    # ── Get chain_id from batch ───────────────────────────
    async with async_session() as session:
        result = await session.execute(
            select(SweepBatch.chain_id).where(SweepBatch.id == batch_uuid)
        )
        row = result.first()
        if row is None:
            return {"status": "error", "reason": "batch_not_found"}
        chain_id = row[0]

    # ── Query receipt ─────────────────────────────────────
    rpc = get_rpc_manager(chain_id)
    try:
        receipt = await rpc.call(
            "eth_getTransactionReceipt", [tx_hash]
        )
    except Exception as exc:
        logger.warning("Receipt query failed for %s: %s", tx_hash, exc)
        raise task.retry(exc=exc)

    if receipt is None:
        # TX not yet mined — retry
        logger.debug("No receipt yet for %s, retrying", tx_hash)
        raise task.retry(
            exc=RuntimeError(f"No receipt for {tx_hash}"),
        )

    # ── Parse receipt ─────────────────────────────────────
    status_hex = receipt.get("status", "0x0")
    tx_success = int(status_hex, 16) == 1
    gas_used = int(receipt.get("gasUsed", "0x0"), 16)
    block_number = int(receipt.get("blockNumber", "0x0"), 16)

    new_status = "CONFIRMED" if tx_success else "FAILED"

    # ── Update batch item ─────────────────────────────────
    async with async_session() as session:
        async with session.begin():
            await session.execute(
                update(SweepBatchItem)
                .where(SweepBatchItem.tx_hash == tx_hash)
                .values(
                    status=new_status,
                    gas_used=gas_used,
                )
            )

            await log_event(
                session,
                event_type="TX_STATE_CHANGE",
                entity_type="sweep_batch_item",
                entity_id=tx_hash,
                actor_type="system",
                actor_id="confirm_tx",
                changes={
                    "status": new_status,
                    "gas_used": gas_used,
                    "block_number": block_number,
                    "tx_success": tx_success,
                },
            )

    logger.info(
        "TX confirmed: hash=%s status=%s gas=%d block=%d",
        tx_hash, new_status, gas_used, block_number,
    )

    return {
        "status": new_status,
        "tx_hash": tx_hash,
        "gas_used": gas_used,
        "block_number": block_number,
    }


# ═══════════════════════════════════════════════════════════════
#  Internal Helpers
# ═══════════════════════════════════════════════════════════════

async def _execute_single_transfer(
    signer,
    rpc,
    chain_id: int,
    nonce: int,
    to_address: str,
    amount_wei: int,
    gas_price_wei: int,
    token_address: Optional[str],
    from_address: str,
) -> str:
    """Sign and send a single transfer (ETH or ERC-20).

    Returns:
        Transaction hash.
    """
    if token_address:
        # ERC-20 transfer
        # transfer(address,uint256) selector = 0xa9059cbb
        from eth_abi import encode
        data = "0xa9059cbb" + encode(
            ["address", "uint256"],
            [to_address, amount_wei],
        ).hex()

        tx_dict = {
            "to": token_address,
            "value": 0,
            "data": bytes.fromhex(data[2:]),
            "nonce": nonce,
            "gasPrice": gas_price_wei,
            "gas": 65000,
            "chainId": chain_id,
        }
    else:
        # Native ETH transfer
        tx_dict = {
            "to": to_address,
            "value": amount_wei,
            "nonce": nonce,
            "gasPrice": gas_price_wei,
            "gas": 21000,
            "chainId": chain_id,
        }

    # Sign
    raw_tx = await signer.sign_transaction(tx_dict)
    raw_hex = "0x" + raw_tx.hex()

    # Send via RPC (primary only — never broadcast to multiple)
    tx_hash = await rpc.send_raw_transaction(raw_hex)

    logger.info(
        "TX sent: hash=%s to=%s amount=%s nonce=%d chain=%d",
        tx_hash, to_address, amount_wei, nonce, chain_id,
    )
    return tx_hash


async def _notify_websocket(
    owner_address: str,
    event_type: str,
    data: dict,
) -> None:
    """Send event to WebSocket feed for the owner address."""
    from app.api.websocket_routes import feed_manager

    await feed_manager.broadcast(
        owner_address=owner_address,
        event_type=event_type,
        data=data,
    )


async def _notify_telegram(
    batch_id: str,
    status: str,
    tx_hashes: list[str],
    total_amount_wei: str,
) -> None:
    """Send Telegram notification about batch completion."""
    from app.config import get_settings
    import httpx

    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return

    amount_eth = int(total_amount_wei) / 10**18
    status_emoji = {
        "COMPLETED": "OK",
        "PARTIAL": "WARN",
        "FAILED": "FAIL",
    }.get(status, status)

    message = (
        f"[{status_emoji}] Sweep Batch {batch_id[:8]}...\n"
        f"Status: {status}\n"
        f"Amount: {amount_eth:.6f} ETH\n"
        f"TXs: {len(tx_hashes)}"
    )

    async with httpx.AsyncClient() as client:
        await client.post(
            f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
            json={
                "chat_id": settings.telegram_chat_id,
                "text": message,
                "parse_mode": "HTML",
            },
            timeout=10,
        )
