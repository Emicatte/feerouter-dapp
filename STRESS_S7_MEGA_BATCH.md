# Stress Test S7 — Mega Batch Reconciliation (200 Wallet Payroll)

**Date:** 2026-04-09
**Network:** Base Sepolia fork (Anvil, chain ID 84532)
**Contract:** `0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3`
**Deployer:** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
**Treasury:** `0xa61A471FC226a06C681cf2Ec41d2C64a147b4392`
**Total distributed:** 0.1 ETH (100000000000000000 wei)
**Fee:** 50 bps (0.5%)
**Recipients:** 200

---

## Verdict

**PRODUCTION-READY**

| Check | Result |
|-------|--------|
| Wei reconciliation (200/200) | PASS |
| Fee verification | PASS |
| Event count (200 ST + 1 BD) | PASS |
| Event amount verification | PASS |
| Conservation of value | PASS |

---

## Transaction Details

| Metric | Value |
|--------|-------|
| TX hash | `da85255ca3b94977264d52f5c35991ba180f687cb01105b8ca2d5934714d455d` |
| Block | 40000544 |
| Gas used | 7,488,213 |
| Gas per recipient | 37,441 |
| Gas price | 1.0044 gwei |
| Gas cost | 0.00752111 ETH |
| Build+sign time | 31ms |
| Confirm time | 18599ms |
| Reconciliation time | 121ms |
| Total test time | 20.2s |

---

## Fee Verification

| Metric | Value |
|--------|-------|
| Fee expected | 500000000000000 wei |
| Fee received (treasury delta) | 500000000000000 wei |
| Match | PASS |

---

## Conservation of Value

| Component | Wei |
|-----------|-----|
| Total sent (msg.value) | 100000000000000000 |
| Fee to treasury | 500000000000000 |
| Total to recipients | 99500000000000000 |
| Fee + recipients | 100000000000000000 |
| Missing wei | 0 |

---

## Event Verification

| Metric | Expected | Actual | Result |
|--------|----------|--------|--------|
| SingleTransfer events | 200 | 200 | PASS |
| BatchDistributed events | 1 | 1 | PASS |
| Event amount mismatches | 0 | 0 | PASS |
| BD.totalAmount | 100000000000000000 | 100000000000000000 | PASS |
| BD.recipientCount | 200 | 200 | PASS |
| BD.fee | 500000000000000 | 500000000000000 | PASS |

---

## Reconciliation Detail (200 recipients)

**Verified: 200/200** | Failures: 0

### Distribution Statistics

| Metric | Value |
|--------|-------|
| Min allocation | 1 bps (9950000000000 wei) |
| Max allocation | 97 bps (965150000000000 wei) |
| Median allocation | 51 bps |
| Distributable | 99500000000000000 wei (0.099500000000000005 ETH) |

---

## Production Scaling Analysis

*(ETH price assumed: $2,500)*

| Scenario | Amount | Gas Cost | Total Cost |
|----------|--------|----------|------------|
| This test (200 recipients) | 0.1 ETH ($250) | 0.00752111 ETH ($18.8028) | $268.80 |
| 200 recipients @ 10 ETH | 10.0 ETH ($25,000) | ~0.00752111 ETH | $25,018.80 |
| 200 recipients @ 100 ETH | 100.0 ETH ($250,000) | ~0.00752111 ETH | $250,018.80 |
| 200 recipients @ $1M payroll | ~400.00 ETH | ~0.00752111 ETH | ~$1,000,000 |

**Gas cost per recipient:** 37,441 gas = ~$0.094014/recipient

---

## Methodology

1. **Anvil Fork**: Base Sepolia forked locally — identical contract bytecode, deterministic execution
2. **Wallet Generation**: 200 deterministic addresses via `keccak256("s7_payroll_recipient_{i}")`
3. **BPS Allocation**: Random basis-point percentages summing to exactly 10,000 (100%)
4. **Amount Calculation**: Integer arithmetic only — last recipient gets `distributable - sum(others)` (zero dust)
5. **Reconciliation**: `eth_getBalance` for all 200 addresses, compared to expected amounts
6. **Fee Verification**: Treasury balance delta compared to `total * 50 / 10000`
7. **Event Parsing**: Raw log decoding of SingleTransfer and BatchDistributed topics
8. **Conservation**: `fee + sum(balances) == msg.value` — total value conservation check
