"""
═══════════════════════════════════════════════════════════════
  RPagos Backend Core — Compliance & Data Engine
  
  Micro-servizio per:
  • Ricezione callback transazioni Web3 (da TransactionStatus.tsx)
  • Validazione HMAC-SHA256
  • Persistenza su PostgreSQL
  • Analisi anomalie (stile radioastronomia)
  • Generazione report XML DAC8/CARF
═══════════════════════════════════════════════════════════════
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.session import init_db
from app.api.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown: crea le tabelle al boot (dev mode)."""
    settings = get_settings()
    if settings.debug:
        await init_db()
        print("═" * 60)
        print("  RPagos Backend Core — DEV MODE")
        print(f"  DB: {settings.database_url}")
        print(f"  DAC8 Entity: {settings.dac8_reporting_entity_name}")
        print("═" * 60)
    yield


app = FastAPI(
    title="RPagos Backend Core",
    description=(
        "Compliance & Data Engine per transazioni Web3. "
        "Riceve callback dal frontend, valida HMAC, persiste i dati "
        "e genera report fiscali DAC8/CARF."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS (permetti il frontend in dev) ───────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ───────────────────────────────────────────────────
app.include_router(router)


# ── Health check ─────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "rpagos-backend-core",
        "version": "1.0.0",
    }


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
