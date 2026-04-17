# Remediation Priority Matrix — RSend / RPagos Platform

**Date:** 2026-04-17
**Source reports:** 01-smart-contract-audit, 02-backend-pentest, 03-architecture-review, 04-stress-test-specs

---

## Priority Matrix

| Priority | ID | Finding | Severity | Effort | Source | Status |
|----------|-----|---------|----------|--------|--------|--------|
| **P0** | F-BE-01 | Debug auth bypass grants admin scope | CRITICAL | Low | Report 02 | Open |
| **P0** | F-BE-02 | Double-TX matching race condition | CRITICAL | Medium | Report 02 | Open |
| **P1** | F-BE-03 | AML daily threshold bypass via concurrency | HIGH | Medium | Report 02 | Open |
| **P1** | F-BE-04 | Idempotency race condition | HIGH | Medium | Report 02 | Open |
| **P1** | F-BE-05 | Concurrent sweep execution | HIGH | Low | Report 02 | Open |
| **P1** | F-BE-06 | Unsalted SHA-256 API key hash | HIGH | Medium | Report 02 | Open |
| **P2** | F-SC-03 | Oracle single-signer trust bottleneck | MEDIUM | High | Report 01 | Open |
| **P2** | F-BE-07 | Content-Length bypass via chunked encoding | MEDIUM | Low | Report 02 | Open |
| **P2** | F-BE-08 | Blocking run_until_complete in async context | MEDIUM | Medium | Report 02 | Open |
| **P2** | F-BE-09 | Redis connection unencrypted by default | MEDIUM | Low | Report 02 | Open |
| **P2** | F-BE-10 | Rate limiting fail-open on Redis failure | MEDIUM | Low | Report 02 | Open |
| **P2** | R-ARCH-02 | No request timeout middleware | MEDIUM | Low | Report 03 | Open |
| **P3** | F-SC-01 | V3 transferWithPermit2 sender not oracle-verified | LOW | Low | Report 01 | Open |
| **P3** | F-SC-05 | Forwarder auto-forwards dust amounts | LOW | Low | Report 01 | Open |
| **P3** | F-SC-06 | CCIP message missing explicit gas limit | LOW | Low | Report 01 | Open |
| **P3** | F-SC-07 | Receiver doesn't validate zero recipient | LOW | Low | Report 01 | Open |
| **P3** | F-BE-11 | Default HMAC secret in config | LOW | Low | Report 02 | Mitigated |
| **P3** | F-BE-12 | GET auth bypass (intentional) | LOW | N/A | Report 02 | By design |
| **P3** | F-SC-02 | V4 receive() traps accidental ETH | INFO | Low | Report 01 | Open |
| **P3** | F-SC-04 | executeProposal() callable by anyone | INFO | N/A | Report 01 | By design |

---

## Quick Wins (< 1 day each)

### QW-1: Remove Debug Auth Bypass (F-BE-01)

**File:** `rpagos-backend/app/middleware/api_auth.py:15-17`
**Effort:** 30 minutes
**Risk eliminated:** Full auth bypass in production

**Fix:**
```python
# REMOVE these lines entirely:
# if settings.debug:
#     request.state.client = {"client_id": "debug", ...}
#     return await call_next(request)

# REPLACE with development-only flag that cannot leak:
import os
if os.getenv("RSEND_DEV_AUTH_BYPASS") == "1" and not os.getenv("ENVIRONMENT", "").startswith("prod"):
    request.state.client = {"client_id": "debug", "scope": "admin", "environment": "live"}
    return await call_next(request)
```

Add startup assertion in `main.py`:
```python
if settings.debug and os.getenv("ENVIRONMENT", "").startswith("prod"):
    raise RuntimeError("DEBUG=true is forbidden in production")
```

---

### QW-2: Add Content-Length Enforcement (F-BE-07)

**File:** `rpagos-backend/app/middleware/input_sanitization.py:22-25`
**Effort:** 1 hour

**Fix:** Check actual body size, not just the header:
```python
if request.method in ("POST", "PUT", "PATCH"):
    body = await request.body()
    if len(body) > MAX_PAYLOAD_BYTES:
        return JSONResponse(status_code=413, content={"error": "PAYLOAD_TOO_LARGE"})
```

Or configure nginx `client_max_body_size 1m;` as a defense-in-depth layer.

---

### QW-3: Encrypt Redis Connection (F-BE-09)

**File:** `rpagos-backend/app/config.py`
**Effort:** 30 minutes

**Fix:** Add production validation:
```python
# In validate_settings():
if not self.debug and self.redis_url and not self.redis_url.startswith("rediss://"):
    errors.append("Redis URL must use TLS (rediss://) in production")
```

---

