"""
RPagos Backend Core — Database Session Manager.

Gestione asincrona della connessione al DB.
In dev usa SQLite; in prod PostgreSQL via asyncpg.
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from app.config import get_settings
from app.models.db_models import Base

settings = get_settings()

# Per SQLite asincrono serve aiosqlite
if settings.database_url.startswith("sqlite"):
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        pool_size=10,
        max_overflow=20,
    )

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    """Crea tutte le tabelle (dev only — in prod usa Alembic)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    """Dependency injection per FastAPI."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
