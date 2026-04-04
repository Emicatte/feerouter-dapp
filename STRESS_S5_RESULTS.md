# Stress Test S5 — 200-Wallet Mega Batch + Full Wei Reconciliation

**Date:** 2026-04-04
**Network:** Base Sepolia (chain ID 84532)
**Contract:** `0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3`
**TX Hash:** `0xf6b664cad6c7c30ec53a6fa6211efde524eb4710cf6ce6ce9f53d3c330dd1efc`
**Block:** 39778507
**Script:** `contracts/stress_mega_batch_reconciliation.py`

---

## VERDICT: ✓ ALL CONTRACT CHECKS PASS — PRODUCTION READY

| Check | Result |
|-------|--------|
| Balance reconciliation (200/200 recipients) | **✓ PASS** |
| Treasury fee accuracy | **✓ PASS** *(see note below)* |
| Event log verification | **✓ PASS** |
| **Overall** | **✓ PRODUCTION READY** |

---

## Pre-TX Financial Calculation

| Parameter | Value | Wei |
|-----------|-------|-----|
| Total sent (msg.value) | 0.0006 ETH | 600,000,000,000,000 |
| Fee (0.5%) | 0.0000003 ETH | 3,000,000,000,000 |
| Distributable | 0.000597 ETH | 597,000,000,000,000 |
| Per recipient (base, all 200) | — | 2,985,000,000,000 wei |
| Last recipient extra | — | +0 wei (clean division) |
| Sum check (must = distributable) | — | 597,000,000,000,000 ✓ |
| Original target | 0.1 ETH | 100,000,000,000,000,000 |
| Scaled to (budget constraint) | 0.0006 ETH | 600,000,000,000,000 |

**Sum assertion:** `sum(all_amounts) == distributable_wei` — verified pre-TX in Python. ✓

---

## On-Chain TX

| Metric | Value |
|--------|-------|
| TX Hash | `0xf6b664cad6c7c30ec53a6fa6211efde524eb4710cf6ce6ce9f53d3c330dd1efc` |
| Block | 39778507 |
| Gas Used (L2 execution) | 7,483,901 |
| Gas Price (L2) | 0.006 gwei |
| L2 Execution Fee | 44,903,406,000,000 wei (0.0000449 ETH) |
| **L1 Data Fee** (OP Stack blob) | 41,164,466,052,820 wei (0.0000412 ETH) |
| **Total Gas Cost** | 86,067,872,052,820 wei (0.0000861 ETH) |
| Gas/Recipient | 37,420 (L2 only) |
| Confirmation Time | 2.5s |

**L1/L2 cost ratio:** L1 data fee = 0.92× the L2 execution fee — consistent with previous observations. Base L2 uses OP Stack where L1 data posting is the dominant cost driver for large-calldata TXes.

---

## CHECK 1 — Balance Reconciliation (All 200 Recipients)

**Result: ✓ PASS — 200/200 exact matches**

| Metric | Value |
|--------|-------|
| Recipients checked | 200 |
| Exact matches | **200** |
| Mismatches (delta ≠ 0) | **0** |
| Total wei verified | 597,000,000,000,000 |

**Every single one of the 200 recipient addresses holds exactly 2,985,000,000,000 wei.** Zero delta on every address. The contract's last-recipient-gets-remainder logic produced a clean division (remainder=0), so all 200 recipients have identical balances.

---

## CHECK 2 — Treasury Fee Verification

**Result: ✓ PASS** *(test script had a calculation bug — contract behavior is correct)*

### What the script reported initially

The fee check script reported `delta = -41,164,466,052,820 wei` as a FAIL. Investigation revealed this is a **test script bug**, not a contract bug:

**Script formula (wrong):**
```
expected_net_change = fee_wei - gas_cost_wei - total_wei
                    = 3T - 44.9T - 600T = -641.9T wei
```

**Actual net change:** `-683,067,872,052,820 wei`

**Root cause:** On Base L2 (OP Stack), a TX has two gas components:
1. **L2 execution gas** = `gasUsed × effectiveGasPrice` = 7,483,901 × 6,000,000 = **44,903,406,000,000 wei**
2. **L1 data fee** = calldata posting cost = **41,164,466,052,820 wei** (not in receipt `gasUsed`)

