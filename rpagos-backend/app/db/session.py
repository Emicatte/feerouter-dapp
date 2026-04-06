"""
RSend Database Session — PostgreSQL only (production).
SQLite supportato SOLO per test unitari.
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from app.config import get_settings
from app.models.db_models import Base
from app.models import forwarding_models as _fwd_models   # noqa: F401 — registra tabelle forwarding in Base.metadata
from app.models import ledger_models as _ledger_models    # noqa: F401 — registra tabelle ledger in Base.metadata
from app.models import command_models as _cmd_models      # noqa: F401 — registra tabelle command center in Base.metadata
from app.models import aml_models as _aml_models            # noqa: F401 — registra tabella blacklisted_wallets in Base.metadata

settings = get_settings()

# Determina se siamo su SQLite (test) o PostgreSQL (prod)
_is_sqlite = "sqlite" in settings.database_url

if _is_sqlite:
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        connect_args={"check_same_thread": False},  # SQLite only
    )
else:
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        # ── Connection Pool (CRITICO per produzione) ──
        pool_size=20,            # connessioni permanenti
        max_overflow=30,         # connessioni extra sotto carico (totale max: 50)
        pool_timeout=30,         # secondi attesa per una connessione libera
        pool_recycle=3600,       # ricicla connessioni ogni ora (evita timeout PostgreSQL)
        pool_pre_ping=True,      # verifica connessione prima di usarla
    )

async_session = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def init_db() -> None:
    """Crea tabelle. In produzione usa Alembic."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Chiudi il pool di connessioni."""
    await engine.dispose()


async def get_db() -> AsyncSession:  # type: ignore[misc]
    """Dependency injection per FastAPI."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
