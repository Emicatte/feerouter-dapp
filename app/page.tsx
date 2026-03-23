'use client'

/**
 * page.tsx — RSend Command Center
 *
 * Dashboard operativa:
 *   - Engine status (ON/OFF pulsante)
 *   - Smart Route configurator con Split Routing
 *   - Gas Guard visualizer
 *   - Live activity feed
 */

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAccount, useChainId } from 'wagmi'

const TransferForm  = dynamic(() => import('./TransferForm'),  { ssr: false })
const AccountHeader = dynamic(() => import('./AccountHeader'), { ssr: false })

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

const C = {
  bg:'#0a0a0f', surface:'#111118', card:'#16161f',
  border:'rgba(255,255,255,0.06)', text:'#E2E2F0', sub:'#8A8FA8',
  dim:'#4A4E64', green:'#00D68F', red:'#FF4C6A', amber:'#FFB547',
  blue:'#3B82F6', purple:'#8B5CF6',
  D:'var(--font-display)', M:'var(--font-mono)',
}

function EngineStatus({ isConnected }: { isConnected: boolean }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 18px', borderRadius:14, background:C.surface, border:`1px solid ${C.border}` }}>
      <div style={{ position:'relative', width:10, height:10 }}>
        <div style={{ width:10, height:10, borderRadius:'50%', background: isConnected ? C.green : C.dim }} />
        {isConnected && <div style={{ position:'absolute', inset:-3, borderRadius:'50%', border:`2px solid ${C.green}`, animation:'rsPulse 2s ease infinite' }} />}
      </div>
      <span style={{ fontFamily:C.D, fontSize:12, fontWeight:600, color: isConnected ? C.green : C.dim }}>
        RSend Engine {isConnected ? 'ONLINE' : 'OFFLINE'}
      </span>
    </div>
  )
}

