"""
═══════════════════════════════════════════════════════════════
  RPagos Backend Core — Production Server

  Stack:
  • FastAPI + Uvicorn (4 workers)
  • PostgreSQL via asyncpg
  • Redis per cache + rate limiting
  • Sentry per error tracking
  • Prometheus per metriche
═══════════════════════════════════════════════════════════════
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.session import init_db
from app.api.routes import router
from app.services.cache_service import close_redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown."""
    settings = get_settings()

    # ── Sentry ───────────────────────────────────────
    if settings.sentry_dsn:
        import sentry_sdk
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            traces_sample_rate=0.2,
            profiles_sample_rate=0.1,
            environment="production" if not settings.debug else "development",
        )

    # ── Init DB ──────────────────────────────────────
    await init_db()

    print("═" * 60)
    print("  RPagos Backend Core")
    print(f"  Mode: {'DEV' if settings.debug else 'PRODUCTION'}")
    print(f"  DB: {settings.database_url.split('@')[-1] if '@' in settings.database_url else settings.database_url}")
    print(f"  Redis: {settings.redis_url}")
    print(f"  Sentry: {'✓' if settings.sentry_dsn else '✗'}")
    print(f"  DAC8 Entity: {settings.dac8_reporting_entity_name}")
    print("═" * 60)

    yield

    # Cleanup
    await close_redis()


app = FastAPI(
    title="RPagos Backend Core",
    description="Compliance & Data Engine per transazioni Web3.",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs" if get_settings().debug else None,  # Nascondi Swagger in prod
    redoc_url=None,
)

# ── CORS ─────────────────────────────────────────────────
settings = get_settings()
origins = settings.cors_origins.split(",") if settings.cors_origins else []
if settings.debug:
    origins.extend(["http://localhost:3000", "http://localhost:5173"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate Limiting Middleware ─────────────────────────────
from app.middleware.rate_limit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware)

# ── Prometheus Metrics ───────────────────────────────────
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator(
        should_group_status_codes=True,
        should_group_untemplated=True,
        excluded_handlers=["/health", "/metrics"],
    ).instrument(app).expose(app, endpoint="/metrics")
except ImportError:
    pass  # Skip if not installed

# ── Routes ───────────────────────────────────────────────
app.include_router(router)


# ── Health check ─────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "rpagos-backend-core",
        "version": "2.0.0",
    }


if __name__ == "__main__":
    import uvicorn
    s = get_settings()
    uvicorn.run(
        "app.main:app",
        host=s.host,
        port=s.port,
        reload=s.debug,
        workers=1 if s.debug else 4,
    )
