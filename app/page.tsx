'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'

const TransferForm = dynamic(() => import('./TransferForm'), { ssr: false })

// ── Bubble data ────────────────────────────────────────────────────────────
const BUBBLES = [
  { x: 0.08, y: 0.12, r: 65, colors: ['#ff6b6b','#ffd93d','#6bcb77'], angle: 0 },
  { x: 0.22, y: 0.18, r: 42, colors: ['#4d96ff','#845ef7'],            angle: 1 },
  { x: 0.04, y: 0.65, r: 55, colors: ['#6bcb77','#4d96ff'],            angle: 2 },
  { x: 0.16, y: 0.75, r: 48, colors: ['#ff6b9d','#c77dff'],            angle: 3 },
  { x: 0.88, y: 0.08, r: 72, colors: ['#4d96ff','#00b4d8'],            angle: 4 },
  { x: 0.92, y: 0.40, r: 38, colors: ['#845ef7','#c77dff','#4d96ff'],  angle: 5 },
  { x: 0.85, y: 0.60, r: 50, colors: ['#00b4d8','#4d96ff'],            angle: 6 },
  { x: 0.92, y: 0.85, r: 36, colors: ['#6bcb77','#ffd93d'],            angle: 7 },
  { x: 0.45, y: 0.90, r: 40, colors: ['#c77dff','#4d96ff'],            angle: 8 },
  { x: 0.48, y: 0.48, r: 28, colors: ['#ff6b9d','#845ef7'],            angle: 9 },
]

