"""
RSends Backend — Internal Signing Guard API.

Called by the Next.js oracle endpoint before and after signing.
These endpoints are internal-only (not exposed to public).

Endpoints:
  POST /api/internal/signing/check
    → Rate limit + nonce uniqueness + parameter validation
    → Returns { allowed: true } or { allowed: false, reason: "..." }

  POST /api/internal/signing/audit
    → Record a signing event to the immutable audit log
"""

import logging
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

signing_router = APIRouter(prefix="/api/internal/signing", tags=["signing"])

# ── Supported chains ──────────────────────────────────────
SUPPORTED_CHAINS = {1, 10, 56, 137, 8453, 42161, 43114, 84532, 728126428}

# ── Amount bounds (in wei) ────────────────────────────────
# $0.01 in ETH at ~$2200/ETH ≈ 4.5e12 wei — use conservative minimum
MIN_AMOUNT_WEI = 1_000_000_000_000       # 1e12 (< $0.01)
# $100,000 in ETH ≈ 45.45 ETH ≈ 4.545e19 wei — generous upper bound
MAX_AMOUNT_WEI = 100_000_000_000_000_000_000_000  # 1e23 (~$200K max safety)

# ── Max deadline offset ───────────────────────────────────
MAX_DEADLINE_SECONDS = 600  # 10 minutes from now

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


# ═══════════════════════════════════════════════════════════════
#  Request / Response schemas
# ═══════════════════════════════════════════════════════════════

class SigningCheckRequest(BaseModel):
    """Pre-signing validation request."""
    wallet: str = Field(..., description="Sender wallet address")
    recipient: str = Field(..., description="Recipient address")
    token_in: str = Field(default=ZERO_ADDRESS)
    amount_in_wei: str = Field(..., description="Amount in wei (string)")
    nonce: str = Field(..., description="bytes32 hex nonce")
    deadline: int = Field(..., description="Unix timestamp deadline")
    chain_id: int = Field(..., description="Target chain ID")
    ip_address: Optional[str] = None
    contract_address: Optional[str] = Field(
        default=None, description="FeeRouter contract address for this chain"
    )


class SigningCheckResponse(BaseModel):
    allowed: bool
    reason: Optional[str] = None


class SigningAuditRequest(BaseModel):
    """Post-signing audit record."""
    signer_address: str
    chain_id: int
    sender: str
    recipient: str
    token_in: str = ZERO_ADDRESS
    amount_in_wei: str
    nonce: str
    deadline: int
    approved: bool
    denial_reason: Optional[str] = None
    risk_score: Optional[int] = None
    risk_level: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    correlation_id: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
#  POST /api/internal/signing/check
# ═══════════════════════════════════════════════════════════════

@signing_router.post("/check", response_model=SigningCheckResponse)
async def signing_check(body: SigningCheckRequest, request: Request):
    """Pre-signing validation: rate limit + nonce + parameter bounds.

    Called by the Next.js oracle BEFORE signing.
    Fail-closed on Redis failure.
    """
    import time

    # ── 1. Chain validation ───────────────────────────────
    if body.chain_id not in SUPPORTED_CHAINS:
        return SigningCheckResponse(
            allowed=False,
            reason=f"unsupported_chain ({body.chain_id})",
        )

    # ── 2. Recipient validation ──────────────────────────
    recipient_lower = body.recipient.lower()

    if recipient_lower == ZERO_ADDRESS:
        return SigningCheckResponse(
            allowed=False,
            reason="recipient_is_zero_address",
        )

    # Don't sign if recipient is the FeeRouter itself (funds stuck)
    if body.contract_address and recipient_lower == body.contract_address.lower():
        return SigningCheckResponse(
            allowed=False,
            reason="recipient_is_fee_router_contract",
        )

    # ── 3. Amount bounds ─────────────────────────────────
    try:
        amount = int(body.amount_in_wei)
    except (ValueError, TypeError):
        return SigningCheckResponse(
            allowed=False,
            reason=f"invalid_amount ({body.amount_in_wei})",
        )

    if amount < MIN_AMOUNT_WEI:
        return SigningCheckResponse(
            allowed=False,
            reason=f"amount_too_small ({amount} < {MIN_AMOUNT_WEI})",
        )

    if amount > MAX_AMOUNT_WEI:
        return SigningCheckResponse(
            allowed=False,
            reason=f"amount_too_large ({amount} > {MAX_AMOUNT_WEI})",
        )

    # ── 4. Deadline bounds ───────────────────────────────
    now = int(time.time())

    if body.deadline <= now:
        return SigningCheckResponse(
            allowed=False,
            reason=f"deadline_in_past ({body.deadline} <= {now})",
        )

    if body.deadline > now + MAX_DEADLINE_SECONDS:
        return SigningCheckResponse(
            allowed=False,
            reason=f"deadline_too_far ({body.deadline - now}s > {MAX_DEADLINE_SECONDS}s)",
        )

    # ── 5. Rate limiting (Redis) ─────────────────────────
    from app.services.signing_rate_limit import check_signing_rate_limit

    ip = body.ip_address or (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else None)
    )

    allowed, reason = await check_signing_rate_limit(body.wallet, ip)
    if not allowed:
        return SigningCheckResponse(allowed=False, reason=reason)

    # ── 6. Nonce uniqueness (Redis) ──────────────────────
    from app.services.signing_rate_limit import check_nonce_uniqueness

    unique, nonce_reason = await check_nonce_uniqueness(body.nonce)
    if not unique:
        return SigningCheckResponse(allowed=False, reason=nonce_reason)

    return SigningCheckResponse(allowed=True)


# ═══════════════════════════════════════════════════════════════
#  POST /api/internal/signing/audit
# ═══════════════════════════════════════════════════════════════

@signing_router.post("/audit")
async def signing_audit(body: SigningAuditRequest):
    """Record a signing event to the immutable audit log.

    Called by the Next.js oracle AFTER signing decision (approved or denied).
    Non-blocking: audit failures don't affect the signing response.
    """
    from app.services.signing_audit import record_signing_event

    entry_id = await record_signing_event(
        signer_address=body.signer_address,
        chain_id=body.chain_id,
        sender=body.sender,
        recipient=body.recipient,
        token_in=body.token_in,
        amount_in_wei=body.amount_in_wei,
        nonce=body.nonce,
        deadline=body.deadline,
        approved=body.approved,
        denial_reason=body.denial_reason,
        risk_score=body.risk_score,
        risk_level=body.risk_level,
        ip_address=body.ip_address,
        user_agent=body.user_agent,
        correlation_id=body.correlation_id,
    )

    return {"recorded": entry_id is not None, "audit_id": entry_id}
