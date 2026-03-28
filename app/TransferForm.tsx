'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  useAccount, useBalance, useReadContracts,
  useWriteContract, useWaitForTransactionReceipt,
  usePublicClient, useChainId, useSwitchChain,
} from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  parseEther, parseUnits, formatEther, formatUnits,
  erc20Abi, isAddress, getAddress, type Abi,
} from 'viem'
import { baseSepolia } from 'wagmi/chains'
import {
  TransactionStatusUI, AddressVerifier, BallisticProgress, MicroStateBadge,
} from './TransactionStatus'
import { useComplianceEngine, type ComplianceRecord } from '../lib/useComplianceEngine'
import { useComplianceAPI }   from '../lib/useComplianceAPI'
import { generatePdfReceipt } from '../lib/usePdfReceipt'
import {
  getRegistry, findChainForToken, EUR_RATES,
  type TokenConfig, type NetworkRegistry,
} from '../lib/contractRegistry'
import { useSwapQuote, useDirectQuote } from '../lib/useSwapQuote'
import { useBackendCallback } from '../lib/useBackendCallback'

// ── Theme ──────────────────────────────────────────────────────────────────
const T = {
  bg:      '#080810',
  surface: '#0d0d1a',
  card:    '#0c0c1e',
  border:  'rgba(255,255,255,0.06)',
  emerald: '#00ffa3',
  red:     '#ff2d55',
  amber:   '#ffb800',
  pink:    '#ff007a',
  purple:  '#a78bfa',
  muted:   'rgba(255,255,255,0.90)',
  text:    '#ffffff',
  D:       'var(--font-display)',
  M:       'var(--font-mono)',
}

// ── ABI FeeRouterV4 ────────────────────────────────────────────────────────
const FEE_ROUTER_ABI: Abi = [
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
]

type Phase    = 'idle' | 'preflight' | 'approving' | 'wait_approve' | 'signing' | 'wait_send' | 'done' | 'error'
type CtaState = 'disconnected' | 'wrong_network' | 'insufficient' | 'no_recipient' | 'no_amount' | 'oracle_denied' | 'no_liquidity' | 'ready' | 'busy'
type SelectingToken = 'in' | 'out' | null

interface OracleResponse {
  approved: boolean
  oracleSignature: string; oracleNonce: string; oracleDeadline: number
  paymentRef: string; fiscalRef: string
  riskScore: number; riskLevel: string; dac8Reportable: boolean
  eurValue?: number; isEurc?: boolean; isSwap?: boolean
  sourceChain?: string; gasless?: boolean; rejectionReason?: string
}

function txLog(event: string, data: Record<string, unknown>) {
  const entry = { event, ts: new Date().toISOString(), ...data }
  console.log('[rp_tx]', JSON.stringify(entry))
  try {
    const raw = localStorage.getItem('rp_tx_history')
    const h: unknown[] = raw ? JSON.parse(raw) : []
    h.push(entry); if (h.length > 200) h.splice(0, h.length - 200)
    localStorage.setItem('rp_tx_history', JSON.stringify(h))
  } catch { /* SSR */ }
}

// ── Token Logo ─────────────────────────────────────────────────────────────
function TokenLogo({ token, size = 24 }: {
  token: Pick<TokenConfig, 'symbol' | 'logoURI' | 'isNative'>
  size?: number
}) {
  const [err, setErr] = useState(false)
  const colorMap: Record<string, string> = {
    ETH:'#627EEA', USDC:'#2775CA', USDT:'#26A17B',
    EURC:'#0033cc', cbBTC:'#F7931A', WBTC:'#F7931A',
    DEGEN:'#845ef7', WETH:'#627EEA',
  }
  const color = colorMap[token.symbol] ?? '#4a4a6a'
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', overflow:'hidden', flexShrink:0, background:err?color:'transparent', display:'flex', alignItems:'center', justifyContent:'center', border:'1.5px solid rgba(255,255,255,0.1)' }}>
      {!err
        ? <img src={token.logoURI} alt={token.symbol} width={size} height={size}
            style={{ width:'100%', height:'100%', objectFit:'cover' }}
            onError={() => setErr(true)} />
        : <span style={{ fontSize:size*0.36, fontWeight:800, color:'#fff', fontFamily:T.D }}>
            {token.symbol.slice(0,2)}
          </span>
      }
    </div>
  )
}

// ── Token Pill — bottone nel form che apre la modale ──────────────────────
function TokenPill({ token, onClick, accentColor, busy }: {
  token: (TokenConfig & { balance: bigint }) | null
  onClick: () => void
  accentColor?: string
  busy: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const accent = accentColor ?? T.emerald
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); if (!busy) onClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 13px 9px 9px', borderRadius: 18,
        background: hovered && !busy ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
        border: `1px solid ${hovered && !busy ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)'}`,
        cursor: busy ? 'default' : 'pointer',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
    >
      {token && <TokenLogo token={token} size={22} />}
      <span style={{ fontFamily:T.D, fontSize:15, fontWeight:700, color:T.text, letterSpacing:'-0.01em' }}>
        {token?.symbol ?? '—'}
      </span>
      {!busy && (
        <span style={{ color:T.muted, fontSize:9, display:'inline-block' }}>▾</span>
      )}
    </button>
  )
}