function GasGuard() {
  const [gas, setGas] = useState<number|null>(null)
  useEffect(() => {
    const f = async () => {
      try {
        const r = await fetch('https://mainnet.base.org', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_gasPrice',params:[]}) })
        setGas(parseInt((await r.json()).result, 16) / 1e9)
      } catch { setGas(null) }
    }
    f(); const iv = setInterval(f, 15000); return () => clearInterval(iv)
  }, [])
  const lv = gas === null ? 'unknown' : gas < 0.01 ? 'optimal' : gas < 0.1 ? 'normal' : 'high'
  const cfg = { optimal:{l:'Ottimale',c:C.green,i:'⚡',d:'Condizioni ideali'}, normal:{l:'Normale',c:C.amber,i:'⚠',d:'Gas nella norma'}, high:{l:'Sospeso',c:C.red,i:'⛔',d:'Gas elevato — sweep in attesa'}, unknown:{l:'—',c:C.dim,i:'?',d:'Caricamento...'} }[lv]
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:'18px 20px' }}>
      <div style={{ fontFamily:C.D, fontSize:11, fontWeight:700, color:C.dim, textTransform:'uppercase' as const, letterSpacing:'0.08em', marginBottom:12 }}>Gas Guard · Base L2</div>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:44, height:44, borderRadius:12, background:`${cfg.c}10`, border:`1px solid ${cfg.c}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>{cfg.i}</div>
        <div>
          <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
            <span style={{ fontFamily:C.D, fontSize:18, fontWeight:700, color:cfg.c }}>{gas !== null ? `${gas.toFixed(4)} Gwei` : '—'}</span>
            <span style={{ fontFamily:C.M, fontSize:9, fontWeight:600, color:cfg.c, background:`${cfg.c}12`, padding:'2px 8px', borderRadius:5, border:`1px solid ${cfg.c}20` }}>{cfg.l}</span>
          </div>
          <div style={{ fontFamily:C.M, fontSize:10, color:C.dim, marginTop:3 }}>{cfg.d}</div>
        </div>
      </div>
    </div>
  )
}

function SmartRouteConfig({ address }: { address:string|undefined }) {
  const [dest,setDest]=useState(''); const [split,setSplit]=useState(false); const [pct,setPct]=useState('70')
  const [dest2,setDest2]=useState(''); const [thr,setThr]=useState('0.001'); const [saving,setSaving]=useState(false); const [saved,setSaved]=useState(false)
  const save = async () => {
    if (!address||!dest.startsWith('0x')) return; setSaving(true)
    try { await fetch(`${BACKEND}/api/v1/forwarding/rules`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_wallet:address,destination_wallet:dest,min_threshold:parseFloat(thr),gas_strategy:'normal',max_gas_percent:10,token_symbol:'ETH',chain_id:8453,split_enabled:split,split_percent:split?parseInt(pct):100,split_destination:split?dest2:null})}); setSaved(true); setTimeout(()=>setSaved(false),3000) } catch {}; setSaving(false)
  }
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:'20px 22px' }}>
      <div style={{ fontFamily:C.D, fontSize:11, fontWeight:700, color:C.dim, textTransform:'uppercase' as const, letterSpacing:'0.08em', marginBottom:14 }}>Smart Route Configuration</div>
      <div style={{ marginBottom:12 }}>
        <label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Destinazione principale {split&&`(${pct}%)`}</label>
        <input value={dest} onChange={e=>setDest(e.target.value)} placeholder="0x..." style={{ width:'100%', padding:'11px 14px', borderRadius:10, background:C.bg, border:`1px solid ${C.border}`, color:C.text, fontFamily:C.M, fontSize:12, outline:'none' }} />
      </div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', marginBottom: split?12:0 }}>
        <span style={{ fontFamily:C.D, fontSize:12, color:C.sub }}>Split Routing</span>
        <button onClick={()=>setSplit(s=>!s)} style={{ width:40, height:22, borderRadius:11, background:split?C.green:'rgba(255,255,255,0.08)', border:'none', cursor:'pointer', position:'relative', transition:'background 0.2s' }}>
          <div style={{ width:16, height:16, borderRadius:'50%', background:'#fff', position:'absolute', top:3, left:split?21:3, transition:'left 0.2s' }} />
        </button>
      </div>
      {split&&(
        <div style={{ marginBottom:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'80px 1fr', gap:8, marginBottom:8 }}>
            <div><label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Split %</label><input type="number" value={pct} onChange={e=>setPct(e.target.value)} min="1" max="99" style={{ width:'100%', padding:'9px 10px', borderRadius:8, background:C.bg, border:`1px solid ${C.border}`, color:C.text, fontFamily:C.M, fontSize:11, outline:'none', textAlign:'center' as const }} /></div>
            <div><label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Destinazione 2 ({100-parseInt(pct||'70')}%)</label><input value={dest2} onChange={e=>setDest2(e.target.value)} placeholder="0x... (es. wallet tasse)" style={{ width:'100%', padding:'9px 14px', borderRadius:8, background:C.bg, border:`1px solid ${C.border}`, color:C.text, fontFamily:C.M, fontSize:11, outline:'none' }} /></div>
          </div>
          <div style={{ padding:'8px 12px', borderRadius:8, background:`${C.purple}08`, border:`1px solid ${C.purple}15` }}>
            <span style={{ fontFamily:C.M, fontSize:9, color:C.purple }}>💡 Es: 70% al wallet operativo, 30% al wallet tasse automaticamente</span>
          </div>
        </div>
      )}
      <div style={{ marginBottom:16 }}>
        <label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Soglia minima (ETH)</label>
        <input type="number" value={thr} onChange={e=>setThr(e.target.value)} step="0.001" style={{ width:'100%', padding:'11px 14px', borderRadius:10, background:C.bg, border:`1px solid ${C.border}`, color:C.text, fontFamily:C.M, fontSize:12, outline:'none' }} />
      </div>
      <button onClick={save} disabled={!dest.startsWith('0x')||saving} style={{ width:'100%', padding:'14px', borderRadius:12, border:'none', background: saved?C.green: dest.startsWith('0x')?'linear-gradient(135deg,#3B82F6,#8B5CF6)':'rgba(255,255,255,0.04)', color: saved?'#000': dest.startsWith('0x')?'#fff':C.dim, fontFamily:C.D, fontSize:14, fontWeight:700, cursor: dest.startsWith('0x')?'pointer':'not-allowed', transition:'all 0.2s', boxShadow: dest.startsWith('0x')&&!saved?'0 4px 20px rgba(59,130,246,0.25)':'none' }}>
        {saving?'Salvando...':saved?'✓ Route Salvata':'Attiva Smart Route'}
      </button>
    </div>
  )
}

function ActivityFeed({ address }:{ address:string|undefined }) {
  const [logs,setLogs]=useState<{id:number;destination:string;amount:number;token:string;status:string;tx_hash:string|null;created_at:string|null;gas_percent:number|null}[]>([])
  useEffect(()=>{
    if(!address)return
    const load=()=>fetch(`${BACKEND}/api/v1/forwarding/logs?wallet=${address}&limit=8`).then(r=>r.ok?r.json():null).then(d=>{if(d?.logs)setLogs(d.logs)}).catch(()=>{})
    load(); const iv=setInterval(load,10000); return()=>clearInterval(iv)
  },[address])
  const sc:Record<string,string>={pending:C.amber,executing:C.blue,completed:C.green,failed:C.red,gas_too_high:'#FF8C00'}
  if(!logs.length) return(
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:'24px 20px', textAlign:'center' as const }}>
      <div style={{ fontSize:24, marginBottom:8 }}>📡</div>
      <div style={{ fontFamily:C.D, fontSize:13, color:C.dim }}>In attesa di transazioni</div>
      <div style={{ fontFamily:C.M, fontSize:10, color:C.dim, marginTop:4, opacity:0.6 }}>Le transazioni intercettate appariranno qui</div>
    </div>
  )
  return(
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, overflow:'hidden' }}>
      <div style={{ padding:'14px 20px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontFamily:C.D, fontSize:11, fontWeight:700, color:C.dim, textTransform:'uppercase' as const, letterSpacing:'0.08em' }}>Live Activity</span>
        <span style={{ fontFamily:C.M, fontSize:10, color:C.dim }}>{logs.length} sweep</span>
      </div>
      {logs.map((log,i)=>(
        <div key={log.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 20px', borderBottom:i<logs.length-1?`1px solid ${C.border}`:'none' }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:sc[log.status]??C.dim, boxShadow:log.status==='executing'?`0 0 8px ${C.blue}`:'none', flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:C.M, fontSize:12, color:C.text }}>{log.amount?.toFixed(6)} {log.token} → {log.destination?.slice(0,8)}…</div>
            <div style={{ fontFamily:C.M, fontSize:9, color:C.dim, marginTop:2 }}>{log.status.toUpperCase()}{log.gas_percent?` · Gas: ${log.gas_percent.toFixed(1)}%`:''}</div>
          </div>
          {log.tx_hash&&<a href={`https://basescan.org/tx/${log.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily:C.M, fontSize:9, color:C.sub, textDecoration:'none' }}>↗</a>}
        </div>
      ))}
    </div>
  )
}

