'use client'

/**
 * SwapModule.tsx — Uniswap V3 Swap Widget
 *
 * Integrato nella PortfolioDashboard.
 * Usa useSwapQuote per il quoting, writeContract per l'esecuzione,
 * e invia callback al backend per compliance DAC8.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  useAccount, useBalance, useReadContracts,
  useWriteContract, useWaitForTransactionReceipt,
  usePublicClient, useChainId,
} from 'wagmi'
import {
  parseEther, parseUnits, formatEther, formatUnits,
  erc20Abi, type Abi,
} from 'viem'
import { getRegistry, type TokenConfig } from '../lib/contractRegistry'
import { useSwapQuote } from '../lib/useSwapQuote'

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

// ═══════════════════════════════════════════════════════════
//  PALETTE (coerente con dashboard)
// ═══════════════════════════════════════════════════════════
const C = {
  bg:      '#131313',
  surface: '#1b1b1b',
  card:    '#1e1e1e',
  input:   '#141414',
  border:  'rgba(255,255,255,0.07)',
  text:    '#FFFFFF',
  sub:     '#9B9B9B',
  dim:     '#5E5E5E',
  pink:    '#FC74FE',
  green:   '#40B66B',
  red:     '#FD766B',
  blue:    '#4C82FB',
  D:       'var(--font-display)',
  M:       'var(--font-mono)',
}

// ═══════════════════════════════════════════════════════════
//  TOKEN ICON
// ═══════════════════════════════════════════════════════════
const TK: Record<string, string> = {
  ETH:'#627EEA',WETH:'#627EEA',USDC:'#2775CA',USDT:'#26A17B',
  EURC:'#2244aa',cbBTC:'#F7931A',WBTC:'#F7931A',DAI:'#F5AC37',
  DEGEN:'#845ef7',AERO:'#0091FF',LINK:'#2A5ADA',
}
const LOGOS: Record<string, string> = {
  ETH:'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  USDC:'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  USDT:'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  EURC:'https://assets.coingecko.com/coins/images/26045/small/euro-coin.png',
  cbBTC:'https://assets.coingecko.com/coins/images/40143/small/cbbtc.png',
  WBTC:'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
  DAI:'https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png',
  DEGEN:'https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png',
}

function TIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const [err, setErr] = useState(false)
  const logo = LOGOS[symbol]
  const c = TK[symbol] ?? '#5E5E5E'
  if (logo && !err) return (
    <div style={{ width:size, height:size, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.08)', overflow:'hidden', flexShrink:0, background:C.surface }}>
      <img src={logo} alt={symbol} width={size} height={size} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={() => setErr(true)} />
    </div>
  )
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`${c}18`, border:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:C.D, fontSize:size*0.36, fontWeight:700, color:`${c}aa`, flexShrink:0 }}>
      {symbol.slice(0,2)}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  FEE ROUTER ABI (swap functions)
// ═══════════════════════════════════════════════════════════
const FEE_ROUTER_ABI: Abi = [
  { name:'swapAndSend', type:'function', stateMutability:'nonpayable',
    inputs:[{name:'tokenIn',type:'address'},{name:'tokenOut',type:'address'},{name:'amountIn',type:'uint256'},{name:'minAmountOut',type:'uint256'},{name:'recipient',type:'address'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'},{name:'oracleSignature',type:'bytes'}], outputs:[] },
  { name:'swapETHAndSend', type:'function', stateMutability:'payable',
    inputs:[{name:'tokenOut',type:'address'},{name:'minAmountOut',type:'uint256'},{name:'recipient',type:'address'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'},{name:'oracleSignature',type:'bytes'}], outputs:[] },
]

type Phase = 'idle' | 'quoting' | 'approving' | 'signing_oracle' | 'swapping' | 'success' | 'error'

// ═══════════════════════════════════════════════════════════
//  SWAP MODULE
// ═══════════════════════════════════════════════════════════
interface SwapModuleProps {
  onSwapComplete?: () => void
}

export default function SwapModule({ onSwapComplete }: SwapModuleProps) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const reg = getRegistry(chainId)

  // Token state
  const tokens = useMemo(() => {
    if (!reg) return []
    return Object.values(reg.tokens) as TokenConfig[]
  }, [reg])

  const [tokenIn, setTokenIn] = useState<TokenConfig | null>(null)
  const [tokenOut, setTokenOut] = useState<TokenConfig | null>(null)
  const [amount, setAmount] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [selectingFor, setSelectingFor] = useState<'in' | 'out' | null>(null)
  const [slippage, setSlippage] = useState(0.5)
  const [showSettings, setShowSettings] = useState(false)

  // Init default tokens
  useEffect(() => {
    if (!tokens.length) return
    const eth = tokens.find(t => t.isNative) ?? tokens[0]
    const usdc = tokens.find(t => t.symbol === 'USDC') ?? tokens[1] ?? eth
    setTokenIn(eth ?? null)
    setTokenOut(usdc ?? null)
    setAmount('')
    setPhase('idle')
  }, [tokens])

  // Balances
  const { data: ethBal } = useBalance({ address })
  const erc20s = tokens.filter(t => !t.isNative)
  const { data: erc20Bals } = useReadContracts({
    contracts: erc20s.map(t => ({
      address: t.address!, abi: erc20Abi,
      functionName: 'balanceOf' as const, args: [address!],
    })),
    query: { enabled: !!address && erc20s.length > 0 },
  })

  const getBalance = useCallback((t: TokenConfig): bigint => {
    if (t.isNative) return ethBal?.value ?? 0n
    const idx = erc20s.findIndex(e => e.symbol === t.symbol)
    return (erc20Bals?.[idx]?.result as bigint | undefined) ?? 0n
  }, [ethBal, erc20Bals, erc20s])

  const inBal = tokenIn ? getBalance(tokenIn) : 0n
  const inBalFmt = tokenIn ? parseFloat(formatUnits(inBal, tokenIn.decimals)) : 0

  // Parse amount
  const parsedAmount = useMemo((): bigint | null => {
    if (!tokenIn || !amount || isNaN(Number(amount)) || Number(amount) <= 0) return null
    try { return tokenIn.isNative ? parseEther(amount) : parseUnits(amount, tokenIn.decimals) }
    catch { return null }
  }, [tokenIn, amount])

  // Swap quote
  const quote = useSwapQuote({
    chainId,
    tokenIn: tokenIn && tokenOut && tokenIn.address !== tokenOut.address ? tokenIn : null,
    tokenOut: tokenIn && tokenOut && tokenIn.address !== tokenOut.address ? tokenOut : null,
    amountIn: amount,
    slippageBps: Math.round(slippage * 100),
  })

  // TX receipt
  const { writeContractAsync } = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({
    hash: txHash, query: { enabled: !!txHash && phase === 'swapping' },
  })

  useEffect(() => {
    if (isSuccess && phase === 'swapping') {
      setPhase('success')
      sendCallback()
      onSwapComplete?.()
    }
  }, [isSuccess, phase])

  // Flip tokens
  const flip = () => {
    const tmp = tokenIn
    setTokenIn(tokenOut)
    setTokenOut(tmp)
    setAmount('')
  }

  // Percentage buttons
  const setPercentage = (pct: number) => {
    if (!tokenIn) return
    const bal = getBalance(tokenIn)
    let amt: bigint
    if (pct === 100 && tokenIn.isNative) {
      // Reserve gas
      const gasReserve = 50000n * 10000000n // ~0.0005 ETH
      amt = bal > gasReserve ? bal - gasReserve : 0n
    } else {
      amt = (bal * BigInt(pct)) / 100n
    }
    setAmount(formatUnits(amt, tokenIn.decimals))
  }

  // Execute swap
  const handleSwap = async () => {
    if (!parsedAmount || !tokenIn || !tokenOut || !reg || !address) return
    if (!quote || quote.status !== 'success') return

    setError('')

    try {
      // 1. Oracle signature
      setPhase('signing_oracle')
      const oracleRes = await fetch('/api/oracle/sign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: address,
          recipient: address, // swap to self
          tokenIn: tokenIn.isNative ? '0x0000000000000000000000000000000000000000' : tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn: formatUnits(parsedAmount, tokenIn.decimals),
          amountInWei: parsedAmount.toString(),
          symbol: tokenIn.symbol,
          chainId,
        }),
        signal: AbortSignal.timeout(10000),
      })
      const oracle = await oracleRes.json()
      if (!oracle?.approved) {
        setError(oracle?.rejectionReason ?? 'Oracle ha rifiutato la transazione')
        setPhase('error'); return
      }

      // 2. Approve (ERC-20 only)
      if (!tokenIn.isNative) {
        setPhase('approving')
        const appHash = await writeContractAsync({
          address: tokenIn.address!, abi: erc20Abi,
          functionName: 'approve',
          args: [reg.feeRouter, parsedAmount],
        })
        // Wait for approval (simplified)
        await publicClient?.waitForTransactionReceipt({ hash: appHash })
      }

      // 3. Swap
      setPhase('swapping')
      const minOut = quote.minAmountOut

      let hash: `0x${string}`
      if (tokenIn.isNative) {
        hash = await writeContractAsync({
          address: reg.feeRouter, abi: FEE_ROUTER_ABI,
          functionName: 'swapETHAndSend',
          args: [tokenOut.address!, minOut, address, oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline), oracle.oracleSignature as `0x${string}`],
          value: parsedAmount,
        })
      } else {
        hash = await writeContractAsync({
          address: reg.feeRouter, abi: FEE_ROUTER_ABI,
          functionName: 'swapAndSend',
          args: [tokenIn.address!, tokenOut.address!, parsedAmount, minOut, address, oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline), oracle.oracleSignature as `0x${string}`],
        })
      }
      setTxHash(hash)

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('rejected') || msg.includes('denied')) {
        setPhase('idle'); return
      }
      setError(msg.slice(0, 100))
      setPhase('error')
    }
  }

  // Backend callback
  const sendCallback = async () => {
    if (!txHash || !tokenIn || !tokenOut || !address) return
    try {
      await fetch(`${BACKEND}/api/v1/tx/callback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fiscal_ref: `SWAP-${Date.now()}`,
          tx_hash: txHash,
          gross_amount: parseFloat(amount),
          net_amount: quote?.netAmountOut ? parseFloat(formatUnits(quote.netAmountOut, tokenOut.decimals)) : 0,
          fee_amount: quote?.feeAmount ? parseFloat(formatUnits(quote.feeAmount, tokenOut.decimals)) : 0,
          currency: `${tokenIn.symbol}→${tokenOut.symbol}`,
          network: chainId === 8453 ? 'BASE_MAINNET' : chainId === 84532 ? 'BASE_SEPOLIA' : 'BASE',
          status: 'completed',
          recipient: address,
          timestamp: new Date().toISOString(),
          x_signature: 'PENDING_HMAC_SHA256',
          is_testnet: chainId === 84532,
        }),
      })
    } catch { /* silent */ }
  }

  // Derived state
  const insufficient = !!parsedAmount && parsedAmount > inBal
  const noLiquidity = quote?.status === 'error_liquidity'
  const sameToken = tokenIn?.address === tokenOut?.address
  const busy = ['signing_oracle','approving','swapping'].includes(phase)
  const canSwap = isConnected && parsedAmount && !insufficient && !noLiquidity && !sameToken && quote?.status === 'success' && !busy

  const priceImpact = useMemo(() => {
    if (!quote || quote.status !== 'success' || !parsedAmount || !tokenIn || !tokenOut) return null
    // Rough price impact estimation
    const inUsd = parseFloat(amount) * 2150 // simplified
    const outUsd = parseFloat(formatUnits(quote.amountOut, tokenOut.decimals))
    if (inUsd === 0) return null
    const impact = ((inUsd - outUsd) / inUsd) * 100
    return Math.abs(impact)
  }, [quote, parsedAmount, amount, tokenIn, tokenOut])

  // Reset on success
  const reset = () => {
    setPhase('idle'); setAmount(''); setError(''); setTxHash(undefined)
  }

  if (!isConnected || !reg) return null

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontFamily: C.D, fontSize: 16, fontWeight: 600, color: C.text }}>Swap</span>
        <button onClick={() => setShowSettings(s => !s)} style={{
          width: 28, height: 28, borderRadius: 8,
          background: showSettings ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: `1px solid ${C.border}`, color: C.dim, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
        }}>⚙</button>
      </div>

      {/* Slippage settings */}
      {showSettings && (
        <div style={{ marginBottom: 14, padding: '12px 14px', background: C.bg, borderRadius: 14, border: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: C.D, fontSize: 11, color: C.dim, marginBottom: 8 }}>Slippage tolerance</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0.1, 0.5, 1.0].map(s => (
              <button key={s} onClick={() => setSlippage(s)} style={{
                padding: '6px 14px', borderRadius: 10,
                background: slippage === s ? `${C.pink}15` : C.surface,
                border: `1px solid ${slippage === s ? `${C.pink}30` : C.border}`,
                color: slippage === s ? C.pink : C.sub,
                fontFamily: C.M, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>{s}%</button>
            ))}
          </div>
        </div>
      )}

      {/* PAY field */}
      <div style={{ background: C.bg, borderRadius: 16, padding: '16px 16px 12px', marginBottom: 4, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontFamily: C.D, fontSize: 12, color: C.dim }}>You pay</span>
          <span style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}>
            Balance: {inBalFmt.toFixed(4)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="number" placeholder="0" min="0" step="any"
            value={amount} onChange={e => { setAmount(e.target.value); setPhase('idle') }}
            disabled={busy}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: C.D, fontSize: 28, fontWeight: 500, color: C.text,
              minWidth: 0,
            }}
          />
          <button onClick={() => setSelectingFor('in')} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px 6px 6px', borderRadius: 20,
            background: C.surface, border: `1px solid ${C.border}`,
            cursor: 'pointer',
          }}>
            {tokenIn && <TIcon symbol={tokenIn.symbol} size={24} />}
            <span style={{ fontFamily: C.D, fontSize: 14, fontWeight: 600, color: C.text }}>
              {tokenIn?.symbol ?? 'Select'}
            </span>
            <span style={{ color: C.dim, fontSize: 10 }}>▾</span>
          </button>
        </div>
        {/* Percentage buttons */}
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          {[25, 50, 75, 100].map(p => (
            <button key={p} onClick={() => setPercentage(p)} style={{
              padding: '4px 10px', borderRadius: 8,
              background: C.surface, border: `1px solid ${C.border}`,
              color: C.dim, fontFamily: C.M, fontSize: 10, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
            onMouseLeave={e => { e.currentTarget.style.color = C.dim; e.currentTarget.style.borderColor = C.border }}
            >{p === 100 ? 'Max' : `${p}%`}</button>
          ))}
        </div>
      </div>

      {/* Flip button */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0', position: 'relative', zIndex: 2 }}>
        <button onClick={flip} disabled={busy} style={{
          width: 36, height: 36, borderRadius: 10,
          background: C.surface, border: `2px solid ${C.bg}`,
          color: C.sub, cursor: busy ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, transition: 'transform 0.3s ease',
        }}
        onMouseEnter={e => { if (!busy) e.currentTarget.style.transform = 'rotate(180deg)' }}
        onMouseLeave={e => e.currentTarget.style.transform = 'rotate(0)'}
        >↓</button>
      </div>

      {/* RECEIVE field */}
      <div style={{ background: C.bg, borderRadius: 16, padding: '16px 16px 14px', marginTop: 4, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontFamily: C.D, fontSize: 12, color: C.dim }}>You receive</span>
          {quote?.poolFee && (
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
              Pool: {quote.poolFee === 100 ? '0.01%' : quote.poolFee === 500 ? '0.05%' : quote.poolFee === 3000 ? '0.3%' : '1%'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            flex: 1, fontFamily: C.D, fontSize: 28, fontWeight: 500,
            color: quote?.status === 'loading' ? C.dim : C.text,
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {quote?.status === 'loading' ? '…'
              : quote?.status === 'success' ? quote.netAmountFmt
              : '0'}
          </span>
          <button onClick={() => setSelectingFor('out')} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px 6px 6px', borderRadius: 20,
            background: C.surface, border: `1px solid ${C.border}`,
            cursor: 'pointer',
          }}>
            {tokenOut && <TIcon symbol={tokenOut.symbol} size={24} />}
            <span style={{ fontFamily: C.D, fontSize: 14, fontWeight: 600, color: C.text }}>
              {tokenOut?.symbol ?? 'Select'}
            </span>
            <span style={{ color: C.dim, fontSize: 10 }}>▾</span>
          </button>
        </div>
      </div>

      {/* Quote details */}
      {quote?.status === 'success' && tokenOut && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: C.bg, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>Fee (0.5%)</span>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{quote.feeFmt} {tokenOut.symbol}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>Min. received</span>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>
              {formatUnits(quote.minAmountOut, tokenOut.decimals).slice(0, 10)} {tokenOut.symbol}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>Slippage</span>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{slippage}%</span>
          </div>
          {priceImpact !== null && priceImpact > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: C.M, fontSize: 10, color: priceImpact > 5 ? C.red : C.dim }}>Price impact</span>
              <span style={{ fontFamily: C.M, fontSize: 10, color: priceImpact > 5 ? C.red : C.sub }}>~{priceImpact.toFixed(2)}%</span>
            </div>
          )}
          {quote.gasEstimate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>Gas estimate</span>
              <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>~{quote.gasEstimate.toString()} units</span>
            </div>
          )}
        </div>
      )}

      {/* Error / Liquidity warning */}
      {noLiquidity && (
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 12, background: `${C.red}08`, border: `1px solid ${C.red}20` }}>
          <span style={{ fontFamily: C.D, fontSize: 11, color: C.red }}>{quote?.errorMessage ?? 'Liquidità insufficiente'}</span>
        </div>
      )}
      {phase === 'error' && error && (
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 12, background: `${C.red}08`, border: `1px solid ${C.red}20` }}>
          <span style={{ fontFamily: C.D, fontSize: 11, color: C.red }}>{error}</span>
        </div>
      )}

      {/* Success */}
      {phase === 'success' && txHash && (
        <div style={{ marginTop: 10, padding: '14px', borderRadius: 14, background: `${C.green}08`, border: `1px solid ${C.green}20`, textAlign: 'center' as const }}>
          <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 600, color: C.green, marginBottom: 6 }}>Swap completato ✓</div>
          <a href={`${reg?.blockExplorer ?? 'https://basescan.org'}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: C.M, fontSize: 10, color: C.sub, textDecoration: 'underline' }}>
            Vedi su Explorer ↗
          </a>
          <div style={{ marginTop: 8 }}>
            <button onClick={reset} style={{
              padding: '8px 20px', borderRadius: 12,
              background: C.surface, border: `1px solid ${C.border}`,
              color: C.text, fontFamily: C.D, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>Nuovo Swap</button>
          </div>
        </div>
      )}

      {/* CTA Button */}
      {phase !== 'success' && (
        <button onClick={handleSwap} disabled={!canSwap} style={{
          width: '100%', marginTop: 14, padding: '16px',
          borderRadius: 16, border: 'none',
          background: !canSwap
            ? 'rgba(255,255,255,0.04)'
            : `linear-gradient(135deg, ${C.pink}, #c850c0)`,
          color: !canSwap ? C.dim : '#fff',
          fontFamily: C.D, fontSize: 16, fontWeight: 700,
          cursor: canSwap ? 'pointer' : 'not-allowed',
          transition: 'all 0.2s',
          boxShadow: canSwap ? `0 4px 20px ${C.pink}30` : 'none',
        }}>
          {busy ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span className="rp-spinner" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%' }} />
              {phase === 'signing_oracle' ? 'AML Check…'
                : phase === 'approving' ? 'Approvazione…'
                : 'Swapping…'}
            </span>
          ) : insufficient ? 'Saldo insufficiente'
            : sameToken ? 'Seleziona token diversi'
            : noLiquidity ? 'Liquidità insufficiente'
            : !parsedAmount ? 'Inserisci importo'
            : 'Swap'}
        </button>
      )}

      {/* Token Selector Modal */}
      {selectingFor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setSelectingFor(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{
            position: 'relative', width: 340, maxHeight: 400,
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)', overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, fontFamily: C.D, fontSize: 14, fontWeight: 600, color: C.text }}>
              Select token
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {tokens.map(t => (
                <button key={t.symbol} onClick={() => {
                  if (selectingFor === 'in') setTokenIn(t)
                  else setTokenOut(t)
                  setSelectingFor(null)
                  setAmount('')
                }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 18px', background: 'transparent', border: 'none',
                  borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                  textAlign: 'left' as const, transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <TIcon symbol={t.symbol} size={32} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: C.D, fontSize: 14, fontWeight: 600, color: C.text }}>{t.symbol}</div>
                    <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>{t.name}</div>
                  </div>
                  <span style={{ fontFamily: C.M, fontSize: 11, color: C.sub }}>
                    {parseFloat(formatUnits(getBalance(t), t.decimals)).toFixed(4)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}