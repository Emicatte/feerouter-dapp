'use client'

/**
 * AccountHeader.tsx V2 — Wallet Identity + Portfolio Trigger
 *
 * Il pill button apre un dropdown con:
 *   - Saldo in tempo reale
 *   - "Vedi Portfolio" → apre PortfolioDashboard overlay
 *   - Copia indirizzo, Explorer, Disconnect
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useBalance, useDisconnect, useChainId } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { formatUnits } from 'viem'
import { getRegistry } from '../lib/contractRegistry'
import dynamic from 'next/dynamic'

const PortfolioDashboard = dynamic(() => import('./PortfolioDashboard'), { ssr: false })

// ── Identicon ──────────────────────────────────────────────────────────────
function addressToColors(address: string): [string, string, string] {
  const h = address.toLowerCase().slice(2)
  const h1 = parseInt(h.slice(0,6), 16) % 360
  const h2 = (h1 + 120 + (parseInt(h.slice(6,10), 16) % 120)) % 360
  const h3 = (h2 + 90 + (parseInt(h.slice(10,14), 16) % 90)) % 360
  return [`hsl(${h1},70%,55%)`, `hsl(${h2},65%,50%)`, `hsl(${h3},75%,45%)`]
}

function Identicon({ address, size = 28 }: { address: string; size?: number }) {
  const [c1, c2, c3] = useMemo(() => addressToColors(address), [address])
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `conic-gradient(from 30deg, ${c1}, ${c2}, ${c3}, ${c1})`,
      border: '2px solid rgba(255,255,255,0.12)', flexShrink: 0,
    }} />
  )
}

function tr(addr: string, s=6, e=4): string {
  if (!addr || addr.length < s+e+2) return addr
  return `${addr.slice(0,s)}…${addr.slice(-e)}`
}

const BACKEND_URL = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

interface RecentTx {
  tx_hash: string; gross_amount: number; currency: string
  status: string; recipient: string; tx_timestamp: string
}

// ═══════════════════════════════════════════════════════════════════════════
export default function AccountHeader() {
  const { address, isConnected } = useAccount()
  const { disconnect }           = useDisconnect()
  const chainId                  = useChainId()
  const { data: balance }        = useBalance({ address })

  const [open, setOpen]                 = useState(false)
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [copied, setCopied]             = useState(false)
  const [recentTxs, setRecentTxs]       = useState<RecentTx[]>([])
  const [menuPos, setMenuPos]           = useState({ top: 0, right: 0 })
  const triggerRef                      = useRef<HTMLButtonElement>(null)

  const reg = getRegistry(chainId)

  // Posizione menu
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

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open])

  // Fetch recent txs
  useEffect(() => {
    if (!open || !address) return
    let c = false
    fetch(`${BACKEND_URL}/api/v1/tx/recent?wallet=${address}&limit=3`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!c) setRecentTxs(d.records ?? []) })
      .catch(() => { if (!c) setRecentTxs([]) })
    return () => { c = true }
  }, [open, address])

  const handleCopy = useCallback(async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }, [address])

  const balFmt = balance ? parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4) : '0.0000'
  const balSym = balance?.symbol ?? 'ETH'

  if (!isConnected || !address) {
    return (
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <button onClick={openConnectModal} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 20,
            background: 'linear-gradient(135deg, #00ffa3, #00cc80)',
            border: 'none', fontFamily: 'var(--font-display)',
            fontSize: 13, fontWeight: 700, color: '#000', cursor: 'pointer',
          }}>Connetti Wallet</button>
        )}
      </ConnectButton.Custom>
    )
  }

  return (
    <>
      {/* Pill Button */}
      <button ref={triggerRef} type="button" onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 12px 5px 5px', borderRadius: 24,
          background: open ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
          border: `1.5px solid ${open ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
          cursor: 'pointer', transition: 'all 0.15s', outline: 'none',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      >
        <Identicon address={address} size={26} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: '#e2e2f0' }}>
          {tr(address)}
        </span>
      </button>

      {/* Dropdown Portal */}
      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, zIndex: 99998,
            background: 'rgba(0,0,0,0.25)',
          }} />
          <div onClick={e => e.stopPropagation()} style={{
            position: 'fixed', top: menuPos.top, right: menuPos.right,
            width: 320, zIndex: 99999,
            background: '#111120', border: '1.5px solid rgba(255,255,255,0.12)',
            borderRadius: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.95)',
            overflow: 'hidden', animation: 'rpFadeUp 0.18s ease both',
          }}>
            {/* Identity */}
            <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#111120' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Identicon address={address} size={40} />
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500, color: '#e2e2f0' }}>{tr(address, 8, 6)}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: '#4a4a6a', marginTop: 2 }}>{reg?.chainName ?? 'Base'}</div>
                </div>
              </div>

              {/* Balance */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 14 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: '#e2e2f0', letterSpacing: '-0.03em' }}>{balFmt}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: '#4a4a6a' }}>{balSym}</span>
              </div>

              {/* View Portfolio — HERO BUTTON */}
              <button onClick={() => { setOpen(false); setPortfolioOpen(true) }} style={{
                width: '100%', padding: '11px 0', borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(0,255,163,0.08), rgba(0,255,163,0.02))',
                border: '1px solid rgba(0,255,163,0.2)',
                color: '#00ffa3', fontFamily: 'var(--font-display)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.15s', marginBottom: 10,
                letterSpacing: '-0.01em',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,255,163,0.15), rgba(0,255,163,0.05))'}
              onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,255,163,0.08), rgba(0,255,163,0.02))'}
              >
                📊 Vedi Portfolio
              </button>

              {/* Action row */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCopy} style={{
                  flex: 1, padding: '8px 0', borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  color: copied ? '#00ffa3' : '#e2e2f0',
                  fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}>{copied ? '✓ Copiato' : '⎘ Copia'}</button>

                <a href={`${reg?.blockExplorer ?? 'https://basescan.org'}/address/${address}`}
                  target="_blank" rel="noopener noreferrer" style={{
                  flex: 1, padding: '8px 0', borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e2e2f0', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600,
                  textDecoration: 'none', textAlign: 'center' as const, display: 'block',
                }}>↗ Explorer</a>

                <button onClick={() => { disconnect(); setOpen(false) }} style={{
                  flex: 1, padding: '8px 0', borderRadius: 10,
                  background: 'rgba(255,45,85,0.08)', border: '1px solid rgba(255,45,85,0.15)',
                  color: '#ff2d55', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}>⏻ Esci</button>
              </div>
            </div>

            {/* Recent Activity */}
            <div style={{ padding: '14px 18px 16px', background: '#111120' }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, color: '#4a4a6a',
                textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10,
              }}>Attività Recente</div>
              {recentTxs.length === 0 ? (
                <div style={{ padding: '12px 0', textAlign: 'center' as const }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: '#4a4a6a' }}>Nessuna attività</div>
                </div>
              ) : recentTxs.slice(0, 3).map((tx: RecentTx, i: number) => (
                <a key={tx.tx_hash || i}
                  href={`${reg?.blockExplorer ?? 'https://basescan.org'}/tx/${tx.tx_hash}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 8px', borderRadius: 10,
                    textDecoration: 'none', transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget).style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => (e.currentTarget).style.background = 'transparent'}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: tx.status === 'completed' ? '#00ffa3' : '#ffb800',
                    boxShadow: `0 0 6px ${tx.status === 'completed' ? '#00ffa3' : '#ffb800'}50`,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: '#e2e2f0' }}>
                      {tx.gross_amount?.toFixed(6)} {tx.currency}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4a4a6a', marginTop: 1 }}>
                      → {tr(tx.recipient || '', 6, 4)}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4a4a6a' }}>↗</div>
                </a>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Portfolio Dashboard Overlay */}
      <PortfolioDashboard open={portfolioOpen} onClose={() => setPortfolioOpen(false)} />
    </>
  )
}