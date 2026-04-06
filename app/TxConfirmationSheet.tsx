'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ── Theme (matches TransferForm T) ──────────────────────────────────────────
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
  muted:   'rgba(255,255,255,0.50)',
  text:    '#ffffff',
  D:       'var(--font-display)',
  M:       'var(--font-mono)',
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]
const GAS_EXPIRY_SEC = 60
const HIGH_VALUE_LOCK_SEC = 3

// ── Simple deterministic identicon from address ─────────────────────────────
function Identicon({ address, size = 32 }: { address: string; size?: number }) {
  const hash = address.toLowerCase().replace('0x', '')
  const colors: string[] = []
  for (let i = 0; i < 6; i++) {
    const h = parseInt(hash.slice(i * 4, i * 4 + 4), 16) % 360
    colors.push(`hsl(${h}, 65%, 55%)`)
  }
  const cellSize = size / 4
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: size / 4 }}>
      <rect width={size} height={size} fill="#111120" rx={size / 4} />
      {colors.map((c, i) => {
        const row = Math.floor(i / 2)
        const col = i % 2
        return (
          <g key={i}>
            <rect x={col * cellSize + cellSize * 0.5} y={row * cellSize + cellSize * 0.5} width={cellSize} height={cellSize} fill={c} rx={2} opacity={0.85} />
            <rect x={(3 - col) * cellSize + cellSize * 0.5 - cellSize} y={row * cellSize + cellSize * 0.5} width={cellSize} height={cellSize} fill={c} rx={2} opacity={0.85} />
          </g>
        )
      })}
    </svg>
  )
}

// ── Truncate address ────────────────────────────────────────────────────────
function truncAddr(addr: string) {
  if (addr.length <= 14) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ── Props ───────────────────────────────────────────────────────────────────
export interface TxConfirmationProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  amount: string
  token: string
  recipient: string
  recipientLabel?: string
  fiatValue?: string
  network: string
  gasFee?: string
  estimatedTime?: string
  isHighValue?: boolean
}