export default function Home() {
  const { address, isConnected } = useAccount()
  const [view, setView] = useState<'command'|'send'>('command')
  return (
    <>
      <div className="rp-bg" aria-hidden="true"><div className="rp-bg__base"/><div className="rp-orb rp-orb--1"/><div className="rp-orb rp-orb--2"/><div className="rp-orb rp-orb--3"/><div className="rp-orb rp-orb--4"/><div className="rp-orb rp-orb--5"/><div className="rp-bg__noise"/></div>
      <div style={{ position:'fixed', top:16, right:20, zIndex:1000 }}><AccountHeader /></div>
      <main className="rp-content" style={{ minHeight:'100vh', padding:'24px 16px', display:'flex', flexDirection:'column', alignItems:'center' }}>
        <div className="rp-anim-0" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:16, marginTop:20, marginBottom:8, flexWrap:'wrap' as const }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#3B82F6,#8B5CF6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>⚡</div>
            <span style={{ fontFamily:C.D, fontSize:22, fontWeight:800, color:C.text, letterSpacing:'-0.03em' }}>RSend</span>
            <span style={{ fontFamily:C.M, fontSize:9, color:C.dim, background:'rgba(255,255,255,0.04)', border:`1px solid ${C.border}`, borderRadius:5, padding:'2px 7px' }}>v4</span>
          </div>
          <EngineStatus isConnected={isConnected} />
        </div>
        <div className="rp-anim-0" style={{ textAlign:'center', marginBottom:24 }}>
          <p style={{ fontFamily:C.M, fontSize:12, color:C.dim }}>Automazione finanziaria su <span style={{ color:C.blue }}>Base L2</span> · Split routing · Compliance DAC8</p>
        </div>
        <div className="rp-anim-0" style={{ display:'flex', gap:4, marginBottom:20, background:C.surface, borderRadius:12, padding:3, border:`1px solid ${C.border}` }}>
          {[{key:'command' as const,label:'🎛 Command Center'},{key:'send' as const,label:'↗ Send'}].map(v=>(
            <button key={v.key} onClick={()=>setView(v.key)} style={{ padding:'8px 20px', borderRadius:10, border:'none', background:view===v.key?'rgba(255,255,255,0.08)':'transparent', color:view===v.key?C.text:C.dim, fontFamily:C.D, fontSize:12, fontWeight:600, cursor:'pointer', transition:'all 0.15s' }}>{v.label}</button>
          ))}
        </div>
        {view==='command'&&isConnected&&(
          <div className="rp-anim-1" style={{ width:'100%', maxWidth:800 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
              <GasGuard />
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:'18px 20px', display:'flex', flexDirection:'column', justifyContent:'center' }}>
                <div style={{ fontFamily:C.D, fontSize:11, fontWeight:700, color:C.dim, textTransform:'uppercase' as const, letterSpacing:'0.08em', marginBottom:8 }}>Quick Stats</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><div style={{ fontFamily:C.D, fontSize:20, fontWeight:700, color:C.text }}>—</div><div style={{ fontFamily:C.M, fontSize:9, color:C.dim }}>Sweep oggi</div></div>
                  <div><div style={{ fontFamily:C.D, fontSize:20, fontWeight:700, color:C.text }}>—</div><div style={{ fontFamily:C.M, fontSize:9, color:C.dim }}>Volume 24h</div></div>
                </div>
              </div>
            </div>
            <div style={{ marginBottom:14 }}><SmartRouteConfig address={address} /></div>
            <ActivityFeed address={address} />
          </div>
        )}
        {view==='command'&&!isConnected&&(
          <div className="rp-anim-1" style={{ textAlign:'center', padding:48, background:C.surface, borderRadius:20, border:`1px solid ${C.border}`, maxWidth:400 }}>
            <div style={{ fontSize:32, marginBottom:12 }}>🔌</div>
            <div style={{ fontFamily:C.D, fontSize:16, fontWeight:600, color:C.text, marginBottom:6 }}>Connetti il wallet</div>
            <div style={{ fontFamily:C.M, fontSize:12, color:C.dim }}>Per accedere al Command Center di RSend</div>
          </div>
        )}
        {view==='send'&&(
          <div className="rp-anim-1" style={{ width:'100%', maxWidth:480 }}><TransferForm /></div>
        )}
        <div className="rp-anim-2" style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' as const, justifyContent:'center', marginTop:24 }}>
          {[{icon:'⚡',label:'Base L2'},{icon:'🔒',label:'Non-Custodial'},{icon:'📋',label:'DAC8 Compliant'},{icon:'🛡',label:'AML Oracle'},{icon:'🔀',label:'Split Routing'},{icon:'✓',label:'VASP Ready',a:true}].map(b=>(
            <div key={b.label} style={{ display:'flex', alignItems:'center', gap:4, fontFamily:C.M, fontSize:9, color:(b as {a?:boolean}).a?C.green:C.dim, background:(b as {a?:boolean}).a?`${C.green}06`:'rgba(255,255,255,0.02)', border:`1px solid ${(b as {a?:boolean}).a?`${C.green}15`:C.border}`, borderRadius:6, padding:'3px 8px' }}>
              <span>{b.icon}</span><span>{b.label}</span>
            </div>
          ))}
        </div>
        <div className="rp-anim-2" style={{ fontFamily:C.M, fontSize:8, color:'#1a1a2a', textAlign:'center' as const, marginTop:16, paddingBottom:8 }}>RSend Engine · FeeRouterV4 · Built on Base</div>
      </main>
      <style>{`@keyframes rsPulse { 0% { transform:scale(1);opacity:0.8 } 50% { transform:scale(1.8);opacity:0 } 100% { transform:scale(1);opacity:0 } }`}</style>
    </>
  )
}