# Smart Contract Security Audit — RSends / FeeRouter

**Date:** 2026-04-17
**Scope:** 8 Solidity contracts in `contracts/src/`
**Overall Rating:** 8.5 / 10 — No critical vulnerabilities found

---

## Executive Summary

The RSends smart contract suite consists of 8 contracts covering fee-routed payments (FeeRouter v1/v3/v4), batch distribution, cross-chain messaging (CCIP), and forwarding. All production contracts use OpenZeppelin's `SafeERC20`, `ReentrancyGuard`, and `Ownable` patterns consistently. EIP-712 oracle signatures with nonce anti-replay protect v3/v4 transfers. No critical or high-severity vulnerabilities were identified. The primary risks are operational (oracle single-signer, ownership centralization) rather than code-level.

---

## Per-Contract Analysis

### 1. Counter.sol — Test Fixture

**File:** `contracts/src/Counter.sol` (15 lines)
**Rating:** N/A — test contract, not deployed

- Two public functions (`setNumber` L7, `increment` L11) with zero access control.
- No imports, no events, no modifiers.
- **Finding:** No access control. **Severity:** INFORMATIONAL — acceptable as a Foundry test fixture. Must never be deployed to mainnet.

---

### 2. FeeRouter.sol — v1 Payment Router

**File:** `contracts/src/FeeRouter.sol` (202 lines)
**Rating:** 9 / 10

**Architecture:**
- Inherits `Ownable`, `ReentrancyGuard` (L24-27)
- Immutable `feeRecipient` (L42) — cannot be changed post-deployment
- `feeBps` mutable via `setFeeBps()` (L192, `onlyOwner`)
- Max fee cap: 1000 BPS = 10% (L46)

**Functions reviewed:**

| Function | Line | Modifiers | Verdict |
|----------|------|-----------|---------|
| `splitTransferETH` | L90 | `external payable nonReentrant` | Safe — CEI pattern (L96→L109→L112) |
| `splitTransferERC20` | L136 | `external nonReentrant` | Safe — SafeERC20 transfers (L157-159) |
| `setFeeBps` | L192 | `external onlyOwner` | Safe — capped at MAX_FEE_BPS (L193) |

**Fee arithmetic** (L102-109, L149-154): Uses `unchecked` blocks for BPS division. Since `feeBps <= 1000` and `BPS_DENOM = 10000`, overflow is impossible. Fee is computed as `amount * feeBps / BPS_DENOM`, net is `amount - fee`. No rounding exploits — fee rounds down, net gets remainder.

**ETH transfer pattern** (L112-116): Uses low-level `.call{value:}("")` with success checks and custom error `ETHTransferFailed`. Correct — `transfer()` has gas stipend issues.

**Denial of entry:** `receive()` and `fallback()` both revert (L199-200), preventing accidental ETH deposits.

**Finding:** None. Clean implementation.

---

### 3. FeeRouterV3.sol — Oracle-Verified Payments

**File:** `contracts/src/FeeRouterV3.sol` (357 lines)
**Rating:** 8.5 / 10

**Architecture additions over v1:**
- EIP-712 oracle signature verification (L331-352)
- Permit2 integration for gasless approvals (L29-40)
- Nonce anti-replay mapping (L70)
- Token allowlist (L73) and recipient blacklist (L76)
- Signature validity window: 120 seconds (L67)

**Functions reviewed:**

| Function | Line | Modifiers | Key checks |
|----------|------|-----------|------------|
| `transferWithOracle` | L148 | `external nonReentrant` | Deadline (L160), blacklist (L161-162), nonce (L165-168), oracle sig (L171) |
| `transferETHWithOracle` | L190 | `external payable nonReentrant` | Same checks (L196-204) |
| `transferWithPermit2` | L226 | `external nonReentrant` | Deadline (L232-233), blacklist (L234-235), oracle sig (L237-240) |

**EIP-712 verification** (L331-352):
- Domain separator computed at construction (L134-140) — correct, uses `block.chainid`
- TypeHash covers: `token, amount, recipient, nonce, deadline` (L81-83)
- Recovery via `ECDSA.recover` + `MessageHashUtils.toTypedDataHash` (L348-350)
- Signer comparison: `recovered != oracleSigner` → revert (L351)

**FINDING F-SC-01: `transferWithPermit2` accepts arbitrary `sender` parameter**
- **Severity:** LOW
- **Location:** `FeeRouterV3.sol:226` — `function transferWithPermit2(TransferParams calldata p, address sender)`
- **Description:** The `sender` parameter (L226) determines who Permit2 pulls tokens from. The oracle signature covers `p.token, p.amount, p.recipient, p.nonce, p.deadline` but does NOT cover `sender`. A relayer could submit a valid oracle signature with a different `sender` than intended.
- **Impact:** Limited — Permit2 requires the `sender` to have signed the permit. The `sender` must have authorized the transfer. However, off-chain accounting systems may assume the oracle-verified sender is the payer, causing attribution errors.
- **Remediation:** Add `sender` to the oracle typehash, or document that `sender` is not oracle-verified and relayers must validate it off-chain.