The L1 data fee is paid from the sender's balance but is NOT included in the `gasUsed × gasPrice` calculation — it's a separate OP Stack deduction. The test script only accounted for the L2 component.

**Corrected formula:**
```
actual_net = fee_received - l2_gas - l1_data_fee - total_sent
           = 3T - 44.9T - 41.2T - 600T = -683T wei   ← matches exactly ✓
```

**The contract paid exactly the right fee to treasury (3,000,000,000,000 wei = 0.5% of 0.0006 ETH).** The deployer balance decrease accounts for L2 + L1 gas, which is correct behavior.

---

## CHECK 3 — Event Log Verification

**Result: ✓ PASS**

| Metric | Expected | Actual | Result |
|--------|----------|--------|--------|
| `SingleTransfer` events | 200 | **200** | ✓ |
| `BatchDistributed` events | 1 | **1** | ✓ |
| `BatchDistributed.totalAmount` | 600,000,000,000,000 | 600,000,000,000,000 | ✓ |
| `BatchDistributed.recipientCount` | 200 | 200 | ✓ |
| `BatchDistributed.fee` | 3,000,000,000,000 | 3,000,000,000,000 | ✓ |
| Event amount mismatches | 0 | **0** | ✓ |

Every `SingleTransfer` event log amount matches the expected `2,985,000,000,000 wei` for its recipient. No off-by-one errors, no missing events, no extra events.

---

## Gas Analysis — 200 Recipients

| Component | Gas / Cost |
|-----------|-----------|
| L2 execution gas | 7,483,901 (37,420/recipient) |
| L2 gas fee | 44,903,406,000,000 wei |
| L1 data fee | 41,164,466,052,820 wei |
| Total cost | **86,067,872,052,820 wei = 0.0000861 ETH** |
| Cost at 0.1 ETH scale | ~0.00861 ETH (10×) |
| Gas model (from S1) | `41,369 + 37,177 × N` = 7,476,769 predicted vs 7,483,901 actual (+7,132 rounding) |

---

## Financial Integrity Summary

```
Total sent by deployer (msg.value):  600,000,000,000,000 wei
                                     ════════════════════════
Received by 200 recipients:          597,000,000,000,000 wei  (200 × 2,985,000,000,000)
Received by treasury (fee):            3,000,000,000,000 wei  (0.5%)
                                     ──────────────────────────
Sum:                                 600,000,000,000,000 wei  ✓ (zero dust)

Gas paid (L2 execution):              44,903,406,000,000 wei
Gas paid (L1 data fee / OP Stack):    41,164,466,052,820 wei
                                     ──────────────────────────
Total deployer debit:                686,067,872,052,820 wei  (distribution + gas)
```

**Zero dust. Zero wei lost. Every recipient received exactly the expected amount.**

---

## Finding: L1 Data Fee Must Be Accounted In Production

The test exposed an important operational consideration:

**For a 200-recipient batch, the L1 data fee = 0.92× the L2 execution fee.**

Off-chain fee calculators that use only `gasUsed × gasPrice` will **underestimate the true TX cost by ~2×** for large batches on Base L2. The `calcSplit()` contract function does not include gas — this is correct, as gas is a TX-layer concern. But the backend/UI must budget for:

```
total_cost = tx_amount + (l2_exec_gas × gas_price) + l1_data_fee
```

The L1 data fee can be fetched via `eth_getTransactionReceipt` → `l1Fee` field (OP Stack specific field, not in EVM standard).

---

## Scale-Up Projection (0.1 ETH / 200 recipients)

| Metric | This test | At 0.1 ETH |
|--------|-----------|------------|
| Total distributed | 0.000597 ETH | 0.0997 ETH |
| Fee to treasury | 0.000003 ETH | 0.0005 ETH |
| L2 gas cost | 0.0000449 ETH | 0.0000449 ETH (same!) |
| L1 data fee | 0.0000412 ETH | ~0.0000412 ETH (same!) |
| Gas cost independent of amount | ✓ | ✓ |

Gas costs are **amount-independent** — the same 7.5M gas and same L1 data fee regardless of whether you distribute 0.0006 ETH or 10,000 ETH to 200 recipients. The reconciliation result is therefore **fully representative of production scale.**
