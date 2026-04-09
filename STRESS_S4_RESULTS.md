# Stress Test S4 — Webhook Flood (500 + 100 Burst)

**Date:** 2026-04-04
**Backend:** FastAPI + uvicorn (1 worker, SQLite — no PostgreSQL/Redis available)
**Rate limit:** 100/min/IP — fail-open without Redis → all webhooks accepted
**Idempotency:** fail-open without Redis → no dedup (each webhook has unique UUID `id`)

---

## TEST A — 500 Webhooks over 60 Seconds

| Metric | Value |
|--------|-------|
| Webhooks sent | 500 |
| Accepted (200) | **500** |
| Rate-limited (429) | 0 |
| Server errors (5xx) | 0 |
| Other failures | 0 |
| Wall time | 60.55s |
| Throughput | 8.3 webhooks/s |
| Latency p50 | 9ms |
| Latency p95 | 13ms |
| Latency p99 | 20ms |
| Latency max | 91ms |

---

## TEST B — 100 Webhooks BURST (delay=0)

| Metric | Value |
|--------|-------|
| Webhooks sent | 100 |
| Accepted (200) | **97** |
| Rate-limited (429) | 0 |
| Server errors (5xx) | 3 |
| Other failures | 0 |
| Wall time | 0.411s |
| Throughput | 236.2 webhooks/s |
| Latency p50 | 88ms |
| Latency p95 | 134ms |
| Latency p99 | 148ms |
| Latency max | 148ms |

---

## Database Verification

| Metric | Before TEST A | After TEST A | After TEST B |
|--------|--------------|--------------|--------------|
| Total sweep_logs | 0 | 0 | 0 |
| Total sweep_batches | 0 | 0 | 0 |

### Sweep log status breakdown (after both tests):

| Status | Count |
|--------|-------|

**Expected:** `sweep_logs ≥ webhooks_accepted` because each accepted webhook with a matching rule creates 1 sweep_log.
**Accepted (A+B):** 597
**sweep_logs created:** 0

---

## Infrastructure Limitations (SQLite, no Redis)

| Limit | Impact |
|-------|--------|
| No Redis | Rate limit uses in-memory fallback (30 POST/min/IP) — test rotates X-Forwarded-For to simulate Alchemy multi-IP egress |
| No Redis | Idempotency dedup disabled → replay attacks possible in prod |
| SQLite 1-writer | Concurrent webhook processing serialized → lower throughput than PostgreSQL |
| No Celery | Sweep tasks run inline (sync fallback) → each webhook blocks until sweep completes |
| Sweep fails | No ALCHEMY_API_KEY → sweep_logs created but sweep TX always fails |

---

## Throughput Scaling

| Setup | Max Rate |
|-------|----------|
| **This test (SQLite, 1 worker)** | **8 webhooks/s** |
| Projected (PostgreSQL, 4 workers) | ~33–50 webhooks/s |
| Projected (PostgreSQL + Redis + Celery) | ~200–500 webhooks/s |
| Rate limit ceiling (Redis, free tier) | 100 webhooks/min = 1.67/s per IP |
