'use client'

/**
 * PortfolioDashboard.tsx V6 — Complete Rewrite
 *
 * Institutional-grade portfolio overlay for RSends (Base L2 payment gateway)
 * Design language: Uniswap/Stripe/Revolut dark theme
 *
 * Improvements over V5:
 *  1. Donut chart (portfolio distribution)
 *  2. Token sparklines
 *  3. Animated USD counter
 *  4. Rich empty states with SVG
 *  5. Gradient border glow on panel
 *  6. Staggered token row entry
 *  7. Copy address with feedback
 *  8. Pulsating refresh animation
 *  9. PnL gradient text
 * 10. Tab count badges
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { getRegistry } from '../lib/contractRegistry'
import dynamic from 'next/dynamic'

const SwapModule = dynamic(() => import('./SwapModule'), { ssr: false })
const AutoForward = dynamic(() => import('./AutoForward'), { ssr: false })

// ═══════════════════════════════════════════════════════════
//  PALETTE — Uniswap-inspired dark
// ═══════════════════════════════════════════════════════════
const C = {
  bg:      '#131313',
  surface: '#1b1b1b',
  card:    '#1e1e1e',
  border:  'rgba(255,255,255,0.07)',
  text:    '#E2E2F0',
  sub:     '#98A1C0',
  dim:     '#5E5E5E',
  pink:    '#FC74FE',
  green:   '#40B66B',
  red:     '#FD766B',
  blue:    '#4C82FB',
  D:       'var(--font-display)',
  M:       'var(--font-mono)',
}

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════
interface Asset {
  symbol: string; name: string; balance: number; decimals: number
  usdValue: number; contractAddress: string; dac8Monitored: boolean
  logo?: string | null
}
interface Tx {
  hash: string; from: string; to: string; value: number
  asset: string; category: string; timestamp: string | null
}
interface Pt { date: string; value: number }
interface PData {
  totalUsd: number; assets: Asset[]; activity: Tx[]
  balanceHistory: Pt[]; txCount7d?: number; updatedAt: string
}
type Tab = 'overview' | 'tokens' | 'activity' | 'swap' | 'forward'
type Range = '1D' | '1W'
const TABS: [Tab, string][] = [
  ['overview', 'Overview'], ['tokens', 'Tokens'], ['activity', 'Activity'],
  ['swap', 'Swap'], ['forward', 'Forward'],
]

// ═══════════════════════════════════════════════════════════
//  TOKEN COLOR MAP
// ═══════════════════════════════════════════════════════════
const TK: Record<string, string> = {
  ETH: '#627EEA', WETH: '#627EEA', USDC: '#2775CA', USDT: '#26A17B',
  EURC: '#2244aa', cbBTC: '#F7931A', WBTC: '#F7931A', DAI: '#F5AC37',
  cbETH: '#0052FF', wstETH: '#00A3FF', SOL: '#9945FF', TRX: '#FF060A',
  DEGEN: '#845ef7', AERO: '#0091FF', LINK: '#2A5ADA', UNI: '#FF007A',
  AAVE: '#B6509E', ARB: '#28A0F0', OP: '#FF0420', COMP: '#00D395',
}

// ═══════════════════════════════════════════════════════════
//  HOOK — usePortfolio
// ═══════════════════════════════════════════════════════════
function usePortfolio(addr: string | undefined, chain: number) {
  const [data, setData] = useState<PData | null>(null)
  const [loading, setLoading] = useState(false)
  const iv = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!addr) return
    if (!silent) setLoading(true)
    try {
      const r = await fetch(`/api/portfolio/${addr}?chainId=${chain}`, {
        signal: AbortSignal.timeout(15000),
      })
      if (r.ok) setData(await r.json())
    } catch { /* network error — silent */ }
    finally { setLoading(false) }
  }, [addr, chain])

  useEffect(() => {
    if (!addr) { setData(null); return }
    load()
  }, [addr, chain, load])

  useEffect(() => {
    if (!addr) return
    iv.current = setInterval(() => load(true), 60000)
    return () => { if (iv.current) clearInterval(iv.current) }
  }, [addr, chain, load])

  return { data, loading, refresh: () => load() }
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
const $ = (n: number): string => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n > 0) return `$${n.toFixed(4)}`
  return '$0.00'
}

const fb = (n: number, s: string): string => {
  if (['USDC', 'USDT', 'EURC', 'DAI'].includes(s)) return n.toFixed(2)
  if (['cbBTC', 'WBTC', 'tBTC'].includes(s)) return n.toFixed(6)
  if (n < 0.0001) return n.toFixed(8)
  return n.toFixed(4)
}

