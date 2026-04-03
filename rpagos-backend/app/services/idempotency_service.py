"""
RSend Backend — Idempotency Service.

Gestisce idempotency keys per prevenire doppia esecuzione di transazioni.

Logica:
  - Se la chiave non esiste → None (procedi con l'operazione)
  - Se esiste e status COMPLETED → restituisce la Transaction (skip riesecuzione)
  - Se esiste e status PENDING/PROCESSING → solleva ConflictError (409)
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger_models import Transaction


class ConflictError(Exception):
    """La transazione con questa idempotency_key è già in corso."""

    def __init__(self, transaction: Transaction):
        self.transaction = transaction
        super().__init__(
            f"Transaction {transaction.id} is already {transaction.status}"
        )


async def check_idempotency(
    session: AsyncSession,
    key: str,
) -> Optional[Transaction]:
    """Controlla se esiste già una transazione con questa idempotency_key.

    Returns:
        None se la chiave non esiste (procedi).
        Transaction se lo status è COMPLETED (restituisci il risultato).

    Raises:
        ConflictError se lo status è PENDING, AUTHORIZED, o PROCESSING.
    """
    result = await session.execute(
        select(Transaction).where(Transaction.idempotency_key == key)
    )
    tx = result.scalar_one_or_none()

    if tx is None:
        return None

    if tx.status == "COMPLETED":
        return tx

    if tx.status in ("PENDING", "AUTHORIZED", "PROCESSING"):
        raise ConflictError(tx)

    # FAILED o REVERSED → tratta come "non esiste", permetti retry
    return None