export default function TxConfirmationSheet({
  isOpen, onConfirm, onCancel,
  amount, token, recipient, recipientLabel,
  fiatValue, network, gasFee, estimatedTime,
  isHighValue,
}: TxConfirmationProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [copied, setCopied] = useState(false)
  const [highValueLock, setHighValueLock] = useState(0)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Reset timers when sheet opens
  useEffect(() => {
    if (!isOpen) { setElapsed(0); setHighValueLock(0); return }
    setElapsed(0)
    setHighValueLock(isHighValue ? HIGH_VALUE_LOCK_SEC : 0)
  }, [isOpen, isHighValue])

  // Elapsed timer — gas expiry
  useEffect(() => {
    if (!isOpen) return
    const iv = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(iv)
  }, [isOpen])

  // High-value countdown
  useEffect(() => {
    if (!isOpen || highValueLock <= 0) return
    const iv = setInterval(() => setHighValueLock(t => Math.max(0, t - 1)), 1000)
    return () => clearInterval(iv)
  }, [isOpen, highValueLock])

  const gasExpired = elapsed >= GAS_EXPIRY_SEC
  const confirmDisabled = highValueLock > 0

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(recipient)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [recipient])

  const handleConfirmClick = () => {
    if (gasExpired) {
      onCancel() // triggers re-quote
    } else {
      onConfirm()
    }
  }

  // ── Shared content ────────────────────────────────────────────────────────
  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: T.D, fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' }}>
          Conferma Transazione
        </span>
        <button
          onClick={onCancel}
          style={{
            width: 32, height: 32, borderRadius: 10,
            background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${T.border}`, color: T.muted,
            cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>
      </div>

      {/* Amount card */}
      <div style={{
        padding: '18px 16px', borderRadius: 16,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid rgba(255,255,255,0.10)`,
      }}>
        <div style={{ fontFamily: T.M, fontSize: 11, color: T.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Stai inviando
        </div>
        <div style={{ fontFamily: T.D, fontSize: 28, fontWeight: 600, color: T.text, letterSpacing: '-0.02em' }}>
          {amount} {token}
        </div>
        {fiatValue && (
          <div style={{ fontFamily: T.M, fontSize: 13, color: T.muted, marginTop: 4 }}>
            ~{fiatValue}
          </div>
        )}
      </div>

      {/* Recipient card */}
      <div style={{
        padding: '14px 16px', borderRadius: 16,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid rgba(255,255,255,0.10)`,
      }}>
        <div style={{ fontFamily: T.M, fontSize: 11, color: T.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Destinatario
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Identicon address={recipient} size={32} />
          <div style={{ flex: 1 }}>
            {recipientLabel && (
              <div style={{ fontFamily: T.D, fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                {recipientLabel}
              </div>
            )}
            <div style={{ fontFamily: T.M, fontSize: 12, color: T.muted }}>
              {truncAddr(recipient)}
            </div>
          </div>
          <button
            onClick={handleCopy}
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${T.border}`,
              cursor: 'pointer', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: copied ? T.emerald : T.muted,
              transition: 'color 0.2s',
            }}
          >
            {copied ? '✓' : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2 10V2.5A.5.5 0 012.5 2H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Details row */}
      <div style={{
        padding: '12px 16px', borderRadius: 14,
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid rgba(255,255,255,0.06)`,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <DetailRow label="Rete" value={network} />
        {gasFee && <DetailRow label="Gas stimato" value={gasFee} />}
        {estimatedTime && <DetailRow label="Tempo stimato" value={estimatedTime} />}
      </div>

      {/* High-value warning */}
      {isHighValue && (
        <div style={{
          padding: '10px 14px', borderRadius: 12,
          background: `${T.amber}0d`,
          border: `1px solid ${T.amber}30`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontFamily: T.D, fontSize: 12, fontWeight: 600, color: T.amber }}>
            Importo elevato. Verifica attentamente.
          </span>
        </div>
      )}

      {/* Gas expiry notice */}
      {gasExpired && (
        <div style={{
          padding: '10px 14px', borderRadius: 12,
          background: `${T.purple}0d`,
          border: `1px solid ${T.purple}30`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>⏱</span>
          <span style={{ fontFamily: T.D, fontSize: 12, fontWeight: 500, color: T.purple }}>
            Quotazione scaduta. Aggiorna per ricalcolare gas e fee.
          </span>
        </div>
      )}

      {/* Confirm button */}
      <button
        onClick={handleConfirmClick}
        disabled={confirmDisabled}
        style={{
          width: '100%', padding: '18px', borderRadius: 14, border: 'none',
          fontFamily: T.D, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em',
          background: gasExpired
            ? `linear-gradient(135deg, ${T.purple}, #c084fc)`
            : `linear-gradient(135deg, ${T.emerald}, #00cc80)`,
          color: gasExpired ? '#fff' : '#000',
          cursor: confirmDisabled ? 'not-allowed' : 'pointer',
          opacity: confirmDisabled ? 0.5 : 1,
          boxShadow: gasExpired
            ? `0 4px 20px ${T.purple}25`
            : `0 4px 20px ${T.emerald}25`,
          transition: 'all 0.2s ease',
        }}
      >
        {confirmDisabled
          ? `Conferma tra ${highValueLock}s…`
          : gasExpired
            ? 'Aggiorna Quotazione'
            : '✓ Conferma Invio'}
      </button>

      {/* Cancel button */}
      <button
        onClick={onCancel}
        style={{
          width: '100%', padding: '14px', borderRadius: 14, border: 'none',
          fontFamily: T.D, fontSize: 14, fontWeight: 600,
          background: 'rgba(255,255,255,0.04)',
          color: T.muted,
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
      >
        Annulla
      </button>
    </div>
  )

  // ── Mobile: bottom sheet | Desktop: centered modal ────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="tx-confirm-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onCancel}
            style={{
              position: 'fixed', inset: 0, zIndex: 2000,
              background: 'rgba(0,0,0,0.60)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          />

          {/* Sheet / Modal */}
          <motion.div
            key="tx-confirm-sheet"
            initial={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 20 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 20 }}
            transition={{ duration: 0.32, ease: EASE }}
            style={isMobile ? {
              position: 'fixed',
              bottom: 0, left: 0, right: 0,
              zIndex: 2001,
              background: '#111120',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              border: '1px solid rgba(255,255,255,0.10)',
              borderBottom: 'none',
              boxShadow: '0 -16px 64px rgba(0,0,0,0.7)',
              padding: '20px 20px calc(20px + var(--sab, 0px))',
              maxHeight: '90vh',
              overflowY: 'auto',
            } : {
              position: 'fixed',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 2001,
              width: '90%',
              maxWidth: 420,
              background: '#111120',
              borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 40px 100px rgba(0,0,0,0.7)',
              padding: '24px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            {/* Drag handle — mobile only */}
            {isMobile && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
              </div>
            )}
            {content}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Detail row helper ─────────────────────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontFamily: T.M, fontSize: 11, color: T.muted }}>{label}</span>
      <span style={{ fontFamily: T.D, fontSize: 13, fontWeight: 600, color: T.text }}>{value}</span>
    </div>
  )
}
