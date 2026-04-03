"""
RSend Backend — Reconciliation Job.

Job periodico (ogni ora) che esegue tutte le verifiche di riconciliazione:
  1. check_ledger_balance — per-transaction DEBIT == CREDIT
  2. check_system_balance — somma globale bilanciata
  3. check_stale_transactions — transazioni bloccate in PROCESSING
  4. reconcile_onchain — saldo ledger vs on-chain (opzionale, solo con API key)

Risultati loggati nell'audit trail e esposti via /health/deep.
Usa asyncio.Task schedulato dal lifespan di FastAPI (nessuna dipendenza esterna).
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from app.config import get_settings
from app.db.session import async_session
from app.services.reconciliation_service import (
    FullReconciliationReport,
    check_ledger_balance,
    check_stale_transactions,
    check_system_balance,
    reconcile_onchain,
)

logger = logging.getLogger(__name__)

# Intervallo di default: 1 ora (3600 secondi)
RECONCILIATION_INTERVAL_SECONDS = 3600

# Ultimo report di riconciliazione (accessibile da /health/deep)
_last_report: Optional[FullReconciliationReport] = None
_job_task: Optional[asyncio.Task] = None


def get_last_report() -> Optional[FullReconciliationReport]:
    """Restituisce l'ultimo report di riconciliazione."""
    return _last_report


async def run_reconciliation() -> FullReconciliationReport:
    """Esegue tutte le verifiche di riconciliazione in una singola sessione.

    Returns:
        FullReconciliationReport con tutti i risultati.
    """
    global _last_report

    # Import lazy per evitare import circolari con Prometheus
    try:
        from app.jobs.reconciliation_metrics import (
            RECONCILIATION_DURATION,
            LEDGER_DISCREPANCIES,
            STALE_TRANSACTIONS_GAUGE,
            ONCHAIN_DISCREPANCY,
        )
        has_metrics = True
    except ImportError:
        has_metrics = False

    start_time = time.monotonic()
    report = FullReconciliationReport()
    report.last_reconciliation = datetime.now(timezone.utc)

    async with async_session() as session:
        try:
            # 1. Ledger balance check (per-transaction)
            discrepancies = await check_ledger_balance(session)
            report.discrepancies = discrepancies
            report.ledger_balanced = len(discrepancies) == 0

            if has_metrics and discrepancies:
                LEDGER_DISCREPANCIES.inc(len(discrepancies))

            # 2. System balance check (global)
            system_report = await check_system_balance(session)
            report.system_balance = system_report
            report.system_balanced = system_report.balanced

            # 3. Stale transactions check
            stale = await check_stale_transactions(session)
            report.stale_transactions = len(stale)
            report.stale_txs = [
                {"id": str(t.id), "updated_at": t.updated_at.isoformat() if t.updated_at else None}
                for t in stale
            ]

            if has_metrics:
                STALE_TRANSACTIONS_GAUGE.set(len(stale))

            # 4. On-chain reconciliation (opzionale)
            settings = get_settings()
            if settings.alchemy_api_key:
                try:
                    from sqlalchemy import select
                    from app.models.ledger_models import Account

                    stmt = select(Account).where(
                        Account.is_active == True,  # noqa: E712
                        Account.address.isnot(None),
                    )
                    result = await session.execute(stmt)
                    accounts = result.scalars().all()

                    for account in accounts:
                        try:
                            recon = await reconcile_onchain(
                                session,
                                account.id,
                                chain_id=8453,  # Base mainnet default
                                currency=account.currency,
                            )
                            report.onchain_results.append(recon)
                            if has_metrics and not recon.within_threshold:
                                ONCHAIN_DISCREPANCY.inc()
                        except Exception as e:
                            logger.warning(
                                "On-chain reconciliation failed for account %s: %s",
                                account.id, e,
                            )
                except Exception as e:
                    logger.warning("On-chain reconciliation skipped: %s", e)

            await session.commit()

        except Exception as e:
            logger.error("Reconciliation job failed: %s", e, exc_info=True)
            await session.rollback()
            raise

    duration = time.monotonic() - start_time
    if has_metrics:
        RECONCILIATION_DURATION.observe(duration)

    _last_report = report

    logger.info(
        "Reconciliation completed in %.2fs: ledger_balanced=%s system_balanced=%s stale=%d",
        duration,
        report.ledger_balanced,
        report.system_balanced,
        report.stale_transactions,
        extra={
            "duration_seconds": round(duration, 3),
            "ledger_balanced": report.ledger_balanced,
            "system_balanced": report.system_balanced,
            "stale_transactions": report.stale_transactions,
            "discrepancies_found": len(report.discrepancies),
        },
    )

    return report


async def _reconciliation_loop() -> None:
    """Loop infinito che esegue la riconciliazione ogni RECONCILIATION_INTERVAL_SECONDS."""
    # Attendi 60s al boot prima della prima esecuzione
    await asyncio.sleep(60)

    while True:
        try:
            await run_reconciliation()
        except Exception as e:
            logger.error("Reconciliation loop error: %s", e, exc_info=True)

        await asyncio.sleep(RECONCILIATION_INTERVAL_SECONDS)


def start_reconciliation_job() -> asyncio.Task:
    """Avvia il job di riconciliazione come task asyncio in background.

    Chiamato dal lifespan di FastAPI.
    """
    global _job_task
    _job_task = asyncio.create_task(_reconciliation_loop(), name="reconciliation_job")
    logger.info("Reconciliation job scheduled (interval=%ds)", RECONCILIATION_INTERVAL_SECONDS)
    return _job_task


async def stop_reconciliation_job() -> None:
    """Ferma il job di riconciliazione."""
    global _job_task
    if _job_task and not _job_task.done():
        _job_task.cancel()
        try:
            await _job_task
        except asyncio.CancelledError:
            pass
        _job_task = None
        logger.info("Reconciliation job stopped")
