"""
RSend API Key Authentication

Ogni client (merchant) ha una API key unica.
La key viene inviata nell'header: Authorization: Bearer rsend_xxx

Per ora: le key sono in un dict (poi DB/Redis in produzione).
L'endpoint webhook Alchemy è ESENTE (usa HMAC).
Health check è ESENTE.
Debug mode = auth disabilitata.
"""
import hashlib
import hmac
import logging
import secrets
from functools import wraps
from typing import Optional

from fastapi import Request, HTTPException

from app.config import get_settings

logger = logging.getLogger("api_keys")

# Endpoints esenti da API key auth
EXEMPT_PATHS = {
    "/health",
    "/health/ready",
    "/health/rpc",
    "/health/config",
    "/metrics",
    "/docs",
    "/openapi.json",
    "/api/v1/webhooks/alchemy",  # Usa HMAC, non API key
    "/ws/",  # WebSocket
}

def is_exempt(path: str) -> bool:
    """Check if path is exempt from API key auth."""
    for exempt in EXEMPT_PATHS:
        if path.startswith(exempt):
            return True
    return False


def generate_api_key() -> str:
    """Generate a new API key: rsend_live_xxxxx or rsend_test_xxxxx"""
    return f"rsend_live_{secrets.token_hex(24)}"


def hash_api_key(key: str) -> str:
    """Hash an API key for storage. Never store plaintext."""
    return hashlib.sha256(key.encode()).hexdigest()


async def verify_api_key(request: Request) -> Optional[dict]:
    """
    Verify API key from Authorization header.
    Returns client info dict or None if invalid.
    """
    settings = get_settings()

    # Debug mode: skip auth
    if settings.debug:
        return {"client_id": "debug", "name": "Debug Mode"}

    # Check exempt paths
    if is_exempt(request.url.path):
        return {"client_id": "exempt", "name": "Exempt Path"}

    # Get key from header
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None

    key = auth[7:]  # Remove "Bearer "
    if not key.startswith("rsend_"):
        return None

    # Verify (for now, check against env var API_KEYS)
    # In production: check against DB/Redis
    valid_keys = settings.hmac_secret  # Temporary: use hmac_secret as single valid key
    # TODO: implement proper key storage in DB

    # For now, accept any rsend_ prefixed key in debug, or verify hash
    key_hash = hash_api_key(key)

    # Placeholder: accept if key is properly formatted
    # In production: lookup key_hash in database
    return {"client_id": key_hash[:16], "name": "API Client"}
