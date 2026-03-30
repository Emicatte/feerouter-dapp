"""
RPagos Backend — Configurazione Production-Ready.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Database ──────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://rpagos:password@localhost:5432/rpagos"

    # ── Redis Cache ───────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── Sicurezza ─────────────────────────────────────────
    hmac_secret: str = "change-me-in-production"

    # ── Alchemy ───────────────────────────────────────────
    alchemy_api_key: str = ""
    alchemy_webhook_secret: str = ""
    alchemy_auth_token: str = ""

    # ── Sweeper ──────────────────────────────────────────
    sweep_private_key: str = ""

    # ── Server ────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # ── CORS Origins (prod) ───────────────────────────────
    cors_origins: str = "https://fee-router-dapp.vercel.app,https://rpagos.io"

    # ── DAC8 Reporting ────────────────────────────────────
    dac8_reporting_entity_name: str = "RPagos S.r.l."
    dac8_reporting_entity_tin: str = "IT12345678901"
    dac8_reporting_country: str = "IT"
    dac8_fiscal_year: int = 2025

    # ── Anomaly Detection ─────────────────────────────────
    anomaly_z_score_threshold: float = 3.0
    anomaly_min_sample_size: int = 10

    # ── Telegram Bot ──────────────────────────────────────
    telegram_bot_token: str = ""

    # ── Monitoring ────────────────────────────────────────
    sentry_dsn: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
