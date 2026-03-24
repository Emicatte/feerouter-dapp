'use client'

/**
 * page.tsx — RSend v3
 *
 * Premium intro: canvas particles → logo coalescence → holographic text
 * Cinematic hero transitions Send↔Swap with correct text states
 * Fluid form transitions
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAccount, useChainId } from 'wagmi'

const TransferForm  = dynamic(() => import('./TransferForm'),  { ssr: false })
const AccountHeader = dynamic(() => import('./AccountHeader'), { ssr: false })
const SwapModule    = dynamic(() => import('./SwapModule'),     { ssr: false })

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

const C = {
  bg:'#0a0a0f', surface:'#111118', card:'#16161f',
  border:'rgba(255,255,255,0.06)', text:'#E2E2F0', sub:'#8A8FA8',
  dim:'#4A4E64', green:'#00D68F', red:'#FF4C6A', amber:'#FFB547',
  blue:'#3B82F6', purple:'#8B5CF6',
  D:'var(--font-display)', M:'var(--font-mono)',
}

type View = 'send' | 'swap' | 'command'

const GRAD: React.CSSProperties = {
  background:'linear-gradient(135deg, #FF4C6A 0%, #8B5CF6 100%)',
  WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
  backgroundClip:'text' as 'text',
}

// ═══════════════════════════════════════════════════════════
//  PARTICLE INTRO — canvas-based, first visit only
// ═══════════════════════════════════════════════════════════
function ParticleIntro({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState(0)
  // 0=particles scatter, 1=coalesce to logo, 2=logo glow,
  // 3=holographic text, 4=title reveal, 5=fade out

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const W = canvas.width, H = canvas.height
    const cx = W / 2, cy = H / 2

    // Particle system
    const N = 180
    const particles: {
      x:number; y:number; tx:number; ty:number; ox:number; oy:number;
      size:number; hue:number; speed:number; angle:number; alpha:number
    }[] = []

    // Logo target positions (⚡ lightning bolt shape approximation)
    const logoR = 28
    const logoTargets: [number,number][] = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const r = logoR * (0.6 + Math.random() * 0.4)
      logoTargets.push([cx + Math.cos(a) * r, cy - 30 + Math.sin(a) * r])
    }

    for (let i = 0; i < N; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = 200 + Math.random() * 400
      particles.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        tx: logoTargets[i][0],
        ty: logoTargets[i][1],
        ox: cx + Math.cos(angle) * dist,
        oy: cy + Math.sin(angle) * dist,
        size: 1 + Math.random() * 2,
        hue: 240 + Math.random() * 80, // blue to purple
        speed: 0.003 + Math.random() * 0.004,
        angle: Math.random() * Math.PI * 2,
        alpha: 0.3 + Math.random() * 0.7,
      })
    }

    let startTime = Date.now()
    let currentPhase = 0
    let animFrame: number

    const draw = () => {
      const elapsed = Date.now() - startTime
      ctx.clearRect(0, 0, W, H)

      // Space background gradient
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.7)
      bgGrad.addColorStop(0, 'rgba(20,10,40,1)')
      bgGrad.addColorStop(0.5, 'rgba(10,10,15,1)')
      bgGrad.addColorStop(1, 'rgba(10,10,15,1)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, W, H)

      // Nebula glow
      const nebulaAlpha = Math.min(1, elapsed / 2000) * 0.15
      const neb1 = ctx.createRadialGradient(cx - 150, cy - 100, 0, cx - 150, cy - 100, 300)
      neb1.addColorStop(0, `rgba(139,92,246,${nebulaAlpha})`)
      neb1.addColorStop(1, 'transparent')
      ctx.fillStyle = neb1; ctx.fillRect(0, 0, W, H)

      const neb2 = ctx.createRadialGradient(cx + 200, cy + 80, 0, cx + 200, cy + 80, 250)
      neb2.addColorStop(0, `rgba(59,130,246,${nebulaAlpha * 0.7})`)
      neb2.addColorStop(1, 'transparent')
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H)

      const neb3 = ctx.createRadialGradient(cx + 50, cy - 150, 0, cx + 50, cy - 150, 200)
      neb3.addColorStop(0, `rgba(255,183,71,${nebulaAlpha * 0.3})`)
      neb3.addColorStop(1, 'transparent')
      ctx.fillStyle = neb3; ctx.fillRect(0, 0, W, H)

      // Phase transitions
      if (elapsed > 1800 && currentPhase === 0) { currentPhase = 1; setPhase(1) }
      if (elapsed > 3500 && currentPhase === 1) { currentPhase = 2; setPhase(2) }
      if (elapsed > 4200 && currentPhase === 2) { currentPhase = 3; setPhase(3) }
      if (elapsed > 5500 && currentPhase === 3) { currentPhase = 4; setPhase(4) }
      if (elapsed > 7500 && currentPhase === 4) { currentPhase = 5; setPhase(5) }

      // Draw particles
      const coalesceProgress = currentPhase >= 1
        ? Math.min(1, (elapsed - 1800) / 1500) : 0
      const eased = coalesceProgress * coalesceProgress * (3 - 2 * coalesceProgress) // smoothstep

      for (const p of particles) {
        p.angle += p.speed
        const drift = Math.sin(p.angle) * 3

        if (currentPhase >= 1) {
          p.x += (p.tx - p.x) * (0.02 + eased * 0.04)
          p.y += (p.ty - p.y) * (0.02 + eased * 0.04)
        } else {
          p.x = p.ox + drift + Math.sin(elapsed * 0.001 + p.angle) * 8
          p.y = p.oy + Math.cos(elapsed * 0.0008 + p.angle) * 6
        }

        // Glow on coalesce
        const glowSize = currentPhase >= 2 ? p.size * (1 + Math.sin(elapsed * 0.005) * 0.3) : p.size
        const alpha = currentPhase >= 5 ? Math.max(0, p.alpha * (1 - (elapsed - 7500) / 800)) : p.alpha

        ctx.beginPath()
        ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${alpha})`
        ctx.fill()

        if (glowSize > 1.5) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, glowSize * 2.5, 0, Math.PI * 2)
          ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${alpha * 0.1})`
          ctx.fill()
        }
      }

      // Logo glow (phase 2+)
      if (currentPhase >= 2) {
        const logoAlpha = Math.min(1, (elapsed - 3500) / 600)
        const glow = ctx.createRadialGradient(cx, cy - 30, 0, cx, cy - 30, 50)
        glow.addColorStop(0, `rgba(139,92,246,${logoAlpha * 0.4})`)
        glow.addColorStop(1, 'transparent')
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)
      }

      if (currentPhase < 5) {
        animFrame = requestAnimationFrame(draw)
      }
    }

    animFrame = requestAnimationFrame(draw)

    const timer = setTimeout(onDone, 8300)

    return () => {
      cancelAnimationFrame(animFrame)
      clearTimeout(timer)
    }
  }, [onDone])

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:10000,
      opacity: phase === 5 ? 0 : 1,
      transition:'opacity 0.8s ease',
      pointerEvents: phase === 5 ? 'none' : 'auto',
    }}>
      <canvas ref={canvasRef} style={{ position:'absolute', inset:0 }} />

      {/* Logo */}
      <div style={{
        position:'absolute', top:'50%', left:'50%',
        transform:'translate(-50%, calc(-50% - 30px))',
        opacity: phase >= 2 ? 1 : 0,
        transition:'opacity 0.6s ease',
      }}>
        <div style={{
          width:56, height:56, borderRadius:14,
          background:'linear-gradient(135deg,#3B82F6,#8B5CF6)',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:28,
          boxShadow: phase >= 2 ? '0 0 60px rgba(139,92,246,0.5), 0 0 120px rgba(139,92,246,0.2)' : 'none',
          transition:'box-shadow 1s ease',
        }}>⚡</div>
      </div>

      {/* Holographic tagline */}
      <div style={{
        position:'absolute', top:'50%', left:'50%',
        transform:'translate(-50%, calc(-50% + 40px))',
        textAlign:'center', width:'90%',
        opacity: phase >= 3 ? 1 : 0,
        transition:'opacity 0.8s ease 0.2s',
        filter: phase === 3 ? 'blur(0px)' : 'blur(4px)',
      }}>
        <div style={{
          fontFamily:C.M, fontSize:11, letterSpacing:'0.15em',
          textTransform:'uppercase' as const,
          color:'transparent',
          background:'linear-gradient(90deg, #3B82F6, #8B5CF6, #FF4C6A, #FFB547, #3B82F6)',
          backgroundSize:'200% 100%',
          WebkitBackgroundClip:'text', backgroundClip:'text' as 'text',
          animation: phase >= 3 ? 'holoShift 3s linear infinite' : 'none',
        }}>
          Multi-chain financial automation
        </div>

        {/* Badges holographic */}
        <div style={{
          display:'flex', gap:8, justifyContent:'center', marginTop:12,
          opacity: phase >= 3 ? 1 : 0,
          transition:'opacity 0.6s ease 0.5s',
        }}>
          {['Base L2','DAC8','AML Oracle','VASP'].map((b,i) => (
            <span key={b} style={{
              fontFamily:C.M, fontSize:7, letterSpacing:'0.1em',
              color:'rgba(255,255,255,0.4)', padding:'2px 6px',
              border:'1px solid rgba(255,255,255,0.08)', borderRadius:4,
              opacity: phase >= 3 ? 1 : 0,
              transition:`opacity 0.5s ease ${0.6 + i * 0.15}s`,
            }}>{b}</span>
          ))}
        </div>
      </div>

      {/* Title reveal */}
      <div style={{
        position:'absolute', top:'50%', left:'50%',
        transform:'translate(-50%, calc(-50% + 100px))',
        textAlign:'center',
        opacity: phase >= 4 ? 1 : 0,
        transition:'opacity 1s ease',
      }}>
        <div style={{
          fontFamily:C.D, fontSize:'clamp(28px, 5vw, 48px)',
          fontWeight:800, lineHeight:1.1, letterSpacing:'-0.04em',
          color:C.text,
        }}>
          Swap <span style={GRAD}>anytime,</span>
        </div>
        <div style={{
          fontFamily:C.D, fontSize:'clamp(28px, 5vw, 48px)',
          fontWeight:800, lineHeight:1.1, letterSpacing:'-0.04em',
          color:C.text,
        }}>
          anywhere.
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  HERO — cinematic text transitions (correct words)
// ═══════════════════════════════════════════════════════════
//
//  Send mode:  Line1 "Send <grad>anywhere,</grad>"  Line2 "anytime."
//  Swap mode:  Line1 "Swap <grad>anytime,</grad>"   Line2 "anywhere."
//
function Hero({ view, setView }: { view: View; setView: (v:View) => void }) {
  const [display, setDisplay] = useState<View>(view)
  const [exiting, setExiting] = useState(false)
  const [entering, setEntering] = useState(false)

  useEffect(() => {
    if (view === display || view === 'command') {
      setDisplay(view)
      return
    }
    setExiting(true)
    const t1 = setTimeout(() => { setDisplay(view); setExiting(false); setEntering(true) }, 800)
    const t2 = setTimeout(() => setEntering(false), 1700)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [view])

  const fontSize = display === 'command' ? 'clamp(26px,4vw,40px)' : 'clamp(38px,7vw,68px)'

  const line1Style: React.CSSProperties = {
    fontFamily:C.D, fontSize, fontWeight:800, lineHeight:1.05,
    letterSpacing:'-0.04em', textAlign:'center', color:C.text,
    opacity: exiting ? 0 : 1,
    transform: exiting ? 'translateY(-28px)' : entering ? 'translateY(0)' : 'translateY(0)',
    filter: exiting ? 'blur(4px)' : 'blur(0px)',
    transition: exiting
      ? 'all 0.8s cubic-bezier(.4,0,.2,1)'
      : 'all 0.9s cubic-bezier(.16,1,.3,1) 0.1s',
  }

  const line2Style: React.CSSProperties = {
    fontFamily:C.D, fontSize, fontWeight:800, lineHeight:1.05,
    letterSpacing:'-0.04em', textAlign:'center', color:C.text,
  }

  if (display === 'command') {
    return (
      <div style={line1Style}>
        <span style={GRAD}>Command</span> Center
      </div>
    )
  }

  if (display === 'swap') {
    return (
      <div>
        <div style={line1Style}>
          <span style={{cursor:'pointer'}} onClick={() => setView('send')}>Swap</span>
          {' '}<span style={{...GRAD, cursor:'pointer'}} onClick={() => setView('send')}>anytime,</span>
        </div>
        <div style={line2Style}>anywhere.</div>
      </div>
    )
  }

  // send
  return (
    <div>
      <div style={line1Style}>
        <span style={{cursor:'pointer'}} onClick={() => setView('swap')}>Send</span>
        {' '}<span style={{...GRAD, cursor:'pointer'}} onClick={() => setView('swap')}>anywhere,</span>
      </div>
      <div style={line2Style}>anytime.</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  ENGINE STATUS
// ═══════════════════════════════════════════════════════════
function EngineStatus({ on }: { on: boolean }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 14px', borderRadius:20, background:C.surface, border:`1px solid ${C.border}` }}>
      <div style={{ position:'relative', width:8, height:8 }}>
        <div style={{ width:8, height:8, borderRadius:'50%', background:on?C.green:C.dim }} />
        {on && <div style={{ position:'absolute', inset:-3, borderRadius:'50%', border:`2px solid ${C.green}`, animation:'rsPulse 2s ease infinite' }} />}
      </div>
      <span style={{ fontFamily:C.M, fontSize:10, fontWeight:600, color:on?C.green:C.dim }}>{on?'ONLINE':'OFFLINE'}</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  NETWORK BADGE
// ═══════════════════════════════════════════════════════════
function NetworkBadge() {
  const chainId = useChainId()
  const chains = [{id:8453,name:'Base',icon:'🔵'},{id:1,name:'Ethereum',icon:'⟠'},{id:42161,name:'Arbitrum',icon:'🔷'},{id:-1,name:'Solana',icon:'◎',soon:true}]
  const [open, setOpen] = useState(false)
  const cur = chains.find(c => c.id === chainId) ?? chains[0]
  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:20, background:C.surface, border:`1px solid ${C.border}`, cursor:'pointer', fontFamily:C.M, fontSize:10, fontWeight:600, color:C.sub }}>
        <span>{cur.icon}</span><span>{cur.name}</span><span style={{ fontSize:8, color:C.dim, transform:open?'rotate(180deg)':'none', transition:'transform 0.2s' }}>▾</span>
      </button>
      {open && <>
        <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:99 }} />
        <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, minWidth:170, zIndex:100, background:C.card, border:`1px solid ${C.border}`, borderRadius:14, boxShadow:'0 16px 48px rgba(0,0,0,0.7)', overflow:'hidden' }}>
          {chains.map(ch => (
            <button key={ch.id} onClick={() => setOpen(false)} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'transparent', border:'none', borderBottom:`1px solid ${C.border}`, cursor:(ch as any).soon?'not-allowed':'pointer', opacity:(ch as any).soon?0.4:1 }}>
              <span style={{ fontSize:14 }}>{ch.icon}</span>
              <span style={{ fontFamily:C.D, fontSize:12, fontWeight:600, color:C.text, flex:1, textAlign:'left' as const }}>{ch.name}</span>
              {ch.id === chainId && <div style={{ width:6, height:6, borderRadius:'50%', background:C.green }} />}
              {(ch as any).soon && <span style={{ fontFamily:C.M, fontSize:8, color:C.dim }}>Soon</span>}
            </button>
          ))}
        </div>
      </>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  GAS GUARD + SMART ROUTE + ACTIVITY (compressed)
