# Stress Test S4 — Webhook Flood (500 + 100 Burst)

**Date:** 2026-04-09
**Backend:** FastAPI + uvicorn (1 worker) + PostgreSQL 16 + Redis 7 + Celery (8 workers)
**Rate limit:** Redis-backed (100/min/IP)
**Idempotency:** Redis SETNX dedup active (each webhook has unique UUID `id`)

---

## TEST A — 500 Webhooks over 60 Seconds

| Metric | Value |
|--------|-------|
| Webhooks sent | 500 |
| Accepted (200) | **500** |
| Rate-limited (429) | 0 |
| Server errors (5xx) | 0 |
| Other failures | 0 |
| Wall time | 60.52s |
| Throughput | 8.3 webhooks/s |
| Latency p50 | 9ms |
| Latency p95 | 17ms |
| Latency p99 | 25ms |
| Latency max | 84ms |

---

## TEST B — 100 Webhooks BURST (delay=0)

| Metric | Value |
|--------|-------|
| Webhooks sent | 100 |
| Accepted (200) | **100** |
| Rate-limited (429) | 0 |
| Server errors (5xx) | 0 |
| Other failures | 0 |
| Wall time | 0.162s |
| Throughput | 616.4 webhooks/s |
| Latency p50 | 19ms |
| Latency p95 | 63ms |
| Latency p99 | 65ms |
| Latency max | 65ms |

---

## Database Verification

| Metric | Before TEST A | After TEST A | After TEST B | Final (30s settle) |
|--------|--------------|--------------|--------------|-------------------|
| Total sweep_logs | 0 | 500 | 600 | **600** |
| Total sweep_batches | 0 | 0 | 0 | 0 |
| Distinct trigger_tx_hash | — | — | — | **600** |

### Sweep log status breakdown (after settle):

| Status | Count |
|--------|-------|
| pending | 46 |
| failed | 554 |

**Accepted (A+B):** 600
**sweep_logs created:** 600
**Processing rate:** 100.0%
**Distinct tx hashes:** 600 (0 duplicates)

---

## Infrastructure Stack

| Component | Version/Config |
|-----------|---------------|
| FastAPI + uvicorn | 1 worker (single-process) |
| PostgreSQL | 16-alpine (asyncpg, pool_size=20, max_overflow=30) |
| Redis | 7-alpine (256MB, allkeys-lru) |
| Celery | 8 workers, queues: sweep+default+confirm |
| Rate limiting | Redis-backed, 100/min/IP |
| Idempotency | Redis SETNX, TTL-based dedup |
| Distributed locks | Redis SETNX, fail-closed |

---

## Throughput Comparison

| Setup | Throughput |
|-------|-----------|
| Previous (SQLite, no Redis, no Celery) | 8.3 webhooks/s |
| **This test (PostgreSQL + Redis + Celery)** | **8.3 webhooks/s** |
| Burst throughput (TEST B) | **616.4 webhooks/s** |