### QW-4: Add Request Timeout Middleware (R-ARCH-02)

**Effort:** 2 hours

**Fix:** Add a middleware that wraps `call_next` with `asyncio.wait_for`:
```python
class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        timeout = 120 if "/sweep" in request.url.path else 30
        try:
            return await asyncio.wait_for(call_next(request), timeout=timeout)
        except asyncio.TimeoutError:
            return JSONResponse(status_code=504, content={"error": "REQUEST_TIMEOUT"})
```

---

### QW-5: Fix Rate Limit Fail-Open (F-BE-10)

**File:** `rpagos-backend/app/middleware/rate_limit.py:401-407`
**Effort:** 1 hour

**Fix:** In multi-worker production, fail-closed when Redis is down:
```python
except Exception:
    if settings.debug:
        # Development: allow in-memory fallback
        allowed, remaining, reset_epoch = _memory_limiter.check(rl_key, max_req, window)
    else:
        # Production: reject request
        return JSONResponse(status_code=503, content={"error": "RATE_LIMIT_UNAVAILABLE"})
```

---

## Medium-Term (1-5 days each)

### MT-1: Fix Double-TX Matching Race (F-BE-02)

**File:** `rpagos-backend/app/services/transaction_matcher.py`
**Effort:** 2 days (implementation + testing)

**Approach:** Two complementary fixes:

**Fix A — Row-level locking:**
```python
# Replace line 139-147:
result = await db.execute(
    select(PaymentIntent).where(
        and_(
            func.lower(PaymentIntent.deposit_address) == recipient,
            PaymentIntent.matched_tx_hash.is_(None),
        )
    ).with_for_update(skip_locked=True)  # Skip if another TX is matching
)
```

**Fix B — Unique constraint:**
```sql
-- Alembic migration:
CREATE UNIQUE INDEX uq_payment_intents_matched_tx ON payment_intents (matched_tx_hash)
WHERE matched_tx_hash IS NOT NULL;
```

This makes the second concurrent write fail with `IntegrityError`, which can be caught and returned as `tx_already_matched`.

**Fix C — Redis distributed lock (defense in depth):**
```python
lock_key = f"tx_match_lock:{tx_hash}"
if not await redis.set(lock_key, "1", nx=True, ex=30):
    return MatchResult(matched=False, reason="tx_match_in_progress")
```

---

### MT-2: Fix Idempotency Race (F-BE-04)

**File:** `rpagos-backend/app/middleware/idempotency.py`
**Effort:** 1 day

**Approach:** Use Redis `SET NX` as a lock before processing:
```python
# Before call_next:
lock_key = f"idem_lock:{cache_key}"
acquired = await r.set(lock_key, "processing", nx=True, ex=30)

if not acquired:
    # Another request is processing — poll for result
    for _ in range(10):
        await asyncio.sleep(0.5)
        cached = await r.get(cache_key)
        if cached:
            return JSONResponse(**json.loads(cached))
    return JSONResponse(status_code=409, content={"error": "DUPLICATE_REQUEST_PROCESSING"})
```

---

### MT-3: Fix Concurrent Sweep (F-BE-05)

**File:** `rpagos-backend/app/services/deposit_sweep_service.py`
**Effort:** 1 day

**Approach:** Add `SELECT ... FOR UPDATE` on the intent row:
```python
# Replace line 43-53:
result = await db.execute(
    select(PaymentIntent).where(
        PaymentIntent.intent_id == intent_id
    ).with_for_update()
)
intent = result.scalar_one_or_none()
```

Plus a Redis lock for the actual on-chain sweep (which happens outside the DB transaction):
```python
sweep_lock = f"sweep_lock:{intent_id}"
if not await redis.set(sweep_lock, "1", nx=True, ex=300):
    logger.info("Sweep already in progress for %s", intent_id)
    return
```

---

### MT-4: Fix AML Concurrency (F-BE-03)

**File:** `rpagos-backend/app/services/aml_service.py`
**Effort:** 2 days

**Approach:** Lua script for atomic check-and-increment:
```lua
-- aml_check_and_increment.lua
local key = KEYS[1]
local add_amount = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local current = tonumber(redis.call('GET', key) or '0')
if current + add_amount > threshold then
    return {0, current}  -- rejected, current total
end
local new_total = redis.call('INCRBYFLOAT', key, add_amount)
redis.call('EXPIRE', key, ttl)
return {1, new_total}  -- accepted, new total
```

This atomically checks AND increments, preventing the race window.

---

### MT-5: Migrate to Salted Key Hashing (F-BE-06)

**File:** `rpagos-backend/app/security/api_keys.py`
**Effort:** 3 days (migration required)

**Approach:**

