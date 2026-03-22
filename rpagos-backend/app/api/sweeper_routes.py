"""
RPagos Backend — Sweeper API Routes

POST /api/v1/webhooks/alchemy    → Alchemy webhook (incoming TX)
GET  /api/v1/forwarding/rules    → Lista regole utente
POST /api/v1/forwarding/rules    → Crea regola
PUT  /api/v1/forwarding/rules/:id → Aggiorna regola
GET  /api/v1/forwarding/logs     → Storico sweep
"""

import hashlib
import hmac
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.db.session import get_db
from app.config import get_settings
from app.models.forwarding_models import (
    ForwardingRule, SweepLog, GasStrategy, SweepStatus,
)
from app.services.sweep_service import queue_sweep

sweeper_router = APIRouter(prefix="/api/v1", tags=["sweeper"])


# ═══════════════════════════════════════════════════════════
#  SCHEMAS
# ═══════════════════════════════════════════════════════════

class CreateRulePayload(BaseModel):
    source_wallet: str = Field(..., min_length=42, max_length=42)
    destination_wallet: str = Field(..., min_length=42, max_length=42)
    min_threshold: float = Field(0.001, ge=0.0001)
    gas_strategy: str = Field("normal")
    max_gas_percent: float = Field(10.0, ge=1.0, le=50.0)
    token_address: Optional[str] = None
    token_symbol: str = Field("ETH", max_length=16)
    chain_id: int = Field(8453)

class UpdateRulePayload(BaseModel):
    is_active: Optional[bool] = None
    destination_wallet: Optional[str] = None
    min_threshold: Optional[float] = None
    gas_strategy: Optional[str] = None
    max_gas_percent: Optional[float] = None


# ═══════════════════════════════════════════════════════════
#  POST /api/v1/webhooks/alchemy — Webhook Listener
# ═══════════════════════════════════════════════════════════

ALCHEMY_SIGNING_KEY = ""  # Set via env: ALCHEMY_WEBHOOK_SECRET

