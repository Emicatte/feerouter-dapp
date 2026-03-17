'use client'

/**
 * TransferForm_b2b.tsx — B2B Corporate Payment Gateway
 *
 * Architettura transazionale:
 *
 *  ETH:   1 TX → FeeRouter.splitTransferETH(to, ref) {value: amount}
 *
 *  ERC20: 2 step —
 *    Step 1 (solo se allowance < amount):
 *      token.approve(FeeRouterAddress, amount)
 *    Step 2:
 *      FeeRouter.splitTransferERC20(token, to, amount, ref)
 *
 *  Il contratto gestisce lo split on-chain:
 *    99.5% → destinatario, 0.5% → feeRecipient
 *
 *  Una sola firma utente per ETH.
 *  Due firme per ERC20 se approve necessario, altrimenti una sola.
 */

import { useState, useEffect, useRef } from 'react'
import {
  useAccount, useBalance, useReadContracts,
  useWriteContract, useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi'
import {
  parseEther, parseUnits, formatEther, formatUnits,
  erc20Abi, keccak256, toBytes, isAddress, getAddress,
  type Abi,
} from 'viem'

// ══════════════════════════════════════════════════════════════════════════
//  CONFIG — imposta dopo il deploy del contratto
// ══════════════════════════════════════════════════════════════════════════

/**
 * Indirizzo del contratto FeeRouter deployato su Base Mainnet.
 * Ottieni questo dopo aver deployato FeeRouter.sol con Foundry o Hardhat.
 */
const FEE_ROUTER_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

// ABI minima del contratto FeeRouter (solo funzioni usate dal frontend)
const FEE_ROUTER_ABI: Abi = [
  // ETH
  {
    name: 'splitTransferETH',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_to',         type: 'address' },
      { name: '_paymentRef', type: 'bytes32' },
    ],
    outputs: [],
  },
  // ERC20
  {
    name: 'splitTransferERC20',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_token',      type: 'address' },
      { name: '_to',         type: 'address' },
      { name: '_amount',     type: 'uint256' },
      { name: '_paymentRef', type: 'bytes32' },
    ],
    outputs: [],
  },
  // View
  {
    name: 'calcSplit',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: '_amount', type: 'uint256' }],
    outputs: [{ name: 'net', type: 'uint256' }, { name: 'fee', type: 'uint256' }],
  },
  {
    name: 'checkAllowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '_token',  type: 'address' },
      { name: '_owner',  type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [
      { name: 'sufficient', type: 'bool'    },
      { name: 'current',    type: 'uint256' },
    ],
  },
  // Events (per BaseScan linking)
  {
    name: 'PaymentSent',
    type: 'event',
    inputs: [
      { name: 'sender',     type: 'address', indexed: true  },
      { name: 'recipient',  type: 'address', indexed: true  },
      { name: 'token',      type: 'address', indexed: true  },
      { name: 'grossAmount',type: 'uint256', indexed: false },
      { name: 'netAmount',  type: 'uint256', indexed: false },
      { name: 'feeAmount',  type: 'uint256', indexed: false },
      { name: 'paymentRef', type: 'bytes32', indexed: false },
    ],
  },
]

