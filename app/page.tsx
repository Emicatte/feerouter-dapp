'use client'




import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import type { Variants, Transition } from 'framer-motion'

// STATIC IMPORTS - No lazy loading, instant component availability
import TransferForm from './TransferForm'
import SwapModule from './SwapModule'
import AccountHeader from './AccountHeader'
import ComplianceOverlay from './ComplianceOverlay'
import DevelopersOverlay from './DevelopersOverlay'
import PricingOverlay from './PricingOverlay'



const SkeletonLoader = () => (
  <div style={{
    minHeight: 400, width: '100%',
    background: '#111118',
    borderRadius: 24,
    border: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 16
  }}>
    <div style={{ 
      width: 32, height: 32, 
      border: '3px solid rgba(255,255,255,0.05)', 
      borderTopColor: '#8B5CF6', 
      borderRadius: '50%', 
      animation: 'rsSpin 1s linear infinite' 
    }} />
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#4A4E64', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
      Loading Module
    </div>
  </div>
);

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

// ═══════════════════════════════════════════════════════════
//  PALETTE
// ═══════════════════════════════════════════════════════════
const C = {
  bg:      '#0a0a0f',
  surface: '#111118',
  card:    '#16161f',
  border:  'rgba(255,255,255,0.06)',
  text:    '#E2E2F0',
  sub:     '#8A8FA8',
  dim:     '#4A4E64',
  green:   '#00D68F',
  red:     '#FF4C6A',
  amber:   '#FFB547',
  blue:    '#3B82F6',
  purple:  '#8B5CF6',
  D:       'var(--font-display)',
  M:       'var(--font-mono)',
}

type View = 'send' | 'swap' | 'command'
type Overlay = null | 'about' | 'how' | 'security' | 'compliance' | 'developers' | 'pricing'

const GRAD: React.CSSProperties = {
  background: 'linear-gradient(135deg, #FFFFFF 0%, #60A5FA 60%, #1D4ED8 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
}

// ════════════════════════════════════════════════════��══════
//  MOTION CONFIG — Faster, more responsive transitions
// ═══════════════════════════════════════════════════════════
const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
// Apple/Linear-style spring easing — leggero overshooting, settle morbido
const SPRING: [number, number, number, number] = [0.16, 1, 0.3, 1]

const cinematicT: Transition = { duration: 0.45, ease: EASE }

const heroV: Variants = {
  enter:  { opacity: 0, y: 10, filter: 'blur(4px)' },
  center: { opacity: 1, y: 0,  filter: 'blur(0px)' },
  exit:   { opacity: 0, y: -10, filter: 'blur(4px)' },
}

const formV: Variants = {
  enter:  { opacity: 0, y: 12, scale: 0.97 },
  center: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } },
  exit:   { opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.3, ease: EASE } },
}

// Cross-fade CSS puro — tutti i pannelli sempre montati, zero mount/unmount
const FADE_MS = 380
const panelBase: React.CSSProperties = {
  transition: `opacity ${FADE_MS}ms cubic-bezier(0.16,1,0.3,1)`,
  willChange: 'opacity',
}
const panelActive: React.CSSProperties = {
  ...panelBase, position: 'relative', opacity: 1, pointerEvents: 'auto', zIndex: 1,
}
const panelHidden: React.CSSProperties = {
  ...panelBase, position: 'absolute', top: 0, left: 0, right: 0, opacity: 0, pointerEvents: 'none', zIndex: 0,
}

const overlayV: Variants = {
  hidden:  { opacity: 0, y: 40, filter: 'blur(8px)' },
  visible: { opacity: 1, y: 0,  filter: 'blur(0px)' },
}

