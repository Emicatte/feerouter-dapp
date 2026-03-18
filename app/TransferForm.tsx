'use client'

/**
 * TransferForm.tsx — WalletConnect-First Edition
 *
 * 1. Smart CTA: macchina a stati (disconnected→wrong_network→insufficient→ready)
 * 2. Silent Flow: skip approve se allowance sufficiente + micro-copy ⚡
 * 3. EIP-1193 error handling: toast non invasivo per user rejected
 * 4. localStorage persistence: rp_tx_history (DAC8 ready)
 * 5. MAX con stima gas dinamica per ETH
 * 6. Saldo real-time del token selezionato nell'header
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  useAccount, useBalance, useReadContracts,
  useWriteContract, useWaitForTransactionReceipt,
  usePublicClient, useChainId, useSwitchChain,
} from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  parseEther, parseUnits, formatEther, formatUnits,
  erc20Abi, keccak256, toBytes, isAddress, getAddress,
  type Abi,
} from 'viem'
import { base, baseSepolia } from 'wagmi/chains'
import {
  TxStatus, phaseToTxStatus, buildCallbackPayload,
  TransactionStatusUI,
} from './TransactionStatus'
import { generatePdfReceipt } from '../lib/usePdfReceipt'

// ── Config ─────────────────────────────────────────────────────────────────
const TARGET_CHAIN_ID   = process.env.NEXT_PUBLIC_TARGET_CHAIN_ID
  ? parseInt(process.env.NEXT_PUBLIC_TARGET_CHAIN_ID)
  : base.id
const IS_TESTNET        = TARGET_CHAIN_ID === baseSepolia.id
const FEE_ROUTER_ADDRESS = (process.env.NEXT_PUBLIC_FEE_ROUTER_ADDRESS
  ?? '0xdE6224de0BAC254d4b0e4127057AB740678117c6') as `0x${string}`
const LS_KEY = 'rp_tx_history'

const FEE_ROUTER_ABI: Abi = [
  {
    name: 'splitTransferETH', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: '_to',         type: 'address' },
      { name: '_paymentRef', type: 'bytes32' },
      { name: '_fiscalRef',  type: 'string'  },
    ],
    outputs: [],
  },
  {
    name: 'splitTransferERC20', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: '_token',      type: 'address' },
      { name: '_to',         type: 'address' },
      { name: '_amount',     type: 'uint256' },
      { name: '_paymentRef', type: 'bytes32' },
      { name: '_fiscalRef',  type: 'string'  },
    ],
    outputs: [],
  },
]

const TOKENS = [
  { symbol: 'ETH',   address: undefined,                                                       decimals: 18, icon: '⬡', color: '#627EEA' },
  { symbol: 'USDC',  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`, decimals: 6,  icon: '💵', color: '#2775CA' },
  { symbol: 'DEGEN', address: '0x4edbc9320305298056041910220e3663a92540b6' as `0x${string}`, decimals: 18, icon: '🎩', color: '#845ef7' },
  { symbol: 'cbBTC', address: '0xcbB7C300c5aa597b90224F84d701f893d8F9696C' as `0x${string}`, decimals: 8,  icon: '₿',  color: '#F7931A' },
] as const

type Phase = 'idle' | 'approving' | 'wait_approve' | 'signing' | 'wait_send' | 'done' | 'error'

// ── Smart CTA states ───────────────────────────────────────────────────────
type CtaState = 'disconnected' | 'wrong_network' | 'insufficient' | 'no_recipient' | 'no_amount' | 'ready' | 'busy'

interface TokenOption {
  symbol: string; icon: string; color: string
  decimals: number; balance: bigint; address?: `0x${string}`
}

interface TxReport {
  txHash: `0x${string}`; gross: bigint; net: bigint; fee: bigint
  decimals: number; symbol: string; sender: string
  recipient: string; paymentRef: string; fiscalRef: string
  timestamp: string; eurValue?: string
}

function calcSplit(raw: bigint) {
  const fee = (raw * 50n) / 10_000n
  return { main: raw - fee, fee }
}
function fmtU(raw: bigint, dec: number, dp = 6) {
  return parseFloat(formatUnits(raw, dec)).toFixed(dp)
}

// ── Persistent logger (localStorage rp_tx_history) ─────────────────────────
function txLog(event: string, data: Record<string, unknown>) {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    network: IS_TESTNET ? 'BASE_SEPOLIA' : 'BASE',
    ...data,
  }
  // Console (dev)
  console.log('[rp_tx]', JSON.stringify(entry, null, 2))
  // Persist in localStorage
  try {
    const raw = localStorage.getItem(LS_KEY)
    const history: unknown[] = raw ? JSON.parse(raw) : []
    history.push(entry)
    // Mantieni max 200 entries
    if (history.length > 200) history.splice(0, history.length - 200)
    localStorage.setItem(LS_KEY, JSON.stringify(history))
  } catch { /* localStorage non disponibile (SSR) */ }
}

