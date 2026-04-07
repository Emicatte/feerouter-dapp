/**
 * lib/feeRouterAbi.ts — Shared FeeRouter ABI
 *
 * Exported for use in CommandCenter, RuleCard, TransferForm, etc.
 * Covers FeeRouterV3 (Sepolia) and FeeRouterV4 (Base/Ethereum mainnet).
 */

import type { Abi } from 'viem'

export const FEE_ROUTER_ABI: Abi = [
  {
    name: 'transferWithOracle', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: '_token', type: 'address' }, { name: '_amount', type: 'uint256' },
      { name: '_recipient', type: 'address' }, { name: '_nonce', type: 'bytes32' },
      { name: '_deadline', type: 'uint256' }, { name: '_oracleSignature', type: 'bytes' },
    ], outputs: [],
  },
  {
    name: 'transferETHWithOracle', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: '_recipient', type: 'address' }, { name: '_nonce', type: 'bytes32' },
      { name: '_deadline', type: 'uint256' }, { name: '_oracleSignature', type: 'bytes' },
    ], outputs: [],
  },
  {
    name: 'swapAndSend', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'minAmountOut', type: 'uint256' },
      { name: 'recipient', type: 'address' }, { name: 'nonce', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' }, { name: 'oracleSignature', type: 'bytes' },
    ], outputs: [],
  },
  {
    name: 'swapETHAndSend', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'tokenOut', type: 'address' }, { name: 'minAmountOut', type: 'uint256' },
      { name: 'recipient', type: 'address' }, { name: 'nonce', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' }, { name: 'oracleSignature', type: 'bytes' },
    ], outputs: [],
  },
  // View helpers
  { name: 'oracleSigner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'domainSeparator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
  // Custom errors
  { name: 'ZeroAddress', type: 'error', inputs: [] },
  { name: 'ZeroAmount', type: 'error', inputs: [] },
  { name: 'FeeTooHigh', type: 'error', inputs: [] },
  { name: 'ETHTransferFailed', type: 'error', inputs: [] },
  { name: 'DeadlineExpired', type: 'error', inputs: [] },
  { name: 'OracleSignatureInvalid', type: 'error', inputs: [] },
  { name: 'NonceAlreadyUsed', type: 'error', inputs: [] },
  { name: 'RecipientBlacklisted', type: 'error', inputs: [] },
  { name: 'TokenNotAllowed', type: 'error', inputs: [] },
]