// ═══════════════════════════════════════════════════════════
//  PARTICLE INTRO (first visit)
// ═══════════════════════════════════════════════════════════
function ParticleIntro({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2

    interface P { x:number;y:number;tx:number;ty:number;ox:number;oy:number;s:number;h:number;sp:number;a:number;al:number }
    const N = 140
    const particles: P[] = []
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2, dist = 200 + Math.random() * 350
      const r = 24 * (0.6 + Math.random() * 0.4)
      particles.push({ x: cx + Math.cos(ang) * dist, y: cy + Math.sin(ang) * dist, tx: cx + Math.cos(ang) * r, ty: cy - 20 + Math.sin(ang) * r, ox: cx + Math.cos(ang) * dist, oy: cy + Math.sin(ang) * dist, s: 1 + Math.random() * 2, h: 240 + Math.random() * 80, sp: 0.003 + Math.random() * 0.004, a: Math.random() * Math.PI * 2, al: 0.3 + Math.random() * 0.7 })
    }

    let start = Date.now(), ph = 0, af: number
    const draw = () => {
      const el = Date.now() - start
      ctx.clearRect(0, 0, W, H)
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.7)
      bg.addColorStop(0, 'rgba(20,10,40,1)'); bg.addColorStop(1, 'rgba(10,10,15,1)')
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
      const na = Math.min(1, el / 2000) * 0.12
      const n1 = ctx.createRadialGradient(cx - 150, cy - 80, 0, cx - 150, cy - 80, 280)
      n1.addColorStop(0, `rgba(139,92,246,${na})`); n1.addColorStop(1, 'transparent')
      ctx.fillStyle = n1; ctx.fillRect(0, 0, W, H)

      if (el > 1500 && ph === 0) { ph = 1; setPhase(1) }
      if (el > 3000 && ph === 1) { ph = 2; setPhase(2) }
      if (el > 4500 && ph === 2) { ph = 3; setPhase(3) }
      if (el > 6000 && ph === 3) { ph = 4; setPhase(4) }

      const cp = ph >= 1 ? Math.min(1, (el - 1500) / 1200) : 0
      const eased = cp * cp * (3 - 2 * cp)
      for (const p of particles) {
        p.a += p.sp
        if (ph >= 1) { p.x += (p.tx - p.x) * (0.02 + eased * 0.04); p.y += (p.ty - p.y) * (0.02 + eased * 0.04) }
        else { p.x = p.ox + Math.sin(el * 0.001 + p.a) * 8; p.y = p.oy + Math.cos(el * 0.0008 + p.a) * 6 }
        const gs = ph >= 2 ? p.s * (1 + Math.sin(el * 0.005) * 0.3) : p.s
        const al = ph >= 4 ? Math.max(0, p.al * (1 - (el - 6000) / 700)) : p.al
        ctx.beginPath(); ctx.arc(p.x, p.y, gs, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.h},80%,70%,${al})`; ctx.fill()
        if (gs > 1.5) { ctx.beginPath(); ctx.arc(p.x, p.y, gs * 2.5, 0, Math.PI * 2); ctx.fillStyle = `hsla(${p.h},80%,70%,${al * 0.1})`; ctx.fill() }
      }
      if (ph < 4) af = requestAnimationFrame(draw)
    }
    af = requestAnimationFrame(draw)
    const timer = setTimeout(onDone, 6700)
    return () => { cancelAnimationFrame(af); clearTimeout(timer) }
  }, [onDone])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, opacity: phase === 4 ? 0 : 1, transition: 'opacity 0.7s ease', pointerEvents: phase === 4 ? 'none' : 'auto' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
        <div style={{ opacity: phase >= 2 ? 1 : 0, transition: 'opacity 0.6s ease', marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 13, background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto', boxShadow: phase >= 2 ? '0 0 50px rgba(139,92,246,0.4)' : 'none' }}>⚡</div>
        </div>
        <div style={{ opacity: phase >= 3 ? 1 : 0, transform: phase >= 3 ? 'translateY(0)' : 'translateY(10px)', transition: 'all 0.8s cubic-bezier(.16,1,.3,1)' }}>
          <div style={{ fontFamily: C.M, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: 'transparent', background: 'linear-gradient(90deg,#3B82F6,#8B5CF6,#FF4C6A,#FFB547,#3B82F6)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', animation: phase >= 3 ? 'holoShift 3s linear infinite' : 'none' }}>
            Multi-chain financial automation
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  NETWORK + GAS WIDGET — fixed top-right, below navbar
// ═══════════════════════════════════════════════════════════
const CHAINS = [
  { id: 8453,  name: 'Base',         short: 'Base',     color: '#0052FF', rpc: 'https://mainnet.base.org' },
  { id: 84532, name: 'Base Sepolia', short: 'Sepolia',  color: '#ffb800', rpc: 'https://sepolia.base.org', testnet: true },
  { id: 1,     name: 'Ethereum',     short: 'Ethereum', color: '#627EEA', rpc: 'https://eth.llamarpc.com' },
  { id: 42161, name: 'Arbitrum',     short: 'Arbitrum', color: '#28A0F0', rpc: 'https://arb1.arbitrum.io/rpc' },
]

function NetworkGasWidget() {
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const { isConnected } = useAccount()
  const [gas, setGas] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const chain = CHAINS.find(c => c.id === chainId) ?? CHAINS[0]
  const isTestnet = !!(chain as typeof CHAINS[number] & { testnet?: boolean }).testnet

  // Gas polling
  useEffect(() => {
    const rpc = chain.rpc
    const f = async () => {
      try {
        const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) })
        setGas(parseInt((await r.json()).result, 16) / 1e9)
      } catch { /* */ }
    }
    f(); const iv = setInterval(f, 15000); return () => clearInterval(iv)
  }, [chain.rpc])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const t = setTimeout(() => document.addEventListener('mousedown', h), 30)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h) }
  }, [open])

  const gasLevel = gas === null ? 'unknown' : gas < 0.02 ? 'low' : gas < 0.1 ? 'med' : 'high'
  const gasColor = gasLevel === 'low' ? C.green : gasLevel === 'med' ? '#ffb800' : gasLevel === 'high' ? '#FF4C6A' : C.dim

  if (!isConnected) return null

  return (
    <div ref={ref} style={{
      position: 'fixed', top: 68, right: 24, zIndex: 999,
    }}>
      {/* Trigger pill */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 0,
          padding: 0, cursor: 'pointer',
          background: 'rgba(12,12,30,0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius: 12,
          border: `1px solid ${open ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}`,
          transition: 'all 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Network section */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px 7px 10px',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: chain.color, boxShadow: `0 0 6px ${chain.color}60` }} />
          <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.text }}>{chain.short}</span>
          {isTestnet && (
            <span style={{ fontFamily: C.M, fontSize: 8, fontWeight: 700, color: '#ffb800', background: 'rgba(255,184,0,0.1)', padding: '1px 4px', borderRadius: 3, lineHeight: '1.2' }}>TEST</span>
          )}
          <span style={{ color: C.dim, fontSize: 8, marginLeft: -2 }}>▾</span>
        </div>

        {/* Gas section */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '7px 10px 7px 8px',
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: gasColor, boxShadow: `0 0 4px ${gasColor}50` }} />
          <span style={{ fontFamily: C.M, fontSize: 10, color: gasColor, fontWeight: 600 }}>
            {gas !== null ? gas.toFixed(4) : '—'}
          </span>
          <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>Gwei</span>
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
            minWidth: 220, background: '#111120',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03)',
          }}
        >
          {/* Header */}
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontFamily: C.D, fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Network</span>
          </div>

          {/* Chain list */}
          {CHAINS.map(c => {
            const active = chainId === c.id
            const test = !!(c as typeof c & { testnet?: boolean }).testnet
            return (
              <button
                key={c.id}
                onClick={() => { switchChain({ chainId: c.id }); setOpen(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
                  border: 'none', cursor: 'pointer', transition: 'background 0.12s',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, boxShadow: `0 0 6px ${c.color}40` }} />
                <div style={{ flex: 1, textAlign: 'left' as const }}>
                  <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: active ? C.text : C.sub }}>{c.name}</span>
                  {test && (
                    <span style={{ fontFamily: C.M, fontSize: 8, color: '#ffb800', marginLeft: 6 }}>testnet</span>
                  )}
                </div>
                {active && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: C.M, fontSize: 10, color: gasColor }}>{gas !== null ? `${gas.toFixed(4)}` : '—'}</span>
                    <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>gwei</span>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
                  </div>
                )}
              </button>
            )
          })}

          {/* Gas legend */}
          <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            {[
              { l: 'Low', c: C.green },
              { l: 'Med', c: '#ffb800' },
              { l: 'High', c: '#FF4C6A' },
            ].map(g => (
              <div key={g.l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: g.c }} />
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>{g.l}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  LIQUID GLASS NAVBAR
// ═══════════════════════════════════════════════════════════
function Navbar({
  view, setView, activeOverlay, setActiveOverlay,
}: {
  view: View
  setView: (v: View) => void
  activeOverlay: Overlay
  setActiveOverlay: (o: Overlay) => void
}) {
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const links: { key: Overlay; label: string }[] = [
    { key: 'about',      label: 'About' },
    { key: 'how',        label: 'How It Works' },
    { key: 'security',   label: 'Security' },
    { key: 'compliance', label: 'Compliance' },
    { key: 'developers', label: 'Developers' },
    { key: 'pricing',    label: 'Pricing' },
  ]

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      height: 60,
      background: 'linear-gradient(180deg, rgba(10,10,15,0.8) 0%, rgba(10,10,15,0.7) 100%)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px',
    }}>
      {/* Left: Logo */}
      <button
        onClick={() => { setView('send'); setActiveOverlay(null) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        {/* Logo: lightning splitting into two flows */}
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="7" fill="url(#lg)" />
          <path d="M15.5 5L10 15h4l-1.5 8L19 13h-4l1.5-8z" fill="white" fillOpacity="0.95" />
          <path d="M12.5 15l-3 6" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M14 15l3.5 5.5" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="28" y2="28">
              <stop stopColor="#3B82F6" />
              <stop offset="1" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
        </svg>
        <span style={{ fontFamily: C.D, fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: '-0.03em' }}>
          RSends
        </span>
      </button>

      {/* Center: Menu links */}
      <div style={{ display: 'flex', gap: 4, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
        {links.map(link => (
          <button
            key={link.key}
            onClick={() => setActiveOverlay(activeOverlay === link.key ? null : link.key)}
            onMouseEnter={() => setHoveredLink(link.key)}
            onMouseLeave={() => setHoveredLink(null)}
            style={{
              padding: '7px 16px', borderRadius: 10, border: 'none',
              background: activeOverlay === link.key
                ? 'rgba(255,255,255,0.08)'
                : hoveredLink === link.key
                  ? 'rgba(255,255,255,0.04)'
                  : 'transparent',
              color: activeOverlay === link.key ? C.text : C.sub,
              fontFamily: C.D, fontSize: 12, fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.25s ease',
            }}
          >
            {link.label}
          </button>
        ))}
      </div>

      {/* Right: Wallet */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <EngineStatus />
        <AccountHeader />
      </div>
    </nav>
  )
}

// ════════��══════════════════════════════════════════════════
//  ENGINE STATUS (compact for navbar)
// ═══════════════════════════════════════════════════════════
function EngineStatus() {
  const { isConnected } = useAccount()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: 16,
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ position: 'relative', width: 7, height: 7 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: isConnected ? C.green : C.dim }} />
        {isConnected && <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${C.green}`, animation: 'rsPulse 2s ease infinite' }} />}
      </div>
      <span style={{ fontFamily: C.M, fontSize: 9, fontWeight: 600, color: isConnected ? C.green : C.dim }}>
        {isConnected ? 'ONLINE' : 'OFFLINE'}
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  OVERLAYS — About / How / Security
// ═══════════════════════════════════════════════════════════
function OverlayShell({ active, onClose, children }: { active: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [active, onClose])

  return (
    <AnimatePresence>
      {active && (
        <>
          {/* Blurred backdrop */}
          <motion.div
            key="overlay-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 900,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          />
          {/* Content */}
          <motion.div
            key="overlay-content"
            variants={overlayV}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: 0.5, ease: EASE }}
            style={{
              position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)',
              width: '90%', maxWidth: 700, maxHeight: 'calc(100vh - 100px)',
              overflowY: 'auto', zIndex: 950,
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 20, padding: '32px 36px',
              boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
            }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                position: 'absolute', top: 16, right: 16,
                width: 32, height: 32, borderRadius: 10,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${C.border}`, color: C.dim,
                cursor: 'pointer', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}
            >✕</button>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function AboutOverlay() {
  const stats = [
    { label: 'Mainnet Contracts', value: 2 },
    { label: 'Basescan Verified', value: 100, suffix: '%' },
    { label: 'Chains Supported', value: 3, suffix: '+' },
    { label: 'API Endpoints', value: 8, suffix: '+' },
  ]

  return (
    <div>
      {/* ═══ A) Animated Headline ═══ */}
      <motion.h2
        style={{ fontFamily: C.D, fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 24, lineHeight: 1.3 }}
      >
        {'Built by one. Trusted by design.'.split('').map((char, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.025, duration: 0.3, ease: EASE }}
          >
            {char}
          </motion.span>
        ))}
      </motion.h2>

      {/* ═══ B) Mission Block ═══ */}
      <div style={{ marginBottom: 28 }}>
        {[
          'RSends exists because B2B Web3 payments shouldn\'t have to choose between speed and compliance. We believe on-chain finance deserves institutional-grade safeguards without sacrificing the decentralization that makes it powerful.',
          'Every single transaction passes through a compliance Oracle before touching the blockchain. This isn\'t a post-hoc audit — it\'s pre-execution verification baked into the protocol\'s DNA.',
          'Built on Base L2 for minimal costs and instant settlement, with a multi-chain architecture designed for global scale. One contract, many chains, zero compromise.',
        ].map((p, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 + i * 0.15, duration: 0.5, ease: EASE }}
            style={{ fontFamily: C.M, fontSize: 12, color: C.sub, lineHeight: 1.7, marginBottom: 14 }}
          >
            {p}
          </motion.p>
        ))}
      </div>

      {/* ═══ C) Founder Card ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.3, duration: 0.5, ease: EASE }}
        style={{
          padding: '22px 20px', borderRadius: 16, marginBottom: 28,
          background: 'linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(139,92,246,0.06) 50%, rgba(255,76,106,0.04) 100%)',
          border: `1px solid ${C.border}`, position: 'relative', overflow: 'hidden',
        }}
      >
        {/* Mesh gradient background */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 120, height: 120,
          background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          borderRadius: '50%', pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.blue, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 }}>
            Founder & Solo Developer
          </div>
          <div style={{ fontFamily: C.M, fontSize: 12, color: C.sub, lineHeight: 1.6, marginBottom: 14 }}>
            Designed, built, and deployed end-to-end — from Solidity contracts to React frontend to FastAPI backend. Every line of code written with compliance-first architecture in mind.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            {['Solidity', 'Next.js', 'FastAPI', 'Foundry'].map((tech, i) => (
              <motion.span
                key={tech}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.6 + i * 0.1, duration: 0.3 }}
                style={{
                  padding: '4px 10px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
                  fontFamily: C.M, fontSize: 9, color: C.dim,
                }}
              >
                {tech}
              </motion.span>
            ))}
            <a
              href="https://github.com/Emicatte/feerouter-dapp"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', marginLeft: 4 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={C.dim}>
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </motion.div>

      {/* ═══ D) Stats Counters ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.4, ease: EASE }}
            style={{
              padding: '16px 10px', borderRadius: 14, textAlign: 'center' as const,
              background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ fontFamily: C.D, fontSize: 24, fontWeight: 800, color: C.text }}>
              {s.value}{s.suffix || ''}
            </div>
            <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginTop: 4 }}>
              {s.label}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function HowOverlay() {
  const [expandedStep, setExpandedStep] = useState<number | null>(null)

  const steps = [
    {
      n: '01', title: 'Connect', desc: 'Link your wallet via RainbowKit — supports MetaMask, WalletConnect, Coinbase Wallet, and all major EVM wallets.', icon: '🔌',
      detail: 'RSends uses wagmi v2 with RainbowKit for seamless wallet connections. Once connected, the app detects your chain (Base, Ethereum, Arbitrum) and configures the contract interface automatically. No API keys or registration required.',
    },
    {
      n: '02', title: 'Verify', desc: 'The compliance Oracle screens the transaction and issues an EIP-712 cryptographic attestation.', icon: '🛡',
      detail: 'Before any funds move, the Oracle performs AML screening, DAC8 reporting checks, and MiCA compliance verification. It returns a typed EIP-712 signature that the smart contract will independently verify. This ensures compliance is enforced at the protocol level, not just the API level.',
    },
    {
      n: '03', title: 'Execute', desc: 'FeeRouterV4 verifies the signature, splits the payment (99.5% recipient, 0.5% fee), and settles instantly.', icon: '⚡',
      detail: 'The smart contract checks the Oracle signature on-chain, executes the split routing according to your configuration, and emits events for the DAC8 reporting engine. Settlement is final in ~2 seconds on Base L2 with gas costs under $0.05.',
    },
  ]

  const advancedFlows = [
    { title: 'Swap & Forward', desc: 'Pay in ETH, recipient gets USDC. Automatic DEX routing with compliance.', icon: '🔄' },
    { title: 'Auto-Split', desc: 'Programmable treasury routing — split payments across multiple destinations.', icon: '📊' },
    { title: 'Sweeper', desc: 'Auto-forward incoming funds to configured destinations based on rules.', icon: '🧹' },
    { title: 'DAC8 Reports', desc: 'Generate fiscal XML reports on demand for any transaction period.', icon: '📋' },
  ]

  return (
    <div>
      <h2 style={{ fontFamily: C.D, fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>
        How It <span style={GRAD}>Works</span>
      </h2>
      <p style={{ fontFamily: C.M, fontSize: 12, color: C.dim, marginBottom: 28 }}>
        Three steps from intent to settlement
      </p>

      {/* ═══ A) 3-Step Journey ═══ */}
      <div style={{ marginBottom: 32 }}>
        {steps.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.15, duration: 0.5, ease: EASE }}
            style={{ position: 'relative', paddingLeft: 32, marginBottom: i < steps.length - 1 ? 0 : 0 }}
          >
            {/* Connecting line */}
            {i < steps.length - 1 && (
              <motion.div
                initial={{ scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 + 0.3, duration: 0.4 }}
                style={{
                  position: 'absolute', left: 14, top: 46, width: 2, height: 'calc(100% - 20px)',
                  background: `linear-gradient(180deg, ${C.blue}40, ${C.blue}10)`,
                  transformOrigin: 'top',
                }}
              />
            )}

            <div style={{ display: 'flex', gap: 14, padding: '16px 0' }}>
              {/* Number badge */}
              <div style={{
                position: 'absolute', left: 0, top: 18,
                width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))',
                border: `1px solid ${C.blue}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: C.M, fontSize: 10, fontWeight: 700, color: C.blue,
              }}>
                {s.n}
              </div>

              {/* Content */}
              <div style={{ flex: 1, marginLeft: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>{s.icon}</span>
                  <span style={{ fontFamily: C.D, fontSize: 16, fontWeight: 700, color: C.text }}>{s.title}</span>
                </div>
                <p style={{ fontFamily: C.M, fontSize: 11, color: C.sub, lineHeight: 1.6, marginBottom: 8 }}>{s.desc}</p>

                {/* Technical details toggle */}
                <button
                  onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
                    background: expandedStep === i ? 'rgba(59,130,246,0.08)' : 'transparent',
                    color: expandedStep === i ? C.blue : C.dim,
                    fontFamily: C.M, fontSize: 9, cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  {expandedStep === i ? '▾ Hide details' : '▸ Technical details'}
                </button>
                <motion.div
                  initial={false}
                  animate={{ height: expandedStep === i ? 'auto' : 0, opacity: expandedStep === i ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{
                    marginTop: 8, padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
                    fontFamily: C.M, fontSize: 10, color: C.dim, lineHeight: 1.6,
                  }}>
                    {s.detail}
                  </div>
                </motion.div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ═══ B) Advanced Flows ═══ */}
      <div>
        <div style={{ fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 14 }}>
          Advanced Flows
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {advancedFlows.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.35, ease: EASE }}
              whileHover={{ y: -3, rotateX: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}
              style={{
                padding: '16px', borderRadius: 14,
                background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
                cursor: 'default', transition: 'all 0.3s ease',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, lineHeight: 1.5 }}>{f.desc}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SecurityOverlay() {
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null)
  const [threatDone, setThreatDone] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setThreatDone(true), 3200)
    return () => clearTimeout(t)
  }, [])

  const layers = [
    { title: 'Blockchain Foundation', desc: 'Base L2 with Ethereum settlement finality', icon: '⛓', color: C.blue, detail: 'Transactions execute on Base L2 for minimal gas costs (~$0.01), with full security inherited from Ethereum L1. Settlement finality is guaranteed through the Optimism Bedrock architecture.' },
    { title: 'Infrastructure', desc: 'HMAC-SHA256, rate limiting, Nginx SSL termination', icon: '🏗', color: C.amber, detail: 'All API requests are authenticated via HMAC-SHA256 signatures. Rate limiting prevents abuse. SSL termination at the edge with Nginx provides encrypted transport. Infrastructure is monitored 24/7.' },
    { title: 'Smart Contract', desc: 'ReentrancyGuard, OpenZeppelin, FeeRouterV4', icon: '📝', color: C.purple, detail: 'FeeRouterV4.sol inherits from OpenZeppelin\'s battle-tested ReentrancyGuard and Ownable contracts. All state-changing functions are protected against re-entrancy attacks. The contract is verified on Basescan.' },
    { title: 'Compliance Engine', desc: 'EIP-712 Oracle, AML/DAC8/MiCA screening', icon: '🛡', color: C.green, detail: 'Every transaction requires a valid EIP-712 typed signature from the compliance Oracle. The Oracle screens against AML databases, verifies DAC8 reporting requirements, and ensures MiCA compliance before any funds move.' },
    { title: 'Monitoring', desc: 'Sentry, Prometheus, Z-score anomaly detection', icon: '📡', color: '#FF4C6A', detail: 'Real-time monitoring with Sentry for error tracking, Prometheus for metrics, and custom Z-score anomaly detection that flags unusual transaction patterns. Alerts are dispatched instantly for any deviation.' },
  ]

  const features = [
    { icon: '🔮', title: 'Oracle-Gated TX', desc: 'Every transaction requires cryptographic approval from the compliance Oracle before execution.' },
    { icon: '✅', title: 'On-Chain Verification', desc: 'Smart contract independently verifies Oracle signatures. No trust assumptions — verify, don\'t trust.' },
    { icon: '📊', title: 'Anomaly Detection', desc: 'Z-score statistical analysis flags transactions deviating from normal patterns in real-time.' },
    { icon: '🚦', title: 'Rate Limiting', desc: 'API and transaction-level rate limiting prevents abuse and protects infrastructure from attacks.' },
    { icon: '🔐', title: 'HMAC Integrity', desc: 'All backend communications are HMAC-SHA256 signed, preventing request tampering and replay attacks.' },
    { icon: '🏰', title: 'Infrastructure Security', desc: 'Nginx SSL termination, Docker isolation, automated backups, and least-privilege access controls.' },
  ]

  return (
    <div>
      {/* ═══ A) Threat Landscape Intro ═══ */}
      <motion.div
        animate={{ opacity: threatDone ? 0 : 1, y: threatDone ? -20 : 0, height: threatDone ? 0 : 'auto' }}
        transition={{ duration: 0.6, ease: EASE }}
        style={{ overflow: 'hidden', marginBottom: threatDone ? 0 : 24 }}
      >
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: EASE }}
            style={{ fontFamily: C.D, fontSize: 32, fontWeight: 800, color: C.red, marginBottom: 8 }}
          >
            $5.8 billion
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            style={{ fontFamily: C.M, fontSize: 12, color: C.dim, marginBottom: 16 }}
          >
            lost to DeFi exploits and hacks since 2020
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.6, ease: EASE }}
            style={{ fontFamily: C.D, fontSize: 18, fontWeight: 700, color: C.text }}
          >
            RSends was built differently.
          </motion.div>
        </div>
      </motion.div>

      <h2 style={{ fontFamily: C.D, fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 4 }}>
        <span style={GRAD}>Security</span> Architecture
      </h2>
      <p style={{ fontFamily: C.M, fontSize: 12, color: C.dim, marginBottom: 28 }}>
        Five layers of defense protecting every transaction
      </p>

      {/* ═══ B) Security Layer Stack ═══ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
          Security Layer Stack
        </div>
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 6 }}>
          {layers.map((layer, i) => (
            <motion.div
              key={layer.title}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.4, ease: EASE }}
            >
              <motion.button
                onClick={() => setExpandedLayer(expandedLayer === i ? null : i)}
                whileHover={{ y: -1 }}
                style={{
                  width: '100%', padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                  background: expandedLayer === i ? `${layer.color}10` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${expandedLayer === i ? `${layer.color}40` : C.border}`,
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'all 0.25s ease', textAlign: 'left',
                  boxShadow: expandedLayer === i ? `0 0 20px ${layer.color}15, inset 0 0 20px ${layer.color}05` : 'none',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: `${layer.color}12`, border: `1px solid ${layer.color}25`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                }}>
                  {layer.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 700, color: C.text }}>{layer.title}</div>
                  <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>{layer.desc}</div>
                </div>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)' }}>
                  L{i + 1}
                </div>
              </motion.button>
              <motion.div
                initial={false}
                animate={{ height: expandedLayer === i ? 'auto' : 0, opacity: expandedLayer === i ? 1 : 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{
                  margin: '6px 0 0 48px', padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
                  fontFamily: C.M, fontSize: 11, color: C.sub, lineHeight: 1.6,
                }}>
                  {layer.detail}
                </div>
              </motion.div>
            </motion.div>
          ))}
        </div>

        {/* Animated particle rising through layers */}
        <div style={{ position: 'relative', height: 4, margin: '12px 0', overflow: 'hidden', borderRadius: 2, background: 'rgba(255,255,255,0.03)' }}>
          <div style={{
            width: 40, height: '100%',
            background: `linear-gradient(90deg, transparent, ${C.green}, transparent)`,
            animation: 'rpShimmer 2.5s linear infinite',
            backgroundSize: '200% 100%',
          }} />
        </div>
      </div>

      {/* ═══ C) Security Features Grid ═══ */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
          Security Features
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.35, ease: EASE }}
              whileHover={{ y: -4, boxShadow: '0 8px 32px rgba(59,130,246,0.1), 0 0 0 1px rgba(59,130,246,0.15)' }}
              style={{
                padding: '16px', borderRadius: 14,
                background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
                cursor: 'default', transition: 'box-shadow 0.3s ease, transform 0.3s ease',
              }}
            >
              <div style={{ fontSize: 18, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, lineHeight: 1.5 }}>{f.desc}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ═══ D) System Status ═══ */}
      <div style={{
        padding: '14px 18px', borderRadius: 14,
        background: 'rgba(0,214,143,0.04)', border: `1px solid ${C.green}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', width: 8, height: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />
            <div style={{ position: 'absolute', inset: -4, borderRadius: '50%', border: `2px solid ${C.green}`, animation: 'rsPulse 2s ease infinite' }} />
          </div>
          <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 700, color: C.green }}>All Systems Operational</span>
        </div>
        <a
          href="https://basescan.org/address/0xB2174c6B1359434B9d8004Ca5740bcDDF4C8691D"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: C.M, fontSize: 10, color: C.sub, textDecoration: 'none' }}
        >
          Contract Verified on Basescan ✅
        </a>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  HERO TITLE — AnimatePresence mode="wait" for no overlap
// ═══════════════════════════════════════════════════════════

function HeroTitle({ view, setView, isConnected }: { view: View; setView: (v: View) => void; isConnected: boolean }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', position: 'relative', width: '100%' }}>
      {/* Tagline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        style={{
          fontFamily: C.D,
          fontSize: 'clamp(36px, 6vw, 58px)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          textAlign: 'center',
          marginBottom: 8,
          lineHeight: 1.2,
          wordSpacing: '0.15em',
        }}
      >
        <span style={{
          background: 'linear-gradient(135deg, #FFFFFF 0%, #60A5FA 60%, #1D4ED8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>Crypto Payments. Fully Compliant.</span>
      </motion.div>

      {/* Subtitle */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
        style={{
          fontFamily: C.M,
          fontSize: 'clamp(11px, 1.5vw, 13px)',
          fontWeight: 500,
          letterSpacing: '0.05em',
          textAlign: 'center',
          color: C.sub,
          marginBottom: 1,
          textTransform: 'uppercase' as const,
        }}
      >
        Built for European Businesses.
      </motion.div>

      {/* CTA — only when wallet not connected */}
      {!isConnected && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.5, ease: EASE }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          style={{
            padding: '12px 32px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
            color: '#fff', fontFamily: C.D, fontSize: 14, fontWeight: 700,
            cursor: 'pointer', letterSpacing: '-0.01em',
            boxShadow: '0 4px 24px rgba(59,130,246,0.3)',
            animation: 'rpCtaPulse 3s ease-in-out infinite',
          }}
        >
          Start Sending →
        </motion.button>
      )}
    </div>
  )
}


      




// ═══════════════════════════════════════════════════════════
//  COMMAND CENTER COMPONENTS — Jupiter-style compact
// ═══════════════════════════════════════════════════════════
function GasGuard() {
  const [gas, setGas] = useState<number | null>(null)
  useEffect(() => {
    const f = async () => { try { const r = await fetch('https://mainnet.base.org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) }); setGas(parseInt((await r.json()).result, 16) / 1e9) } catch { /* */ } }
    f(); const iv = setInterval(f, 15000); return () => clearInterval(iv)
  }, [])
  const lv = gas === null ? 'unknown' : gas < 0.01 ? 'optimal' : gas < 0.1 ? 'normal' : 'high'
  const cfg: Record<string, { l: string; c: string }> = { optimal: { l: 'Optimal', c: C.green }, normal: { l: 'Normal', c: C.amber }, high: { l: 'High', c: C.red }, unknown: { l: '—', c: C.dim } }
  const g = cfg[lv]
  return (
    <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: '14px 16px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: g.c, boxShadow: `0 0 6px ${g.c}60` }} />
          <span style={{ fontFamily: C.M, fontSize: 12, fontWeight: 600, color: g.c }}>{gas !== null ? `${gas.toFixed(4)} Gwei` : '—'}</span>
        </div>
        <span style={{ fontFamily: C.M, fontSize: 10, color: `${g.c}80` }}>{g.l}</span>
      </div>
    </div>
  )
}

function SmartRouteConfig({ address }: { address: string | undefined }) {
  const [dest, setDest] = useState(''); const [split, setSplit] = useState(false)
  const [pct, setPct] = useState('70'); const [dest2, setDest2] = useState('')
  const [thr, setThr] = useState('0.001'); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false)
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', color: C.text, fontFamily: C.M, fontSize: 12, outline: 'none', boxSizing: 'border-box' as const }
  const save = async () => {
    if (!address || !dest.startsWith('0x')) return; setSaving(true)
    try { await fetch(`${BACKEND}/api/v1/forwarding/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_wallet: address, destination_wallet: dest, min_threshold: parseFloat(thr), gas_strategy: 'normal', max_gas_percent: 10, token_symbol: 'ETH', chain_id: 8453, split_enabled: split, split_percent: split ? parseInt(pct) : 100, split_destination: split ? dest2 : null }) }); setSaved(true); setTimeout(() => setSaved(false), 3000) } catch { /* */ }; setSaving(false)
  }
  const ok = dest.startsWith('0x') && !saving
  return (
    <div className="rp-anim-2" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: '14px 16px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)' }}>
      {/* Destination */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontFamily: C.D, fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>Destination {split && `(${pct}%)`}</label>
        <input value={dest} onChange={e => setDest(e.target.value)} placeholder="0x..." style={inp} />
      </div>

      {/* Split toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: split ? 10 : 8 }}>
        <span style={{ fontFamily: C.D, fontSize: 12, color: C.sub }}>Split Routing</span>
        <button onClick={() => setSplit(s => !s)} style={{ width: 36, height: 20, borderRadius: 10, background: split ? C.green : 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: split ? 19 : 3, transition: 'left 0.2s' }} />
        </button>
      </div>

      {split && (
        <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, marginBottom: 10 }}>
          <input type="number" value={pct} onChange={e => setPct(e.target.value)} min="1" max="99" style={{ ...inp, textAlign: 'center' as const, fontSize: 11 }} />
          <input value={dest2} onChange={e => setDest2(e.target.value)} placeholder={`Dest 2 (${100 - parseInt(pct || '70')}%)`} style={{ ...inp, fontSize: 11 }} />
        </div>
      )}

      {/* Threshold */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontFamily: C.M, fontSize: 10, color: C.dim, display: 'block', marginBottom: 4 }}>Min threshold (ETH)</label>
        <input type="number" value={thr} onChange={e => setThr(e.target.value)} step="0.001" style={inp} />
      </div>

      {/* CTA */}
      <button onClick={save} disabled={!ok} style={{
        width: '100%', padding: '14px', borderRadius: 14, border: 'none',
        background: saved ? C.green : ok ? `linear-gradient(135deg, ${C.purple}, #c084fc)` : 'rgba(255,255,255,0.04)',
        color: saved ? '#000' : ok ? '#fff' : 'rgba(255,255,255,0.35)',
        fontFamily: C.D, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em',
        cursor: ok ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
        boxShadow: ok && !saved ? `0 4px 20px ${C.purple}25` : 'none',
      }}>{saving ? '...' : saved ? '✓ Saved' : 'Activate Route'}</button>
    </div>
  )
}

