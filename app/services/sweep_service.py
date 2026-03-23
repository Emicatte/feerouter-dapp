"""
RSend Backend — Sweep Execution Service (Split Routing)

Supporta:
  - Single sweep (100% a un wallet)
  - Split sweep (X% wallet A, Y% wallet B)
  - Gas deducted proporzionalmente prima dello split
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

RPC_URLS = {
    8453:  "https://mainnet.base.org",
    84532: "https://sepolia.base.org",
    1:     "https://eth.llamarpc.com",
}

GAS_MULT = {
    GasStrategy.fast:   1.5,
    GasStrategy.normal: 1.1,
    GasStrategy.slow:   0.9,
}


def get_sweep_private_key() -> Optional[str]:
    key = os.environ.get("SWEEP_PRIVATE_KEY")
    if not key or not key.startswith("0x") or len(key) != 66:
        return None
    return key


async def estimate_gas_cost(chain_id: int, strategy: GasStrategy) -> tuple[int, float, float]:
    import httpx
    rpc = RPC_URLS.get(chain_id, RPC_URLS[8453])
    async with httpx.AsyncClient() as client:
        res = await client.post(rpc, json={"jsonrpc":"2.0","id":1,"method":"eth_gasPrice","params":[]}, timeout=10)
        gas_wei = int(res.json().get("result","0x0"), 16)
    mult = GAS_MULT.get(strategy, 1.1)
    adjusted = int(gas_wei * mult)
    gas_limit = 21000
    cost_eth = (adjusted * gas_limit) / 1e18
    return gas_limit, adjusted / 1e9, cost_eth


async def execute_single_sweep(
    sweep_id: int,
    source: str,
    destination: str,
    amount_wei: int,
    chain_id: int = 8453,
    strategy: GasStrategy = GasStrategy.normal,
    max_gas_pct: float = 10.0,
) -> dict:
    """Esegue un singolo trasferimento."""
    import httpx

    pk = get_sweep_private_key()
    if not pk:
        return {"status": "failed", "error": "Private key not configured"}

    rpc = RPC_URLS.get(chain_id, RPC_URLS[8453])

    async with async_session() as db:
        try:
            await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(status=SweepStatus.executing))
            await db.commit()

            gas_limit, gas_gwei, gas_cost_eth = await estimate_gas_cost(chain_id, strategy)
            amount_eth = amount_wei / 1e18
            gas_pct = (gas_cost_eth / amount_eth * 100) if amount_eth > 0 else 100

            if gas_pct > max_gas_pct:
                await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                    status=SweepStatus.gas_too_high, gas_price_gwei=gas_gwei,
                    gas_cost_eth=gas_cost_eth, gas_percent=round(gas_pct,2),
                    error_message=f"Gas {gas_pct:.1f}% > max {max_gas_pct}%"))
                await db.commit()
                return {"status": "gas_too_high", "gas_percent": gas_pct}

            net = amount_wei - int(gas_cost_eth * 1e18)
            if net <= 0:
                await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                    status=SweepStatus.failed, error_message="Amount too small after gas"))
                await db.commit()
                return {"status": "failed", "error": "Too small"}

            async with httpx.AsyncClient() as client:
                nonce_r = await client.post(rpc, json={"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":[source,"latest"]}, timeout=10)
                nonce = int(nonce_r.json()["result"], 16)
                chain_r = await client.post(rpc, json={"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}, timeout=10)
                chain = int(chain_r.json()["result"], 16)

                from eth_account import Account
                account = Account.from_key(pk)
                signed = account.sign_transaction({"to":destination,"value":net,"gas":gas_limit,"gasPrice":int(gas_gwei*1e9),"nonce":nonce,"chainId":chain})
                raw = "0x" + signed.raw_transaction.hex()

                send_r = await client.post(rpc, json={"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":[raw]}, timeout=15)
                result = send_r.json()

            if "error" in result:
                err = result["error"].get("message", str(result["error"]))
                await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                    status=SweepStatus.failed, error_message=err[:200],
                    gas_price_gwei=gas_gwei, gas_cost_eth=gas_cost_eth, gas_percent=round(gas_pct,2)))
                await db.commit()
                return {"status": "failed", "error": err}

            tx_hash = result.get("result", "")
            await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                status=SweepStatus.completed, tx_hash=tx_hash, gas_used=gas_limit,
                gas_price_gwei=gas_gwei, gas_cost_eth=gas_cost_eth, gas_percent=round(gas_pct,2),
                executed_at=datetime.now(timezone.utc)))
            await db.commit()
            print(f"[rsend] ✅ Sweep #{sweep_id}: {amount_eth:.6f} ETH → {destination[:10]}… | TX: {tx_hash[:16]}…")
            return {"status": "completed", "tx_hash": tx_hash}

        except Exception as e:
            await db.execute(update(SweepLog).where(SweepLog.id == sweep_id).values(
                status=SweepStatus.failed, error_message=str(e)[:200]))
            await db.commit()
            return {"status": "failed", "error": str(e)[:200]}


async def queue_sweep(sweep_id: int, rule: ForwardingRule, amount: float) -> None:
    """
    Queue sweep — supporta split routing.

    Se split_enabled:
      1. Calcola gas totale (per 2 TX)
      2. Sottrai gas dal totale
      3. Splitta il netto secondo le percentuali
      4. Esegue entrambi i trasferimenti
    """
    total_wei = int(amount * 1e18)

    if rule.split_enabled and rule.split_destination and rule.split_percent:
        # Split mode — crea 2 sweep logs
        pct1 = rule.split_percent
        pct2 = 100 - pct1

        async with async_session() as db:
            # Stima gas per 2 TX
            _, _, gas_cost = await estimate_gas_cost(rule.chain_id, rule.gas_strategy or GasStrategy.normal)
            total_gas_wei = int(gas_cost * 1e18 * 2)  # gas per 2 transazioni
            net_wei = total_wei - total_gas_wei

            if net_wei <= 0:
                print(f"[rsend] ⚠ Split sweep: amount too small after gas for 2 TX")
                return

            amount1_wei = (net_wei * pct1) // 100
            amount2_wei = net_wei - amount1_wei  # evita errori di arrotondamento

            # Log per split 1 (primary)
            log1 = SweepLog(
                rule_id=rule.id, source_wallet=rule.source_wallet,
                destination_wallet=rule.destination_wallet,
                is_split=True, split_index=0, split_percent=pct1,
                amount_wei=str(amount1_wei), amount_human=amount1_wei/1e18,
                token_symbol=rule.token_symbol, status=SweepStatus.pending,
            )
            # Log per split 2 (secondary)
            log2 = SweepLog(
                rule_id=rule.id, source_wallet=rule.source_wallet,
                destination_wallet=rule.split_destination,
                is_split=True, split_index=1, split_percent=pct2,
                amount_wei=str(amount2_wei), amount_human=amount2_wei/1e18,
                token_symbol=rule.token_symbol, status=SweepStatus.pending,
            )
            db.add(log1)
            db.add(log2)
            await db.flush()
            id1, id2 = log1.id, log2.id
            await db.commit()

        print(f"[rsend] 📬 Split sweep: {pct1}% → {rule.destination_wallet[:10]}… | {pct2}% → {rule.split_destination[:10]}…")

        # Esegui entrambi in sequenza (stesso nonce source)
        asyncio.create_task(_execute_split(id1, id2, rule, amount1_wei, amount2_wei))
    else:
        # Single sweep
        asyncio.create_task(execute_single_sweep(
            sweep_id=sweep_id, source=rule.source_wallet,
            destination=rule.destination_wallet, amount_wei=total_wei,
            chain_id=rule.chain_id,
            strategy=rule.gas_strategy or GasStrategy.normal,
            max_gas_pct=rule.max_gas_percent or 10.0,
        ))
        print(f"[rsend] 📬 Queued sweep #{sweep_id}: {amount:.6f} → {rule.destination_wallet[:10]}…")


async def _execute_split(id1: int, id2: int, rule: ForwardingRule, wei1: int, wei2: int):
    """Esegue entrambi i trasferimenti split in sequenza."""
    strategy = rule.gas_strategy or GasStrategy.normal
    max_gas = rule.max_gas_percent or 10.0

    r1 = await execute_single_sweep(id1, rule.source_wallet, rule.destination_wallet, wei1, rule.chain_id, strategy, max_gas)
    if r1["status"] == "completed":
        # Aspetta 2 secondi per il nonce
        await asyncio.sleep(2)
        await execute_single_sweep(id2, rule.source_wallet, rule.split_destination, wei2, rule.chain_id, strategy, max_gas)
    else:
        print(f"[rsend] ⚠ Split sweep #1 failed, skipping #2")


async def retry_pending_sweeps() -> int:
    async with async_session() as db:
        result = await db.execute(
            select(SweepLog).where(SweepLog.status == SweepStatus.gas_too_high)
            .order_by(SweepLog.created_at).limit(10))
        pending = result.scalars().all()
        retried = 0
        for sweep in pending:
            rule_r = await db.execute(select(ForwardingRule).where(ForwardingRule.id == sweep.rule_id))
            rule = rule_r.scalar_one_or_none()
            if not rule or not rule.is_active: continue
            asyncio.create_task(execute_single_sweep(
                sweep.id, sweep.source_wallet, sweep.destination_wallet,
                int(sweep.amount_wei), rule.chain_id,
                rule.gas_strategy or GasStrategy.normal,
                rule.max_gas_percent or 10.0))
            retried += 1
        return retried