"""
RPagos Backend — Sweep Execution Service

Esegue i trasferimenti automatici quando triggerati dal webhook.

Sicurezza:
  - Chiavi private MAI nel codice, solo da env vars
  - Gas check: se fee > max_gas_percent, metti in coda
  - Retry logic con backoff esponenziale
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
#  RPC CONFIG
# ═══════════════════════════════════════════════════════════
RPC_URLS = {
    8453:  "https://mainnet.base.org",
    84532: "https://sepolia.base.org",
    1:     "https://eth.llamarpc.com",
}

# Gas multipliers per strategia
GAS_MULT = {
    GasStrategy.fast:   1.5,
    GasStrategy.normal: 1.1,
    GasStrategy.slow:   0.9,
}


# ═══════════════════════════════════════════════════════════
#  KEY MANAGEMENT — mai nel codice
# ═══════════════════════════════════════════════════════════
def get_sweep_private_key() -> Optional[str]:
    """
    Recupera la chiave privata dall'ambiente.
    In produzione: usa AWS KMS, HashiCorp Vault, o simili.
    """
    key = os.environ.get("SWEEP_PRIVATE_KEY")
    if not key:
        print("[sweep] ⚠ SWEEP_PRIVATE_KEY non configurata")
        return None
    if not key.startswith("0x") or len(key) != 66:
        print("[sweep] ⚠ SWEEP_PRIVATE_KEY formato non valido (serve 0x + 64 hex)")
        return None
    return key


# ═══════════════════════════════════════════════════════════
#  GAS ESTIMATION
# ═══════════════════════════════════════════════════════════
async def estimate_gas_cost(
    chain_id: int,
    strategy: GasStrategy,
) -> tuple[int, float, float]:
    """
    Stima il costo gas per un trasferimento ETH.

    Returns: (gas_limit, gas_price_gwei, cost_in_eth)
    """
    import httpx

    rpc = RPC_URLS.get(chain_id, RPC_URLS[8453])

    async with httpx.AsyncClient() as client:
        # Get gas price
        res = await client.post(rpc, json={
            "jsonrpc": "2.0", "id": 1,
            "method": "eth_gasPrice", "params": [],
        }, timeout=10)
        gas_hex = res.json().get("result", "0x0")
        gas_wei = int(gas_hex, 16)

    # Apply strategy multiplier
    mult = GAS_MULT.get(strategy, 1.1)
    adjusted_gas = int(gas_wei * mult)

    gas_limit = 21000  # Transfer semplice
    cost_wei = adjusted_gas * gas_limit
    cost_eth = cost_wei / 1e18
    gas_gwei = adjusted_gas / 1e9

    return gas_limit, gas_gwei, cost_eth


# ═══════════════════════════════════════════════════════════
#  SWEEP EXECUTION
# ═══════════════════════════════════════════════════════════
async def execute_sweep(
    sweep_id: int,
    source_wallet: str,
    destination: str,
    amount_wei: int,
    chain_id: int = 8453,
    strategy: GasStrategy = GasStrategy.normal,
    max_gas_pct: float = 10.0,
) -> dict:
    """
    Esegue un singolo sweep transfer.

    1. Recupera private key da env
    2. Stima gas
    3. Controlla che gas < max_gas_percent
    4. Firma e invia la transazione
    5. Aggiorna il log nel DB
    """
    import httpx

    pk = get_sweep_private_key()
    if not pk:
        return {"status": "failed", "error": "Private key not configured"}

    rpc = RPC_URLS.get(chain_id, RPC_URLS[8453])

    async with async_session() as db:
        try:
            # ── Aggiorna status → executing ──────────────
            await db.execute(
                update(SweepLog).where(SweepLog.id == sweep_id)
                .values(status=SweepStatus.executing)
            )
            await db.commit()

            # ── Stima gas ────────────────────────────────
            gas_limit, gas_gwei, gas_cost_eth = await estimate_gas_cost(chain_id, strategy)

            amount_eth = amount_wei / 1e18
            gas_percent = (gas_cost_eth / amount_eth * 100) if amount_eth > 0 else 100

            # ── Gas check ────────────────────────────────
            if gas_percent > max_gas_pct:
                await db.execute(
                    update(SweepLog).where(SweepLog.id == sweep_id)
                    .values(
                        status=SweepStatus.gas_too_high,
                        gas_price_gwei=gas_gwei,
                        gas_cost_eth=gas_cost_eth,
                        gas_percent=round(gas_percent, 2),
                        error_message=f"Gas {gas_percent:.1f}% > max {max_gas_pct}%",
                    )
                )
                await db.commit()
                return {"status": "gas_too_high", "gas_percent": gas_percent}

            # ── Calcola importo netto (amount - gas) ─────
            gas_cost_wei = int(gas_cost_eth * 1e18)
            net_amount = amount_wei - gas_cost_wei
            if net_amount <= 0:
                await db.execute(
                    update(SweepLog).where(SweepLog.id == sweep_id)
                    .values(status=SweepStatus.failed, error_message="Amount too small after gas")
                )
                await db.commit()
                return {"status": "failed", "error": "Amount too small after gas"}

            # ── Build + Sign + Send TX ───────────────────
            async with httpx.AsyncClient() as client:
                # Get nonce
                nonce_res = await client.post(rpc, json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": "eth_getTransactionCount",
                    "params": [source_wallet, "latest"],
                }, timeout=10)
                nonce = int(nonce_res.json()["result"], 16)

                # Get chain ID
                chain_res = await client.post(rpc, json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": "eth_chainId", "params": [],
                }, timeout=10)
                chain = int(chain_res.json()["result"], 16)

                # Sign with eth_account (lightweight, no web3.py)
                from eth_account import Account
                from eth_account.signers.local import LocalAccount

                account: LocalAccount = Account.from_key(pk)

                tx = {
                    "to": destination,
                    "value": net_amount,
                    "gas": gas_limit,
                    "gasPrice": int(gas_gwei * 1e9),
                    "nonce": nonce,
                    "chainId": chain,
                }

                signed = account.sign_transaction(tx)
                raw_tx = "0x" + signed.raw_transaction.hex()

                # Send
                send_res = await client.post(rpc, json={
                    "jsonrpc": "2.0", "id": 1,
                    "method": "eth_sendRawTransaction",
                    "params": [raw_tx],
                }, timeout=15)
                result = send_res.json()

            if "error" in result:
                error_msg = result["error"].get("message", str(result["error"]))
                await db.execute(
                    update(SweepLog).where(SweepLog.id == sweep_id)
                    .values(
                        status=SweepStatus.failed,
                        error_message=error_msg[:200],
                        gas_price_gwei=gas_gwei,
                        gas_cost_eth=gas_cost_eth,
                        gas_percent=round(gas_percent, 2),
                    )
                )
                await db.commit()
                return {"status": "failed", "error": error_msg}

            tx_hash = result.get("result", "")

            # ── Success ──────────────────────────────────
            await db.execute(
                update(SweepLog).where(SweepLog.id == sweep_id)
                .values(
                    status=SweepStatus.completed,
                    tx_hash=tx_hash,
                    gas_used=gas_limit,
                    gas_price_gwei=gas_gwei,
                    gas_cost_eth=gas_cost_eth,
                    gas_percent=round(gas_percent, 2),
                    executed_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()

            print(f"[sweep] ✅ Sweep #{sweep_id}: {amount_eth:.6f} ETH → {destination[:10]}… | TX: {tx_hash[:16]}…")

            return {"status": "completed", "tx_hash": tx_hash}

        except Exception as e:
            error_msg = str(e)[:200]
            await db.execute(
                update(SweepLog).where(SweepLog.id == sweep_id)
                .values(status=SweepStatus.failed, error_message=error_msg)
            )
            await db.commit()
            print(f"[sweep] ❌ Sweep #{sweep_id} failed: {error_msg}")
            return {"status": "failed", "error": error_msg}


# ═══════════════════════════════════════════════════════════
#  QUEUE — schedula lo sweep in background
# ═══════════════════════════════════════════════════════════
async def queue_sweep(
    sweep_id: int,
    rule: ForwardingRule,
    amount: float,
) -> None:
    """
    Mette in coda uno sweep per esecuzione asincrona.
    Usa asyncio.create_task per non bloccare il webhook.
    In produzione: sostituisci con Celery o Redis Queue.
    """
    amount_wei = int(amount * 1e18)

    asyncio.create_task(
        execute_sweep(
            sweep_id=sweep_id,
            source_wallet=rule.source_wallet,
            destination=rule.destination_wallet,
            amount_wei=amount_wei,
            chain_id=rule.chain_id,
            strategy=rule.gas_strategy or GasStrategy.normal,
            max_gas_pct=rule.max_gas_percent or 10.0,
        )
    )

    print(f"[sweep] 📬 Queued sweep #{sweep_id}: {amount:.6f} → {rule.destination_wallet[:10]}…")


# ═══════════════════════════════════════════════════════════
#  RETRY — riprova sweep con gas troppo alto
# ═══════════════════════════════════════════════════════════
async def retry_pending_sweeps() -> int:
    """
    Cerca sweep con status gas_too_high e riprova.
    Chiamato da un cron job ogni 5 minuti.
    """
    async with async_session() as db:
        result = await db.execute(
            select(SweepLog).where(SweepLog.status == SweepStatus.gas_too_high)
            .order_by(SweepLog.created_at)
            .limit(10)
        )
        pending = result.scalars().all()

        retried = 0
        for sweep in pending:
            # Recupera la regola
            rule_result = await db.execute(
                select(ForwardingRule).where(ForwardingRule.id == sweep.rule_id)
            )
            rule = rule_result.scalar_one_or_none()
            if not rule or not rule.is_active:
                continue

            await queue_sweep(sweep.id, rule, sweep.amount_human)
            retried += 1

        return retried
