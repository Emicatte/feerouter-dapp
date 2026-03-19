'use client'

/**
 * TransferForm.tsx — VASP Multi-Asset Final
 *
 * Base: TransferForm_v4.tsx (struttura identica, zero modifiche al design)
 *
 * Upgrade chirurgici:
 *   1. TOKENS aggiornati: ETH, EURC, USDC, USDT, cbBTC, DEGEN
 *   2. TokenDropdown custom (loghi TrustWallet, no <select> nativo)
 *   3. Oracle pre-flight auto POST /api/v1/compliance/verify
 *   4. OracleDenialBanner Zero-Trust con messaggio istituzionale
 *   5. EURC-first: badge EU + label "€" nel form
 *   6. AML Oracle stato nell'header
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  useAccount, useBalance, useReadContracts,
  useWriteContract, useWaitForTransactionReceipt,
  usePublicClient, useChainId, useSwitchChain,
} from 'wagmi'
import { ConnectButton }  from '@rainbow-me/rainbowkit'
import {
  parseEther, parseUnits, formatEther, formatUnits,
  erc20Abi, isAddress, getAddress, type Abi,
} from 'viem'
import { base, baseSepolia } from 'wagmi/chains'
import {
  TransactionStatusUI, GasTracker, AddressVerifier,
  BallisticProgress, MicroStateBadge,
} from './TransactionStatus'
import { useComplianceEngine, type ComplianceRecord } from '../lib/useComplianceEngine'
import { usePermit2 }          from '../lib/usePermit2'
import { useGaslessPaymaster } from '../lib/useGaslessPaymaster'
import { useComplianceAPI }    from '../lib/useComplianceAPI'
import { generatePdfReceipt }  from '../lib/usePdfReceipt'

// ── Theme — identico a v4 ──────────────────────────────────────────────────
const T = {
  bg:      '#080810',
  surface: '#0d0d1a',
  card:    '#111120',
  border:  'rgba(255,255,255,0.06)',
  emerald: '#00ffa3',
  red:     '#ff2d55',
  amber:   '#ffb800',
  pink:    '#ff007a',
  euBlue:  '#0033cc',
  muted:   '#4a4a6a',
  text:    '#e2e2f0',
  mono:    'var(--font-mono)',
  display: 'var(--font-display)',
}

// ── Config ─────────────────────────────────────────────────────────────────
const FEE_ROUTER_ADDRESS = (
  process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS
  ?? process.env.NEXT_PUBLIC_FEE_ROUTER_ADDRESS
  ?? '0xC090e7c163F286e333468777FC8810D23E7acEF3'
) as `0x${string}`
const IS_TESTNET = process.env.NEXT_PUBLIC_TARGET_CHAIN_ID === '84532'
const API_BASE   = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── ABI FeeRouterV3 ────────────────────────────────────────────────────────
const FEE_ROUTER_ABI: Abi = [
  {
    name: 'transferWithOracle', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: '_token',           type: 'address' },
      { name: '_amount',          type: 'uint256' },
      { name: '_recipient',       type: 'address' },
      { name: '_nonce',           type: 'bytes32' },
      { name: '_deadline',        type: 'uint256' },
      { name: '_oracleSignature', type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'transferETHWithOracle', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: '_recipient',       type: 'address' },
      { name: '_nonce',           type: 'bytes32' },
      { name: '_deadline',        type: 'uint256' },
      { name: '_oracleSignature', type: 'bytes'   },
    ],
    outputs: [],
  },
]

// ── Token list VASP ────────────────────────────────────────────────────────
const TOKENS = [
  {
    symbol: 'ETH', name: 'Ethereum',
    address: undefined as `0x${string}` | undefined,
    decimals: 18, color: '#627EEA', gasless: false, isNative: true, isEurc: false,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  },
  {
    symbol: 'EURC', name: 'Euro Coin',
    address: '0x60a3E35Cc3064fC371f477011b3E9dd2313ec445' as `0x${string}`,
    decimals: 6, color: '#0033cc', gasless: true, isNative: false, isEurc: true,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c/logo.png',
  },
  {
    symbol: 'USDC', name: 'USD Coin',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
    decimals: 6, color: '#2775CA', gasless: true, isNative: false, isEurc: false,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  },
  {
    symbol: 'USDT', name: 'Tether USD',
    address: '0xfde4C96256153236af98292015BA958c14714C22' as `0x${string}`,
    decimals: 6, color: '#26A17B', gasless: true, isNative: false, isEurc: false,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  },
  {
    symbol: 'cbBTC', name: 'Coinbase Wrapped BTC',
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as `0x${string}`,
    decimals: 8, color: '#F7931A', gasless: false, isNative: false, isEurc: false,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png',
  },
  {
    symbol: 'DEGEN', name: 'Degen',
    address: '0x4eDBc9320305298056041910220E3663A92540B6' as `0x${string}`,
    decimals: 18, color: '#845ef7', gasless: false, isNative: false, isEurc: false,
    logoURI: 'https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png',
  },
] as const

type Phase    = 'idle' | 'preflight' | 'approving' | 'wait_approve' | 'signing' | 'wait_send' | 'done' | 'error'
type CtaState = 'disconnected' | 'wrong_network' | 'insufficient' | 'no_recipient' | 'no_amount' | 'oracle_denied' | 'ready' | 'busy'

interface TokenOption {
  symbol: string; name: string; color: string
  gasless: boolean; isNative: boolean; isEurc: boolean
  decimals: number; balance: bigint
  address?: `0x${string}`; logoURI: string
}

interface OracleResponse {
  approved: boolean
  oracleSignature: string; oracleNonce: string; oracleDeadline: number
  paymentRef: string; fiscalRef: string
  riskScore: number; riskLevel: string; dac8Reportable: boolean
  eurValue?: number; isEurc?: boolean; gasless?: boolean
  rejectionReason?: string
}

function calcSplit(raw: bigint) {
  const fee = (raw * 50n) / 10_000n
  return { main: raw - fee, fee }
}
function fmtU(raw: bigint, dec: number, dp = 6) {
  return parseFloat(formatUnits(raw, dec)).toFixed(dp)
}
function txLog(event: string, data: Record<string, unknown>) {
  const entry = { event, timestamp: new Date().toISOString(), network: IS_TESTNET ? 'BASE_SEPOLIA' : 'BASE', ...data }
  console.log('[rp_tx]', JSON.stringify(entry))
  try {
    const raw = localStorage.getItem('rp_tx_history')
    const h: unknown[] = raw ? JSON.parse(raw) : []
    h.push(entry); if (h.length > 200) h.splice(0, h.length - 200)
    localStorage.setItem('rp_tx_history', JSON.stringify(h))
  } catch { /* SSR */ }
}

