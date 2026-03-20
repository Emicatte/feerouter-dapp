/**
 * lib/useSwapQuote.ts — Real-Time Uniswap V3 Quote Engine
 *
 * Upgrade: pool fee discovery dinamica
 *   - Prova in sequenza: 500 → 3000 → 100 → 10000
 *   - ETH nativo → WETH automatico dal registry
 *   - error_liquidity solo se TUTTI i tier falliscono
 */

import { useState, useEffect, useRef } from 'react'
import { usePublicClient } from 'wagmi'
import { formatUnits, parseUnits, parseEther, type Abi } from 'viem'
import { getRegistry, type TokenConfig } from './contractRegistry'

const QUOTER_V2_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as `0x${string}`

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
          { name: 'tokenIn',           type: 'address' },
          { name: 'tokenOut',          type: 'address' },
          { name: 'amountIn',          type: 'uint256' },
          { name: 'fee',               type: 'uint24'  },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut',               type: 'uint256' },
      { name: 'sqrtPriceX96After',       type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32'  },
      { name: 'gasEstimate',             type: 'uint256' },
    ],
  },
]

// Tier da provare in ordine — le pool più liquide sono solitamente 500 e 3000
const FEE_TIERS = [500, 3000, 100, 10000] as const

export type QuoteStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error_liquidity'
  | 'error_network'
  | 'error_same_token'
  | 'error_amount'

export interface SwapQuote {
  status:        QuoteStatus
  amountOut:     bigint
  amountOutFmt:  string
  netAmountOut:  bigint
  netAmountFmt:  string
  feeAmount:     bigint
  feeFmt:        string
  minAmountOut:  bigint
  poolFee:       number    // tier che ha risposto con successo
  gasEstimate?:  bigint
  errorMessage?: string
}

const DEFAULT_SLIPPAGE_BPS = 50

function calcSplit(amount: bigint, feeBps: number) {
  const fee = (amount * BigInt(feeBps)) / 10_000n
  return { net: amount - fee, fee }
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n
}

// Risolve ETH nativo → indirizzo WETH della chain corrente
function resolveAddr(token: TokenConfig, weth: `0x${string}`): `0x${string}` {
  if (token.isNative || token.address === '0x0000000000000000000000000000000000000000') {
    return weth
  }
  return token.address
}

export function useSwapQuote({
  chainId,
  tokenIn,
  tokenOut,
  amountIn,
  feeBps = 50,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  debounceMs = 600,
}: {
  chainId:      number
  tokenIn:      TokenConfig | null
  tokenOut:     TokenConfig | null
  amountIn:     string
  feeBps?:      number
  slippageBps?: number
  debounceMs?:  number
}) {
  const publicClient = usePublicClient({ chainId })
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Reset se dati mancanti
    if (!tokenIn || !tokenOut || !amountIn || Number(amountIn) <= 0) {
      setQuote(null); return
    }

    // Stesso token → nessuno swap necessario
    if (tokenIn.address === tokenOut.address) {
      setQuote({
        status: 'error_same_token', amountOut: 0n, amountOutFmt: '0',
        netAmountOut: 0n, netAmountFmt: '0', feeAmount: 0n, feeFmt: '0',
        minAmountOut: 0n, poolFee: 500,
        errorMessage: 'Token di input e output uguali.',
      })
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      setQuote(prev => prev
        ? { ...prev, status: 'loading' }
        : { status: 'loading', amountOut: 0n, amountOutFmt: '…', netAmountOut: 0n, netAmountFmt: '…', feeAmount: 0n, feeFmt: '0', minAmountOut: 0n, poolFee: 500 }
      )

      const registry = getRegistry(chainId)
      if (!registry || !publicClient) {
        setQuote({ status: 'error_network', amountOut: 0n, amountOutFmt: '0', netAmountOut: 0n, netAmountFmt: '0', feeAmount: 0n, feeFmt: '0', minAmountOut: 0n, poolFee: 500, errorMessage: 'Rete non supportata.' })
        return
      }

      // Converti amount → wei
      let amountInWei: bigint
      try {
        amountInWei = tokenIn.isNative ? parseEther(amountIn) : parseUnits(amountIn, tokenIn.decimals)
      } catch {
        setQuote({ status: 'error_amount', amountOut: 0n, amountOutFmt: '0', netAmountOut: 0n, netAmountFmt: '0', feeAmount: 0n, feeFmt: '0', minAmountOut: 0n, poolFee: 500, errorMessage: 'Importo non valido.' })
        return
      }

      // Risolvi ETH → WETH usando il registry della chain corrente
      const addrIn  = resolveAddr(tokenIn,  registry.weth)
      const addrOut = resolveAddr(tokenOut, registry.weth)

      // ── Prova tutti i fee tier in sequenza ─────────────────────────────
      let lastError = ''

      for (const fee of FEE_TIERS) {
        try {
          const result = await publicClient.simulateContract({
            address:      QUOTER_V2_ADDRESS,
            abi:          QUOTER_V2_ABI,
            functionName: 'quoteExactInputSingle',
            args: [{
              tokenIn:           addrIn,
              tokenOut:          addrOut,
              amountIn:          amountInWei,
              fee,
              sqrtPriceLimitX96: 0n,
            }],
          })

          const [amountOut, , , gasEstimate] = result.result as [bigint, bigint, number, bigint]

          // Risposta valida — amountOut > 0
          if (amountOut > 0n) {
            const { net, fee: gatewayFee } = calcSplit(amountOut, feeBps)
            const minAmountOut = applySlippage(net, slippageBps)
            const dec = tokenOut.decimals

            setQuote({
              status:       'success',
              amountOut,
              amountOutFmt: parseFloat(formatUnits(amountOut, dec)).toFixed(dec > 8 ? 6 : dec),
              netAmountOut: net,
              netAmountFmt: parseFloat(formatUnits(net, dec)).toFixed(dec > 8 ? 6 : dec),
              feeAmount:    gatewayFee,
              feeFmt:       parseFloat(formatUnits(gatewayFee, dec)).toFixed(dec > 8 ? 8 : dec),
              minAmountOut,
              poolFee:      fee,      // tier che ha risposto
              gasEstimate,
            })
            return  // successo → esci dal loop
          }
          // amountOut === 0 → pool esiste ma senza liquidità, prova il prossimo tier
          lastError = `Pool ${fee} senza liquidità.`

        } catch (e) {
          // Pool non esiste su questo tier → prova il successivo
          lastError = e instanceof Error ? e.message : String(e)
          continue
        }
      }

      // Tutti i tier falliti → error_liquidity
      setQuote({
        status: 'error_liquidity',
        amountOut: 0n, amountOutFmt: '0',
        netAmountOut: 0n, netAmountFmt: '0',
        feeAmount: 0n, feeFmt: '0',
        minAmountOut: 0n,
        poolFee: 500,
        errorMessage: 'Nessuna pool disponibile per questa coppia. Prova un importo diverso.',
      })

    }, debounceMs)

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }

  }, [chainId, tokenIn?.address, tokenOut?.address, amountIn, feeBps, slippageBps])

  return quote
}

// ── Direct transfer quote (nessuno swap) ──────────────────────────────────
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