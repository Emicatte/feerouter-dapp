'use client'




import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import type { Variants, Transition } from 'framer-motion'
import dynamic from 'next/dynamic'

// STATIC IMPORTS
import TransferForm from './TransferForm'
import SwapModule from './SwapModule'
import AccountHeader from './AccountHeader'
import ComplianceOverlay from './ComplianceOverlay'
import DevelopersOverlay from './DevelopersOverlay'
import PricingOverlay from './PricingOverlay'
import { useSweepWebSocket } from '../lib/useSweepWebSocket'
import { useSweepStats } from '../lib/useSweepStats'
import AntiPhishingSetup from './AntiPhishingSetup'
import { TokenRow } from './TokenSelector'
import { getNativeToken, getTokensForChain, type TokenInfo } from './tokens/tokenRegistry'
import { useTokenBalance } from './hooks/useTokenBalance'
import { useTokenPrices } from './hooks/useTokenPrices'

// Dynamic import — CommandCenter uses Recharts + heavy WebSocket logic
const CommandCenter = dynamic(() => import('./CommandCenter'), {
  ssr: false,
  loading: () => <SkeletonLoader />,
})



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
  S:       '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
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
          <div style={{ width: 52, height: 52, borderRadius: 13, background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', boxShadow: phase >= 2 ? '0 0 50px rgba(139,92,246,0.4)' : 'none' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M13 2L4.5 12.5h5.5l-1 9.5 8.5-11.5h-5.5L13 2z" fill="white" fillOpacity="0.95"/></svg>
          </div>
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
  // ── Mainnet ──
  { id: 1,     name: 'Ethereum',      short: 'ETH',       color: '#627EEA', rpc: 'https://eth.llamarpc.com' },
  { id: 8453,  name: 'Base',          short: 'Base',      color: '#0052FF', rpc: 'https://mainnet.base.org' },
  { id: 42161, name: 'Arbitrum',      short: 'ARB',       color: '#28A0F0', rpc: 'https://arb1.arbitrum.io/rpc' },
  { id: 10,    name: 'Optimism',      short: 'OP',        color: '#FF0420', rpc: 'https://mainnet.optimism.io' },
  { id: 137,   name: 'Polygon',       short: 'POL',       color: '#8247E5', rpc: 'https://polygon-rpc.com' },
  { id: 56,    name: 'BNB Chain',     short: 'BNB',       color: '#F0B90B', rpc: 'https://bsc-dataseed.binance.org' },
  { id: 43114, name: 'Avalanche',     short: 'AVAX',      color: '#E84142', rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  { id: 324,   name: 'ZKsync Era',    short: 'ZK',        color: '#8C8DFC', rpc: 'https://mainnet.era.zksync.io' },
  { id: 42220, name: 'Celo',          short: 'CELO',      color: '#35D07F', rpc: 'https://forno.celo.org' },
  { id: 81457, name: 'Blast',         short: 'BLAST',     color: '#FCFC03', rpc: 'https://rpc.blast.io' },
  // ── Testnet ──
  { id: 84532, name: 'Base Sepolia',  short: 'Sepolia',   color: '#ffb800', rpc: 'https://sepolia.base.org', testnet: true },
]

function NetworkTokenWidget({
  onChainSelect,
  selectedToken,
  onTokenSelect,
  selectedChainId,
  walletAddress,
  tokenBalanceFmt,
  tokenBalanceEur,
  tokenBalanceLoading,
}: {
  onChainSelect?: (chainId: number) => void
  selectedToken: TokenInfo | null
  onTokenSelect: (token: TokenInfo) => void
  selectedChainId: number
  walletAddress?: `0x${string}`
  tokenBalanceFmt: string
  tokenBalanceEur: number | null
  tokenBalanceLoading: boolean
}) {
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const { isConnected } = useAccount()
  const [gas, setGas] = useState<number | null>(null)
  const [openPanel, setOpenPanel] = useState<'chain' | 'token' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const chain = CHAINS.find(c => c.id === chainId) ?? CHAINS[0]
  const isTestnet = !!(chain as typeof CHAINS[number] & { testnet?: boolean }).testnet
  const chainTokens = getTokensForChain(selectedChainId)

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
    if (!openPanel) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpenPanel(null) }
    const t = setTimeout(() => document.addEventListener('mousedown', h), 30)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h) }
  }, [openPanel])

  // Close on ESC
  useEffect(() => {
    if (!openPanel) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenPanel(null) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [openPanel])

  const gasLevel = gas === null ? 'unknown' : gas < 0.02 ? 'low' : gas < 0.1 ? 'med' : 'high'
  const gasColor = gasLevel === 'low' ? C.green : gasLevel === 'med' ? '#ffb800' : gasLevel === 'high' ? '#FF4C6A' : C.dim

  // Format balance for display
  const fmtBal = (() => {
    const v = parseFloat(tokenBalanceFmt || '0')
    if (selectedToken && ['USDC', 'USDT', 'DAI', 'EURC'].includes(selectedToken.symbol))
      return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (selectedToken && ['cbBTC', 'WBTC'].includes(selectedToken.symbol))
      return v.toFixed(6)
    return v.toFixed(4)
  })()

  if (!isConnected) return null

  return (
    <div ref={ref} style={{
      position: 'fixed', top: 68, right: 24, zIndex: 999,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
    }}>
      {/* ── Unified pill: Chain | Token | Gas ────────────── */}
      <div
        className="bf-blur-16"
        style={{
          display: 'flex', alignItems: 'center',
          background: 'rgba(12,12,30,0.85)',
          borderRadius: 14,
          border: `1px solid ${openPanel ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}`,
          transition: 'border-color 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Network section */}
        <button
          onClick={() => setOpenPanel(openPanel === 'chain' ? null : 'chain')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px',
            background: openPanel === 'chain' ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: 'none', cursor: 'pointer', transition: 'background 0.15s',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: chain.color, boxShadow: `0 0 6px ${chain.color}60` }} />
          <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.text }}>{chain.short}</span>
          {isTestnet && (
            <span style={{ fontFamily: C.M, fontSize: 8, fontWeight: 700, color: '#ffb800', background: 'rgba(255,184,0,0.1)', padding: '1px 4px', borderRadius: 3, lineHeight: '1.2' }}>TEST</span>
          )}
          <span style={{ color: C.dim, fontSize: 7 }}>▾</span>
        </button>

        {/* Token section */}
        <button
          onClick={() => setOpenPanel(openPanel === 'token' ? null : 'token')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px 4px 8px',
            background: openPanel === 'token' ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: 'none', cursor: 'pointer', transition: 'background 0.15s',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {selectedToken && (
            <img
              src={selectedToken.logoUrl}
              alt={selectedToken.symbol}
              width={18} height={18}
              style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.08)' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.text }}>
            {selectedToken?.symbol ?? 'Token'}
          </span>
          <span style={{ color: C.dim, fontSize: 7 }}>▾</span>
        </button>

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
      </div>

      {/* ── Balance sub-line ──────────────────────────────── */}
      {selectedToken && !tokenBalanceLoading && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingRight: 4,
        }}>
          <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>
            {fmtBal} {selectedToken.symbol}
          </span>
          {tokenBalanceEur !== null && (
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
              ≈ €{tokenBalanceEur >= 1 ? tokenBalanceEur.toFixed(2) : tokenBalanceEur.toFixed(4)}
            </span>
          )}
        </div>
      )}

      {/* ── Chain dropdown ────────────────────────────────── */}
      <AnimatePresence>
        {openPanel === 'chain' && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            style={{
              position: 'absolute', top: 'calc(100%)', right: 0, zIndex: 100,
              minWidth: 220, maxHeight: 300, overflowY: 'auto' as const, background: '#111120',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 14,
              boxShadow: '0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03)',
            }}
          >
            <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontFamily: C.D, fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Network</span>
            </div>
            {CHAINS.map(c => {
              const active = chainId === c.id
              const test = !!(c as typeof c & { testnet?: boolean }).testnet
              return (
                <button
                  key={c.id}
                  onClick={() => { switchChain({ chainId: c.id }); onChainSelect?.(c.id); setOpenPanel(null) }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
                    border: 'none', cursor: 'pointer', transition: 'background 0.12s',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    textAlign: 'left' as const,
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, boxShadow: `0 0 6px ${c.color}40` }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: active ? C.text : C.sub }}>{c.name}</span>
                    {test && <span style={{ fontFamily: C.M, fontSize: 8, color: '#ffb800', marginLeft: 6 }}>testnet</span>}
                  </div>
                  {active && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: C.M, fontSize: 10, color: gasColor }}>{gas !== null ? gas.toFixed(4) : '—'}</span>
                      <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>gwei</span>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
                    </div>
                  )}
                </button>
              )
            })}
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
      </AnimatePresence>

      {/* ── Token dropdown ────────────────────────────────── */}
      <AnimatePresence>
        {openPanel === 'token' && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            style={{
              position: 'absolute', top: 'calc(100%)', right: 0, zIndex: 100,
              minWidth: 240, background: '#111120',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 14, overflow: 'hidden',
              boxShadow: '0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03)',
            }}
          >
            <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontFamily: C.D, fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Select Token</span>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {chainTokens.map(token => {
                const active = selectedToken?.symbol === token.symbol && selectedToken?.chainId === token.chainId
                return (
                  <TokenRow
                    key={`${token.chainId}-${token.symbol}`}
                    token={token}
                    isSelected={active}
                    walletAddress={walletAddress}
                    onSelect={(t) => { onTokenSelect(t); setOpenPanel(null) }}
                  />
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  LIQUID GLASS NAVBAR
// ═══════════════════════════════════════════════════════════
function Navbar({
  view, setView, activeOverlay, setActiveOverlay, sweeps24h, vol24h, unseenCount,
}: {
  view: View
  setView: (v: View) => void
  activeOverlay: Overlay
  setActiveOverlay: (o: Overlay) => void
  sweeps24h: number
  vol24h: number
  unseenCount: number
}) {
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const links: { key: Overlay; label: string }[] = [
    { key: 'about',      label: 'About' },
    { key: 'how',        label: 'How It Works' },
    { key: 'security',   label: 'Security' },
    { key: 'compliance', label: 'Compliance' },
    { key: 'developers', label: 'Developers' },
    { key: 'pricing',    label: 'Pricing' },
  ]

  return (
    <>
    <nav className="bf-blur-24s" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      height: isMobile ? 52 : 60,
      paddingTop: 'var(--sat, 0px)',
      background: 'linear-gradient(180deg, rgba(10,10,15,0.8) 0%, rgba(10,10,15,0.7) 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: isMobile ? '0 12px' : '0 24px',
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

        {/* Hamburger — mobile only */}
        {isMobile && (
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 8, display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {mobileMenuOpen ? (
                <path d="M4 4L16 16M16 4L4 16" stroke={C.text} strokeWidth="1.5" strokeLinecap="round"/>
              ) : (
                <>
                  <path d="M3 5H17" stroke={C.sub} strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M3 10H17" stroke={C.sub} strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M3 15H17" stroke={C.sub} strokeWidth="1.5" strokeLinecap="round"/>
                </>
              )}
            </svg>
          </button>
        )}

        {/* Center: Menu links */}
        <div className="navbar-center-links" style={{ display: 'flex', gap: 4, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
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

        {/* Right: Stats + Wallet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Live stats pills */}
          {(sweeps24h > 0 || vol24h > 0) && (
            <div className="navbar-right-stats" style={{
              display: 'flex', alignItems: 'center', gap: 2,
              padding: '4px 6px', borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', borderRight: `1px solid ${C.border}` }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.blue, boxShadow: `0 0 4px ${C.blue}50` }} />
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>Sweeps</span>
                <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 700, color: C.text }}>{sweeps24h}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.purple, boxShadow: `0 0 4px ${C.purple}50` }} />
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>Vol 24h</span>
                <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 700, color: C.text }}>{vol24h.toFixed(4)}</span>
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>ETH</span>
              </div>
            </div>
          )}
          <EngineStatus />
          <AccountHeader />
        </div>
    </nav>

    {/* Mobile menu panel */}
    <AnimatePresence>
      {mobileMenuOpen && isMobile && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: EASE }}
          style={{
            position: 'fixed',
            top: 52,
            left: 0, right: 0,
            zIndex: 999,
            background: 'rgba(10,10,15,0.95)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '12px 16px',
            paddingTop: 'calc(12px + var(--sat, 0px))',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}
        >
          {links.map(link => (
            <button
              key={link.key}
              onClick={() => {
                setActiveOverlay(activeOverlay === link.key ? null : link.key)
                setMobileMenuOpen(false)
              }}
              style={{
                padding: '14px 16px', borderRadius: 12, border: 'none',
                background: activeOverlay === link.key ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: activeOverlay === link.key ? C.text : C.sub,
                fontFamily: C.D, fontSize: 14, fontWeight: 500,
                cursor: 'pointer', textAlign: 'left',
                width: '100%',
              }}
            >
              {link.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
    </>
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
function OverlayShell({ active, onClose, children, isMobile }: { active: boolean; onClose: () => void; children: React.ReactNode; isMobile: boolean }) {
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
            className="bf-blur-12"
            style={{
              position: 'fixed', inset: 0, zIndex: 900,
              background: 'rgba(0,0,0,0.5)',
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
              position: 'fixed',
              top: isMobile ? 0 : 72,
              left: isMobile ? 0 : '50%',
              right: isMobile ? 0 : 'auto',
              bottom: isMobile ? 0 : 'auto',
              transform: isMobile ? 'none' : 'translateX(-50%)',
              width: isMobile ? '100%' : '90%',
              maxWidth: isMobile ? '100%' : 700,
              maxHeight: isMobile ? '100%' : 'calc(100vh - 100px)',
              height: isMobile ? '100%' : 'auto',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              zIndex: 950,
              background: C.surface,
              border: isMobile ? 'none' : `1px solid ${C.border}`,
              borderRadius: isMobile ? 0 : 20,
              padding: isMobile ? '16px 16px 32px' : '32px 36px',
              paddingTop: isMobile ? 'calc(16px + var(--sat, 0px))' : '32px',
              boxShadow: isMobile ? 'none' : '0 40px 100px rgba(0,0,0,0.6)',
            }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                position: isMobile ? 'fixed' : 'absolute',
                top: isMobile ? 'calc(12px + var(--sat, 0px))' : 16,
                right: 16,
                width: isMobile ? 40 : 32,
                height: isMobile ? 40 : 32,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${C.border}`, color: C.dim,
                cursor: 'pointer', fontSize: isMobile ? 18 : 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                zIndex: 10,
              }}
            >✕</button>
            <div className="overlay-content">
              {children}
            </div>
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
        style={{ fontFamily: C.D, fontSize: 24, fontWeight: 600, color: C.text, marginBottom: 24, lineHeight: 1.3 }}
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
          'I built RSends because I got tired of watching European businesses struggle with crypto payments. Either you use a centralized gateway that holds your funds hostage, or you go full DeFi and pray the taxman doesn\'t knock.',
          'Every transaction goes through a compliance Oracle before anything moves on-chain. Not a post-hoc audit. Not a checkbox. Actual pre-execution verification, enforced at the smart contract level.',
          'Base L2 keeps gas under $0.05. Settlement in 2 seconds. DAC8 reporting built in from day one. Because in this space, "we\'ll add compliance later" is how companies get shut down.',
        ].map((p, i) => (
          <motion.p
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 + i * 0.15, duration: 0.5, ease: EASE }}
            style={{ fontFamily: C.S, fontSize: 13, color: C.sub, lineHeight: 1.7, marginBottom: 14 }}
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
          <div style={{ fontFamily: C.S, fontSize: 13, color: C.sub, lineHeight: 1.6, marginBottom: 14 }}>
            One person, full stack. Solidity contracts, React frontend, FastAPI backend, compliance engine. No team of 50 — just obsessive attention to getting payments right.
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
      n: '01', title: 'Connect', desc: 'Plug in your wallet. MetaMask, WalletConnect, Coinbase — whatever you use. No sign-up, no API keys.',
      detail: 'RSends uses wagmi v2 with RainbowKit. Once connected, the app detects your chain (Base, Ethereum, Arbitrum) and configures the contract interface automatically. Zero registration friction.',
    },
    {
      n: '02', title: 'Verify', desc: 'The compliance Oracle checks your transaction and signs off with an EIP-712 attestation. If it doesn\'t pass, nothing moves.',
      detail: 'Before any funds move, the Oracle performs AML screening, DAC8 reporting checks, and MiCA compliance verification. It returns a typed EIP-712 signature that the smart contract independently verifies on-chain. No trust assumptions.',
    },
    {
      n: '03', title: 'Execute', desc: 'FeeRouterV4 verifies the signature, splits the payment (99.5% recipient, 0.5% protocol), settles in ~2 seconds.',
      detail: 'The contract checks the Oracle signature on-chain, executes split routing, and emits events for the DAC8 reporting engine. Final settlement on Base L2, gas under $0.05.',
    },
  ]

  const advancedFlows = [
    { title: 'Swap & Forward', desc: 'Pay in ETH, recipient gets USDC. Automatic DEX routing with compliance.' },
    { title: 'Auto-Split', desc: 'Programmable treasury routing — split payments across multiple wallets.' },
    { title: 'Sweeper', desc: 'Auto-forward incoming funds to configured destinations based on rules.' },
    { title: 'DAC8 Reports', desc: 'Generate fiscal XML reports on demand for any transaction period.' },
  ]

  return (
    <div>
      <h2 style={{ fontFamily: C.D, fontSize: 22, fontWeight: 600, color: C.text, marginBottom: 4 }}>
        How It <span style={GRAD}>Works</span>
      </h2>
      <p style={{ fontFamily: C.S, fontSize: 13, color: C.dim, marginBottom: 28 }}>
        Three steps. Connect, verify, settle. That's it.
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
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontFamily: C.D, fontSize: 16, fontWeight: 600, color: C.text }}>{s.title}</span>
                </div>
                <p style={{ fontFamily: C.S, fontSize: 12, color: C.sub, lineHeight: 1.6, marginBottom: 8 }}>{s.desc}</p>

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
              style={{
                padding: '16px', borderRadius: 14,
                background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
                cursor: 'default',
                gridColumn: i === 0 ? '1 / -1' : undefined,
              }}
            >
              <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontFamily: C.S, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{f.desc}</div>
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
    { title: 'Blockchain Foundation', desc: 'Base L2 with Ethereum settlement finality', tag: 'L1', color: C.blue, detail: 'Transactions execute on Base L2 for minimal gas costs (~$0.01), with full security inherited from Ethereum L1. Settlement finality via Optimism Bedrock.' },
    { title: 'Infrastructure', desc: 'HMAC-SHA256, rate limiting, SSL termination', tag: 'L2', color: C.amber, detail: 'All API requests are HMAC-SHA256 signed. Rate limiting at both API and transaction level. Nginx SSL termination at the edge. Monitored around the clock.' },
    { title: 'Smart Contract', desc: 'ReentrancyGuard, OpenZeppelin, FeeRouterV4', tag: 'L3', color: C.purple, detail: 'FeeRouterV4.sol inherits from OpenZeppelin\'s ReentrancyGuard and Ownable. All state-changing functions are protected. Contract verified on Basescan.' },
    { title: 'Compliance Engine', desc: 'EIP-712 Oracle, AML/DAC8/MiCA screening', tag: 'L4', color: C.green, detail: 'Every transaction requires a valid EIP-712 typed signature from the compliance Oracle. Screens against AML databases, verifies DAC8 reporting, ensures MiCA compliance. Nothing moves without it.' },
    { title: 'Monitoring', desc: 'Sentry, Prometheus, Z-score anomaly detection', tag: 'L5', color: '#FF4C6A', detail: 'Real-time error tracking, metrics collection, and custom Z-score anomaly detection. Unusual transaction patterns get flagged instantly.' },
  ]

  const features = [
    { title: 'Oracle-Gated TX', desc: 'Every transaction needs cryptographic approval from the compliance Oracle before execution. No exceptions.' },
    { title: 'On-Chain Verification', desc: 'The smart contract verifies Oracle signatures independently. Verify, don\'t trust.' },
    { title: 'Anomaly Detection', desc: 'Z-score statistical analysis flags transactions deviating from normal patterns in real-time.' },
    { title: 'Rate Limiting', desc: 'API and transaction-level rate limiting. Abuse gets blocked before it reaches the contract.' },
    { title: 'HMAC Integrity', desc: 'All backend communications are HMAC-SHA256 signed. Tampered requests get rejected.' },
    { title: 'Infrastructure Security', desc: 'SSL termination, Docker isolation, automated backups, least-privilege access. Standard ops.' },
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: EASE }}
            style={{ fontFamily: C.S, fontSize: 14, color: C.sub, lineHeight: 1.6, maxWidth: 480, margin: '0 auto', marginBottom: 8 }}
          >
            Most DeFi protocols bolt on security after the fact. We architected RSends around compliance and safety from the first commit.
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.6, ease: EASE }}
            style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}
          >
            Five layers. No shortcuts.
          </motion.div>
        </div>
      </motion.div>

      <h2 style={{ fontFamily: C.D, fontSize: 22, fontWeight: 600, color: C.text, marginBottom: 4 }}>
        <span style={GRAD}>Security</span> Architecture
      </h2>
      <p style={{ fontFamily: C.S, fontSize: 13, color: C.dim, marginBottom: 28 }}>
        How we keep your funds and data safe — layer by layer.
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
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: C.M, fontSize: 11, fontWeight: 700, color: layer.color,
                }}>
                  {layer.tag}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 600, color: C.text }}>{layer.title}</div>
                  <div style={{ fontFamily: C.S, fontSize: 11, color: C.dim }}>{layer.desc}</div>
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
              style={{
                padding: '16px', borderRadius: 14,
                background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
                cursor: 'default',
                gridColumn: i === 0 ? '1 / -1' : undefined,
              }}
            >
              <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>{f.title}</div>
              <div style={{ fontFamily: C.S, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{f.desc}</div>
            </motion.div>
          ))}
        </div>
        {/* Technical note — breaks visual symmetry */}
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8,
          borderLeft: `2px solid ${C.blue}30`,
          background: 'rgba(255,255,255,0.015)',
        }}>
          <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
            // FeeRouterV4.sol — all state-changing functions inherit ReentrancyGuard.
            <br />// Oracle signatures verified on-chain via ecrecover. No off-chain trust.
          </div>
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
          Contract verified on Basescan →
        </a>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  HERO TITLE — AnimatePresence mode="wait" for no overlap
// ═══════════════════════════════════════════════════════════

function HeroTitle({ view, setView, isMobile }: { view: View; setView: (v: View) => void; isMobile?: boolean }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', position: 'relative', width: '100%' }}>
      {/* Tagline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="hero-title"
        style={{
          fontFamily: C.D,
          fontSize: isMobile ? 'clamp(20px, 6vw, 28px)' : 'clamp(40px, 6.0vw, 58px)',
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

      {/* Subtitle — hidden on mobile */}
      {!isMobile && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
          className="hero-subtitle"
          style={{
            fontFamily: C.S,
            fontSize: 'clamp(12px, 1.5vw, 20px)',
            fontWeight: 400,
            letterSpacing: '0.02em',
            textAlign: 'center',
            color: C.sub,
            marginBottom: 1,
          }}
        >
          Built for European Businesses
        </motion.div>
      )}

      {/* CTA removed — wallet connection via navbar button */}
    </div>
  )
}


      





// ═══════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const [view, setView] = useState<View>('send')
  const [activeOverlay, setActiveOverlay] = useState<Overlay>(null)
  const [showIntro, setShowIntro] = useState(false)
  const [ready, setReady] = useState(false)
  const [showAntiPhishing, setShowAntiPhishing] = useState(false)
  const [isMobileHome, setIsMobileHome] = useState(false)
  useEffect(() => {
    const check = () => setIsMobileHome(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── Multi-token/chain selector state ──────────────────────────────────
  const [selectedChainId, setSelectedChainId] = useState<number>(chainId)
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(
    () => getNativeToken(chainId) ?? null,
  )
  // Sync when wallet chain changes
  useEffect(() => {
    setSelectedChainId(chainId)
    setSelectedToken(getNativeToken(chainId) ?? null)
  }, [chainId])

  // ── Selected token balance + EUR for inline display ────────────────
  const { balance: selTokenBal, formatted: selTokenFmt, isLoading: selTokenLoading } = useTokenBalance(selectedToken, address)
  const { prices: tokenPricesPage } = useTokenPrices()
  const selTokenEur = selectedToken && tokenPricesPage[selectedToken.coingeckoId]?.eur
    ? parseFloat(selTokenFmt) * tokenPricesPage[selectedToken.coingeckoId].eur
    : null

  // Sweep stats for top bar
  const { daily } = useSweepStats(address)
  const today = daily.length > 0 ? daily[daily.length - 1] : null
  const sweeps24h = today?.sweep_count ?? 0
  const vol24h = today?.volume_eth ?? 0

  // Track unseen sweep events for Command Center badge
  const { events: sweepEvents } = useSweepWebSocket(address)
  const [unseenCount, setUnseenCount] = useState(0)
  const lastSeenRef = useRef(0)

  // Increment unseen when new events arrive and user isn't on command tab
  useEffect(() => {
    if (sweepEvents.length > lastSeenRef.current) {
      if (view !== 'command') {
        setUnseenCount(prev => prev + (sweepEvents.length - lastSeenRef.current))
      }
      lastSeenRef.current = sweepEvents.length
    }
  }, [sweepEvents.length, view])

  // Reset unseen count when switching to command view
  useEffect(() => {
    if (view === 'command') {
      setUnseenCount(0)
      lastSeenRef.current = sweepEvents.length
    }
  }, [view, sweepEvents.length])

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
        <div className="rp-bg__base" />
        <div className="rp-orb rp-orb--1" style={{ opacity: 1 }} />
        <div className="rp-orb rp-orb--2" style={{ opacity: 1 }} />
        <div className="rp-orb rp-orb--3" style={{ opacity: 1 }} />
        <div className="rp-orb rp-orb--4" style={{ opacity: 1 }} />
        <div className="rp-orb rp-orb--5" style={{ opacity: 1 }} />
         <div className="rp-orb rp-orb--9" style={{ opacity: 2 }} />
        <div className="rp-orb rp-orb--6" style={{ opacity: 0.65 }} />
        <div className="rp-orb rp-orb--7" style={{ opacity: 0.55 }} />
        <div className="rp-orb rp-orb--8" style={{ opacity: 0.50 }} />
        <div className="rp-bg__noise" />
      </div>

      {/* Navbar */}
      <Navbar view={view} setView={setView} activeOverlay={activeOverlay} setActiveOverlay={setActiveOverlay} sweeps24h={sweeps24h} vol24h={vol24h} unseenCount={unseenCount} />

      {/* Network + Token + Gas — fixed top-right below navbar */}
      {ready && !isMobileHome && (
        <NetworkTokenWidget
          onChainSelect={(cid) => {
            setSelectedChainId(cid)
            setSelectedToken(getNativeToken(cid) ?? null)
          }}
          selectedToken={selectedToken}
          onTokenSelect={setSelectedToken}
          selectedChainId={selectedChainId}
          walletAddress={address}
          tokenBalanceFmt={selTokenFmt}
          tokenBalanceEur={selTokenEur}
          tokenBalanceLoading={selTokenLoading}
        />
      )}

      {/* Overlays */}
      <OverlayShell isMobile={isMobileHome} active={activeOverlay === 'about'} onClose={() => setActiveOverlay(null)}>
        <AboutOverlay />
      </OverlayShell>
      <OverlayShell isMobile={isMobileHome} active={activeOverlay === 'how'} onClose={() => setActiveOverlay(null)}>
        <HowOverlay />
      </OverlayShell>
      <OverlayShell isMobile={isMobileHome} active={activeOverlay === 'security'} onClose={() => setActiveOverlay(null)}>
        <SecurityOverlay />
      </OverlayShell>
      <OverlayShell isMobile={isMobileHome} active={activeOverlay === 'compliance'} onClose={() => setActiveOverlay(null)}>
        <ComplianceOverlay />
      </OverlayShell>
      <OverlayShell isMobile={isMobileHome} active={activeOverlay === 'developers'} onClose={() => setActiveOverlay(null)}>
        <DevelopersOverlay />
      </OverlayShell>
      <OverlayShell isMobile={isMobileHome} active={activeOverlay === 'pricing'} onClose={() => setActiveOverlay(null)}>
        <PricingOverlay />
      </OverlayShell>

      {/* Main content — padded below navbar */}
      <main className="main-content" style={{
        minHeight: '100dvh',
        paddingTop: isMobileHome ? '60px' : 'clamp(80px, 12vh, 140px)',
        paddingBottom: `calc(60px + var(--sab, 0px))`, paddingLeft: 16, paddingRight: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        opacity: ready ? 1 : 0, transition: 'opacity 0.9s ease',
      }}>

        {/* Hero */}
        <div style={{ marginBottom: isMobileHome ? 8 : 28, width: '100%', maxWidth: 900 }}>
          <HeroTitle view={view} setView={setView} isMobile={isMobileHome} />
        </div>

        {/* === TAB SWITCHER — sliding pill indicator === */}
        {ready && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: SPRING, delay: 0.15 }}
            className="tab-switcher bf-blur-16"
            style={{
              zIndex: 2,
              position: 'relative',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 18,
              marginBottom: isMobileHome ? 6 : 28,
              padding: isMobileHome ? '3px 4px' : '5px 6px',
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
                  padding: isMobileHome ? '7px 12px' : '10px 22px',
                  borderRadius: 13,
                  border: 'none',
                  background: 'transparent',
                  color: view === v.key ? '#fff' : 'rgba(255,255,255,0.45)',
                  fontFamily: C.D,
                  fontSize: isMobileHome ? 11 : 13,
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
                <span style={{ position: 'relative', zIndex: 1 }}>
                  <span className="tab-label-full">{v.label}</span>
                  <span className="tab-label-short">
                    {v.key === 'send' ? '↗ Send' : v.key === 'swap' ? '↗ Swap' : '↗ CMD'}
                  </span>
                </span>
                {/* Notification badge for Command Center */}
                {v.key === 'command' && unseenCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    style={{
                      position: 'absolute', top: 4, right: 6,
                      minWidth: 16, height: 16, borderRadius: 8,
                      background: '#FF4C6A',
                      color: '#fff', fontFamily: C.M, fontSize: 9, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 4px',
                      boxShadow: '0 0 8px rgba(255,76,106,0.5)',
                      zIndex: 2,
                    }}
                  >
                    {unseenCount > 99 ? '99+' : unseenCount}
                  </motion.span>
                )}
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* WidgetContainer — sempre montato, sfondo vetro fisso, cross-fade CSS puro */}
        <div className="widget-container bf-blur-32s" style={{
          width: '100%',
          maxWidth: 480,
          background: 'rgba(8,12,30,0.72)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: isMobileHome ? 16 : 20,
          boxShadow: '0 8px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.15)',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {/* Send — always mounted */}
          <div style={view === 'send' ? panelActive : panelHidden}>
            <TransferForm noCard externalToken={selectedToken} />
          </div>

          {/* Swap — always mounted */}
          <div style={view === 'swap' ? panelActive : panelHidden}>
            <SwapModule noCard onSwapComplete={() => {}} />
          </div>

          {/* Command Center — always mounted */}
          <div style={view === 'command' ? panelActive : panelHidden}>
            <CommandCenter ownerAddress={address} chainId={chainId} isVisible={view === 'command'} />
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
        <div className="footer-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32, marginBottom: 36 }}>
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
              { label: '🔑 Anti-Phishing', action: () => setShowAntiPhishing(true) },
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
            Verified
          </a>
        </div>
      </footer>

      {/* Anti-Phishing Setup Modal */}
      <AntiPhishingSetup
        isOpen={showAntiPhishing}
        onClose={() => setShowAntiPhishing(false)}
        onSave={(code) => {
          localStorage.setItem('rsend_antiphishing_code', code)
          setShowAntiPhishing(false)
        }}
      />

      <style>{`
        @keyframes rsPulse{0%{transform:scale(1);opacity:.8}50%{transform:scale(1.8);opacity:0}100%{transform:scale(1);opacity:0}}
        @keyframes holoShift{0%{background-position:0% 50%}100%{background-position:200% 50%}}
        @keyframes rsSpin{100%{transform:rotate(360deg)}}
        @keyframes rpCtaPulse{0%,100%{transform:scale(1);box-shadow:0 4px 24px rgba(59,130,246,0.3)}50%{transform:scale(1.02);box-shadow:0 6px 32px rgba(59,130,246,0.45)}}
      `}</style>
    </>
  )
}