"""
RSend Backend — Audit Service (Immutable Audit Trail).

Scrive nella tabella audit_log (append-only, BIGSERIAL).
L'utente database dell'applicazione non deve avere permessi
UPDATE o DELETE su audit_log.

Event types:
  TX_CREATED, TX_STATE_CHANGE, TX_COMPLETED, TX_FAILED,
  LEDGER_ENTRY_CREATED, BALANCE_QUERY, ANOMALY_DETECTED,
  ADMIN_ACTION, AUTH_FAILURE
"""

import logging
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger_models import LedgerAuditLog
from app.middleware.request_context import get_request_id, get_client_ip, get_user_agent

logger = logging.getLogger(__name__)

# Event types ammessi
EVENT_TYPES = frozenset({
    "TX_CREATED",
    "TX_STATE_CHANGE",
    "TX_COMPLETED",
    "TX_FAILED",
    "LEDGER_ENTRY_CREATED",
    "BALANCE_QUERY",
    "ANOMALY_DETECTED",
    "ADMIN_ACTION",
    "AUTH_FAILURE",
})


async def log_event(
    session: AsyncSession,
    event_type: str,
    entity_type: str,
    entity_id: str,
    *,
    actor_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    changes: Optional[dict] = None,
    request_id: Optional[UUID] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> LedgerAuditLog:
    """Scrive un record immutabile nella tabella audit_log.

    I campi request_id, ip_address, user_agent vengono automaticamente
    ricavati dal request context se non passati esplicitamente.

    Args:
        session: AsyncSession (il chiamante gestisce commit/rollback)
        event_type: Tipo evento (es. TX_CREATED)
        entity_type: Tipo entità (es. "transaction", "ledger_entry")
        entity_id: ID dell'entità (stringa)
        actor_type: "system", "user", "admin", ecc.
        actor_id: Identificativo dell'attore
        changes: Dict con le modifiche (es. {"status": {"old": "PENDING", "new": "AUTHORIZED"}})
        request_id: UUID della richiesta HTTP (auto da context se None)
        ip_address: IP del client (auto da context se None)
        user_agent: User-Agent (auto da context se None)
        metadata: Dati extra da salvare nel campo metadata

    Returns:
        Il record LedgerAuditLog creato.
    """
    if event_type not in EVENT_TYPES:
        logger.warning("Unknown audit event_type=%s, logging anyway", event_type)

    # Auto-fill dal request context se non specificato
    if request_id is None:
        ctx_rid = get_request_id()
        if ctx_rid is not None:
            request_id = ctx_rid

    if ip_address is None:
        ip_address = get_client_ip()

    if user_agent is None:
        user_agent = get_user_agent()

    entry = LedgerAuditLog(
        event_type=event_type,
        entity_type=entity_type,
        entity_id=str(entity_id),
        actor_type=actor_type,
        actor_id=actor_id,
        ip_address=ip_address,
        user_agent=user_agent,
        changes=changes,
        request_id=request_id,
    )
    # metadata va nel campo metadata_ (Python) → metadata (DB)
    if metadata is not None:
        entry.metadata_ = metadata

    session.add(entry)
    await session.flush()

    logger.info(
        "audit.%s entity=%s:%s actor=%s:%s",
        event_type,
        entity_type,
        entity_id,
        actor_type or "-",
        actor_id or "-",
        extra={
            "event_type": event_type,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "audit_log_id": entry.id,
        },
    )

    return entry
