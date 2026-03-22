"""
RPagos Backend Core — Configurazione centralizzata.

Carica variabili da .env e le valida con Pydantic v2.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Database ──────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./rpagos_dev.db"

    # ── Sicurezza ─────────────────────────────────────────────
    hmac_secret: str = "dev-secret-change-me"

    # ── Server ────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

    # ── DAC8 Reporting ────────────────────────────────────────
    dac8_reporting_entity_name: str = "RPagos S.r.l."
    dac8_reporting_entity_tin: str = "IT12345678901"
    dac8_reporting_country: str = "IT"
    dac8_fiscal_year: int = 2025

    # ── Anomaly Detection ─────────────────────────────────────
    anomaly_z_score_threshold: float = 3.0
    anomaly_min_sample_size: int = 10

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