@sweeper_router.post("/webhooks/alchemy")
async def alchemy_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Riceve notifiche da Alchemy Address Activity Webhook.
    Valida la firma, controlla le regole di forwarding,
    e avvia lo sweep se le condizioni sono soddisfatte.
    """
    settings = get_settings()
    signing_key = getattr(settings, 'alchemy_webhook_secret', '') or ALCHEMY_SIGNING_KEY

    # ── 1. Valida firma Alchemy ──────────────────────────
    body = await request.body()

    if signing_key:
        sig = request.headers.get("x-alchemy-signature", "")
        expected = hmac.new(
            signing_key.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # ── 2. Parsa il payload ──────────────────────────────
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event = payload.get("event", {})
    activity = event.get("activity", [])

    if not activity:
        return {"status": "ignored", "reason": "no_activity"}

    processed = 0

    for tx in activity:
        # Solo transazioni in entrata con valore > 0
        value = tx.get("value", 0)
        to_addr = (tx.get("toAddress") or "").lower()
        category = tx.get("category", "")

        if not to_addr or value <= 0:
            continue

        # ── 3. Cerca regole attive per questo wallet ─────
        result = await db.execute(
            select(ForwardingRule).where(
                ForwardingRule.source_wallet == to_addr,
                ForwardingRule.is_active == True,  # noqa
            )
        )
        rules = result.scalars().all()

        for rule in rules:
            # Controlla token match
            if rule.token_address:
                tx_asset = (tx.get("rawContract", {}).get("address") or "").lower()
                if tx_asset != rule.token_address.lower():
                    continue

            # Controlla threshold
            if value < rule.min_threshold:
                continue

            # ── 4. Crea sweep log e metti in coda ────────
            sweep = SweepLog(
                rule_id=rule.id,
                source_wallet=rule.source_wallet,
                destination_wallet=rule.destination_wallet,
                amount_wei=str(int(value * 10**18)),
                amount_human=value,
                token_symbol=rule.token_symbol,
                status=SweepStatus.pending,
                trigger_tx_hash=tx.get("hash"),
            )
            db.add(sweep)
            await db.flush()

            # Queue async execution
            await queue_sweep(sweep.id, rule, value)
            processed += 1

    if processed > 0:
        await db.commit()

    return {
        "status": "processed",
        "sweeps_queued": processed,
    }


# ═══════════════════════════════════════════════════════════
#  CRUD — Forwarding Rules
# ═══════════════════════════════════════════════════════════

@sweeper_router.get("/forwarding/rules")
async def list_rules(
    wallet: str = Query(..., description="Wallet address"),
    db: AsyncSession = Depends(get_db),
):
    """Lista regole per un wallet."""
    result = await db.execute(
        select(ForwardingRule).where(
            ForwardingRule.source_wallet == wallet.lower()
        ).order_by(ForwardingRule.created_at.desc())
    )
    rules = result.scalars().all()
    return {
        "rules": [
            {
                "id": r.id,
                "source_wallet": r.source_wallet,
                "destination_wallet": r.destination_wallet,
                "is_active": r.is_active,
                "min_threshold": r.min_threshold,
                "gas_strategy": r.gas_strategy.value if r.gas_strategy else "normal",
                "max_gas_percent": r.max_gas_percent,
                "token_symbol": r.token_symbol,
                "chain_id": r.chain_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rules
        ]
    }


@sweeper_router.post("/forwarding/rules")
async def create_rule(
    payload: CreateRulePayload,
    db: AsyncSession = Depends(get_db),
):
    """Crea una nuova regola di forwarding."""
    rule = ForwardingRule(
        user_id=payload.source_wallet.lower(),
        source_wallet=payload.source_wallet.lower(),
        destination_wallet=payload.destination_wallet.lower(),
        min_threshold=payload.min_threshold,
        gas_strategy=GasStrategy(payload.gas_strategy),
        max_gas_percent=payload.max_gas_percent,
        token_address=payload.token_address.lower() if payload.token_address else None,
        token_symbol=payload.token_symbol,
        chain_id=payload.chain_id,
    )
    db.add(rule)
    await db.commit()

    return {"status": "created", "rule_id": rule.id}


@sweeper_router.put("/forwarding/rules/{rule_id}")
async def update_rule(
    rule_id: int,
    payload: UpdateRulePayload,
    db: AsyncSession = Depends(get_db),
):
    """Aggiorna una regola."""
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "gas_strategy" in updates:
        updates["gas_strategy"] = GasStrategy(updates["gas_strategy"])

    await db.execute(
        update(ForwardingRule).where(ForwardingRule.id == rule_id).values(**updates)
    )
    await db.commit()
    return {"status": "updated", "rule_id": rule_id}


@sweeper_router.get("/forwarding/logs")
async def list_logs(
    wallet: str = Query(..., description="Source wallet"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Storico sweep per un wallet."""
    result = await db.execute(
        select(SweepLog).where(
            SweepLog.source_wallet == wallet.lower()
        ).order_by(SweepLog.created_at.desc()).limit(limit)
    )
    logs = result.scalars().all()
    return {
        "logs": [
            {
                "id": l.id,
                "rule_id": l.rule_id,
                "destination": l.destination_wallet,
                "amount": l.amount_human,
                "token": l.token_symbol,
                "gas_cost_eth": l.gas_cost_eth,
                "gas_percent": l.gas_percent,
                "status": l.status.value if l.status else "unknown",
                "tx_hash": l.tx_hash,
                "trigger_tx": l.trigger_tx_hash,
                "error": l.error_message,
                "created_at": l.created_at.isoformat() if l.created_at else None,
                "executed_at": l.executed_at.isoformat() if l.executed_at else None,
            }
            for l in logs
        ]
    }