**Nonce management** (L70, L165-168): `_usedNonces[nonce] = true` before any external call. One-time use, no reset. Correct anti-replay.

**Denial of entry:** `receive()` and `fallback()` revert (L354-355).

---

### 4. FeeRouterV4.sol — Swap + Oracle Payments

**File:** `contracts/src/FeeRouterV4.sol` (445 lines)
**Rating:** 9 / 10

**Architecture additions over v3:**
- Uniswap V3 swap integration (`ISwapRouter`, L29-41)
- WETH wrapping for ETH→token swaps (L43-47)
- Pool fee configuration per token pair (L103)
- Slippage protection with `minAmountOut` (L197, L240)

**Functions reviewed:**

| Function | Line | Modifiers | Key checks |
|----------|------|-----------|------------|
| `swapAndSend` | L182 | `external nonReentrant` | Deadline, blacklist, same-token (L198), MEV guard (L197), oracle sig (L204) |
| `swapETHAndSend` | L229 | `external payable nonReentrant` | Same checks + msg.value validation |
| `transferWithOracle` | L268 | `external nonReentrant` | Same as V3 |
| `transferETHWithOracle` | L296 | `external payable nonReentrant` | Same as V3 |

**Swap execution** (`_swapExact`, L392-419):
- Approve → try swap → catch → reset approval pattern (L399→L401→L418)
- Try-catch wraps `SWAP_ROUTER.exactInputSingle()` (L401-415)
- On failure: approval reset (L418) + revert with `InsufficientLiquidity` (L414)
- MEV guard: `minAmountOut` cannot be 0 (L197, L240) — prevents sandwich attacks

**FINDING F-SC-02: `receive()` accepts ETH silently**
- **Severity:** INFORMATIONAL
- **Location:** `FeeRouterV4.sol:442` — `receive() external payable {}`
- **Description:** Unlike v1/v3 which revert on direct ETH sends, v4's `receive()` accepts ETH silently. This is intentional — needed for WETH unwraps during swaps and ETH refunds.
- **Impact:** Users who accidentally send ETH directly to the contract will lose funds. No rescue function exists for bare ETH.
- **Remediation:** Add an `emergencyWithdrawETH()` function restricted to `onlyOwner`, or document that direct ETH sends are expected and recoverable only by the owner deploying a rescue.

**FINDING F-SC-03: Oracle single-signer is a trust bottleneck**
- **Severity:** MEDIUM
- **Location:** `FeeRouterV4.sol:88` — `address public oracleSigner`
- **Description:** A single EOA (`oracleSigner`) signs all oracle-verified transactions. If this key is compromised, an attacker can authorize arbitrary transfers from any user who has approved tokens to the contract. The `setOracleSigner()` function (L333) allows rotation but has no timelock.
- **Impact:** Full control over oracle-gated transfers. All funds approved to the contract are at risk.
- **Remediation:** (1) Implement multi-sig oracle (2/3 threshold), (2) Add timelock to `setOracleSigner()`, (3) Implement per-user spending limits independent of oracle authorization.

**Pool fee validation** (L363, L369): Fees validated against Uniswap tier set `{100, 500, 3000, 10000}`. Correct.

---

### 5. RSendsBatchDistributor.sol — Batch Payments

**File:** `contracts/src/RSendsBatchDistributor.sol` (550 lines)
**Rating:** 9 / 10

**Architecture:**
- `Ownable2Step` for safer ownership transfer (L33)
- Guardian role for emergency pause (L71)
- 24-hour timelock for fee/guardian changes (L56)
- Daily spending caps per token (L88-92)
- `Pausable` for emergency stops (L31)

**Functions reviewed:**

| Function | Line | Modifiers | Key checks |
|----------|------|-----------|------------|
| `distributeETH` | L178 | `payable nonReentrant whenNotPaused` | Array lengths (L184), max recipients 500 (L185), daily cap (L203) |
| `distributeERC20` | L261 | `nonReentrant whenNotPaused` | Same checks (L268-270, L285) |
| `executeProposal` | L404 | public | Timelock check (L407), proposal exists (L405) |
| `emergencyWithdrawETH` | L467 | `onlyOwner` | Must be paused (L468) |

**Dust prevention** (L215-220, L300-305): Last recipient receives remainder (`total - sum_of_previous`) instead of calculated amount. Prevents BPS rounding dust from being trapped in contract.

