# Architecture Security Review — RSend / RPagos Platform

**Date:** 2026-04-17
**Scope:** Full-stack architecture — smart contracts, backend API, infrastructure dependencies

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐     │
│  │ Merchant  │  │ Checkout UI  │  │ Command Center (React)│     │
│  │ Backend   │  │ (WebSocket)  │  │ SettingsTab / ApiDocs │     │
│  └────┬──────┘  └──────┬───────┘  └──────────┬────────────┘     │
│       │API Key         │WS                    │API Key          │
└───────┼────────────────┼──────────────────────┼─────────────────┘
        │                │                      │
┌───────▼────────────────▼──────────────────────▼─────────────────┐
│                     MIDDLEWARE STACK                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ CORS → Correlation → RequestCtx → InputSanitizer →       │   │
│  │ RateLimit → Idempotency → ErrorHandler → APIKeyAuth      │   │
│  │                                                          │   │
│  │ Execution order (request): Auth → ErrorHandler →         │   │
│  │ Idempotency → RateLimit → Sanitizer → Ctx → Corr → CORS │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│                     APPLICATION LAYER                           │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ merchant_routes  │  │ api_key_routes   │  │ tx_callback   │  │
│  │ (payment intent) │  │ (key CRUD)       │  │ (webhooks)    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘  │
│           │                     │                     │          │
│  ┌────────▼─────────────────────▼─────────────────────▼───────┐ │
│  │                   SERVICE LAYER                            │ │
│  │  transaction_matcher · deposit_sweep · aml_service         │ │
│  │  webhook_service · platform_fee · key_usage · signing      │ │
│  │  deposit_address · key_manager · cache_service             │ │
│  └────────┬──────────────────────┬────────────────────┬───────┘ │
└───────────┼──────────────────────┼────────────────────┼─────────┘
            │                      │                    │
┌───────────▼──────┐  ┌───────────▼──────┐  ┌──────────▼──────────┐
│   PostgreSQL     │  │     Redis        │  │   Blockchain RPCs   │
│   (SQLAlchemy    │  │   (cache, rate   │  │   (Web3.py HTTP)    │
│    async)        │  │    limit, idem)  │  │                     │
└──────────────────┘  └──────────────────┘  └──────────┬──────────┘
                                                       │
                                            ┌──────────▼──────────┐
                                            │  Smart Contracts    │
                                            │  FeeRouter V4       │
                                            │  BatchDistributor   │
                                            │  CCIP Sender/Recv   │
                                            └─────────────────────┘
```

---

## Component Trust Boundaries

### Boundary 1: Client → API (Untrusted)

**Entry points:** HTTP requests to FastAPI application
**Trust assumption:** All client input is untrusted
**Controls:**
- API key authentication (`api_auth.py`) — validates Bearer token against hashed DB records
- Input sanitization (`input_sanitizer.py`) — Content-Length, XSS prevention
- Rate limiting (`rate_limit.py`) — per-endpoint and per-key sliding windows
- CORS policy (`main.py:210-216`) — restricts browser origins

**Gap:** Debug mode bypass (F-BE-01) breaks this boundary entirely.

### Boundary 2: API → Database (Trusted)

**Connection:** SQLAlchemy async sessions over TCP
**Trust assumption:** Database is on a trusted network, accessible only by the application
**Controls:**
- Parameterized queries via SQLAlchemy ORM (no raw SQL injection risk)
- Connection pooling with configurable limits
- Alembic migrations for schema versioning

**Gap:** Default database credentials in config (`rpagos:password@localhost`). SQLite used in development — no row-level locking, no `SELECT FOR UPDATE` support.

### Boundary 3: API → Redis (Semi-Trusted)

**Connection:** `redis://` (unencrypted) via `redis.asyncio`
**Trust assumption:** Redis is on a private network
**Controls:**
- Circuit breaker (3 failures → 15s recovery) in `cache_service.py:36-41`
- Graceful degradation to in-memory fallback
- 20 max connections, 3s timeouts, health check every 30s

**Gap:** No TLS, no authentication shown in URL. Rate limiting fails open when Redis is down. Idempotency fails closed (correct).

### Boundary 4: API → Blockchain (Untrusted Network, Trusted Contracts)

**Connection:** Web3.py HTTP provider to RPC endpoints
**Trust assumption:** RPC endpoints return correct data, smart contracts behave as deployed
**Controls:**
- Transaction signing via KMS (production) or local key (development)
- Nonce management with gap detection
- Gas estimation with safety margins

**Gap:** Synchronous Web3 calls block the async event loop. No RPC response validation. Single RPC provider per chain (no fallback).

### Boundary 5: Smart Contracts → External Protocols (Trusted)

**Interactions:**
- FeeRouterV4 → Uniswap V3 SwapRouter (immutable address)
- RSendCCIPSender → Chainlink CCIP Router (immutable address)
- All contracts → ERC-20 tokens via SafeERC20

