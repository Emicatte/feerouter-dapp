"""
RSend Backend — Reconciliation Service.

Verifiche automatiche di consistenza:
  - check_ledger_balance: per ogni transazione, sum(DEBIT) == sum(CREDIT)
  - check_system_balance: somma globale DEBIT == somma globale CREDIT
  - check_stale_transactions: transazioni in PROCESSING da troppo tempo
  - reconcile_onchain: confronto saldo ledger vs saldo on-chain
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

import httpx
from sqlalchemy import func, select, case, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.ledger_models import Account, LedgerEntry, Transaction
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)

# Soglia di stale: transazioni in PROCESSING da più di 10 minuti
STALE_THRESHOLD_MINUTES = 10

# Soglia di discrepanza on-chain (in wei, ~0.0001 ETH per gas rounding)
ONCHAIN_DISCREPANCY_THRESHOLD_WEI = 10**14


# ═══════════════════════════════════════════════════════════════
#  Data classes per i risultati
# ═══════════════════════════════════════════════════════════════

@dataclass
class DiscrepancyReport:
    """Discrepanza trovata in una singola transazione."""
    transaction_id: UUID
    total_debits: Decimal
    total_credits: Decimal
    difference: Decimal


@dataclass
class SystemBalanceReport:
    """Risultato della verifica bilanciamento globale."""
    total_debits: Decimal
    total_credits: Decimal
    balanced: bool
    difference: Decimal


@dataclass
class ReconciliationResult:
    """Risultato del confronto ledger vs on-chain."""
    account_id: UUID
    chain_id: int
    address: str
    ledger_balance: Decimal
    onchain_balance_wei: int
    onchain_balance_eth: Decimal
    discrepancy: Decimal
    within_threshold: bool


@dataclass
class FullReconciliationReport:
    """Risultato completo di tutte le verifiche."""
    ledger_balanced: bool = True
    system_balanced: bool = True
    stale_transactions: int = 0
    discrepancies: list[DiscrepancyReport] = field(default_factory=list)
    system_balance: Optional[SystemBalanceReport] = None
    stale_txs: list = field(default_factory=list)
    onchain_results: list[ReconciliationResult] = field(default_factory=list)
    last_reconciliation: Optional[datetime] = None


# ═══════════════════════════════════════════════════════════════
#  check_ledger_balance — per-transaction DEBIT == CREDIT
# ═══════════════════════════════════════════════════════════════

async def check_ledger_balance(
    session: AsyncSession,
) -> list[DiscrepancyReport]:
    """Per ogni transaction_id, verifica che sum(DEBIT) == sum(CREDIT).

    Se trova discrepanze → log CRITICAL + audit trail.

    Returns:
        Lista di DiscrepancyReport per le transazioni sbilanciate.
    """
    # Raggruppa per transaction_id e calcola somme DEBIT/CREDIT
    stmt = (
        select(
            LedgerEntry.transaction_id,
            func.coalesce(
                func.sum(
                    case(
                        (LedgerEntry.entry_type == "DEBIT", LedgerEntry.amount),
                        else_=Decimal("0"),
                    )
                ),
                Decimal("0"),
            ).label("total_debits"),
            func.coalesce(
                func.sum(
                    case(
                        (LedgerEntry.entry_type == "CREDIT", LedgerEntry.amount),
                        else_=Decimal("0"),
                    )
                ),
                Decimal("0"),
            ).label("total_credits"),
        )
        .group_by(LedgerEntry.transaction_id)
    )

    result = await session.execute(stmt)
    rows = result.all()

    discrepancies: list[DiscrepancyReport] = []

    for row in rows:
        tx_id, total_debits, total_credits = row
        total_debits = Decimal(str(total_debits))
        total_credits = Decimal(str(total_credits))

        if total_debits != total_credits:
            diff = abs(total_debits - total_credits)
            report = DiscrepancyReport(
                transaction_id=tx_id,
                total_debits=total_debits,
                total_credits=total_credits,
                difference=diff,
            )
            discrepancies.append(report)

            logger.critical(
                "LEDGER IMBALANCE: transaction %s debits=%s credits=%s diff=%s",
                tx_id, total_debits, total_credits, diff,
                extra={
                    "transaction_id": str(tx_id),
                    "total_debits": str(total_debits),
                    "total_credits": str(total_credits),
                    "difference": str(diff),
                },
            )

            # Audit trail
            await log_event(
                session,
                "ANOMALY_DETECTED",
                "transaction",
                str(tx_id),
                actor_type="system",
                actor_id="reconciliation_service",
                changes={
                    "check": "ledger_balance",
                    "total_debits": str(total_debits),
                    "total_credits": str(total_credits),
                    "difference": str(diff),
                },
            )

            # Blocca gli account coinvolti nella transazione sbilanciata
            await _deactivate_accounts_for_transaction(session, tx_id)

    if not discrepancies:
        logger.info("Ledger balance check passed: all transactions balanced")

    return discrepancies


async def _deactivate_accounts_for_transaction(
    session: AsyncSession,
    transaction_id: UUID,
) -> None:
    """Blocca gli account coinvolti in una transazione sbilanciata.

    Usa UPDATE diretto per evitare eager loading delle relationship
    (selectin su ledger_entries causa MissingGreenlet in contesti async).
    """
    stmt = (
        select(LedgerEntry.account_id)
        .where(LedgerEntry.transaction_id == transaction_id)
        .distinct()
    )
    result = await session.execute(stmt)
    account_ids = [row[0] for row in result.all()]

    for acc_id in account_ids:
        # Verifica se l'account è attivo e disattivalo con UPDATE diretto
        check = await session.execute(
            select(Account.is_active).where(Account.id == acc_id)
        )
        is_active = check.scalar_one_or_none()

        if is_active:
            await session.execute(
                update(Account)
                .where(Account.id == acc_id)
                .values(is_active=False)
            )
            await session.flush()

            logger.critical(
                "Account %s DEACTIVATED due to ledger imbalance in tx %s",
                acc_id, transaction_id,
            )

            await log_event(
                session,
                "ADMIN_ACTION",
                "account",
                str(acc_id),
                actor_type="system",
                actor_id="reconciliation_service",
                changes={
                    "action": "deactivate_account",
                    "reason": "ledger_imbalance",
                    "transaction_id": str(transaction_id),
                    "is_active": {"old": True, "new": False},
                },
            )


# ═══════════════════════════════════════════════════════════════
#  check_system_balance — global DEBIT == CREDIT
# ═══════════════════════════════════════════════════════════════

async def check_system_balance(
    session: AsyncSession,
) -> SystemBalanceReport:
    """Verifica che la somma totale di tutti i DEBIT == somma totale di tutti i CREDIT.

    Returns:
        SystemBalanceReport con il risultato.
    """
    stmt = select(
        func.coalesce(
            func.sum(
                case(
                    (LedgerEntry.entry_type == "DEBIT", LedgerEntry.amount),
                    else_=Decimal("0"),
                )
            ),
            Decimal("0"),
        ).label("total_debits"),
        func.coalesce(
            func.sum(
                case(
                    (LedgerEntry.entry_type == "CREDIT", LedgerEntry.amount),
                    else_=Decimal("0"),
                )
            ),
            Decimal("0"),
        ).label("total_credits"),
    )

    result = await session.execute(stmt)
    row = result.one()
    total_debits = Decimal(str(row[0]))
    total_credits = Decimal(str(row[1]))
    difference = abs(total_debits - total_credits)
    balanced = total_debits == total_credits

    report = SystemBalanceReport(
        total_debits=total_debits,
        total_credits=total_credits,
        balanced=balanced,
        difference=difference,
    )

    if not balanced:
        logger.critical(
            "SYSTEM IMBALANCE: total debits=%s credits=%s diff=%s",
            total_debits, total_credits, difference,
            extra={
                "total_debits": str(total_debits),
                "total_credits": str(total_credits),
                "difference": str(difference),
            },
        )

        await log_event(
            session,
            "ANOMALY_DETECTED",
            "system",
            "global_balance",
            actor_type="system",
            actor_id="reconciliation_service",
            changes={
                "check": "system_balance",
                "total_debits": str(total_debits),
                "total_credits": str(total_credits),
                "difference": str(difference),
            },
        )
    else:
        logger.info(
            "System balance check passed: debits=%s credits=%s",
            total_debits, total_credits,
        )

    return report


# ═══════════════════════════════════════════════════════════════
#  check_stale_transactions — PROCESSING > 10 min
# ═══════════════════════════════════════════════════════════════

async def check_stale_transactions(
    session: AsyncSession,
    threshold_minutes: int = STALE_THRESHOLD_MINUTES,
) -> list[Transaction]:
    """Trova transazioni in PROCESSING da più di threshold_minutes.

    Returns:
        Lista delle transazioni stale.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=threshold_minutes)

    stmt = (
        select(Transaction)
        .where(
            Transaction.status == "PROCESSING",
            Transaction.updated_at <= cutoff,
        )
    )

    result = await session.execute(stmt)
    stale = result.scalars().all()

    if stale:
        logger.warning(
            "Found %d stale transactions in PROCESSING for >%d min",
            len(stale), threshold_minutes,
            extra={
                "stale_count": len(stale),
                "threshold_minutes": threshold_minutes,
                "transaction_ids": [str(t.id) for t in stale],
            },
        )

        for tx in stale:
            await log_event(
                session,
                "ANOMALY_DETECTED",
                "transaction",
                str(tx.id),
                actor_type="system",
                actor_id="reconciliation_service",
                changes={
                    "check": "stale_transaction",
                    "status": tx.status,
                    "updated_at": tx.updated_at.isoformat() if tx.updated_at else None,
                    "threshold_minutes": threshold_minutes,
                },
            )
    else:
        logger.info("Stale transaction check passed: no stale transactions found")

    return list(stale)


