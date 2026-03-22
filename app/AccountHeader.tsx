'use client'

/**
 * AccountHeader.tsx — Wallet Identity & Activity Panel
 *
 * Pill button in alto a destra con:
 *   - Identicon generato dall'indirizzo (gradient deterministico)
 *   - Indirizzo troncato + saldo in tempo reale
 *   - Dropdown (portal) con: copia indirizzo, explorer, recent activity, disconnect
 *   - Integrazione backend per ultime transazioni
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  useAccount, useBalance, useDisconnect, useChainId,
} from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { formatEther, formatUnits } from 'viem'
import { getRegistry } from '../lib/contractRegistry'

const BACKEND_URL = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

// ── Identicon — gradiente deterministico dall'indirizzo ──────────────────
function addressToColors(address: string): [string, string, string] {
  const hash = address.toLowerCase().slice(2)
  const h1 = parseInt(hash.slice(0, 6), 16) % 360
  const h2 = (h1 + 120 + (parseInt(hash.slice(6, 10), 16) % 120)) % 360
  const h3 = (h2 + 90 + (parseInt(hash.slice(10, 14), 16) % 90)) % 360
  return [
    `hsl(${h1}, 70%, 55%)`,
    `hsl(${h2}, 65%, 50%)`,
    `hsl(${h3}, 75%, 45%)`,
  ]
}

function Identicon({ address, size = 28 }: { address: string; size?: number }) {
  const [c1, c2, c3] = useMemo(() => addressToColors(address), [address])
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `conic-gradient(from 30deg, ${c1}, ${c2}, ${c3}, ${c1})`,
      border: '2px solid rgba(255,255,255,0.12)',
      flexShrink: 0,
    }} />
  )
}

// ── Tipi ────────────────────────────────────────────────────────────────
interface RecentTx {
  tx_hash:      string
  gross_amount: number
  currency:     string
  status:       string
  network:      string
  recipient:    string
  tx_timestamp: string
}

// ── Troncamento indirizzo ───────────────────────────────────────────────
function truncAddr(addr: string, start = 6, end = 4): string {
  if (!addr || addr.length < start + end + 2) return addr
  return `${addr.slice(0, start)}…${addr.slice(-end)}`
}

// ── Explorer URL ────────────────────────────────────────────────────────
function explorerUrl(chainId: number, hash: string): string {
  const reg = getRegistry(chainId)
  return `${reg?.blockExplorer ?? 'https://basescan.org'}/tx/${hash}`
}

function explorerAddrUrl(chainId: number, addr: string): string {
  const reg = getRegistry(chainId)
  return `${reg?.blockExplorer ?? 'https://basescan.org'}/address/${addr}`
}

// ═══════════════════════════════════════════════════════════════════════════
export default function AccountHeader() {
  const { address, isConnected }  = useAccount()
  const { disconnect }            = useDisconnect()
  const chainId                   = useChainId()
  const { data: balance }         = useBalance({ address })

  const [open, setOpen]           = useState(false)
  const [copied, setCopied]       = useState(false)
  const [recentTxs, setRecentTxs] = useState<RecentTx[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [menuPos, setMenuPos]     = useState({ top: 0, right: 0 })
  const triggerRef                = useRef<HTMLButtonElement>(null)

  const reg = getRegistry(chainId)

  // ── Posiziona il dropdown ──────────────────────────────────────────────
  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 10, right: window.innerWidth - r.right })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, updatePos])

  // ── ESC chiude ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open])

  // ── Fetch recent transactions dal backend ──────────────────────────────
  useEffect(() => {
    if (!open || !address) return
    let cancelled = false
    setTxLoading(true)

    fetch(`${BACKEND_URL}/api/v1/tx/recent?wallet=${address}&limit=5`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => {
        if (!cancelled) setRecentTxs(data.records ?? data ?? [])
      })
      .catch(() => {
        if (!cancelled) setRecentTxs([])
      })
      .finally(() => {
        if (!cancelled) setTxLoading(false)
      })

    return () => { cancelled = true }
  }, [open, address])

  // ── Copia indirizzo ────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [address])

  // ── Formatta saldo ─────────────────────────────────────────────────────
  const balFmt = balance
    ? parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)
    : '0.0000'
  const balSymbol = balance?.symbol ?? 'ETH'

  // ── Se non connesso → mostra ConnectButton di RainbowKit ──────────────
  if (!isConnected || !address) {
    return (
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <button
            onClick={openConnectModal}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px',
              borderRadius: 20,
              background: 'linear-gradient(135deg, #00ffa3, #00cc80)',
              border: 'none',
              fontFamily: 'var(--font-display)',
              fontSize: 13, fontWeight: 700,
              color: '#000',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              letterSpacing: '-0.01em',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            Connetti Wallet
          </button>
        )}
      </ConnectButton.Custom>
    )
  }

  return (
    <>
      {/* ═══ Pill Button ═══ */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 12px 5px 5px',
          borderRadius: 24,
          background: open ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
          border: `1.5px solid ${open ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          outline: 'none',
        }}
        onMouseEnter={e => {
          if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
        }}
        onMouseLeave={e => {
          if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
        }}
      >
        <Identicon address={address} size={26} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12, fontWeight: 500,
          color: '#e2e2f0',
        }}>
          {truncAddr(address)}
        </span>
      </button>

      {/* ═══ Portal Dropdown ═══ */}
      {open && typeof document !== 'undefined' && createPortal(
        <>
          {/* Overlay */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 99998,
              background: 'rgba(0,0,0,0.25)',
            }}
          />

          {/* Panel */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
              width: 320,
              zIndex: 99999,
              background: '#111120',
              border: '1.5px solid rgba(255,255,255,0.12)',
              borderRadius: 20,
              boxShadow: '0 24px 80px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.04)',
              overflow: 'hidden',
              animation: 'rpFadeUp 0.18s ease both',
            }}
          >
            {/* ── Identity Section ───────────────────────────────── */}
            <div style={{
              padding: '18px 18px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: '#111120',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Identicon address={address} size={40} />
                <div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14, fontWeight: 500, color: '#e2e2f0',
                  }}>
                    {truncAddr(address, 8, 6)}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 11, color: '#4a4a6a', marginTop: 2,
                  }}>
                    {reg?.chainName ?? 'Base'}
                  </div>
                </div>
              </div>

              {/* Balance */}
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 6,
                marginBottom: 12,
              }}>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 24, fontWeight: 800, color: '#e2e2f0',
                  letterSpacing: '-0.03em',
                }}>
                  {balFmt}
                </span>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 14, fontWeight: 600, color: '#4a4a6a',
                }}>
                  {balSymbol}
                </span>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                {/* Copy */}
                <button
                  onClick={handleCopy}
                  style={{
                    flex: 1, padding: '8px 0',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: copied ? '#00ffa3' : '#e2e2f0',
                    fontFamily: 'var(--font-display)',
                    fontSize: 11, fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                >
                  {copied ? '✓ Copiato' : '⎘ Copia'}
                </button>

                {/* Explorer */}
                <a
                  href={explorerAddrUrl(chainId, address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, padding: '8px 0',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#e2e2f0',
                    fontFamily: 'var(--font-display)',
                    fontSize: 11, fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textDecoration: 'none',
                    textAlign: 'center' as const,
                    display: 'block',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'}
                >
                  ↗ Explorer
                </a>

                {/* Disconnect */}
                <button
                  onClick={() => { disconnect(); setOpen(false) }}
                  style={{
                    flex: 1, padding: '8px 0',
                    borderRadius: 10,
                    background: 'rgba(255,45,85,0.08)',
                    border: '1px solid rgba(255,45,85,0.15)',
                    color: '#ff2d55',
                    fontFamily: 'var(--font-display)',
                    fontSize: 11, fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,45,85,0.15)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,45,85,0.08)'}
                >
                  ⏻ Esci
                </button>
              </div>
            </div>

            {/* ── Recent Activity ─────────────────────────────────── */}
            <div style={{ padding: '14px 18px 16px', background: '#111120' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11, fontWeight: 700, color: '#4a4a6a',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.08em',
                marginBottom: 10,
              }}>
                Attività Recente
              </div>

              {txLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
                  <div className="rp-spinner" style={{
                    width: 14, height: 14,
                    border: '2px solid rgba(0,255,163,0.2)',
                    borderTopColor: '#00ffa3',
                    borderRadius: '50%',
                  }} />
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: '#4a4a6a' }}>
                    Caricamento…
                  </span>
                </div>
              ) : recentTxs.length === 0 ? (
                <div style={{
                  padding: '16px 0',
                  textAlign: 'center' as const,
                }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>📋</div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 12, color: '#4a4a6a',
                  }}>
                    Nessuna attività fiscale trovata
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2 }}>
                  {recentTxs.slice(0, 5).map((tx, i) => (
                    <a
                      key={tx.tx_hash || i}
                      href={explorerUrl(chainId, tx.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 10px',
                        borderRadius: 10,
                        background: '#111120',
                        textDecoration: 'none',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#111120'}
                    >
                      {/* Status dot */}
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: tx.status === 'completed' ? '#00ffa3'
                          : tx.status === 'pending' ? '#ffb800' : '#ff2d55',
                        boxShadow: `0 0 6px ${
                          tx.status === 'completed' ? '#00ffa3'
                          : tx.status === 'pending' ? '#ffb800' : '#ff2d55'
                        }50`,
                      }} />

                      {/* Details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 12, fontWeight: 600, color: '#e2e2f0',
                          whiteSpace: 'nowrap' as const,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {tx.gross_amount?.toFixed(6)} {tx.currency}
                        </div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10, color: '#4a4a6a', marginTop: 1,
                        }}>
                          → {truncAddr(tx.recipient || '', 6, 4)}
                        </div>
                      </div>

                      {/* Timestamp + arrow */}
                      <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10, color: '#4a4a6a',
                        }}>
                          {tx.tx_timestamp
                            ? new Date(tx.tx_timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </div>
                        <div style={{ fontSize: 10, color: '#4a4a6a' }}>↗</div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}