**Trust assumption:** Uniswap and Chainlink router contracts are correct and available
**Controls:** Try-catch on swap calls, approval reset after interaction, slippage protection

---

## Data Flow Analysis

### Payment Flow (Happy Path)

```
1. Merchant → POST /payment-intent (API key auth)
   ├── Rate limit check (Redis or in-memory)
   ├── Scope check (write or admin required)
   ├── Environment check (test key → testnet only)
   ├── Monthly limit check (key_usage_service)
   ├── AML screening (aml_service)
   ├── Deposit address derivation (keccak256)
   └── DB: INSERT payment_intent (status=pending)

2. Payer → sends crypto to deposit address (on-chain)

3. Alchemy webhook → POST /webhooks/alchemy
   ├── Signature verification (hmac)
   ├── TX extraction from webhook payload
   └── Forward to transaction_matcher

4. transaction_matcher.match_transaction()
   ├── Anti-duplicate: check matched_tx_hash
   ├── Find intent by deposit_address
   ├── Verify: status=pending, not expired, currency match
   ├── Amount tolerance check (±1% default)
   ├── UPDATE intent: status=completed, matched_tx_hash
   ├── Volume tracking (key_usage_service)
   ├── Fee preview calculation
   ├── Webhook dispatch to merchant
   ├── WebSocket notification to checkout UI
   └── Schedule sweep (Celery or asyncio)

5. deposit_sweep_service.execute_sweep()
   ├── Read on-chain balance
   ├── Calculate platform fee (1% BPS)
   ├── Sweep 1: merchant amount → merchant address
   ├── Sweep 2: fee amount → treasury address
   └── UPDATE intent: status=settled
```

### Key Derivation Flow

```
Master Key (DEPOSIT_MASTER_KEY env var)
    │
    ├── keccak256(master_key + intent_id) → child private key
    │       │
    │       └── eth_account.Account.from_key() → deposit address
    │
    └── Deterministic: same master + intent → same address
```

**Security properties:**
- Master key loss = all deposit funds irrecoverable
- Master key compromise = all deposit funds stealable
- Intent ID is public (in API responses) — master key is the sole secret
- No HD wallet derivation (BIP-32/44) — custom keccak256 scheme

**Risk:** The master key is a catastrophic single point of failure. Backup and rotation procedures are critical but not enforced by code (only warned in comments at `config.py:31-33`).

---

## Failure Mode Analysis

### FM-1: Database Unavailable

| Component | Behavior | Classification |
|-----------|----------|----------------|
| Auth middleware | Cannot verify API keys → all requests rejected | Fail-closed |
| Payment intent creation | Cannot insert → 500 error | Fail-closed |
| Transaction matching | Cannot query/update → TX dropped | Fail-closed |
| Sweep service | Cannot update status → sweep skipped | Fail-closed |

**Assessment:** Correct. All database-dependent operations fail closed.

### FM-2: Redis Unavailable

| Component | Behavior | Classification |
|-----------|----------|----------------|
| Rate limiting | Falls back to in-memory (per-process) | **Fail-open** |
| Idempotency | Rejects all webhook processing | Fail-closed |
| Cache | Falls back to in-memory LRU (1000 entries) | Graceful degradation |
| AML daily totals | Falls back to in-memory tracking | **Fail-open** |

**Assessment:** Mixed. Idempotency correctly fails closed (prevents duplicate webhook processing). Rate limiting and AML fail open — acceptable for availability but reduces security guarantees.

### FM-3: Blockchain RPC Unavailable

| Component | Behavior | Classification |
|-----------|----------|----------------|
| Deposit balance read | Sweep fails, intent stays in `completed` | Retry-safe |
| Sweep execution | On-chain TX fails, reverts to `completed` | Retry-safe |
| Gas funding | Hot wallet transfer fails, sweep aborted | Retry-safe |
| Nonce management | Gap detection fails, warns but continues | Fail-open |

**Assessment:** Sweep operations are idempotent — they can be retried safely. The `_revert_to_completed()` helper in `deposit_sweep_service.py` ensures failed sweeps don't leave intents in a stuck state.

### FM-4: Celery Worker Unavailable

| Component | Behavior | Classification |
|-----------|----------|----------------|
| Sweep scheduling | Falls back to asyncio task | Graceful degradation |
| Webhook delivery | Falls back to asyncio task | Graceful degradation |
| Intent expiration | Falls back to asyncio task | Graceful degradation |

**Assessment:** All Celery tasks have asyncio fallbacks (`transaction_matcher.py:38-52`). Correct — no single-point dependency on Celery.

### FM-5: Signer Unavailable (KMS/Vault)

| Component | Behavior | Classification |
|-----------|----------|----------------|
| KMS signing | Retry with backoff (3 attempts, 0.5→1→2s) | Retry with limit |
| KMS rate limit exceeded | Reject signing request | Fail-closed |
| Vault signer | `NotImplementedError` (not yet implemented) | Fail-closed |

**Assessment:** KMS retry logic is correct (`key_manager.py:450-473`). Rate limiting on KMS calls (60/min, 500/hour) prevents AWS throttling.

