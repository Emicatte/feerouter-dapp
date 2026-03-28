'use client'


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
//  PALETTE
// ═══════════════════════════════════════════════════════════
const C = {
  bg:      '#080810',
  surface: '#0d0d1a',
  card:    '#0c0c1e',
  input:   '#080810',
  border:  'rgba(255,255,255,0.06)',
  text:    '#ffffff',
  sub:     'rgba(255,255,255,0.80)',
  dim:     'rgba(255,255,255,0.90)',
  pink:    '#ff007a',
  green:   '#00ffa3',
  red:     '#ff2d55',
  blue:    '#3B82F6',
  purple:  '#a78bfa',
  amber:   '#ffb800',
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
//  FEE ROUTER ABI 
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
interface PortfolioAsset {
  symbol: string; balance: number; decimals: number
  contractAddress: string; logo?: string | null
}

interface SwapModuleProps {
  onSwapComplete?: () => void
  portfolioAssets?: PortfolioAsset[]
  noCard?: boolean
}

export default function SwapModule({ onSwapComplete, portfolioAssets, noCard }: SwapModuleProps) {
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

  // Balances — prefer portfolio data, fallback to RPC
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
    // 1. Try portfolio data first (most reliable, already fetched from Alchemy)
    if (portfolioAssets?.length) {
      const pa = portfolioAssets.find(a =>
        a.symbol === t.symbol ||
        (a.contractAddress?.toLowerCase() === t.address?.toLowerCase() && t.address !== '0x0000000000000000000000000000000000000000')
      )
      if (pa && pa.balance > 0) {
        return BigInt(Math.round(pa.balance * (10 ** (t.decimals ?? 18))))
      }
    }

    // 2. Fallback: RPC data
    if (t.isNative) return ethBal?.value ?? 0n
    const idx = erc20s.findIndex(e => e.symbol === t.symbol)
    if (idx >= 0) {
      const val = erc20Bals?.[idx]?.result as bigint | undefined
      if (val && val > 0n) return val
    }

    return 0n
  }, [ethBal, erc20Bals, erc20s, portfolioAssets])

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

  const cardStyle = noCard ? {} : { background: 'rgba(8,12,30,0.72)', backdropFilter: 'blur(32px) saturate(180%)', WebkitBackdropFilter: 'blur(32px) saturate(180%)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 8px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.15)' }
  return (
    <div style={cardStyle}>
      <div style={{ padding: '10px 10px 10px' }}>

        {/* ── SELL ─────────────────────────────────────────────── */}
        <div className="rp-anim-1">
          <div style={{
            borderRadius: 14, background: 'rgba(255,255,255,0.05)', padding: '14px',
            border: '1.5px solid rgba(255,255,255,0.14)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
          }}>
            {/* Top row: label + balance */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: C.D, fontSize: 13, fontWeight: 600, color: C.dim }}>Sell</span>
              {tokenIn && (
                <span style={{ fontFamily: C.M, fontSize: 12, color: C.dim }}>
                  {inBalFmt.toFixed(4)} {tokenIn.symbol}
                </span>
              )}
            </div>
            {/* Bottom row: token pill LEFT — amount RIGHT */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => setSelectingFor('in')} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 13px 9px 9px', borderRadius: 18,
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              >
                {tokenIn && <TIcon symbol={tokenIn.symbol} size={22} />}
                <span style={{ fontFamily: C.D, fontSize: 15, fontWeight: 700, color: C.text }}>{tokenIn?.symbol ?? '—'}</span>
                <span style={{ color: C.dim, fontSize: 9 }}>▾</span>
              </button>
              <div style={{ flex: 1, textAlign: 'right' as const }}>
                <input
                  type="number" placeholder="0.00" min="0" step="any"
                  value={amount} onChange={e => { setAmount(e.target.value); setPhase('idle') }}
                  disabled={busy}
                  style={{
                    fontFamily: C.D, fontSize: 30, fontWeight: 400, letterSpacing: '-0.02em',
                    width: '100%', background: 'transparent', border: 'none', outline: 'none',
                    color: busy ? C.dim : C.text, textAlign: 'right' as const,
                  }}
                />
              </div>
            </div>
            {/* Percentage buttons */}
            <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => setPercentage(p)} style={{
                  padding: '4px 10px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
                  color: C.dim, fontFamily: C.M, fontSize: 10, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.dim; e.currentTarget.style.borderColor = C.border }}
                >{p === 100 ? 'Max' : `${p}%`}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Swap arrow ───────────────────────────────────────── */}
        <div className="rp-anim-2" style={{ display: 'flex', justifyContent: 'center', margin: '-4px 0', position: 'relative', zIndex: 2 }}>
          <button onClick={flip} disabled={busy} style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            border: '1.5px solid rgba(255,255,255,0.18)',
            color: C.dim, fontSize: 16, cursor: busy ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s ease', boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.10)',
          }}
            onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = C.text } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = C.dim }}
          >⇅</button>
        </div>

        {/* ── BUY / RECEIVE ────────────────────────────────────── */}
        <div className="rp-anim-2">
          <div style={{
            borderRadius: 14, background: 'rgba(255,255,255,0.05)', padding: '14px',
            border: '1.5px solid rgba(255,255,255,0.14)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
          }}>
            {/* Top row: label + pool fee */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: C.D, fontSize: 13, fontWeight: 600, color: C.dim }}>Buy</span>
              {quote?.poolFee && (
                <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
                  Pool: {quote.poolFee === 100 ? '0.01%' : quote.poolFee === 500 ? '0.05%' : quote.poolFee === 3000 ? '0.3%' : '1%'}
                </span>
              )}
            </div>
            {/* Bottom row: token pill LEFT — amount RIGHT */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={() => setSelectingFor('out')} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 13px 9px 9px', borderRadius: 18,
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              >
                {tokenOut && <TIcon symbol={tokenOut.symbol} size={22} />}
                <span style={{ fontFamily: C.D, fontSize: 15, fontWeight: 700, color: C.text }}>{tokenOut?.symbol ?? '—'}</span>
                <span style={{ color: C.dim, fontSize: 9 }}>▾</span>
              </button>
              <div style={{ flex: 1, textAlign: 'right' as const }}>
                <span style={{
                  fontFamily: C.D, fontSize: 30, fontWeight: 400, letterSpacing: '-0.02em',
                  color: quote?.status === 'loading' ? C.dim : C.text, display: 'block',
                }}>
                  {quote?.status === 'loading' ? '…'
                    : quote?.status === 'success' ? quote.netAmountFmt
                    : '0'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Quote details (collapsible) ────────────────────── */}
        {quote?.status === 'success' && tokenOut && (
          <div className="rp-anim-3" style={{ marginTop: 6, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: `1px solid ${C.border}` }}>
            {[
              { l: 'Fee (0.5%)', v: `${quote.feeFmt} ${tokenOut.symbol}` },
              { l: 'Min. received', v: `${formatUnits(quote.minAmountOut, tokenOut.decimals).slice(0, 10)} ${tokenOut.symbol}` },
              { l: 'Slippage', v: `${slippage}%` },
              ...(priceImpact !== null && priceImpact > 1 ? [{ l: 'Price impact', v: `~${priceImpact.toFixed(2)}%` }] : []),
              ...(quote.gasEstimate ? [{ l: 'Gas estimate', v: `~${quote.gasEstimate.toString()} units` }] : []),
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: i < 4 ? 4 : 0 }}>
                <span style={{ fontFamily: C.M, fontSize: 10, color: r.l === 'Price impact' && priceImpact && priceImpact > 5 ? C.red : C.dim }}>{r.l}</span>
                <span style={{ fontFamily: C.M, fontSize: 10, color: r.l === 'Price impact' && priceImpact && priceImpact > 5 ? C.red : C.sub }}>{r.v}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Slippage settings (inline, toggled) ────────────── */}
        {showSettings && (
          <div className="rp-anim-3" style={{ marginTop: 6, padding: '12px 14px', background: 'rgba(255,255,255,0.025)', borderRadius: 14, border: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: C.D, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: C.dim, marginBottom: 8 }}>Slippage</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[0.1, 0.5, 1.0].map(s => (
                <button key={s} onClick={() => setSlippage(s)} style={{
                  padding: '6px 14px', borderRadius: 10,
                  background: slippage === s ? `${C.purple}15` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${slippage === s ? `${C.purple}30` : C.border}`,
                  color: slippage === s ? C.purple : C.sub,
                  fontFamily: C.M, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>{s}%</button>
              ))}
            </div>
          </div>
        )}

        {/* ── Errors / warnings ──────────────────────────────── */}
        {noLiquidity && (
          <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 12, background: `${C.red}08`, border: `1px solid ${C.red}20` }}>
            <span style={{ fontFamily: C.D, fontSize: 11, color: C.red }}>{quote?.errorMessage ?? 'Liquidità insufficiente'}</span>
          </div>
        )}
        {phase === 'error' && error && (
          <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 12, background: `${C.red}08`, border: `1px solid ${C.red}20` }}>
            <span style={{ fontFamily: C.D, fontSize: 11, color: C.red }}>{error}</span>
          </div>
        )}

        {/* ── Success ────────────────────────────────────────── */}
        {phase === 'success' && txHash && (
          <div style={{ marginTop: 6, padding: '14px', borderRadius: 14, background: `${C.green}08`, border: `1px solid ${C.green}20`, textAlign: 'center' as const }}>
            <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 600, color: C.green, marginBottom: 6 }}>Swap completato ✓</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 6, background: `${C.purple}08`, border: `1px solid ${C.purple}15`, marginBottom: 8 }}>
              <span style={{ fontFamily: C.M, fontSize: 9, color: C.purple }}>DAC8 — Registrato nel report fiscale</span>
            </div>
            <div>
              <a href={`${reg?.blockExplorer ?? 'https://basescan.org'}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: C.M, fontSize: 10, color: C.sub, textDecoration: 'underline' }}>
                Vedi su Explorer ↗
              </a>
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={reset} style={{
                padding: '8px 20px', borderRadius: 12,
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
                color: C.text, fontFamily: C.D, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
              }}>Nuovo Swap</button>
            </div>
          </div>
        )}

        {/* ── CTA BUTTON ─────────────────────────────────────── */}
        {phase !== 'success' && (
          <button onClick={handleSwap} disabled={!canSwap} style={{
            width: '100%', marginTop: 8, padding: '18px',
            borderRadius: 14, border: 'none',
            background: canSwap
              ? `linear-gradient(135deg, ${C.purple}, #c084fc)`
              : 'rgba(255,255,255,0.04)',
            color: canSwap ? '#fff' : `${C.dim}80`,
            fontFamily: C.D, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em',
            cursor: canSwap ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            boxShadow: canSwap ? `0 4px 20px ${C.purple}25` : 'none',
          }}>
            {busy ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span className="rp-spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%' }} />
                {phase === 'signing_oracle' ? 'AML Check…'
                  : phase === 'approving' ? 'Approvazione…'
                  : 'Swapping…'}
              </span>
            ) : insufficient ? 'Saldo insufficiente'
              : sameToken ? 'Seleziona token diversi'
              : noLiquidity ? 'Liquidità insufficiente'
              : !parsedAmount ? 'Inserisci importo'
              : `Swap ${tokenIn?.symbol} → ${tokenOut?.symbol}`}
          </button>
        )}

        {/* ── Settings toggle (bottom-right, subtle) ─────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 8, paddingRight: 2 }}>
          <button onClick={() => setShowSettings(s => !s)} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: C.M, fontSize: 10, color: showSettings ? C.purple : C.dim,
            transition: 'color 0.15s', padding: '2px 0',
          }}
            onMouseEnter={e => e.currentTarget.style.color = C.text}
            onMouseLeave={e => e.currentTarget.style.color = showSettings ? C.purple : C.dim}
          >
            ⚙ {slippage}% slippage
          </button>
        </div>
      </div>

      {/* ── Token Selector Modal ───────────────────────────── */}
      {selectingFor && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setSelectingFor(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
          <div style={{
            position: 'relative', width: 380, maxHeight: 420,
            background: '#111120', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span style={{ fontFamily: C.D, fontSize: 15, fontWeight: 800, color: C.text }}>Seleziona token</span>
              <button onClick={() => setSelectingFor(null)} style={{
                width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.06)',
                border: 'none', color: C.dim, cursor: 'pointer', fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✕</button>
            </div>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {[...tokens]
                .sort((a, b) => {
                  const bA = Number(getBalance(a)) / (10 ** a.decimals)
                  const bB = Number(getBalance(b)) / (10 ** b.decimals)
                  return bB - bA
                })
                .map((t, i, arr) => {
                  const bal = getBalance(t)
                  const balFmt = parseFloat(formatUnits(bal, t.decimals))
                  return (
                    <button key={t.symbol} onClick={() => {
                      if (selectingFor === 'in') setTokenIn(t)
                      else setTokenOut(t)
                      setSelectingFor(null)
                      setAmount('')
                    }} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                      padding: '13px 18px', background: 'transparent', border: 'none',
                      borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      cursor: 'pointer', transition: 'background 0.12s', textAlign: 'left' as const,
                      opacity: balFmt > 0 ? 1 : 0.5,
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <TIcon symbol={t.symbol} size={36} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: C.D, fontSize: 15, fontWeight: 700, color: C.text }}>{t.symbol}</div>
                        <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim, marginTop: 2 }}>{t.name}</div>
                      </div>
                      <div style={{ textAlign: 'right' as const }}>
                        <div style={{ fontFamily: C.M, fontSize: 13, fontWeight: 600, color: balFmt > 0 ? C.text : C.dim }}>
                          {balFmt > 0 ? balFmt.toFixed(4) : '0'}
                        </div>
                        <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginTop: 1 }}>{t.symbol}</div>
                      </div>
                    </button>
                  )
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}