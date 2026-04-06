"""API Key Authentication Middleware — optional layer, enabled in production."""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from app.security.api_keys import verify_api_key, is_exempt
from app.config import get_settings


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        settings = get_settings()

        # Skip in debug mode
        if settings.debug:
            return await call_next(request)

        # Skip exempt paths
        if is_exempt(request.url.path):
            return await call_next(request)

        # Skip GET requests (public read access)
        if request.method == "GET":
            return await call_next(request)

        client = await verify_api_key(request)
        if client is None:
            return JSONResponse(
                status_code=401,
                content={"error": "INVALID_API_KEY", "message": "Valid API key required"}
            )

        # Attach client info to request state
        request.state.client = client
        return await call_next(request)