**Daily cap mechanism** (L340-356): Per-token daily spending caps with automatic day-boundary reset (L350-353). Uses `block.timestamp / 86400` for day calculation — simple and correct for Ethereum block times.

**Timelock** (L369-424): Fee and guardian changes require a 24-hour proposal → execution cycle. Anyone can call `executeProposal()` after timelock expires (L404). Owner or guardian can cancel (L430-431).

**FINDING F-SC-04: `executeProposal()` has no access control**
- **Severity:** LOW
- **Location:** `RSendsBatchDistributor.sol:404`
- **Description:** Anyone can call `executeProposal()` after the timelock expires. This is intentional (ensures proposals execute even if owner is unavailable) but means a front-runner could execute the proposal in a specific block to their advantage.
- **Impact:** Minimal — proposals are created by the owner, the outcome is deterministic, and the timelock provides visibility. Front-running the execution provides no economic advantage.
- **Remediation:** None required. Document the design decision.

**Emergency controls:** Withdrawal functions require paused state (L468, L486). Guardian can pause (L447), only owner can unpause (L455). Clean separation of concerns.

---

### 6. RSendsForwarder.sol — Rule-Based Forwarding

**File:** `contracts/src/RSendsForwarder.sol` (122 lines)
**Rating:** 8.5 / 10

**Architecture:**
- Source-address → destination mapping with optional 2-way split (L12-18)
- Auto-forward on `receive()` (L48-52)
- Manual forward for stuck funds (L54-59)

**Functions reviewed:**

| Function | Line | Modifiers | Key checks |
|----------|------|-----------|------------|
| `createRule` | L33 | `onlyOwner` | Zero address (L34), BPS range (L35-36) |
| `receive` | L48 | `nonReentrant` | Rule exists and active (L49-50) |
| `manualForward` | L54 | `onlyOwner nonReentrant` | Rule active (L56), balance > 0 (L57-58) |
| `forwardERC20` | L62 | `onlyOwner nonReentrant` | Rule active (L64), balance > 0 (L65-66) |

**FINDING F-SC-05: No minimum amount check on auto-forward**
- **Severity:** LOW
- **Location:** `RSendsForwarder.sol:48-52`
- **Description:** The `receive()` function forwards any ETH amount, even dust. The `ForwardingRule` struct has a `minWei` field (L17) but it is not checked in the `receive()` handler (L48-52) — only in `_executeForward` implicitly through the rule lookup.
- **Impact:** Gas costs for forwarding small amounts may exceed the forwarded value. Not exploitable but economically wasteful.
- **Remediation:** Add `require(msg.value >= rule.minWei)` in `receive()`.

**Split arithmetic** (L82-90): BPS-based split with `amount1 = amount * splitBps1 / 10000`, `amount2 = amount - amount1`. Remainder goes to destination2. No dust trapped.

---

### 7. RSendsCCIPSender.sol — Cross-Chain Sender

**File:** `contracts/src/RSendsCCIPSender.sol` (532 lines)
**Rating:** 8 / 10

**Architecture:**
- Chainlink CCIP router integration (L96)
- Per-chain receiver mapping (L109)
- Swap-and-bridge pattern via Uniswap V3 (L238)
- CCIP fee estimation for UI (L337, L361)

**Functions reviewed:**

| Function | Line | Modifiers | Key checks |
|----------|------|-----------|------------|
| `sendCrossChain` | L160 | `payable nonReentrant` | Token allowed (L168), not blacklisted (L169-170), receiver set (L172-173) |
| `swapAndBridge` | L238 | `payable nonReentrant` | Same + slippage (L264), MEV guard (L250), same-token (L252) |
| `swapETHAndBridge` | L291 | `payable nonReentrant` | Same + msg.value (L304) |

**CCIP fee handling** (L204-217):
- `CCIP_ROUTER.getFee()` called before send (L204)
- Validation: `msg.value >= ccipFee` (L205)
- Excess ETH refunded to sender (L214-217)
- Correct pattern — no ETH trapped in contract

**Approval management** (L186, L220): Approve before CCIP send, reset to 0 after. Prevents lingering approvals. Same pattern in `_swapExact` (L419, L437).

**FINDING F-SC-06: No CCIP message gas limit configuration**
- **Severity:** LOW
- **Location:** `RSendsCCIPSender.sol:189-201` — message construction
- **Description:** The `extraArgs` field in the CCIP message is empty (not set in the message struct at L189-201). Chainlink CCIP uses default gas limits when `extraArgs` is not provided. If the receiver contract's `ccipReceive` requires more gas than the default, the message will fail on the destination chain.
- **Impact:** Failed cross-chain transfers if receiver processing exceeds default gas limit. Funds are refundable via CCIP's manual execution mechanism.
- **Remediation:** Set explicit `extraArgs` with a gas limit sufficient for the receiver's `ccipReceive` logic. Use `Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: 200_000}))`.

