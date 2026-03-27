'use client'




import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import type { Variants, Transition } from 'framer-motion'

// STATIC IMPORTS - No lazy loading, instant component availability
import TransferForm from './TransferForm'
import SwapModule from './SwapModule'
import AccountHeader from './AccountHeader'



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
type Overlay = null | 'about' | 'how' | 'security'

const GRAD: React.CSSProperties = {
  background: 'linear-gradient(135deg, #FF4C6A 0%, #8B5CF6 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
}

// ════════════════════════════════════════════════════��══════
//  MOTION CONFIG — Faster, more responsive transitions
// ═══════════════════════════════════════════════════════════
const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]

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
    { key: 'about',    label: 'Chi siamo' },
    { key: 'how',      label: 'Come funziona' },
    { key: 'security', label: 'Sicurezza' },
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
  return (
    <div>
      <h2 style={{ fontFamily: C.D, fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 16 }}>
        Chi <span style={GRAD}>siamo</span>
      </h2>
      <p style={{ fontFamily: C.M, fontSize: 13, color: C.sub, lineHeight: 1.7, marginBottom: 16 }}>
        RSends è un protocollo di automazione finanziaria non-custodial costruito su Base L2.
        Consente trasferimenti programmabili, split routing automatico e compliance fiscale DAC8
        integrata nativamente nello smart contract.
      </p>
      <p style={{ fontFamily: C.M, fontSize: 13, color: C.sub, lineHeight: 1.7, marginBottom: 16 }}>
        Ogni transazione passa attraverso un Oracle AML/KYC prima di essere eseguita on-chain,
        garantendo conformità MiCA e VASP senza sacrificare la decentralizzazione.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginTop: 20 }}>
        {['Non-Custodial', 'DAC8 Compliant', 'MiCA Ready', 'Open Source', 'Base L2'].map(b => (
          <span key={b} style={{ fontFamily: C.M, fontSize: 9, color: C.dim, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}` }}>{b}</span>
        ))}
      </div>
    </div>
  )
}

function HowOverlay() {
  const steps = [
    { n: '01', title: 'Connetti il wallet', desc: 'MetaMask, WalletConnect o qualsiasi wallet EVM-compatibile.', icon: '🔌' },
    { n: '02', title: 'Configura la Smart Route', desc: 'Scegli destinazione, split percentuali e soglia minima.', icon: '🔀' },
    { n: '03', title: 'Oracle AML Check', desc: 'Ogni transazione viene verificata in tempo reale dal nostro Oracle.', icon: '🛡' },
    { n: '04', title: 'Esecuzione on-chain', desc: 'Lo smart contract FeeRouterV4 esegue lo split e il forwarding.', icon: '⚡' },
    { n: '05', title: 'Compliance DAC8', desc: 'Il report fiscale viene generato automaticamente per ogni operazione.', icon: '📋' },
  ]

  return (
    <div>
      <h2 style={{ fontFamily: C.D, fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 24 }}>
        Come <span style={GRAD}>funziona</span>
      </h2>
      {steps.map((s, i) => (
        <div key={s.n} style={{
          display: 'flex', gap: 16, padding: '16px 0',
          borderBottom: i < steps.length - 1 ? `1px solid ${C.border}` : 'none',
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, flexShrink: 0,
            background: `${C.blue}10`, border: `1px solid ${C.blue}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>{s.icon}</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: C.M, fontSize: 9, color: C.purple, fontWeight: 700 }}>{s.n}</span>
              <span style={{ fontFamily: C.D, fontSize: 14, fontWeight: 700, color: C.text }}>{s.title}</span>
            </div>
            <p style={{ fontFamily: C.M, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{s.desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function SecurityOverlay() {
  return (
    <div>
      <h2 style={{ fontFamily: C.D, fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 8 }}>
        <span style={GRAD}>Sicurezza</span> On-Chain
      </h2>
      <p style={{ fontFamily: C.M, fontSize: 12, color: C.dim, marginBottom: 24 }}>
        Come RSendsForwarder.sol protegge i tuoi fondi
      </p>

      {/* Animated on-chain diagram */}
      <div style={{
        background: C.bg, borderRadius: 16, padding: '28px 20px',
        border: `1px solid ${C.border}`, position: 'relative', overflow: 'hidden',
      }}>
        <svg width="100%" height="200" viewBox="0 0 600 200">
          {/* Nodes */}
          {/* User Wallet */}
          <rect x="20" y="70" width="120" height="60" rx="14" fill="#111118" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <text x="80" y="96" textAnchor="middle" fill="#E2E2F0" fontFamily="var(--font-display)" fontSize="11" fontWeight="700">User Wallet</text>
          <text x="80" y="115" textAnchor="middle" fill="#4A4E64" fontFamily="var(--font-mono)" fontSize="8">MetaMask / WC</text>

          {/* RSend Engine */}
          <rect x="230" y="60" width="140" height="80" rx="16" fill="#16161f" stroke="rgba(59,130,246,0.25)" strokeWidth="1.5" />
          <text x="300" y="92" textAnchor="middle" fill="#3B82F6" fontFamily="var(--font-display)" fontSize="10" fontWeight="700">⚡ RSends Engine</text>
          <text x="300" y="108" textAnchor="middle" fill="#8A8FA8" fontFamily="var(--font-mono)" fontSize="8">FeeRouterV4.sol</text>
          <text x="300" y="124" textAnchor="middle" fill="#4A4E64" fontFamily="var(--font-mono)" fontSize="7">Non-custodial</text>

          {/* Dest 1 */}
          <rect x="460" y="35" width="120" height="50" rx="12" fill="#111118" stroke="rgba(0,214,143,0.2)" strokeWidth="1" />
          <text x="520" y="57" textAnchor="middle" fill="#00D68F" fontFamily="var(--font-display)" fontSize="10" fontWeight="600">Dest 1 (70%)</text>
          <text x="520" y="72" textAnchor="middle" fill="#4A4E64" fontFamily="var(--font-mono)" fontSize="7">Operativo</text>

          {/* Dest 2 */}
          <rect x="460" y="115" width="120" height="50" rx="12" fill="#111118" stroke="rgba(139,92,246,0.2)" strokeWidth="1" />
          <text x="520" y="137" textAnchor="middle" fill="#8B5CF6" fontFamily="var(--font-display)" fontSize="10" fontWeight="600">Dest 2 (30%)</text>
          <text x="520" y="152" textAnchor="middle" fill="#4A4E64" fontFamily="var(--font-mono)" fontSize="7">Tasse</text>

          {/* Flow lines */}
          <line x1="140" y1="100" x2="230" y2="100" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="6,4" />
          <line x1="370" y1="90" x2="460" y2="60" stroke="rgba(0,214,143,0.15)" strokeWidth="2" strokeDasharray="6,4" />
          <line x1="370" y1="110" x2="460" y2="140" stroke="rgba(139,92,246,0.15)" strokeWidth="2" strokeDasharray="6,4" />

          {/* Animated particles — wallet to engine */}
          <circle r="3" fill="#3B82F6">
            <animateMotion dur="2s" repeatCount="indefinite" path="M145,100 L225,100" />
          </circle>
          <circle r="2.5" fill="#3B82F6" opacity="0.5">
            <animateMotion dur="2s" repeatCount="indefinite" path="M145,100 L225,100" begin="0.7s" />
          </circle>

          {/* Engine to Dest 1 */}
          <circle r="3" fill="#00D68F">
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M375,90 L455,60" />
          </circle>
          <circle r="2" fill="#00D68F" opacity="0.5">
            <animateMotion dur="1.8s" repeatCount="indefinite" path="M375,90 L455,60" begin="0.5s" />
          </circle>

          {/* Engine to Dest 2 */}
          <circle r="2.5" fill="#8B5CF6">
            <animateMotion dur="2.2s" repeatCount="indefinite" path="M375,110 L455,140" />
          </circle>
          <circle r="2" fill="#8B5CF6" opacity="0.4">
            <animateMotion dur="2.2s" repeatCount="indefinite" path="M375,110 L455,140" begin="0.6s" />
          </circle>
        </svg>

        {/* Trust label */}
        <div style={{
          textAlign: 'center', marginTop: 16,
          fontFamily: C.M, fontSize: 10, color: C.green,
          padding: '8px 16px', borderRadius: 10,
          background: `${C.green}06`, border: `1px solid ${C.green}12`,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          margin: '16px auto 0', width: 'fit-content',
        }}>
          🔒 Funds are never stored. The contract only routes. Non-custodial by design.
        </div>
      </div>

      {/* Security features */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
        {[
          { icon: '🛡', title: 'ReentrancyGuard', desc: 'Protezione da attacchi di re-entrancy' },
          { icon: '🔑', title: 'Owner-only Config', desc: 'Solo il proprietario può configurare le regole' },
          { icon: '⛽', title: 'Gas Guard', desc: 'Sospende lo sweep se il gas supera la soglia' },
          { icon: '🚨', title: 'Emergency Withdraw', desc: 'Ritiro di emergenza in caso di necessità' },
        ].map(f => (
          <div key={f.title} style={{ padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 16, marginBottom: 6 }}>{f.icon}</div>
            <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 3 }}>{f.title}</div>
            <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, lineHeight: 1.4 }}>{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  HERO TITLE — AnimatePresence mode="wait" for no overlap
// ═══════════════════════════════════════════════════════════

function HeroTitle({ view, setView }: { view: View; setView: (v: View) => void }) {
  const base: React.CSSProperties = {
    fontFamily: C.D, fontSize: 'clamp(40px, 7vw, 62px)',
    fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.04em',
    textAlign: 'center', color: C.text,
  }

  const tagline: React.CSSProperties = {
    fontFamily: C.D,
    fontSize: 'clamp(36px, 6vw, 58px)',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    textAlign: 'center',
    marginBottom: 8,
    background: 'linear-gradient(135deg, #FFB547 0%, #8B5CF6 50%, #3B82F6 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    lineHeight: 1.2,
    wordSpacing: '0.15em',
  }

  const subtitle: React.CSSProperties = {
    fontFamily: C.M,
    fontSize: 'clamp(11px, 1.5vw, 13px)',
    fontWeight: 500,
    letterSpacing: '0.05em',
    textAlign: 'center',
    color: C.sub,
    marginBottom: 1,
    textTransform: 'uppercase',
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', position: 'relative', width: '100%' }}>
      {/* Tagline with gradient */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        style={tagline}
      >
        Crypto payments. Fully compliant.
      </motion.div>

      {/* Subtitle */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
        style={subtitle}
      >
        Built for European businesses.
      </motion.div>
    </div>
  )
}


      




// ═══════════════════════════════════════════════════════════
//  COMMAND CENTER COMPONENTS
// ═══════════════════════════════════════════════════════════
function GasGuard() {
  const [gas, setGas] = useState<number | null>(null)
  useEffect(() => {
    const f = async () => { try { const r = await fetch('https://mainnet.base.org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) }); setGas(parseInt((await r.json()).result, 16) / 1e9) } catch { /* */ } }
    f(); const iv = setInterval(f, 15000); return () => clearInterval(iv)
  }, [])
  const lv = gas === null ? 'unknown' : gas < 0.01 ? 'optimal' : gas < 0.1 ? 'normal' : 'high'
  const cfg: Record<string, { l: string; c: string; i: string }> = { optimal: { l: 'Optimal', c: C.green, i: '⚡' }, normal: { l: 'Normal', c: C.amber, i: '⚠' }, high: { l: 'Suspended', c: C.red, i: '⛔' }, unknown: { l: '—', c: C.dim, i: '?' } }
  const g = cfg[lv]
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 10 }}>Gas Guard</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${g.c}10`, border: `1px solid ${g.c}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{g.i}</div>
        <div>
          <span style={{ fontFamily: C.D, fontSize: 16, fontWeight: 700, color: g.c }}>{gas !== null ? `${gas.toFixed(4)} Gwei` : '—'}</span>
          <span style={{ fontFamily: C.M, fontSize: 8, fontWeight: 600, color: g.c, background: `${g.c}12`, padding: '2px 6px', borderRadius: 4, marginLeft: 6 }}>{g.l}</span>
        </div>
      </div>
    </div>
  )
}

function SmartRouteConfig({ address }: { address: string | undefined }) {
  const [dest, setDest] = useState(''); const [split, setSplit] = useState(false)
  const [pct, setPct] = useState('70'); const [dest2, setDest2] = useState('')
  const [thr, setThr] = useState('0.001'); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false)
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontFamily: C.M, fontSize: 11, outline: 'none' }
  const save = async () => {
    if (!address || !dest.startsWith('0x')) return; setSaving(true)
    try { await fetch(`${BACKEND}/api/v1/forwarding/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_wallet: address, destination_wallet: dest, min_threshold: parseFloat(thr), gas_strategy: 'normal', max_gas_percent: 10, token_symbol: 'ETH', chain_id: 8453, split_enabled: split, split_percent: split ? parseInt(pct) : 100, split_destination: split ? dest2 : null }) }); setSaved(true); setTimeout(() => setSaved(false), 3000) } catch { /* */ }; setSaving(false)
  }
  const ok = dest.startsWith('0x') && !saving
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
      <div style={{ fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 12 }}>Smart Route</div>
      <div style={{ marginBottom: 10 }}><label style={{ fontFamily: C.M, fontSize: 9, color: C.dim, display: 'block', marginBottom: 3 }}>Destination {split && `(${pct}%)`}</label><input value={dest} onChange={e => setDest(e.target.value)} placeholder="0x..." style={inp} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', marginBottom: split ? 10 : 0 }}>
        <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Split Routing</span>
        <button onClick={() => setSplit(s => !s)} style={{ width: 36, height: 20, borderRadius: 10, background: split ? C.green : 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}><div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: split ? 19 : 3, transition: 'left 0.2s' }} /></button>
      </div>
      {split && <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, marginBottom: 10 }}><input type="number" value={pct} onChange={e => setPct(e.target.value)} min="1" max="99" style={{ ...inp, textAlign: 'center' as const, fontSize: 10, padding: '8px' }} /><input value={dest2} onChange={e => setDest2(e.target.value)} placeholder={`Dest 2 (${100 - parseInt(pct || '70')}%)`} style={{ ...inp, fontSize: 10, padding: '8px 10px' }} /></div>}
      <div style={{ marginBottom: 12 }}><label style={{ fontFamily: C.M, fontSize: 9, color: C.dim, display: 'block', marginBottom: 3 }}>Min threshold (ETH)</label><input type="number" value={thr} onChange={e => setThr(e.target.value)} step="0.001" style={inp} /></div>
      <button onClick={save} disabled={!ok} style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: saved ? C.green : ok ? 'linear-gradient(135deg,#3B82F6,#8B5CF6)' : 'rgba(255,255,255,0.04)', color: saved ? '#000' : ok ? '#fff' : C.dim, fontFamily: C.D, fontSize: 13, fontWeight: 700, cursor: ok ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>{saving ? '...' : saved ? '✓ Saved' : 'Activate Route'}</button>
    </div>
  )
}

function ActivityFeed({ address }: { address: string | undefined }) {
  interface L { id: number; destination: string; amount: number; token: string; status: string; tx_hash: string | null; gas_percent: number | null }
  const [logs, setLogs] = useState<L[]>([])
  useEffect(() => { if (!address) return; const ld = () => fetch(`${BACKEND}/api/v1/forwarding/logs?wallet=${address}&limit=6`).then(r => r.ok ? r.json() : null).then(d => { if (d?.logs) setLogs(d.logs) }).catch(() => {}); ld(); const iv = setInterval(ld, 10000); return () => clearInterval(iv) }, [address])
  const sc: Record<string, string> = { pending: C.amber, executing: C.blue, completed: C.green, failed: C.red, gas_too_high: '#FF8C00' }
  if (!logs.length) return (<div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px', textAlign: 'center' as const }}><div style={{ fontSize: 20, marginBottom: 6 }}>📡</div><div style={{ fontFamily: C.D, fontSize: 12, color: C.dim }}>Waiting for transactions</div></div>)
  return (<div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}><div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.1em' }}>Live Activity</div>{logs.map((l, i) => (<div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: i < logs.length - 1 ? `1px solid ${C.border}` : 'none' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: sc[l.status] ?? C.dim, flexShrink: 0 }} /><div style={{ flex: 1, fontFamily: C.M, fontSize: 11, color: C.text }}>{l.amount?.toFixed(4)} {l.token} → {l.destination?.slice(0, 8)}…</div><span style={{ fontFamily: C.M, fontSize: 8, color: sc[l.status] ?? C.dim, textTransform: 'uppercase' as const }}>{l.status}</span>{l.tx_hash && <a href={`https://basescan.org/tx/${l.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: C.M, fontSize: 9, color: C.sub, textDecoration: 'none' }}>↗</a>}</div>))}</div>)
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
      if (!sessionStorage.getItem('rsend_seen')) {
        setShowIntro(true); sessionStorage.setItem('rsend_seen', '1')
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

      {/* Main content — padded below navbar */}
      <main style={{
        minHeight: '100vh',
        paddingTop: 'clamp(100px, 14vh, 160px)',
        paddingBottom: 40, paddingLeft: 16, paddingRight: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        opacity: ready ? 1 : 0, transition: 'opacity 0.8s ease',
      }}>

        {/* Hero */}
        <div style={{ marginBottom: 32, width: '100%', maxWidth: 900 }}>
          <HeroTitle view={view} setView={setView} />
        </div>

        {/* === VIEW SWITCHER / GLASS BAR: Always visible after intro === */}
        {ready && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}
            style={{
              zIndex: 2,
              position: 'relative',
              background: 'rgba(255,255,255,0.03)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16,
              marginBottom: 40,
              padding: '6px 8px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              justifyContent: 'center',
              flexWrap: 'wrap' as const,
              minWidth: 'fit-content',
              maxWidth: '100%',
            }}
          >
            {([
              { key: 'send' as View, label: '↗ Send' },
              { key: 'swap' as View, label: '↗ Swap' },
              { key: 'command' as View, label: '↗ Command Center' },
            ]).map((v) => (
              <motion.button
                key={v.key}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setView(v.key)}
                style={{
                  padding: view === v.key ? '11px 24px' : '11px 20px',
                  borderRadius: 12,
                  border: 'none',
                  background: view === v.key
                    ? `linear-gradient(135deg, ${C.purple} 0%, ${C.blue} 100%)`
                    : 'rgba(255,255,255,0.02)',
                  color: view === v.key ? '#fff' : C.text,
                  opacity: view === v.key ? 1 : 0.6,
                  boxShadow: view === v.key
                    ? `0 4px 16px rgba(139,92,246,0.25)`
                    : 'none',
                  fontFamily: C.D,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  cursor: 'pointer',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  backdropFilter: 'blur(10px)',
                  outline: 'none',
                }}
              >
                {v.label}
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* Content — STABLE CONTAINER with fixed sizing and AnimatePresence mode="wait" */}
        <div style={{
          width: '100%',
          minHeight: 440,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          position: 'relative',
        }}>
          <AnimatePresence mode="wait">
            {view === 'send' && (
              <motion.div
                key="c-send"
                variants={formV}
                initial="enter"
                animate="center"
                exit="exit"
                style={{ width: '100%', maxWidth: 480 }}
              >
                <TransferForm />
              </motion.div>
            )}
            {view === 'swap' && (
              <motion.div
                key="c-swap"
                variants={formV}
                initial="enter"
                animate="center"
                exit="exit"
                style={{ width: '100%', maxWidth: 440 }}
              >
                <SwapModule onSwapComplete={() => {}} />
              </motion.div>
            )}
            {view === 'command' && isConnected && (
              <motion.div
                key="c-cmd"
                variants={formV}
                initial="enter"
                animate="center"
                exit="exit"
                style={{ width: '100%', maxWidth: 800 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <GasGuard />
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontFamily: C.M, fontSize: 9, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 }}>Stats</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <div><div style={{ fontFamily: C.D, fontSize: 18, fontWeight: 700, color: C.text }}>—</div><div style={{ fontFamily: C.M, fontSize: 8, color: C.dim }}>Sweeps today</div></div>
                      <div><div style={{ fontFamily: C.D, fontSize: 18, fontWeight: 700, color: C.text }}>—</div><div style={{ fontFamily: C.M, fontSize: 8, color: C.dim }}>Volume 24h</div></div>
                    </div>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}><SmartRouteConfig address={address} /></div>
                <ActivityFeed address={address} />
              </motion.div>
            )}
            {view === 'command' && !isConnected && (
              <motion.div
                key="c-nocon"
                variants={formV}
                initial="enter"
                animate="center"
                exit="exit"
                style={{ textAlign: 'center', padding: 40, background: C.surface, borderRadius: 20, border: `1px solid ${C.border}`, maxWidth: 380 }}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }}>🔌</div>
                <div style={{ fontFamily: C.D, fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Connect wallet</div>
                <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}>To access RSends Command Center</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, justifyContent: 'center', marginTop: 36 }}>
          {[{ icon: '⚡', label: 'Base L2' }, { icon: '⟠', label: 'Ethereum' }, { icon: '🔷', label: 'Arbitrum' }, { icon: '🔒', label: 'Non-Custodial' }, { icon: '📋', label: 'DAC8' }, { icon: '🔀', label: 'Split Routing' }, { icon: '✓', label: 'VASP Ready', accent: true }].map(b => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: C.M, fontSize: 8, color: b.accent ? C.green : C.dim, background: b.accent ? `${C.green}06` : 'rgba(255,255,255,0.02)', border: `1px solid ${b.accent ? `${C.green}15` : C.border}`, borderRadius: 5, padding: '2px 7px' }}>
              <span>{b.icon}</span><span>{b.label}</span>
            </div>
          ))}
        </div>
      </main>

      <style>{`
        @keyframes rsPulse{0%{transform:scale(1);opacity:.8}50%{transform:scale(1.8);opacity:0}100%{transform:scale(1);opacity:0}}
        @keyframes holoShift{0%{background-position:0% 50%}100%{background-position:200% 50%}}
        @keyframes rsSpin{100%{transform:rotate(360deg)}}
      `}</style>
    </>
  )
}