// ── Bubble canvas component ────────────────────────────────────────────────
function BubbleCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let W = 0, H = 0, raf = 0

    const blobs: Array<{cx:number;cy:number;ox:number;oy:number;r:number;colors:string[];angle:number;t:number}> = []

    const init = () => {
      W = window.innerWidth
      H = window.innerHeight
      canvas.width  = W
      canvas.height = H
      blobs.length = 0
      BUBBLES.forEach(b => blobs.push({
        cx: b.x * W, cy: b.y * H,
        ox: b.x * W, oy: b.y * H,
        r: b.r, colors: b.colors, angle: b.angle,
        t: Math.random() * Math.PI * 2,
      }))
    }

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      blobs.forEach(b => {
        b.t += 0.004
        b.cx = b.ox + Math.sin(b.t + b.angle) * 28
        b.cy = b.oy + Math.cos(b.t * 0.7 + b.angle) * 22
        const grad = ctx.createRadialGradient(b.cx - b.r*0.3, b.cy - b.r*0.3, b.r*0.05, b.cx, b.cy, b.r)
        b.colors.forEach((c, i) => grad.addColorStop(i / Math.max(b.colors.length - 1, 1), c))
        ctx.filter = 'blur(2px)'
        ctx.beginPath()
        ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.globalAlpha = 0.8
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.filter = 'none'
      })
      raf = requestAnimationFrame(draw)
    }

    const onResize = () => { cancelAnimationFrame(raf); init(); draw() }
    window.addEventListener('resize', onResize)
    init(); draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize) }
  }, [])

  return <canvas ref={ref} style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:0 }} />
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Home() {
  const { isConnected, address } = useAccount()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <div style={{ minHeight:'100vh', overflowX:'hidden', position:'relative' }}>
      <BubbleCanvas />

      {/* Header */}
      <header className="animate-slide-down" style={{
        position: 'relative', zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 28px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(24px)',
        background: 'rgba(6,0,8,0.75)',
      }}>
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{
            width:32, height:32, borderRadius:10,
            background:'linear-gradient(135deg,#ff007a,#c77dff)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16, boxShadow:'0 0 20px rgba(255,0,122,0.4)',
          }}>⚡</div>
          <span style={{ fontSize:17, fontWeight:800, letterSpacing:'-0.03em' }}>FeeRouter</span>
          <span style={{
            fontSize:11, fontWeight:600, padding:'2px 9px', borderRadius:20,
            background:'rgba(255,0,122,0.12)', color:'#ff9dc8',
            border:'1px solid rgba(255,0,122,0.25)', fontFamily:'var(--font-mono)',
          }}>Base</span>
        </div>

        {/* Nav */}
        <nav style={{ display:'flex', gap:2 }}>
          {['Trade','Explore','Pool','Portfolio'].map((item, i) => (
            <button key={item} style={{
              padding:'7px 14px', borderRadius:12, border:'none',
              background: i === 0 ? 'rgba(255,255,255,0.07)' : 'transparent',
              color: i === 0 ? '#fff' : '#6b7280',
              fontFamily:'var(--font-display)', fontSize:14, fontWeight:600,
              cursor:'pointer',
            }}>
              {item}
            </button>
          ))}
        </nav>

        {/* Search */}
        <div style={{
          display:'flex', alignItems:'center', gap:8,
          padding:'8px 16px', borderRadius:16,
          background:'rgba(18,1,15,0.8)', border:'1px solid rgba(255,255,255,0.07)',
          color:'#6b7280', fontFamily:'var(--font-mono)', fontSize:13, width:240,
        }}>
          <span>🔍</span>
          <span>Search tokens, pools...</span>
          <span style={{ marginLeft:'auto', background:'rgba(255,255,255,0.08)', borderRadius:5, padding:'1px 6px', fontSize:11 }}>/</span>
        </div>

        {/* Right */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button style={{
            padding:'8px 16px', borderRadius:14,
            border:'1px solid rgba(255,255,255,0.07)', background:'transparent',
            color:'#fff', fontFamily:'var(--font-display)', fontSize:13, fontWeight:600, cursor:'pointer',
          }}>Get the app</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </header>

      {/* Main */}
      <main style={{
        position:'relative', zIndex:5,
        display:'flex', flexDirection:'column', alignItems:'center',
        padding:'60px 20px 100px',
      }}>
        {/* Hero */}
        <h1 className="animate-fade-up-1" style={{
          fontSize:'clamp(3rem,8vw,5.5rem)',
          fontWeight:800, letterSpacing:'-0.04em',
          textAlign:'center', lineHeight:1.0,
          marginBottom:52,
        }}>
          Send{' '}
          <span style={{ background:'linear-gradient(135deg,#ff007a,#c77dff,#4d96ff)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
            anytime,
          </span>
          <br />anywhere.
        </h1>

        {/* Card */}
        <div className="animate-fade-up-2" style={{ width:'100%', maxWidth:464 }}>
          {!isConnected ? <DisconnectedCard /> : <TransferForm />}
        </div>

        {/* Subtitle */}
        <p className="animate-fade-up-3" style={{
          marginTop:20, fontSize:14, color:'#6b7280',
          textAlign:'center', fontFamily:'var(--font-mono)',
        }}>
          Invia crypto con{' '}
          <span style={{ color:'#ff007a' }}>fee splitting automatico</span>
          {' '}su Base Network.
        </p>
      </main>
    </div>
  )
}

// ── Disconnected card ──────────────────────────────────────────────────────
function DisconnectedCard() {
  const S = {
    card: { borderRadius:28, background:'#12010f', border:'1px solid rgba(255,255,255,0.07)', overflow:'hidden', boxShadow:'0 24px 80px rgba(0,0,0,0.6)' },
    box: { borderRadius:20, background:'#1c0118', padding:'16px 18px' },
    row: { display:'flex', alignItems:'center', justifyContent:'space-between' } as React.CSSProperties,
  }

  return (
    <div style={S.card}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 20px 10px' }}>
        <span style={{ fontSize:16, fontWeight:700 }}>Invia</span>
        <button style={{ width:34, height:34, borderRadius:12, background:'transparent', border:'none', color:'#6b7280', cursor:'pointer', fontSize:16 }}>⚙</button>
      </div>
      <div style={{ padding:'0 8px' }}>
        {/* Sell */}
        <div style={S.box}>
          <div style={{ ...S.row, marginBottom:8 }}>
            <span style={{ color:'#6b7280', fontSize:13, fontWeight:600 }}>Sell</span>
<span style={{ fontSize:12, color:'#6b7280', fontFamily:'var(--font-mono)' }}>0.00257 ETH</span>          </div>
          <div style={S.row}>
            <span style={{ fontSize:'2.5rem', fontWeight:300, letterSpacing:'-0.03em', color:'#3f4451' }}>0</span>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 13px 9px 9px', borderRadius:18, background:'#261020', border:'1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ width:24, height:24, borderRadius:'50%', background:'#627EEA', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 }}>⬡</div>
              <span style={{ fontSize:14, fontWeight:700 }}>ETH</span>
              <span style={{ color:'#6b7280', fontSize:10 }}>▾</span>
            </div>
          </div>
          <div style={{ marginTop:6, color:'#6b7280', fontFamily:'var(--font-mono)', fontSize:13 }}>$0</div>
        </div>

        {/* Arrow */}
        <div style={{ display:'flex', justifyContent:'center', margin:'6px 0' }}>
          <div style={{ width:36, height:36, borderRadius:12, background:'#12010f', border:'2px solid #1c0118', display:'flex', alignItems:'center', justifyContent:'center', color:'#6b7280', fontSize:16 }}>↓</div>
        </div>

        {/* Receive */}
        <div style={S.box}>
          <div style={{ ...S.row, marginBottom:8 }}>
            <span style={{ color:'#6b7280', fontSize:13, fontWeight:600 }}>Receive</span>
            <span style={{ fontSize:11, padding:'2px 9px', borderRadius:20, background:'rgba(255,0,122,0.12)', color:'#ff9dc8', border:'1px solid rgba(255,0,122,0.2)', fontFamily:'var(--font-mono)', fontWeight:600 }}>Auto · 0.5% fee</span>
          </div>
          <div style={S.row}>
            <span style={{ fontSize:'2.5rem', fontWeight:300, color:'#3f4451' }}>0</span>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 13px', borderRadius:18, background:'rgba(255,0,122,0.1)', border:'1px solid rgba(255,0,122,0.2)' }}>
              <div style={{ width:24, height:24, borderRadius:'50%', background:'#627EEA', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 }}>⬡</div>
              <span style={{ fontSize:14, fontWeight:700, color:'#ff9dc8' }}>ETH</span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding:'8px 0 4px' }}>
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button onClick={openConnectModal} style={{
                width:'100%', padding:'17px', borderRadius:22, border:'none',
                background:'linear-gradient(135deg,#ff007a,#ff6b9d)',
                color:'white', fontFamily:'var(--font-display)', fontSize:17, fontWeight:700,
                letterSpacing:'-0.01em', cursor:'pointer',
                boxShadow:'0 4px 28px rgba(255,0,122,0.4)',
              }}>
                Connetti wallet
              </button>
            )}
          </ConnectButton.Custom>
        </div>

        <div style={{ display:'flex', justifyContent:'center', gap:20, padding:'10px 0 14px', fontFamily:'var(--font-mono)', fontSize:11, color:'#3f4451' }}>
          <span>🔒 Non-custodial</span>
          <span>⚡ Base Network</span>
          <span>🧮 BigInt</span>
        </div>
      </div>
    </div>
  )
}