function ActivityFeed({ address }: { address: string | undefined }) {
  interface L { id: number; destination: string; amount: number; token: string; status: string; tx_hash: string | null; gas_percent: number | null }
  const [logs, setLogs] = useState<L[]>([])
  useEffect(() => { if (!address) return; const ld = () => fetch(`${BACKEND}/api/v1/forwarding/logs?wallet=${address}&limit=6`).then(r => r.ok ? r.json() : null).then(d => { if (d?.logs) setLogs(d.logs) }).catch(() => {}); ld(); const iv = setInterval(ld, 10000); return () => clearInterval(iv) }, [address])
  const sc: Record<string, string> = { pending: '#ffb800', executing: C.blue, completed: C.green, failed: '#ff2d55', gas_too_high: '#FF8C00' }
  if (!logs.length) return (
    <div className="rp-anim-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '28px 20px', textAlign: 'center' as const }}>
      <div style={{ fontFamily: C.D, fontSize: 13, color: C.dim, marginBottom: 4 }}>Waiting for transactions</div>
      <div style={{ fontFamily: C.M, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Activity will appear here</div>
    </div>
  )
  return (
    <div className="rp-anim-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
      {logs.map((l, i) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: i < logs.length - 1 ? `1px solid ${C.border}` : 'none' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc[l.status] ?? C.dim, flexShrink: 0 }} />
          <div style={{ flex: 1, fontFamily: C.M, fontSize: 12, color: C.text }}>{l.amount?.toFixed(4)} {l.token} → {l.destination?.slice(0, 8)}…</div>
          <span style={{ fontFamily: C.M, fontSize: 9, color: sc[l.status] ?? C.dim, textTransform: 'uppercase' as const }}>{l.status}</span>
          {l.tx_hash && <a href={`https://basescan.org/tx/${l.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: C.M, fontSize: 9, color: C.sub, textDecoration: 'none' }}>↗</a>}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const { address, isConnected } = useAccount()
  const [view, setView] = useState<View>('send')
  const [activeOverlay, setActiveOverlay] = useState<Overlay>(null)
  const [showIntro, setShowIntro] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('RSends_seen')) {
        setShowIntro(true); sessionStorage.setItem('RSends_seen', '1')
      } else { setReady(true) }
    } catch { setReady(true) }
  }, [])

  const handleIntroDone = useCallback(() => { setShowIntro(false); setReady(true) }, [])

  return (
    <>
      {showIntro && <ParticleIntro onDone={handleIntroDone} />}

      {/* Background */}
      <div className="rp-bg" aria-hidden="true">
        <div className="rp-bg__base" /><div className="rp-orb rp-orb--1" /><div className="rp-orb rp-orb--2" />
        <div className="rp-orb rp-orb--3" /><div className="rp-orb rp-orb--4" /><div className="rp-orb rp-orb--5" />
        <div className="rp-bg__noise" />
      </div>

      {/* Navbar */}
      <Navbar view={view} setView={setView} activeOverlay={activeOverlay} setActiveOverlay={setActiveOverlay} />

      {/* Network + Gas — fixed top-right below navbar */}
      {ready && <NetworkGasWidget />}

      {/* Overlays */}
      <OverlayShell active={activeOverlay === 'about'} onClose={() => setActiveOverlay(null)}>
        <AboutOverlay />
      </OverlayShell>
      <OverlayShell active={activeOverlay === 'how'} onClose={() => setActiveOverlay(null)}>
        <HowOverlay />
      </OverlayShell>
      <OverlayShell active={activeOverlay === 'security'} onClose={() => setActiveOverlay(null)}>
        <SecurityOverlay />
      </OverlayShell>
      <OverlayShell active={activeOverlay === 'compliance'} onClose={() => setActiveOverlay(null)}>
        <ComplianceOverlay />
      </OverlayShell>
      <OverlayShell active={activeOverlay === 'developers'} onClose={() => setActiveOverlay(null)}>
        <DevelopersOverlay />
      </OverlayShell>
      <OverlayShell active={activeOverlay === 'pricing'} onClose={() => setActiveOverlay(null)}>
        <PricingOverlay />
      </OverlayShell>

      {/* Main content — padded below navbar */}
      <main style={{
        minHeight: '100vh',
        paddingTop: 'clamp(90px, 12vh, 140px)',
        paddingBottom: 60, paddingLeft: 16, paddingRight: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        opacity: ready ? 1 : 0, transition: 'opacity 0.9s ease',
      }}>

        {/* Hero */}
        <div style={{ marginBottom: 28, width: '100%', maxWidth: 900 }}>
          <HeroTitle view={view} setView={setView} isConnected={isConnected} />
        </div>

        {/* === TAB SWITCHER — sliding pill indicator === */}
        {ready && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: SPRING, delay: 0.15 }}
            style={{
              zIndex: 2,
              position: 'relative',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 18,
              marginBottom: 28,
              padding: '5px 6px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)',
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {([
              { key: 'send' as View, label: '↗ Send' },
              { key: 'swap' as View, label: '↗ Swap' },
              { key: 'command' as View, label: '↗ Command Center' },
            ]).map((v) => (
              <motion.button
                key={v.key}
                whileTap={{ scale: 0.96 }}
                onClick={() => setView(v.key)}
                style={{
                  position: 'relative',
                  padding: '10px 22px',
                  borderRadius: 13,
                  border: 'none',
                  background: 'transparent',
                  color: view === v.key ? '#fff' : 'rgba(255,255,255,0.45)',
                  fontFamily: C.D,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'color 0.22s ease',
                  zIndex: 1,
                }}
              >
                {view === v.key && (
                  <motion.div
                    layoutId="tab-pill"
                    style={{
                      position: 'absolute', inset: 0,
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.07) 100%)',
                      borderRadius: 13,
                      border: '1px solid rgba(255,255,255,0.16)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                    }}
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                  />
                )}
                <span style={{ position: 'relative', zIndex: 1 }}>{v.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* WidgetContainer — sempre montato, sfondo vetro fisso, cross-fade CSS puro */}
        <div className="widget-container" style={{
          width: '100%',
          maxWidth: 480,
          background: 'rgba(8,12,30,0.72)',
          backdropFilter: 'blur(32px) saturate(180%)',
          WebkitBackdropFilter: 'blur(32px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 20,
          boxShadow: '0 8px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.15)',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {/* Send — always mounted */}
          <div style={view === 'send' ? panelActive : panelHidden}>
            <TransferForm noCard />
          </div>

          {/* Swap — always mounted */}
          <div style={view === 'swap' ? panelActive : panelHidden}>
            <SwapModule noCard onSwapComplete={() => {}} />
          </div>

          {/* Command Center — always mounted */}
          <div style={view === 'command' ? panelActive : panelHidden}>
            {isConnected ? (
              <div style={{ padding: '10px 10px 10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <GasGuard />
                  <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
                    <div style={{ textAlign: 'center' as const }}>
                      <div style={{ fontFamily: C.D, fontSize: 18, fontWeight: 700, color: C.text }}>—</div>
                      <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>Sweeps</div>
                    </div>
                    <div style={{ width: 1, height: 24, background: C.border }} />
                    <div style={{ textAlign: 'center' as const }}>
                      <div style={{ fontFamily: C.D, fontSize: 18, fontWeight: 700, color: C.text }}>—</div>
                      <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>Vol 24h</div>
                    </div>
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}><SmartRouteConfig address={address} /></div>
                <ActivityFeed address={address} />
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div style={{ fontFamily: C.D, fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Connect wallet</div>
                <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}>To access Command Center</div>
              </div>
            )}
          </div>
        </div>

      </main>

      {/* ═══════════════════════════════════════════════════════════
          FOOTER
         ═══════════════════════════════════════════════════════════ */}
      <footer style={{
        position: 'relative', zIndex: 1,
        borderTop: `1px solid ${C.border}`,
        padding: '48px 24px 24px',
        maxWidth: 960, margin: '0 auto',
      }}>
        {/* 4-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32, marginBottom: 36 }}>
          {/* Product */}
          <div>
            <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 700, color: C.text, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 14 }}>
              Product
            </div>
            {['Send', 'Swap', 'Auto-Forward', 'Dashboard'].map(item => (
              <div key={item} style={{ fontFamily: C.M, fontSize: 11, color: C.dim, marginBottom: 8, cursor: 'default' }}>{item}</div>
            ))}
          </div>

          {/* Security */}
          <div>
            <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 700, color: C.text, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 14 }}>
              Security
            </div>
            {[
              { label: 'Architecture', action: () => setActiveOverlay('security') },
              { label: 'Compliance', action: () => setActiveOverlay('compliance') },
              { label: 'Audit Trail', action: undefined },
            ].map(item => (
              <div
                key={item.label}
                onClick={item.action}
                style={{
                  fontFamily: C.M, fontSize: 11, color: C.dim, marginBottom: 8,
                  cursor: item.action ? 'pointer' : 'default',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (item.action) e.currentTarget.style.color = C.sub }}
                onMouseLeave={e => e.currentTarget.style.color = C.dim}
              >
                {item.label}
              </div>
            ))}
          </div>

          {/* Legal */}
          <div>
            <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 700, color: C.text, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 14 }}>
              Legal
            </div>
            {['Terms of Service', 'Privacy Policy'].map(item => (
              <a key={item} href="#" style={{ display: 'block', fontFamily: C.M, fontSize: 11, color: C.dim, marginBottom: 8, textDecoration: 'none', transition: 'color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = C.sub}
                onMouseLeave={e => e.currentTarget.style.color = C.dim}
              >
                {item}
              </a>
            ))}
          </div>

          {/* Connect */}
          <div>
            <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 700, color: C.text, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 14 }}>
              Connect
            </div>
            <a href="https://github.com/Emicatte/feerouter-dapp" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: C.M, fontSize: 11, color: C.dim, marginBottom: 8, textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = C.sub}
              onMouseLeave={e => e.currentTarget.style.color = C.dim}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </a>
            {['Twitter', 'Discord'].map(item => (
              <a key={item} href="#" style={{ display: 'block', fontFamily: C.M, fontSize: 11, color: C.dim, marginBottom: 8, textDecoration: 'none', transition: 'color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = C.sub}
                onMouseLeave={e => e.currentTarget.style.color = C.dim}
              >
                {item}
              </a>
            ))}
          </div>
        </div>

        {/* Compliance badge strip */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, justifyContent: 'center', marginBottom: 20 }}>
          {['MiCA', 'DAC8', 'EIP-712', 'Base L2'].map(badge => (
            <span key={badge} style={{
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
              fontFamily: C.M, fontSize: 9, color: C.dim,
            }}>
              {badge}
            </span>
          ))}
        </div>

        {/* Bottom bar */}
        <div style={{
          borderTop: `1px solid ${C.border}`, paddingTop: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexWrap: 'wrap' as const, gap: 6,
          fontFamily: C.M, fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.02em',
        }}>
          <span>Built on Base L2</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>&copy; 2026 RSends</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>Contract: 0xB217...691D</span>
          <a
            href="https://basescan.org/address/0xB2174c6B1359434B9d8004Ca5740bcDDF4C8691D"
            target="_blank" rel="noopener noreferrer"
            style={{ color: C.green, textDecoration: 'none', fontSize: 9 }}
          >
            Verified ✅
          </a>
        </div>
      </footer>

      <style>{`
        @keyframes rsPulse{0%{transform:scale(1);opacity:.8}50%{transform:scale(1.8);opacity:0}100%{transform:scale(1);opacity:0}}
        @keyframes holoShift{0%{background-position:0% 50%}100%{background-position:200% 50%}}
        @keyframes rsSpin{100%{transform:rotate(360deg)}}
        @keyframes rpCtaPulse{0%,100%{transform:scale(1);box-shadow:0 4px 24px rgba(59,130,246,0.3)}50%{transform:scale(1.02);box-shadow:0 6px 32px rgba(59,130,246,0.45)}}
      `}</style>
    </>
  )
}