Phase 1 — Add new columns:
```python
# In ApiKey model:
key_prefix = Column(String(24))  # First 24 chars for lookup
key_hash_v2 = Column(String(128))  # bcrypt or argon2 hash
hash_version = Column(Integer, default=1)  # 1=SHA256, 2=bcrypt
```

Phase 2 — Update verification:
```python
async def verify_api_key(key: str, db: AsyncSession):
    prefix = key[:24]
    candidates = await db.execute(
        select(ApiKey).where(ApiKey.key_prefix == prefix, ApiKey.is_active == True)
    )
    for candidate in candidates.scalars():
        if candidate.hash_version == 2:
            if bcrypt.checkpw(key.encode(), candidate.key_hash_v2.encode()):
                return candidate
        else:
            if candidate.key_hash == hashlib.sha256(key.encode()).hexdigest():
                # Auto-upgrade to v2
                candidate.key_hash_v2 = bcrypt.hashpw(key.encode(), bcrypt.gensalt())
                candidate.hash_version = 2
                return candidate
```

Phase 3 — Force rotation of all v1 keys after migration window.

---

### MT-6: Fix Blocking Async Calls (F-BE-08)

**File:** `rpagos-backend/app/services/deposit_address_service.py`
**Effort:** 2 days

**Approach:** Wrap all synchronous Web3 calls:
```python
# Replace: balance = w3.eth.get_balance(addr)
# With:
balance = await asyncio.to_thread(w3.eth.get_balance, addr)

# Replace: loop.run_until_complete(km_signer.get_address())
# With:
hot_wallet_addr = await km_signer.get_address()
```

Requires auditing all functions in this file for synchronous calls and wrapping each one.

---

## Long-Term (> 5 days each)

### LT-1: Multi-Signer Oracle (F-SC-03)

**Files:** `contracts/src/FeeRouterV4.sol`, `contracts/src/FeeRouterV3.sol`
**Effort:** 2-3 weeks

**Approach:**
1. Replace `address oracleSigner` with `address[] oracleSigners` + `uint8 threshold`
2. Modify `_verifyOracle()` to accept multiple signatures and verify threshold
3. Deploy new contract version (V5) with multi-sig oracle
4. Migrate liquidity from V4 to V5

**Alternative:** Use a Gnosis Safe as the oracle signer (multi-sig at the EOA level, no contract changes needed). Faster but less transparent on-chain.

---

### LT-2: Master Key Rotation (R-ARCH-04)

**Files:** `rpagos-backend/app/config.py`, `rpagos-backend/app/services/deposit_address_service.py`, `rpagos-backend/app/models/merchant_models.py`
**Effort:** 1-2 weeks

**Approach:**
1. Add `master_key_version` column to `PaymentIntent`
2. Store versioned master keys: `DEPOSIT_MASTER_KEY_V1`, `DEPOSIT_MASTER_KEY_V2`
3. New intents use latest version; sweep uses the version stored on the intent
4. Old keys kept for sweeping existing intents, removed after all intents settled

---

### LT-3: Async Web3 Provider (R-ARCH-07)

**Files:** All files using `Web3(HTTPProvider(...))`
**Effort:** 1-2 weeks

Replace synchronous Web3 with async throughout:
```python
from web3 import AsyncWeb3, AsyncHTTPProvider
w3 = AsyncWeb3(AsyncHTTPProvider(rpc_url))
balance = await w3.eth.get_balance(addr)
```

Requires updating every Web3 call site and testing gas estimation, nonce management, and transaction receipt polling with async providers.

---

## Recommended Audit Scope for External Auditor

### Smart Contracts (Priority: HIGH)
- `FeeRouterV4.sol` — full audit, swap integration, oracle verification
- `RSendBatchDistributor.sol` — full audit, timelock, daily caps
- `RSendCCIPSender.sol` — CCIP integration, fee handling, swap
- `RSendCCIPReceiver.sol` — message validation, token distribution

### Backend (Priority: CRITICAL)
- `transaction_matcher.py` — race condition analysis
- `deposit_sweep_service.py` — concurrent execution, on-chain interaction
- `api_auth.py` — authentication bypass vectors
- `aml_service.py` — threshold enforcement, Redis atomicity
- `idempotency.py` — duplicate request prevention

### Infrastructure (Priority: MEDIUM)
- Redis configuration and encryption
- Kubernetes/Docker deployment manifests (if available)
- CI/CD pipeline for secret handling
- Key management procedures (KMS configuration)

### Out of Scope
- `Counter.sol` (test contract)
- `FeeRouter.sol` (v1, likely deprecated)
- Frontend React code (no server-side rendering, no sensitive data handling)
- Third-party dependencies (OpenZeppelin, Chainlink — independently audited)