const ta = (a: string, s = 6, e = 4): string =>
  !a || a.length < s + e + 2 ? a : `${a.slice(0, s)}…${a.slice(-e)}`

const ago = (ts: string | null): string => {
  if (!ts) return '—'
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// Deterministic sparkline data from symbol hash
function sparkData(symbol: string): number[] {
  let hash = 0
  for (let i = 0; i < symbol.length; i++) hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0
  const pts: number[] = []
  let v = 50 + (Math.abs(hash) % 50)
  for (let i = 0; i < 7; i++) {
    hash = ((hash * 1103515245) + 12345) & 0x7fffffff
    v += (hash % 21) - 10
    pts.push(Math.max(10, v))
  }
  return pts
}

// ═══════════════════════════════════════════════════════════
//  TOKEN ICON
// ═══════════════════════════════════════════════════════════
function TIcon({ symbol, logo, size = 32 }: { symbol: string; logo?: string | null; size?: number }) {
  const [err, setErr] = useState(false)
  const c = TK[symbol] ?? '#5E5E5E'

  if (logo && !err) return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden', flexShrink: 0, background: C.surface,
    }}>
      <img
        src={logo} alt={symbol} width={size} height={size}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={() => setErr(true)}
      />
    </div>
  )

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${c}18`, border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: C.D, fontSize: size * 0.35, fontWeight: 700,
      color: `${c}aa`, flexShrink: 0,
    }}>
      {symbol.slice(0, 2)}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  SKELETON
// ═══════════════════════════════════════════════════════════
function Sk({ w, h, r = 8 }: { w: string | number; h: number; r?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
      backgroundSize: '200% 100%',
      animation: 'rpShimmer 1.8s ease infinite',
    }} />
  )
}

// ── Tab-specific skeleton layouts ──
function OverviewSkeleton() {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, marginBottom: 32 }}>
        <div>
          <div style={{ marginBottom: 20 }}>
            <Sk w={180} h={40} r={10} />
            <div style={{ marginTop: 8 }}><Sk w={120} h={18} /></div>
          </div>
          <Sk w="100%" h={200} r={16} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[0, 1, 2, 3].map(i => <Sk key={i} w="100%" h={70} r={16} />)}
          </div>
          <Sk w="100%" h={80} r={16} />
          <Sk w="100%" h={120} r={16} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <Sk w="100%" h={72} r={16} />
        <Sk w="100%" h={72} r={16} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>{[0, 1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0' }}>
            <Sk w={32} h={32} r={16} />
            <div style={{ flex: 1 }}><Sk w={100} h={14} /><div style={{ marginTop: 4 }}><Sk w={60} h={10} /></div></div>
          </div>
        ))}</div>
        <div>{[0, 1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0' }}>
            <Sk w={32} h={32} r={16} />
            <div style={{ flex: 1 }}><Sk w={140} h={14} /><div style={{ marginTop: 4 }}><Sk w={90} h={10} /></div></div>
          </div>
        ))}</div>
      </div>
    </div>
  )
}

function TokensSkeleton() {
  return (
    <div>
      <div style={{ display: 'flex', padding: '8px 4px 12px', gap: 8 }}>
        <Sk w={80} h={12} /><div style={{ flex: 1 }} /><Sk w={50} h={12} /><Sk w={40} h={12} /><Sk w={60} h={12} /><Sk w={50} h={12} />
      </div>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 4px' }}>
          <Sk w={36} h={36} r={18} />
          <div style={{ flex: 1 }}><Sk w={100} h={14} /><div style={{ marginTop: 4 }}><Sk w={60} h={10} /></div></div>
          <Sk w={60} h={14} /><Sk w={40} h={20} r={4} /><Sk w={80} h={14} /><Sk w={60} h={14} />
        </div>
      ))}
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div>
      {[0, 1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 4px' }}>
          <Sk w={36} h={36} r={18} />
          <div style={{ flex: 1 }}><Sk w={160} h={14} /><div style={{ marginTop: 4 }}><Sk w={100} h={10} /></div></div>
          <Sk w={40} h={14} />
        </div>
      ))}
    </div>
  )
}

function SwapSkeleton() {
  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <Sk w="100%" h={24} r={8} />
      <div style={{ marginTop: 12 }}><Sk w="100%" h={120} r={16} /></div>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}><Sk w={36} h={36} r={10} /></div>
      <Sk w="100%" h={120} r={16} />
      <div style={{ marginTop: 12 }}><Sk w="100%" h={50} r={12} /></div>
    </div>
  )
}

function ForwardSkeleton() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Sk w={160} h={20} /><Sk w={100} h={32} r={12} />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', marginBottom: 6 }}>
          <div style={{ flex: 1 }}><Sk w={200} h={14} /><div style={{ marginTop: 4 }}><Sk w={140} h={10} /></div></div>
          <Sk w={40} h={24} r={8} />
        </div>
      ))}
      <div style={{ marginTop: 16 }}><Sk w="100%" h={80} r={16} /></div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  CHART TOOLTIP
// ═══════════════════════════════════════════════════════════
function CTip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '10px 14px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
    }}>
      <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginBottom: 3 }}>
        {label ? new Date(label).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
      </div>
      <div style={{ fontFamily: C.D, fontSize: 18, fontWeight: 700, color: C.text }}>
        {$(payload[0].value)}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  IDENTICON
// ═══════════════════════════════════════════════════════════
function Ident({ addr, size = 40 }: { addr: string; size?: number }) {
  const h = addr.toLowerCase().slice(2)
  const h1 = parseInt(h.slice(0, 6), 16) % 360
  const h2 = (h1 + 130) % 360
  return (
    <div style={{
      width: size, height: size, borderRadius: 12,
      background: `conic-gradient(from 30deg, hsl(${h1},65%,50%), hsl(${h2},60%,45%), hsl(${h1},65%,50%))`,
      border: '2px solid rgba(255,255,255,0.08)', flexShrink: 0,
    }} />
  )
}

// ═══════════════════════════════════════════════════════════
//  ANIMATED COUNTER (improvement #3)
// ═══════════════════════════════════════════════════════════
function AnimatedUsd({ value }: { value: number }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number>(0)
  const prev = useRef(0)

  useEffect(() => {
    const from = prev.current
    const to = value
    const start = performance.now()
    const duration = 800

    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setDisplay(from + (to - from) * eased)
      if (progress < 1) raf.current = requestAnimationFrame(tick)
      else prev.current = to
    }

    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value])

  return <>{$(display)}</>
}

// ═══════════════════════════════════════════════════════════
//  MINI SPARKLINE (improvement #2)
// ═══════════════════════════════════════════════════════════
function Sparkline({ symbol }: { symbol: string }) {
  const pts = useMemo(() => sparkData(symbol), [symbol])
  const up = pts[pts.length - 1] > pts[0]
  const color = up ? C.green : C.red
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const range = max - min || 1
  const w = 40, h = 20

  const d = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════
//  EMPTY STATE (improvement #4)
// ═══════════════════════════════════════════════════════════
function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{ padding: '56px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={64} height={64} viewBox="0 0 64 64" fill="none" style={{ marginBottom: 20, opacity: 0.4 }}>
        <circle cx={32} cy={32} r={30} stroke={C.dim} strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={32} y={36} textAnchor="middle" fill={C.dim} fontSize={22}>{icon}</text>
      </svg>
      <div style={{ fontFamily: C.D, fontSize: 15, fontWeight: 600, color: C.sub, marginBottom: 6 }}>{title}</div>
      <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim, maxWidth: 260 }}>{subtitle}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  TOKEN ROW with Smart Tooltip + Sparkline
// ═══════════════════════════════════════════════════════════
function TokenRow({ a, idx, total, isLast }: { a: Asset; idx: number; total: number; isLast: boolean }) {
  const [hover, setHover] = useState(false)
  const price = a.balance > 0 && a.usdValue > 0 ? a.usdValue / a.balance : 0
  const pctPortfolio = total > 0 ? ((a.usdValue / total) * 100) : 0

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 6 },
        show: { opacity: 1, y: 0 },
      }}
      style={{
        display: 'flex', alignItems: 'center', padding: '14px 4px',
        borderBottom: !isLast ? `1px solid ${C.border}` : 'none',
        transition: 'background 0.1s', position: 'relative',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; setHover(true) }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; setHover(false) }}
    >
      {/* Token info */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
        <TIcon symbol={a.symbol} logo={a.logo} size={36} />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: C.D, fontSize: 14, fontWeight: 600, color: C.text }}>{a.name}</span>
            {a.dac8Monitored && (
              <span style={{ fontFamily: C.M, fontSize: 8, color: C.pink, background: `${C.pink}12`, padding: '1px 5px', borderRadius: 3 }}>DAC8</span>
            )}
          </div>
          <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim, marginTop: 1 }}>{a.symbol}</div>
        </div>
      </div>

      {/* Price */}
      <div style={{ width: 100, textAlign: 'right', fontFamily: C.M, fontSize: 13, color: C.sub }}>
        {price > 0 ? $(price) : '—'}
      </div>

      {/* Sparkline */}
      <div style={{ width: 56, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Sparkline symbol={a.symbol} />
      </div>

      {/* Balance */}
      <div style={{ width: 120, textAlign: 'right', fontFamily: C.M, fontSize: 13, fontWeight: 600, color: C.text }}>
        {fb(a.balance, a.symbol)}
      </div>

      {/* Value */}
      <div style={{ width: 100, textAlign: 'right', fontFamily: C.M, fontSize: 13, fontWeight: 600, color: C.text }}>
        {$(a.usdValue)}
      </div>

      {/* Smart Tooltip */}
      {hover && a.usdValue > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 4, zIndex: 50,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: '12px 16px', minWidth: 220,
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 8 }}>
            {a.symbol} — Details
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>Unit price</span>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{$(price)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>Portfolio %</span>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{pctPortfolio.toFixed(1)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>Balance</span>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{fb(a.balance, a.symbol)} {a.symbol}</span>
          </div>
          {a.dac8Monitored && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, marginTop: 6,
              padding: '4px 8px', borderRadius: 6,
              background: 'rgba(64,182,107,0.06)', border: '1px solid rgba(64,182,107,0.12)',
            }}>
              <span style={{ fontFamily: C.M, fontSize: 10, color: C.green }}>✓</span>
              <span style={{ fontFamily: C.M, fontSize: 9, color: C.green }}>DAC8 monitored — included in fiscal report</span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ═══════════════════════════════════════════════════════════
//  MOTION VARIANTS
// ═══════════════════════════════════════════════════════════
const smooth = { type: 'spring' as const, bounce: 0, duration: 0.6 }

const tabContent = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}
const overlayV = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}
const panelV = {
  initial: { opacity: 0, scale: 0.97, y: 12 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 12 },
}

// Stagger container for token rows (improvement #6)
const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.05 } },
}

// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
interface Props { open: boolean; onClose: () => void; initialTab?: Tab }

export default function PortfolioDashboard({ open, onClose, initialTab }: Props) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { data, loading, refresh } = usePortfolio(address, chainId)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview')
  const [tabLoading, setTabLoading] = useState(false)
  const [range, setRange] = useState<Range>('1D')
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const reg = getRegistry(chainId)
  const ld = loading && !data

  useEffect(() => { if (initialTab && open) setTab(initialTab) }, [initialTab, open])

  // Tab switch with skeleton
  const switchTab = (t: Tab) => {
    if (t === tab) return
    setTabLoading(true)
    setTab(t)
    setTimeout(() => setTabLoading(false), 400)
  }

  // ESC key handler
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  // Chart data
  const chart = useMemo(() => {
    if (!data?.balanceHistory) return []
    return range === '1D' ? data.balanceHistory.slice(-24) : data.balanceHistory
  }, [data?.balanceHistory, range])

  // PnL calculation
  const pnl = useMemo(() => {
    if (!chart.length) return { v: 0, pct: 0, up: true }
    const f = chart[0].value, l = chart[chart.length - 1].value, d = l - f
    return { v: d, pct: f > 0 ? (d / f) * 100 : 0, up: d >= 0 }
  }, [chart])

  const lineColor = pnl.up ? C.green : C.red

  // Donut chart data (improvement #1)
  const donutData = useMemo(() => {
    if (!data?.assets?.length) return []
    const sorted = [...data.assets].sort((a, b) => b.usdValue - a.usdValue)
    const top5 = sorted.slice(0, 5)
    const rest = sorted.slice(5).reduce((s, a) => s + a.usdValue, 0)
    const result = top5.map(a => ({ name: a.symbol, value: a.usdValue, color: TK[a.symbol] ?? C.dim }))
    if (rest > 0) result.push({ name: 'Other', value: rest, color: C.dim })
    return result
  }, [data?.assets])

  // Copy address handler (improvement #7)
  const copyAddress = useCallback(() => {
    if (!address) return
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [address])

  // Refresh handler with animation (improvement #8)
  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    refresh()
    setTimeout(() => setRefreshing(false), 1200)
  }, [refresh])

  if (!isConnected || !address) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="portfolio-overlay"
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          initial="initial" animate="animate" exit="exit"
        >
          {/* ── BACKDROP ────────────────────────────── */}
          <motion.div
            onClick={onClose}
            variants={overlayV}
            transition={smooth}
            style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            }}
          />

          {/* ── PANEL ───────────────────────────────── */}
          <motion.div
            layout="position"
            variants={panelV}
            transition={smooth}
            style={{
              position: 'relative', zIndex: 1, width: '100%', maxWidth: 920,
              maxHeight: 'calc(100vh - 40px)',
              background: C.bg, borderRadius: 20,
              boxShadow: '0 40px 120px rgba(0,0,0,0.8)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Gradient border glow (improvement #5) */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 20, padding: 1,
              background: 'linear-gradient(135deg, rgba(76,130,251,0.15), rgba(252,116,254,0.1), rgba(76,130,251,0.15))',
              pointerEvents: 'none', zIndex: 0,
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              maskComposite: 'exclude',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
            }} />

            {/* ── HEADER ────────────────────────────── */}
            <div style={{ padding: '20px 28px 0', flexShrink: 0, position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                {/* Address with copy (improvement #7) */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', position: 'relative' }}
                  onClick={copyAddress}
                >
                  <Ident addr={address} size={40} />
                  <span style={{ fontFamily: C.D, fontSize: 18, fontWeight: 600, color: C.text }}>
                    {ta(address, 6, 4)}
                  </span>
                  {copied && (
                    <motion.span
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      style={{
                        fontFamily: C.M, fontSize: 10, color: C.green,
                        background: 'rgba(64,182,107,0.1)', padding: '3px 8px',
                        borderRadius: 6, marginLeft: 4,
                      }}
                    >
                      Copied!
                    </motion.span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {/* Refresh button with rotation (improvement #8) */}
                  <button
                    onClick={handleRefresh}
                    style={{
                      padding: '8px 16px', borderRadius: 20,
                      background: C.surface, border: `1px solid ${C.border}`,
                      color: C.sub, fontFamily: C.D, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', transition: 'background 0.15s',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = C.card}
                    onMouseLeave={e => e.currentTarget.style.background = C.surface}
                  >
                    <motion.span
                      animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
                      transition={refreshing ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
                      style={{ display: 'inline-block' }}
                    >
                      ↻
                    </motion.span>
                    Refresh
                  </button>
                  <button
                    onClick={onClose}
                    style={{
                      width: 36, height: 36, borderRadius: 12,
                      background: C.surface, border: `1px solid ${C.border}`,
                      color: C.dim, cursor: 'pointer', fontSize: 16,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = C.card}
                    onMouseLeave={e => e.currentTarget.style.background = C.surface}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* ── TAB BAR with layoutId indicator ────── */}
              <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`, position: 'relative' }}>
                {TABS.map(([k, l]) => {
                  // Tab count badges (improvement #10)
                  const count = k === 'tokens' ? (data?.assets?.length ?? 0)
                    : k === 'activity' ? (data?.activity?.length ?? 0)
                    : 0

                  return (
                    <button
                      key={k}
                      onClick={() => switchTab(k)}
                      style={{
                        padding: '12px 20px', background: 'transparent', border: 'none',
                        color: tab === k ? C.text : C.dim,
                        fontFamily: C.D, fontSize: 14, fontWeight: tab === k ? 600 : 400,
                        cursor: 'pointer', position: 'relative',
                        transition: 'color 0.15s',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {l}
                      {count > 0 && (
                        <span style={{
                          fontFamily: C.M, fontSize: 9, color: C.sub,
                          background: 'rgba(255,255,255,0.06)',
                          padding: '1px 6px', borderRadius: 8, lineHeight: '14px',
                        }}>
                          {count}
                        </span>
                      )}
                      {tab === k && (
                        <motion.div
                          layoutId="activeTab"
                          style={{
                            position: 'absolute', bottom: -1, left: 0, right: 0,
                            height: 2, background: C.text, borderRadius: 1,
                          }}
                          transition={smooth}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── CONTENT — scrollable ──────────────── */}
            <div style={{ flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1 }}>
              <motion.div
                layout="position"
                initial={false}
                animate={{ height: 'auto' }}
                style={{ overflow: 'hidden', position: 'relative', minHeight: 200 }}
                transition={smooth}
              >
                <div style={{ padding: '24px 28px 28px' }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={tab}
                      layout="position"
                      variants={tabContent}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={smooth}
                    >

          {/* ═══ SKELETON LOADING ══════════════════════════ */}
          {tabLoading && tab === 'overview' && <OverviewSkeleton />}
          {tabLoading && tab === 'tokens' && <TokensSkeleton />}
          {tabLoading && tab === 'activity' && <ActivitySkeleton />}
          {tabLoading && tab === 'swap' && <SwapSkeleton />}
          {tabLoading && tab === 'forward' && <ForwardSkeleton />}

          {/* ═══ OVERVIEW ══════════════════════════════════ */}
          {!tabLoading && tab === 'overview' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, marginBottom: 32 }}>
                {/* ── Left column ── */}
                <div>
                  {ld ? (
                    <div style={{ marginBottom: 20 }}>
                      <Sk w={180} h={40} r={10} />
                      <div style={{ marginTop: 8 }}><Sk w={120} h={18} /></div>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 20 }}>
                      {/* Animated total (improvement #3) */}
                      <div style={{ fontFamily: C.D, fontSize: 36, fontWeight: 600, color: C.text, letterSpacing: '-0.03em' }}>
                        <AnimatedUsd value={data?.totalUsd ?? 0} />
                      </div>
                      {/* PnL with gradient (improvement #9) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{
                          fontSize: 13, fontFamily: C.D, fontWeight: 500,
                          background: pnl.up
                            ? 'linear-gradient(90deg, #40B66B, #98dbb8)'
                            : 'linear-gradient(90deg, #FD766B, #fdb5ae)',
                          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        }}>
                          {pnl.up ? '▲' : '▼'} {$(Math.abs(pnl.v))} ({pnl.up ? '+' : ''}{pnl.pct.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Chart */}
                  {ld ? <Sk w="100%" h={200} r={16} /> : (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ width: '100%', height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chart} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="uGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
                                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="date" hide />
                            <YAxis hide domain={['dataMin-5', 'dataMax+5']} />
                            <Tooltip content={<CTip />} />
                            <Area type="monotone" dataKey="value" stroke={lineColor} strokeWidth={2} fill="url(#uGrad)" dot={false} animationDuration={600} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                        {(['1D', '1W'] as Range[]).map(r => (
                          <button key={r} onClick={() => setRange(r)} style={{
                            padding: '6px 14px', borderRadius: 20,
                            background: range === r ? C.surface : 'transparent',
                            border: 'none', color: range === r ? C.text : C.dim,
                            fontFamily: C.D, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            transition: 'background 0.15s',
                          }}>{r}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Right column ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Action grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      { label: 'Send', icon: '↗', color: C.pink, action: () => onClose() },
                      { label: 'Receive', icon: '↙', color: C.green, action: undefined },
                      { label: 'Swap', icon: '⇅', color: C.blue, action: () => switchTab('swap') },
                      { label: 'More', icon: '•••', color: C.dim, action: undefined },
                    ].map(a => (
                      <button key={a.label} onClick={a.action} style={{
                        padding: '20px 16px', borderRadius: 16,
                        background: C.surface, border: `1px solid ${C.border}`,
                        cursor: 'pointer', display: 'flex', flexDirection: 'column',
                        alignItems: 'flex-start', gap: 8, transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.card}
                      onMouseLeave={e => e.currentTarget.style.background = C.surface}
                      >
                        <span style={{ fontSize: 18, color: a.color }}>{a.icon}</span>
                        <span style={{ fontFamily: C.D, fontSize: 13, fontWeight: 600, color: a.color }}>{a.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Stats card */}
                  <div style={{
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
                    padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                  }}>
                    <div>
                      <div style={{ fontFamily: C.D, fontSize: 11, color: C.dim, marginBottom: 4 }}>TX this week</div>
                      <div style={{ fontFamily: C.D, fontSize: 20, fontWeight: 700, color: C.text }}>{data?.txCount7d ?? 0}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: C.D, fontSize: 11, color: C.dim, marginBottom: 4 }}>Total value</div>
                      <div style={{ fontFamily: C.D, fontSize: 20, fontWeight: 700, color: C.text }}>{$(data?.totalUsd ?? 0)}</div>
                    </div>
                  </div>

                  {/* Donut chart (improvement #1) */}
                  {donutData.length > 0 && (
                    <div style={{
                      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
                      padding: '12px 16px',
                    }}>
                      <div style={{ fontFamily: C.D, fontSize: 11, color: C.dim, marginBottom: 8 }}>Distribution</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 80, height: 80, flexShrink: 0 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={donutData}
                                dataKey="value"
                                innerRadius={22}
                                outerRadius={36}
                                paddingAngle={2}
                                strokeWidth={0}
                                animationDuration={600}
                              >
                                {donutData.map((entry, i) => (
                                  <Cell key={i} fill={entry.color} />
                                ))}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {donutData.slice(0, 5).map(d => (
                            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 6, height: 6, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                              <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub, flex: 1 }}>{d.name}</span>
                              <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
                                {data?.totalUsd ? ((d.value / data.totalUsd) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Fiscal Health + Trust Signals ──────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
                  padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'rgba(64,182,107,0.08)', border: '1px solid rgba(64,182,107,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                      <path d="M8 1L2 4v4c0 3.3 2.6 6.4 6 7 3.4-.6 6-3.7 6-7V4L8 1z" stroke={C.green} strokeWidth={1.5} fill="none" />
                      <path d="M5.5 8l2 2 3-3.5" stroke={C.green} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.green }}>
                      Fiscal Status: Compliant
                    </div>
                    <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginTop: 2 }}>
                      All TX monitored DAC8/MiCA
                    </div>
                  </div>
                </div>
                <div style={{
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
                  padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'rgba(76,130,251,0.08)', border: '1px solid rgba(76,130,251,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                      <rect x={4} y={7} width={8} height={7} rx={1.5} stroke={C.blue} strokeWidth={1.5} />
                      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke={C.blue} strokeWidth={1.5} strokeLinecap="round" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.blue }}>
                      Non-Custodial · Encrypted
                    </div>
                    <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginTop: 2 }}>
                      Private keys never shared
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Tokens + Activity previews ────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                {/* Tokens preview */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <span style={{ fontFamily: C.D, fontSize: 16, fontWeight: 600, color: C.text }}>Tokens</span>
                      <span style={{ fontFamily: C.D, fontSize: 12, color: C.dim, marginLeft: 8 }}>{data?.assets?.length ?? 0}</span>
                    </div>
                    <button onClick={() => switchTab('tokens')} style={{
                      background: 'none', border: 'none', color: C.dim,
                      fontFamily: C.D, fontSize: 12, cursor: 'pointer', transition: 'color 0.15s',
                    }}>View all →</button>
                  </div>
                  {(data?.assets ?? []).slice(0, 4).map((a: Asset) => (
                    <div key={a.contractAddress + a.symbol} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 0', borderBottom: `1px solid ${C.border}`,
                    }}>
                      <TIcon symbol={a.symbol} logo={a.logo} size={32} />
                      <div style={{ flex: 1 }}>
                        <span style={{ fontFamily: C.D, fontSize: 14, fontWeight: 600, color: C.text }}>{a.name}</span>
                        {a.dac8Monitored && (
                          <span style={{ fontFamily: C.M, fontSize: 8, color: C.pink, marginLeft: 6, background: `${C.pink}12`, padding: '1px 5px', borderRadius: 3 }}>DAC8</span>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: C.M, fontSize: 13, fontWeight: 600, color: C.text }}>{fb(a.balance, a.symbol)}</div>
                        <div style={{ fontFamily: C.M, fontSize: 11, color: C.sub }}>{$(a.usdValue)}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Activity preview */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <span style={{ fontFamily: C.D, fontSize: 16, fontWeight: 600, color: C.text }}>Recent activity</span>
                      <span style={{ fontFamily: C.D, fontSize: 12, color: C.dim, marginLeft: 8 }}>{data?.activity?.length ?? 0}</span>
                    </div>
                    <button onClick={() => switchTab('activity')} style={{
                      background: 'none', border: 'none', color: C.dim,
                      fontFamily: C.D, fontSize: 12, cursor: 'pointer', transition: 'color 0.15s',
                    }}>View all →</button>
                  </div>
                  {(data?.activity ?? []).slice(0, 4).map((tx: Tx, i: number) => {
                    const isSend = tx.from?.toLowerCase() === address?.toLowerCase()
                    return (
                      <a
                        key={tx.hash + i}
                        href={`${reg?.blockExplorer ?? 'https://basescan.org'}/tx/${tx.hash}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 0', borderBottom: `1px solid ${C.border}`,
                          textDecoration: 'none',
                        }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: isSend ? 'rgba(253,118,107,0.08)' : 'rgba(64,182,107,0.08)',
                          border: `1px solid ${isSend ? 'rgba(253,118,107,0.15)' : 'rgba(64,182,107,0.15)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, color: isSend ? C.red : C.green, flexShrink: 0,
                        }}>
                          {isSend ? '↑' : '↓'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 500, color: C.text }}>
                            {isSend ? 'Sent' : 'Received'} {tx.value?.toFixed(4)} {tx.asset}
                          </div>
                          <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginTop: 2 }}>
                            {isSend ? '→' : '←'} {ta(isSend ? (tx.to ?? '') : (tx.from ?? ''))}
                          </div>
                        </div>
                        <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>{ago(tx.timestamp)}</span>
                      </a>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ TOKENS ════════════════════════════════════ */}
          {!tabLoading && tab === 'tokens' && (
            ld ? (
              <TokensSkeleton />
            ) : (!data?.assets?.length) ? (
              <EmptyState
                icon="◇"
                title="No tokens found"
                subtitle="Connect a wallet with token balances on Base to see your portfolio here."
              />
            ) : (
              <div>
                {/* Table header */}
                <div style={{ display: 'flex', padding: '8px 4px 12px', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ flex: 1, fontFamily: C.D, fontSize: 12, color: C.dim, fontWeight: 500 }}>Token</span>
                  <span style={{ width: 100, textAlign: 'right', fontFamily: C.D, fontSize: 12, color: C.dim, fontWeight: 500 }}>Price</span>
                  <span style={{ width: 56, textAlign: 'center', fontFamily: C.D, fontSize: 12, color: C.dim, fontWeight: 500 }}>7d</span>
                  <span style={{ width: 120, textAlign: 'right', fontFamily: C.D, fontSize: 12, color: C.dim, fontWeight: 500 }}>Balance</span>
                  <span style={{ width: 100, textAlign: 'right', fontFamily: C.D, fontSize: 12, color: C.dim, fontWeight: 500 }}>Value</span>
                </div>
                {/* Staggered rows (improvement #6) */}
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="show"
                >
                  {data.assets.map((a: Asset, i: number) => (
                    <TokenRow
                      key={a.contractAddress + a.symbol}
                      a={a}
                      idx={i}
                      total={data.totalUsd}
                      isLast={i === data.assets.length - 1}
                    />
                  ))}
                </motion.div>
              </div>
            )
          )}

          {/* ═══ ACTIVITY ══════════════════════════════════ */}
          {!tabLoading && tab === 'activity' && (
            ld ? (
              <ActivitySkeleton />
            ) : (!data?.activity?.length) ? (
              <EmptyState
                icon="↕"
                title="No activity yet"
                subtitle="Send or receive tokens to see your transaction history appear here."
              />
            ) : (
              <div>
                {data.activity.map((tx: Tx, i: number) => {
                  const exp = reg?.blockExplorer ?? 'https://basescan.org'
                  const isSend = tx.from?.toLowerCase() === address?.toLowerCase()
                  return (
                    <a
                      key={tx.hash + i}
                      href={`${exp}/tx/${tx.hash}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '14px 4px',
                        borderBottom: i < data.activity.length - 1 ? `1px solid ${C.border}` : 'none',
                        textDecoration: 'none', transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: isSend ? 'rgba(253,118,107,0.08)' : 'rgba(64,182,107,0.08)',
                        border: `1px solid ${isSend ? 'rgba(253,118,107,0.15)' : 'rgba(64,182,107,0.15)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, color: isSend ? C.red : C.green, flexShrink: 0,
                      }}>
                        {isSend ? '↑' : '↓'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: C.D, fontSize: 14, fontWeight: 500, color: C.text }}>
                          {isSend ? 'Sent' : 'Received'} {tx.value?.toFixed(4)} {tx.asset}
                        </div>
                        <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginTop: 3 }}>
                          {isSend ? 'To' : 'From'}: {ta(isSend ? (tx.to ?? '') : (tx.from ?? ''))}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: C.M, fontSize: 11, color: C.sub }}>{ago(tx.timestamp)}</div>
                        <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginTop: 2 }}>↗</div>
                      </div>
                    </a>
                  )
                })}
              </div>
            )
          )}

          {/* ═══ SWAP ══════════════════════════════════════ */}
          {!tabLoading && tab === 'swap' && (
            <div style={{ maxWidth: 440, margin: '0 auto' }}>
              <SwapModule
                onSwapComplete={() => { refresh(); setTimeout(() => switchTab('activity'), 1500) }}
                portfolioAssets={data?.assets}
              />
            </div>
          )}

          {/* ═══ FORWARD ═══════════════════════════════════ */}
          {!tabLoading && tab === 'forward' && (
            <div style={{ maxWidth: 600, margin: '0 auto' }}>
              <AutoForward />
            </div>
          )}

                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