// ── Token registry Base Mainnet ────────────────────────────────────────────
const TOKENS = [
  { symbol: 'USDC',  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`, decimals: 6,  icon: '💵', color: '#2775CA' },
  { symbol: 'DEGEN', address: '0x4edbc9320305298056041910220e3663a92540b6' as `0x${string}`, decimals: 18, icon: '🎩', color: '#845ef7' },
  { symbol: 'cbBTC', address: '0xcbB7C300c5aa597b90224F84d701f893d8F9696C' as `0x${string}`, decimals: 8,  icon: '₿',  color: '#F7931A' },
] as const

// ── Tipi ───────────────────────────────────────────────────────────────────
type Phase =
  | 'idle'
  | 'approving'   // ERC20: approve in corso
  | 'wait_approve'// ERC20: attesa conferma approve
  | 'sending'     // invio splitTransfer
  | 'wait_send'   // attesa conferma finale
  | 'done'
  | 'error'

interface TokenOption {
  symbol: string; icon: string; color: string
  decimals: number; balance: bigint; address?: `0x${string}`
}

interface TxReport {
  txHash: `0x${string}`
  gross: bigint
  net: bigint
  fee: bigint
  decimals: number
  symbol: string
  recipient: string
  paymentRef: string
}

function calcSplitLocal(raw: bigint, bps = 50n, den = 10_000n) {
  const fee = (raw * bps) / den
  return { main: raw - fee, fee }
}

function fmtU(raw: bigint, dec: number, dp = 6) {
  return parseFloat(formatUnits(raw, dec)).toFixed(dp)
}

// ══════════════════════════════════════════════════════════════════════════
//  Componente principale
// ══════════════════════════════════════════════════════════════════════════
export default function TransferForm(): React.JSX.Element {
  const { address } = useAccount()
  const publicClient = usePublicClient()

  // Form state
  const [tokens,     setTokens]     = useState<TokenOption[]>([])
  const [selected,   setSelected]   = useState<TokenOption | null>(null)
  const [recipient,  setRecipient]  = useState('')
  const [amount,     setAmount]     = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [focused,    setFocused]    = useState<string | null>(null)
  const [addrError,  setAddrError]  = useState('')

  // TX state
  const [phase,      setPhase]      = useState<Phase>('idle')
  const [approvHash, setApprovHash] = useState<`0x${string}` | undefined>()
  const [sendHash,   setSendHash]   = useState<`0x${string}` | undefined>()
  const [txError,    setTxError]    = useState('')
  const [report,     setReport]     = useState<TxReport | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: ethBal } = useBalance({ address })

  const { data: erc20Bals } = useReadContracts({
    contracts: TOKENS.map(t => ({
      address: t.address, abi: erc20Abi,
      functionName: 'balanceOf' as const, args: [address!],
    })),
    query: { enabled: !!address },
  })

  useEffect(() => {
    const list: TokenOption[] = []
    if (ethBal?.value && ethBal.value > 0n)
      list.push({ symbol: 'ETH', icon: '⬡', color: '#627EEA', decimals: 18, balance: ethBal.value })
    TOKENS.forEach((t, i) => {
      const raw = erc20Bals?.[i]?.result as bigint | undefined
      if (raw && raw > 0n) list.push({ ...t, balance: raw })
    })
    setTokens(list)
    setSelected(prev => prev ? (list.find(t => t.symbol === prev.symbol) ?? list[0] ?? null) : (list[0] ?? null))
  }, [ethBal, erc20Bals])

  // ── Receipt watchers ───────────────────────────────────────────────────
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approvHash,
    query: { enabled: !!approvHash && phase === 'wait_approve' },
  })

  const { isSuccess: sendConfirmed } = useWaitForTransactionReceipt({
    hash: sendHash,
    query: { enabled: !!sendHash && phase === 'wait_send' },
  })

  // Approve confermato → esegui splitTransferERC20
  useEffect(() => {
    if (approveConfirmed && phase === 'wait_approve') execSend()
  }, [approveConfirmed, phase])

  // Send confermato → genera report
  useEffect(() => {
    if (sendConfirmed && phase === 'wait_send' && sendHash && selected) {
      const raw = parseAmtSafe()
      if (raw) {
        const { main, fee } = calcSplitLocal(raw)
        setReport({
          txHash: sendHash,
          gross: raw, net: main, fee,
          decimals: selected.decimals,
          symbol: selected.symbol,
          recipient,
          paymentRef: paymentRef || '—',
        })
        setPhase('done')
      }
    }
  }, [sendConfirmed, phase])

  const { writeContractAsync } = useWriteContract()

  // ── Helpers ────────────────────────────────────────────────────────────
  const parseAmtSafe = (): bigint | null => {
    if (!selected || !amount || isNaN(Number(amount)) || Number(amount) <= 0) return null
    try {
      return selected.symbol === 'ETH'
        ? parseEther(amount)
        : parseUnits(amount, selected.decimals)
    } catch { return null }
  }

  const encodeRef = (ref: string): `0x${string}` => {
    if (!ref) return '0x0000000000000000000000000000000000000000000000000000000000000000'
    return keccak256(toBytes(ref))
  }

  const decodeErr = (e: unknown): string => {
    const m = e instanceof Error ? e.message : String(e)
    if (m.includes('rejected') || m.includes('denied') || m.includes('cancel'))
      return 'Transazione rifiutata dall\'utente.'
    if (m.includes('insufficient funds') || m.includes('insufficient balance'))
      return 'Fondi insufficienti per completare la transazione.'
    if (m.includes('gas')) return 'Errore nella stima del gas. Riprova.'
    if (m.includes('allowance')) return 'Allowance insufficiente. Approva il token prima.'
    return 'Errore: ' + m.slice(0, 120)
  }

  const fmtBal = (t: TokenOption) =>
    parseFloat(formatUnits(t.balance, t.decimals))
      .toFixed(t.symbol === 'USDC' ? 2 : t.symbol === 'cbBTC' ? 6 : 5)

  const validateRecipient = (addr: string) => {
    if (!addr) { setAddrError(''); return false }
    try { getAddress(addr); setAddrError(''); return true }
    catch { setAddrError('Indirizzo non valido'); return false }
  }

  const handleMax = async () => {
    if (!selected) return
    if (selected.symbol === 'ETH') {
      try {
        const gp   = await publicClient?.getGasPrice() ?? 1_500_000_000n
        const cost = (21_000n * gp * 12n) / 10n
        setAmount(formatEther(selected.balance > cost ? selected.balance - cost : 0n))
      } catch { setAmount(formatEther(selected.balance)) }
    } else {
      setAmount(formatUnits(selected.balance, selected.decimals))
    }
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  // ── TX Flow ────────────────────────────────────────────────────────────
  const handleTransfer = async () => {
    const raw = parseAmtSafe()
    if (!raw || !selected || !validateRecipient(recipient)) return
    if (FEE_ROUTER_ADDRESS === '0x0000000000000000000000000000000000000000') {
      setTxError('FEE_ROUTER_ADDRESS non configurato. Deploya prima il contratto.')
      setPhase('error'); return
    }

    setTxError('')
    const ref = encodeRef(paymentRef)

    try {
      if (selected.symbol === 'ETH') {
        // ── ETH: una sola TX ────────────────────────────────────────────
        setPhase('sending')
        const hash = await writeContractAsync({
          address: FEE_ROUTER_ADDRESS,
          abi: FEE_ROUTER_ABI,
          functionName: 'splitTransferETH',
          args: [getAddress(recipient) as `0x${string}`, ref],
          value: raw,
        })
        setSendHash(hash)
        setPhase('wait_send')

      } else {
        // ── ERC20: controlla allowance → approve se necessario → send ──
        const allowance = await publicClient?.readContract({
          address: selected.address!,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address!, FEE_ROUTER_ADDRESS],
        }) as bigint | undefined

        if (!allowance || allowance < raw) {
          // Step 1: Approve
          setPhase('approving')
          const approveHash = await writeContractAsync({
            address: selected.address!,
            abi: erc20Abi,
            functionName: 'approve',
            args: [FEE_ROUTER_ADDRESS, raw],
          })
          setApprovHash(approveHash)
          setPhase('wait_approve')
          // execSend() viene chiamato automaticamente dal useEffect
        } else {
          // Allowance sufficiente → salta approve
          await execSend()
        }
      }
    } catch (e) {
      setTxError(decodeErr(e))
      setPhase('error')
    }
  }

  const execSend = async () => {
    const raw = parseAmtSafe()
    if (!raw || !selected) return
    const ref = encodeRef(paymentRef)
    setPhase('sending')
    try {
      const hash = await writeContractAsync({
        address: FEE_ROUTER_ADDRESS,
        abi: FEE_ROUTER_ABI,
        functionName: 'splitTransferERC20',
        args: [selected.address!, getAddress(recipient) as `0x${string}`, raw, ref],
      })
      setSendHash(hash)
      setPhase('wait_send')
    } catch (e) {
      setTxError(decodeErr(e))
      setPhase('error')
    }
  }

  const reset = () => {
    setPhase('idle'); setAmount(''); setRecipient('')
    setPaymentRef(''); setReport(null)
    setApprovHash(undefined); setSendHash(undefined); setTxError('')
  }

  const raw   = parseAmtSafe()
  const split = raw ? calcSplitLocal(raw) : null
  const busy  = ['approving','wait_approve','sending','wait_send'].includes(phase)
  const dec   = selected?.decimals ?? 18
  const sym   = selected?.symbol ?? 'ETH'

  // ── Stili corporate dark ───────────────────────────────────────────────
  const S: Record<string, React.CSSProperties> = {
    card:   { borderRadius: 16, background: '#0f0f0f', border: '1px solid #1e1e1e', boxShadow: '0 32px 80px rgba(0,0,0,0.8)', overflow: 'hidden', fontFamily: 'var(--font-display)' },
    header: { padding: '20px 24px 0', borderBottom: '1px solid #1a1a1a', paddingBottom: 16 },
    body:   { padding: '20px 24px 24px' },
    label:  { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#555', marginBottom: 8, fontFamily: 'var(--font-mono)' },
    input:  (f: boolean) => ({ width: '100%', background: f ? '#181818' : '#141414', border: `1px solid ${f ? '#ff007a44' : '#222'}`, borderRadius: 10, padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none', transition: 'all 0.2s', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' as const }),
    row:    { display: 'flex', gap: 12 },
    mono:   { fontFamily: 'var(--font-mono)' },
    divider:{ height: 1, background: '#1a1a1a', margin: '20px 0' },
  }

  const StatusRow = ({ icon, text, color = '#555' }: { icon: string; text: string; color?: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: '#141414', marginBottom: 8 }}>
      <span>{icon}</span>
      <span style={{ ...S.mono, fontSize: 13, color }}>{text}</span>
    </div>
  )

  // ── Empty state ────────────────────────────────────────────────────────
  if (tokens.length === 0) {
    return (
      <div style={{ ...S.card, padding: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
        <p style={{ color: '#555', fontFamily: 'var(--font-mono)', fontSize: 14 }}>Nessun saldo su Base.</p>
      </div>
    )
  }

  // ── SUCCESS REPORT ─────────────────────────────────────────────────────
  if (phase === 'done' && report) {
    return (
      <div style={S.card}>
        <div style={{ ...S.header, borderBottom: '1px solid #1a1a1a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00d26a', boxShadow: '0 0 8px #00d26a' }} />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#00d26a', fontFamily: 'var(--font-mono)' }}>
              Pagamento Confermato
            </span>
          </div>
        </div>
        <div style={S.body}>
          {/* Amount summary */}
          <div style={{ borderRadius: 12, border: '1px solid #1e1e1e', background: '#0a0a0a', overflow: 'hidden', marginBottom: 20 }}>
            {[
              { label: 'Importo lordo',  value: fmtU(report.gross, report.decimals) + ' ' + report.symbol, color: '#fff'     },
              { label: 'Inviati',        value: fmtU(report.net,   report.decimals) + ' ' + report.symbol, color: '#00d26a'  },
              { label: 'Fee (0.5%)',     value: fmtU(report.fee,   report.decimals) + ' ' + report.symbol, color: '#ff9dc8'  },
              { label: 'Destinatario',   value: report.recipient.slice(0,8)+'…'+report.recipient.slice(-6), color: '#aaa' },
              { label: 'Rif. Pagamento', value: report.paymentRef,                                          color: '#888' },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: i < 4 ? '1px solid #111' : 'none', fontSize: 13, ...S.mono }}>
                <span style={{ color: '#555' }}>{r.label}</span>
                <span style={{ color: r.color, fontWeight: 600 }}>{r.value}</span>
              </div>
            ))}
          </div>

          {/* TX Hash */}
          <div style={{ borderRadius: 10, background: '#141414', border: '1px solid #222', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#555', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const, marginBottom: 4 }}>TX Hash</div>
              <div style={{ ...S.mono, color: '#888', fontSize: 12 }}>{report.txHash.slice(0,18)}…{report.txHash.slice(-8)}</div>
            </div>
            <a
              href={'https://basescan.org/tx/' + report.txHash}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: 'rgba(255,0,122,0.08)', border: '1px solid rgba(255,0,122,0.2)', color: '#ff9dc8', fontSize: 12, fontWeight: 700, textDecoration: 'none', ...S.mono }}
            >
              BaseScan ↗
            </a>
          </div>

          <button onClick={reset} style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px solid #222', background: 'transparent', color: '#555', fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-display)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#888' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = '#555' }}
          >
            Nuovo pagamento
          </button>
        </div>
      </div>
    )
  }

  // ── MAIN FORM ──────────────────────────────────────────────────────────
  return (
    <div style={S.card}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>Pagamento B2B</div>
            <div style={{ ...S.mono, fontSize: 11, color: '#555', marginTop: 2 }}>Base Mainnet · FeeRouter v1</div>
          </div>
          {FEE_ROUTER_ADDRESS === '0x0000000000000000000000000000000000000000' && (
            <div style={{ ...S.mono, fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,165,0,0.1)', color: '#f59e0b', border: '1px solid rgba(255,165,0,0.2)' }}>
              ⚠ Contratto non configurato
            </div>
          )}
        </div>
      </div>

      <div style={S.body}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Asset selector */}
          <div>
            <span style={S.label}>Asset</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {tokens.map(t => (
                <button
                  key={t.symbol}
                  onClick={() => { setSelected(t); setAmount('') }}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    border: selected?.symbol === t.symbol ? '1px solid ' + t.color + '55' : '1px solid #1e1e1e',
                    background: selected?.symbol === t.symbol ? t.color + '11' : '#141414',
                    color: selected?.symbol === t.symbol ? '#fff' : '#555',
                    fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  <span style={{ fontSize: 14 }}>{t.icon}</span>
                  <div style={{ textAlign: 'left' as const }}>
                    <div style={{ fontSize: 13 }}>{t.symbol}</div>
                    <div style={{ fontSize: 10, color: '#555', fontFamily: 'var(--font-mono)' }}>{fmtBal(t)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Recipient */}
          <div>
            <span style={S.label}>Indirizzo Destinatario</span>
            <input
              type="text"
              placeholder="0x..."
              value={recipient}
              onChange={e => { setRecipient(e.target.value); validateRecipient(e.target.value) }}
              onFocus={() => setFocused('recipient')}
              onBlur={() => setFocused(null)}
              disabled={busy}
              style={{ ...S.input(focused === 'recipient'), borderColor: addrError ? '#ef444444' : focused === 'recipient' ? '#ff007a44' : '#222' }}
            />
            {addrError && <div style={{ ...S.mono, fontSize: 11, color: '#ef4444', marginTop: 4 }}>{addrError}</div>}
          </div>

          {/* Amount */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ ...S.label, margin: 0 }}>Importo</span>
              <button onClick={handleMax} style={{ ...S.mono, fontSize: 11, color: '#ff007a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                MAX: {selected ? fmtBal(selected) : '—'} {sym}
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                ref={inputRef}
                type="number" placeholder="0.00" min="0" step="any"
                value={amount} onChange={e => setAmount(e.target.value)}
                onFocus={() => setFocused('amount')} onBlur={() => setFocused(null)}
                disabled={busy}
                style={{ ...S.input(focused === 'amount'), fontSize: 22, fontWeight: 600, paddingRight: 80 }}
              />
              <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', ...S.mono, fontSize: 13, color: '#444', fontWeight: 700 }}>{sym}</span>
            </div>
          </div>

          {/* Payment Reference */}
          <div>
            <span style={S.label}>Riferimento Pagamento <span style={{ color: '#333' }}>(opzionale)</span></span>
            <input
              type="text"
              placeholder="es. INV-2024-001, ordine #XYZ"
              value={paymentRef}
              onChange={e => setPaymentRef(e.target.value)}
              onFocus={() => setFocused('ref')} onBlur={() => setFocused(null)}
              disabled={busy}
              style={S.input(focused === 'ref')}
            />
            <div style={{ ...S.mono, fontSize: 10, color: '#444', marginTop: 4 }}>
              Verrà registrato on-chain come keccak256 hash sull'evento PaymentSent
            </div>
          </div>

          {/* Split preview */}
          {split && (
            <div style={{ borderRadius: 10, border: '1px solid #1a1a1a', background: '#0a0a0a', overflow: 'hidden' }}>
              {[
                { l: 'Importo lordo',  v: fmtU(raw!, dec) + ' ' + sym, c: '#fff'    },
                { l: 'Al destinatario (99.5%)', v: fmtU(split.main, dec) + ' ' + sym, c: '#00d26a' },
                { l: 'Commissione (0.5%)',       v: fmtU(split.fee,  dec) + ' ' + sym, c: '#ff9dc8' },
                { l: 'Contratto',      v: FEE_ROUTER_ADDRESS.slice(0,10) + '…', c: '#555'   },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', borderBottom: i < 3 ? '1px solid #111' : 'none', fontSize: 12, ...S.mono }}>
                  <span style={{ color: '#444' }}>{r.l}</span>
                  <span style={{ color: r.c, fontWeight: 600 }}>{r.v}</span>
                </div>
              ))}
            </div>
          )}

          {/* TX Status */}
          {phase === 'approving'    && <StatusRow icon="🔐" text="Approvazione token in corso — firma nel wallet…" color="#f59e0b" />}
          {phase === 'wait_approve' && <StatusRow icon="⏳" text="Attesa conferma approvazione on-chain…" color="#f59e0b" />}
          {phase === 'sending'      && <StatusRow icon="📤" text="Invio pagamento — firma nel wallet…" color="#ff9dc8" />}
          {phase === 'wait_send'    && <StatusRow icon="⏳" text="Attesa conferma transazione on-chain…" color="#aaa" />}
          {phase === 'error' && (
            <div style={{ borderRadius: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', padding: '12px 14px', ...S.mono, fontSize: 13, color: '#f87171' }}>
              ❌ {txError}
            </div>
          )}

          {/* Step indicator per ERC20 */}
          {selected && selected.symbol !== 'ETH' && !busy && !split && (
            <div style={{ borderRadius: 8, background: '#0f0f0f', border: '1px solid #1a1a1a', padding: '10px 14px', ...S.mono, fontSize: 11, color: '#444' }}>
              ℹ Token ERC20: potrà essere richiesta 1 firma (approve) + 1 firma (invio)
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleTransfer}
            disabled={busy || !raw || !recipient || !!addrError}
            style={{
              width: '100%', padding: '15px', borderRadius: 12, border: 'none',
              fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
              cursor: busy || !raw || !recipient || !!addrError ? 'not-allowed' : 'pointer',
              background: busy || !raw || !recipient || !!addrError
                ? 'rgba(255,0,122,0.08)'
                : 'linear-gradient(135deg, #ff007a, #ff6b9d)',
              color: busy || !raw || !recipient || !!addrError ? 'rgba(255,150,190,0.25)' : '#fff',
              boxShadow: busy || !raw || !recipient || !!addrError ? 'none' : '0 4px 24px rgba(255,0,122,0.35)',
              transition: 'all 0.2s',
            }}
          >
            {busy ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span className="spinner" style={{ borderColor: 'rgba(255,150,190,0.3)', borderTopColor: 'transparent' }} />
                {phase === 'approving' || phase === 'wait_approve' ? 'Approvazione in corso…' : 'Invio in corso…'}
              </span>
            ) : !recipient
              ? 'Inserisci destinatario'
              : !raw
              ? 'Inserisci importo'
              : 'Invia pagamento'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, ...S.mono, fontSize: 10, color: '#333' }}>
            <span>🔒 Smart Contract</span>
            <span>⚡ Base Mainnet</span>
            <span>🧮 SafeERC20</span>
          </div>
        </div>
      </div>
    </div>
  )
}