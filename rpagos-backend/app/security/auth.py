"""
RSends Backend — Wallet Signature Authentication (EIP-191).

Verifies wallet ownership via personal_sign (EIP-191).

Headers required:
  X-Wallet-Address:   "0x..."
  X-Wallet-Signature: "0x..." (personal_sign of message)
  X-Timestamp:        ISO 8601 timestamp

Message format signed by the wallet:
  "RSends:{address}:{timestamp}"

Security:
  - Recovered address must match claimed address (case-insensitive)
  - Timestamp must be within 5 minutes (anti-replay)
  - DEBUG mode bypass only on testnet chain_ids
"""

import logging
import re
from datetime import datetime, timezone
from functools import wraps
from typing import Callable, Optional

from fastapi import Request, HTTPException

from app.config import get_settings

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
#  Constants
# ═══════════════════════════════════════════════════════════════

AUTH_WINDOW_SECONDS = 300  # 5 minutes

# Testnet chain IDs — debug bypass only allowed here
TESTNET_CHAIN_IDS = frozenset({84532, 11155111, 421614, 5, 80002})

_ETH_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


# ═══════════════════════════════════════════════════════════════
#  Exception
# ═══════════════════════════════════════════════════════════════

class AuthError(Exception):
    """Wallet authentication failure."""

    def __init__(self, reason: str, status_code: int = 401):
        self.reason = reason
        self.status_code = status_code
        super().__init__(reason)


# ═══════════════════════════════════════════════════════════════
#  Core Verification
# ═══════════════════════════════════════════════════════════════

def _check_timestamp_freshness(timestamp_str: str) -> bool:
    """Verify timestamp is within AUTH_WINDOW_SECONDS."""
    try:
        ts = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return False

    now = datetime.now(timezone.utc)
    age = abs((now - ts).total_seconds())
    return age <= AUTH_WINDOW_SECONDS


def verify_wallet_signature(
    address: str,
    signature: str,
    timestamp: str,
) -> bool:
    """Verify EIP-191 personal_sign signature.

    The wallet signs the message:  "RSends:{address}:{timestamp}"
    We recover the signer address and compare.

    Args:
        address: Claimed wallet address (0x...).
        signature: Hex-encoded signature from personal_sign.
        timestamp: ISO 8601 timestamp that was signed.

    Returns:
        True if the recovered address matches the claimed address.
    """
    from eth_account.messages import encode_defunct
    from eth_account import Account

    message_text = f"RSends:{address}:{timestamp}"
    signable = encode_defunct(text=message_text)

    try:
        recovered = Account.recover_message(signable, signature=signature)
    except Exception as exc:
        logger.warning("EIP-191 signature recovery failed: %s", exc)
        return False

    return recovered.lower() == address.lower()


# ═══════════════════════════════════════════════════════════════
#  Request Authentication
# ═══════════════════════════════════════════════════════════════

async def authenticate_request(request: Request) -> str:
    """Authenticate an HTTP request via wallet signature headers.

    Reads X-Wallet-Address, X-Wallet-Signature, X-Timestamp.
    In DEBUG mode on testnet chain_ids, allows bypass.

    Returns:
        Verified wallet address (checksummed).

    Raises:
        AuthError: On any authentication failure.
    """
    settings = get_settings()
    from eth_utils import to_checksum_address

    address = request.headers.get("X-Wallet-Address", "").strip()
    signature = request.headers.get("X-Wallet-Signature", "").strip()
    timestamp = request.headers.get("X-Timestamp", "").strip()

    # ── Debug bypass (testnet only) ────────────────────────
    if settings.debug and address:
        chain_id_str = request.headers.get("X-Chain-Id", "")
        if chain_id_str.isdigit() and int(chain_id_str) in TESTNET_CHAIN_IDS:
            logger.debug(
                "Auth bypass (debug + testnet chain %s) for %s",
                chain_id_str, address,
            )
            return to_checksum_address(address)

    # ── Validate presence ──────────────────────────────────
    if not address:
        raise AuthError("Missing X-Wallet-Address header")
    if not signature:
        raise AuthError("Missing X-Wallet-Signature header")
    if not timestamp:
        raise AuthError("Missing X-Timestamp header")

    # ── Validate format ────────────────────────────────────
    if not _ETH_ADDR_RE.match(address):
        raise AuthError("Invalid wallet address format")

    # ── Timestamp freshness ────────────────────────────────
    if not _check_timestamp_freshness(timestamp):
        raise AuthError("Timestamp expired or invalid (max 5 min)")

    # ── Signature verification ─────────────────────────────
    if not verify_wallet_signature(address, signature, timestamp):
        raise AuthError("Invalid wallet signature")

    verified = to_checksum_address(address)
    logger.info("Wallet authenticated: %s", verified)
    return verified


# ═══════════════════════════════════════════════════════════════
#  Decorator
# ═══════════════════════════════════════════════════════════════

def require_wallet_auth(func: Callable) -> Callable:
    """Decorator: require wallet signature authentication.

    Injects ``wallet_address: str`` into route kwargs.

    Usage::

        @router.post("/protected")
        @require_wallet_auth
        async def protected_route(request: Request, wallet_address: str = ""):
            ...
    """

    @wraps(func)
    async def wrapper(*args, **kwargs):
        # Find the Request object
        request: Optional[Request] = kwargs.get("request")
        if request is None:
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break

        if request is None:
            raise HTTPException(
                status_code=500, detail="No request object found"
            )

        try:
            wallet_address = await authenticate_request(request)
        except AuthError as exc:
            from app.security.trusted_proxy import get_real_client_ip

            client_ip = get_real_client_ip(request)
            logger.warning(
                "Auth failure: %s (ip=%s, addr=%s)",
                exc.reason,
                client_ip,
                request.headers.get("X-Wallet-Address", "n/a"),
            )
            raise HTTPException(status_code=exc.status_code, detail=exc.reason)

        kwargs["wallet_address"] = wallet_address
        return await func(*args, **kwargs)

    return wrapper