// ── EUR feed ───────────────────────────────────────────────────────────────
async function fetchEurPrice(symbol: string): Promise<number | null> {
  try {
    const id = symbol === 'ETH' ? 'ethereum' : symbol === 'USDC' ? 'usd-coin'
      : symbol === 'DEGEN' ? 'degen-base' : symbol === 'cbBTC' ? 'coinbase-wrapped-btc' : null
    if (!id) return null
    const res  = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur`)
    const data = await res.json()
    return data?.[id]?.eur ?? null
  } catch { return null }
}

// ══════════════════════════════════════════════════════════════════════════
//  TOAST — notifica non invasiva EIP-1193
// ══════════════════════════════════════════════════════════════════════════
function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, minWidth: 280, maxWidth: 400,
      background: '#1c1c1c', border: '1px solid #333',
      borderRadius: 12, padding: '12px 18px',
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      animation: 'fadeUp 0.3s ease',
    }}>
      <span style={{ fontSize: 16 }}>↩</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#9ca3af', flex: 1 }}>{message}</span>
      <button onClick={onDismiss} style={{ color: '#555', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>✕</button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPALE
// ══════════════════════════════════════════════════════════════════════════
export default function TransferForm(): React.JSX.Element {
  const { address, isConnected } = useAccount()
  const chainId                  = useChainId()
  const { switchChain }          = useSwitchChain()
  const publicClient             = usePublicClient()

  // Form
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
  const [toast,      setToast]      = useState<string | null>(null)

  // TX
  const [phase,      setPhase]      = useState<Phase>('idle')
  const [approvHash, setApprovHash] = useState<`0x${string}` | undefined>()
  const [sendHash,   setSendHash]   = useState<`0x${string}` | undefined>()
  const [report,     setReport]     = useState<TxReport | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: ethBal } = useBalance({ address })
  const erc20List = TOKENS.filter(t => t.address !== undefined)

  const { data: erc20Bals } = useReadContracts({
    contracts: erc20List.map(t => ({
      address: t.address as `0x${string}`, abi: erc20Abi,
      functionName: 'balanceOf' as const, args: [address!],
    })),
    query: { enabled: !!address },
  })

  useEffect(() => {
    const list: TokenOption[] = []
    if (ethBal?.value && ethBal.value > 0n) {
      const eth = TOKENS.find(t => t.symbol === 'ETH')!
      list.push({ ...eth, balance: ethBal.value })
    }
    erc20List.forEach((t, i) => {
      const raw = erc20Bals?.[i]?.result as bigint | undefined
      if (raw && raw > 0n) list.push({ ...t, balance: raw })
    })
    // Se connesso ma nessun saldo, mostra comunque ETH con 0
    if (isConnected && list.length === 0) {
      const eth = TOKENS.find(t => t.symbol === 'ETH')!
      list.push({ ...eth, balance: ethBal?.value ?? 0n })
    }
    setTokens(list)
    setSelected(prev => prev ? (list.find(t => t.symbol === prev.symbol) ?? list[0] ?? null) : (list[0] ?? null))
  }, [ethBal, erc20Bals, isConnected])

  useEffect(() => {
    if (!selected) return
    fetchEurPrice(selected.symbol).then(setEurPrice)
  }, [selected?.symbol])

  // ── Parse amount ───────────────────────────────────────────────────────
  const parseAmt = useCallback((): bigint | null => {
    if (!selected || !amount || isNaN(Number(amount)) || Number(amount) <= 0) return null
    try { return selected.symbol === 'ETH' ? parseEther(amount) : parseUnits(amount, selected.decimals) }
    catch { return null }
  }, [selected, amount])

  // ── Silent flow check ──────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const r = parseAmt()
      if (!r || !selected || selected.symbol === 'ETH' || !address) { setSilentFlow(false); return }
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

  // ── Smart CTA state ────────────────────────────────────────────────────
  const isWrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID
  const rawVal         = parseAmt()
  const split          = rawVal ? calcSplit(rawVal) : null
  const busy           = ['approving','wait_approve','signing','wait_send'].includes(phase)
  const hasInsufficientFunds = isConnected && rawVal && selected
    ? rawVal > selected.balance
    : false

  const ctaState: CtaState = (() => {
    if (!isConnected)          return 'disconnected'
    if (isWrongNetwork)        return 'wrong_network'
    if (busy)                  return 'busy'
    if (hasInsufficientFunds)  return 'insufficient'
    if (!recipient || addrError) return 'no_recipient'
    if (!rawVal)               return 'no_amount'
    return 'ready'
  })()

  const ctaConfig: Record<CtaState, { label: string; disabled: boolean; action: (() => void) | null; color: string }> = {
    disconnected: { label: 'Connetti wallet',    disabled: false, action: null,           color: '#ff007a' },
    wrong_network:{ label: `Passa a ${IS_TESTNET ? 'Base Sepolia' : 'Base'}`, disabled: false, action: () => switchChain({ chainId: TARGET_CHAIN_ID as typeof base.id }), color: '#f59e0b' },
    insufficient: { label: 'Saldo insufficiente', disabled: true, action: null,           color: '#ef4444' },
    no_recipient: { label: 'Inserisci destinatario', disabled: true, action: null,        color: '#ff007a' },
    no_amount:    { label: 'Inserisci un importo',   disabled: true, action: null,        color: '#ff007a' },
    ready:        { label: `Invia ${selected?.symbol ?? 'ETH'}`, disabled: false, action: () => handleTransfer(), color: '#ff007a' },
    busy:         { label: 'In corso…',           disabled: true, action: null,           color: '#ff007a' },
  }

  const cta = ctaConfig[ctaState]

  // ── Receipts ───────────────────────────────────────────────────────────
  const { isSuccess: approveOk } = useWaitForTransactionReceipt({
    hash: approvHash,
    query: { enabled: !!approvHash && phase === 'wait_approve' },
  })
  const { isSuccess: sendOk } = useWaitForTransactionReceipt({
    hash: sendHash,
    query: { enabled: !!sendHash && phase === 'wait_send' },
  })

  const { writeContractAsync } = useWriteContract()

  const execSend = useCallback(async () => {
    const r = parseAmt(); if (!r || !selected) return
    const ref = keccak256(toBytes(paymentRef || ''))
    setPhase('signing')
    txLog('tx.signing', { type: 'splitTransferERC20', token: selected.symbol, amount: formatUnits(r, selected.decimals) })
    try {
      const hash = await writeContractAsync({
        address: FEE_ROUTER_ADDRESS, abi: FEE_ROUTER_ABI,
        functionName: 'splitTransferERC20',
        args: [selected.address!, getAddress(recipient) as `0x${string}`, r, ref, fiscalRef],
      })
      txLog('tx.broadcast', { hash, status: TxStatus.PENDING })
      setSendHash(hash); setPhase('wait_send')
    } catch (e) {
      handleTxError(e)
    }
  }, [parseAmt, selected, paymentRef, fiscalRef, recipient])

  useEffect(() => {
    if (approveOk && phase === 'wait_approve') {
      txLog('tx.approved', { status: TxStatus.ORDER_SCHEDULED })
      execSend()
    }
  }, [approveOk, phase, execSend])

  useEffect(() => {
    if (sendOk && phase === 'wait_send' && sendHash && selected && address) {
      const r = parseAmt()
      if (r) {
        const { main, fee } = calcSplit(r)
        const eurVal = eurPrice ? (parseFloat(amount) * eurPrice).toFixed(2) + ' EUR' : undefined
        const rep: TxReport = {
          txHash: sendHash, gross: r, net: main, fee,
          decimals: selected.decimals, symbol: selected.symbol,
          sender: address, recipient,
          paymentRef: paymentRef || '—', fiscalRef: fiscalRef || '—',
          timestamp: new Date().toISOString(), eurValue: eurVal,
        }
        setReport(rep)
        // Payload Mercuryo completo → localStorage
        const payload = buildCallbackPayload({
          txHash: sendHash, sender: address, recipient,
          gross: r, net: main, fee,
          decimals: selected.decimals, symbol: selected.symbol,
          paymentRef: paymentRef || '—', fiscalRef: fiscalRef || '—',
          eurValue: eurVal, isTestnet: IS_TESTNET,
        })
        txLog('tx.completed', { ...payload })
        setPhase('done')
      }
    }
  }, [sendOk, phase])

  // ── EIP-1193 error handler ─────────────────────────────────────────────
  function handleTxError(e: unknown) {
    const m   = e instanceof Error ? e.message : String(e)
    const code = (e as { code?: number })?.code

    if (code === 4001 || m.includes('rejected') || m.includes('denied') || m.includes('cancel')) {
      // User rejected → toast non invasivo, ritorna a idle
      txLog('tx.cancelled', { status: TxStatus.CANCELLED, message: 'EIP-1193 code 4001' })
      setToast('Transazione annullata sul wallet.')
      setPhase('idle')
    } else {
      const msg = m.includes('insufficient funds') ? 'Fondi insufficienti.'
        : m.includes('gas') ? 'Errore stima gas. Riprova.'
        : 'Errore: ' + m.slice(0, 100)
      txLog('tx.error', { message: msg, status: TxStatus.FAILED })
      setPhase('error')
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────
  const fmtBal = (t: TokenOption) =>
    parseFloat(formatUnits(t.balance, t.decimals)).toFixed(t.symbol === 'USDC' ? 2 : t.symbol === 'cbBTC' ? 6 : 5)

  const validateAddr = (addr: string) => {
    if (!addr) { setAddrError(''); return false }
    if (!isAddress(addr)) { setAddrError('Indirizzo non valido'); return false }
    setAddrError(''); return true
  }

  const handleMax = async () => {
    if (!selected) return
    if (selected.symbol === 'ETH') {
      try {
        const gp   = await publicClient?.getGasPrice() ?? 1_500_000_000n
        const cost = (21_000n * gp * 12n) / 10n
        setAmount(formatEther(selected.balance > cost ? selected.balance - cost : 0n))
      } catch { setAmount(formatEther(selected.balance)) }
    } else { setAmount(formatUnits(selected.balance, selected.decimals)) }
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  const handleTransfer = async () => {
    const r = parseAmt(); if (!r || !selected || !validateAddr(recipient)) return
    const ref = keccak256(toBytes(paymentRef || ''))
    txLog('tx.initiated', { status: TxStatus.NEW, token: selected.symbol, amount: formatUnits(r, selected.decimals), recipient, silentFlow })
    try {
      if (selected.symbol === 'ETH') {
        setPhase('signing')
        const hash = await writeContractAsync({
          address: FEE_ROUTER_ADDRESS, abi: FEE_ROUTER_ABI,
          functionName: 'splitTransferETH',
          args: [getAddress(recipient) as `0x${string}`, ref, fiscalRef],
          value: r,
        })
        txLog('tx.broadcast', { hash, status: TxStatus.FINALIZING })
        setSendHash(hash); setPhase('wait_send')
      } else {
        if (silentFlow) {
          txLog('tx.silent_flow', { message: 'Allowance sufficiente — skip approve' })
          await execSend()
        } else {
          setPhase('approving')
          txLog('tx.approving', { token: selected.symbol })
          const ah = await writeContractAsync({
            address: selected.address!, abi: erc20Abi,
            functionName: 'approve', args: [FEE_ROUTER_ADDRESS, r],
          })
          txLog('tx.approve_broadcast', { hash: ah })
          setApprovHash(ah); setPhase('wait_approve')
        }
      }
    } catch (e) { handleTxError(e) }
  }

  const reset = () => {
    setPhase('idle'); setAmount(''); setRecipient(''); setPaymentRef('')
    setFiscalRef(''); setReport(null)
    setApprovHash(undefined); setSendHash(undefined)
  }

  const handleDownloadPdf = () => {
    if (!report || !address) return
    generatePdfReceipt({
      txHash: report.txHash, timestamp: report.timestamp,
      sender: address, recipient: report.recipient,
      grossAmount: fmtU(report.gross, report.decimals),
      netAmount:   fmtU(report.net,   report.decimals),
      feeAmount:   fmtU(report.fee,   report.decimals),
      symbol: report.symbol, paymentRef: report.paymentRef,
      fiscalRef: report.fiscalRef, eurValue: report.eurValue,
      network: IS_TESTNET ? 'Base Sepolia' : 'Base Mainnet',
    })
  }

  const dec    = selected?.decimals ?? 18
  const sym    = selected?.symbol ?? 'ETH'
  const eurVal = eurPrice && amount && Number(amount) > 0 ? (parseFloat(amount) * eurPrice).toFixed(2) : null

  // ── Stili — Uniswap look mantenuto ─────────────────────────────────────
  const C = {
    card:   { borderRadius: 28, background: '#12010f', border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' } satisfies React.CSSProperties,
    box:    { borderRadius: 20, background: focused ? '#201020' : '#1c0118', padding: '16px 18px', borderWidth: 1.5, borderStyle: 'solid' as const, borderColor: focused ? 'rgba(255,0,122,0.4)' : 'transparent', transition: 'all 0.2s', cursor: 'text' } satisfies React.CSSProperties,
    box2:   { borderRadius: 20, background: '#1c0118', padding: '16px 18px' } satisfies React.CSSProperties,
    row:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } satisfies React.CSSProperties,
    mono:   { fontFamily: 'var(--font-mono)' } satisfies React.CSSProperties,
    bigNum: { fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 300, letterSpacing: '-0.03em' } satisfies React.CSSProperties,
    muted:  { color: '#6b7280', fontSize: 13, fontWeight: 600 } satisfies React.CSSProperties,
    input:  { width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none', transition: 'all 0.2s', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' as const } satisfies React.CSSProperties,
  }

  const TokenPill = ({ pink = false }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px 9px 9px', borderRadius: 18, background: pink ? 'rgba(255,0,122,0.1)' : '#261020', border: pink ? '1px solid rgba(255,0,122,0.2)' : '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: selected?.color ?? '#627EEA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{selected?.icon ?? '⬡'}</div>
      <span style={{ fontSize: 14, fontWeight: 700, color: pink ? '#ff9dc8' : '#fff' }}>{sym}</span>
      {!pink && <span style={{ color: '#6b7280', fontSize: 10 }}>▾</span>}
    </div>
  )

  // ── SUCCESS ───────────────────────────────────────────────────────────
  if (phase === 'done' && report) return (
    <>
      <div style={C.card}>
        <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00d26a', boxShadow: '0 0 10px #00d26a' }} />
          <span style={{ ...C.mono, color: '#00d26a', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Pagamento Confermato</span>
          <span style={{ ...C.mono, fontSize: 11, color: '#333', marginLeft: 'auto' }}>{new Date(report.timestamp).toLocaleString('it-IT')}</span>
        </div>
        <div style={{ padding: '20px' }}>
          <TransactionStatusUI
            phase="done" txHash={report.txHash} isTestnet={IS_TESTNET}
            grossStr={fmtU(report.gross, report.decimals)}
            netStr={fmtU(report.net,   report.decimals)}
            feeStr={fmtU(report.fee,   report.decimals)}
            symbol={report.symbol}
            recipient={report.recipient} paymentRef={report.paymentRef}
            fiscalRef={report.fiscalRef} eurValue={report.eurValue}
            timestamp={report.timestamp}
            onCopyHash={async () => { await navigator.clipboard.writeText(report.txHash); setCopied(true); setTimeout(()=>setCopied(false),2000) }}
            copied={copied} onReset={reset} onDownloadPdf={handleDownloadPdf}
          />
        </div>
      </div>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </>
  )

  // ── MAIN FORM ─────────────────────────────────────────────────────────
  return (
    <>
      <div style={C.card}>
        {/* Header */}
        <div style={{ ...C.row, padding: '18px 20px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>Invia</span>
            {/* Silent flow badge */}
            {silentFlow && selected?.symbol !== 'ETH' && (
              <span style={{ ...C.mono, fontSize: 10, color: '#00d26a', background: 'rgba(0,210,106,0.08)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(0,210,106,0.2)' }}>
                ⚡ Autorizzazione già presente
              </span>
            )}
            {/* Wrong network warning */}
            {isWrongNetwork && (
              <span style={{ ...C.mono, fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(245,158,11,0.2)' }}>
                ⚠ Rete errata
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Saldo real-time del token selezionato */}
            {isConnected && selected && (
              <span style={{ ...C.mono, fontSize: 11, color: '#555' }}>
                {fmtBal(selected)} {sym}
              </span>
            )}
            <button
              onClick={() => setShowExtras(p => !p)}
              style={{ width: 34, height: 34, borderRadius: 12, background: showExtras ? 'rgba(255,0,122,0.1)' : 'transparent', border: 'none', color: showExtras ? '#ff9dc8' : '#6b7280', cursor: 'pointer', fontSize: 16, transition: 'all 0.3s' }}
              title="Riferimento pagamento / ID fiscale"
              onMouseEnter={e => { if (!showExtras) e.currentTarget.style.transform = 'rotate(45deg)' }}
              onMouseLeave={e => { if (!showExtras) e.currentTarget.style.transform = 'rotate(0deg)' }}
            >⚙</button>
          </div>
        </div>

        <div style={{ padding: '0 8px' }}>

          {/* SELL */}
          <div style={C.box} onClick={() => inputRef.current?.focus()}>
            <div style={{ ...C.row, marginBottom: 8 }}>
              <span style={C.muted}>Sell</span>
              <button onClick={e => { e.stopPropagation(); handleMax() }}
                style={{ ...C.mono, fontSize: 12, color: '#ff007a', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: 0 }}>
                {isConnected && selected ? `Saldo: ${fmtBal(selected)} MAX` : 'MAX'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input
                ref={inputRef}
                type="number" placeholder="0" min="0" step="any"
                value={amount} onChange={e => setAmount(e.target.value)}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                disabled={busy}
                style={{ ...C.bigNum, flex: 1, background: 'transparent', border: 'none', outline: 'none', color: busy ? '#555' : '#fff', minWidth: 0 }}
              />
              <div style={{ position: 'relative' }}>
                <TokenPill />
                <select
                  value={selected?.symbol ?? ''}
                  onChange={e => { setSelected(tokens.find(t => t.symbol === e.target.value) ?? null); setAmount('') }}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
                >
                  {tokens.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
                </select>
              </div>
            </div>
            <div style={{ ...C.row, marginTop: 6, ...C.mono, fontSize: 13, color: '#6b7280' }}>
              <span>{eurVal ? '≈ ' + eurVal + ' EUR' : '$0'}</span>
              {hasInsufficientFunds && (
                <span style={{ color: '#ef4444', fontSize: 12 }}>Saldo insufficiente</span>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
            <button
              style={{ width: 36, height: 36, borderRadius: 12, background: '#12010f', border: '2px solid #1c0118', color: '#6b7280', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.3s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(180deg)'; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'rotate(0deg)'; e.currentTarget.style.color = '#6b7280' }}
            >↓</button>
          </div>

          {/* RECEIVE */}
          <div style={C.box2}>
            <div style={{ ...C.row, marginBottom: 8 }}>
              <span style={C.muted}>Receive</span>
              <span style={{ ...C.mono, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,0,122,0.12)', color: '#ff9dc8', border: '1px solid rgba(255,0,122,0.2)' }}>
                Auto · 0.5% fee
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ ...C.bigNum, flex: 1, color: split ? '#fff' : '#3f4451', transition: 'color 0.3s' }}>
                {split ? fmtU(split.main, dec) : '0'}
              </span>
              <TokenPill pink />
            </div>
            <div style={{ ...C.mono, fontSize: 13, color: '#6b7280', marginTop: 6 }}>
              {split ? 'Fee: ' + fmtU(split.fee, dec) + ' ' + sym + ' (0.5%)' : 'Inserisci un importo'}
            </div>
          </div>

          {/* Recipient */}
          <div style={{ margin: '8px 0', padding: '14px 16px', borderRadius: 16, background: '#1c0118', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ ...C.row, marginBottom: 8 }}>
              <span style={{ ...C.mono, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#555' }}>Destinatario</span>
              {recipient && !addrError && <span style={{ ...C.mono, fontSize: 11, color: '#00d26a' }}>✓ Valido</span>}
              {addrError && <span style={{ ...C.mono, fontSize: 11, color: '#ef4444' }}>⚠ {addrError}</span>}
            </div>
            <input
              type="text" placeholder="0x..."
              value={recipient}
              onChange={e => { setRecipient(e.target.value); validateAddr(e.target.value) }}
              disabled={busy}
              style={{ ...C.input, borderColor: addrError ? 'rgba(239,68,68,0.4)' : recipient && !addrError ? 'rgba(0,210,106,0.25)' : 'rgba(255,255,255,0.08)' }}
            />
          </div>

          {/* Extras collassabile */}
          {showExtras && (
            <div style={{ margin: '0 0 8px', padding: '14px 16px', borderRadius: 16, background: '#1c0118', border: '1px solid rgba(255,255,255,0.05)', animation: 'fadeSlideIn 0.25s ease' }}>
              <div style={{ ...C.mono, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#555', marginBottom: 10 }}>
                payment_ref & fiscal_ref
              </div>
              <input type="text" placeholder="Rif. pagamento (es. INV-001)"
                value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
                disabled={busy} style={{ ...C.input, marginBottom: 8 }} />
              <input type="text" placeholder="ID Fiscale / Rif. Fattura (DAC8)"
                value={fiscalRef} onChange={e => setFiscalRef(e.target.value)}
                disabled={busy} style={C.input} />
              <div style={{ ...C.mono, fontSize: 10, color: '#333', marginTop: 6 }}>
                Salvati in rp_tx_history · DAC8/XML payload ready
              </div>
            </div>
          )}

          {/* Split preview (green block mini) */}
          {split && !hasInsufficientFunds && (
            <div style={{ margin: '0 0 8px', borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(100,183,0,0.2)', animation: 'fadeSlideIn 0.3s ease' }}>
              <div style={{ ...C.mono, padding: '7px 14px', background: 'rgba(100,183,0,0.07)', fontSize: 10, color: '#86efac', fontWeight: 600, borderBottom: '1px solid rgba(100,183,0,0.12)', letterSpacing: '0.05em' }}>
                200 · Preview split
              </div>
              {[
                { l: 'net_amount (99.5%)', v: fmtU(split.main, dec) + ' ' + sym, h: true  },
                { l: 'fee_amount (0.5%)',  v: fmtU(split.fee,  dec) + ' ' + sym, h: false },
                ...(eurVal ? [{ l: 'fiat_amount', v: '≈ ' + eurVal + ' EUR', h: false }] : []),
              ].map((r, i, arr) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', borderLeft: '1px dashed #2a2a2a' }}>
                  <div style={{ width: '40%', padding: '8px 0 8px 14px', ...C.mono, fontSize: 11, color: '#555', borderBottom: i < arr.length - 1 ? '1px solid #111' : 'none' }}>{r.l}</div>
                  <div style={{ width: '60%', padding: '8px 14px', ...C.mono, fontSize: 11, fontWeight: r.h ? 700 : 500, color: r.h ? '#86efac' : '#888', borderBottom: i < arr.length - 1 ? '1px solid #111' : 'none' }}>{r.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* TX Status (in-progress / error) */}
          {(busy || phase === 'error') && (
            <div style={{ marginBottom: 8 }}>
              <TransactionStatusUI
                phase={phase}
                error={phase === 'error' ? 'Errore transazione. Riprova.' : undefined}
                isTestnet={IS_TESTNET}
                onReset={reset}
              />
            </div>
          )}

          {/* Smart CTA */}
          <div style={{ padding: '2px 0 4px' }}>
            {ctaState === 'disconnected' ? (
              // RainbowKit ConnectButton custom
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button onClick={openConnectModal} style={{
                    width: '100%', padding: '17px', borderRadius: 22, border: 'none',
                    fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em',
                    background: 'linear-gradient(135deg, #ff007a, #ff6b9d)',
                    color: '#fff', cursor: 'pointer',
                    boxShadow: '0 4px 28px rgba(255,0,122,0.4)', transition: 'all 0.2s',
                  }}>
                    Connetti wallet
                  </button>
                )}
              </ConnectButton.Custom>
            ) : (
              <button
                onClick={cta.action ?? undefined}
                disabled={cta.disabled}
                style={{
                  width: '100%', padding: '17px', borderRadius: 22, border: 'none',
                  fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em',
                  cursor: cta.disabled ? 'not-allowed' : 'pointer',
                  background: cta.disabled
                    ? 'rgba(255,0,122,0.12)'
                    : ctaState === 'wrong_network'
                    ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
                    : ctaState === 'insufficient'
                    ? 'rgba(239,68,68,0.12)'
                    : 'linear-gradient(135deg, #ff007a, #ff6b9d)',
                  color: cta.disabled ? 'rgba(255,150,190,0.3)' : '#fff',
                  boxShadow: cta.disabled ? 'none'
                    : ctaState === 'wrong_network' ? '0 4px 24px rgba(245,158,11,0.4)'
                    : '0 4px 28px rgba(255,0,122,0.4)',
                  transition: 'all 0.2s',
                }}
              >
                {busy ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <span className="spinner" style={{ borderColor: 'rgba(255,150,190,0.4)', borderTopColor: 'transparent' }} />
                    {phase === 'approving' || phase === 'wait_approve' ? 'Approvazione…' : 'finalizing_on_base…'}
                  </span>
                ) : cta.label}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, padding: '10px 0 14px', ...C.mono, fontSize: 10, color: '#2a2a2a' }}>
            <span>🔒 FeeRouter v2</span><span>⚡ Base L2</span><span>📋 DAC8</span>
            {isConnected && <span style={{ color: '#333' }}>rp_tx_history ✓</span>}
          </div>
        </div>
      </div>

      {/* Toast EIP-1193 */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeUp { from { opacity:0; transform:translate(-50%,12px); } to { opacity:1; transform:translate(-50%,0); } }
        @keyframes spin { to { transform:rotate(360deg); } }
      `}</style>
    </>
  )
}
