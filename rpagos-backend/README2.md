# RPagos Backend Core — Compliance, Data Engine & Merchant B2B API

Python/FastAPI backend for RSend: transaction processing, auto-forwarding, cross-chain execution, AML screening, signing protection, double-entry ledger, DAC8 compliance, and merchant B2B API.

## Stack

| Component | Technology | Purpose |
|---|---|---|
| Framework | FastAPI + Uvicorn | Async API server (4 workers prod) |
| Validation | Pydantic v2 | Schema validation |
| Database | SQLAlchemy 2.0 + asyncpg | Async ORM + PostgreSQL |
| Migrations | Alembic | 15 versioned migrations |
| Cache | Redis + hiredis | Rate limiting, idempotency, nonce dedup |
| Task Queue | Celery | Async background tasks |
| Signing | eth-account + boto3 (KMS) | Local key / AWS KMS / Vault |
| Monitoring | Prometheus + Sentry + OpenTelemetry | Metrics, errors, tracing |
| Anomaly | SciPy + Pandas | Statistical z-score detection |
| Compliance | lxml | DAC8/CARF XML reports |
| Alerts | httpx | Telegram bot + webhook notifications |
| Tests | pytest + httpx | Async end-to-end tests |

## Architecture

```
rpagos-backend/
├── app/
│   ├── main.py                    # FastAPI app + lifespan + health checks
│   ├── config.py                  # Pydantic Settings (.env)
│   ├── celery_app.py              # Celery config + correlation propagation
│   ├── logging_config.py          # Structured JSON logging
│   ├── observability.py           # OpenTelemetry setup
│   │
│   ├── api/
│   │   ├── routes.py              # TX callback, anomalies, DAC8
│   │   ├── merchant_routes.py     # B2B merchant API (payment intents, webhooks)
│   │   ├── sweeper_routes.py      # Sweep operations + Alchemy webhooks
│   │   ├── distribution_routes.py # Batch distribution
│   │   ├── execution_routes.py    # Cross-chain engine
│   │   ├── strategy_routes.py     # Conditional automation DSL
│   │   ├── split_routes.py        # Multi-wallet split contracts
│   │   ├── signing_routes.py      # Signing guard + audit (internal)
│   │   ├── aml_routes.py          # AML check + admin panel
│   │   ├── health_routes.py       # /health/deep (5-component)
│   │   ├── ledger_routes.py       # Double-entry ledger
│   │   ├── audit_routes.py        # Audit trail
│   │   ├── price_routes.py        # Token prices
│   │   └── websocket_routes.py    # Real-time sweep feed
│   │
│   ├── models/
│   │   ├── db_models.py           # TransactionLog, ComplianceSnapshot
│   │   ├── forwarding_models.py   # ForwardingRule, SweepLog
│   │   ├── ledger_models.py       # Account, LedgerEntry (double-entry)
│   │   ├── command_models.py      # DistributionList, SweepBatch
│   │   ├── split_models.py        # SplitContract, SplitExecution
│   │   ├── strategy_models.py     # Strategy (conditions + actions)
│   │   ├── merchant_models.py     # PaymentIntent, MerchantWebhook
│   │   ├── aml_models.py          # SanctionEntry, AMLAlert, AMLConfig
│   │   ├── signing_models.py      # SigningAuditLog (immutable)
│   │   ├── kms_models.py          # KMSAuditLog (immutable)
│   │   └── schemas.py             # Pydantic request/response
│   │
│   ├── services/
│   │   ├── execution_engine.py    # Cross-chain pipeline + dependency guard
│   │   ├── strategy_engine.py     # Condition evaluator
│   │   ├── sweep_service.py       # Sweep orchestration + AML screening
│   │   ├── split_executor.py      # Split plan execution + AML gate
│   │   ├── split_engine.py        # BPS calculation engine
│   │   ├── distribution_service.py
│   │   ├── ledger_service.py      # Double-entry bookkeeping
│   │   ├── reconciliation_service.py
│   │   ├── webhook_service.py     # Merchant webhook delivery + retry
│   │   ├── aml_service.py         # 3-level AML (screening + monitoring + reporting)
│   │   ├── aml_exceptions.py      # AMLBlockedError, AMLReviewRequired
│   │   ├── anomaly_service.py     # Statistical z-score detection
│   │   ├── circuit_breaker.py     # Redis-backed CB + DependencyGuard + alerts
│   │   ├── alert_service.py       # Telegram/webhook alerts + cooldown
│   │   ├── signing_audit.py       # Immutable signing audit log
│   │   ├── signing_rate_limit.py  # Redis-backed signing rate limits
│   │   ├── key_manager.py         # KMS/Local/Vault signers + hardening
│   │   ├── cache_service.py       # Redis connection + health
│   │   ├── nonce_manager.py       # Nonce allocation + gap detection
│   │   ├── wallet_manager.py      # Hot wallet balance + refill
│   │   ├── rpc_manager.py         # Multi-provider RPC + circuit breakers
│   │   ├── gas_estimator.py       # Gas price estimation
│   │   ├── price_service.py       # Token price feeds
│   │   ├── notification_service.py # Telegram notifications
│   │   ├── idempotency_service.py # Redis-backed dedup
│   │   └── spending_policy.py     # Reserve/release policy
│   │
│   ├── middleware/
│   │   ├── correlation.py         # X-Correlation-ID (contextvars)
│   │   ├── structured_logging.py  # JSON formatter + TimedOperation
│   │   ├── rate_limit.py          # Global rate limiting
│   │   ├── idempotency.py         # Idempotency key middleware
│   │   ├── input_sanitization.py  # XSS/injection protection
│   │   ├── api_auth.py            # API key authentication
│   │   ├── error_handler.py       # Global error handler
│   │   └── request_context.py     # Request context propagation
│   │
│   ├── security/
│   │   ├── auth.py
│   │   ├── api_keys.py
│   │   ├── input_validator.py
│   │   └── webhook_verifier.py
│   │
│   ├── tasks/                     # Celery async tasks
│   │   ├── sweep_tasks.py
│   │   ├── webhook_tasks.py
│   │   ├── periodic_tasks.py
│   │   └── notification_tasks.py
│   │
│   └── jobs/
│       └── reconciliation_job.py
│
├── alembic/                       # DB migrations
│   ├── env.py
│   └── versions/
│       ├── 0001_initial_double_entry.py
│       ├── ...
│       ├── 0013_signing_audit_log.py
│       ├── 0014_aml_tables.py
│       └── 0015_kms_audit_log.py
│
├── infrastructure/
│   └── kms_policy.json            # AWS KMS IAM policy
│
├── data/
│   └── sanctions/
│       └── ofac_sdn.json          # OFAC SDN sanctioned addresses (23 entries)
│
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

## Quick Start

```bash
# 1. Install
cd rpagos-backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 2. Configure
cp .env.example .env
# Fill in: DATABASE_URL, REDIS_URL, ALCHEMY_API_KEY, SWEEP_PRIVATE_KEY, HMAC_SECRET

