"""
RSend Backend — Sweeper API Routes (Command Center)

POST /api/v1/webhooks/alchemy             → Alchemy webhook (incoming TX)

POST /api/v1/forwarding/rules             → Crea regola
GET  /api/v1/forwarding/rules             → Lista regole utente
GET  /api/v1/forwarding/rules/{id}        → Dettaglio regola
PUT  /api/v1/forwarding/rules/{id}        → Aggiorna regola
DELETE /api/v1/forwarding/rules/{id}      → Elimina regola

POST /api/v1/forwarding/rules/{id}/pause  → Pausa regola
POST /api/v1/forwarding/rules/{id}/resume → Riprendi regola
POST /api/v1/forwarding/emergency-stop    → Emergency stop

GET  /api/v1/forwarding/logs              → Sweep logs (paginati)
GET  /api/v1/forwarding/logs/export       → Export CSV/JSON

GET  /api/v1/forwarding/stats             → Statistiche aggregate
GET  /api/v1/forwarding/stats/daily       → Volume giornaliero
"""

import csv
import hashlib
import hmac
import io
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, update, case, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_db
from app.models.forwarding_models import (
    AuditLog,
    ForwardingRule,
    GasStrategy,
    SweepLog,
    SweepStatus,
)
from app.services.sweep_service import queue_sweep
from app.api.websocket_routes import feed_manager

sweeper_router = APIRouter(prefix="/api/v1", tags=["sweeper"])

ETH_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
MAX_RULES_PER_OWNER = 10


# ═══════════════════════════════════════════════════════════
#  Pydantic schemas
# ═══════════════════════════════════════════════════════════

def _validate_eth_address(v: str) -> str:
    if not ETH_ADDR_RE.match(v):
        raise ValueError("Must be a valid Ethereum address (0x + 40 hex chars)")
    return v.lower()