// ── Token Logo ─────────────────────────────────────────────────────────────
function TokenLogo({ token, size = 24 }: { token: Pick<TokenOption,'symbol'|'logoURI'|'color'>; size?: number }) {
  const [err, setErr] = useState(false)
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: err ? token.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.08)' }}>
      {!err
        ? <img src={token.logoURI} alt={token.symbol} width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setErr(true)} />
        : <span style={{ fontSize: size * 0.38, fontWeight: 800, color: '#fff' }}>{token.symbol.slice(0, 2)}</span>
      }
    </div>
  )
}

// ── Token Dropdown custom ──────────────────────────────────────────────────
function TokenDropdown({ tokens, selected, onSelect, busy }: {
  tokens: TokenOption[]; selected: TokenOption | null
  onSelect: (t: TokenOption) => void; busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const fmtB = (t: TokenOption) => {
    const v = parseFloat(formatUnits(t.balance, t.decimals))
    return t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'EURC' ? v.toFixed(2)
      : t.symbol === 'cbBTC' ? v.toFixed(6) : v.toFixed(4)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" onClick={e => { e.stopPropagation(); if (!busy) setOpen(o => !o) }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px 9px 9px', borderRadius: 18, background: selected?.isEurc ? T.euBlue + '20' : '#1a1a2e', border: `1px solid ${selected?.isEurc ? T.euBlue + '60' : T.border}`, cursor: busy ? 'default' : 'pointer', transition: 'all 0.15s' }}>
        {selected && <TokenLogo token={selected} size={24} />}
        <span style={{ fontSize: 14, fontWeight: 700, color: selected?.isEurc ? '#6699ff' : T.text }}>{selected?.symbol ?? '—'}</span>
        {!busy && <span style={{ color: T.muted, fontSize: 10 }}>▾</span>}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 280, zIndex: 1000, background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, boxShadow: '0 16px 48px rgba(0,0,0,0.8)', overflow: 'hidden', animation: 'fadeSlideIn 0.15s ease' }}>
          <div style={{ padding: '10px 14px 8px', fontFamily: T.mono, fontSize: 10, color: T.muted, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', borderBottom: `1px solid ${T.border}` }}>
            Seleziona asset
          </div>
          {tokens.map((t, i) => {
            const isSel = t.symbol === selected?.symbol
            return (
              <button key={t.symbol} type="button"
                onClick={() => { onSelect(t); setOpen(false) }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: isSel ? T.emerald + '0d' : 'transparent', border: 'none', borderBottom: i < tokens.length - 1 ? `1px solid ${T.border}` : 'none', cursor: 'pointer', transition: 'background 0.12s', textAlign: 'left' as const }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
              >
                <TokenLogo token={t} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: isSel ? T.emerald : T.text }}>{t.symbol}</span>
                    {t.isEurc && <span style={{ fontFamily: T.mono, fontSize: 9, color: '#6699ff', background: T.euBlue + '20', padding: '1px 5px', borderRadius: 4, border: `1px solid ${T.euBlue}40` }}>★ EU</span>}
                    {t.gasless && !t.isEurc && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.emerald, background: T.emerald + '15', padding: '1px 5px', borderRadius: 4 }}>⛽ Gasless</span>}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, marginTop: 1 }}>{t.name}</div>
                </div>
                <div style={{ textAlign: 'right' as const }}>
                  <div style={{ fontFamily: T.mono, fontSize: 12, color: T.text, fontWeight: 600 }}>{fmtB(t)}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{t.symbol}</div>
                </div>
                {isSel && <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.emerald, flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Toast — identico a v4 ──────────────────────────────────────────────────
function Toast({ message, color = T.muted, onDismiss }: { message: string; color?: string; onDismiss: () => void }) {
  useEffect(() => { const t = setTimeout(onDismiss, 4000); return () => clearTimeout(t) }, [onDismiss])
  return (
    <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, minWidth: 300, maxWidth: 420, background: T.card, border: `1px solid ${color}30`, borderRadius: 14, padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: `0 12px 40px rgba(0,0,0,0.7), 0 0 20px ${color}15`, animation: 'fadeUp 0.3s ease' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}`, flexShrink: 0 }} />
      <span style={{ fontFamily: T.mono, fontSize: 13, color: T.text, flex: 1 }}>{message}</span>
      <button onClick={onDismiss} style={{ color: T.muted, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0 }}>✕</button>
    </div>
  )
}

// ── Oracle Denial Banner ───────────────────────────────────────────────────
function OracleDenialBanner({ reason }: { reason: string }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, background: T.red + '0d', border: `1px solid ${T.red}30`, animation: 'fadeSlideIn 0.2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>🚫</span>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.red, fontWeight: 700 }}>
          Transazione negata per policy di conformità AML
        </span>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, paddingLeft: 22 }}>{reason}</div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
export default function TransferForm(): React.JSX.Element {
  const { address, isConnected } = useAccount()
  const chainId                  = useChainId()
  const { switchChain }          = useSwitchChain()
  const publicClient             = usePublicClient()
  const { generateRecord }       = useComplianceEngine()

  const permit2       = usePermit2(FEE_ROUTER_ADDRESS)
  const paymaster     = useGaslessPaymaster()
  const complianceApi = useComplianceAPI()

  // Form — identico a v4
  const [tokens,     setTokens]     = useState<TokenOption[]>([])
  const [selected,   setSelected]   = useState<TokenOption | null>(null)
  const [recipient,  setRecipient]  = useState('')
  const [amount,     setAmount]     = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [fiscalRef,  setFiscalRef]  = useState('')
  const [focused,    setFocused]    = useState(false)
  const [addrError,  setAddrError]  = useState('')
  const [showExtras, setShowExtras] = useState(false)
  const [eurPrice,   setEurPrice]   = useState<number | null>(null)
  const [copied,     setCopied]     = useState(false)
  const [silentFlow, setSilentFlow] = useState(false)
  const [toast,      setToast]      = useState<{ msg: string; color?: string } | null>(null)
  const [gaslessBadge, setGaslessBadge] = useState(false)

  // Oracle state
  const [oracleData,     setOracleData]     = useState<OracleResponse | null>(null)
  const [oracleDenied,   setOracleDenied]   = useState(false)
  const [oracleChecking, setOracleChecking] = useState(false)

  // TX — identico a v4
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

  // ── Balances ───────────────────────────────────────────────────────────
  const { data: ethBal } = useBalance({ address })
  const erc20List = TOKENS.filter(t => !t.isNative)

  const { data: erc20Bals } = useReadContracts({
    contracts: erc20List.map(t => ({
      address: t.address as `0x${string}`, abi: erc20Abi,
      functionName: 'balanceOf' as const, args: [address!],
    })),
    query: { enabled: !!address },
  })

  useEffect(() => {
    const ethCfg = TOKENS.find(t => t.symbol === 'ETH')!
    const list: TokenOption[] = [{ ...ethCfg, balance: ethBal?.value ?? 0n }]
    erc20List.forEach((t, i) => {
      const raw = erc20Bals?.[i]?.result as bigint | undefined
      list.push({ ...t, balance: raw ?? 0n })
    })
    setTokens(list)
    setSelected(prev => prev ? (list.find(t => t.symbol === prev.symbol) ?? list[0]) : list[0])
  }, [ethBal, erc20Bals, isConnected])

  useEffect(() => {
    if (!selected) return
    // EURC: 1:1 EUR, nessuna conversione
    const rates: Record<string, number> = { ETH: 2200, EURC: 1.0, USDC: 0.92, USDT: 0.92, cbBTC: 88000, DEGEN: 0.003 }
    setEurPrice(rates[selected.symbol] ?? null)
    // Gasless
    if (paymaster.isGaslessEligible(selected.symbol)) {
      paymaster.estimateGas(selected.symbol).then(est => setGaslessBadge(est.gasSponsored))
    } else { setGaslessBadge(false) }
    // Reset oracle
    setOracleData(null); setOracleDenied(false)
  }, [selected?.symbol])

  // ── Parse ──────────────────────────────────────────────────────────────
  const parseAmt = useCallback((): bigint | null => {
    if (!selected || !amount || isNaN(Number(amount)) || Number(amount) <= 0) return null
    try { return selected.isNative ? parseEther(amount) : parseUnits(amount, selected.decimals) }
    catch { return null }
  }, [selected, amount])

  // ── Silent flow — identico a v4 ────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const r = parseAmt()
      if (!r || !selected || selected.isNative || !address) { setSilentFlow(false); return }
      try {
        const allowance = await publicClient?.readContract({
          address: selected.address!, abi: erc20Abi,
          functionName: 'allowance', args: [address, FEE_ROUTER_ADDRESS],
        }) as bigint | undefined
        setSilentFlow(!!(allowance && allowance >= r))
      } catch { setSilentFlow(false) }
    }
    check()
  }, [amount, selected?.symbol, address])

  // ── Oracle pre-flight auto ─────────────────────────────────────────────
  useEffect(() => {
    const run = async () => {
      if (!address || !recipient || !amount || addrError || !isAddress(recipient)) return
      const r = parseAmt(); if (!r || !selected) return
      setOracleChecking(true); setOracleData(null); setOracleDenied(false)
      try {
        const res = await fetch(`${API_BASE}/api/v1/compliance/verify`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender:       address,
            recipient,
            tokenAddress: selected.address ?? '0x0000000000000000000000000000000000000000',
            amount:       formatUnits(r, selected.decimals),
            symbol:       selected.symbol,
            chainId,
          }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const data: OracleResponse = await res.json()
          setOracleData(data); setOracleDenied(!data.approved)
          txLog('oracle.preflight', { approved: data.approved, riskScore: data.riskScore, riskLevel: data.riskLevel, isEurc: data.isEurc })
        }
      } catch { /* Oracle offline */ }
      finally { setOracleChecking(false) }
    }
    const t = setTimeout(run, 800)
    return () => clearTimeout(t)
  }, [recipient, amount, selected?.symbol, address])

  // ── Receipts — identico a v4 ───────────────────────────────────────────
  const { isSuccess: approveOk } = useWaitForTransactionReceipt({
    hash: approvHash, query: { enabled: !!approvHash && phase === 'wait_approve' },
  })
  const { isSuccess: sendOk } = useWaitForTransactionReceipt({
    hash: sendHash, query: { enabled: !!sendHash && phase === 'wait_send' },
  })

  const { writeContractAsync } = useWriteContract()

  const execSend = useCallback(async (oracle: OracleResponse) => {
    const r = parseAmt(); if (!r || !selected) return
    setPhase('signing')
    txLog('tx.signing', { type: 'transferWithOracle', token: selected.symbol, isEurc: selected.isEurc })
    try {
      const hash = await writeContractAsync({
        address: FEE_ROUTER_ADDRESS, abi: FEE_ROUTER_ABI,
        functionName: 'transferWithOracle',
        args: [selected.address!, r, getAddress(recipient) as `0x${string}`,
          oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline),
          oracle.oracleSignature as `0x${string}`],
      })
      txLog('tx.broadcast', { hash })
      setSendHash(hash); setPhase('wait_send')
    } catch (e) { handleErr(e) }
  }, [parseAmt, selected, recipient])

  useEffect(() => {
    if (approveOk && phase === 'wait_approve' && oracleData) {
      txLog('tx.approved', {}); execSend(oracleData)
    }
  }, [approveOk, phase, oracleData, execSend])

  useEffect(() => {
    if (!sendOk || phase !== 'wait_send' || !sendHash || !selected || !address) return
    const r = parseAmt(); if (!r) return
    const { main, fee } = calcSplit(r)
    // EURC: controvalora già in EUR senza conversione
    const eurVal = selected.isEurc
      ? parseFloat(amount).toFixed(2) + ' EUR'
      : eurPrice ? (parseFloat(amount) * eurPrice).toFixed(2) + ' EUR' : undefined
    const ts = new Date().toISOString()
    setReport({ gross: r, net: main, fee, decimals: selected.decimals, symbol: selected.symbol, txHash: sendHash, timestamp: ts, eurValue: eurVal })

    generateRecord({
      txHash: sendHash, sender: address, recipient,
      gross: r, net: main, fee,
      decimals: selected.decimals, symbol: selected.symbol,
      paymentRef: oracleData?.paymentRef || '—',
      fiscalRef:  oracleData?.fiscalRef  || '—',
      chainId, isTestnet: IS_TESTNET,
    }).then(async rec => {
      setCompRec(rec)
      txLog('tx.compliance_generated', { id: rec.compliance_id })
      const apiResult = await complianceApi.submitAfterFinality(rec, 2500)
      if (apiResult.queued) {
        setTimeout(() => setToast({ msg: `Compliance in queue (${complianceApi.getPendingCount()} pending).`, color: T.amber }), 3000)
      }
    })

    txLog('tx.completed', { hash: sendHash, amount: formatUnits(r, selected.decimals), symbol: selected.symbol, isEurc: selected.isEurc })
    setPhase('done')
  }, [sendOk, phase])

  // ── EIP-1193 Error handler — identico a v4 ────────────────────────────
  function handleErr(e: unknown) {
    const m    = e instanceof Error ? e.message : String(e)
    const code = (e as { code?: number })?.code
    if (code === 4001 || m.includes('rejected') || m.includes('denied') || m.includes('cancel')) {
      txLog('tx.cancelled', { code: 4001 })
      setToast({ msg: 'Transazione annullata sul wallet.', color: T.amber }); setPhase('idle')
    } else if (m.includes('OracleSignatureInvalid') || m.includes('ComplianceSignatureInvalid')) {
      setTxError('Transazione negata per policy di conformità AML.'); setPhase('error')
    } else if (m.includes('insufficient funds')) {
      setTxError('Fondi insufficienti. Verifica saldo ETH per il gas.'); setPhase('error')
    } else if (m.includes('sequencer') || m.includes('Sequencer')) {
      setTxError('L2 Sequencer Down. Riprova tra qualche minuto.'); setPhase('error')
    } else if (m.includes('gas') || m.includes('intrinsic')) {
      setTxError('Errore stima gas. La rete potrebbe essere congestionata.'); setPhase('error')
    } else {
      setTxError('Errore: ' + m.slice(0, 100)); setPhase('error')
    }
  }

  const fmtBal = (t: TokenOption) => {
    const v = parseFloat(formatUnits(t.balance, t.decimals))
    return t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'EURC' ? v.toFixed(2)
      : t.symbol === 'cbBTC' ? v.toFixed(6) : v.toFixed(5)
  }

  const validateAddr = (addr: string) => {
    if (!addr) { setAddrError(''); return false }
    if (!isAddress(addr)) { setAddrError('Indirizzo non valido'); return false }
    setAddrError(''); return true
  }

  const handleMax = async () => {
    if (!selected) return
    if (selected.isNative) {
      try {
        const gp   = await publicClient?.getGasPrice() ?? 1_500_000_000n
        const cost = (21_000n * gp * 12n) / 10n
        setAmount(formatEther(selected.balance > cost ? selected.balance - cost : 0n))
      } catch { setAmount(formatEther(selected.balance)) }
    } else { setAmount(formatUnits(selected.balance, selected.decimals)) }
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  // ── handleTransfer — v4 + Oracle + EURC ───────────────────────────────
  const handleTransfer = async () => {
    const r = parseAmt(); if (!r || !selected || !validateAddr(recipient)) return
    let oracle = oracleData
    if (!oracle || !oracle.approved) {
      setPhase('preflight')
      try {
        const res = await fetch(`${API_BASE}/api/v1/compliance/verify`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: address, recipient,
            tokenAddress: selected.address ?? '0x0000000000000000000000000000000000000000',
            amount: formatUnits(r, selected.decimals),
            symbol: selected.symbol, chainId,
          }),
          signal: AbortSignal.timeout(10_000),
        })
        oracle = await res.json()
      } catch {
        setTxError('Oracle non raggiungibile. Riprova.'); setPhase('error'); return
      }
    }

    if (!oracle?.approved) {
      setOracleDenied(true); setOracleData(oracle); setPhase('idle'); return
    }

    txLog('tx.initiated', {
      token: selected.symbol, amount: formatUnits(r, selected.decimals),
      isEurc: selected.isEurc, silentFlow, gasless: gaslessBadge,
      riskScore: oracle.riskScore,
    })

    try {
      if (selected.isNative) {
        setPhase('signing')
        const hash = await writeContractAsync({
          address: FEE_ROUTER_ADDRESS, abi: FEE_ROUTER_ABI,
          functionName: 'transferETHWithOracle',
          args: [getAddress(recipient) as `0x${string}`,
            oracle.oracleNonce as `0x${string}`, BigInt(oracle.oracleDeadline),
            oracle.oracleSignature as `0x${string}`],
          value: r,
        })
        txLog('tx.broadcast_eth', { hash })
        setSendHash(hash); setPhase('wait_send')

      } else if (silentFlow) {
        txLog('tx.silent_flow', { msg: 'Allowance OK' })
        await execSend(oracle)

      } else {
        setPhase('approving')
        const approved = await permit2.ensureApproval(selected.address!)
        if (!approved) { handleErr(new Error(permit2.error || 'Permit2 approval failed')); return }
        const ah = await writeContractAsync({
          address: selected.address!, abi: erc20Abi,
          functionName: 'approve', args: [FEE_ROUTER_ADDRESS, r],
        })
        txLog('tx.approve_broadcast', { hash: ah })
        setApprovHash(ah); setPhase('wait_approve')
      }
    } catch (e) { handleErr(e) }
  }

  const reset = () => {
    setPhase('idle'); setAmount(''); setRecipient(''); setPaymentRef('')
    setFiscalRef(''); setReport(null); setCompRec(null)
    setApprovHash(undefined); setSendHash(undefined); setTxError('')
    setOracleData(null); setOracleDenied(false)
    permit2.reset(); paymaster.reset()
  }

  const handlePdf = () => {
    if (!report || !address) return
    generatePdfReceipt({
      txHash: report.txHash, timestamp: report.timestamp,
      sender: address, recipient,
      grossAmount: fmtU(report.gross, report.decimals),
      netAmount:   fmtU(report.net,   report.decimals),
      feeAmount:   fmtU(report.fee,   report.decimals),
      symbol:      report.symbol,
      paymentRef:  oracleData?.paymentRef || '—',
      fiscalRef:   oracleData?.fiscalRef  || '—',
      eurValue:    report.eurValue,
      network:     IS_TESTNET ? 'Base Sepolia' : 'Base Mainnet',
    })
  }

  const rawVal  = parseAmt()
  const split   = rawVal ? calcSplit(rawVal) : null
  const busy    = ['preflight','approving','wait_approve','signing','wait_send'].includes(phase)
  const dec     = selected?.decimals ?? 18
  const sym     = selected?.symbol ?? 'ETH'
  const isEurc  = selected?.isEurc ?? false
  // EURC: mostra direttamente in EUR senza conversione
  const eurVal  = isEurc && amount && Number(amount) > 0
    ? parseFloat(amount).toFixed(2)
    : eurPrice && amount && Number(amount) > 0
    ? (parseFloat(amount) * eurPrice).toFixed(2)
    : null
  const isWrong  = isConnected && chainId !== base.id && chainId !== baseSepolia.id
  const hasInsuf = isConnected && !!rawVal && !!selected && rawVal > selected.balance

  const ctaState: CtaState = !isConnected ? 'disconnected'
    : isWrong ? 'wrong_network'
    : busy ? 'busy'
    : hasInsuf ? 'insufficient'
    : oracleDenied ? 'oracle_denied'
    : !recipient || !!addrError ? 'no_recipient'
    : !rawVal ? 'no_amount'
    : 'ready'

  // ── Stili — identici a v4 ─────────────────────────────────────────────
  const C = {
    card:   { borderRadius: 28, background: T.card, border: `1px solid ${T.border}`, overflow: 'hidden', boxShadow: `0 24px 80px rgba(0,0,0,0.8), 0 0 60px ${T.emerald}05` } satisfies React.CSSProperties,
    box:    { borderRadius: 20, background: focused ? '#151526' : T.surface, padding: '16px 18px', borderWidth: 1.5, borderStyle: 'solid' as const, borderColor: focused ? (isEurc ? T.euBlue + '60' : T.emerald + '40') : 'transparent', transition: 'all 0.2s', cursor: 'text' } satisfies React.CSSProperties,
    box2:   { borderRadius: 20, background: T.surface, padding: '16px 18px' } satisfies React.CSSProperties,
    row:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } satisfies React.CSSProperties,
    mono:   { fontFamily: T.mono } satisfies React.CSSProperties,
    bigNum: { fontFamily: T.display, fontSize: '2.5rem', fontWeight: 300, letterSpacing: '-0.03em' } satisfies React.CSSProperties,
    muted:  { color: T.muted, fontSize: 13, fontWeight: 600 } satisfies React.CSSProperties,
    input:  { width: '100%', background: 'rgba(0,0,0,0.5)', border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px', color: T.text, fontSize: 14, outline: 'none', transition: 'all 0.2s', fontFamily: T.mono, boxSizing: 'border-box' as const } satisfies React.CSSProperties,
  }

  // ── Receive pill ──────────────────────────────────────────────────────
  const ReceivePill = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px 9px 9px', borderRadius: 18, background: isEurc ? T.euBlue + '20' : T.emerald + '15', border: `1px solid ${isEurc ? T.euBlue + '50' : T.emerald + '30'}` }}>
      {selected && <TokenLogo token={selected} size={24} />}
      <span style={{ fontSize: 14, fontWeight: 700, color: isEurc ? '#6699ff' : T.emerald }}>{sym}</span>
    </div>
  )

  // ── SUCCESS ───────────────────────────────────────────────────────────
  if (phase === 'done' && report) return (
    <>
      <div style={C.card}>
        <div style={{ padding: '18px 20px 16px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: T.emerald, boxShadow: `0 0 12px ${T.emerald}` }} />
          <span style={{ ...C.mono, color: T.emerald, fontSize: 13, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Pagamento Confermato</span>
          {report.symbol === 'EURC' && <span style={{ ...C.mono, fontSize: 10, color: '#6699ff', background: T.euBlue + '20', padding: '2px 7px', borderRadius: 5, border: `1px solid ${T.euBlue}40` }}>★ EU Standard</span>}
          <span style={{ ...C.mono, fontSize: 11, color: T.muted, marginLeft: 'auto' }}>{new Date(report.timestamp).toLocaleString('it-IT')}</span>
        </div>
        <div style={{ padding: '20px' }}>
          <TransactionStatusUI
            phase="done" txHash={report.txHash} isTestnet={IS_TESTNET}
            grossStr={fmtU(report.gross, report.decimals)}
            netStr={fmtU(report.net, report.decimals)}
            feeStr={fmtU(report.fee, report.decimals)}
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

  // ── MAIN FORM ─────────────────────────────────────────────────────────
  return (
    <>
      <div style={C.card}>
        {/* Header — identico a v4 + badge Oracle */}
        <div style={{ ...C.row, padding: '14px 18px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', color: T.text }}>Invia</span>
            {/* EURC badge priorità europea */}
            {isEurc && (
              <span style={{ ...C.mono, fontSize: 9, color: '#6699ff', background: T.euBlue + '20', padding: '2px 7px', borderRadius: 5, border: `1px solid ${T.euBlue}40` }}>★ Euro Standard UE</span>
            )}
            {silentFlow && !selected?.isNative && !isEurc && (
              <span style={{ ...C.mono, fontSize: 10, color: T.emerald, background: T.emerald + '10', padding: '2px 8px', borderRadius: 6, border: `1px solid ${T.emerald}25` }}>
                ⚡ Autorizzazione già presente
              </span>
            )}
            {!silentFlow && selected && !selected.isNative && (
              <span style={{ ...C.mono, fontSize: 9, color: '#a78bfa', background: '#a78bfa12', padding: '2px 7px', borderRadius: 5, border: '1px solid #a78bfa25' }}>Permit2</span>
            )}
            {gaslessBadge && (
              <span style={{ ...C.mono, fontSize: 9, color: T.emerald, background: T.emerald + '0d', padding: '2px 7px', borderRadius: 5, border: `1px solid ${T.emerald}20` }}>⛽ Gasless</span>
            )}
            {oracleChecking && (
              <span style={{ ...C.mono, fontSize: 9, color: T.amber, background: T.amber + '0d', padding: '2px 7px', borderRadius: 5, border: `1px solid ${T.amber}20` }}>🛡 AML…</span>
            )}
            {oracleData?.approved && !oracleChecking && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: T.mono, fontSize: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: oracleData.riskLevel === 'LOW' ? T.emerald : T.amber, boxShadow: `0 0 5px ${oracleData.riskLevel === 'LOW' ? T.emerald : T.amber}` }} />
                <span style={{ color: oracleData.riskLevel === 'LOW' ? T.emerald : T.amber }}>AML {oracleData.riskLevel} · {oracleData.riskScore}/100</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GasTracker />
            {isConnected && selected && <span style={{ ...C.mono, fontSize: 11, color: T.muted }}>{fmtBal(selected)} {sym}</span>}
            <button onClick={() => setShowExtras(p => !p)}
              style={{ width: 32, height: 32, borderRadius: 10, background: showExtras ? T.emerald + '15' : 'transparent', border: 'none', color: showExtras ? T.emerald : T.muted, cursor: 'pointer', fontSize: 15, transition: 'all 0.25s' }}>⚙</button>
          </div>
        </div>

        <div style={{ padding: '0 8px' }}>
          {/* SELL — identico a v4 con TokenDropdown */}
          <div style={C.box} onClick={() => inputRef.current?.focus()}>
            <div style={{ ...C.row, marginBottom: 8 }}>
              <span style={C.muted}>Sell</span>
              <button onClick={e => { e.stopPropagation(); handleMax() }}
                style={{ ...C.mono, fontSize: 12, color: isEurc ? '#6699ff' : T.emerald, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                {isConnected && selected ? `Saldo: ${fmtBal(selected)} MAX` : 'MAX'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                {/* Simbolo EUR per EURC */}
                {isEurc && <span style={{ ...C.bigNum, color: T.muted, marginRight: 2 }}>€</span>}
                <input ref={inputRef} type="number" placeholder="0" min="0" step="any"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                  disabled={busy}
                  style={{ ...C.bigNum, flex: 1, background: 'transparent', border: 'none', outline: 'none', color: busy ? T.muted : T.text, minWidth: 0 }}
                />
              </div>
              <div onClick={e => e.stopPropagation()}>
                <TokenDropdown tokens={tokens} selected={selected} busy={busy}
                  onSelect={t => { setSelected(t); setAmount(''); setOracleData(null); setOracleDenied(false) }}
                />
              </div>
            </div>
            <div style={{ ...C.row, marginTop: 6, ...C.mono, fontSize: 13, color: T.muted }}>
              <span>{isEurc ? (amount ? '€ ' + parseFloat(amount).toFixed(2) + ' EUR (no FX)' : '€ 0 EUR') : eurVal ? '≈ ' + eurVal + ' EUR' : '$0'}</span>
              {hasInsuf && <span style={{ color: T.red, fontSize: 12 }}>Saldo insufficiente</span>}
            </div>
          </div>

          {/* Arrow */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
            <button style={{ width: 36, height: 36, borderRadius: 12, background: T.surface, border: `2px solid ${T.border}`, color: T.muted, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.3s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(180deg)'; e.currentTarget.style.color = isEurc ? '#6699ff' : T.emerald }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'rotate(0)'; e.currentTarget.style.color = T.muted }}>↓</button>
          </div>

          {/* RECEIVE */}
          <div style={C.box2}>
            <div style={{ ...C.row, marginBottom: 8 }}>
              <span style={C.muted}>Receive</span>
              <span style={{ ...C.mono, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: (isEurc ? T.euBlue : T.emerald) + '12', color: isEurc ? '#6699ff' : T.emerald, border: `1px solid ${(isEurc ? T.euBlue : T.emerald)}25` }}>
                Auto · 0.5% fee
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ ...C.bigNum, flex: 1, color: split ? T.text : T.muted, transition: 'color 0.3s' }}>
                {isEurc && split ? '€ ' : ''}{split ? fmtU(split.main, dec) : '0'}
              </span>
              <ReceivePill />
            </div>
            <div style={{ ...C.mono, fontSize: 13, color: T.muted, marginTop: 6 }}>
              {split ? (isEurc ? `Fee: € ${fmtU(split.fee, dec)} EUR (0.5%)` : 'Fee: ' + fmtU(split.fee, dec) + ' ' + sym + ' (0.5%)') : 'Inserisci un importo'}
            </div>
          </div>

          {/* Recipient — identico a v4 */}
          <div style={{ margin: '8px 0', padding: '14px 16px', borderRadius: 16, background: T.surface, border: `1px solid ${T.border}` }}>
            <div style={{ ...C.row, marginBottom: 8 }}>
              <span style={{ ...C.mono, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: T.muted }}>Destinatario</span>
              {recipient && !addrError && <span style={{ ...C.mono, fontSize: 11, color: T.emerald }}>✓ Valido</span>}
              {addrError && <span style={{ ...C.mono, fontSize: 11, color: T.red }}>⚠ {addrError}</span>}
            </div>
            <input type="text" placeholder="0x..."
              value={recipient}
              onChange={e => { setRecipient(e.target.value); validateAddr(e.target.value); setOracleData(null); setOracleDenied(false) }}
              disabled={busy}
              style={{ ...C.input, borderColor: addrError ? T.red + '40' : recipient && !addrError ? T.emerald + '30' : T.border }}
            />
            <AddressVerifier address={recipient} />
          </div>

          {/* Oracle denial — messaggio istituzionale */}
          {oracleDenied && oracleData && !busy && (
            <div style={{ marginBottom: 8 }}>
              <OracleDenialBanner reason={oracleData.rejectionReason ?? 'Transazione negata per policy di conformità AML.'} />
            </div>
          )}

          {/* Extras DAC8 */}
          {showExtras && (
            <div style={{ margin: '0 0 8px', padding: '14px 16px', borderRadius: 16, background: T.surface, border: `1px solid ${T.border}`, animation: 'fadeSlideIn 0.25s ease' }}>
              <div style={{ ...C.mono, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: T.muted, marginBottom: 10 }}>
                payment_ref & fiscal_ref (MiCA/DAC8)
              </div>
              <input type="text" placeholder="Rif. pagamento (es. INV-001)"
                value={paymentRef} onChange={e => setPaymentRef(e.target.value)} disabled={busy}
                style={{ ...C.input, marginBottom: 8 }} />
              <input type="text" placeholder="ID Fiscale / Rif. Fattura (DAC8)"
                value={fiscalRef} onChange={e => setFiscalRef(e.target.value)} disabled={busy}
                style={C.input} />
              <div style={{ ...C.mono, fontSize: 10, color: T.muted + '80', marginTop: 6 }}>
                On-chain + SHA-256 → /api/v1/tx/callback · DAC8 XML export disponibile
              </div>
              {oracleData?.dac8Reportable && (
                <div style={{ ...C.mono, fontSize: 10, color: T.amber, marginTop: 4 }}>
                  ⚠ DAC8 reportable (≥ €1.000) — fiscal_ref obbligatorio per compliance UE
                </div>
              )}
              {complianceApi.getPendingCount() > 0 && (
                <div style={{ ...C.mono, fontSize: 10, color: T.amber, marginTop: 4 }}>
                  ⏳ {complianceApi.getPendingCount()} record in queue (retry al prossimo avvio)
                </div>
              )}
            </div>
          )}

          {/* Split preview */}
          {split && !hasInsuf && !oracleDenied && (
            <div style={{ margin: '0 0 8px', borderRadius: 14, overflow: 'hidden', border: `1px solid ${(isEurc ? T.euBlue : T.emerald)}20`, animation: 'fadeSlideIn 0.3s ease' }}>
              <div style={{ ...C.mono, padding: '7px 14px', background: (isEurc ? T.euBlue : T.emerald) + '08', fontSize: 10, color: isEurc ? '#6699ff' : T.emerald, fontWeight: 700, borderBottom: `1px solid ${(isEurc ? T.euBlue : T.emerald)}15`, letterSpacing: '0.06em' }}>
                200 · Preview split {isEurc ? '· EUR (no FX)' : ''}
              </div>
              {[
                { l: isEurc ? 'net_amount EUR (99.5%)' : 'net_amount (99.5%)', v: (isEurc ? '€ ' : '') + fmtU(split.main, dec) + (isEurc ? ' EUR' : ' ' + sym), h: true  },
                { l: isEurc ? 'fee_amount EUR (0.5%)' : 'fee_amount (0.5%)',  v: (isEurc ? '€ ' : '') + fmtU(split.fee, dec)  + (isEurc ? ' EUR' : ' ' + sym), h: false },
                ...(isEurc ? [{ l: 'currency', v: 'EUR (EURC · no conversion)', h: false }] : eurVal ? [{ l: 'fiat_amount', v: '≈ ' + eurVal + ' EUR', h: false }] : []),
                ...(gaslessBadge ? [{ l: 'gas_cost', v: '0.0000 USD · ⛽ Gasless', h: false }] : []),
              ].map((r, i, arr) => (
                <div key={i} style={{ display: 'flex', borderLeft: `1px dashed ${T.border}` }}>
                  <div style={{ width: '40%', padding: '7px 0 7px 14px', ...C.mono, fontSize: 11, color: T.muted, borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : 'none' }}>{r.l}</div>
                  <div style={{ width: '60%', padding: '7px 14px', ...C.mono, fontSize: 11, fontWeight: r.h ? 700 : 500, color: r.h ? (isEurc ? '#6699ff' : T.emerald) : T.muted, borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : 'none' }}>{r.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Ballistic progress — identico a v4 */}
          {phase === 'wait_send' && <div style={{ margin: '0 0 8px' }}><BallisticProgress active={true} /></div>}

          {/* TX Status — identico a v4 */}
          {(busy || phase === 'error') && (
            <div style={{ marginBottom: 8 }}>
              {busy && <MicroStateBadge phase={phase} silent={silentFlow} />}
              {phase === 'error' && <TransactionStatusUI phase="error" error={txError} isTestnet={IS_TESTNET} onReset={reset} />}
            </div>
          )}

          {/* Smart CTA — v4 + oracle_denied + EURC */}
          <div style={{ padding: '2px 0 4px' }}>
            {ctaState === 'disconnected' ? (
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button onClick={openConnectModal} style={{
                    width: '100%', padding: '17px', borderRadius: 22, border: 'none',
                    fontFamily: T.display, fontSize: 17, fontWeight: 700,
                    background: `linear-gradient(135deg, ${T.pink}, #ff6b9d)`,
                    color: '#fff', cursor: 'pointer',
                    boxShadow: `0 4px 28px ${T.pink}40`, transition: 'all 0.2s',
                  }}>Connetti wallet</button>
                )}
              </ConnectButton.Custom>
            ) : (
              <button
                onClick={ctaState === 'wrong_network'
                  ? () => switchChain({ chainId: chainId === base.id ? baseSepolia.id : base.id })
                  : ctaState === 'ready' ? handleTransfer : undefined}
                disabled={['busy','insufficient','no_recipient','no_amount','oracle_denied'].includes(ctaState)}
                style={{
                  width: '100%', padding: '17px', borderRadius: 22, border: 'none',
                  fontFamily: T.display, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em',
                  cursor: ['busy','insufficient','no_recipient','no_amount','oracle_denied'].includes(ctaState) ? 'not-allowed' : 'pointer',
                  background: ctaState === 'oracle_denied' ? T.red + '15'
                    : ctaState === 'busy' || ctaState === 'no_recipient' || ctaState === 'no_amount' ? T.emerald + '10'
                    : ctaState === 'insufficient' ? T.red + '15'
                    : ctaState === 'wrong_network' ? `linear-gradient(135deg, ${T.amber}, #ffcc00)`
                    : isEurc ? `linear-gradient(135deg, ${T.euBlue}, #0055ff)`
                    : `linear-gradient(135deg, ${T.emerald}, #00cc80)`,
                  color: ctaState === 'oracle_denied' ? T.red + '60'
                    : ctaState === 'busy' || ctaState === 'no_recipient' || ctaState === 'no_amount' ? T.emerald + '40'
                    : ctaState === 'insufficient' ? T.red + '60'
                    : isEurc ? '#fff' : '#000',
                  boxShadow: ctaState === 'ready' ? `0 4px 28px ${isEurc ? T.euBlue : T.emerald}35` : 'none',
                  transition: 'all 0.2s',
                }}
              >
                {busy ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${T.emerald}30`, borderTopColor: T.emerald, animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    {phase === 'preflight' ? '🛡 AML Check…' : phase === 'wait_send' ? 'finalizing_on_base…' : 'In corso…'}
                  </span>
                ) : ctaState === 'oracle_denied' ? '🚫 Transazione Bloccata'
                  : ctaState === 'wrong_network' ? 'Cambia rete'
                  : ctaState === 'insufficient' ? 'Saldo insufficiente'
                  : ctaState === 'no_recipient' ? 'Inserisci destinatario'
                  : ctaState === 'no_amount' ? 'Inserisci importo'
                  : isEurc ? `★ Invia € ${sym}`
                  : silentFlow && sym !== 'ETH' ? `⚡ Invia ${sym} · 1 firma`
                  : gaslessBadge ? `⛽ Invia ${sym} · Gasless`
                  : `Invia ${sym}`}
              </button>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '10px 0 14px', ...C.mono, fontSize: 10, color: T.muted + '60' }}>
            <span>🔒 FeeRouterV3</span>
            <span>⚡ Base L2</span>
            <span>📋 MiCA/DAC8</span>
            <span>🔏 Permit2</span>
            <span>🛡 AML Oracle</span>
            {isEurc && <span style={{ color: '#6699ff80' }}>★ EU</span>}
            {gaslessBadge && <span style={{ color: T.emerald + '55' }}>⛽ Gasless</span>}
            {isConnected && <span style={{ color: T.emerald + '45' }}>VASP ✓</span>}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.msg} color={toast.color} onDismiss={() => setToast(null)} />}

      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeUp { from { opacity:0; transform:translate(-50%,12px); } to { opacity:1; transform:translate(-50%,0); } }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      `}</style>
    </>
  )
}