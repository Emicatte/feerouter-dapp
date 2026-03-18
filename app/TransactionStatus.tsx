'use client'

/**
 * TransactionStatus.tsx v2 — Ricevuta fiscale moderna + ResponseCard
 */

import { formatUnits } from 'viem'

// ══════════════════════════════════════════════════════════════════════════
//  LIFECYCLE ENUM
// ══════════════════════════════════════════════════════════════════════════
export enum TxStatus {
  NEW             = 'new',
  PENDING         = 'pending',
  PAID            = 'paid',
  ORDER_SCHEDULED = 'order_scheduled',
  FINALIZING      = 'finalizing_on_base',
  COMPLETED       = 'completed',
  FAILED          = 'failed',
  CANCELLED       = 'cancelled',
}

export function phaseToTxStatus(phase: string): TxStatus {
  const map: Record<string, TxStatus> = {
    idle:         TxStatus.NEW,
    approving:    TxStatus.NEW,
    wait_approve: TxStatus.PENDING,
    signing:      TxStatus.ORDER_SCHEDULED,
    wait_send:    TxStatus.FINALIZING,
    done:         TxStatus.COMPLETED,
    error:        TxStatus.FAILED,
  }
  return map[phase] ?? TxStatus.NEW
}

export const TX_STATUS_COLOR: Record<TxStatus, string> = {
  [TxStatus.NEW]:             '#6b7280',
  [TxStatus.PENDING]:         '#f59e0b',
  [TxStatus.PAID]:            '#3b82f6',
  [TxStatus.ORDER_SCHEDULED]: '#a78bfa',
  [TxStatus.FINALIZING]:      '#f59e0b',
  [TxStatus.COMPLETED]:       '#00d26a',
  [TxStatus.FAILED]:          '#ef4444',
  [TxStatus.CANCELLED]:       '#6b7280',
}

// ══════════════════════════════════════════════════════════════════════════
//  CALLBACK PAYLOAD (DAC8 / Mercuryo schema)
// ══════════════════════════════════════════════════════════════════════════
export interface CallbackPayload {
  id:                      string
  type:                    'send'
  payment_method:          'crypto'
  sender_address:          string
  recipient_address:       string
  amount:                  string
  net_amount:              string
  fee_amount:              string
  currency:                string
  fiat_amount:             string | null
  fiat_currency:           'EUR' | null
  status:                  TxStatus
  network:                 'BASE' | 'BASE_SEPOLIA'
  payment_ref:             string
  fiscal_ref:              string
  merchant_transaction_id: string
  created_at:              string
  updated_at:              string
  created_at_ts:           number
  updated_at_ts:           number
  x_signature:             string
}

