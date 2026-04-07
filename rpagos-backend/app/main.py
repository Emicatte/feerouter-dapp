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

from app.config import get_settings, validate_settings
from app.db.session import init_db, close_db, async_session, _is_sqlite, engine
from app.api.routes import router
from app.services.cache_service import close_redis
from app.services.polling_service import start_polling_if_needed, stop_polling
from app.services.price_service import fetch_all_prices, price_refresh_loop
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

    # ── Validate critical env vars ──────────────────
    validate_settings(settings)

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

    # ── Verifica connessione DB ─────────────────────
    from sqlalchemy import text
    try:
        async with async_session() as test_db:
            await test_db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = f"ERROR: {e}"
        if not settings.debug:
            raise SystemExit(f"Cannot connect to database: {e}")

    if _is_sqlite:
        pool_display = "SQLite (test only)"
    else:
        pool_display = f"{engine.pool.size()}/{engine.pool.size() + engine.pool.overflow()}"

    logger.info("DB status: %s | Pool: %s", db_status, pool_display)

    # ── Verifica connessione Redis ──────────────────
    from app.services.cache_service import get_redis, is_redis_healthy
    try:
        r = await get_redis()
        if r:
            await r.ping()
            redis_status = "connected"
        else:
            redis_status = "NOT CONFIGURED"
    except Exception as e:
        redis_status = f"ERROR: {e}"

    logger.info("Redis status: %s", redis_status)
    if redis_status != "connected":
        logger.warning(
            "Redis required for idempotency — webhooks will be rejected (fail-closed) without Redis"
        )

    # ── Start WebSocket background tasks ─────────────
    feed_manager.start_background_tasks()

    # ── Start block polling if webhook not configured ──
    poller = await start_polling_if_needed()

    # ── Start reconciliation job ────────────────────
    start_reconciliation_job()

    # ── Initialize NonceManager + gap detection ────
    try:
        from app.services.sweep_service import initialize_nonce_with_gap_detection
        nonce_state = await initialize_nonce_with_gap_detection(chain_id=8453)
        logger.info("NonceManager ready: %s", nonce_state)
    except Exception as e:
        logger.warning("NonceManager init skipped (Redis/RPC unavailable): %s", e)

    # ── Price service: initial fetch + background loop ──
    import asyncio as _aio
    try:
        await fetch_all_prices()
        _aio.create_task(price_refresh_loop())
        logger.info("Price service started (interval=%ds)", 60)
    except Exception as e:
        logger.warning("Price service init failed: %s — prices will be unavailable", e)

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
    await close_db()
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
        "http://localhost:3001",
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

# ── Idempotency Middleware ──────────────────────────────
from app.middleware.idempotency import IdempotencyMiddleware
app.add_middleware(IdempotencyMiddleware)

# ── Global Error Handler ───────────────────────────────
from app.middleware.error_handler import ErrorHandlerMiddleware
app.add_middleware(ErrorHandlerMiddleware)

# ── API Key Authentication (production only) ───────────
from app.middleware.api_auth import APIKeyMiddleware
app.add_middleware(APIKeyMiddleware)

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
from app.api.distribution_routes import distribution_router
app.include_router(distribution_router)
app.include_router(ws_router)
from app.api.audit_routes import audit_router
app.include_router(audit_router)
from app.api.ledger_routes import ledger_router
app.include_router(ledger_router)
from app.api.price_routes import price_router
app.include_router(price_router)


