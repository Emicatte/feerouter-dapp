"""
RPagos Backend — Redis Cache Service

Cache per:
  - Token metadata da Alchemy (TTL: 10 min)
  - Prezzi token (TTL: 2 min)
  - Portfolio data (TTL: 30 sec)
  - Rate limiting per IP (sliding window)
"""

import json
from typing import Optional, Any
from datetime import datetime, timezone

import redis.asyncio as redis
from app.config import get_settings


_pool: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    """Lazy-init Redis connection pool."""
    global _pool
    if _pool is None:
        settings = get_settings()
        url = getattr(settings, 'redis_url', 'redis://localhost:6379/0')
        _pool = redis.from_url(
            url,
            decode_responses=True,
            max_connections=20,
        )
    return _pool


# ═══════════════════════════════════════════════════════════
#  Generic Cache
# ═══════════════════════════════════════════════════════════

async def cache_get(key: str) -> Optional[Any]:
    """Get a cached value. Returns None if miss."""
    try:
        r = await get_redis()
        val = await r.get(key)
        if val is None:
            return None
        return json.loads(val)
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl_seconds: int = 300) -> bool:
    """Set a cached value with TTL."""
    try:
        r = await get_redis()
        await r.setex(key, ttl_seconds, json.dumps(value, default=str))
        return True
    except Exception:
        return False


async def cache_delete(key: str) -> bool:
    """Delete a cached key."""
    try:
        r = await get_redis()
        await r.delete(key)
        return True
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════
#  Alchemy-specific Cache
# ═══════════════════════════════════════════════════════════

async def get_token_metadata(contract_address: str, chain_id: int) -> Optional[dict]:
    """Cache token metadata per 10 minuti."""
    key = f"meta:{chain_id}:{contract_address.lower()}"
    return await cache_get(key)


async def set_token_metadata(
    contract_address: str,
    chain_id: int,
    metadata: dict,
) -> None:
    """Salva token metadata in cache."""
    key = f"meta:{chain_id}:{contract_address.lower()}"
    await cache_set(key, metadata, ttl_seconds=600)  # 10 min


async def get_portfolio(address: str, chain_id: int) -> Optional[dict]:
    """Cache portfolio completo per 30 secondi."""
    key = f"portfolio:{chain_id}:{address.lower()}"
    return await cache_get(key)


async def set_portfolio(address: str, chain_id: int, data: dict) -> None:
    """Salva portfolio in cache."""
    key = f"portfolio:{chain_id}:{address.lower()}"
    await cache_set(key, data, ttl_seconds=30)


async def get_prices() -> Optional[dict]:
    """Cache prezzi token per 2 minuti."""
    return await cache_get("prices:usd")


async def set_prices(prices: dict) -> None:
    """Salva prezzi in cache."""
    await cache_set("prices:usd", prices, ttl_seconds=120)


# ═══════════════════════════════════════════════════════════
#  Rate Limiting (Sliding Window)
# ═══════════════════════════════════════════════════════════

async def check_rate_limit(
    identifier: str,
    max_requests: int = 60,
    window_seconds: int = 60,
) -> tuple[bool, int]:
    """
    Sliding window rate limiter.

    Returns:
        (allowed: bool, remaining: int)
    """
    try:
        r = await get_redis()
        key = f"rl:{identifier}"
        now = datetime.now(timezone.utc).timestamp()
        window_start = now - window_seconds

        pipe = r.pipeline()
        # Rimuovi entries scadute
        pipe.zremrangebyscore(key, 0, window_start)
        # Aggiungi request corrente
        pipe.zadd(key, {str(now): now})
        # Conta requests nella finestra
        pipe.zcard(key)
        # Imposta TTL sulla chiave
        pipe.expire(key, window_seconds)

        results = await pipe.execute()
        count = results[2]
        remaining = max(0, max_requests - count)

        return (count <= max_requests, remaining)
    except Exception:
        # Se Redis è down, permetti la richiesta
        return (True, max_requests)


# ═══════════════════════════════════════════════════════════
#  Cleanup
# ═══════════════════════════════════════════════════════════

async def close_redis() -> None:
    """Chiudi il pool Redis."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
