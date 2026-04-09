"""
RSend Backend — Deposit Sweep Service.

Orchestrates the sweep of funds from deposit addresses to merchant/treasury.
Manages intent status transitions: completed -> sweeping -> settled.

Separato da sweep_service.py (Command Center forwarding rules).
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant_models import PaymentIntent, IntentStatus
from app.db.session import async_session
from app.services.audit_service import log_event
from app.services.deposit_address_service import sweep_deposit

logger = logging.getLogger(__name__)


async def execute_sweep(
    intent_id: str,
    currency: str,
    chain: str,
) -> None:
    """
    Esegue lo sweep completo per un intent:
      1. Marca intent come "sweeping"
      2. Chiama sweep_deposit() per trasferire i fondi
      3. Marca intent come "settled" con sweep_tx_hash

    Idempotente: se l'intent e' gia' settled o sweeping, non fa nulla.
    """
    async with async_session() as db:
        async with db.begin():
            result = await db.execute(
                select(PaymentIntent).where(
                    PaymentIntent.intent_id == intent_id,
                )
            )
            intent = result.scalar_one_or_none()

            if intent is None:
                logger.error("Deposit sweep: intent %s not found", intent_id)
                return

            # Idempotenza: skip se gia' sweepato
            if intent.status in (IntentStatus.sweeping, IntentStatus.settled):
                logger.info(
                    "Deposit sweep: intent %s already %s, skipping",
                    intent_id, intent.status.value,
                )
                return

            if intent.status != IntentStatus.completed:
                logger.warning(
                    "Deposit sweep: intent %s status=%s, expected completed — skipping",
                    intent_id, intent.status.value,
                )
                return

            # ── Determina destination ────────────────────────
            destination = intent.recipient
            if not destination:
                logger.error(
                    "Deposit sweep: intent %s has no recipient address — cannot sweep",
                    intent_id,
                )
                return

            # ── Mark as sweeping ─────────────────────────────
            intent.status = IntentStatus.sweeping
            await db.flush()

            await log_event(
                db,
                "DEPOSIT_SWEEP_STARTED",
                "payment_intent",
                intent.intent_id,
                actor_type="system",
                changes={
                    "previous_status": "completed",
                    "new_status": "sweeping",
                    "destination": destination,
                    "currency": currency,
                    "chain": chain,
                },
            )

    # ── Execute sweep (fuori dalla transazione DB) ───────
    try:
        tx_hash = await sweep_deposit(
            intent_id=intent_id,
            destination=destination,
            currency=currency,
            chain=chain,
        )
    except Exception:
        logger.exception("Deposit sweep failed for intent=%s", intent_id)
        # Rollback status a completed per retry
        async with async_session() as db:
            async with db.begin():
                result = await db.execute(
                    select(PaymentIntent).where(PaymentIntent.intent_id == intent_id)
                )
                intent = result.scalar_one_or_none()
                if intent and intent.status == IntentStatus.sweeping:
                    intent.status = IntentStatus.completed
                    await log_event(
                        db,
                        "DEPOSIT_SWEEP_FAILED",
                        "payment_intent",
                        intent_id,
                        actor_type="system",
                        changes={"reverted_status": "completed", "reason": "sweep_exception"},
                    )
        return

    # ── Mark as settled ──────────────────────────────────
    if tx_hash:
        async with async_session() as db:
            async with db.begin():
                result = await db.execute(
                    select(PaymentIntent).where(PaymentIntent.intent_id == intent_id)
                )
                intent = result.scalar_one_or_none()
                if intent:
                    intent.status = IntentStatus.settled
                    intent.sweep_tx_hash = tx_hash
                    intent.swept_at = datetime.now(timezone.utc)

                    await log_event(
                        db,
                        "DEPOSIT_SWEEP_COMPLETED",
                        "payment_intent",
                        intent_id,
                        actor_type="system",
                        changes={
                            "previous_status": "sweeping",
                            "new_status": "settled",
                            "sweep_tx_hash": tx_hash,
                            "destination": destination,
                        },
                    )

        logger.info("Deposit sweep settled: intent=%s tx=%s", intent_id, tx_hash)
    else:
        # Balance 0 — mark back to completed (nothing to sweep)
        async with async_session() as db:
            async with db.begin():
                result = await db.execute(
                    select(PaymentIntent).where(PaymentIntent.intent_id == intent_id)
                )
                intent = result.scalar_one_or_none()
                if intent and intent.status == IntentStatus.sweeping:
                    intent.status = IntentStatus.completed
        logger.info("Deposit sweep skip: intent=%s balance=0", intent_id)
