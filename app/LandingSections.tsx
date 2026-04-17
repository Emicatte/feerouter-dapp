'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const C = {
  bg: '#0a0a0f', surface: '#111118', card: '#16161f',
  border: 'rgba(255,255,255,0.06)', text: '#E2E2F0',
  sub: '#8A8FA8', dim: '#4A4E64', green: '#00D68F', red: '#FF4C6A',
  amber: '#FFB547', blue: '#3B82F6', purple: '#8B5CF6',
  D: 'var(--font-display)', M: 'var(--font-mono)',
  S: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}

const fadeUp = {
  initial: { opacity: 0, y: 30 } as const,
  whileInView: { opacity: 1, y: 0 } as const,
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
}

const cardBase: React.CSSProperties = {
  background: 'rgba(22,22,31,0.5)',
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: 32,
  backdropFilter: 'blur(12px)',
  transition: 'border-color 0.2s, transform 0.2s',
}

function useIsMobile(bp = 768) {
  const [m, setM] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`)
    setM(mq.matches)
    const h = (e: MediaQueryListEvent) => setM(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [bp])
  return m
}

function HoverCard({ children, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        ...cardBase, ...style,
        borderColor: hov ? 'rgba(255,255,255,0.12)' : C.border,
        transform: hov ? 'translateY(-2px)' : 'none',
      }}
      {...rest}
    >{children}</div>
  )
}

function CtaButton({ children, color, outlined, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { color: string; outlined?: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: C.D, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        padding: '10px 24px', borderRadius: 10, transition: 'all 0.2s',
        border: outlined ? `1.5px solid ${color}` : 'none',
        background: outlined ? (hov ? color : 'transparent') : color,
        color: outlined ? (hov ? '#fff' : color) : '#fff',
        opacity: hov ? 1 : (outlined ? 0.9 : 0.95),
        transform: hov ? 'translateY(-1px)' : 'none',
        ...style,
      }}
      {...rest}
    >{children}</button>
  )
}

function IconCode({ color = C.blue, size = 32 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M12 10L6 16L12 22" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M20 10L26 16L20 22" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconGrid({ color = C.purple, size = 32 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect x="5" y="5" width="9" height="9" rx="2" stroke={color} strokeWidth="2"/>
      <rect x="18" y="5" width="9" height="9" rx="2" stroke={color} strokeWidth="2"/>
      <rect x="5" y="18" width="9" height="9" rx="2" stroke={color} strokeWidth="2"/>
      <rect x="18" y="18" width="9" height="9" rx="2" stroke={color} strokeWidth="2"/>
    </svg>
  )
}

interface LandingSectionsProps {
  onOpenDev: () => void
  onOpenBiz: () => void
}

export default function LandingSections({ onOpenDev, onOpenBiz }: LandingSectionsProps) {
  const isMobile = useIsMobile()

  const features_dev = [
    'Create payment intents via API',
    'Receive typed webhooks',
    'Automate treasury flows',
    'Multi-chain EVM + Tron + Solana',
  ]
  const features_biz = [
    'No-code transaction management',
    'Split payments automatically',
    'Route funds across wallets',
    'Real-time tracking & alerts',
  ]

  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <div style={{
        maxWidth: 1100, margin: '0 auto',
        padding: isMobile ? '60px 24px' : '96px 24px',
      }}>
        <motion.div {...fadeUp} style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: C.M, fontSize: 11, fontWeight: 600, color: C.blue,
            letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12,
          }}>CHOOSE YOUR PATH</div>
          <h2 style={{
            fontFamily: C.D, fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 700,
            color: C.text, lineHeight: 1.2, margin: 0, marginBottom: 48,
          }}>
            Build with the API. Or use the UI.{' '}
            <span style={{
              background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>Same engine.</span>
          </h2>
          <div style={{
            display: 'flex', gap: 24,
            flexDirection: isMobile ? 'column' : 'row',
          }}>
            <HoverCard style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ marginBottom: 20 }}><IconCode color={C.blue} /></div>
              <h3 style={{ fontFamily: C.D, fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>For Developers</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
                {features_dev.map(f => (
                  <li key={f} style={{
                    fontFamily: C.S, fontSize: 14, color: C.sub, padding: '6px 0',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.blue, flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>
              <CtaButton color={C.blue} outlined onClick={onOpenDev}>View API Docs →</CtaButton>
            </HoverCard>

            <HoverCard style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ marginBottom: 20 }}><IconGrid color={C.purple} /></div>
              <h3 style={{ fontFamily: C.D, fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>For Businesses</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
                {features_biz.map(f => (
                  <li key={f} style={{
                    fontFamily: C.S, fontSize: 14, color: C.sub, padding: '6px 0',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.purple, flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>
              <CtaButton color={C.purple} outlined onClick={onOpenBiz}>Open Command Center →</CtaButton>
            </HoverCard>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
