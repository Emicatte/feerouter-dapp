/**
 * usePermit2.ts — Uniswap Permit2 Integration
 *
 * Permit2 address on Base: 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *
 * Flow:
 *   1. Check if token is approved to Permit2 (one-time infinite approve)
 *   2. Generate EIP-712 PermitTransferFrom typed data
 *   3. User signs off-chain
 *   4. FeeRouter calls permit2.permitTransferFrom() + split in 1 TX
 *
 * Risparmio: elimina il doppio clic Approve + Transfer
 * L'utente firma UNA SOLA volta (off-chain) per ogni pagamento
 */

import { useState, useCallback } from 'react'
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from 'wagmi'
import { erc20Abi, maxUint256, type Abi } from 'viem'

// ── Permit2 constants ──────────────────────────────────────────────────────
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as `0x${string}`

// ── Permit2 ABI (funzioni usate) ───────────────────────────────────────────
export const PERMIT2_ABI: Abi = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'token',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount',     type: 'uint160' },
      { name: 'expiration', type: 'uint48'  },
      { name: 'nonce',      type: 'uint48'  },
    ],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',      type: 'address' },
      { name: 'spender',    type: 'address' },
      { name: 'amount',     type: 'uint160' },
      { name: 'expiration', type: 'uint48'  },
    ],
    outputs: [],
  },
]

// ── EIP-712 domain + types per PermitTransferFrom ──────────────────────────
export function buildPermitTypedData(params: {
  token:    `0x${string}`
  amount:   bigint
  spender:  `0x${string}`   // FeeRouter address
  nonce:    bigint
  deadline: bigint
  chainId:  number
}) {
  const domain = {
    name:              'Permit2',
    chainId:           params.chainId,
    verifyingContract: PERMIT2_ADDRESS,
  } as const

  const types = {
    PermitTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions' },
      { name: 'spender',   type: 'address'          },
      { name: 'nonce',     type: 'uint256'           },
      { name: 'deadline',  type: 'uint256'           },
    ],
    TokenPermissions: [
      { name: 'token',  type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  } as const

  const message = {
    permitted: { token: params.token, amount: params.amount },
    spender:   params.spender,
    nonce:     params.nonce,
    deadline:  params.deadline,
  }

  return { domain, types, message }
}

// ── Hook principale ────────────────────────────────────────────────────────
export type Permit2Status =
  | 'idle'
  | 'checking'
  | 'needs_approval'    // token non ancora approvato a Permit2
  | 'approving_permit2' // TX approve Permit2 in corso
  | 'ready_to_sign'     // pronto per firma EIP-712
  | 'signing'           // firma off-chain in corso
  | 'signed'            // firma ottenuta
  | 'error'

export interface Permit2Signature {
  signature: `0x${string}`
  deadline:  bigint
  nonce:     bigint
  amount:    bigint
  token:     `0x${string}`
}

export function usePermit2(feeRouterAddress: `0x${string}`) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()

  const [status,    setStatus]    = useState<Permit2Status>('idle')
  const [permitSig, setPermitSig] = useState<Permit2Signature | null>(null)
  const [error,     setError]     = useState<string>('')

  /**
   * Controlla se il token è già approvato a Permit2.
   * Se no, richiede approve(Permit2, maxUint256) — una sola volta per token.
   */
  const ensurePermit2Approval = useCallback(async (
    tokenAddress: `0x${string}`
  ): Promise<boolean> => {
    if (!address || !publicClient) return false
    setStatus('checking')
    try {
      const allowance = await publicClient.readContract({
        address: tokenAddress, abi: erc20Abi,
        functionName: 'allowance', args: [address, PERMIT2_ADDRESS],
      }) as bigint

      if (allowance > 0n) {
        setStatus('ready_to_sign')
        return true
      }

      // One-time infinite approve to Permit2
      setStatus('approving_permit2')
      await writeContractAsync({
        address: tokenAddress, abi: erc20Abi,
        functionName: 'approve', args: [PERMIT2_ADDRESS, maxUint256],
      })
      setStatus('ready_to_sign')
      return true
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      setError(m.includes('rejected') ? 'Approvazione Permit2 annullata.' : 'Errore Permit2: ' + m.slice(0, 80))
      setStatus('error')
      return false
    }
  }, [address, publicClient, writeContractAsync])

  /**
   * Genera la firma EIP-712 off-chain per il PermitTransferFrom.
   * Nessuna TX on-chain — solo firma nel wallet.
   */
  const signPermit = useCallback(async (params: {
    token:   `0x${string}`
    amount:  bigint
    chainId: number
  }): Promise<Permit2Signature | null> => {
    if (!address || !publicClient) return null
    setStatus('signing')
    try {
      // Legge il nonce corrente da Permit2
      const result = await publicClient.readContract({
        address: PERMIT2_ADDRESS, abi: PERMIT2_ABI,
        functionName: 'allowance',
        args: [address, params.token, feeRouterAddress],
      }) as [bigint, number, number]

      const nonce    = BigInt(result[2])
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1h

      const { domain, types, message } = buildPermitTypedData({
        token:   params.token,
        amount:  params.amount,
        spender: feeRouterAddress,
        nonce,
        deadline,
        chainId: params.chainId,
      })

      const signature = await signTypedDataAsync({ domain, types, message, primaryType: 'PermitTransferFrom' })

      const sig: Permit2Signature = {
        signature, deadline, nonce,
        amount: params.amount,
        token:  params.token,
      }
      setPermitSig(sig)
      setStatus('signed')
      return sig
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      setError(m.includes('rejected') ? 'Firma Permit annullata dall\'utente.' : 'Errore firma: ' + m.slice(0, 80))
      setStatus('error')
      return null
    }
  }, [address, publicClient, feeRouterAddress, signTypedDataAsync])

  const reset = useCallback(() => {
    setStatus('idle'); setPermitSig(null); setError('')
  }, [])

  return { status, permitSig, error, ensurePermit2Approval, signPermit, reset }
}
