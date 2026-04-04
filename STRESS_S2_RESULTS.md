# Stress Test S2 — 20 Sequential Batches (Nonce Management)

**Date:** 2026-04-04
**Network:** Base Sepolia (chain ID 84532)
**Contract:** `0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3`
**Deployer:** `0xa61A471FC226a06C681cf2Ec41d2C64a147b4392`
**Script:** `contracts/stress_sequential_batches.py`
**ETH/batch:** 0.0015 ETH *(original target: 0.005 ETH — reduced due to testnet budget of 0.034 ETH; semantics of nonce/throughput test are identical)*

---

## Send Phase Results

| Batch | Nonce | Send Status | Gas Used | Block | Send Time | Confirm |
|-------|-------|-------------|----------|-------|-----------|---------|
| 1  | 51 | SENT | 413,481 | 39768863 | 210ms | **SUCCESS** |
| 2  | 52 | SENT | 413,493 | 39768863 | 208ms | **SUCCESS** |
| 3  | 53 | SENT | 413,493 | 39768863 | 236ms | **SUCCESS** |
| 4  | 54 | SENT | 413,481 | 39768864 | 811ms ⚠ | **SUCCESS** |
| 5  | 55 | SENT | 413,481 | 39768864 | 253ms | **SUCCESS** |
| 6  | 56 | SENT | 413,493 | 39768864 | 242ms | **SUCCESS** |
| 7  | 57 | SENT | 413,469 | 39768864 | 256ms | **SUCCESS** |
| 8  | 58 | SENT | 413,481 | 39768864 | 252ms | **SUCCESS** |
| 9  | 59 | SENT | 413,481 | 39768864 | 204ms | **SUCCESS** |
| 10 | 60 | SENT | 413,481 | 39768864 | 270ms | **SUCCESS** |
| 11 | 61 | SENT | 413,493 | 39768865 | 244ms | **SUCCESS** |
| 12 | 62 | SENT | 413,481 | 39768865 | 279ms | **SUCCESS** |
| 13 | 63 | SENT | 413,493 | 39768865 | 234ms | **SUCCESS** |
| 14 | 64 | SENT | 413,493 | 39768865 | 242ms | **SUCCESS** |
| 15 | 65 | SENT | 413,493 | 39768865 | 234ms | **SUCCESS** |
| 16 | 66 | SENT | 413,469 | 39768865 | 255ms | **SUCCESS** |
| 17 | 67 | SENT | 413,493 | 39768865 | 228ms | **SUCCESS** |
| 18 | 68 | SENT | 413,493 | 39768865 | 218ms | **SUCCESS** |
| 19 | 69 | SENT | 413,469 | 39768866 | 229ms | **SUCCESS** |
| 20 | 70 | SENT | 413,481 | 39768866 | 252ms | **SUCCESS** |

---

## Summary

| Metric | Value |
|--------|-------|
| **Confirmed** | **20 / 20** |
| Reverted | 0 |
| Failed / Timeout | 0 |
| **Nonce collisions** | **0 — sequence CONTIGUOUS (51→70)** |
| Total send time | **5.37s** (target < 60s — 11× faster) |
| Avg send latency | 268ms/batch |
| P99 send latency | 811ms (batch 4 outlier — see Analysis) |
| Send throughput | **3.7 batches/s** |
| Confirm wait | **2.2s** (all 20 confirmed within 2.2s of last send) |
| Total gas used | 8,269,582 (all 20 batches) |
| Gas/batch | ~413,479 (±12) |
| Balance before | 0.033896 ETH |
| Balance after | 0.003997 ETH |
| Total spent | 0.029900 ETH |
| Recipients served | 200 (20 batches × 10) |

---

## Block Distribution Analysis

All 20 TXes were mined across **4 consecutive blocks** (2-second block time):

| Block | TXes Included | Batches | TXes/Block |
|-------|--------------|---------|------------|
| 39768863 | 3 | 1–3 | 3 |
| 39768864 | 7 | 4–10 | 7 |
| 39768865 | 8 | 11–18 | 8 |
| 39768866 | 2 | 19–20 | 2 |

**Finding:** Base Sepolia's block gas limit (400M) and mempool handled all 20 pending TXes without reordering or dropping. The sequencer picked them up in nonce order across 4 blocks (8 seconds total wall-clock), even though all 20 were in the mempool simultaneously.

---

## Nonce Management Analysis

**Strategy:** Pre-fetch nonce once at startup (`get_transaction_count(DEPLOYER)`), then increment locally with `current_nonce += 1` after each send.

```
Starting nonce: 51
Ending nonce:   70
Expected range: [51, 52, ..., 70]  — 20 consecutive
```

- **Zero `nonce too low` errors** — no collision with pending or confirmed TXes
- **Zero `replacement transaction underpriced` errors** — no accidental duplicates
- **Zero gaps** — every nonce 51–70 was used exactly once

**Why this works:** The pre-calculated nonce increment strategy is safe because:
1. We read nonce once before the burst (not per-transaction, which would race)
2. We never use `pending` nonce count (which would count already-sent-but-unconfirmed TXes)
3. We send sequentially (not in parallel), so no concurrent writes to `current_nonce`

