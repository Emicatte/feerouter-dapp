"""
RSend Backend — Sweep Execution Service v2

Multi-chain:
  - Base (8453), Base Sepolia (84532)
  - Ethereum (1)
  - Arbitrum One (42161)
  - Solana (placeholder — requires solana-py)

Split routing + gas guard + WebSocket notifications
"""

import os
import asyncio
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session
from app.models.forwarding_models import (
    ForwardingRule, SweepLog, SweepStatus, GasStrategy,
)

# ═══════════════════════════════════════════════════════════
#  MULTI-CHAIN RPC CONFIG
# ═══════════════════════════════════════════════════════════
RPC_URLS = {
    8453:  "https://mainnet.base.org",
    84532: "https://sepolia.base.org",
    1:     "https://eth.llamarpc.com",
    42161: "https://arb1.arbitrum.io/rpc",
}

# Solana configuration placeholder
# Solana is non-EVM and requires solana-py:
#   pip install solana
#
# SOLANA_RPC = "https://api.mainnet-beta.solana.com"
# SOLANA_DEVNET = "https://api.devnet.solana.com"
#
# Solana transactions use a completely different model:
#   - No nonce/gasPrice — uses "recent blockhash" + "priority fee"
#   - Signing via Ed25519 instead of ECDSA
#   - Uses SPL Token program for token transfers
#   - Transfer instruction: system_program.transfer(from, to, lamports)
#
# Implementation:
#   from solana.rpc.async_api import AsyncClient
#   from solana.keypair import Keypair
#   from solana.transaction import Transaction
#   from solana.system_program import TransferParams, transfer
#
#   async def execute_solana_sweep(source_key, dest, lamports):
#       client = AsyncClient(SOLANA_RPC)
#       keypair = Keypair.from_secret_key(bytes.fromhex(source_key))
#       tx = Transaction().add(transfer(TransferParams(
#           from_pubkey=keypair.public_key,
#           to_pubkey=PublicKey(dest),
#           lamports=lamports,
#       )))
#       resp = await client.send_transaction(tx, keypair)
#       return resp['result']

CHAIN_NAMES = {
    8453: "Base", 84532: "Base Sepolia",
    1: "Ethereum", 42161: "Arbitrum One",
}

GAS_MULT = {
    GasStrategy.fast: 1.5,
    GasStrategy.normal: 1.1,
    GasStrategy.slow: 0.9,
}


# ═══════════════════════════════════════════════════════════
#  WebSocket notification helper
# ═══════════════════════════════════════════════════════════

async def _notify(owner: str, event_type: str, data: dict) -> None:
    """Invia evento al WebSocket feed. Non-blocking, non solleva eccezioni."""
    try:
        from app.api.websocket_routes import feed_manager
        await feed_manager.broadcast(owner, event_type, data)
    except Exception:
        pass  # WS non disponibile — non bloccare lo sweep


