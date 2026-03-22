"""
RPagos Backend — Database Session Manager.

Supporta:
  - SQLite + aiosqlite (dev locale)
  - PostgreSQL + asyncpg (produzione)
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from app.config import get_settings
from app.models.db_models import Base

settings = get_settings()

if settings.database_url.startswith("sqlite"):
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        connect_args={"check_same_thread": False},
    )
else:
    # PostgreSQL con pool
    engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        pool_size=20,
        max_overflow=30,
        pool_timeout=30,
        pool_recycle=1800,
        pool_pre_ping=True,
    )

async_session = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def init_db() -> None:
    """Crea tabelle. In produzione usa Alembic."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    """Dependency injection per FastAPI."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