def _validate_optional_eth_address(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    return _validate_eth_address(v)


class CreateRulePayload(BaseModel):
    owner_address: str = Field(..., min_length=42, max_length=42, description="Wallet owner")
    source_wallet: str = Field(..., min_length=42, max_length=42)
    destination_wallet: str = Field(..., min_length=42, max_length=42)
    label: Optional[str] = Field(None, max_length=100)

    # Split
    split_enabled: bool = False
    split_percent: int = Field(100, ge=0, le=100)
    split_destination: Optional[str] = Field(None, min_length=42, max_length=42)

    # Condizioni
    min_threshold: float = Field(0.001, ge=0.0001)
    gas_strategy: str = Field("normal")
    max_gas_percent: float = Field(10.0, ge=1.0, le=50.0)
    gas_limit_gwei: int = Field(50, ge=1, le=1000)
    cooldown_sec: int = Field(60, ge=0, le=86400)
    max_daily_vol: Optional[float] = None

    # Token
    token_address: Optional[str] = None
    token_symbol: str = Field("ETH", max_length=16)
    token_filter: list[str] = Field(default_factory=list)

    # Swap
    auto_swap: bool = False
    swap_to_token: Optional[str] = Field(None, min_length=42, max_length=42)

    # Notifiche
    notify_enabled: bool = True
    notify_channel: str = Field("telegram", max_length=20)
    telegram_chat_id: Optional[str] = Field(None, max_length=50)
    email_address: Optional[str] = Field(None, max_length=255)

    # Scheduling
    schedule_json: Optional[dict] = None

    # Chain
    chain_id: int = Field(8453)

    @field_validator("owner_address", "source_wallet", "destination_wallet")
    @classmethod
    def validate_addresses(cls, v: str) -> str:
        return _validate_eth_address(v)

    @field_validator("split_destination", "token_address", "swap_to_token")
    @classmethod
    def validate_optional_addresses(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_eth_address(v)

    @field_validator("gas_strategy")
    @classmethod
    def validate_gas_strategy(cls, v: str) -> str:
        if v not in {"fast", "normal", "slow"}:
            raise ValueError("gas_strategy must be fast, normal, or slow")
        return v

    @field_validator("split_percent")
    @classmethod
    def validate_split_percent(cls, v: int) -> int:
        if not 0 <= v <= 100:
            raise ValueError("split_percent must be between 0 and 100")
        return v


class UpdateRulePayload(BaseModel):
    owner_address: str = Field(..., min_length=42, max_length=42, description="Caller wallet for auth")
    label: Optional[str] = None
    destination_wallet: Optional[str] = Field(None, min_length=42, max_length=42)
    is_active: Optional[bool] = None
    min_threshold: Optional[float] = Field(None, ge=0.0001)
    gas_strategy: Optional[str] = None
    max_gas_percent: Optional[float] = Field(None, ge=1.0, le=50.0)
    gas_limit_gwei: Optional[int] = Field(None, ge=1, le=1000)
    cooldown_sec: Optional[int] = Field(None, ge=0, le=86400)
    max_daily_vol: Optional[float] = None

    split_enabled: Optional[bool] = None
    split_percent: Optional[int] = Field(None, ge=0, le=100)
    split_destination: Optional[str] = Field(None, min_length=42, max_length=42)

    token_filter: Optional[list[str]] = None
    auto_swap: Optional[bool] = None
    swap_to_token: Optional[str] = Field(None, min_length=42, max_length=42)

    notify_enabled: Optional[bool] = None
    notify_channel: Optional[str] = Field(None, max_length=20)
    telegram_chat_id: Optional[str] = Field(None, max_length=50)
    email_address: Optional[str] = Field(None, max_length=255)

    schedule_json: Optional[dict] = None

    @field_validator("owner_address")
    @classmethod
    def validate_owner(cls, v: str) -> str:
        return _validate_eth_address(v)

    @field_validator("destination_wallet", "split_destination", "swap_to_token")
    @classmethod
    def validate_optional_addr(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_eth_address(v)


class OwnerPayload(BaseModel):
    owner_address: str = Field(..., min_length=42, max_length=42)

    @field_validator("owner_address")
    @classmethod
    def validate_owner(cls, v: str) -> str:
        return _validate_eth_address(v)


# ═══════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════

async def _get_rule_or_404(db: AsyncSession, rule_id: int) -> ForwardingRule:
    result = await db.execute(
        select(ForwardingRule).where(ForwardingRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


async def _verify_owner(rule: ForwardingRule, owner_address: str) -> None:
    if rule.user_id != owner_address.lower():
        raise HTTPException(status_code=403, detail="Not the owner of this rule")


def _serialize_rule(r: ForwardingRule) -> dict:
    return {
        "id": r.id,
        "user_id": r.user_id,
        "label": r.label,
        "source_wallet": r.source_wallet,
        "destination_wallet": r.destination_wallet,
        "split_enabled": r.split_enabled,
        "split_percent": r.split_percent,
        "split_destination": r.split_destination,
        "is_active": r.is_active,
        "is_paused": r.is_paused,
        "min_threshold": r.min_threshold,
        "gas_strategy": r.gas_strategy.value if r.gas_strategy else "normal",
        "max_gas_percent": r.max_gas_percent,
        "gas_limit_gwei": r.gas_limit_gwei,
        "cooldown_sec": r.cooldown_sec,
        "max_daily_vol": float(r.max_daily_vol) if r.max_daily_vol else None,
        "token_address": r.token_address,
        "token_symbol": r.token_symbol,
        "token_filter": r.token_filter or [],
        "auto_swap": r.auto_swap,
        "swap_to_token": r.swap_to_token,
        "notify_enabled": r.notify_enabled,
        "notify_channel": r.notify_channel,
        "telegram_chat_id": r.telegram_chat_id,
        "email_address": r.email_address,
        "schedule_json": r.schedule_json,
        "chain_id": r.chain_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _serialize_log(lg: SweepLog) -> dict:
    return {
        "id": lg.id,
        "rule_id": lg.rule_id,
        "source_wallet": lg.source_wallet,
        "destination_wallet": lg.destination_wallet,
        "is_split": lg.is_split,
        "split_index": lg.split_index,
        "split_percent": lg.split_percent,
        "split_tx_hash": lg.split_tx_hash,
        "amount_wei": lg.amount_wei,
        "amount_human": lg.amount_human,
        "amount_display": float(lg.amount_display) if lg.amount_display else None,
        "amount_usd": float(lg.amount_usd) if lg.amount_usd else None,
        "primary_amount": float(lg.primary_amount) if lg.primary_amount else None,
        "split_amount": float(lg.split_amount) if lg.split_amount else None,
        "token_symbol": lg.token_symbol,
        "gas_used": lg.gas_used,
        "gas_price_gwei": float(lg.gas_price_gwei) if lg.gas_price_gwei else None,
        "gas_cost_eth": float(lg.gas_cost_eth) if lg.gas_cost_eth else None,
        "gas_percent": lg.gas_percent,
        "status": lg.status.value if lg.status else "unknown",
        "tx_hash": lg.tx_hash,
        "error_message": lg.error_message,
        "retry_count": lg.retry_count,
        "trigger_tx_hash": lg.trigger_tx_hash,
        "fiscal_ref": lg.fiscal_ref,
        "compliance_check": lg.compliance_check,
        "created_at": lg.created_at.isoformat() if lg.created_at else None,
        "executed_at": lg.executed_at.isoformat() if lg.executed_at else None,
    }


def _period_to_timedelta(period: str) -> Optional[timedelta]:
    mapping = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
    return mapping.get(period)


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
    signing_key = getattr(settings, "alchemy_webhook_secret", "") or ALCHEMY_SIGNING_KEY

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
        value = tx.get("value", 0)
        to_addr = (tx.get("toAddress") or "").lower()

        if not to_addr or value <= 0:
            continue

        # ── 3. Cerca regole attive e non in pausa ────────
        result = await db.execute(
            select(ForwardingRule).where(
                ForwardingRule.source_wallet == to_addr,
                ForwardingRule.is_active == True,   # noqa: E712
                ForwardingRule.is_paused == False,   # noqa: E712
            )
        )
        rules = result.scalars().all()

        for rule in rules:
            if rule.token_address:
                tx_asset = (tx.get("rawContract", {}).get("address") or "").lower()
                if tx_asset != rule.token_address.lower():
                    continue

            if value < rule.min_threshold:
                continue

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

            await queue_sweep(sweep.id, rule, value)
            processed += 1

            # ── WS: incoming_detected ───────────────
            await feed_manager.broadcast(rule.user_id, "incoming_detected", {
                "sweep_id": sweep.id,
                "rule_id": rule.id,
                "source_wallet": rule.source_wallet,
                "amount_eth": value,
                "token": rule.token_symbol,
                "trigger_tx": tx.get("hash"),
            })

    if processed > 0:
        await db.commit()

    return {"status": "processed", "sweeps_queued": processed}


# ═══════════════════════════════════════════════════════════
#  1. POST /forwarding/rules — Crea regola
# ═══════════════════════════════════════════════════════════

@sweeper_router.post("/forwarding/rules")
async def create_rule(
    payload: CreateRulePayload,
    db: AsyncSession = Depends(get_db),
):
    owner = payload.owner_address

    # Limite regole per owner
    count_result = await db.execute(
        select(func.count()).select_from(ForwardingRule).where(
            ForwardingRule.user_id == owner,
            ForwardingRule.is_active == True,  # noqa: E712
        )
    )
    if count_result.scalar() >= MAX_RULES_PER_OWNER:
        raise HTTPException(
            status_code=409,
            detail=f"Maximum {MAX_RULES_PER_OWNER} active rules per owner",
        )

    # Split validation
    if payload.split_enabled and not payload.split_destination:
        raise HTTPException(status_code=422, detail="split_destination required when split_enabled is true")
    if payload.split_enabled and payload.split_percent == 100:
        raise HTTPException(status_code=422, detail="split_percent must be < 100 when split is enabled")

    rule = ForwardingRule(
        user_id=owner,
        source_wallet=payload.source_wallet,
        destination_wallet=payload.destination_wallet,
        label=payload.label,
        split_enabled=payload.split_enabled,
        split_percent=payload.split_percent,
        split_destination=payload.split_destination,
        min_threshold=payload.min_threshold,
        gas_strategy=GasStrategy(payload.gas_strategy),
        max_gas_percent=payload.max_gas_percent,
        gas_limit_gwei=payload.gas_limit_gwei,
        cooldown_sec=payload.cooldown_sec,
        max_daily_vol=payload.max_daily_vol,
        token_address=payload.token_address,
        token_symbol=payload.token_symbol,
        token_filter=payload.token_filter,
        auto_swap=payload.auto_swap,
        swap_to_token=payload.swap_to_token,
        notify_enabled=payload.notify_enabled,
        notify_channel=payload.notify_channel,
        telegram_chat_id=payload.telegram_chat_id,
        email_address=payload.email_address,
        schedule_json=payload.schedule_json,
        chain_id=payload.chain_id,
    )
    db.add(rule)
    await db.flush()

    audit = AuditLog(
        rule_id=rule.id,
        action="create",
        actor=owner,
        new_values=_serialize_rule(rule),
    )
    db.add(audit)
    await db.commit()

    return {"status": "created", "rule": _serialize_rule(rule)}


# ═══════════════════════════════════════════════════════════
#  2. GET /forwarding/rules — Lista regole
# ═══════════════════════════════════════════════════════════

@sweeper_router.get("/forwarding/rules")
async def list_rules(
    owner_address: str = Query(..., description="Owner wallet address"),
    db: AsyncSession = Depends(get_db),
):
    owner = owner_address.lower()

    result = await db.execute(
        select(ForwardingRule).where(
            ForwardingRule.user_id == owner,
        ).order_by(ForwardingRule.created_at.desc())
    )
    rules = result.scalars().all()

    items = []
    for r in rules:
        # Stats base per ogni regola
        stats_q = await db.execute(
            select(
                func.count().label("sweep_count"),
                func.max(SweepLog.executed_at).label("last_sweep"),
            ).where(SweepLog.rule_id == r.id)
        )
        stats = stats_q.one()

        item = _serialize_rule(r)
        item["sweep_count"] = stats.sweep_count
        item["last_sweep"] = stats.last_sweep.isoformat() if stats.last_sweep else None
        items.append(item)

    return {"rules": items, "total": len(items)}


# ═══════════════════════════════════════════════════════════
#  3. GET /forwarding/rules/{rule_id} — Dettaglio
# ═══════════════════════════════════════════════════════════

@sweeper_router.get("/forwarding/rules/{rule_id}")
async def get_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
):
    rule = await _get_rule_or_404(db, rule_id)

    stats_q = await db.execute(
        select(
            func.count().label("total_sweeps"),
            func.count().filter(SweepLog.status == SweepStatus.completed).label("completed"),
            func.count().filter(SweepLog.status == SweepStatus.failed).label("failed"),
            func.sum(SweepLog.amount_human).label("total_volume"),
            func.sum(
                case((SweepLog.gas_cost_eth.isnot(None), SweepLog.gas_cost_eth), else_=0)
            ).label("total_gas"),
            func.max(SweepLog.executed_at).label("last_sweep"),
        ).where(SweepLog.rule_id == rule_id)
    )
    stats = stats_q.one()

    data = _serialize_rule(rule)
    data["stats"] = {
        "total_sweeps": stats.total_sweeps,
        "completed": stats.completed,
        "failed": stats.failed,
        "total_volume_eth": float(stats.total_volume or 0),
        "total_gas_eth": float(stats.total_gas or 0),
        "last_sweep": stats.last_sweep.isoformat() if stats.last_sweep else None,
        "success_rate": round(stats.completed / stats.total_sweeps * 100, 1) if stats.total_sweeps > 0 else 0,
    }

    return {"rule": data}


# ═══════════════════════════════════════════════════════════
#  4. PUT /forwarding/rules/{rule_id} — Aggiorna
# ═══════════════════════════════════════════════════════════

@sweeper_router.put("/forwarding/rules/{rule_id}")
async def update_rule(
    rule_id: int,
    payload: UpdateRulePayload,
    db: AsyncSession = Depends(get_db),
):
    rule = await _get_rule_or_404(db, rule_id)
    await _verify_owner(rule, payload.owner_address)

    old_values = _serialize_rule(rule)

    # Build update dict — only include explicitly set fields
    updates = {}
    update_fields = payload.model_dump(exclude={"owner_address"}, exclude_unset=True)

    # source_wallet è immutabile
    if "source_wallet" in update_fields:
        raise HTTPException(status_code=422, detail="Cannot modify source_wallet")

    for field, value in update_fields.items():
        if field == "gas_strategy" and value is not None:
            updates[field] = GasStrategy(value)
        else:
            updates[field] = value

    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    # Split validation
    split_enabled = updates.get("split_enabled", rule.split_enabled)
    split_pct = updates.get("split_percent", rule.split_percent)
    split_dest = updates.get("split_destination", rule.split_destination)
    if split_enabled and not split_dest:
        raise HTTPException(status_code=422, detail="split_destination required when split_enabled is true")
    if split_enabled and split_pct == 100:
        raise HTTPException(status_code=422, detail="split_percent must be < 100 when split is enabled")

    for field, value in updates.items():
        setattr(rule, field, value)

    await db.flush()

    new_values = _serialize_rule(rule)
    # Compute diff — only log changed fields
    changed_old = {}
    changed_new = {}
    for key in new_values:
        if old_values.get(key) != new_values.get(key) and key not in ("updated_at",):
            changed_old[key] = old_values.get(key)
            changed_new[key] = new_values.get(key)

    audit = AuditLog(
        rule_id=rule.id,
        action="update",
        actor=payload.owner_address,
        old_values=changed_old,
        new_values=changed_new,
    )
    db.add(audit)
    await db.commit()

    # ── WS: rule_updated ────────────────────────────
    await feed_manager.broadcast(payload.owner_address, "rule_updated", {
        "rule_id": rule.id,
        "action": "update",
        "changed_fields": list(changed_new.keys()),
        "new_values": changed_new,
    })

    return {"status": "updated", "rule": new_values}


# ═══════════════════════════════════════════════════════════
#  5. DELETE /forwarding/rules/{rule_id}
# ═══════════════════════════════════════════════════════════

@sweeper_router.delete("/forwarding/rules/{rule_id}")
async def delete_rule(
    rule_id: int,
    payload: OwnerPayload,
    db: AsyncSession = Depends(get_db),
):
    rule = await _get_rule_or_404(db, rule_id)
    await _verify_owner(rule, payload.owner_address)

    # Controlla se ci sono sweep logs
    log_count = await db.execute(
        select(func.count()).select_from(SweepLog).where(SweepLog.rule_id == rule_id)
    )
    has_logs = log_count.scalar() > 0

    if has_logs:
        # Soft delete — mantieni per audit trail
        rule.is_active = False
        rule.is_paused = True
        action = "soft_delete"
    else:
        # Hard delete — nessun log collegato
        await db.delete(rule)
        action = "delete"

    audit = AuditLog(
        rule_id=rule_id,
        action=action,
        actor=payload.owner_address,
        old_values=_serialize_rule(rule) if has_logs else {"id": rule_id},
    )
    db.add(audit)
    await db.commit()

    return {"status": "deleted", "mode": "soft" if has_logs else "hard", "rule_id": rule_id}


# ═══════════════════════════════════════════════════════════
#  6. POST /forwarding/rules/{rule_id}/pause
# ═══════════════════════════════════════════════════════════

@sweeper_router.post("/forwarding/rules/{rule_id}/pause")
async def pause_rule(
    rule_id: int,
    payload: OwnerPayload,
    db: AsyncSession = Depends(get_db),
):
    rule = await _get_rule_or_404(db, rule_id)
    await _verify_owner(rule, payload.owner_address)

    if rule.is_paused:
        raise HTTPException(status_code=409, detail="Rule is already paused")

    rule.is_paused = True
    audit = AuditLog(rule_id=rule_id, action="pause", actor=payload.owner_address)
    db.add(audit)
    await db.commit()

    await feed_manager.broadcast(payload.owner_address, "rule_updated", {
        "rule_id": rule_id, "action": "pause",
    })

    return {"status": "paused", "rule_id": rule_id}


# ═══════════════════════════════════════════════════════════
#  7. POST /forwarding/rules/{rule_id}/resume
# ═══════════════════════════════════════════════════════════

@sweeper_router.post("/forwarding/rules/{rule_id}/resume")
async def resume_rule(
    rule_id: int,
    payload: OwnerPayload,
    db: AsyncSession = Depends(get_db),
):
    rule = await _get_rule_or_404(db, rule_id)
    await _verify_owner(rule, payload.owner_address)

    if not rule.is_paused:
        raise HTTPException(status_code=409, detail="Rule is not paused")

    rule.is_paused = False
    audit = AuditLog(rule_id=rule_id, action="resume", actor=payload.owner_address)
    db.add(audit)
    await db.commit()

    await feed_manager.broadcast(payload.owner_address, "rule_updated", {
        "rule_id": rule_id, "action": "resume",
    })

    return {"status": "resumed", "rule_id": rule_id}


# ═══════════════════════════════════════════════════════════
#  8. POST /forwarding/emergency-stop
# ═══════════════════════════════════════════════════════════

@sweeper_router.post("/forwarding/emergency-stop")
async def emergency_stop(
    payload: OwnerPayload,
    db: AsyncSession = Depends(get_db),
):
    owner = payload.owner_address

    result = await db.execute(
        select(ForwardingRule).where(
            ForwardingRule.user_id == owner,
            ForwardingRule.is_active == True,   # noqa: E712
            ForwardingRule.is_paused == False,   # noqa: E712
        )
    )
    rules = result.scalars().all()

    if not rules:
        return {"status": "no_active_rules", "paused_count": 0}

    paused_ids = []
    for rule in rules:
        rule.is_paused = True
        audit = AuditLog(rule_id=rule.id, action="emergency_stop", actor=owner)
        db.add(audit)
        paused_ids.append(rule.id)

    await db.commit()

    await feed_manager.broadcast(owner, "emergency_stop", {
        "paused_count": len(paused_ids),
        "paused_rule_ids": paused_ids,
    })

    return {
        "status": "emergency_stop",
        "paused_count": len(paused_ids),
        "paused_rule_ids": paused_ids,
    }


# ═══════════════════════════════════════════════════════════
#  9. GET /forwarding/logs — Sweep logs (paginati)
# ═══════════════════════════════════════════════════════════

@sweeper_router.get("/forwarding/logs")
async def list_logs(
    owner_address: str = Query(..., description="Owner wallet address"),
    rule_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None, description="pending|executing|completed|failed|gas_too_high"),
    token: Optional[str] = Query(None, description="Filter by token symbol"),
    date_from: Optional[datetime] = Query(None, description="ISO datetime"),
    date_to: Optional[datetime] = Query(None, description="ISO datetime"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    owner = owner_address.lower()

    # Subquery: rule IDs belonging to this owner
    rule_ids_q = select(ForwardingRule.id).where(ForwardingRule.user_id == owner)

    # Base query
    q = select(SweepLog).where(SweepLog.rule_id.in_(rule_ids_q))
    count_q = select(func.count()).select_from(SweepLog).where(SweepLog.rule_id.in_(rule_ids_q))

    # Filters
    if rule_id is not None:
        q = q.where(SweepLog.rule_id == rule_id)
        count_q = count_q.where(SweepLog.rule_id == rule_id)
    if status:
        try:
            status_enum = SweepStatus(status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {status}")
        q = q.where(SweepLog.status == status_enum)
        count_q = count_q.where(SweepLog.status == status_enum)
    if token:
        q = q.where(SweepLog.token_symbol == token.upper())
        count_q = count_q.where(SweepLog.token_symbol == token.upper())
    if date_from:
        q = q.where(SweepLog.created_at >= date_from)
        count_q = count_q.where(SweepLog.created_at >= date_from)
    if date_to:
        q = q.where(SweepLog.created_at <= date_to)
        count_q = count_q.where(SweepLog.created_at <= date_to)

    # Count
    total = (await db.execute(count_q)).scalar()

    # Paginate
    offset = (page - 1) * per_page
    q = q.order_by(SweepLog.created_at.desc()).offset(offset).limit(per_page)
    result = await db.execute(q)
    logs = result.scalars().all()

    return {
        "logs": [_serialize_log(lg) for lg in logs],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page if total else 0,
        },
    }


# ═══════════════════════════════════════════════════════════
#  10. GET /forwarding/logs/export — Export CSV/JSON
# ═══════════════════════════════════════════════════════════

@sweeper_router.get("/forwarding/logs/export")
async def export_logs(
    owner_address: str = Query(...),
    format: str = Query("csv", description="csv or json"),
    rule_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    owner = owner_address.lower()
    if format not in ("csv", "json"):
        raise HTTPException(status_code=422, detail="format must be csv or json")

    rule_ids_q = select(ForwardingRule.id).where(ForwardingRule.user_id == owner)
    q = select(SweepLog).where(SweepLog.rule_id.in_(rule_ids_q))

    if rule_id is not None:
        q = q.where(SweepLog.rule_id == rule_id)
    if status:
        q = q.where(SweepLog.status == SweepStatus(status))
    if token:
        q = q.where(SweepLog.token_symbol == token.upper())
    if date_from:
        q = q.where(SweepLog.created_at >= date_from)
    if date_to:
        q = q.where(SweepLog.created_at <= date_to)

    q = q.order_by(SweepLog.created_at.desc()).limit(5000)
    result = await db.execute(q)
    logs = result.scalars().all()
    rows = [_serialize_log(lg) for lg in logs]

    if format == "json":
        return {"logs": rows, "count": len(rows)}

    # CSV streaming
    output = io.StringIO()
    if rows:
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    content = output.getvalue()

    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sweep_logs.csv"},
    )


# ═══════════════════════════════════════════════════════════
#  11. GET /forwarding/stats — Statistiche aggregate
# ═══════════════════════════════════════════════════════════

@sweeper_router.get("/forwarding/stats")
async def get_stats(
    owner_address: str = Query(...),
    period: str = Query("30d", description="24h|7d|30d|all"),
    db: AsyncSession = Depends(get_db),
):
    owner = owner_address.lower()
    rule_ids_q = select(ForwardingRule.id).where(ForwardingRule.user_id == owner)

    q_base = SweepLog.rule_id.in_(rule_ids_q)
    td = _period_to_timedelta(period)
    if td:
        cutoff = datetime.now(timezone.utc) - td
        time_filter = SweepLog.created_at >= cutoff
    else:
        time_filter = True  # "all" — no time filter

    result = await db.execute(
        select(
            func.count().label("total_sweeps"),
            func.count().filter(SweepLog.status == SweepStatus.completed).label("completed"),
            func.count().filter(SweepLog.status == SweepStatus.failed).label("failed"),
            func.coalesce(func.sum(SweepLog.amount_human), 0).label("total_volume_eth"),
            func.coalesce(func.sum(
                case((SweepLog.amount_usd.isnot(None), SweepLog.amount_usd), else_=0)
            ), 0).label("total_volume_usd"),
            func.coalesce(func.sum(
                case((SweepLog.gas_cost_eth.isnot(None), SweepLog.gas_cost_eth), else_=0)
            ), 0).label("total_gas_spent"),
            func.avg(
                case(
                    (SweepLog.executed_at.isnot(None),
                     func.extract("epoch", SweepLog.executed_at) - func.extract("epoch", SweepLog.created_at)),
                    else_=None,
                )
            ).label("avg_sweep_seconds"),
        ).where(q_base, time_filter)
    )
    row = result.one()

    total = row.total_sweeps
    success_rate = round(row.completed / total * 100, 1) if total > 0 else 0

    return {
        "period": period,
        "total_sweeps": total,
        "completed": row.completed,
        "failed": row.failed,
        "total_volume_eth": round(float(row.total_volume_eth), 6),
        "total_volume_usd": round(float(row.total_volume_usd), 2),
        "total_gas_spent_eth": round(float(row.total_gas_spent), 8),
        "avg_sweep_time_sec": round(float(row.avg_sweep_seconds), 1) if row.avg_sweep_seconds else None,
        "success_rate": success_rate,
    }


# ═══════════════════════════════════════════════════════════
#  12. GET /forwarding/stats/daily — Volume giornaliero
# ═══════════════════════════════════════════════════════════

@sweeper_router.get("/forwarding/stats/daily")
async def get_daily_stats(
    owner_address: str = Query(...),
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    owner = owner_address.lower()
    rule_ids_q = select(ForwardingRule.id).where(ForwardingRule.user_id == owner)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(
            cast(SweepLog.created_at, Date).label("date"),
            func.count().label("sweep_count"),
            func.coalesce(func.sum(SweepLog.amount_human), 0).label("volume_eth"),
            func.coalesce(func.sum(
                case((SweepLog.amount_usd.isnot(None), SweepLog.amount_usd), else_=0)
            ), 0).label("volume_usd"),
            func.coalesce(func.sum(
                case((SweepLog.gas_cost_eth.isnot(None), SweepLog.gas_cost_eth), else_=0)
            ), 0).label("gas_total"),
        )
        .where(SweepLog.rule_id.in_(rule_ids_q), SweepLog.created_at >= cutoff)
        .group_by(cast(SweepLog.created_at, Date))
        .order_by(cast(SweepLog.created_at, Date))
    )
    rows = result.all()

    return {
        "period_days": days,
        "data": [
            {
                "date": row.date.isoformat() if row.date else None,
                "sweep_count": row.sweep_count,
                "volume_eth": round(float(row.volume_eth), 6),
                "volume_usd": round(float(row.volume_usd), 2),
                "gas_total": round(float(row.gas_total), 8),
            }
            for row in rows
        ],
    }
