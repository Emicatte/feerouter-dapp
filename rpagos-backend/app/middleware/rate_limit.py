"""
RPagos Backend — Rate Limiting Middleware

Sliding window rate limiting:
  - Se Redis è disponibile → sliding window via sorted set
  - Se Redis non è disponibile → fallback in-memory (con warning)

Limiti:
  POST /api/v1/tx/callback:    10/min per IP
  POST /api/v1/dac8/generate:   5/min per IP
  GET endpoints:                60/min per IP
  /health/*:                    nessun limite

Headers di risposta:
  X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
"""

import logging
import time
from collections import defaultdict
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ── Limiti per endpoint (max_requests, window_seconds) ─────────────────────
RATE_LIMITS: dict[str, tuple[int, int]] = {
    "POST:/api/v1/tx/callback":   (10, 60),
    "POST:/api/v1/dac8/generate": (5, 60),
}
DEFAULT_GET_LIMIT = (60, 60)   # 60 req/min per GET
DEFAULT_POST_LIMIT = (30, 60)  # 30 req/min per POST generici


# ── In-memory fallback ─────────────────────────────────────────────────────

class InMemoryRateLimiter:
    """Fallback in-memory sliding window usando liste di timestamp."""

    def __init__(self) -> None:
        self._buckets: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def check(self, key: str, max_requests: int, window_seconds: int) -> tuple[bool, int, int]:
        """Returns (allowed, remaining, reset_epoch)."""
        now = time.time()
        window_start = now - window_seconds

        with self._lock:
            # Rimuovi entries scadute
            bucket = self._buckets[key]
            self._buckets[key] = [t for t in bucket if t > window_start]

            # Aggiungi la richiesta corrente
            self._buckets[key].append(now)
            count = len(self._buckets[key])

        remaining = max(0, max_requests - count)
        reset_epoch = int(now + window_seconds)
        allowed = count <= max_requests

        return allowed, remaining, reset_epoch


_memory_limiter = InMemoryRateLimiter()
_redis_warned = False


# ── Redis sliding window ──────────────────────────────────────────────────

async def _check_redis(
    key: str, max_requests: int, window_seconds: int,
) -> tuple[bool, int, int]:
    """Sliding window via Redis sorted set.

    Returns (allowed, remaining, reset_epoch).
    """
    from app.services.cache_service import get_redis

    r = await get_redis()
    now = time.time()
    window_start = now - window_seconds

    pipe = r.pipeline()
    pipe.zremrangebyscore(key, 0, window_start)
    pipe.zadd(key, {str(now): now})
    pipe.zcard(key)
    pipe.expire(key, window_seconds)
    results = await pipe.execute()

    count = results[2]
    remaining = max(0, max_requests - count)
    reset_epoch = int(now + window_seconds)
    allowed = count <= max_requests

    return allowed, remaining, reset_epoch


# ── Helper ─────────────────────────────────────────────────────────────────

def _get_client_ip(request: Request) -> str:
    """Estrai il client IP reale (dietro reverse proxy)."""
    ip = request.headers.get("X-Real-IP")
    if not ip:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
    if not ip:
        ip = request.client.host if request.client else "unknown"
    return ip


def _get_limits(method: str, path: str) -> tuple[int, int]:
    """Trova il limite per questo method:path."""
    key = f"{method}:{path}"
    if key in RATE_LIMITS:
        return RATE_LIMITS[key]

    # Cerca per prefisso
    for prefix, limits in RATE_LIMITS.items():
        if key.startswith(prefix):
            return limits

    if method == "GET":
        return DEFAULT_GET_LIMIT
    return DEFAULT_POST_LIMIT


# ── Middleware ─────────────────────────────────────────────────────────────

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        global _redis_warned

        # Skip health checks
        if request.url.path.startswith("/health"):
            return await call_next(request)

        # Skip metrics
        if request.url.path == "/metrics":
            return await call_next(request)

        client_ip = _get_client_ip(request)
        method = request.method
        path = request.url.path
        max_req, window = _get_limits(method, path)

        # Rate limit key: rl:{ip}:{method}:{path_prefix}
        path_group = path.rsplit("/", 1)[0] if "/" in path[1:] else path
        rl_key = f"rl:{client_ip}:{method}:{path_group}"

        # Prova Redis, fallback in-memory
        try:
            allowed, remaining, reset_epoch = await _check_redis(
                rl_key, max_req, window,
            )
        except Exception:
            if not _redis_warned:
                logger.warning(
                    "Redis unavailable for rate limiting — using in-memory fallback"
                )
                _redis_warned = True
            allowed, remaining, reset_epoch = _memory_limiter.check(
                rl_key, max_req, window,
            )

        rate_headers = {
            "X-RateLimit-Limit": str(max_req),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(reset_epoch),
        }

        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "error": "RATE_LIMITED",
                    "message": "Troppe richieste. Riprova tra qualche secondo.",
                    "retry_after": window,
                },
                headers={
                    **rate_headers,
                    "Retry-After": str(window),
                },
            )

        response = await call_next(request)
        for k, v in rate_headers.items():
            response.headers[k] = v
        return response
