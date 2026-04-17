"""
API Key Management Routes

POST /api/v1/keys/generate     — Generate new API key (returns plaintext ONCE)
GET  /api/v1/keys              — List all keys for owner (prefix only)
GET  /api/v1/keys/{id}/usage   — Get usage stats for a key
POST /api/v1/keys/{id}/revoke  — Revoke a key (soft delete)
DELETE /api/v1/keys/{id}       — Delete a key permanently
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.api_key_models import ApiKey
from app.security.api_keys import generate_api_key

api_key_router = APIRouter(prefix="/api/v1/keys", tags=["api-keys"])


class GenerateKeyRequest(BaseModel):
    owner_address: str
    label: str = "Default"
    scope: str = "write"
    environment: str = "live"

    @field_validator("scope")
    @classmethod
    def validate_scope(cls, v: str) -> str:
        if v not in ("read", "write", "admin"):
            raise ValueError("scope must be 'read', 'write', or 'admin'")
        return v

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        if v not in ("test", "live"):
            raise ValueError("environment must be 'test' or 'live'")
        return v


class GenerateKeyResponse(BaseModel):
    id: int
    key: str
    prefix: str
    label: str
    scope: str
    environment: str
    created_at: str


class ApiKeyListItem(BaseModel):
    id: int
    prefix: str
    label: str
    scope: str
    environment: str
    is_active: bool
    rate_limit_rpm: int
    total_requests: int
    total_intents_created: int
    total_volume_usd: str
    created_at: str
    last_used_at: Optional[str] = None


class RevokeRequest(BaseModel):
    owner_address: str


@api_key_router.post("/generate", response_model=GenerateKeyResponse)
async def generate_key(req: GenerateKeyRequest, db: AsyncSession = Depends(get_db)):
    """Generate a new API key. Returns plaintext ONCE — store it safely."""
    owner = req.owner_address.lower()

    count_q = select(ApiKey).where(
        ApiKey.owner_address == owner,
        ApiKey.is_active == True,  # noqa: E712
        ApiKey.environment == req.environment,
    )
    result = await db.execute(count_q)
    if len(result.scalars().all()) >= 5:
        raise HTTPException(400, f"Maximum 5 active {req.environment} API keys per account")

    plaintext_key, key_fields = generate_api_key(environment=req.environment)

    api_key = ApiKey(
        owner_address=owner,
        **key_fields,
        label=req.label,
        scope=req.scope,
        environment=req.environment,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return GenerateKeyResponse(
        id=api_key.id,
        key=plaintext_key,
        prefix=key_fields["display_prefix"],
        label=api_key.label,
        scope=req.scope,
        environment=req.environment,
        created_at=api_key.created_at.isoformat(),
    )


@api_key_router.get("/", response_model=list[ApiKeyListItem])
async def list_keys(
    owner_address: str = Query(...), db: AsyncSession = Depends(get_db)
):
    """List all API keys for an owner. Never returns the full key."""
    owner = owner_address.lower()
    q = (
        select(ApiKey)
        .where(ApiKey.owner_address == owner)
        .order_by(ApiKey.created_at.desc())
    )
    result = await db.execute(q)
    keys = result.scalars().all()
    return [
        ApiKeyListItem(
            id=k.id,
            prefix=k.display_prefix or k.key_prefix,
            label=k.label,
            scope=k.scope or "write",
            environment=k.environment or "live",
            is_active=k.is_active,
            rate_limit_rpm=k.rate_limit_rpm or 100,
            total_requests=k.total_requests or 0,
            total_intents_created=k.total_intents_created or 0,
            total_volume_usd=k.total_volume_usd or "0",
            created_at=k.created_at.isoformat(),
            last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
        )
        for k in keys
    ]


@api_key_router.get("/{key_id}/usage")
async def get_key_usage(
    key_id: int,
    owner_address: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Get usage stats for a specific API key."""
    q = select(ApiKey).where(
        ApiKey.id == key_id,
        ApiKey.owner_address == owner_address.lower(),
    )
    result = await db.execute(q)
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Key not found")

    return {
        "id": key.id,
        "label": key.label,
        "scope": key.scope or "write",
        "environment": key.environment or "live",
        "rate_limit_rpm": key.rate_limit_rpm or 100,
        "usage": {
            "total_requests": key.total_requests or 0,
            "total_intents_created": key.total_intents_created or 0,
            "total_volume_usd": key.total_volume_usd or "0",
        },
        "limits": {
            "monthly_intent_limit": key.monthly_intent_limit or 0,
            "monthly_volume_limit_usd": key.monthly_volume_limit_usd or "0",
        },
        "created_at": key.created_at.isoformat(),
        "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
    }


@api_key_router.post("/{key_id}/revoke")
async def revoke_key(
    key_id: int, req: RevokeRequest, db: AsyncSession = Depends(get_db)
):
    """Revoke an API key (soft delete — keeps record)."""
    q = select(ApiKey).where(
        ApiKey.id == key_id,
        ApiKey.owner_address == req.owner_address.lower(),
    )
    result = await db.execute(q)
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Key not found")

    key.is_active = False
    key.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "revoked", "id": key_id}


@api_key_router.delete("/{key_id}")
async def delete_key(
    key_id: int,
    owner_address: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete an API key."""
    q = select(ApiKey).where(
        ApiKey.id == key_id,
        ApiKey.owner_address == owner_address.lower(),
    )
    result = await db.execute(q)
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "Key not found")

    await db.delete(key)
    await db.commit()
    return {"status": "deleted", "id": key_id}
