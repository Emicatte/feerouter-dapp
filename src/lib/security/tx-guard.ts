/**
 * src/lib/security/tx-guard.ts — Transaction pre-flight security checks
 *
 * Validates outbound transactions before wallet signing.
 * All checks are synchronous where possible (<10ms) and bypassable
 * with explicit user acknowledgement.
 *
 * @module security/tx-guard
 */

import { CONTRACT_ADDRESSES, ZERO_ADDRESS, NATIVE_ADDRESS } from '../../constants/addresses';
import { isValidAddress, isValidCalldata, isValidSelector } from '../utils/validation';
import type { SupportedChainId } from '../../types/chain';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** Severity of a security finding */
export type TxGuardSeverity = 'info' | 'warning' | 'danger' | 'block';

/** A single security finding from pre-flight checks */
export interface TxGuardFinding {
  /** Unique code for programmatic handling */
  code: string;
  /** Human-readable description */
  message: string;
  /** Severity level */
  severity: TxGuardSeverity;
}

/** Result of pre-flight transaction validation */
export interface TxGuardResult {
  /** Whether the transaction should proceed (no blocking findings) */
  allowed: boolean;
  /** All findings (info, warnings, and blockers) */
  findings: TxGuardFinding[];
  /** Convenience: highest severity among findings */
  maxSeverity: TxGuardSeverity;
}

