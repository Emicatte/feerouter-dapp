"""
═══════════════════════════════════════════════════════════════
  RPagos Backend Core — Production Server

  Stack:
  - FastAPI + Uvicorn (4 workers)
  - PostgreSQL via asyncpg
  - Redis per cache + rate limiting + WS event buffer
  - Sentry per error tracking
  - Prometheus per metriche
  - WebSocket sweep feed (real-time)
═══════════════════════════════════════════════════════════════
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.session import init_db
from app.api.routes import router
from app.services.cache_service import close_redis
from app.services.polling_service import start_polling_if_needed, stop_polling
from app.api.websocket_routes import ws_router, feed_manager
from app.logging_config import setup_logging
from app.jobs.reconciliation_job import (
    start_reconciliation_job,
    stop_reconciliation_job,
    get_last_report,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown."""
    settings = get_settings()

    # ── Structured JSON logging ─────────────────────
    setup_logging(debug=settings.debug)

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

    # ── Start WebSocket background tasks ─────────────
    feed_manager.start_background_tasks()

    # ── Start block polling if webhook not configured ──
    poller = await start_polling_if_needed()

    # ── Start reconciliation job ────────────────────
    start_reconciliation_job()

    webhook_mode = "webhook" if settings.alchemy_webhook_secret else "polling"
    db_display = settings.database_url.split("@")[-1] if "@" in settings.database_url else settings.database_url
    logger.info(
        "RPagos Backend Core started",
        extra={
            "mode": "DEV" if settings.debug else "PRODUCTION",
            "db": db_display,
            "redis": settings.redis_url,
            "sentry": bool(settings.sentry_dsn),
            "tx_detection": webhook_mode,
            "dac8_entity": settings.dac8_reporting_entity_name,
        },
    )

    yield

    # Cleanup
    await stop_reconciliation_job()
    await stop_polling()
    await feed_manager.shutdown()
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
if settings.debug:
    cors_origins = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]
else:
    cors_origins = (
        [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
        if settings.cors_origins
        else ["https://rsends.io", "https://www.rsends.io"]
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request Context Middleware ──────────────────────────
from app.middleware.request_context import RequestContextMiddleware
app.add_middleware(RequestContextMiddleware)

# ── Input Sanitization Middleware ──────────────────────
from app.middleware.input_sanitization import InputSanitizationMiddleware
app.add_middleware(InputSanitizationMiddleware)

# ── Rate Limiting Middleware ─────────────────────────────
from app.middleware.rate_limit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware)

# ── Prometheus Metrics ───────────────────────────────────
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator(
        should_group_status_codes=True,
        should_group_untemplated=True,
        excluded_handlers=["/health", "/metrics", "/ws/*"],
    ).instrument(app).expose(app, endpoint="/metrics")
except ImportError:
    pass  # Skip if not installed

# ── Routes ───────────────────────────────────────────────
app.include_router(router)
from app.api.sweeper_routes import sweeper_router
app.include_router(sweeper_router)
app.include_router(ws_router)
from app.api.audit_routes import audit_router
app.include_router(audit_router)


# ── Health checks ────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "rpagos-backend-core",
        "version": "2.0.0",
        "ws_connections": feed_manager.active_connections,
    }


@app.get("/health/live")
async def health_live():
    """Liveness probe: 200 se il processo è vivo (per container orchestrator)."""
    return {"status": "alive"}


@app.get("/health/ready")
async def health_ready():
    """Readiness probe: 200 se DB e Redis raggiungibili (per load balancer)."""
    from fastapi.responses import JSONResponse
    from app.db.session import engine
    from app.services.cache_service import get_redis

    checks = {"db": False, "redis": False}

    # DB check
    try:
        async with engine.connect() as conn:
            from sqlalchemy import text
            await conn.execute(text("SELECT 1"))
        checks["db"] = True
    except Exception as e:
        logger.warning("Readiness: DB check failed: %s", e)

    # Redis check
    try:
        r = await get_redis()
        await r.ping()
        checks["redis"] = True
    except Exception as e:
        logger.warning("Readiness: Redis check failed: %s", e)

    ready = all(checks.values())
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )


@app.get("/health/dependencies")
async def health_dependencies():
    """External services health: circuit breaker states for all dependencies."""
    from app.services.external_health import get_dependency_summary
    return await get_dependency_summary()


@app.get("/health/deep")
async def health_deep():
    """Deep health check: risultati dell'ultima riconciliazione (per monitoring dashboard)."""
    report = get_last_report()
    if report is None:
        return {
            "ledger_balanced": None,
            "system_balanced": None,
            "stale_transactions": None,
            "last_reconciliation": None,
            "message": "No reconciliation run yet",
        }
    return {
        "ledger_balanced": report.ledger_balanced,
        "system_balanced": report.system_balanced,
        "stale_transactions": report.stale_transactions,
        "last_reconciliation": report.last_reconciliation.isoformat() if report.last_reconciliation else None,
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