---

### 8. RSendsCCIPReceiver.sol — Cross-Chain Receiver

**File:** `contracts/src/RSendsCCIPReceiver.sol` (111 lines)
**Rating:** 8 / 10

**Architecture:**
- Router-gated `ccipReceive` (L62, validated at L65)
- Per-chain sender allowlist (L42)
- Message deduplication via `processedMessages` mapping (L43)
- Token rescue function (L107)

**Functions reviewed:**

| Function | Line | Modifiers | Key checks |
|----------|------|-----------|------------|
| `ccipReceive` | L62 | `external` | Router only (L65), sender allowed (L68-69), not processed (L72-73) |
| `rescueTokens` | L107 | `onlyOwner` | None — emergency rescue |

**Sender validation** (L68-69):
```solidity
address sender = abi.decode(message.sender, (address));
if (sender != allowedSenders[message.sourceChainSelector]) revert UnknownSender();
```
Validates the source contract address against the allowlist per chain. Correct — prevents spoofed messages.

**Idempotency** (L72-73): `processedMessages[message.messageId] = true` before processing. Prevents replay of the same CCIP message.

**Token distribution** (L79-92): Loops through `message.destTokenAmounts` and transfers each token to the decoded recipient. Uses `SafeERC20.safeTransfer`.

**FINDING F-SC-07: No recipient validation in receiver**
- **Severity:** LOW
- **Location:** `RSendsCCIPReceiver.sol:76` — `address recipient = abi.decode(message.data, (address))`
- **Description:** The recipient address is decoded from the CCIP message data without validation (no zero-address check). If the sender contract encodes `address(0)` as recipient, tokens are sent to the zero address.
- **Impact:** Theoretical token burn. In practice, the sender contract validates recipients before sending. Defense-in-depth suggests adding a check.
- **Remediation:** Add `require(recipient != address(0), "zero recipient")` after decoding.

---

## Cross-Contract Interactions

### CCIP Flow: Sender → Receiver
1. User calls `RSendsCCIPSender.sendCrossChain()` on source chain
2. Tokens pulled from user, fee split to treasury
3. Net amount approved to CCIP router, message sent
4. CCIP delivers to `RSendsCCIPReceiver.ccipReceive()` on destination chain
5. Receiver validates source chain + sender address, distributes tokens

**Trust boundary:** The CCIP router is the sole trusted intermediary. Both sender and receiver validate the router address (immutable). The sender-receiver binding is maintained via `receivers` mapping (sender) and `allowedSenders` mapping (receiver).

### FeeRouter V3/V4 → Oracle
1. User submits transaction with oracle signature
2. Contract verifies EIP-712 signature against `oracleSigner`
3. Nonce consumed, transfer executed

**Trust boundary:** The oracle signer is a single point of trust. All oracle-gated functions depend on this key's integrity.

---

## Gas Optimization Notes

1. **FeeRouter v1** (L102-109): `unchecked` arithmetic for fee calculation — saves ~200 gas per call. Safe because `feeBps <= 1000` and `BPS_DENOM = 10000`.
2. **BatchDistributor** (L210-229): Loop-based ETH distribution uses `.call{value:}` per recipient. For 500 recipients, gas cost is ~500 × 21000 = 10.5M gas. Block gas limit (30M) allows this but leaves little headroom.
3. **FeeRouterV4** (L399): `forceApprove` used instead of `approve` to handle tokens with non-standard approval (USDT). Correct but costs ~5000 gas more than `approve`.
4. **Custom errors** used throughout — ~50% cheaper than `require` strings for revert data.

---

## Recommendations

| ID | Finding | Severity | Recommendation |
|----|---------|----------|----------------|
| F-SC-01 | V3 `transferWithPermit2` sender not oracle-verified | LOW | Add `sender` to oracle typehash |
| F-SC-02 | V4 `receive()` traps accidental ETH | INFO | Add `emergencyWithdrawETH()` |
| F-SC-03 | Oracle single-signer trust bottleneck | MEDIUM | Multi-sig oracle or timelock on rotation |
| F-SC-04 | `executeProposal()` callable by anyone | LOW | Intentional — document decision |
| F-SC-05 | Forwarder auto-forwards dust amounts | LOW | Check `minWei` in `receive()` |
| F-SC-06 | CCIP message missing explicit gas limit | LOW | Set `extraArgs` with gas limit |
| F-SC-07 | Receiver doesn't validate zero recipient | LOW | Add zero-address check |

**Overall assessment:** The contract suite is well-engineered with consistent use of security patterns. The primary risk surface is operational (oracle key management, ownership) rather than code-level. Ready for formal audit with the above findings as pre-identified items.