// ═══════════════════════════════════════════════════════════
function GasGuard() {
  const [gas,setGas]=useState<number|null>(null)
  useEffect(()=>{const f=async()=>{try{const r=await fetch('https://mainnet.base.org',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_gasPrice',params:[]})});setGas(parseInt((await r.json()).result,16)/1e9)}catch{}};f();const iv=setInterval(f,15000);return()=>clearInterval(iv)},[])
  const lv=gas===null?'unknown':gas<0.01?'optimal':gas<0.1?'normal':'high'
  const cfg={optimal:{l:'Optimal',c:C.green,i:'⚡'},normal:{l:'Normal',c:C.amber,i:'⚠'},high:{l:'Suspended',c:C.red,i:'⛔'},unknown:{l:'—',c:C.dim,i:'?'}}[lv]
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:'16px 18px'}}>
      <div style={{fontFamily:C.M,fontSize:9,fontWeight:700,color:C.dim,textTransform:'uppercase' as const,letterSpacing:'0.1em',marginBottom:10}}>Gas Guard</div>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:38,height:38,borderRadius:10,background:`${cfg.c}10`,border:`1px solid ${cfg.c}20`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{cfg.i}</div>
        <div><span style={{fontFamily:C.D,fontSize:16,fontWeight:700,color:cfg.c}}>{gas!==null?`${gas.toFixed(4)} Gwei`:'—'}</span><span style={{fontFamily:C.M,fontSize:8,fontWeight:600,color:cfg.c,background:`${cfg.c}12`,padding:'2px 6px',borderRadius:4,marginLeft:6}}>{cfg.l}</span></div>
      </div>
    </div>
  )
}

function SmartRouteConfig({address}:{address:string|undefined}){
  const[dest,setDest]=useState('');const[split,setSplit]=useState(false);const[pct,setPct]=useState('70');const[dest2,setDest2]=useState('');const[thr,setThr]=useState('0.001');const[saving,setSaving]=useState(false);const[saved,setSaved]=useState(false)
  const save=async()=>{if(!address||!dest.startsWith('0x'))return;setSaving(true);try{await fetch(`${BACKEND}/api/v1/forwarding/rules`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_wallet:address,destination_wallet:dest,min_threshold:parseFloat(thr),gas_strategy:'normal',max_gas_percent:10,token_symbol:'ETH',chain_id:8453,split_enabled:split,split_percent:split?parseInt(pct):100,split_destination:split?dest2:null})});setSaved(true);setTimeout(()=>setSaved(false),3000)}catch{};setSaving(false)}
  return(
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:'18px 20px'}}>
      <div style={{fontFamily:C.M,fontSize:9,fontWeight:700,color:C.dim,textTransform:'uppercase' as const,letterSpacing:'0.1em',marginBottom:12}}>Smart Route</div>
      <div style={{marginBottom:10}}><label style={{fontFamily:C.M,fontSize:9,color:C.dim,display:'block',marginBottom:3}}>Destination {split&&`(${pct}%)`}</label><input value={dest} onChange={e=>setDest(e.target.value)} placeholder="0x..." style={{width:'100%',padding:'10px 12px',borderRadius:10,background:C.bg,border:`1px solid ${C.border}`,color:C.text,fontFamily:C.M,fontSize:11,outline:'none'}}/></div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',marginBottom:split?10:0}}>
        <span style={{fontFamily:C.D,fontSize:11,color:C.sub}}>Split Routing</span>
        <button onClick={()=>setSplit(s=>!s)} style={{width:36,height:20,borderRadius:10,background:split?C.green:'rgba(255,255,255,0.08)',border:'none',cursor:'pointer',position:'relative',transition:'background 0.2s'}}><div style={{width:14,height:14,borderRadius:'50%',background:'#fff',position:'absolute',top:3,left:split?19:3,transition:'left 0.2s'}}/></button>
      </div>
      {split&&<div style={{display:'grid',gridTemplateColumns:'70px 1fr',gap:6,marginBottom:10}}><input type="number" value={pct} onChange={e=>setPct(e.target.value)} min="1" max="99" style={{padding:'8px',borderRadius:8,background:C.bg,border:`1px solid ${C.border}`,color:C.text,fontFamily:C.M,fontSize:10,outline:'none',textAlign:'center' as const}}/><input value={dest2} onChange={e=>setDest2(e.target.value)} placeholder={`Dest 2 (${100-parseInt(pct||'70')}%)`} style={{padding:'8px 10px',borderRadius:8,background:C.bg,border:`1px solid ${C.border}`,color:C.text,fontFamily:C.M,fontSize:10,outline:'none'}}/></div>}
      <div style={{marginBottom:12}}><label style={{fontFamily:C.M,fontSize:9,color:C.dim,display:'block',marginBottom:3}}>Min threshold (ETH)</label><input type="number" value={thr} onChange={e=>setThr(e.target.value)} step="0.001" style={{width:'100%',padding:'10px 12px',borderRadius:10,background:C.bg,border:`1px solid ${C.border}`,color:C.text,fontFamily:C.M,fontSize:11,outline:'none'}}/></div>
      <button onClick={save} disabled={!dest.startsWith('0x')||saving} style={{width:'100%',padding:'12px',borderRadius:10,border:'none',background:saved?C.green:dest.startsWith('0x')?'linear-gradient(135deg,#3B82F6,#8B5CF6)':'rgba(255,255,255,0.04)',color:saved?'#000':dest.startsWith('0x')?'#fff':C.dim,fontFamily:C.D,fontSize:13,fontWeight:700,cursor:dest.startsWith('0x')?'pointer':'not-allowed',transition:'all 0.2s'}}>{saving?'...':saved?'✓ Saved':'Activate Route'}</button>
    </div>
  )
}