# ── Health checks ────────────────────────────────────────
@app.get("/health")
async def health():
    from app.services.cache_service import is_redis_healthy
    redis_ok = await is_redis_healthy()
    return {
        "status": "healthy" if redis_ok else "degraded",
        "service": "rpagos-backend-core",
        "version": "2.0.0",
        "redis": "connected" if redis_ok else "disconnected",
        "idempotency": "active" if redis_ok else "FAIL-CLOSED (webhooks rejected)",
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


@app.get("/health/rpc")
async def health_rpc():
    """RPC provider health: per-chain provider status, block heights, circuit states."""
    from app.services.rpc_manager import get_rpc_manager
    chains = {8453: "base_mainnet", 84532: "base_sepolia", 1: "ethereum", 42161: "arbitrum"}
    return {
        label: get_rpc_manager(chain_id).info()
        for chain_id, label in chains.items()
    }


@app.get("/health/sweep")
async def health_sweep():
    """Full system health check for sweep pipeline.

    Validates: DB, Redis, Celery workers, circuit breakers,
    hot wallet balance, spending policy, WebSocket manager.
    Returns 503 if any critical component is unhealthy.
    """
    from fastapi.responses import JSONResponse
    from app.db.session import engine
    from app.services.cache_service import get_redis
    from app.services.circuit_breaker import get_all_circuit_breakers
    from app.services.external_health import get_dependency_summary

    checks: dict = {}
    critical_ok = True

    # ── 1. Database ──────────────────────────────────────
    try:
        async with engine.connect() as conn:
            from sqlalchemy import text
            await conn.execute(text("SELECT 1"))
        checks["db"] = {"status": "ok"}
    except Exception as e:
        checks["db"] = {"status": "error", "detail": str(e)[:200]}
        critical_ok = False

    # ── 2. Redis ─────────────────────────────────────────
    try:
        r = await get_redis()
        info = await r.info("server")
        await r.ping()
        checks["redis"] = {
            "status": "ok",
            "version": info.get("redis_version", "?"),
        }
    except Exception as e:
        checks["redis"] = {"status": "error", "detail": str(e)[:200]}
        critical_ok = False

    # ── 3. Celery workers ────────────────────────────────
    try:
        from app.celery_app import celery as celery_app
        inspector = celery_app.control.inspect(timeout=3)
        active = inspector.active_queues() or {}
        worker_count = len(active)
        queues_found = set()
        for queues in active.values():
            for q in queues:
                queues_found.add(q.get("name", "?"))
        checks["celery"] = {
            "status": "ok" if worker_count > 0 else "warn",
            "workers": worker_count,
            "queues": sorted(queues_found),
        }
        if worker_count == 0:
            checks["celery"]["detail"] = "no workers responding"
    except Exception as e:
        checks["celery"] = {"status": "warn", "detail": str(e)[:200]}

    # ── 4. Circuit breakers ──────────────────────────────
    try:
        cbs = get_all_circuit_breakers()
        open_cbs = [
            name for name, cb in cbs.items()
            if cb.state.value == "open"
        ]
        checks["circuit_breakers"] = {
            "status": "warn" if open_cbs else "ok",
            "total": len(cbs),
            "open": open_cbs,
        }
    except Exception as e:
        checks["circuit_breakers"] = {"status": "error", "detail": str(e)[:200]}

    # ── 5. Hot wallet ────────────────────────────────────
    try:
        from app.services.wallet_manager import get_wallet_manager
        wm = get_wallet_manager(8453)
        balance = await wm.get_hot_balance()
        balance_eth = balance / 10**18
        needs_refill = await wm.needs_refill()
        checks["hot_wallet"] = {
            "status": "warn" if needs_refill else "ok",
            "balance_eth": round(balance_eth, 6),
            "needs_refill": needs_refill,
        }
    except Exception as e:
        checks["hot_wallet"] = {"status": "unknown", "detail": str(e)[:200]}

    # ── 6. WebSocket connections ─────────────────────────
    checks["websocket"] = {
        "status": "ok",
        "active_connections": feed_manager.active_connections,
    }

    # ── 7. Notification service ──────────────────────────
    settings_obj = get_settings()
    checks["notifications"] = {
        "status": "ok" if settings_obj.telegram_bot_token else "unconfigured",
        "telegram_configured": bool(settings_obj.telegram_bot_token and settings_obj.telegram_chat_id),
    }

    all_ok = critical_ok and not any(
        c.get("status") == "error" for c in checks.values()
    )

    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={
            "status": "healthy" if all_ok else "degraded",
            "service": "rpagos-sweep-pipeline",
            "checks": checks,
        },
    )


@app.get("/health/config")
async def health_config():
    """Configuration status: which env vars are set (values never exposed)."""
    settings = get_settings()
    is_prod = not settings.debug

    def _check(val: str, required: bool = False, prod_only: bool = False) -> str:
        has_value = bool(val and val not in (
            "change-me-in-production",
            "change_this_to_random_string",
        ))
        if has_value:
            return "ok"
        if required and (not prod_only or is_prod):
            return "MISSING"
        return "not_set"

    return {
        "environment": "production" if is_prod else "development",
        "vars": {
            "DATABASE_URL": _check(settings.database_url, required=True),
            "REDIS_URL": _check(settings.redis_url, required=True, prod_only=True),
            "ALCHEMY_API_KEY": _check(settings.alchemy_api_key, required=True),
            "ALCHEMY_WEBHOOK_SECRET": _check(settings.alchemy_webhook_secret),
            "SWEEP_PRIVATE_KEY": _check(
                settings.sweep_private_key,
                required=(settings.signer_mode == "local"),
            ),
            "SIGNER_MODE": settings.signer_mode,
            "KMS_KEY_ID": _check(
                settings.kms_key_id,
                required=(settings.signer_mode == "kms"),
            ),
            "HMAC_SECRET": _check(settings.hmac_secret, required=True, prod_only=True),
            "TELEGRAM_BOT_TOKEN": _check(settings.telegram_bot_token),
            "TELEGRAM_CHAT_ID": _check(settings.telegram_chat_id),
            "SENTRY_DSN": _check(settings.sentry_dsn),
            "DEBUG": settings.debug,
        },
    }


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