# 3. Database
alembic upgrade head

# 4. Run (dev mode)
python -m uvicorn app.main:app --reload
# -> http://localhost:8000
# -> Swagger docs: http://localhost:8000/docs (DEBUG=true only)

# 5. Test
pytest -v
```

## API Endpoints

### Transactions
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/tx/callback` | Alchemy webhook callback (HMAC verified) |
| GET | `/api/v1/tx/{fiscal_ref}` | Get transaction by fiscal ref |

### Forwarding & Sweeps
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/sweep/rules` | Create forwarding rule |
| GET | `/api/v1/sweep/rules` | List rules for owner |
| POST | `/api/v1/sweep/execute` | Trigger sweep execution |
| WS | `/ws/sweep-feed` | Real-time sweep events |

### Cross-Chain Execution
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/execution/plan` | Create execution plan (dry-run) |
| POST | `/api/v1/execution/plan/{id}/execute` | Execute plan |
| GET | `/api/v1/execution/plan/{id}` | Get plan status |

### Strategies (Conditional Automation)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/strategies/` | Create conditional strategy |
| GET | `/api/v1/strategies/` | List strategies for owner |
| PATCH | `/api/v1/strategies/{id}` | Update strategy |
| DELETE | `/api/v1/strategies/{id}` | Delete strategy |
| POST | `/api/v1/strategies/simulate` | Dry-run condition test |

### Merchant B2B API
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/merchant/payment-intent` | Create payment intent |
| GET | `/api/v1/merchant/payment-intent/{id}` | Get intent status |
| POST | `/api/v1/merchant/webhook/register` | Register webhook URL |
| POST | `/api/v1/merchant/webhook/test` | Send test event |
| GET | `/api/v1/merchant/transactions` | List merchant transactions |

### Signing Guard (internal API, called by oracle)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/internal/signing/check` | Pre-signing validation (rate limit, nonce, chain, amount, deadline) |
| POST | `/api/internal/signing/audit` | Write to immutable signing audit log |

### AML (Anti-Money Laundering)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/aml/check` | Full AML check (screening + monitoring) |
| GET | `/admin/aml/alerts` | List alerts (filter by status/sender, paginated) |
| POST | `/admin/aml/alerts/{id}/review` | Review alert (reviewed/escalated/dismissed) |
| POST | `/admin/aml/sanctions/update` | Upload sanctions list or load built-in OFAC file |
| GET | `/admin/aml/stats` | 24h alert statistics |

