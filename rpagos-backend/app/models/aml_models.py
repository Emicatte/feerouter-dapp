"""
RSend AML Models — BlacklistedWallet table.

Separated from aml_service.py to avoid circular imports with db/session.py.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, String, DateTime, Boolean, Text, Integer

from app.models.db_models import Base


class BlacklistedWallet(Base):
    __tablename__ = "blacklisted_wallets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    address = Column(String(42), unique=True, nullable=False, index=True)
    reason = Column(Text, nullable=False)  # "OFAC SDN", "Tornado Cash", "Manual"
    source = Column(String(50), nullable=False)  # "ofac", "eu", "manual", "chainalysis"
    added_by = Column(String(42), nullable=True)  # chi ha aggiunto (per manual)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
