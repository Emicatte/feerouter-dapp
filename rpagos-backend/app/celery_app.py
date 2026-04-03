"""
RSend Backend — Celery Application Configuration.

Broker: Redis (DB 1)
Result backend: Redis (DB 2)

Task routes:
  sweep.*     → queue "sweep"    (8 workers)
  confirm.*   → queue "confirm"  (4 workers)
  notify.*    → queue "notify"   (2 workers)
  analytics.* → queue "analytics" (1 worker)

Settings:
  acks_late=True          — ack after execution (at-least-once)
  reject_on_worker_lost   — requeue if worker crashes mid-task
  prefetch_multiplier=1   — no prefetch; one task at a time per worker
"""

from celery import Celery
from celery.schedules import crontab

from app.config import get_settings

settings = get_settings()

celery = Celery(
    "rsend",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

# ═══════════════════════════════════════════════════════════════
#  Core Settings
# ═══════════════════════════════════════════════════════════════

celery.conf.update(
    # Serialization
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,

    # Reliability
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,

    # Result expiry (24h)
    result_expires=86400,

    # Broker settings
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "visibility_timeout": 3600,  # 1h — must be > longest task
    },

    # Task routing
    task_routes={
        "app.tasks.sweep_tasks.process_incoming_tx": {"queue": "sweep"},
        "app.tasks.sweep_tasks.execute_distribution": {"queue": "sweep"},
        "app.tasks.sweep_tasks.confirm_tx": {"queue": "confirm"},
        "app.tasks.periodic_tasks.update_gas_oracle": {"queue": "analytics"},
        "app.tasks.periodic_tasks.check_stale_batches": {"queue": "sweep"},
        "app.tasks.periodic_tasks.check_hot_wallet": {"queue": "sweep"},
        "app.tasks.periodic_tasks.aggregate_daily_stats": {"queue": "analytics"},
        "app.tasks.periodic_tasks.cleanup_old_locks": {"queue": "analytics"},
    },

    # Default queue for unrouted tasks
    task_default_queue="default",

    # Task discovery
    include=[
        "app.tasks.sweep_tasks",
        "app.tasks.periodic_tasks",
    ],
)

# ═══════════════════════════════════════════════════════════════
#  Celery Beat Schedule
# ═══════════════════════════════════════════════════════════════

celery.conf.beat_schedule = {
    "update-gas-oracle": {
        "task": "app.tasks.periodic_tasks.update_gas_oracle",
        "schedule": 10.0,  # every 10 seconds
    },
    "check-stale-batches": {
        "task": "app.tasks.periodic_tasks.check_stale_batches",
        "schedule": 120.0,  # every 2 minutes
    },
    "check-hot-wallet": {
        "task": "app.tasks.periodic_tasks.check_hot_wallet",
        "schedule": 300.0,  # every 5 minutes
    },
    "aggregate-daily-stats": {
        "task": "app.tasks.periodic_tasks.aggregate_daily_stats",
        "schedule": crontab(hour=0, minute=5),  # daily 00:05 UTC
    },
    "cleanup-old-locks": {
        "task": "app.tasks.periodic_tasks.cleanup_old_locks",
        "schedule": 600.0,  # every 10 minutes
    },
}