---

## Middleware Stack Security Analysis

**Registration order** (`main.py:210-245`):
```python
# Line 210-216: CORSMiddleware
# Line 221: CorrelationMiddleware
# Line 225: RequestContextMiddleware
# Line 229: InputSanitizationMiddleware
# Line 233: RateLimitMiddleware
# Line 237: IdempotencyMiddleware
# Line 241: ErrorHandlerMiddleware
# Line 245: APIKeyMiddleware
```

**Execution order** (Starlette LIFO — last added runs first on request):

```
Request  →  APIKeyAuth  →  ErrorHandler  →  Idempotency  →  RateLimit
         →  InputSanitizer  →  RequestCtx  →  Correlation  →  CORS
         →  [Route Handler]
Response ←  CORS  ←  Correlation  ←  RequestCtx  ←  InputSanitizer
         ←  RateLimit  ←  Idempotency  ←  ErrorHandler  ←  APIKeyAuth
```

**Analysis:**

1. **Auth runs first** — correct. Rate limiter can use `request.state.client` set by auth.
2. **Error handler wraps everything** — correct. Unhandled exceptions from any middleware/route are caught.
3. **Idempotency before rate limit** — slightly odd. An idempotent cache hit still consumes a rate limit slot. Swapping would be more efficient but has no security impact.
4. **Input sanitizer after rate limit** — a large payload first passes rate limiting, then is size-checked. This means a rate limit slot is consumed even for oversized payloads. Minor efficiency concern.
5. **CORS runs last** — correct. CORS headers are added to all responses including error responses.

**Missing middleware:**
- No request timeout middleware — long-running handlers (blocking web3 calls) can hold connections indefinitely
- No request body size enforcement at the framework level (only header-based check in sanitizer)

---

## Secret Management Assessment

| Secret | Storage | Rotation | Backup |
|--------|---------|----------|--------|
| `DEPOSIT_MASTER_KEY` | Env var | No rotation support | Manual — comment says "backup sicuro" |
| `SWEEP_PRIVATE_KEY` | Env var | No rotation | N/A (local signer only) |
| `HMAC_SECRET` | Env var | No rotation | N/A |
| `KMS_KEY_ID` | Env var | AWS-managed rotation | AWS handles |
| `VAULT_TOKEN` | Env var | Not implemented | N/A |
| API key hashes | Database | Per-key revocation | Database backup |
| Oracle signer key | Off-chain (EOA) | On-chain rotation via `setOracleSigner()` | Manual |

**Assessment:**
- No secrets vault integration in production (Vault signer not implemented — `key_manager.py:597-611`)
- All secrets via environment variables — adequate for containerized deployments with secrets managers (AWS SSM, K8s secrets)
- Master key has no rotation mechanism — changing it invalidates all existing deposit addresses
- No secret scanning in CI/CD mentioned

---

## Security Architecture Recommendations

### R-ARCH-01: Implement Row-Level Locking for Critical State Transitions

**Priority:** P0
**Affected flows:** Transaction matching, sweep execution, intent status transitions

All status transitions on `PaymentIntent` should use `SELECT ... FOR UPDATE` to prevent concurrent modification. This is the root cause of F-BE-02 (double matching) and F-BE-05 (concurrent sweep).

### R-ARCH-02: Add Request Timeout Middleware

**Priority:** P1

No timeout enforcement exists at the application level. Blocking Web3 calls (F-BE-08) can hold connections indefinitely. Add a middleware that cancels requests exceeding a configurable timeout (e.g., 30s for normal routes, 120s for sweep-related routes).

### R-ARCH-03: Encrypt Redis Connection

**Priority:** P1

Use `rediss://` (TLS) for all production Redis connections. Add startup validation rejecting unencrypted Redis in production mode.

### R-ARCH-04: Implement Master Key Rotation Strategy

**Priority:** P2

The current keccak256 derivation scheme ties deposit addresses permanently to the master key. Design a rotation strategy:
1. Store the master key version used for each intent
2. Support multiple active master keys during rotation window
3. Derive addresses using versioned key: `keccak256(master_key_v2 + intent_id)`

### R-ARCH-05: Add Multi-Signer Oracle

**Priority:** P2

Replace single `oracleSigner` with a threshold signature scheme (2-of-3 or 3-of-5). This eliminates the single-point-of-failure identified in F-SC-03.

### R-ARCH-06: Implement Circuit Breaker for Blockchain RPCs

**Priority:** P2

Currently, a failing RPC endpoint causes repeated timeouts. Add a circuit breaker per chain with:
- Failure threshold: 5 consecutive failures
- Recovery timeout: 30 seconds
- Fallback: secondary RPC provider

### R-ARCH-07: Async Web3 Provider

**Priority:** P3

Replace synchronous `Web3.HTTPProvider` with async provider (`AsyncHTTPProvider`) throughout the codebase. This resolves F-BE-08 and improves throughput under load.