export function buildCallbackPayload(params: {
  txHash: string; sender: string; recipient: string
  gross: bigint; net: bigint; fee: bigint
  decimals: number; symbol: string
  paymentRef: string; fiscalRef: string
  eurValue?: string; isTestnet: boolean
}): CallbackPayload {
  const now    = new Date()
  const isoNow = now.toISOString()
  const tsNow  = Math.floor(now.getTime() / 1000)
  const fmt    = (n: bigint) => parseFloat(formatUnits(n, params.decimals)).toFixed(params.decimals)

  return {
    id:                      params.txHash.slice(0, 18),
    type:                    'send',
    payment_method:          'crypto',
    sender_address:          params.sender,
    recipient_address:       params.recipient,
    amount:                  fmt(params.gross),
    net_amount:              fmt(params.net),
    fee_amount:              fmt(params.fee),
    currency:                params.symbol,
    fiat_amount:             params.eurValue ?? null,
    fiat_currency:           params.eurValue ? 'EUR' : null,
    status:                  TxStatus.COMPLETED,
    network:                 params.isTestnet ? 'BASE_SEPOLIA' : 'BASE',
    payment_ref:             params.paymentRef || '—',
    fiscal_ref:              params.fiscalRef  || '—',
    merchant_transaction_id: params.txHash,
    created_at:              isoNow,
    updated_at:              isoNow,
    created_at_ts:           tsNow,
    updated_at_ts:           tsNow,
    x_signature:             'PENDING_SERVER_SIDE_HMAC_SHA256',
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  RESPONSE CARD — ricevuta fiscale moderna
// ══════════════════════════════════════════════════════════════════════════
interface ResponseCardProps {
  type:    'success' | 'error'
  title:   string
  code:    string
  rows:    { label: string; value: string; mono?: boolean; highlight?: boolean; copyable?: string }[]
  footer?: React.ReactNode
}

export function ResponseCard({ type, title, code, rows, footer }: ResponseCardProps): React.JSX.Element {
  const ok = type === 'success'

  return (
    <div style={{
      borderRadius: 16,
      border: `1px solid ${ok ? 'rgba(100,183,0,0.4)' : 'rgba(251,86,86,0.4)'}`,
      overflow: 'hidden',
      background: '#0a0a0a',
    }}>
      {/* Header — green/red block */}
      <div style={{
        padding: '14px 20px',
        background: ok ? 'rgba(100,183,0,0.1)' : 'rgba(251,86,86,0.1)',
        borderBottom: `1px solid ${ok ? 'rgba(100,183,0,0.2)' : 'rgba(251,86,86,0.2)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? '#00d26a' : '#ef4444', boxShadow: `0 0 8px ${ok ? '#00d26a' : '#ef4444'}` }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: ok ? '#a3e635' : '#f87171' }}>
            <span style={{ fontSize: 16 }}>{code}</span> · {title}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: ok ? 'rgba(163,230,53,0.5)' : 'rgba(248,113,113,0.5)', letterSpacing: '0.1em' }}>
          application/json
        </span>
      </div>

      {/* Body — tabella fiscale left/right stile Mercuryo */}
      <div>
        {rows.map((row, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start',
            borderBottom: i < rows.length - 1 ? '1px solid #111' : 'none',
            borderLeft: '2px dashed #1e1e1e',
          }}>
            {/* left_side 35% */}
            <div style={{
              width: '38%', padding: '10px 8px 10px 16px',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: '#555', flexShrink: 0, lineHeight: 1.4,
            }}>
              {row.label}
            </div>
            {/* right_side 62% */}
            <div style={{
              width: '62%', padding: '10px 16px 10px 8px',
              fontFamily: row.mono !== false ? 'var(--font-mono)' : 'var(--font-display)',
              fontSize: 12,
              fontWeight: row.highlight ? 700 : 500,
              color: row.highlight
                ? ok ? '#a3e635' : '#f87171'
                : '#d1d5db',
              wordBreak: 'break-all' as const,
              lineHeight: 1.4,
            }}>
              {row.value}
            </div>
          </div>
        ))}
      </div>

      {footer && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #111' }}>
          {footer}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  TRANSACTION STATUS UI
// ══════════════════════════════════════════════════════════════════════════
interface TransactionStatusProps {
  phase:       string
  txHash?:     string
  error?:      string
  isTestnet?:  boolean
  grossStr?:   string; netStr?: string; feeStr?: string
  symbol?:     string; recipient?: string
  paymentRef?: string; fiscalRef?: string
  eurValue?:   string; timestamp?: string
  onCopyHash?: () => void; copied?: boolean
  onReset?:    () => void
  onDownloadPdf?: () => void
}

export function TransactionStatusUI({
  phase, txHash, error, isTestnet = true,
  grossStr, netStr, feeStr, symbol = 'ETH',
  recipient, paymentRef, fiscalRef, eurValue, timestamp,
  onCopyHash, copied, onReset, onDownloadPdf,
}: TransactionStatusProps): React.JSX.Element | null {

  const status    = phaseToTxStatus(phase)
  const color     = TX_STATUS_COLOR[status]
  const basescan  = isTestnet ? 'https://sepolia.basescan.org/tx/' : 'https://basescan.org/tx/'
  const busy      = ['approving','wait_approve','signing','wait_send'].includes(phase)

  // ── SUCCESS: ricevuta fiscale completa ─────────────────────────────────
  if (phase === 'done' && grossStr && netStr && feeStr) {
    const rows = [
      { label: 'status',            value: '200 OK · completed',            highlight: true  },
      { label: 'amount',            value: grossStr + ' ' + symbol                           },
      { label: 'net_amount (99.5%)',value: netStr   + ' ' + symbol,         highlight: true  },
      { label: 'fee_amount (0.5%)', value: feeStr   + ' ' + symbol                          },
      ...(eurValue ? [{ label: 'fiat_amount', value: '≈ ' + eurValue + ' EUR' }] : []),
      { label: 'recipient',         value: recipient ? recipient.slice(0,12)+'…'+recipient.slice(-6) : '—' },
      ...(paymentRef && paymentRef !== '—' ? [{ label: 'payment_ref', value: paymentRef }] : []),
      ...(fiscalRef  && fiscalRef  !== '—' ? [{ label: 'fiscal_ref',  value: fiscalRef  }] : []),
      { label: 'network',           value: isTestnet ? 'BASE_SEPOLIA' : 'BASE'              },
      { label: 'updated_at',        value: timestamp ?? new Date().toISOString()             },
    ]

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ResponseCard
          type="success" code="200" title="Pagamento Confermato"
          rows={rows}
          footer={
            txHash ? (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#444', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 }}>
                  merchant_transaction_id
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#555', wordBreak: 'break-all' as const, flex: 1 }}>
                    {txHash}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                    <button onClick={onCopyHash} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: copied ? '#00d26a' : '#555', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {copied ? '✓ Copiato' : '📋'}
                    </button>
                    <a href={basescan + txHash} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ff9dc8', textDecoration: 'none' }}>
                      BaseScan ↗
                    </a>
                  </div>
                </div>
              </div>
            ) : undefined
          }
        />

        {/* Nota DAC8 */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#333', textAlign: 'center' as const }}>
          x_signature: PENDING_SERVER_SIDE_HMAC_SHA256 · Payload DAC8 salvato in rp_tx_history
        </div>

        {/* Azioni */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {onDownloadPdf && (
            <button onClick={onDownloadPdf} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '12px', borderRadius: 12,
              border: '1px solid rgba(255,0,122,0.25)',
              background: 'rgba(255,0,122,0.06)',
              color: '#ff9dc8', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,0,122,0.12)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,0,122,0.06)'}
            >
              📄 Scarica Ricevuta PDF
            </button>
          )}
          {onReset && (
            <button onClick={onReset} style={{
              padding: '12px', borderRadius: 12,
              border: '1px solid #1e1e1e', background: 'transparent',
              color: '#555', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'var(--font-display)',
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#888' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e1e1e'; e.currentTarget.style.color = '#555' }}
            >
              + Nuovo pagamento
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── ERROR: red block ───────────────────────────────────────────────────
  if (phase === 'error' && error) {
    const cancelled = error.includes('annullata') || error.includes('negata') || error.includes('rifiutata')
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ResponseCard
          type="error"
          code={cancelled ? '499' : '500'}
          title={cancelled ? 'Operazione annullata' : 'Transazione fallita'}
          rows={[
            { label: 'status',  value: cancelled ? '499 · User Cancelled' : '500 · TX Failed', highlight: true },
            { label: 'message', value: error },
            { label: 'network', value: isTestnet ? 'BASE_SEPOLIA' : 'BASE' },
          ]}
        />
        {onReset && (
          <button onClick={onReset} style={{ width: '100%', padding: '11px', borderRadius: 12, border: '1px solid #1e1e1e', background: 'transparent', color: '#555', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-display)', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#888' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e1e1e'; e.currentTarget.style.color = '#555' }}>
            Riprova
          </button>
        )}
      </div>
    )
  }

  // ── IN PROGRESS: badge animato ─────────────────────────────────────────
  if (busy) {
    const msgs: Record<string, string> = {
      approving:    'status: new · Richiesta approvazione token…',
      wait_approve: 'status: pending · Attesa conferma approve on-chain…',
      signing:      'status: order_scheduled · In attesa firma nel wallet…',
      wait_send:    'status: finalizing_on_base · Settlement su Base L2…',
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, background: '#0f0f0f', border: '1px solid #1e1e1e' }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${color}40`, borderTopColor: color, animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color }}>
          {msgs[phase] ?? 'status: ' + status + ' · In corso…'}
        </span>
      </div>
    )
  }

  return null
}

export default TransactionStatusUI