### Compliance
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/anomalies` | List anomaly alerts (z-score) |
| POST | `/api/v1/dac8/generate` | Generate DAC8 XML report |

### Health & Monitoring
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Basic health + Redis status |
| GET | `/health/live` | Liveness probe (container orchestrator) |
| GET | `/health/ready` | Readiness probe (DB + Redis) |
| GET | `/health/deep` | 5-component check (Postgres, Redis, Celery, RPC, KMS) |
| GET | `/health/sweep` | Full sweep pipeline health |
| GET | `/health/rpc` | Per-chain RPC provider status |
| GET | `/health/dependencies` | Circuit breaker states |
| GET | `/health/config` | Env var audit (values never exposed) |
| GET | `/health/reconciliation` | Last reconciliation report |
| GET | `/metrics` | Prometheus metrics |

## Security Architecture

### Signing Protection
- Oracle signing guard validates chain, recipient, amount bounds ($0.01-$100K), deadline (max 10min)
- Per-wallet rate limiting: 10/min, 50/hr (Redis INCR+EXPIRE)
- Per-IP rate limiting: 20/min; global: 100/min
- Server-side nonce deduplication via Redis SETNX (1h TTL)
- Immutable audit log: every signing request (approved/denied) in Postgres

### KMS Hardening
- IAM policy restricts `kms:Sign` to backend role only (`ECDSA_SHA_256`)
- Destructive operations (`ScheduleKeyDeletion`, `DisableKey`) require MFA + admin role
- Local rate limiter (60/min, 500/hr) as defence-in-depth
- Every KMS operation logged to `kms_audit_log` table
- Key rotation: sign with active key, verify with active + all previous keys

### AML (3-Level)
1. **Address Screening** (blocks transaction): OFAC SDN, EU sanctions, local DB, hardcoded list
2. **Transaction Monitoring** (flags for review): single >EUR1K, daily >EUR5K, monthly >EUR15K (DAC8 KYC), velocity >10/h, structuring detection
3. **Reporting**: AML alerts persisted for compliance officer review

### Split AML Gate
- Pre-execution: screens ALL recipients against sanctions; blocks entire plan if any hit
- Anti-structuring: detects >70% of amounts near threshold, >5 recipients, aggregate evasion

### Circuit Breakers
- Redis-backed with Lua atomic state transitions
- Per-chain RPC circuit breakers
- **Fail-closed for financial ops**: sweep/transfer/execution blocked when Redis/Postgres/RPC down
- Fail-open for read ops (cached data degradation)

## Alert Service

Immediate notifications for critical events via Telegram bot and/or webhook.

| Alert Type | Severity | Trigger |
|---|---|---|
| `signing_down` | EMERGENCY | Circuit breaker opened on signing path |
| `kms_rate_limit` | CRITICAL | Local KMS rate limit exceeded |
| `redis_down` | EMERGENCY | Redis unreachable |
| `rpc_down` | WARNING | Chain RPC unreachable |
| `sweep_failed` | CRITICAL | Sweep execution failed |
| `aml_block` | INFO | Transaction blocked by AML |
| `balance_low` | WARNING | Master wallet below threshold |
| `cb_recovery` | INFO | Circuit breaker recovered |

Cooldown: EMERGENCY 1min, CRITICAL 5min, WARNING 15min, INFO 60min.

## Database Migrations

```bash
# Apply all migrations
alembic upgrade head

# Current migrations:
# 0001 — Double-entry ledger
# 0002 — Legacy forwarding tables
# 0003 — Command center models
# 0004 — Merchant B2B tables
# 0005 — Late payment policy
# 0006 — Matching v2 amount tracking
# 0007 — Deposit address chain matching
# 0008 — Sweep fields and statuses
# 0009 — Sweep dedup index
# 0010 — Split contracts tables
# 0011 — Daily snapshots and HMAC
# 0012 — Performance indexes
# 0013 — Signing audit log
# 0014 — AML tables (sanctions_list, aml_alerts, aml_config)
# 0015 — KMS audit log
```

## Environment Variables

See `.env.example` for full documentation. Key variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL async URL |
| `REDIS_URL` | Prod | Redis URL (cache, rate limit, idempotency) |
| `ALCHEMY_API_KEY` | Yes | Alchemy RPC |
| `SWEEP_PRIVATE_KEY` | Yes* | Hot wallet key (*unless SIGNER_MODE=kms) |
| `SIGNER_MODE` | No | `local` (default), `kms`, or `vault` |
| `KMS_KEY_ID` | If kms | AWS KMS key ID |
| `HMAC_SECRET` | Prod | >= 32 chars, webhook verification |
| `TELEGRAM_BOT_TOKEN` | No | Sweep notifications |
| `TELEGRAM_ALERT_CHAT_ID` | No | Critical alerts (separate from sweep chat) |
| `ALERT_WEBHOOK_URL` | No | Discord/Slack webhook for critical alerts |
| `SENTRY_DSN` | No | Error tracking |
| `OTEL_ENDPOINT` | No | OpenTelemetry OTLP gRPC endpoint |

## Production

```bash
# Docker
docker build -t rpagos-backend .
docker run -p 8000:8000 \
  -e DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/rpagos \
  -e REDIS_URL=redis://redis:6379/0 \
  -e HMAC_SECRET=your-64-char-hex-secret \
  rpagos-backend

# Docker Compose (PostgreSQL + Redis + Celery)
docker-compose up -d

# Load OFAC sanctions
curl -X POST http://localhost:8000/admin/aml/sanctions/update
```
