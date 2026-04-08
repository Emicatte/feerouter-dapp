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
// Overlays — lazy loaded (only when user opens menu)
const AboutOverlay = dynamic(() => import('./overlays/AboutOverlay'), { ssr: false })
const HowOverlay = dynamic(() => import('./overlays/HowOverlay'), { ssr: false })
const SecurityOverlay = dynamic(() => import('./overlays/SecurityOverlay'), { ssr: false })
const ComplianceOverlay = dynamic(() => import('./overlays/ComplianceOverlay'), { ssr: false })
const DevelopersOverlay = dynamic(() => import('./overlays/DevelopersOverlay'), { ssr: false })
const PricingOverlay = dynamic(() => import('./overlays/PricingOverlay'), { ssr: false })
import { useSweepWebSocket } from '../lib/useSweepWebSocket'
import { useSweepStats } from '../lib/useSweepStats'
import AntiPhishingSetup from './AntiPhishingSetup'
import { TokenRow } from './TokenSelector'
import { getNativeToken, getTokensForChain, type TokenInfo } from './tokens/tokenRegistry'
import { useTokenBalance } from './hooks/useTokenBalance'
import { useTokenPrices } from './hooks/useTokenPrices'
import { ChainFamilySwitch } from '../components/shared/ChainFamilySwitch'
import { useUniversalWallet } from '../hooks/useUniversalWallet'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { ToastContainer } from '../components/shared/Toast'

// Dynamic import — CommandCenter uses Recharts + heavy WebSocket logic
const CommandCenter = dynamic(() => import('./command-center'), {
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
  const wallet = useUniversalWallet()
  const isEvmActive = wallet.activeFamily === 'evm'

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
      {/* ── Chain family switch: EVM / Solana / Tron ──────── */}
      <ChainFamilySwitch
        active={wallet.activeFamily}
        onSelect={wallet.setActiveFamily}
        connections={wallet.connections}
      />

      {/* ── Non-EVM wallet address display ───────────────── */}
      {!isEvmActive && (
        <div
          className="bf-blur-16"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(12,12,30,0.85)',
            borderRadius: 14, padding: '8px 14px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {wallet.activeAddress ? (
            <>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#00D68F', boxShadow: '0 0 6px #00D68F60',
              }} />
              <span style={{ fontFamily: C.M, fontSize: 11, color: C.text }}>
                {wallet.activeAddress.display}
              </span>
              <span style={{ fontFamily: C.D, fontSize: 10, color: C.dim, textTransform: 'uppercase' }}>
                {wallet.activeFamily}
              </span>
            </>
          ) : (
            <span style={{ fontFamily: C.D, fontSize: 11, color: C.dim }}>
              Connect {wallet.activeFamily === 'solana' ? 'Phantom' : 'TronLink'} to continue
            </span>
          )}
        </div>
      )}

      {/* ── Unified pill: Chain | Token | Gas (EVM only) ──── */}
      {isEvmActive && <div
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
      </div>}

      {/* ── Balance sub-line (EVM only) ───────────────────── */}
      {isEvmActive && selectedToken && !tokenBalanceLoading && (
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

      {/* ── Chain dropdown (EVM only) ─────────────────────── */}
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
      <ToastContainer />
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
            <ErrorBoundary module="TransferForm">
              <TransferForm noCard externalToken={selectedToken} />
            </ErrorBoundary>
          </div>

          {/* Swap — always mounted */}
          <div style={view === 'swap' ? panelActive : panelHidden}>
            <ErrorBoundary module="SwapModule">
              <SwapModule noCard onSwapComplete={() => {}} />
            </ErrorBoundary>
          </div>

          {/* Command Center — always mounted */}
          <div style={view === 'command' ? panelActive : panelHidden}>
            <ErrorBoundary module="CommandCenter">
              <CommandCenter ownerAddress={address} chainId={chainId} isVisible={view === 'command'} />
            </ErrorBoundary>
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