'use client'

/**
 * PortfolioDashboard.tsx V5 — Fluid Transitions
 *
 * framer-motion:
 *   - layoutId="activeTab" per indicator che scivola
 *   - AnimatePresence mode="wait" per content fade+slide
 *   - Overlay fade-in con motion.div
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getRegistry } from '../lib/contractRegistry'
import dynamic from 'next/dynamic'

const SwapModule = dynamic(() => import('./SwapModule'), { ssr: false })
const AutoForward = dynamic(() => import('./AutoForward'), { ssr: false })

// ═══════════════════════════════════════════════════════════
//  PALETTE
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
  symbol:string; name:string; balance:number; decimals:number
  usdValue:number; contractAddress:string; dac8Monitored:boolean
  logo?:string|null
}
interface Tx {
  hash:string; from:string; to:string; value:number
  asset:string; category:string; timestamp:string|null
}
interface Pt { date:string; value:number }
interface PData {
  totalUsd:number; assets:Asset[]; activity:Tx[]
  balanceHistory:Pt[]; txCount7d?:number; updatedAt:string
}
type Tab = 'overview'|'tokens'|'activity'|'swap'|'forward'
type Range = '1D'|'1W'
const TABS: [Tab, string][] = [['overview','Overview'],['tokens','Tokens'],['activity','Activity'],['swap','Swap'],['forward','Forward']]

// ═══════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════
function usePortfolio(addr:string|undefined, chain:number) {
  const [data,setData]=useState<PData|null>(null)
  const [loading,setLoading]=useState(false)
  const iv=useRef<ReturnType<typeof setInterval>|null>(null)
  const load=useCallback(async(s=false)=>{
    if(!addr)return; if(!s)setLoading(true)
    try{const r=await fetch(`/api/portfolio/${addr}?chainId=${chain}`,{signal:AbortSignal.timeout(15000)});if(r.ok)setData(await r.json())}catch{}finally{setLoading(false)}
  },[addr,chain])
  useEffect(()=>{if(!addr){setData(null);return};load()},[addr,chain,load])
  useEffect(()=>{if(!addr)return;iv.current=setInterval(()=>load(true),60000);return()=>{if(iv.current)clearInterval(iv.current)}},[addr,chain,load])
  return{data,loading,refresh:()=>load()}
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
const $=(n:number):string=>{
  if(n>=1e6)return`$${(n/1e6).toFixed(2)}M`
  if(n>=1e3)return`$${(n/1e3).toFixed(2)}K`
  if(n>=1)return`$${n.toFixed(2)}`
  if(n>0)return`$${n.toFixed(4)}`
  return'$0.00'
}
const fb=(n:number,s:string):string=>{
  if(['USDC','USDT','EURC','DAI'].includes(s))return n.toFixed(2)
  if(['cbBTC','WBTC','tBTC'].includes(s))return n.toFixed(6)
  if(n<0.0001)return n.toFixed(8)
  return n.toFixed(4)
}
const ta=(a:string,s=6,e=4):string=>!a||a.length<s+e+2?a:`${a.slice(0,s)}…${a.slice(-e)}`
const ago=(ts:string|null):string=>{
  if(!ts)return'—'
  const m=Math.floor((Date.now()-new Date(ts).getTime())/60000)
  if(m<1)return'now'
  if(m<60)return`${m}m`
  const h=Math.floor(m/60)
  if(h<24)return`${h}h`
  return`${Math.floor(h/24)}d`
}

// ═══════════════════════════════════════════════════════════
//  TOKEN ICON
// ═══════════════════════════════════════════════════════════
const TK:Record<string,string>={
  ETH:'#627EEA',WETH:'#627EEA',USDC:'#2775CA',USDT:'#26A17B',
  EURC:'#2244aa',cbBTC:'#F7931A',WBTC:'#F7931A',DAI:'#F5AC37',
  cbETH:'#0052FF',wstETH:'#00A3FF',SOL:'#9945FF',TRX:'#FF060A',
  DEGEN:'#845ef7',AERO:'#0091FF',LINK:'#2A5ADA',UNI:'#FF007A',
  AAVE:'#B6509E',ARB:'#28A0F0',OP:'#FF0420',COMP:'#00D395',
}
function TIcon({symbol,logo,size=32}:{symbol:string;logo?:string|null;size?:number}){
  const[err,setErr]=useState(false)
  const c=TK[symbol]??'#5E5E5E'
  if(logo&&!err)return(
    <div style={{width:size,height:size,borderRadius:'50%',border:'1px solid rgba(255,255,255,0.08)',overflow:'hidden',flexShrink:0,background:C.surface}}>
      <img src={logo} alt={symbol} width={size} height={size} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} onError={()=>setErr(true)}/>
    </div>
  )
  return(
    <div style={{width:size,height:size,borderRadius:'50%',background:`${c}18`,border:'1px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:C.D,fontSize:size*0.35,fontWeight:700,color:`${c}aa`,flexShrink:0}}>
      {symbol.slice(0,2)}
    </div>
  )
}

// Skeleton
function Sk({w,h,r=8}:{w:string|number;h:number;r?:number}){
  return<div style={{width:w,height:h,borderRadius:r,background:'linear-gradient(90deg,rgba(255,255,255,0.03) 25%,rgba(255,255,255,0.06) 50%,rgba(255,255,255,0.03) 75%)',backgroundSize:'200% 100%',animation:'rpShimmer 1.8s ease infinite'}}/>
}

// Chart Tooltip
function CTip({active,payload,label}:{active?:boolean;payload?:{value:number}[];label?:string}){
  if(!active||!payload?.length)return null
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px',boxShadow:'0 8px 24px rgba(0,0,0,0.5)'}}>
      <div style={{fontFamily:C.M,fontSize:10,color:C.dim,marginBottom:3}}>
        {label?new Date(label).toLocaleDateString('it-IT',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):''}
      </div>
      <div style={{fontFamily:C.D,fontSize:18,fontWeight:700,color:C.text}}>{$(payload[0].value)}</div>
    </div>
  )
}

// Identicon
function Ident({addr,size=40}:{addr:string;size?:number}){
  const h=addr.toLowerCase().slice(2)
  const h1=parseInt(h.slice(0,6),16)%360
  const h2=(h1+130)%360
  return<div style={{width:size,height:size,borderRadius:12,background:`conic-gradient(from 30deg,hsl(${h1},65%,50%),hsl(${h2},60%,45%),hsl(${h1},65%,50%))`,border:'2px solid rgba(255,255,255,0.08)',flexShrink:0}}/>
}

// ═══════════════════════════════════════════════════════════
//  TOKEN ROW with Smart Tooltip
// ═══════════════════════════════════════════════════════════
function TokenRow({ a, idx, total }: { a: Asset; idx: number; total: number }) {
  const [hover, setHover] = useState(false)
  const price = a.balance > 0 && a.usdValue > 0 ? a.usdValue / a.balance : 0
  const pctPortfolio = total > 0 ? ((a.usdValue / total) * 100) : 0

  return (
    <div
      style={{
        display:'flex', alignItems:'center', padding:'14px 4px',
        borderBottom: idx >= 0 ? `1px solid ${C.border}` : 'none',
        transition:'background 0.1s', position:'relative',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; setHover(true) }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; setHover(false) }}
    >
      <div style={{ flex:1, display:'flex', alignItems:'center', gap:12 }}>
        <TIcon symbol={a.symbol} logo={a.logo} size={36}/>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontFamily:C.D, fontSize:14, fontWeight:600, color:C.text }}>{a.name}</span>
            {a.dac8Monitored && <span style={{ fontFamily:C.M, fontSize:8, color:C.pink, background:`${C.pink}12`, padding:'1px 5px', borderRadius:3 }}>DAC8</span>}
          </div>
          <div style={{ fontFamily:C.M, fontSize:11, color:C.dim, marginTop:1 }}>{a.symbol}</div>
        </div>
      </div>
      <div style={{ width:100, textAlign:'right' as const, fontFamily:C.M, fontSize:13, color:C.sub }}>
        {price > 0 ? $(price) : '—'}
      </div>
      <div style={{ width:120, textAlign:'right' as const, fontFamily:C.M, fontSize:13, fontWeight:600, color:C.text }}>
        {fb(a.balance, a.symbol)}
      </div>
      <div style={{ width:100, textAlign:'right' as const, fontFamily:C.M, fontSize:13, fontWeight:600, color:C.text }}>
        {$(a.usdValue)}
      </div>

      {/* Smart Tooltip */}
      {hover && a.usdValue > 0 && (
        <div style={{
          position:'absolute', top:'100%', right:4, zIndex:50,
          background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
          padding:'12px 16px', minWidth:220,
          boxShadow:'0 12px 32px rgba(0,0,0,0.6)',
          pointerEvents:'none',
        }}>
          <div style={{ fontFamily:C.D, fontSize:11, fontWeight:600, color:C.text, marginBottom:8 }}>
            {a.symbol} — Dettagli
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
            <span style={{ fontFamily:C.M, fontSize:10, color:C.dim }}>Prezzo unitario</span>
            <span style={{ fontFamily:C.M, fontSize:10, color:C.sub }}>{$(price)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
            <span style={{ fontFamily:C.M, fontSize:10, color:C.dim }}>% del portfolio</span>
            <span style={{ fontFamily:C.M, fontSize:10, color:C.sub }}>{pctPortfolio.toFixed(1)}%</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
            <span style={{ fontFamily:C.M, fontSize:10, color:C.dim }}>Giacenza media</span>
            <span style={{ fontFamily:C.M, fontSize:10, color:C.sub }}>{fb(a.balance, a.symbol)} {a.symbol}</span>
          </div>
          {a.dac8Monitored && (
            <div style={{
              display:'flex', alignItems:'center', gap:5, marginTop:6,
              padding:'4px 8px', borderRadius:6,
              background:'rgba(64,182,107,0.06)', border:'1px solid rgba(64,182,107,0.12)',
            }}>
              <span style={{ fontSize:10 }}>✓</span>
              <span style={{ fontFamily:C.M, fontSize:9, color:C.green }}>Monitorato DAC8 — incluso nel report fiscale</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  MOTION — unified cinematic transition
// ═══════════════════════════════════════════════════════════
const smooth = { type:'spring' as const, bounce:0, duration:0.6 }

const tabContent = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
}
const overlay = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
}
const panel = {
  initial: { opacity: 0, scale: 0.97, y: 12 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit:    { opacity: 0, scale: 0.97, y: 12 },
}

// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
interface Props { open:boolean; onClose:()=>void; initialTab?:Tab }

export default function PortfolioDashboard({ open, onClose, initialTab }:Props){
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { data, loading, refresh } = usePortfolio(address, chainId)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview')
  const [range, setRange] = useState<Range>('1D')
  const reg = getRegistry(chainId)
  const ld = loading && !data

  useEffect(() => { if (initialTab && open) setTab(initialTab) }, [initialTab, open])
  useEffect(() => {
    if (!open) return
    const h = (e:KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  const chart = useMemo(() => {
    if (!data?.balanceHistory) return []
    return range === '1D' ? data.balanceHistory.slice(-24) : data.balanceHistory
  }, [data?.balanceHistory, range])

  const pnl = useMemo(() => {
    if (!chart.length) return { v:0, pct:0, up:true }
    const f=chart[0].value, l=chart[chart.length-1].value, d=l-f
    return { v:d, pct:f>0?(d/f)*100:0, up:d>=0 }
  }, [chart])

  const lineColor = pnl.up ? C.green : C.red

  if (!isConnected || !address) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="portfolio-overlay"
          style={{ position:'fixed', inset:0, zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          initial="initial" animate="animate" exit="exit"
        >
          {/* Backdrop */}
          <motion.div
            onClick={onClose}
            variants={overlay}
            transition={smooth}
            style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)' }}
          />

          {/* Panel */}
          <motion.div
            layout="position"
            variants={panel}
            transition={smooth}
            style={{
              position:'relative', zIndex:1, width:'100%', maxWidth:920,
              maxHeight:'calc(100vh - 40px)',
              background:C.bg, border:`1px solid ${C.border}`, borderRadius:20,
              boxShadow:'0 40px 120px rgba(0,0,0,0.8)',
              overflow:'hidden', display:'flex', flexDirection:'column',
            }}
          >

            {/* ── HEADER ──────────────────────────────── */}
            <div style={{ padding:'20px 28px 0', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <Ident addr={address} size={40}/>
                  <span style={{ fontFamily:C.D, fontSize:18, fontWeight:600, color:C.text }}>{ta(address,6,4)}</span>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={refresh} style={{ padding:'8px 16px', borderRadius:20, background:C.surface, border:`1px solid ${C.border}`, color:C.sub, fontFamily:C.D, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                    ↻ Aggiorna
                  </button>
                  <button onClick={onClose} style={{ width:36, height:36, borderRadius:12, background:C.surface, border:`1px solid ${C.border}`, color:C.dim, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                </div>
              </div>

              {/* ── TAB BAR with layoutId indicator ────── */}
              <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${C.border}`, position:'relative' }}>
                {TABS.map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} style={{
                    padding:'12px 20px', background:'transparent', border:'none',
                    color: tab===k ? C.text : C.dim,
                    fontFamily:C.D, fontSize:14, fontWeight: tab===k ? 600 : 400,
                    cursor:'pointer', position:'relative',
                    transition:'color 0.2s ease',
                  }}>
                    {l}
                    {tab === k && (
                      <motion.div
                        layoutId="activeTab"
                        style={{
                          position:'absolute', bottom:-1, left:0, right:0,
                          height:2, background:C.text, borderRadius:1,
                        }}
                        transition={smooth}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ── CONTENT — scrollable + fluid height ──── */}
            <div style={{ flex:1, overflowY:'auto' }}>
            <motion.div
              layout="position"
              initial={false}
              animate={{ height: 'auto' }}
              style={{ overflow:'hidden', position:'relative', minHeight:200 }}
              transition={smooth}
            >
              <div style={{ padding:'24px 28px 28px' }}>
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

          {/* ═══ OVERVIEW ══════════════════════════════════ */}
          {tab==='overview'&&(
            <div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:24, marginBottom:32 }}>
                <div>
                  {ld ? (
                    <div style={{ marginBottom:20 }}><Sk w={180} h={40} r={10}/><div style={{ marginTop:8 }}><Sk w={120} h={18}/></div></div>
                  ) : (
                    <div style={{ marginBottom:20 }}>
                      <div style={{ fontFamily:C.D, fontSize:36, fontWeight:600, color:C.text, letterSpacing:'-0.03em' }}>
                        {$(data?.totalUsd??0)}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
                        <span style={{ color:pnl.up?C.green:C.red, fontSize:13, fontFamily:C.D, fontWeight:500 }}>
                          {pnl.up?'▲':'▼'} {$(Math.abs(pnl.v))} ({pnl.up?'+':''}{pnl.pct.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  )}

                  {ld ? <Sk w="100%" h={200} r={16}/> : (
                    <div style={{ marginBottom:12 }}>
                      <div style={{ width:'100%', height:200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chart} margin={{ top:4, right:0, left:0, bottom:0 }}>
                            <defs>
                              <linearGradient id="uGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={lineColor} stopOpacity={0.15}/>
                                <stop offset="100%" stopColor={lineColor} stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="date" hide/>
                            <YAxis hide domain={['dataMin-5','dataMax+5']}/>
                            <Tooltip content={<CTip/>}/>
                            <Area type="monotone" dataKey="value" stroke={lineColor} strokeWidth={2} fill="url(#uGrad)" dot={false} animationDuration={600}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ display:'flex', gap:4, marginTop:10 }}>
                        {(['1D','1W'] as Range[]).map(r => (
                          <button key={r} onClick={() => setRange(r)} style={{
                            padding:'6px 14px', borderRadius:20,
                            background:range===r?C.surface:'transparent',
                            border:'none', color:range===r?C.text:C.dim,
                            fontFamily:C.D, fontSize:12, fontWeight:600, cursor:'pointer',
                          }}>{r}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {[
                      { label:'Send', icon:'↗', color:C.pink, action:()=>onClose() },
                      { label:'Receive', icon:'↙', color:C.green, action:undefined },
                      { label:'Swap', icon:'⇅', color:C.blue, action:()=>setTab('swap') },
                      { label:'More', icon:'•••', color:C.dim, action:undefined },
                    ].map(a => (
                      <button key={a.label} onClick={a.action} style={{
                        padding:'20px 16px', borderRadius:16,
                        background:C.surface, border:`1px solid ${C.border}`,
                        cursor:'pointer', display:'flex', flexDirection:'column',
                        alignItems:'flex-start', gap:8, transition:'all 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.card}
                      onMouseLeave={e => e.currentTarget.style.background = C.surface}
                      >
                        <span style={{ fontSize:18, color:a.color }}>{a.icon}</span>
                        <span style={{ fontFamily:C.D, fontSize:13, fontWeight:600, color:a.color }}>{a.label}</span>
                      </button>
                    ))}
                  </div>

                  <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div>
                      <div style={{ fontFamily:C.D, fontSize:11, color:C.dim, marginBottom:4 }}>TX this week</div>
                      <div style={{ fontFamily:C.D, fontSize:20, fontWeight:700, color:C.text }}>{data?.txCount7d??0}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily:C.D, fontSize:11, color:C.dim, marginBottom:4 }}>Total value</div>
                      <div style={{ fontFamily:C.D, fontSize:20, fontWeight:700, color:C.text }}>{$(data?.totalUsd??0)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Fiscal Health + Trust Signals ──────────── */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:24 }}>
                <div style={{
                  background:C.surface, border:`1px solid ${C.border}`, borderRadius:16,
                  padding:'16px 18px', display:'flex', alignItems:'center', gap:12,
                }}>
                  <div style={{
                    width:36, height:36, borderRadius:10,
                    background:'rgba(64,182,107,0.08)', border:'1px solid rgba(64,182,107,0.15)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0,
                  }}>🛡</div>
                  <div>
                    <div style={{ fontFamily:C.D, fontSize:12, fontWeight:600, color:C.green }}>
                      Stato Fiscale: Conforme
                    </div>
                    <div style={{ fontFamily:C.M, fontSize:10, color:C.dim, marginTop:2 }}>
                      Tutte le TX monitorate DAC8/MiCA
                    </div>
                  </div>
                </div>
                <div style={{
                  background:C.surface, border:`1px solid ${C.border}`, borderRadius:16,
                  padding:'16px 18px', display:'flex', alignItems:'center', gap:12,
                }}>
                  <div style={{
                    width:36, height:36, borderRadius:10,
                    background:'rgba(76,130,251,0.08)', border:'1px solid rgba(76,130,251,0.15)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0,
                  }}>🔒</div>
                  <div>
                    <div style={{ fontFamily:C.D, fontSize:12, fontWeight:600, color:C.blue }}>
                      Non-Custodial · Encrypted
                    </div>
                    <div style={{ fontFamily:C.M, fontSize:10, color:C.dim, marginTop:2 }}>
                      Chiavi private mai condivise
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                    <div>
                      <span style={{ fontFamily:C.D, fontSize:16, fontWeight:600, color:C.text }}>Tokens</span>
                      <span style={{ fontFamily:C.D, fontSize:12, color:C.dim, marginLeft:8 }}>{data?.assets?.length??0} tokens</span>
                    </div>
                    <button onClick={() => setTab('tokens')} style={{ background:'none', border:'none', color:C.dim, fontFamily:C.D, fontSize:12, cursor:'pointer' }}>View all →</button>
                  </div>
                  {(data?.assets??[]).slice(0,4).map((a:Asset) => (
                    <div key={a.contractAddress+a.symbol} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:`1px solid ${C.border}` }}>
                      <TIcon symbol={a.symbol} logo={a.logo} size={32}/>
                      <div style={{ flex:1 }}>
                        <span style={{ fontFamily:C.D, fontSize:14, fontWeight:600, color:C.text }}>{a.name}</span>
                        {a.dac8Monitored && <span style={{ fontFamily:C.M, fontSize:8, color:C.pink, marginLeft:6, background:`${C.pink}12`, padding:'1px 5px', borderRadius:3 }}>DAC8</span>}
                      </div>
                      <div style={{ textAlign:'right' as const }}>
                        <div style={{ fontFamily:C.M, fontSize:13, fontWeight:600, color:C.text }}>{fb(a.balance,a.symbol)}</div>
                        <div style={{ fontFamily:C.M, fontSize:11, color:C.sub }}>{$(a.usdValue)}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                    <div>
                      <span style={{ fontFamily:C.D, fontSize:16, fontWeight:600, color:C.text }}>Recent activity</span>
                      <span style={{ fontFamily:C.D, fontSize:12, color:C.dim, marginLeft:8 }}>{data?.activity?.length??0} tx</span>
                    </div>
                    <button onClick={() => setTab('activity')} style={{ background:'none', border:'none', color:C.dim, fontFamily:C.D, fontSize:12, cursor:'pointer' }}>View all →</button>
                  </div>
                  {(data?.activity??[]).slice(0,4).map((tx:Tx, i:number) => {
                    const isSend = tx.from?.toLowerCase() === address?.toLowerCase()
                    return (
                      <a key={tx.hash+i} href={`${reg?.blockExplorer??'https://basescan.org'}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                        style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:`1px solid ${C.border}`, textDecoration:'none' }}>
                        <div style={{ width:32, height:32, borderRadius:'50%', background:isSend?'rgba(253,118,107,0.08)':'rgba(64,182,107,0.08)', border:`1px solid ${isSend?'rgba(253,118,107,0.15)':'rgba(64,182,107,0.15)'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:isSend?C.red:C.green, flexShrink:0 }}>
                          {isSend?'↑':'↓'}
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontFamily:C.D, fontSize:13, fontWeight:500, color:C.text }}>{isSend?'Sent':'Received'} {tx.value?.toFixed(4)} {tx.asset}</div>
                          <div style={{ fontFamily:C.M, fontSize:10, color:C.dim, marginTop:2 }}>{isSend?'→':'←'} {ta(isSend?(tx.to??''):(tx.from??''))}</div>
                        </div>
                        <span style={{ fontFamily:C.M, fontSize:10, color:C.dim }}>{ago(tx.timestamp)}</span>
                      </a>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ TOKENS ════════════════════════════════════ */}
          {tab==='tokens' && (
            ld ? (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {[0,1,2,3,4,5].map(i => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'16px 0' }}>
                    <Sk w={36} h={36} r={18}/><div style={{ flex:1 }}><Sk w={100} h={14}/><div style={{ marginTop:4 }}><Sk w={60} h={10}/></div></div>
                    <div style={{ textAlign:'right' }}><Sk w={80} h={14}/><div style={{ marginTop:4 }}><Sk w={50} h={10}/></div></div>
                  </div>
                ))}
              </div>
            ) : (!data?.assets?.length) ? (
              <div style={{ padding:48, textAlign:'center' as const, fontFamily:C.D, fontSize:14, color:C.dim }}>No tokens found</div>
            ) : (
              <div>
                <div style={{ display:'flex', padding:'8px 4px 12px', borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ flex:1, fontFamily:C.D, fontSize:12, color:C.dim, fontWeight:500 }}>Token</span>
                  <span style={{ width:100, textAlign:'right' as const, fontFamily:C.D, fontSize:12, color:C.dim, fontWeight:500 }}>Price</span>
                  <span style={{ width:120, textAlign:'right' as const, fontFamily:C.D, fontSize:12, color:C.dim, fontWeight:500 }}>Balance</span>
                  <span style={{ width:100, textAlign:'right' as const, fontFamily:C.D, fontSize:12, color:C.dim, fontWeight:500 }}>Value</span>
                </div>
                {data.assets.map((a:Asset, i:number) => (
                  <TokenRow key={a.contractAddress+a.symbol} a={a} idx={i < data.assets.length-1 ? i : -1} total={data.totalUsd} />
                ))}
              </div>
            )
          )}

          {/* ═══ ACTIVITY ══════════════════════════════════ */}
          {tab==='activity' && (
            ld ? (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {[0,1,2,3,4,5,6].map(i => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 0' }}>
                    <Sk w={36} h={36} r={18}/><div style={{ flex:1 }}><Sk w={140} h={14}/><div style={{ marginTop:4 }}><Sk w={90} h={10}/></div></div><Sk w={40} h={14}/>
                  </div>
                ))}
              </div>
            ) : (!data?.activity?.length) ? (
              <div style={{ padding:48, textAlign:'center' as const, fontFamily:C.D, fontSize:14, color:C.dim }}>No activity yet</div>
            ) : (
              <div>
                {data.activity.map((tx:Tx, i:number) => {
                  const exp = reg?.blockExplorer ?? 'https://basescan.org'
                  const isSend = tx.from?.toLowerCase() === address?.toLowerCase()
                  return (
                    <a key={tx.hash+i} href={`${exp}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                      style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 4px', borderBottom:i<data.activity.length-1?`1px solid ${C.border}`:'none', textDecoration:'none', transition:'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ width:36, height:36, borderRadius:'50%', background:isSend?'rgba(253,118,107,0.08)':'rgba(64,182,107,0.08)', border:`1px solid ${isSend?'rgba(253,118,107,0.15)':'rgba(64,182,107,0.15)'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:isSend?C.red:C.green, flexShrink:0 }}>
                        {isSend?'↑':'↓'}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontFamily:C.D, fontSize:14, fontWeight:500, color:C.text }}>{isSend?'Sent':'Received'} {tx.value?.toFixed(4)} {tx.asset}</div>
                        <div style={{ fontFamily:C.M, fontSize:10, color:C.dim, marginTop:3 }}>{isSend?'To':'From'}: {ta(isSend?(tx.to??''):(tx.from??''))}</div>
                      </div>
                      <div style={{ textAlign:'right' as const, flexShrink:0 }}>
                        <div style={{ fontFamily:C.M, fontSize:11, color:C.sub }}>{ago(tx.timestamp)}</div>
                        <div style={{ fontFamily:C.M, fontSize:9, color:C.dim, marginTop:2 }}>↗</div>
                      </div>
                    </a>
                  )
                })}
              </div>
            )
          )}

          {/* ═══ SWAP ══════════════════════════════════════ */}
          {tab==='swap' && (
            <div style={{ maxWidth:440, margin:'0 auto' }}>
              <SwapModule onSwapComplete={() => { refresh(); setTimeout(() => setTab('activity'), 1500) }} portfolioAssets={data?.assets} />
            </div>
          )}

          {/* ═══ FORWARD ═══════════════════════════════════ */}
          {tab==='forward' && (
            <div style={{ maxWidth:600, margin:'0 auto' }}>
              <AutoForward />
            </div>
          )}

                </motion.div>
              </AnimatePresence>
              </div>
            </motion.div>
            </div>{/* end scrollable */}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}