// ── Token Selector Modal — background solido opaco ────────────────────────
function TokenSelectorModal({ tokens, onSelect, onClose, title }: {
  tokens: (TokenConfig & { balance: bigint })[]
  onSelect: (t: TokenConfig & { balance: bigint }) => void
  onClose: () => void
  title: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Chiudi cliccando fuori
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Slight delay per evitare che il click che apre la modale la chiuda subito
    const timer = setTimeout(() => document.addEventListener('mousedown', h), 50)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', h) }
  }, [onClose])

  // Chiudi con ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const fmtBal = (t: TokenConfig & { balance: bigint }) => {
    const v = parseFloat(formatUnits(t.balance, t.decimals))
    return ['USDC','USDT','EURC'].includes(t.symbol) ? v.toFixed(2)
      : t.symbol === 'cbBTC' || t.symbol === 'WBTC' ? v.toFixed(6)
      : v.toFixed(4)
  }

  return (
    // Overlay semitrasparente
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      {/* Modale — background SOLIDO, nessuna trasparenza */}
      <div
        ref={ref}
        style={{
          width: '100%', maxWidth: 380,
          background: '#111120',           // T.card — solido
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 20,
          boxShadow: '0 24px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)',
          overflow: 'hidden',
          animation: 'rpFadeUp 0.2s var(--ease-spring) both',
        }}
      >
        {/* Header modale */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontFamily:T.D, fontSize:15, fontWeight:800, color:T.text, letterSpacing:'-0.01em' }}>
            {title}
          </span>
          <button
            onClick={onClose}
            style={{ width:30, height:30, borderRadius:8, background:'rgba(255,255,255,0.06)', border:'none', color:T.muted, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.06)'}
          >✕</button>
        </div>

        {/* Lista token */}
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {tokens.map((t, i) => (
            <button
              key={t.symbol}
              type="button"
              onClick={() => { onSelect(t); onClose() }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                padding: '13px 18px',
                background: 'transparent',
                border: 'none',
                borderBottom: i < tokens.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                cursor: 'pointer',
                transition: 'background 0.12s ease',
                textAlign: 'left' as const,
              }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}
            >
              <TokenLogo token={t} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <span style={{ fontFamily:T.D, fontSize:15, fontWeight:700, color:T.text }}>
                    {t.symbol}
                  </span>
                  {t.isEurc && (
                    <span style={{ fontFamily:T.D, fontSize:9, fontWeight:700, color:'#6699ff', background:'rgba(0,51,204,0.15)', padding:'2px 6px', borderRadius:4, border:'1px solid rgba(0,51,204,0.3)' }}>
                      ★ EU
                    </span>
                  )}
                  {t.gasless && !t.isEurc && (
                    <span style={{ fontFamily:T.D, fontSize:9, color:T.emerald, background:'rgba(0,255,163,0.1)', padding:'2px 6px', borderRadius:4 }}>
                      ⛽ Gasless
                    </span>
                  )}
                </div>
                <div style={{ fontFamily:T.M, fontSize:11, color:T.muted, marginTop:2 }}>
                  {t.name}
                </div>
              </div>
              <div style={{ textAlign:'right' as const }}>
                <div style={{ fontFamily:T.M, fontSize:13, fontWeight:600, color:T.text }}>
                  {fmtBal(t)}
                </div>
                <div style={{ fontFamily:T.M, fontSize:10, color:T.muted, marginTop:1 }}>
                  {t.symbol}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Toast ──────────────────────────────────────────────────────────────────
function Toast({ message, color=T.amber, onDismiss }: { message:string; color?:string; onDismiss:()=>void }) {
  useEffect(() => { const t = setTimeout(onDismiss, 5000); return () => clearTimeout(t) }, [onDismiss])
  return (
    <div className="rp-toast" style={{ position:'fixed', bottom:24, left:'50%', zIndex:9999, minWidth:280, maxWidth:440, background:T.card, border:`1px solid ${color}30`, borderRadius:14, padding:'13px 18px', display:'flex', alignItems:'center', gap:10, boxShadow:`0 12px 40px rgba(0,0,0,0.8)` }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:color, boxShadow:`0 0 8px ${color}`, flexShrink:0 }} />
      <span style={{ fontFamily:T.D, fontSize:13, color:T.text, flex:1 }}>{message}</span>
      <button onClick={onDismiss} style={{ color:T.muted, background:'none', border:'none', cursor:'pointer', fontSize:16, padding:0 }}>✕</button>
    </div>
  )
}

// ── Quote Panel ────────────────────────────────────────────────────────────
function QuotePanel({ quote, tokenOut, isSwap }: {
  quote: ReturnType<typeof useSwapQuote>
  tokenOut: TokenConfig | null
  isSwap: boolean
}) {
  if (!quote || !isSwap) return null
  const { status, netAmountFmt, feeFmt, minAmountOut, poolFee, errorMessage, gasEstimate } = quote

  if (status === 'loading') return (
    <div style={{ padding:'12px 14px', borderRadius:12, background:'rgba(167,139,250,0.06)', border:`1px solid rgba(167,139,250,0.2)`, display:'flex', alignItems:'center', gap:10 }}>
      <div className="rp-spinner" style={{ width:14, height:14, border:`2px solid ${T.purple}30`, borderTopColor:'transparent', borderRadius:'50%' }} />
      <span style={{ fontFamily:T.D, fontSize:13, color:T.purple }}>Calcolando quotazione Uniswap V3…</span>
    </div>
  )

  if (status === 'error_liquidity' || status === 'error_network') return (
    <div style={{ padding:'12px 14px', borderRadius:12, background:`${T.amber}0a`, border:`1px solid ${T.amber}30` }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span>⚠️</span>
        <span style={{ fontFamily:T.D, fontSize:12, fontWeight:700, color:T.amber }}>
          {status === 'error_liquidity' ? 'Pool con liquidità insufficiente' : 'Quotazione non disponibile'}
        </span>
      </div>
      <div style={{ fontFamily:T.D, fontSize:11, color:T.muted, marginTop:4, paddingLeft:20 }}>{errorMessage}</div>
    </div>
  )

  if (status !== 'success' || !tokenOut) return null

  const poolFeeLabel = poolFee === 100 ? '0.01%' : poolFee === 500 ? '0.05%' : poolFee === 3000 ? '0.3%' : '1%'

  return (
    <div style={{ borderRadius:13, overflow:'hidden', border:`1px solid rgba(167,139,250,0.2)`, animation:'rpFadeUp 0.3s var(--ease-spring) both' }}>
      <div style={{ padding:'8px 14px', background:'rgba(167,139,250,0.08)', fontFamily:T.D, fontSize:11, fontWeight:700, color:T.purple, borderBottom:`1px solid rgba(167,139,250,0.15)`, letterSpacing:'0.04em' }}>
        ⚡ Uniswap V3 Quote · Pool {poolFeeLabel}
      </div>
      {[
        { l: 'Il destinatario riceverà ~', v: `${netAmountFmt} ${tokenOut.symbol}`, h: true },
        { l: 'Slippage minimo garantito',  v: `${formatUnits(minAmountOut, tokenOut.decimals).slice(0,10)} ${tokenOut.symbol} (0.5%)`, h: false },
        { l: 'Gateway fee (0.5%)',          v: `${feeFmt} ${tokenOut.symbol}`, h: false },
        ...(gasEstimate ? [{ l: 'Gas stimato swap', v: `~${gasEstimate.toString()} units`, h: false }] : []),
      ].map((r, i, arr) => (
        <div key={i} style={{ display:'flex', borderLeft:`2px dashed rgba(167,139,250,0.15)` }}>
          <div style={{ width:'45%', padding:'7px 0 7px 14px', fontFamily:T.D, fontSize:11, fontWeight:500, color:T.muted, borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none' }}>{r.l}</div>
          <div style={{ width:'55%', padding:'7px 14px', fontFamily:T.M, fontSize:11, fontWeight:r.h?700:500, color:r.h?T.purple:T.muted, borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none' }}>{r.v}</div>
        </div>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
export default function TransferForm({ noCard }: { noCard?: boolean }): React.JSX.Element {
  const { address, isConnected } = useAccount()
  const chainId                  = useChainId()
  const { switchChain }          = useSwitchChain()
  const publicClient             = usePublicClient()
  const { generateRecord }       = useComplianceEngine()
  const complianceApi            = useComplianceAPI()
  const sendBackend              = useBackendCallback()

  // ── Registry ──────────────────────────────────────────────────────────
  const [registry,  setRegistry]  = useState<NetworkRegistry | null>(null)
  const [tokenList, setTokenList] = useState<(TokenConfig & { balance: bigint })[]>([])
  const [tokenIn,   setTokenIn]   = useState<(TokenConfig & { balance: bigint }) | null>(null)
  const [tokenOut,  setTokenOut]  = useState<(TokenConfig & { balance: bigint }) | null>(null)

  // ── isSwapMode — auto-detection (niente useState) ─────────────────────
  // Direct se stesso token (stesso address) — Swap se token diversi
  const isSwapMode = !!(tokenIn && tokenOut && tokenIn.address !== tokenOut.address)

  // ── Token selector modal ───────────────────────────────────────────────
  const [selectingToken, setSelectingToken] = useState<SelectingToken>(null)

  // ── Form ───────────────────────────────────────────────────────────────
  const [amount,     setAmount]     = useState('')
  const [recipient,  setRecipient]  = useState('')
  const [focused,    setFocused]    = useState(false)
  const [addrError,  setAddrError]  = useState('')
  const [showExtras, setShowExtras] = useState(false)
  const [paymentRef, setPaymentRef] = useState('')
  const [fiscalRef,  setFiscalRef]  = useState('')
  const [copied,     setCopied]     = useState(false)
  const [toast,      setToast]      = useState<{ msg: string; color?: string } | null>(null)

  // ── Oracle ─────────────────────────────────────────────────────────────
  const [oracleData,     setOracleData]     = useState<OracleResponse | null>(null)
  const [oracleDenied,   setOracleDenied]   = useState(false)
  const [oracleChecking, setOracleChecking] = useState(false)
  const [needsApproval,  setNeedsApproval]  = useState(false)

  // ── TX ─────────────────────────────────────────────────────────────────
  const [phase,      setPhase]      = useState<Phase>('idle')
  const [approvHash, setApprovHash] = useState<`0x${string}` | undefined>()
  const [sendHash,   setSendHash]   = useState<`0x${string}` | undefined>()
  const [txError,    setTxError]    = useState('')
  const [report,     setReport]     = useState<{
    gross: bigint; net: bigint; fee: bigint
    decimals: number; symbol: string
    txHash: `0x${string}`; timestamp: string; eurValue?: string
  } | null>(null)
  const [compRec, setCompRec] = useState<ComplianceRecord | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const { writeContractAsync } = useWriteContract()

  // ── Quote engine — alimentato da isSwapMode ───────────────────────────
  const swapQuote = useSwapQuote({
    chainId,
    tokenIn:    isSwapMode ? tokenIn  : null,  // null in direct → nessuna call Uniswap
    tokenOut:   isSwapMode ? tokenOut : null,
    amountIn:   amount,
    debounceMs: 600,
  })

  const directQuote = useDirectQuote(amount, tokenIn?.decimals ?? 18)

  // ── Load registry quando cambia chainId ──────────────────────────────
  useEffect(() => {
    const reg = getRegistry(chainId)
    setRegistry(reg)
    if (!reg) return
    const list = Object.values(reg.tokens).map(t => ({ ...t as TokenConfig, balance: 0n as bigint }))
    setTokenList(list)
    const ethToken = list.find(t => t.isNative) ?? list[0]
    setTokenIn(ethToken ?? null)
    setTokenOut(ethToken ?? null)  // stesso token → isSwapMode=false (direct)
    setAmount('')
    setOracleData(null); setOracleDenied(false)
  }, [chainId])

  // ── Balances ──────────────────────────────────────────────────────────
  const { data: ethBal } = useBalance({ address })
  const erc20s = tokenList.filter(t => !t.isNative)
  const { data: erc20Bals } = useReadContracts({
    contracts: erc20s.map(t => ({
      address: t.address!, abi: erc20Abi,
      functionName: 'balanceOf' as const, args: [address!],
    })),
    query: { enabled: !!address && erc20s.length > 0 },
  })

  useEffect(() => {
    if (!registry) return
    const updated = tokenList.map(t => {
      if (t.isNative) return { ...t as TokenConfig, balance: ethBal?.value ?? 0n }
      const idx = erc20s.findIndex(e => e.symbol === t.symbol)
      const raw = erc20Bals?.[idx]?.result as bigint | undefined
      return { ...t as TokenConfig, balance: raw ?? 0n }
    })
    setTokenList(updated)
    setTokenIn((prev: (TokenConfig & { balance: bigint }) | null) =>
      prev ? (updated.find(t => t.symbol === prev.symbol) ?? updated[0]) : (updated[0] ?? null)
    )
    setTokenOut((prev: (TokenConfig & { balance: bigint }) | null) =>
      prev ? (updated.find(t => t.symbol === prev.symbol) ?? null) : null
    )
  }, [ethBal, erc20Bals])

  // ── Oracle preflight auto ─────────────────────────────────────────────
  useEffect(() => {
    const run = async () => {
      if (!address || !recipient || !amount || addrError || !isAddress(recipient) || !tokenIn) return
      const r = parseAmtIn(); if (!r) return
      setOracleChecking(true); setOracleData(null); setOracleDenied(false)
      try {
        const res = await fetch('/api/oracle/sign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: address,
            recipient,
            tokenIn:  tokenIn.isNative ? '0x0000000000000000000000000000000000000000' : tokenIn.address,
            tokenOut: isSwapMode && tokenOut
              ? tokenOut.address
              : (tokenIn.isNative ? '0x0000000000000000000000000000000000000000' : tokenIn.address),
            amountIn:    formatUnits(r, tokenIn.decimals),
            amountInWei: r.toString(),
            symbol:      tokenIn.symbol,
            chainId,
          }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const data: OracleResponse = await res.json()
          setOracleData(data); setOracleDenied(!data.approved)
          txLog('oracle.preflight', { approved: data.approved, isSwap: isSwapMode, sourceChain: data.sourceChain })
        }
      } catch { /* Oracle offline */ }
      finally { setOracleChecking(false) }
    }
    const t = setTimeout(run, 800)
    return () => clearTimeout(t)
  }, [recipient, amount, tokenIn?.symbol, tokenOut?.symbol, isSwapMode, address, chainId])

  const parseAmtIn = useCallback((): bigint | null => {
    if (!tokenIn || !amount || isNaN(Number(amount)) || Number(amount) <= 0) return null
    try { return tokenIn.isNative ? parseEther(amount) : parseUnits(amount, tokenIn.decimals) }
    catch { return null }
  }, [tokenIn, amount])

  // ── Receipts ──────────────────────────────────────────────────────────
  const { isSuccess: approveOk } = useWaitForTransactionReceipt({
    hash: approvHash, query: { enabled: !!approvHash && phase === 'wait_approve' },
  })
  const { isSuccess: sendOk } = useWaitForTransactionReceipt({
    hash: sendHash, query: { enabled: !!sendHash && phase === 'wait_send' },
  })

  const execSwap = useCallback(async (oracle: OracleResponse) => {
    const r = parseAmtIn(); if (!r || !tokenIn || !tokenOut || !registry) return
    if (!swapQuote || swapQuote.status !== 'success') {
      setTxError('Quotazione non disponibile.'); setPhase('error'); return
    }
    const minOut = swapQuote.minAmountOut
    if (minOut === 0n) { setTxError('MEV Guard: slippage non configurato.'); setPhase('error'); return }
    setPhase('signing')
    try {
      const args = tokenIn.isNative
        ? [tokenOut.address!, minOut, getAddress(recipient) as `0x${string}`, oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline), oracle.oracleSignature as `0x${string}`]
        : [tokenIn.address!, tokenOut.address!, r, minOut, getAddress(recipient) as `0x${string}`, oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline), oracle.oracleSignature as `0x${string}`]
      console.log('[rp_tx] execSwap args:', JSON.stringify(args, (_, v) => typeof v === 'bigint' ? v.toString() : v))
      console.log('[rp_tx] oracle:', { nonce: oracle.oracleNonce, deadline: oracle.oracleDeadline, sig: oracle.oracleSignature?.slice(0,20)+'...' })
      const hash = await writeContractAsync({
        address: registry.feeRouter, abi: FEE_ROUTER_ABI,
        functionName: tokenIn.isNative ? 'swapETHAndSend' : 'swapAndSend',
        args, ...(tokenIn.isNative ? { value: r } : {}),
      })
      txLog('swap.broadcast', { hash, tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol })
      setSendHash(hash); setPhase('wait_send')
    } catch (e) { handleErr(e) }
  }, [parseAmtIn, tokenIn, tokenOut, registry, swapQuote, recipient])

  const execDirect = useCallback(async (oracle: OracleResponse) => {
    const r = parseAmtIn(); if (!r || !tokenIn || !registry) return
    setPhase('signing')
    try {
      console.log('[rp_tx] execDirect oracle:', { nonce: oracle.oracleNonce, deadline: oracle.oracleDeadline, sig: oracle.oracleSignature?.slice(0,20)+'...' })
      console.log('[rp_tx] execDirect token:', tokenIn.symbol, 'isNative:', tokenIn.isNative, 'registry.feeRouter:', registry.feeRouter)
      let hash: `0x${string}`
      // DEBUG
      console.log('[rp_tx] execDirect →', { contract: registry.feeRouter, fn: tokenIn.isNative ? 'transferETHWithOracle' : 'transferWithOracle', token: tokenIn.address, amount: r?.toString(), recipient, nonce: oracle.oracleNonce, deadline: oracle.oracleDeadline, sig: oracle.oracleSignature?.slice(0,10) })
      if (tokenIn.isNative) {
        // Debug: logga tutto prima di inviare per confrontare con il contratto
        console.log('[rp_tx] transferETHWithOracle args:', {
          feeRouter:      registry.feeRouter,
          recipient:      getAddress(recipient),
          nonce:          oracle.oracleNonce,
          nonceLen:       oracle.oracleNonce?.length,
          deadline:       oracle.oracleDeadline,
          sigSlice:       oracle.oracleSignature?.slice(0, 20),
          value:          r?.toString(),
          chainId,
          contractSigner: (oracle as OracleResponse & { _debug?: { signer?: string } })._debug?.signer,
        })
        hash = await writeContractAsync({
          address: registry.feeRouter, abi: FEE_ROUTER_ABI,
          functionName: 'transferETHWithOracle',
          args: [getAddress(recipient) as `0x${string}`, oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline), oracle.oracleSignature as `0x${string}`],
          value: r,
        })
      } else {
        hash = await writeContractAsync({
          address: registry.feeRouter, abi: FEE_ROUTER_ABI,
          functionName: 'transferWithOracle',
          args: [tokenIn.address!, r, getAddress(recipient) as `0x${string}`, oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline), oracle.oracleSignature as `0x${string}`],
        })
      }
      txLog('direct.broadcast', { hash, token: tokenIn.symbol })
      setSendHash(hash); setPhase('wait_send')
    } catch (e) { handleErr(e) }
  }, [parseAmtIn, tokenIn, registry, recipient])

  useEffect(() => {
    if (approveOk && phase === 'wait_approve' && oracleData) {
      if (isSwapMode) execSwap(oracleData)
      else execDirect(oracleData)
    }
  }, [approveOk, phase, oracleData, isSwapMode, execSwap, execDirect])

  useEffect(() => {
    if (!sendOk || phase !== 'wait_send' || !sendHash || !tokenIn || !address) return
    const r = parseAmtIn(); if (!r) return
    const outToken  = isSwapMode && tokenOut ? tokenOut : tokenIn
    const grossOut  = isSwapMode && swapQuote?.status === 'success' ? swapQuote.amountOut : r
    const feeOut    = (grossOut * 50n) / 10_000n
    const netOut    = grossOut - feeOut
    const eurRate   = EUR_RATES[outToken.symbol] ?? 1
    const eurVal    = outToken.isEurc
      ? parseFloat(formatUnits(netOut, outToken.decimals)).toFixed(2) + ' EUR'
      : (parseFloat(formatUnits(netOut, outToken.decimals)) * eurRate).toFixed(2) + ' EUR'
    setReport({ gross: grossOut, net: netOut, fee: feeOut, decimals: outToken.decimals, symbol: outToken.symbol, txHash: sendHash, timestamp: new Date().toISOString(), eurValue: eurVal })
    generateRecord({
      txHash: sendHash, sender: address, recipient,
      gross: grossOut, net: netOut, fee: feeOut,
      decimals: outToken.decimals, symbol: outToken.symbol,
      paymentRef: oracleData?.paymentRef || '—',
      fiscalRef:  oracleData?.fiscalRef  || '—',
      chainId, isTestnet: chainId === baseSepolia.id,
    }).then(async rec => {
      setCompRec(rec)
      const api = await complianceApi.submitAfterFinality(rec, 2500)
      if (api.queued) setTimeout(() => setToast({ msg: 'Compliance in queue.', color: T.amber }), 3000)

      // ── Invia al backend RPagos ─────────────────────────────
      sendBackend({
        txHash:    sendHash,
        grossStr:  formatUnits(grossOut, outToken.decimals),
        netStr:    formatUnits(netOut, outToken.decimals),
        feeStr:    formatUnits(feeOut, outToken.decimals),
        symbol:    outToken.symbol,
        recipient,
        paymentRef: oracleData?.paymentRef,
        fiscalRef:  oracleData?.fiscalRef,
        eurValue:   eurVal,
        timestamp:  new Date().toISOString(),
        isTestnet:  chainId === baseSepolia.id,
        complianceRecord: rec ? {
          compliance_id:    rec.compliance_id,
          block_timestamp:  rec.block_timestamp,
          fiat_rate:        rec.fiat_rate ?? undefined,
          asset:            rec.asset,
          fiat_gross:       rec.fiat_gross ? parseFloat(rec.fiat_gross) : undefined,
          ip_jurisdiction:  rec.ip_jurisdiction,
          mica_applicable:  rec.mica_applicable,
          fiscal_ref:       rec.fiscal_ref,
          network:          rec.network,
          dac8_reportable:  rec.dac8_reportable,
        } : undefined,
      }).catch(err => console.warn('[RPagos Backend] callback error:', err))
    })
    txLog('tx.completed', { hash: sendHash, isSwap: isSwapMode, tokenIn: tokenIn.symbol, tokenOut: outToken.symbol })
    setPhase('done')
  }, [sendOk, phase])

  function handleErr(e: unknown) {
    const m    = e instanceof Error ? e.message : String(e)
    const code = (e as { code?: number })?.code
    if (code === 4001 || m.includes('rejected') || m.includes('denied') || m.includes('cancel')) {
      setToast({ msg: 'Transazione annullata.', color: T.amber }); setPhase('idle')
    } else if (m.includes('MEVGuard'))            { setTxError('MEV Guard: slippage non configurato.'); setPhase('error') }
    else if (m.includes('InsufficientLiquidity')) { setTxError('Liquidità insufficiente nel pool. Riduci l\'importo.'); setPhase('error') }
    else if (m.includes('SlippageExceeded'))      { setTxError('Slippage superato. Riprova.'); setPhase('error') }
    else                                          { setTxError('Errore: ' + m.slice(0, 100)); setPhase('error') }
  }

  const handleTransfer = async () => {
    const r = parseAmtIn(); if (!r || !tokenIn || !validateAddr(recipient) || !registry) return

    // ── GUARD: contratto non deployato su questa chain ─────────────────────
    const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
    if (!registry.feeRouter || registry.feeRouter === ZERO_ADDR) {
      setToast({
        msg: `⚠ Contratto non configurato su ${registry.chainName}. Passa a Base Sepolia o aggiungi NEXT_PUBLIC_FEE_ROUTER_V4_BASE_SEPOLIA su Vercel.`,
        color: T.red,
      })
      return
    }
    if (!tokenIn.isNative) {
      const tokenChains = findChainForToken(tokenIn.symbol)
      if (!tokenChains.includes(chainId)) {
        const targetChain = tokenChains[0]
        if (targetChain) {
          setToast({ msg: `${tokenIn.symbol} non disponibile su questa rete. Cambio rete…`, color: T.amber })
          switchChain({ chainId: targetChain as 1 | 8453 | 84532 | 11155111 })
          return
        }
      }
    }
    let oracle = oracleData
    if (!oracle || !oracle.approved) {
      setPhase('preflight')
      try {
        const res = await fetch('/api/oracle/sign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: address,
            recipient,
            tokenIn:  tokenIn.isNative ? '0x0000000000000000000000000000000000000000' : tokenIn.address,
            tokenOut: isSwapMode && tokenOut
              ? tokenOut.address
              : (tokenIn.isNative ? '0x0000000000000000000000000000000000000000' : tokenIn.address),
            amountIn:    formatUnits(r, tokenIn.decimals),
            amountInWei: r.toString(),   // wei esatti — evita errori di arrotondamento
            symbol:      tokenIn.symbol,
            chainId,
          }),
          signal: AbortSignal.timeout(10_000),
        })
        oracle = await res.json()
      } catch { setTxError('Oracle non raggiungibile.'); setPhase('error'); return }
    }
    if (!oracle?.approved) { setOracleDenied(true); setOracleData(oracle); setPhase('idle'); return }
    txLog('tx.initiated', { isSwap: isSwapMode, token: tokenIn.symbol, chain: chainId })
    try {
      if (isSwapMode) {
        if (!tokenIn.isNative) {
          setPhase('approving')
          const ah = await writeContractAsync({ address: tokenIn.address!, abi: erc20Abi, functionName: 'approve', args: [registry.feeRouter, r] })
          setApprovHash(ah); setPhase('wait_approve')
        } else { await execSwap(oracle) }
      } else {
        if (!tokenIn.isNative) {
          setPhase('approving')
          const ah = await writeContractAsync({ address: tokenIn.address!, abi: erc20Abi, functionName: 'approve', args: [registry.feeRouter, r] })
          setApprovHash(ah); setPhase('wait_approve')
        } else { await execDirect(oracle) }
      }
    } catch (e) { handleErr(e) }
  }

  const reset = () => {
    setPhase('idle'); setAmount(''); setRecipient(''); setPaymentRef(''); setFiscalRef('')
    setReport(null); setCompRec(null); setApprovHash(undefined); setSendHash(undefined)
    setTxError(''); setOracleData(null); setOracleDenied(false)
  }

  const handlePdf = () => {
    if (!report || !address) return
    generatePdfReceipt({
      txHash: report.txHash, timestamp: report.timestamp, sender: address, recipient,
      grossAmount: formatUnits(report.gross, report.decimals),
      netAmount:   formatUnits(report.net,   report.decimals),
      feeAmount:   formatUnits(report.fee,   report.decimals),
      symbol: report.symbol, paymentRef: oracleData?.paymentRef || '—',
      fiscalRef: oracleData?.fiscalRef || '—', eurValue: report.eurValue,
      network: getRegistry(chainId)?.chainName ?? 'Base',
    })
  }

  const fmtBal = (t: TokenConfig & { balance: bigint }) => {
    const v = parseFloat(formatUnits(t.balance, t.decimals))
    return ['USDC','USDT','EURC'].includes(t.symbol) ? v.toFixed(2)
      : t.symbol === 'cbBTC' || t.symbol === 'WBTC' ? v.toFixed(6)
      : v.toFixed(4)
  }
  const validateAddr = (addr: string) => {
    if (!addr) { setAddrError(''); return false }
    if (!isAddress(addr)) { setAddrError('Indirizzo non valido'); return false }
    setAddrError(''); return true
  }
  const handleMax = async () => {
    if (!tokenIn) return
    if (tokenIn.isNative) {
      try {
        const gp   = await publicClient?.getGasPrice() ?? 1_500_000_000n
        const cost = (21_000n * gp * 12n) / 10n
        setAmount(formatEther(tokenIn.balance > cost ? tokenIn.balance - cost : 0n))
      } catch { setAmount(formatEther(tokenIn.balance)) }
    } else { setAmount(formatUnits(tokenIn.balance, tokenIn.decimals)) }
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  // ── Valori derivati ────────────────────────────────────────────────────
  const rawIn    = parseAmtIn()
  const busy     = ['preflight','approving','wait_approve','signing','wait_send'].includes(phase)
  const sym      = tokenIn?.symbol  ?? 'ETH'
  const symOut   = isSwapMode ? (tokenOut?.symbol ?? 'USDC') : sym
  const isWrong  = isConnected && !([8453, 1, 84532, 11155111] as number[]).includes(chainId as number)
  const hasInsuf = isConnected && !!rawIn && !!tokenIn && rawIn > tokenIn.balance
  const noLiq    = isSwapMode && swapQuote?.status === 'error_liquidity'
  const isL2     = chainId === 8453 || chainId === 84532
  const regChain = getRegistry(chainId)
  const noContract = isConnected && !isWrong && regChain?.feeRouter === '0x0000000000000000000000000000000000000000'

  const ctaState: CtaState = !isConnected   ? 'disconnected'
    : isWrong                               ? 'wrong_network'
    : noContract                            ? 'wrong_network'
    : busy                                  ? 'busy'
    : hasInsuf                              ? 'insufficient'
    : oracleDenied                          ? 'oracle_denied'
    : noLiq                                 ? 'no_liquidity'
    : !recipient || !!addrError             ? 'no_recipient'
    : !rawIn                                ? 'no_amount'
    :                                         'ready'

  const C = {
    card:  { borderRadius:20, background:'rgba(8,12,30,0.72)', backdropFilter:'blur(32px) saturate(180%)', WebkitBackdropFilter:'blur(32px) saturate(180%)', border:'1px solid rgba(255,255,255,0.18)', overflow:'hidden' as const, boxShadow:'0 8px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.15)' } satisfies React.CSSProperties,
    box:   { borderRadius:14, background:focused?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.04)', padding:'14px 14px', border:'1.5px solid', borderColor:focused?`${T.emerald}60`:'rgba(255,255,255,0.14)', transition:'all 0.2s ease', cursor:'text', boxShadow:focused?`0 0 0 3px ${T.emerald}12`:'inset 0 1px 0 rgba(255,255,255,0.07)' } satisfies React.CSSProperties,
    box2:  { borderRadius:14, background:'rgba(255,255,255,0.04)', padding:'14px 14px', border:'1.5px solid rgba(255,255,255,0.12)' } satisfies React.CSSProperties,
    row:   { display:'flex', alignItems:'center', justifyContent:'space-between' } satisfies React.CSSProperties,
    input: { width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:10, padding:'10px 12px', color:T.text, fontSize:13, outline:'none', transition:'all 0.2s ease', fontFamily:T.M, boxSizing:'border-box' as const, backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)' } satisfies React.CSSProperties,
  }

  // ── SUCCESS ───────────────────────────────────────────────────────────
  if (phase === 'done' && report) return (
    <>
      <div style={noCard ? {} : C.card} className="rp-anim-0">
        <div style={{ padding:'18px 20px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:9, height:9, borderRadius:'50%', background:T.emerald, boxShadow:`0 0 12px ${T.emerald}` }} />
          <span style={{ fontFamily:T.D, color:T.emerald, fontSize:13, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.06em' }}>Pagamento Confermato</span>
          {oracleData?.isSwap && (
            <span style={{ fontFamily:T.D, fontSize:10, color:T.purple, background:`${T.purple}15`, padding:'2px 7px', borderRadius:5, border:`1px solid ${T.purple}30` }}>
              ⚡ Swap V3
            </span>
          )}
          <span style={{ fontFamily:T.M, fontSize:11, color:T.muted, marginLeft:'auto' }}>
            {new Date(report.timestamp).toLocaleString('it-IT')}
          </span>
        </div>
        <div style={{ padding:'20px' }}>
          <TransactionStatusUI
            phase="done" txHash={report.txHash} isTestnet={chainId === baseSepolia.id}
            grossStr={formatUnits(report.gross, report.decimals)}
            netStr={formatUnits(report.net, report.decimals)}
            feeStr={formatUnits(report.fee, report.decimals)}
            symbol={report.symbol} recipient={recipient}
            paymentRef={oracleData?.paymentRef || '—'}
            fiscalRef={oracleData?.fiscalRef || '—'}
            eurValue={report.eurValue} timestamp={report.timestamp}
            complianceRecord={compRec ?? undefined}
            onCopyHash={async () => { await navigator.clipboard.writeText(report.txHash); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            copied={copied} onReset={reset} onDownloadPdf={handlePdf}
          />
        </div>
      </div>
      {toast && <Toast message={toast.msg} color={toast.color} onDismiss={() => setToast(null)} />}
    </>
  )

  // ── MAIN FORM — Jupiter-style: no header, direct Sell/Buy ──────────
  return (
    <>
      <div style={noCard ? {} : C.card}>
        <div style={{ padding:'10px 10px 10px' }}>

          {/* Gas warning L1 — only when needed */}
          {!isL2 && isConnected && (
            <div style={{ margin:'0 0 6px', padding:'7px 11px', borderRadius:10, background:`${T.amber}08`, border:`1px solid ${T.amber}20`, fontFamily:T.D, fontSize:11, color:T.amber, display:'flex', alignItems:'center', gap:6 }}>
              ⚠ <span>Gas L1 elevato — considera Base.</span>
            </div>
          )}

          {/* ── SELL ─────────────────────────────────────────────── */}
          <div className="rp-anim-1">
            <div style={C.box} onClick={() => inputRef.current?.focus()}>
              {/* Top row: label + balance */}
              <div style={{ ...C.row, marginBottom:10 }}>
                <span style={{ fontFamily:T.D, fontSize:13, fontWeight:600, color:T.muted }}>
                  Sell
                </span>
                {isConnected && tokenIn && (
                  <button
                    onClick={e => { e.stopPropagation(); handleMax() }}
                    style={{ fontFamily:T.M, fontSize:12, color:T.muted, background:'none', border:'none', cursor:'pointer', padding:0, transition:'color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.color=T.emerald}
                    onMouseLeave={e => e.currentTarget.style.color=T.muted}
                  >
                    {fmtBal(tokenIn)} {sym}
                  </button>
                )}
              </div>
              {/* Bottom row: token pill LEFT — amount RIGHT */}
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div onClick={e => e.stopPropagation()}>
                  <TokenPill token={tokenIn} busy={busy} onClick={() => setSelectingToken('in')} />
                </div>
                <div style={{ flex:1, textAlign:'right' as const }}>
                  <input
                    ref={inputRef} type="number" placeholder="0.00" min="0" step="any"
                    value={amount} onChange={e => setAmount(e.target.value)}
                    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                    disabled={busy}
                    style={{ fontFamily:T.D, fontSize:30, fontWeight:400, letterSpacing:'-0.02em', width:'100%', background:'transparent', border:'none', outline:'none', color:busy?T.muted:T.text, textAlign:'right' as const }}
                  />
                  <div style={{ fontFamily:T.M, fontSize:12, color:T.muted, marginTop:2 }}>
                    {amount && tokenIn ? `$${(parseFloat(amount) * (EUR_RATES[tokenIn.symbol] ?? 1)).toFixed(2)}` : '$0'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Swap arrow ───────────────────────────────────────── */}
          <div className="rp-anim-2" style={{ display:'flex', justifyContent:'center', margin:'-4px 0', position:'relative', zIndex:2 }}>
            <button
              onClick={() => {
                if (isSwapMode && tokenIn && tokenOut) {
                  const tmp = tokenIn; setTokenIn(tokenOut); setTokenOut(tmp); setAmount('')
                }
              }}
              style={{
                width:34, height:34, borderRadius:10,
                background: 'rgba(255,255,255,0.08)',
                backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
                border:'1.5px solid rgba(255,255,255,0.14)',
                color: T.muted, fontSize:16,
                cursor: isSwapMode ? 'pointer' : 'default',
                display:'flex', alignItems:'center', justifyContent:'center',
                transition:'all 0.2s ease',
                boxShadow:'0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.10)',
              }}
              onMouseEnter={e => { if (isSwapMode) { e.currentTarget.style.background='rgba(255,255,255,0.14)'; e.currentTarget.style.color=T.text } }}
              onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.08)'; e.currentTarget.style.color=T.muted }}
            >
              ⇅
            </button>
          </div>

          {/* ── BUY / RECEIVE ────────────────────────────────────── */}
          <div className="rp-anim-2">
            <div style={C.box2}>
              {/* Top row: label + balance */}
              <div style={{ ...C.row, marginBottom:10 }}>
                <span style={{ fontFamily:T.D, fontSize:13, fontWeight:600, color:T.muted }}>
                  Buy
                </span>
                {isConnected && (isSwapMode ? tokenOut : tokenIn) && (
                  <span style={{ fontFamily:T.M, fontSize:12, color:T.muted }}>
                    {fmtBal(isSwapMode ? tokenOut! : tokenIn!)} {symOut}
                  </span>
                )}
              </div>
              {/* Bottom row: token pill LEFT — amount RIGHT */}
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div onClick={e => e.stopPropagation()}>
                  <TokenPill
                    token={isSwapMode ? tokenOut : tokenIn}
                    busy={busy}
                    accentColor={isSwapMode ? T.purple : undefined}
                    onClick={() => setSelectingToken('out')}
                  />
                </div>
                <div style={{ flex:1, textAlign:'right' as const }}>
                  <span style={{ fontFamily:T.D, fontSize:30, fontWeight:400, letterSpacing:'-0.02em', color:T.text, display:'block' }}>
                    {isSwapMode
                      ? (swapQuote?.status === 'success' ? swapQuote.netAmountFmt
                         : swapQuote?.status === 'loading' ? '…' : '0')
                      : (directQuote ? directQuote.netFmt : '0')
                    }
                  </span>
                  <div style={{ fontFamily:T.M, fontSize:12, color:T.muted, marginTop:2 }}>
                    {isSwapMode
                      ? (swapQuote?.status === 'success' ? `$${(parseFloat(swapQuote.netAmountFmt) * (EUR_RATES[symOut] ?? 1)).toFixed(2)}` : '$0')
                      : (directQuote ? `$${(parseFloat(directQuote.netFmt) * (EUR_RATES[sym] ?? 1)).toFixed(2)}` : '$0')
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quote panel — solo in swap mode */}
          {isSwapMode && swapQuote && (
            <div style={{ marginTop:6 }}>
              <QuotePanel quote={swapQuote} tokenOut={tokenOut} isSwap={isSwapMode} />
            </div>
          )}

          {/* ── RECIPIENT ────────────────────────────────────────── */}
          <div className="rp-anim-3" style={{ marginTop:6 }}>
            <div style={{ padding:'12px 14px', borderRadius:14, background:'rgba(255,255,255,0.025)', border:`1px solid ${T.border}` }}>
              <div style={{ ...C.row, marginBottom:6 }}>
                <span style={{ fontFamily:T.D, fontSize:11, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.08em', color:T.muted }}>
                  To
                </span>
                {recipient && !addrError && (
                  <span style={{ fontFamily:T.M, fontSize:10, color:T.emerald }}>✓</span>
                )}
                {addrError && (
                  <span style={{ fontFamily:T.D, fontSize:10, fontWeight:600, color:T.red }}>{addrError}</span>
                )}
              </div>
              <input
                type="text" placeholder="0x... o ENS"
                value={recipient}
                onChange={e => { setRecipient(e.target.value); validateAddr(e.target.value); setOracleData(null); setOracleDenied(false) }}
                disabled={busy}
                style={{ ...C.input, borderColor:addrError?`${T.red}40`:recipient&&!addrError?`${T.emerald}25`:T.border }}
              />
              <AddressVerifier address={recipient} />
            </div>
          </div>

          {/* Oracle denial */}
          {oracleDenied && oracleData && !busy && (
            <div style={{ marginTop:6, padding:'10px 12px', borderRadius:12, background:`${T.red}0d`, border:`1px solid ${T.red}30` }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontFamily:T.D, fontSize:11, fontWeight:700, color:T.red }}>
                  🚫 Bloccata — AML
                </span>
              </div>
              {oracleData.rejectionReason && (
                <div style={{ fontFamily:T.M, fontSize:10, color:T.muted, marginTop:3 }}>
                  {oracleData.rejectionReason}
                </div>
              )}
            </div>
          )}

          {/* Extras DAC8 — collapsed by default */}
          {showExtras && (
            <div style={{ marginTop:6, padding:'12px 14px', borderRadius:14, background:'rgba(255,255,255,0.025)', border:`1px solid ${T.border}`, animation:'rpFadeUp 0.2s var(--ease-spring) both' }}>
              <div style={{ fontFamily:T.D, fontSize:10, fontWeight:700, textTransform:'uppercase' as const, letterSpacing:'0.08em', color:T.muted, marginBottom:8 }}>
                MiCA/DAC8
              </div>
              <input type="text" placeholder="Rif. pagamento (es. INV-001)" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} disabled={busy} style={{ ...C.input, marginBottom:6 }} />
              <input type="text" placeholder="ID Fiscale" value={fiscalRef} onChange={e => setFiscalRef(e.target.value)} disabled={busy} style={C.input} />
              {oracleData?.dac8Reportable && (
                <div style={{ fontFamily:T.D, fontSize:10, color:T.amber, marginTop:5 }}>⚠ DAC8 reportable (≥ €1.000)</div>
              )}
            </div>
          )}

          {/* Progress */}
          {phase === 'wait_send' && <div style={{ marginTop:6 }}><BallisticProgress active={true} /></div>}
          {(busy || phase === 'error') && (
            <div style={{ marginTop:6 }}>
              {busy && <MicroStateBadge phase={phase} silent={false} />}
              {phase === 'error' && (
                <TransactionStatusUI phase="error" error={txError} isTestnet={chainId === baseSepolia.id} onReset={reset} />
              )}
            </div>
          )}

          {/* ── CTA BUTTON ───────────────────────────────────────── */}
          <div className="rp-anim-4" style={{ marginTop:8 }}>
            {ctaState === 'disconnected' ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button
                    onClick={openConnectModal}
                    className="rp-btn-primary"
                    style={{ width:'100%', padding:'18px', borderRadius:14, border:'none', fontFamily:T.D, fontSize:16, fontWeight:700, letterSpacing:'-0.01em', background:'rgba(255,255,255,0.06)', color:T.text, cursor:'pointer', transition:'all 0.15s' }}
                  >
                    Connetti wallet
                  </button>
                )}
              </ConnectButton.Custom>
            ) : (
              <button
                onClick={
                  ctaState === 'wrong_network' ? () => switchChain({ chainId: 8453 })
                  : ctaState === 'ready' ? handleTransfer
                  : undefined
                }
                disabled={['busy','insufficient','no_recipient','no_amount','oracle_denied','no_liquidity'].includes(ctaState)}
                className={ctaState === 'ready' ? 'rp-btn-primary' : ''}
                style={{
                  width:'100%', padding:'18px', borderRadius:14, border:'none',
                  fontFamily:T.D, fontSize:16, fontWeight:700, letterSpacing:'-0.01em',
                  cursor:['busy','insufficient','no_recipient','no_amount','oracle_denied','no_liquidity'].includes(ctaState)?'not-allowed':'pointer',
                  background:
                    ctaState==='ready' && isSwapMode  ? `linear-gradient(135deg, ${T.purple}, #c084fc)`
                    : ctaState==='ready'              ? `linear-gradient(135deg, ${T.emerald}, #00cc80)`
                    : ctaState==='wrong_network'      ? `linear-gradient(135deg, ${T.amber}, #ffcc00)`
                    : ctaState==='oracle_denied'      ? `${T.red}15`
                    : ctaState==='insufficient'       ? `${T.red}15`
                    :                                   'rgba(255,255,255,0.04)',
                  color:
                    ctaState==='ready'                ? (isSwapMode ? '#fff' : '#000')
                    : ctaState==='wrong_network'      ? '#000'
                    : ctaState==='oracle_denied'      ? `${T.red}60`
                    : ctaState==='insufficient'       ? `${T.red}60`
                    :                                   'rgba(255,255,255,0.35)',
                  boxShadow: ctaState==='ready' ? `0 4px 20px ${isSwapMode?T.purple:T.emerald}25` : 'none',
                  transition:'all 0.2s ease',
                }}
              >
                {busy ? (
                  <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                    <span className="rp-spinner" style={{ width:14, height:14, border:`2px solid rgba(255,255,255,0.2)`, borderTopColor:'transparent', borderRadius:'50%', display:'inline-block' }} />
                    <span>
                      {phase==='preflight'               ? 'AML Check…'
                       : phase==='approving'||phase==='wait_approve' ? 'Approvazione…'
                       :                                   'Finalizzazione…'}
                    </span>
                  </span>
                ) : ctaState==='oracle_denied'  ? 'Transazione Bloccata'
                  : ctaState==='no_liquidity'   ? 'Liquidità insufficiente'
                  : ctaState==='wrong_network'  ? (noContract ? `${regChain?.chainName ?? 'Rete'} non disponibile` : 'Cambia rete')
                  : ctaState==='insufficient'   ? 'Saldo insufficiente'
                  : ctaState==='no_recipient'   ? 'Inserisci destinatario'
                  : ctaState==='no_amount'      ? 'Inserisci un importo'
                  : needsApproval && !tokenIn?.isNative ? `Approva ${sym}`
                  : isSwapMode                  ? `Swap & Invia ${sym} → ${symOut}`
                  :                               `Invia ${sym}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Token Selector Modal */}
      {selectingToken && (
        <TokenSelectorModal
          title={selectingToken === 'in' ? 'Seleziona token di input' : 'Seleziona token di output'}
          tokens={tokenList}
          onClose={() => setSelectingToken(null)}
          onSelect={t => {
            if (selectingToken === 'in') {
              setTokenIn(t)
            } else {
              setTokenOut(t)
            }
            // tokenIn === tokenOut → direct mode (isSwapMode=false)
            // tokenIn !== tokenOut → swap mode (isSwapMode=true)
            setAmount(''); setOracleData(null); setOracleDenied(false)
            setSelectingToken(null)
          }}
        />
      )}

      {toast && <Toast message={toast.msg} color={toast.color} onDismiss={() => setToast(null)} />}
    </>
  )
}