function ActivityFeed({address}:{address:string|undefined}){
  const[logs,setLogs]=useState<{id:number;destination:string;amount:number;token:string;status:string;tx_hash:string|null;gas_percent:number|null}[]>([])
  useEffect(()=>{if(!address)return;const ld=()=>fetch(`${BACKEND}/api/v1/forwarding/logs?wallet=${address}&limit=6`).then(r=>r.ok?r.json():null).then(d=>{if(d?.logs)setLogs(d.logs)}).catch(()=>{});ld();const iv=setInterval(ld,10000);return()=>clearInterval(iv)},[address])
  const sc:Record<string,string>={pending:C.amber,executing:C.blue,completed:C.green,failed:C.red,gas_too_high:'#FF8C00'}
  if(!logs.length)return(<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:'20px',textAlign:'center' as const}}><div style={{fontSize:20,marginBottom:6}}>📡</div><div style={{fontFamily:C.D,fontSize:12,color:C.dim}}>Waiting for transactions</div></div>)
  return(<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,overflow:'hidden'}}><div style={{padding:'12px 18px',borderBottom:`1px solid ${C.border}`,fontFamily:C.M,fontSize:9,fontWeight:700,color:C.dim,textTransform:'uppercase' as const,letterSpacing:'0.1em'}}>Live Activity</div>{logs.map((l,i)=>(<div key={l.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 18px',borderBottom:i<logs.length-1?`1px solid ${C.border}`:'none'}}><div style={{width:6,height:6,borderRadius:'50%',background:sc[l.status]??C.dim,flexShrink:0}}/><div style={{flex:1,fontFamily:C.M,fontSize:11,color:C.text}}>{l.amount?.toFixed(4)} {l.token} → {l.destination?.slice(0,8)}…</div><span style={{fontFamily:C.M,fontSize:8,color:sc[l.status]??C.dim}}>{l.status.toUpperCase()}</span>{l.tx_hash&&<a href={`https://basescan.org/tx/${l.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{fontFamily:C.M,fontSize:9,color:C.sub,textDecoration:'none'}}>↗</a>}</div>))}</div>)
}

// ═══════════════════════════════════════════════════════════
//  NAV PILL with ripple
// ═══════════════════════════════════════════════════════════
function NavPill({ view, setView }: { view: View; setView: (v:View) => void }) {
  const [ripple, setRipple] = useState<{key:string;x:number;y:number}|null>(null)

  const handleClick = (v: View, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setRipple({ key: `${Date.now()}`, x: e.clientX - rect.left, y: e.clientY - rect.top })
    setTimeout(() => setRipple(null), 600)
    setView(v)
  }

  return (
    <div style={{ display:'flex', gap:3, background:C.surface, borderRadius:14, padding:3, border:`1px solid ${C.border}` }}>
      {([
        { key:'send' as View, label:'↗ Send' },
        { key:'swap' as View, label:'↗Swap' },
        { key:'command' as View, label:'↗Command Center' },
      ]).map(v => (
        <button key={v.key} onClick={(e) => handleClick(v.key, e)} style={{
          position:'relative', overflow:'hidden',
          padding:'9px 20px', borderRadius:11, border:'none',
          background: view === v.key ? 'rgba(255,255,255,0.08)' : 'transparent',
          color: view === v.key ? C.text : C.dim,
          fontFamily:C.D, fontSize:12, fontWeight:600,
          cursor:'pointer', transition:'all 0.25s ease',
        }}>
          {v.label}
          {ripple && view === v.key && (
            <span key={ripple.key} style={{
              position:'absolute', left:ripple.x - 20, top:ripple.y - 20,
              width:40, height:40, borderRadius:'50%',
              background:'rgba(139,92,246,0.2)',
              animation:'rippleOut 0.6s ease forwards',
              pointerEvents:'none',
            }} />
          )}
        </button>
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
  const [showIntro, setShowIntro] = useState(false)
  const [ready, setReady] = useState(false)
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('rsend_seen')) {
        setShowIntro(true)
        sessionStorage.setItem('rsend_seen', '1')
      } else {
        setReady(true)
      }
    } catch { setReady(true) }
  }, [])

  const handleIntroDone = useCallback(() => {
    setShowIntro(false)
    setReady(true)
    setView('swap') // Intro ends on Swap, matching the title reveal
  }, [])

  // Trigger form re-mount on view change for transition
  useEffect(() => { setFormKey(k => k + 1) }, [view])

  return (
    <>
      {showIntro && <ParticleIntro onDone={handleIntroDone} />}

      <div className="rp-bg" aria-hidden="true"><div className="rp-bg__base"/><div className="rp-orb rp-orb--1"/><div className="rp-orb rp-orb--2"/><div className="rp-orb rp-orb--3"/><div className="rp-orb rp-orb--4"/><div className="rp-orb rp-orb--5"/><div className="rp-bg__noise"/></div>

      <div style={{ position:'fixed', top:16, right:20, zIndex:1000, display:'flex', gap:8, alignItems:'center', opacity:ready?1:0, transition:'opacity 0.6s ease 0.3s' }}>
        <NetworkBadge />
        <EngineStatus on={isConnected} />
        <AccountHeader />
      </div>

      <main className="rp-content" style={{ minHeight:'100vh', padding:'24px 16px', display:'flex', flexDirection:'column', alignItems:'center', opacity:ready?1:0, transition:'opacity 0.8s ease' }}>

      

        {/* Hero */}
        <div className="rp-anim-0" style={{ marginBottom:28 }}>
          <Hero view={view} setView={setView} />
          <p style={{ fontFamily:C.M, fontSize:11, color:C.dim, marginTop:12, textAlign:'center' }}>
            Multi-chain automation · <span style={{color:C.blue}}>Base</span> · <span style={{color:'#627EEA'}}>Ethereum</span> · <span style={{color:'#28A0F0'}}>Arbitrum</span>
          </p>
        </div>

        {/* Nav */}
        <div className="rp-anim-0" style={{ marginBottom:24 }}>
          <NavPill view={view} setView={setView} />
        </div>

        {/* Content — fluid transition via key remount + CSS */}
        <div key={`content-${view}-${formKey}`} style={{
          width:'100%', display:'flex', justifyContent:'center',
          animation:'formReveal 0.5s cubic-bezier(.16,1,.3,1) both',
        }}>
          {view === 'send' && (
            <div style={{ width:'100%', maxWidth:480 }}><TransferForm /></div>
          )}
          {view === 'swap' && (
            <div style={{ width:'100%', maxWidth:440 }}><SwapModule onSwapComplete={() => {}} /></div>
          )}
          {view === 'command' && isConnected && (
            <div style={{ width:'100%', maxWidth:800 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                <GasGuard />
                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:'16px 18px', display:'flex', flexDirection:'column', justifyContent:'center' }}>
                  <div style={{ fontFamily:C.M, fontSize:9, fontWeight:700, color:C.dim, textTransform:'uppercase' as const, letterSpacing:'0.1em', marginBottom:8 }}>Stats</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                    <div><div style={{ fontFamily:C.D, fontSize:18, fontWeight:700, color:C.text }}>—</div><div style={{ fontFamily:C.M, fontSize:8, color:C.dim }}>Sweeps today</div></div>
                    <div><div style={{ fontFamily:C.D, fontSize:18, fontWeight:700, color:C.text }}>—</div><div style={{ fontFamily:C.M, fontSize:8, color:C.dim }}>Volume 24h</div></div>
                  </div>
                </div>
              </div>
              <div style={{ marginBottom:12 }}><SmartRouteConfig address={address} /></div>
              <ActivityFeed address={address} />
            </div>
          )}
          {view === 'command' && !isConnected && (
            <div style={{ textAlign:'center', padding:40, background:C.surface, borderRadius:20, border:`1px solid ${C.border}`, maxWidth:380 }}>
              <div style={{ fontSize:28, marginBottom:10 }}>🔌</div>
              <div style={{ fontFamily:C.D, fontSize:15, fontWeight:600, color:C.text, marginBottom:4 }}>Connect wallet</div>
              <div style={{ fontFamily:C.M, fontSize:11, color:C.dim }}>To access RSend Command Center</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="rp-anim-2" style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' as const, justifyContent:'center', marginTop:28 }}>
          {[{icon:'⚡',label:'Base L2'},{icon:'⟠',label:'Ethereum'},{icon:'🔷',label:'Arbitrum'},{icon:'🔒',label:'Non-Custodial'},{icon:'📋',label:'DAC8'},{icon:'🔀',label:'Split Routing'},{icon:'✓',label:'VASP Ready',a:true}].map(b=>(
            <div key={b.label} style={{ display:'flex', alignItems:'center', gap:3, fontFamily:C.M, fontSize:8, color:(b as any).a?C.green:C.dim, background:(b as any).a?`${C.green}06`:'rgba(255,255,255,0.02)', border:`1px solid ${(b as any).a?`${C.green}15`:C.border}`, borderRadius:5, padding:'2px 7px' }}>
              <span>{b.icon}</span><span>{b.label}</span>
            </div>
          ))}
        </div>
      </main>

      <style>{`
        @keyframes rsPulse{0%{transform:scale(1);opacity:.8}50%{transform:scale(1.8);opacity:0}100%{transform:scale(1);opacity:0}}
        @keyframes holoShift{0%{background-position:0% 50%}100%{background-position:200% 50%}}
        @keyframes rippleOut{0%{transform:scale(0);opacity:1}100%{transform:scale(3);opacity:0}}
        @keyframes formReveal{0%{opacity:0;transform:translateY(16px) scale(0.98)}100%{opacity:1;transform:translateY(0) scale(1)}}
      `}</style>
    </>
  )
} 