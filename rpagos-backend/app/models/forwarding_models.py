"""
RSend Backend — Forwarding Rules Model (Split Routing)

Supporta:
  - Single destination (100%)
  - Split routing (es. 70% wallet A, 30% wallet B)
  - Gas deduction proporzionale
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Float, Boolean, DateTime, Integer,
    Text, Index, Enum as SAEnum,
)
from app.models.db_models import Base
import enum


class GasStrategy(str, enum.Enum):
    fast = "fast"
    normal = "normal"
    slow = "slow"


class SweepStatus(str, enum.Enum):
    pending = "pending"
    executing = "executing"
    completed = "completed"
    failed = "failed"
    gas_too_high = "gas_too_high"


class ForwardingRule(Base):
    __tablename__ = "forwarding_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(64), nullable=False, index=True)
    source_wallet = Column(String(42), nullable=False, index=True)
    destination_wallet = Column(String(42), nullable=False)

    # ── Split Routing ─────────────────────────────────────
    split_enabled = Column(Boolean, default=False, nullable=False)
    split_percent = Column(Integer, default=100, nullable=False)  # % a destination_wallet
    split_destination = Column(String(42), nullable=True)         # secondo wallet

    # ── Condizioni ────────────────────────────────────────
    is_active = Column(Boolean, default=True, nullable=False)
    min_threshold = Column(Float, default=0.001, nullable=False)
    gas_strategy = Column(SAEnum(GasStrategy), default=GasStrategy.normal)
    max_gas_percent = Column(Float, default=10.0)

    # ── Token filter ──────────────────────────────────────
    token_address = Column(String(42), nullable=True)
    token_symbol = Column(String(16), default="ETH")
    chain_id = Column(Integer, default=8453, nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_fwd_source_active", "source_wallet", "is_active"),
    )


class SweepLog(Base):
    __tablename__ = "sweep_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    rule_id = Column(Integer, nullable=False, index=True)
    source_wallet = Column(String(42), nullable=False)
    destination_wallet = Column(String(42), nullable=False)

    # ── Split info ────────────────────────────────────────
    is_split = Column(Boolean, default=False)
    split_index = Column(Integer, default=0)  # 0=primary, 1=secondary
    split_percent = Column(Integer, default=100)

    amount_wei = Column(String(78), nullable=False)
    amount_human = Column(Float, nullable=False)
    token_symbol = Column(String(16), default="ETH")

    gas_used = Column(Integer, nullable=True)
    gas_price_gwei = Column(Float, nullable=True)
    gas_cost_eth = Column(Float, nullable=True)
    gas_percent = Column(Float, nullable=True)

    status = Column(SAEnum(SweepStatus), default=SweepStatus.pending)
    tx_hash = Column(String(66), nullable=True, unique=True)
    error_message = Column(Text, nullable=True)
    trigger_tx_hash = Column(String(66), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    executed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_sweep_status", "status", "created_at"),
    )