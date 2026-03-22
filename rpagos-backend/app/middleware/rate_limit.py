"""
RPagos Backend — Rate Limiting Middleware

Middleware FastAPI che usa Redis per limitare le richieste per IP.
Fallback permissivo se Redis non è disponibile.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services.cache_service import check_rate_limit


# Limiti per endpoint
RATE_LIMITS = {
    "/api/v1/tx/callback":   (10, 60),    # 10 req/min
    "/api/v1/dac8/generate": (5, 60),     # 5 req/min
    "/api/v1/anomalies":     (20, 60),    # 20 req/min
    "/api/v1/tx/recent":     (30, 60),    # 30 req/min
}
DEFAULT_LIMIT = (60, 60)  # 60 req/min per tutto il resto


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip health check
        if request.url.path == "/health":
            return await call_next(request)

        # Identifica il client
        client_ip = request.headers.get(
            "X-Real-IP",
            request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
        )

        # Trova il limite per questo endpoint
        path = request.url.path
        max_req, window = DEFAULT_LIMIT
        for prefix, limits in RATE_LIMITS.items():
            if path.startswith(prefix):
                max_req, window = limits
                break

        # Check rate limit
        identifier = f"{client_ip}:{path.split('/')[3] if len(path.split('/')) > 3 else 'general'}"
        allowed, remaining = await check_rate_limit(identifier, max_req, window)

        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "error": "RATE_LIMITED",
                    "message": "Troppe richieste. Riprova tra qualche secondo.",
                    "retry_after": window,
                },
                headers={
                    "Retry-After": str(window),
                    "X-RateLimit-Remaining": "0",
                },
            )

        # Procedi con la richiesta
        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
