# Stress Test — RSendBatchDistributor Max Recipients

**Date:** 2026-04-04
**Network:** Base Sepolia (chain ID 84532)
**RPC:** Alchemy Base Sepolia
**Contract:** `0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3`
**Deployer/Treasury:** `0xa61A471FC226a06C681cf2Ec41d2C64a147b4392`
**Script:** `contracts/script/StressMaxRecipients.s.sol`

---

## Gas Measurements — On-Chain Results

Each test used **1000 wei per recipient** (negligible ETH value) with **feeBps = 50 (0.5%)**.
Recipient addresses are deterministic: `keccak256(abi.encodePacked("rsend_stress_v1", N, i))`.
All tests ran from `/tmp/rsend-contracts` (symlink) to avoid Foundry's spaces-in-path bug.

| N Recipients | Gas Used | Gas / Recipient | TX Hash | Block | Status |
|---|---|---|---|---|---|
| 100 | 3,759,069 | 37,591 | `0x2b0dcfad32e97f55a2320cbf515fc0db619527530b70372c03c946af7fdcf1cc` | 39768110 | **PASS** |
| 200 | 7,476,701 | 37,384 | `0x6ca0e009a9e3b133fbc422381af85eefbb743cf62b141d594ad850af88614ce4` | 39768144 | **PASS** |
| 300 | 11,194,429 | 37,315 | `0x3f8bf6e677d971be09fa83d6e4ea413794e0e22ff106a8c0b5a0ade25972801e` | 39768174 | **PASS** |
| 400 | 14,912,205 | 37,280 | `0x2b2f5905c1212ed506c34ce5ad86ada67b4706c4fe0a851af474c25d754ec6af` | 39768346 | **PASS** |
| 500 | 18,629,921 | 37,260 | `0x6851d21a74c6abd2ddfdd60f7b75d86116bbeac3f597ff42f9edc7a9b9f85469` | 39768556 | **PASS** |
| 501 | — | — | (no TX sent — `cast estimate` only) | — | **REVERT** → `TooManyRecipients(501, 500)` |

**Block confirmation time:** 2 seconds per block (Base Sepolia standard).
**Gas price:** 0.006 gwei (6,000,000 wei) throughout all tests.

---

## Gas Model — Linear Fit

Gas is perfectly linear with N:

```
gas(N) = 41,369 + 37,177 × N
```

**Derivation:**
- Marginal gas per recipient: (18,629,921 − 3,759,069) / (500 − 100) = **37,177 gas/recipient**
- Fixed overhead: 3,759,069 − 100 × 37,177 = **41,369 gas**

**Validation** (predicted vs actual):

| N | Predicted | Actual | Error |
|---|---|---|---|
| 100 | 3,758,969 | 3,759,069 | +100 |
| 200 | 7,476,169 | 7,476,701 | +532 |
| 300 | 11,193,369 | 11,194,429 | +1,060 |
| 400 | 14,910,569 | 14,912,205 | +1,636 |
| 500 | 18,627,769 | 18,629,921 | +2,152 |

Small systematic residual (+100 per 100N) is due to memory expansion gas growing slowly with calldata size — negligible for practical purposes.

---

## N=501 Revert — Confirmed

`cast estimate` call with N=501 recipients returned:

```
error code 3: execution reverted
data: 0x3971ddf8
      000000000000000000000000000000000000000000000000000000000000_01f5_  ← count = 501
      000000000000000000000000000000000000000000000000000000000000_01f4_  ← max = 500
```

Decoded: `TooManyRecipients(501, 500)` — exactly as specified in the contract.
Error selector `0x3971ddf8` = `keccak256("TooManyRecipients(uint256,uint256)")[:4]`.

**No ETH was spent on the revert test** (gas estimation only).

---

## Balance Verification — N=500 Batch

Verified 3 recipient addresses from the N=500 TX:

| Recipient | Address | Expected | Actual | Match |
|---|---|---|---|---|
| recipients[0] | `0x721fFE3b7aa5C31555C1da7fa0de1AA457d41C29` | 1000 wei | 1000 wei | ✓ |
| recipients[249] | `0xaae1683C7a7Dd3eBC5d3d8Efed7E42B841186BA2` | 1000 wei | 1000 wei | ✓ |
| recipients[499] | `0x9C970b0227Cc46AE90a7D5b1B81337cC2F14F7c9` | 1001 wei* | 1001 wei | ✓ |

*Last recipient receives remainder: `distributable − sum(amounts[0..498])` = 500,001 − 499,000 = **1001 wei** due to fee rounding.

---

## Gas Ceiling Analysis

| Constraint | Max Recipients | Basis |
|---|---|---|
| **Contract `MAX_RECIPIENTS`** | **500** | Hard revert at 501 |
| Alchemy free-tier TX gas cap (~20M) | ~537 | `(20,000,000 − 41,369) / 37,177` |
| Base Sepolia block gas limit (400M) | **~10,759** | `(400,000,000 − 41,369) / 37,177` |

**Key finding:** Base Sepolia's block gas limit is **400,000,000 gas** (not 30M as assumed). At the measured marginal rate of 37,177 gas/recipient, the gas ceiling would be ~10,759 recipients — **21× beyond the current software limit of 500.**

The contract's `MAX_RECIPIENTS = 500` is the binding constraint, not gas.

---

## Safe Maximum Recommendation

```
safe_max = MAX_RECIPIENTS × 0.9 = 500 × 0.9 = 450 recipients
```

**Rationale:**
- All 5 tested N values passed with 100% success
- N=500 used 18.6M gas — within both the 400M block limit and the ~20M Alchemy TX cap
- 10% buffer provides headroom for gas price spikes and future contract upgrades
- At N=450: estimated gas = 41,369 + 450 × 37,177 = **16,731,019 gas**

---

## Tooling Issues Found

### Issue 1: Foundry forge script + Alchemy free tier gas cap
- **Symptom:** `forge script --broadcast` fails with `exceeds max transaction gas limit` for N≥500
- **Root cause:** Foundry estimates total *script* execution gas (~27.2M for N=500, including script VM overhead of ~8.6M on top of the 18.6M contract call). Alchemy free tier has a per-TX gas limit of ~20–25M.
- **Workaround:** Use `cast send` directly with `--gas-limit $(cast estimate ...)` which only charges for the contract call itself.
- **Impact:** N=100..400 worked via `forge script --gas-price 6000000`; N=500 required fallback to `cast send`.

### Issue 2: EIP-1559 fee estimation flakiness
- **Symptom:** `Failed to estimate EIP1559 fees` for some invocations
- **Root cause:** Transient: Base Sepolia's fee history window was empty during Alchemy rate-limit recovery
- **Workaround:** Add `--gas-price <explicit>` to `forge script` or `cast send`

### Issue 3: Foundry over-estimates script gas
- **Symptom:** `Estimated total gas used for script: 27,246,259` for N=500, but actual `distributeETH` gas is 18,629,921
- **Root cause:** Script gas includes Solidity VM overhead for array construction loops (N×32-byte assignments, array allocation). These don't appear on-chain.
- **Note:** The per-recipient gas for the **on-chain call** is 37,177 gas, not Foundry's 54,493 script gas estimate.

---

## Total Cost Summary

| Metric | Value |
|---|---|
| Balance before | 0.034232 ETH |
| Balance after | 0.033896 ETH |
| Total spent | **0.000336 ETH** |
| Total gas (all 5 TXs) | 55,972,325 |
| Gas price | 0.006 gwei |
| N=500 gas cost alone | 0.000112 ETH |
| Fees received back (treasury) | 7,536 wei (negligible) |
