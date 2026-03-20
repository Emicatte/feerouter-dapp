/**
 * lib/useSwapQuote.ts — Real-Time Uniswap V3 Quote Engine
 *
 * Usa il Quoter V2 di Uniswap per ottenere quote on-chain tramite staticCall.
 * Debounce 600ms — si attiva mentre l'utente digita.
 *
 * Output: "Il destinatario riceverà circa 2.985 USDC (Slippage 0.5%)"
 *
 * Quoter V2 (deterministico su tutte le chain):
 *   Mainnet + Base: 0x61fFE014bA17989E743c5F6cB21bF9697530B21e
 */

import { useState, useEffect, useRef } from 'react'
import { usePublicClient } from 'wagmi'
import { formatUnits, parseUnits, parseEther, type Abi } from 'viem'
import { getRegistry, POOL_FEE, type TokenConfig } from './contractRegistry'

const QUOTER_V2_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as `0x${string}`

// QuoterV2 ABI — solo quoteExactInputSingle
const QUOTER_V2_ABI: Abi = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn',            type: 'address' },
          { name: 'tokenOut',           type: 'address' },
          { name: 'amountIn',           type: 'uint256' },
          { name: 'fee',                type: 'uint24'  },
          { name: 'sqrtPriceLimitX96',  type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut',                type: 'uint256' },
      { name: 'sqrtPriceX96After',        type: 'uint160' },
      { name: 'initializedTicksCrossed',  type: 'uint32'  },
      { name: 'gasEstimate',              type: 'uint256' },
    ],
  },
]

export type QuoteStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error_liquidity'   // pool non ha abbastanza liquidità
  | 'error_network'     // RPC error
  | 'error_same_token'  // tokenIn === tokenOut
  | 'error_amount'      // amount non valido

export interface SwapQuote {
  status:         QuoteStatus
  amountOut:      bigint        // raw wei
  amountOutFmt:   string        // formatted (es. "2985.123456")
  netAmountOut:   bigint        // dopo fee 0.5%
  netAmountFmt:   string        // formatted
  feeAmount:      bigint
  feeFmt:         string
  minAmountOut:   bigint        // amountOut * (1 - slippage)
  priceImpact?:   number        // % stimato
  poolFee:        number        // 100 | 500 | 3000 | 10000
  gasEstimate?:   bigint
  errorMessage?:  string
}

// Slippage default 0.5% — configurabile
const DEFAULT_SLIPPAGE_BPS = 50  // 0.5%

function calcSplitBigInt(amount: bigint, feeBps: number) {
  const fee = (amount * BigInt(feeBps)) / 10_000n
  return { net: amount - fee, fee }
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n
}