# ═══════════════════════════════════════════════════════════════
#  reconcile_onchain — ledger balance vs eth_getBalance
# ═══════════════════════════════════════════════════════════════

async def reconcile_onchain(
    session: AsyncSession,
    account_id: UUID,
    chain_id: int,
    currency: str = "ETH",
) -> ReconciliationResult:
    """Confronta il saldo calcolato dal ledger con il saldo on-chain.

    Usa Alchemy eth_getBalance per il saldo on-chain.

    Args:
        session: AsyncSession
        account_id: UUID dell'account nel ledger
        chain_id: ID della chain (es. 8453 per Base)
        currency: Valuta per il saldo ledger (default ETH)

    Returns:
        ReconciliationResult con il confronto.

    Raises:
        ValueError se l'account non ha un indirizzo on-chain.
    """
    settings = get_settings()

    # Recupera l'account dal DB
    result = await session.execute(
        select(Account).where(Account.id == account_id)
    )
    account = result.scalar_one_or_none()
    if not account:
        raise ValueError(f"Account {account_id} not found")
    if not account.address:
        raise ValueError(f"Account {account_id} has no on-chain address")

    # Calcola il saldo dal ledger
    from app.services.ledger_service import get_balance
    ledger_balance = await get_balance(session, account_id, currency)

    # Chiama eth_getBalance via Alchemy
    onchain_balance_wei = await _get_onchain_balance(
        account.address, chain_id, settings.alchemy_api_key
    )
    onchain_balance_eth = Decimal(onchain_balance_wei) / Decimal(10**18)

    discrepancy = abs(ledger_balance - onchain_balance_eth)
    within_threshold = onchain_balance_wei == 0 or (
        discrepancy * Decimal(10**18) <= Decimal(ONCHAIN_DISCREPANCY_THRESHOLD_WEI)
    )

    recon_result = ReconciliationResult(
        account_id=account_id,
        chain_id=chain_id,
        address=account.address,
        ledger_balance=ledger_balance,
        onchain_balance_wei=onchain_balance_wei,
        onchain_balance_eth=onchain_balance_eth,
        discrepancy=discrepancy,
        within_threshold=within_threshold,
    )

    if not within_threshold:
        logger.warning(
            "On-chain discrepancy for account %s: ledger=%s onchain=%s diff=%s",
            account_id, ledger_balance, onchain_balance_eth, discrepancy,
            extra={
                "account_id": str(account_id),
                "chain_id": chain_id,
                "address": account.address,
                "ledger_balance": str(ledger_balance),
                "onchain_balance_eth": str(onchain_balance_eth),
                "discrepancy": str(discrepancy),
            },
        )

        await log_event(
            session,
            "ANOMALY_DETECTED",
            "account",
            str(account_id),
            actor_type="system",
            actor_id="reconciliation_service",
            changes={
                "check": "onchain_reconciliation",
                "chain_id": chain_id,
                "address": account.address,
                "ledger_balance": str(ledger_balance),
                "onchain_balance_wei": str(onchain_balance_wei),
                "onchain_balance_eth": str(onchain_balance_eth),
                "discrepancy": str(discrepancy),
            },
        )
    else:
        logger.info(
            "On-chain reconciliation passed for account %s: ledger=%s onchain=%s",
            account_id, ledger_balance, onchain_balance_eth,
        )

    return recon_result


async def _get_onchain_balance(
    address: str,
    chain_id: int,
    api_key: str,
) -> int:
    """Chiama eth_getBalance via Alchemy JSON-RPC.

    Returns:
        Saldo in wei (int).
    """
    chain_slug = _chain_id_to_slug(chain_id)
    url = f"https://{chain_slug}.g.alchemy.com/v2/{api_key}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_getBalance",
                "params": [address, "latest"],
            },
        )
        resp.raise_for_status()
        data = resp.json()

    if "error" in data:
        raise RuntimeError(f"RPC error: {data['error']}")

    return int(data["result"], 16)


def _chain_id_to_slug(chain_id: int) -> str:
    """Mappa chain_id → slug Alchemy."""
    chains = {
        1: "eth-mainnet",
        11155111: "eth-sepolia",
        8453: "base-mainnet",
        84532: "base-sepolia",
        137: "polygon-mainnet",
        42161: "arb-mainnet",
        10: "opt-mainnet",
    }
    return chains.get(chain_id, f"eth-mainnet")