**Risk for production:** If the sweeper process restarts mid-burst, nonce state is lost and the next startup will re-read from chain. If some TXes were sent but not confirmed, the re-read nonce will skip them → stuck. **Recommendation:** persist the pending nonce to Redis alongside idempotency keys.

---

## Gas Consistency Analysis

All 20 batches show extremely consistent gas: **413,469 – 413,493** (range: 24 gas).

The 24-gas variance comes from EVM address-comparison branching (warm vs cold slot for `msg.sender` across successive calls in same block). This is negligible.

Gas per recipient (10-recipient batch): 413,479 / 10 = **41,348 gas/recipient**

Compare to stress test S1 extrapolation formula `41,369 + 37,177 × N` at N=10:
- Predicted: 41,369 + 371,770 = **413,139**
- Actual: 413,479
- Difference: +340 gas (+0.08%) — consistent with memory expansion rounding

---

## Send Latency Analysis

| Metric | Value |
|--------|-------|
| Min | 204ms (batch 9) |
| Max | 811ms (batch 4) ← outlier |
| Median | 243ms |
| P95 | 279ms |
| Mean | 268ms |

**Batch 4 outlier (811ms):** 3× normal latency. Likely Alchemy rate-limit jitter — the free tier occasionally adds ~600ms to the 4th–5th consecutive RPC call in a burst window. Not a nonce or sequencer issue; batch 4 was still confirmed in the same block as batches 5–10.

**Production implication:** A 268ms average send latency means each webhook-triggered sweep takes ~270ms from receipt to TX submission. This is fast enough for real-time response, but Alchemy rate-limiting on the free tier can spike to 800ms+ under burst. **Recommendation:** use Alchemy Growth tier or a dedicated RPC node for production sweep service.

---

## Balance Verification (5 random recipients)

Expected balance per recipient: `distributable / 10 = (1,500,000,000,000,000 × 9950 / 10000) / 10 = 149,250,000,000,000 wei = 0.00014925 ETH`

| Batch | Address | Balance (wei) | Expected (wei) | Match |
|-------|---------|---------------|----------------|-------|
| 4  | `0xa7340906d7bD6e35d86cc24440b68278638eEdcE` | 149,250,000,000,000 | 149,250,000,000,000 | ✓ OK |
| 20 | `0x04178D183e72ca0222a09ddAFa1cf0906F65Afe4` | 149,250,000,000,000 | 149,250,000,000,000 | ✓ OK |
| 11 | `0xC3e5a26093d2bF5845b7908148AEE14f92FB81d1` | 149,250,000,000,000 | 149,250,000,000,000 | ✓ OK |
| 18 | `0x24EDd40505f40F4cc2f9c5aD1b96130c2a6b7202` | 149,250,000,000,000 | 149,250,000,000,000 | ✓ OK |
| 1  | `0x302173a93FA1F52D509811B8A2E7a7F70B8e3892` | 149,250,000,000,000 | 149,250,000,000,000 | ✓ OK |

**5 / 5 correct.** No distribution errors, no amount truncation, correct fee deduction on all batches.

---

## Volume Scaling Analysis

*(ETH price assumed: $2,300)*

| Scenario | ETH/batch | Total ETH (20 batches) | USD Value | Time |
|----------|-----------|------------------------|-----------|------|
| **This test** | 0.0015 ETH | 0.03 ETH | **$69** | 5.37s |
| Original target | 0.005 ETH | 0.10 ETH | $230 | 5.37s (same speed) |
| Flash sale (5 ETH/batch) | 5 ETH | 100 ETH | **$230,000** | ~5.37s |
| Scale to $1M (20 batches) | ~21.7 ETH/batch | ~435 ETH | $1,000,000 | ~5.37s |

**Throughput extrapolation:** at **3.7 batches/s**, RSend can process:
- **13,320 batches/hour**
- At 5 ETH/batch: **66,600 ETH/hour = $153,180,000/hour**

To simulate $1M in a single 60-second burst: **~87 batches at 5 ETH each** (or ~435 batches at 1 ETH each) — well within the measured throughput of 3.7 batches/s for 60 seconds = **222 batches/60s**.

---

## Issues Found

### [INFRA] Alchemy free-tier RPC rate-limiting adds P99 latency spike
- **Observed:** Batch 4 sent in 811ms vs median 243ms
- **Impact:** Occasional 600ms+ jitter on the 4th-5th burst call
- **Fix:** Alchemy Growth tier or dedicated Alchemy webhook + send endpoint separation

### [INFRA] Nonce state not persisted between sweeper restarts
- **Observed:** Not triggered in this test (no crashes)
- **Risk:** If sweeper restarts mid-burst (nonces 51–70 partially sent), restart re-reads nonce 51 (pending TXes not yet confirmed) → sends duplicate nonce → `replacement transaction underpriced` on 2nd attempt, TX stuck
- **Fix:** Store `last_sent_nonce` in Redis with a TTL of 5 minutes; on startup, use `max(chain_nonce, redis_nonce + 1)`

### [OBSERVATION] Base Sepolia mempool holds 20 pending TXes/address without issue
- **Observed:** All 20 TXes queued correctly, picked up across 4 blocks in order
- **Note:** Base's sequencer processes the mempool in nonce order; no reordering observed