export function useSwapQuote({
  chainId,
  tokenIn,
  tokenOut,
  amountIn,    // stringa formattata, es. "1.5"
  feeBps = 50, // fee gateway
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  debounceMs = 600,
}: {
  chainId:     number
  tokenIn:     TokenConfig | null
  tokenOut:    TokenConfig | null
  amountIn:    string
  feeBps?:     number
  slippageBps?: number
  debounceMs?: number
}) {
  const publicClient = usePublicClient({ chainId })
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Reset se dati insufficienti
    if (!tokenIn || !tokenOut || !amountIn || Number(amountIn) <= 0) {
      setQuote(null); return
    }

    if (tokenIn.symbol === tokenOut.symbol) {
      setQuote({ status: 'error_same_token', amountOut: 0n, amountOutFmt: '0', netAmountOut: 0n, netAmountFmt: '0', feeAmount: 0n, feeFmt: '0', minAmountOut: 0n, poolFee: 500, errorMessage: 'Token di input e output uguali.' })
      return
    }

    // Debounce
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      // Stato loading
      setQuote(prev => prev ? { ...prev, status: 'loading' } : {
        status: 'loading', amountOut: 0n, amountOutFmt: '...', netAmountOut: 0n, netAmountFmt: '...', feeAmount: 0n, feeFmt: '0', minAmountOut: 0n, poolFee: 500
      })

      const registry = getRegistry(chainId)
      if (!registry) return

      // Converti amountIn in wei
      let amountInWei: bigint
      try {
        amountInWei = tokenIn.isNative
          ? parseEther(amountIn)
          : parseUnits(amountIn, tokenIn.decimals)
      } catch {
        setQuote({ status: 'error_amount', amountOut: 0n, amountOutFmt: '0', netAmountOut: 0n, netAmountFmt: '0', feeAmount: 0n, feeFmt: '0', minAmountOut: 0n, poolFee: 500, errorMessage: 'Importo non valido.' })
        return
      }

      // tokenIn address per Uniswap (ETH nativo → WETH)
      const tokenInAddr = tokenIn.isNative
        ? registry.weth
        : tokenIn.address

      const tokenOutAddr = tokenOut.address

      // Pool fee — usa override se configurato, altrimenti poolFeeToWETH
      const poolFee = tokenIn.poolFeeToWETH || tokenOut.poolFeeToWETH || POOL_FEE.LOW

      try {
        // staticCall al Quoter V2
        if (!publicClient) throw new Error('No public client')

        const result = await publicClient.simulateContract({
          address:      QUOTER_V2_ADDRESS,
          abi:          QUOTER_V2_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn:            tokenInAddr,
            tokenOut:           tokenOutAddr,
            amountIn:           amountInWei,
            fee:                poolFee,
            sqrtPriceLimitX96:  0n,
          }],
        })

        const [amountOut, , , gasEstimate] = result.result as [bigint, bigint, number, bigint]

        if (amountOut === 0n) {
          setQuote({ status: 'error_liquidity', amountOut: 0n, amountOutFmt: '0', netAmountOut: 0n, netAmountFmt: '0', feeAmount: 0n, feeFmt: '0', minAmountOut: 0n, poolFee, errorMessage: 'Liquidità insufficiente in questa pool.' })
          return
        }

        // Calcola split (fee 0.5% gateway)
        const { net, fee } = calcSplitBigInt(amountOut, feeBps)

        // Slippage su netAmount
        const minAmountOut = applySlippage(net, slippageBps)

        const dec = tokenOut.decimals
        setQuote({
          status:        'success',
          amountOut,
          amountOutFmt:  parseFloat(formatUnits(amountOut, dec)).toFixed(dec > 8 ? 6 : dec),
          netAmountOut:  net,
          netAmountFmt:  parseFloat(formatUnits(net, dec)).toFixed(dec > 8 ? 6 : dec),
          feeAmount:     fee,
          feeFmt:        parseFloat(formatUnits(fee, dec)).toFixed(dec > 8 ? 8 : dec),
          minAmountOut,
          poolFee,
          gasEstimate,
        })

      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        const isLiquidity = msg.includes('liquidity') || msg.includes('SPL') || msg.includes('revert')
        setQuote({
          status: isLiquidity ? 'error_liquidity' : 'error_network',
          amountOut: 0n, amountOutFmt: '0',
          netAmountOut: 0n, netAmountFmt: '0',
          feeAmount: 0n, feeFmt: '0',
          minAmountOut: 0n, poolFee,
          errorMessage: isLiquidity
            ? 'Pool con liquidità insufficiente per questo importo.'
            : 'Impossibile ottenere la quotazione. Riprova.',
        })
      }
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [chainId, tokenIn?.symbol, tokenOut?.symbol, amountIn, feeBps, slippageBps])

  return quote
}

// ── Hook semplificato — solo per direct transfer (no swap) ────────────────
export function useDirectQuote(amount: string, decimals: number, feeBps = 50) {
  if (!amount || Number(amount) <= 0) return null
  try {
    const raw = parseUnits(amount, decimals)
    const fee = (raw * BigInt(feeBps)) / 10_000n
    const net = raw - fee
    return {
      raw, net, fee,
      netFmt: parseFloat(formatUnits(net, decimals)).toFixed(6),
      feeFmt: parseFloat(formatUnits(fee, decimals)).toFixed(8),
    }
  } catch { return null }
}