/** Transaction parameters for pre-flight validation */
export interface TxCheckParams {
  /** Target contract/address */
  to: `0x${string}`;
  /** ETH value in wei (bigint) */
  value: bigint;
  /** Encoded calldata */
  data: `0x${string}`;
  /** Chain ID */
  chainId: SupportedChainId;
  /** Sender's ETH balance in wei */
  senderBalance: bigint;
  /** Gas estimate from the node (optional) */
  gasEstimate?: bigint;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Maximum reasonable gas limit (5 million) */
const MAX_GAS_LIMIT = 5_000_000n;

/** ERC-20 approve(address,uint256) selector */
const APPROVE_SELECTOR = '0x095ea7b3';

/** Unlimited approval amount (type(uint256).max) */
const UINT256_MAX = 2n ** 256n - 1n;

/** Threshold above which an approval is considered "suspiciously high" */
const SUSPICIOUS_APPROVAL_THRESHOLD = 2n ** 128n;

/** Known Uniswap V3 function selectors */
const KNOWN_SWAP_SELECTORS: ReadonlySet<string> = new Set([
  '0x414bf389', // exactInputSingle
  '0xc04b8d59', // exactInput
  '0xdb3e2198', // exactOutputSingle
  '0xf28c0498', // exactOutput
  '0xac9650d8', // multicall (router)
  '0x5ae401dc', // multicall with deadline
  '0x04e45aaf', // exactInputSingle (UniversalRouter)
]);

/** Security event types for logging */
export type SecurityEventType =
  | 'TX_BLOCKED'
  | 'TX_WARNING'
  | 'UNKNOWN_CONTRACT'
  | 'HIGH_APPROVAL'
  | 'HIGH_GAS';

/** Security event payload (no sensitive data) */
export interface SecurityEvent {
  type: SecurityEventType;
  code: string;
  chainId: number;
  /** Contract address (public, not sensitive) */
  contractAddress: string;
  timestamp: number;
}

// ────────────────────────────────────────────────────────────────
// Whitelist helpers
// ────────────────────────────────────────────────────────────────

/** Set of known safe contract addresses per chain (lowercase) */
const whitelistCache = new Map<SupportedChainId, Set<string>>();

/**
 * Build the whitelist set for a given chain from CONTRACT_ADDRESSES.
 * Includes: Uniswap V3 Router, Quoter, Factory, Multicall3, WETH, WBTC.
 * @param chainId - Chain to build whitelist for
 */
function getWhitelist(chainId: SupportedChainId): Set<string> {
  let set = whitelistCache.get(chainId);
  if (set) return set;

  const addrs = CONTRACT_ADDRESSES[chainId];
  set = new Set<string>();

  if (addrs) {
    set.add(addrs.uniswapV3Router.toLowerCase());
    set.add(addrs.uniswapV3Quoter.toLowerCase());
    set.add(addrs.uniswapV3Factory.toLowerCase());
    set.add(addrs.multicall3.toLowerCase());
    set.add(addrs.weth.toLowerCase());
    if (addrs.wbtc) set.add(addrs.wbtc.toLowerCase());
  }

  // Native placeholder is always safe
  set.add(NATIVE_ADDRESS.toLowerCase());

  whitelistCache.set(chainId, set);
  return set;
}

/**
 * Check if an address is in the known-safe whitelist for a chain.
 * @param address - Address to check
 * @param chainId - Chain ID
 */
export function isWhitelistedContract(
  address: `0x${string}`,
  chainId: SupportedChainId,
): boolean {
  return getWhitelist(chainId).has(address.toLowerCase());
}

// ────────────────────────────────────────────────────────────────
// Core pre-flight check
// ────────────────────────────────────────────────────────────────

/** Severity ordering for comparison */
const SEVERITY_ORDER: Record<TxGuardSeverity, number> = {
  info: 0,
  warning: 1,
  danger: 2,
  block: 3,
};

/**
 * Run all pre-flight security checks on a transaction.
 *
 * Checks performed (all sync, <10ms total):
 * 1. Target is not the zero address (burn prevention)
 * 2. Target is in the contract whitelist
 * 3. ETH value does not exceed sender balance
 * 4. Gas estimate is reasonable (<5M)
 * 5. Calldata starts with a known function selector
 * 6. Approve calls: detects suspiciously high amounts to unknown contracts
 *
 * @param params - Transaction parameters to validate
 * @returns Validation result with findings and allowed flag
 */
export function checkTransaction(params: TxCheckParams): TxGuardResult {
  const findings: TxGuardFinding[] = [];
  const target = params.to.toLowerCase() as `0x${string}`;

  // ── 1. Zero address block ──────────────────────────────────
  if (target === ZERO_ADDRESS.toLowerCase()) {
    findings.push({
      code: 'ZERO_ADDRESS_TARGET',
      message: 'Transaction targets the zero address (0x0). This would burn funds permanently.',
      severity: 'block',
    });
  }

  // ── 2. Whitelist check ─────────────────────────────────────
  const whitelisted = isWhitelistedContract(params.to, params.chainId);

  if (!whitelisted && isValidAddress(target)) {
    findings.push({
      code: 'UNKNOWN_CONTRACT',
      message: 'Target contract is not in the known whitelist. Proceed with caution.',
      severity: 'warning',
    });
  }

  // ── 3. Balance check ───────────────────────────────────────
  if (params.value > 0n && params.value > params.senderBalance) {
    findings.push({
      code: 'INSUFFICIENT_BALANCE',
      message: 'Transaction value exceeds your current balance.',
      severity: 'block',
    });
  }

  // ── 4. Gas estimate check ──────────────────────────────────
  if (params.gasEstimate !== undefined && params.gasEstimate > MAX_GAS_LIMIT) {
    findings.push({
      code: 'EXCESSIVE_GAS',
      message: `Gas estimate (${params.gasEstimate.toString()}) exceeds the safe limit of ${MAX_GAS_LIMIT.toString()}. The transaction may be malformed or the contract may be in an unexpected state.`,
      severity: 'danger',
    });
  }

  // ── 5. Function selector check ─────────────────────────────
  if (params.data && params.data.length >= 10) {
    const selector = params.data.slice(0, 10).toLowerCase();

    // Check if it's an approve call
    if (selector === APPROVE_SELECTOR) {
      checkApproval(params, whitelisted, findings);
    } else if (!KNOWN_SWAP_SELECTORS.has(selector) && whitelisted) {
      // Known contract but unknown function — informational
      findings.push({
        code: 'UNKNOWN_SELECTOR',
        message: 'Transaction calls an unrecognised function on a known contract.',
        severity: 'info',
      });
    } else if (!KNOWN_SWAP_SELECTORS.has(selector) && !whitelisted) {
      findings.push({
        code: 'UNKNOWN_CONTRACT_AND_SELECTOR',
        message: 'Transaction calls an unknown function on an unknown contract.',
        severity: 'danger',
      });
    }
  }

  // ── Compute result ─────────────────────────────────────────
  let maxSeverity: TxGuardSeverity = 'info';
  for (const f of findings) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[maxSeverity]) {
      maxSeverity = f.severity;
    }
  }

  return {
    allowed: maxSeverity !== 'block',
    findings,
    maxSeverity,
  };
}