async def _resolve_owner(rule_id: int) -> Optional[str]:
    """Risolvi rule_id → user_id (owner address)."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(ForwardingRule.user_id).where(ForwardingRule.id == rule_id)
            )
            return result.scalar_one_or_none()
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════
#  Core functions
# ═══════════════════════════════════════════════════════════

def get_sweep_private_key() -> Optional[str]:
    key = os.environ.get("SWEEP_PRIVATE_KEY")
    if not key or not key.startswith("0x") or len(key) != 66:
        return None
    return key


async def estimate_gas_cost(chain_id: int, strategy: GasStrategy) -> tuple[int, float, float]:
    import httpx
    rpc = RPC_URLS.get(chain_id, RPC_URLS[8453])
    async with httpx.AsyncClient() as client:
        res = await client.post(rpc, json={"jsonrpc": "2.0", "id": 1, "method": "eth_gasPrice", "params": []}, timeout=10)
        gas_wei = int(res.json().get("result", "0x0"), 16)
    mult = GAS_MULT.get(strategy, 1.1)
    adjusted = int(gas_wei * mult)
    gas_limit = 21000
    cost_eth = (adjusted * gas_limit) / 1e18
    return gas_limit, adjusted / 1e9, cost_eth


async def execute_single_sweep(
    sweep_id: int, source: str, destination: str,
    amount_wei: int, chain_id: int = 8453,
    strategy: GasStrategy = GasStrategy.normal,
    max_gas_pct: float = 10.0,
    owner: Optional[str] = None,
) -> dict:
    import httpx

    # Check chain is EVM-compatible
    if chain_id not in RPC_URLS:
        return {"status": "failed", "error": f"Chain {chain_id} not supported for sweeping yet"}

    pk = get_sweep_private_key()
    if not pk:
        return {"status": "failed", "error": "Private key not configured"}

    rpc = RPC_URLS[chain_id]
    chain_name = CHAIN_NAMES.get(chain_id, f"Chain {chain_id}")
    amount_eth = amount_wei / 1e18

    # Resolve owner per WS notifications
    if not owner:
        owner = await _resolve_owner(sweep_id)
    ws_base = {
        "sweep_id": sweep_id,
        "source": source,
        "destination": destination,
        "amount_eth": round(amount_eth, 8),
        "chain": chain_name,
        "chain_id": chain_id,
        "token": "ETH",
    }

    async with async_session() as db:
        try:
            await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(status=SweepStatus.executing))
            await db.commit()

            # ── WS: sweep_executing ─────────────────────
            if owner:
                await _notify(owner, "sweep_executing", ws_base)

            gas_limit, gas_gwei, gas_cost_eth = await estimate_gas_cost(chain_id, strategy)
            gas_pct = (gas_cost_eth / amount_eth * 100) if amount_eth > 0 else 100

            if gas_pct > max_gas_pct:
                await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                    status=SweepStatus.gas_too_high, gas_price_gwei=gas_gwei,
                    gas_cost_eth=gas_cost_eth, gas_percent=round(gas_pct, 2),
                    error_message=f"Gas {gas_pct:.1f}% > max {max_gas_pct}% on {chain_name}"))
                await db.commit()
                # ── WS: sweep_error ─────────────────────
                if owner:
                    await _notify(owner, "sweep_error", {
                        **ws_base,
                        "error": f"Gas too high: {gas_pct:.1f}% > {max_gas_pct}%",
                        "gas_gwei": gas_gwei,
                        "status": "gas_too_high",
                    })
                return {"status": "gas_too_high", "gas_percent": gas_pct}

            net = amount_wei - int(gas_cost_eth * 1e18)
            if net <= 0:
                await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                    status=SweepStatus.failed, error_message="Amount too small after gas"))
                await db.commit()
                if owner:
                    await _notify(owner, "sweep_error", {
                        **ws_base, "error": "Amount too small after gas", "status": "failed",
                    })
                return {"status": "failed", "error": "Too small"}

            async with httpx.AsyncClient() as client:
                nonce_r = await client.post(rpc, json={"jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionCount", "params": [source, "latest"]}, timeout=10)
                nonce = int(nonce_r.json()["result"], 16)
                chain_r = await client.post(rpc, json={"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}, timeout=10)
                chain = int(chain_r.json()["result"], 16)

                from eth_account import Account
                account = Account.from_key(pk)
                signed = account.sign_transaction({
                    "to": destination, "value": net, "gas": gas_limit,
                    "gasPrice": int(gas_gwei * 1e9), "nonce": nonce, "chainId": chain,
                })
                raw = "0x" + signed.raw_transaction.hex()

                send_r = await client.post(rpc, json={"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": [raw]}, timeout=15)
                result = send_r.json()

            if "error" in result:
                err = result["error"].get("message", str(result["error"]))
                await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                    status=SweepStatus.failed, error_message=err[:200],
                    gas_price_gwei=gas_gwei, gas_cost_eth=gas_cost_eth, gas_percent=round(gas_pct, 2)))
                await db.commit()
                # ── WS: sweep_error ─────────────────────
                if owner:
                    await _notify(owner, "sweep_error", {
                        **ws_base, "error": err[:200], "status": "failed",
                        "gas_gwei": gas_gwei,
                    })
                return {"status": "failed", "error": err}

            tx_hash = result.get("result", "")
            await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                status=SweepStatus.completed, tx_hash=tx_hash, gas_used=gas_limit,
                gas_price_gwei=gas_gwei, gas_cost_eth=gas_cost_eth, gas_percent=round(gas_pct, 2),
                executed_at=datetime.now(timezone.utc)))
            await db.commit()

            # ── WS: sweep_completed ─────────────────────
            if owner:
                await _notify(owner, "sweep_completed", {
                    **ws_base,
                    "tx_hash": tx_hash,
                    "gas_gwei": gas_gwei,
                    "gas_cost_eth": round(gas_cost_eth, 8),
                    "net_amount_eth": round(net / 1e18, 8),
                    "status": "completed",
                })

            print(f"[rsend] Sweep #{sweep_id} on {chain_name}: {amount_eth:.6f} ETH -> {destination[:10]}... | TX: {tx_hash[:16]}...")
            return {"status": "completed", "tx_hash": tx_hash}

        except Exception as e:
            await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                status=SweepStatus.failed, error_message=str(e)[:200]))
            await db.commit()
            if owner:
                await _notify(owner, "sweep_error", {
                    **ws_base, "error": str(e)[:200], "status": "failed",
                })
            return {"status": "failed", "error": str(e)[:200]}


async def queue_sweep(sweep_id: int, rule: ForwardingRule, amount: float) -> None:
    total_wei = int(amount * 1e18)
    owner = rule.user_id

    if rule.split_enabled and rule.split_destination and rule.split_percent:
        pct1 = rule.split_percent
        pct2 = 100 - pct1

        async with async_session() as db:
            _, _, gas_cost = await estimate_gas_cost(rule.chain_id, rule.gas_strategy or GasStrategy.normal)
            total_gas_wei = int(gas_cost * 1e18 * 2)
            net_wei = total_wei - total_gas_wei
            if net_wei <= 0:
                print(f"[rsend] Split: amount too small for 2 TX on chain {rule.chain_id}")
                return

            amt1 = (net_wei * pct1) // 100
            amt2 = net_wei - amt1

            log1 = SweepLog(rule_id=rule.id, source_wallet=rule.source_wallet,
                destination_wallet=rule.destination_wallet, is_split=True, split_index=0,
                split_percent=pct1, amount_wei=str(amt1), amount_human=amt1/1e18,
                token_symbol=rule.token_symbol, status=SweepStatus.pending)
            log2 = SweepLog(rule_id=rule.id, source_wallet=rule.source_wallet,
                destination_wallet=rule.split_destination, is_split=True, split_index=1,
                split_percent=pct2, amount_wei=str(amt2), amount_human=amt2/1e18,
                token_symbol=rule.token_symbol, status=SweepStatus.pending)
            db.add(log1); db.add(log2)
            await db.flush()
            id1, id2 = log1.id, log2.id
            await db.commit()

        chain_name = CHAIN_NAMES.get(rule.chain_id, str(rule.chain_id))
        print(f"[rsend] Split on {chain_name}: {pct1}% -> {rule.destination_wallet[:10]}... | {pct2}% -> {rule.split_destination[:10]}...")
        asyncio.create_task(_execute_split(id1, id2, rule, amt1, amt2, owner))
    else:
        asyncio.create_task(execute_single_sweep(
            sweep_id=sweep_id, source=rule.source_wallet,
            destination=rule.destination_wallet, amount_wei=total_wei,
            chain_id=rule.chain_id, strategy=rule.gas_strategy or GasStrategy.normal,
            max_gas_pct=rule.max_gas_percent or 10.0, owner=owner))


async def _execute_split(
    id1: int, id2: int, rule: ForwardingRule, wei1: int, wei2: int,
    owner: Optional[str] = None,
):
    strategy = rule.gas_strategy or GasStrategy.normal
    max_gas = rule.max_gas_percent or 10.0
    r1 = await execute_single_sweep(id1, rule.source_wallet, rule.destination_wallet, wei1, rule.chain_id, strategy, max_gas, owner)
    if r1["status"] == "completed":
        await asyncio.sleep(2)
        await execute_single_sweep(id2, rule.source_wallet, rule.split_destination, wei2, rule.chain_id, strategy, max_gas, owner)


async def retry_pending_sweeps() -> int:
    async with async_session() as db:
        result = await db.execute(select(SweepLog).where(SweepLog.status == SweepStatus.gas_too_high).order_by(SweepLog.created_at).limit(10))
        retried = 0
        for sweep in result.scalars().all():
            rule_r = await db.execute(select(ForwardingRule).where(ForwardingRule.id == sweep.rule_id))
            rule = rule_r.scalar_one_or_none()
            if not rule or not rule.is_active: continue
            asyncio.create_task(execute_single_sweep(sweep.id, sweep.source_wallet, sweep.destination_wallet, int(sweep.amount_wei), rule.chain_id, rule.gas_strategy or GasStrategy.normal, rule.max_gas_percent or 10.0, rule.user_id))
            retried += 1
        return retried
