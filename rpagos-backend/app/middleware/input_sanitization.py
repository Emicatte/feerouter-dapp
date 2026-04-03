"""
RPagos Backend — Input Sanitization Middleware

- Rifiuta payload > 1MB con 413
- Logga tentativi di payload oversized
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

MAX_PAYLOAD_BYTES = 1_048_576  # 1 MB


class InputSanitizationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Solo per richieste con body (POST, PUT, PATCH)
        if request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length")

            if content_length and int(content_length) > MAX_PAYLOAD_BYTES:
                client_ip = request.headers.get(
                    "X-Real-IP",
                    request.headers.get(
                        "X-Forwarded-For",
                        request.client.host if request.client else "unknown",
                    ),
                )
                logger.warning(
                    "Oversized payload rejected: %s bytes from %s on %s",
                    content_length, client_ip, request.url.path,
                )
                return JSONResponse(
                    status_code=413,
                    content={
                        "error": "PAYLOAD_TOO_LARGE",
                        "message": f"Il payload supera il limite di {MAX_PAYLOAD_BYTES} bytes.",
                        "max_bytes": MAX_PAYLOAD_BYTES,
                    },
                )

        return await call_next(request)