/**
 * Check approval-specific risks.
 * @internal
 */
function checkApproval(
  params: TxCheckParams,
  whitelisted: boolean,
  findings: TxGuardFinding[],
): void {
  // Decode approval amount from calldata (bytes 36-68 = amount)
  if (params.data.length >= 138) {
    try {
      const amountHex = '0x' + params.data.slice(74, 138);
      const amount = BigInt(amountHex);

      if (amount === UINT256_MAX) {
        if (!whitelisted) {
          findings.push({
            code: 'UNLIMITED_APPROVAL_UNKNOWN',
            message: 'Unlimited token approval to an unknown contract. This could drain your tokens.',
            severity: 'block',
          });
        } else {
          findings.push({
            code: 'UNLIMITED_APPROVAL_KNOWN',
            message: 'Unlimited token approval to a known Uniswap contract. Consider setting a specific amount.',
            severity: 'info',
          });
        }
      } else if (amount > SUSPICIOUS_APPROVAL_THRESHOLD && !whitelisted) {
        findings.push({
          code: 'HIGH_APPROVAL_UNKNOWN',
          message: 'Suspiciously high token approval to an unknown contract.',
          severity: 'danger',
        });
      }
    } catch {
      // Can't parse amount — skip this check
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Security event logging (no sensitive data)
// ────────────────────────────────────────────────────────────────

/** Buffered security events for analytics */
const eventBuffer: SecurityEvent[] = [];

/** Maximum buffer size before auto-flush */
const MAX_EVENT_BUFFER = 100;

/**
 * Log a security event for analytics.
 * Never includes private keys, balances, or user-identifiable data.
 * @param event - Security event to log
 */
export function logSecurityEvent(event: SecurityEvent): void {
  eventBuffer.push(event);

  if (typeof console !== 'undefined') {
    const level = event.type === 'TX_BLOCKED' ? 'warn' : 'info';
    console[level](`[security] ${event.type}: ${event.code} on chain ${event.chainId}`);
  }

  // Auto-flush when buffer is full
  if (eventBuffer.length > MAX_EVENT_BUFFER) {
    eventBuffer.splice(0, eventBuffer.length - MAX_EVENT_BUFFER);
  }
}

/**
 * Get buffered security events (for analytics export).
 * Returns a copy — mutations don't affect the internal buffer.
 */
export function getSecurityEvents(): SecurityEvent[] {
  return [...eventBuffer];
}

/**
 * Convenience: run checkTransaction and log any non-info findings.
 * @param params - Transaction parameters
 * @returns Same TxGuardResult from checkTransaction
 */
export function guardTransaction(params: TxCheckParams): TxGuardResult {
  const result = checkTransaction(params);

  for (const finding of result.findings) {
    if (finding.severity === 'block' || finding.severity === 'danger') {
      logSecurityEvent({
        type: finding.severity === 'block' ? 'TX_BLOCKED' : 'TX_WARNING',
        code: finding.code,
        chainId: params.chainId,
        contractAddress: params.to,
        timestamp: Date.now(),
      });
    }
  }

  return result;
}
