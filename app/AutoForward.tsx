'use client'

/**
 * AutoForward.tsx — Sweeper Pipeline Visualization
 *
 * UI per creare regole di auto-forwarding e visualizzare
 * lo stato dei trasferimenti con animazione pipeline.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

const C = {
  bg:'#131313', surface:'#1b1b1b', card:'#1e1e1e',
  border:'rgba(255,255,255,0.07)', text:'#E2E2F0',
  sub:'#98A1C0', dim:'#5E5E5E', pink:'#FC74FE',
  green:'#40B66B', red:'#FD766B', blue:'#4C82FB',
  D:'var(--font-display)', M:'var(--font-mono)',
}

interface Rule {
  id: number; source_wallet: string; destination_wallet: string
  is_active: boolean; min_threshold: number; gas_strategy: string
  max_gas_percent: number; token_symbol: string; chain_id: number
}
interface SweepLog {
  id: number; destination: string; amount: number; token: string
  gas_percent: number | null; status: string; tx_hash: string | null
  trigger_tx: string | null; created_at: string | null
}

function tr(a: string, s=6, e=4): string {
  return !a || a.length < s+e+2 ? a : `${a.slice(0,s)}…${a.slice(-e)}`
}
function ago(ts: string|null): string {
  if (!ts) return '—'
  const m = Math.floor((Date.now()-new Date(ts).getTime())/60000)
  if (m<1) return 'now'
  if (m<60) return `${m}m`
  const h = Math.floor(m/60)
  return h<24 ? `${h}h` : `${Math.floor(h/24)}d`
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFB800', executing: C.blue, completed: C.green,
  failed: C.red, gas_too_high: '#FF8C00',
}

// ═══════════════════════════════════════════════════════════
//  PIPELINE VISUALIZATION
// ═══════════════════════════════════════════════════════════
function Pipeline({ source, dest, status, amount, token }: {
  source: string; dest: string; status: string; amount?: number; token?: string
}) {
  const color = STATUS_COLORS[status] ?? C.dim
  const isActive = ['pending', 'executing'].includes(status)

  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, padding:'16px 0' }}>
      {/* Source box */}
      <div style={{
        padding:'12px 16px', borderRadius:14,
        background:C.surface, border:`1px solid ${C.border}`,
        minWidth:120, textAlign:'center' as const,
      }}>
        <div style={{ fontFamily:C.M, fontSize:9, color:C.dim, marginBottom:4 }}>SOURCE</div>
        <div style={{ fontFamily:C.M, fontSize:11, fontWeight:600, color:C.text }}>{tr(source)}</div>
        {amount && <div style={{ fontFamily:C.M, fontSize:10, color:C.sub, marginTop:2 }}>{amount.toFixed(4)} {token}</div>}
      </div>

      {/* Animated pipeline */}
      <div style={{ flex:1, position:'relative', height:4, margin:'0 -2px' }}>
        <div style={{ position:'absolute', inset:0, background:'rgba(255,255,255,0.04)', borderRadius:2 }} />
        {isActive ? (
          <motion.div
            style={{
              position:'absolute', top:0, left:0, height:'100%', borderRadius:2,
              background:`linear-gradient(90deg, transparent, ${color}, transparent)`,
              width:'40%',
            }}
            animate={{ x: ['0%', '150%'] }}
            transition={{ duration:1.5, repeat:Infinity, ease:'linear' }}
          />
        ) : status === 'completed' ? (
          <motion.div
            style={{
              position:'absolute', top:0, left:0, height:'100%', borderRadius:2,
              background:color, width:'100%',
            }}
            initial={{ scaleX:0, originX:0 }}
            animate={{ scaleX:1 }}
            transition={{ duration:0.5, ease:'easeOut' }}
          />
        ) : (
          <div style={{
            position:'absolute', top:0, left:0, height:'100%',
            background:color, opacity:0.3, width:'100%', borderRadius:2,
          }} />
        )}
      </div>

      {/* Dest box */}
      <div style={{
        padding:'12px 16px', borderRadius:14,
        background: status === 'completed' ? `${C.green}08` : C.surface,
        border:`1px solid ${status === 'completed' ? `${C.green}20` : C.border}`,
        minWidth:120, textAlign:'center' as const,
      }}>
        <div style={{ fontFamily:C.M, fontSize:9, color:C.dim, marginBottom:4 }}>DESTINATION</div>
        <div style={{ fontFamily:C.M, fontSize:11, fontWeight:600, color:C.text }}>{tr(dest)}</div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
interface Props { onClose?: () => void }

export default function AutoForward({ onClose }: Props) {
  const { address } = useAccount()
  const chainId = useChainId()
  const [rules, setRules] = useState<Rule[]>([])
  const [logs, setLogs] = useState<SweepLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [dest, setDest] = useState('')
  const [threshold, setThreshold] = useState('0.001')
  const [gasStrategy, setGasStrategy] = useState('normal')
  const [maxGas, setMaxGas] = useState('10')

  const loadData = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const [rulesRes, logsRes] = await Promise.all([
        fetch(`${BACKEND}/api/v1/forwarding/rules?wallet=${address}`),
        fetch(`${BACKEND}/api/v1/forwarding/logs?wallet=${address}&limit=10`),
      ])
      if (rulesRes.ok) setRules((await rulesRes.json()).rules ?? [])
      if (logsRes.ok) setLogs((await logsRes.json()).logs ?? [])
    } catch {}
    setLoading(false)
  }, [address])

  useEffect(() => { loadData() }, [loadData])

  // Auto-refresh every 15s
  useEffect(() => {
    const iv = setInterval(loadData, 15000)
    return () => clearInterval(iv)
  }, [loadData])

  const createRule = async () => {
    if (!address || !dest) return
    try {
      await fetch(`${BACKEND}/api/v1/forwarding/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_wallet: address,
          destination_wallet: dest,
          min_threshold: parseFloat(threshold),
          gas_strategy: gasStrategy,
          max_gas_percent: parseFloat(maxGas),
          token_symbol: 'ETH',
          chain_id: chainId,
        }),
      })
      setShowCreate(false)
      setDest('')
      loadData()
    } catch {}
  }

  const toggleRule = async (id: number, active: boolean) => {
    await fetch(`${BACKEND}/api/v1/forwarding/rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !active }),
    })
    loadData()
  }

  if (!address) return null

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <div style={{ fontFamily:C.D, fontSize:18, fontWeight:600, color:C.text }}>Auto-Forward</div>
          <div style={{ fontFamily:C.M, fontSize:11, color:C.dim, marginTop:2 }}>
            Trasferimento automatico dei fondi in entrata
          </div>
        </div>
        <button onClick={() => setShowCreate(s => !s)} style={{
          padding:'8px 16px', borderRadius:12,
          background:`${C.blue}10`, border:`1px solid ${C.blue}25`,
          color:C.blue, fontFamily:C.D, fontSize:12, fontWeight:600, cursor:'pointer',
        }}>
          {showCreate ? '✕ Chiudi' : '+ Nuova Regola'}
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}
            transition={{ type:'spring', bounce:0, duration:0.4 }}
            style={{ overflow:'hidden', marginBottom:16 }}
          >
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:18 }}>
              <div style={{ fontFamily:C.D, fontSize:13, fontWeight:600, color:C.text, marginBottom:12 }}>Nuova regola</div>

              {/* Destination */}
              <div style={{ marginBottom:10 }}>
                <label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Destinazione</label>
                <input value={dest} onChange={e => setDest(e.target.value)} placeholder="0x..." style={{
                  width:'100%', padding:'10px 14px', borderRadius:10,
                  background:C.bg, border:`1px solid ${C.border}`, color:C.text,
                  fontFamily:C.M, fontSize:12, outline:'none',
                }} />
              </div>

              {/* Threshold + Gas */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 }}>
                <div>
                  <label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Min ETH</label>
                  <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} style={{
                    width:'100%', padding:'8px 10px', borderRadius:8,
                    background:C.bg, border:`1px solid ${C.border}`, color:C.text,
                    fontFamily:C.M, fontSize:11, outline:'none',
                  }} />
                </div>
                <div>
                  <label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Gas Strategy</label>
                  <select value={gasStrategy} onChange={e => setGasStrategy(e.target.value)} style={{
                    width:'100%', padding:'8px 10px', borderRadius:8,
                    background:C.bg, border:`1px solid ${C.border}`, color:C.text,
                    fontFamily:C.M, fontSize:11, outline:'none',
                  }}>
                    <option value="fast">Fast</option>
                    <option value="normal">Normal</option>
                    <option value="slow">Slow</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontFamily:C.M, fontSize:10, color:C.dim, display:'block', marginBottom:4 }}>Max Gas %</label>
                  <input type="number" value={maxGas} onChange={e => setMaxGas(e.target.value)} style={{
                    width:'100%', padding:'8px 10px', borderRadius:8,
                    background:C.bg, border:`1px solid ${C.border}`, color:C.text,
                    fontFamily:C.M, fontSize:11, outline:'none',
                  }} />
                </div>
              </div>

              <button onClick={createRule} disabled={!dest.startsWith('0x')} style={{
                width:'100%', padding:'12px', borderRadius:12,
                background: dest.startsWith('0x') ? C.blue : 'rgba(255,255,255,0.04)',
                border:'none', color: dest.startsWith('0x') ? '#fff' : C.dim,
                fontFamily:C.D, fontSize:13, fontWeight:600, cursor: dest.startsWith('0x') ? 'pointer' : 'not-allowed',
              }}>
                Crea Regola
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Rules */}
      {rules.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:C.D, fontSize:13, fontWeight:600, color:C.sub, marginBottom:10 }}>
            Regole attive ({rules.filter(r => r.is_active).length})
          </div>
          {rules.map(r => (
            <div key={r.id} style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'12px 14px', borderRadius:14,
              background:C.surface, border:`1px solid ${C.border}`,
              marginBottom:6, opacity: r.is_active ? 1 : 0.4,
            }}>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:C.M, fontSize:11, color:C.text }}>
                  {tr(r.source_wallet)} → {tr(r.destination_wallet)}
                </div>
                <div style={{ fontFamily:C.M, fontSize:9, color:C.dim, marginTop:2 }}>
                  Min: {r.min_threshold} {r.token_symbol} · Gas: {r.gas_strategy} · Max fee: {r.max_gas_percent}%
                </div>
              </div>
              <button onClick={() => toggleRule(r.id, r.is_active)} style={{
                padding:'5px 12px', borderRadius:8,
                background: r.is_active ? `${C.green}10` : 'rgba(255,255,255,0.04)',
                border:`1px solid ${r.is_active ? `${C.green}25` : C.border}`,
                color: r.is_active ? C.green : C.dim,
                fontFamily:C.M, fontSize:10, fontWeight:600, cursor:'pointer',
              }}>
                {r.is_active ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Recent Sweeps with Pipeline */}
      <div>
        <div style={{ fontFamily:C.D, fontSize:13, fontWeight:600, color:C.sub, marginBottom:8 }}>
          Sweep recenti
        </div>

        {loading && logs.length === 0 ? (
          <div style={{ padding:24, textAlign:'center' as const, fontFamily:C.D, fontSize:12, color:C.dim }}>
            Caricamento…
          </div>
        ) : logs.length === 0 ? (
          <div style={{
            padding:32, textAlign:'center' as const,
            background:C.surface, borderRadius:16, border:`1px solid ${C.border}`,
          }}>
            <div style={{ fontSize:24, marginBottom:8 }}>⚡</div>
            <div style={{ fontFamily:C.D, fontSize:13, color:C.dim }}>Nessuno sweep ancora</div>
            <div style={{ fontFamily:C.M, fontSize:10, color:C.dim, marginTop:4, opacity:0.6 }}>
              Crea una regola e invia fondi al wallet sorgente
            </div>
          </div>
        ) : (
          <div>
            {logs.map((log, i) => (
              <motion.div
                key={log.id}
                initial={{ opacity:0, y:10 }}
                animate={{ opacity:1, y:0 }}
                transition={{ delay: i*0.05 }}
              >
                <Pipeline
                  source={address!}
                  dest={log.destination}
                  status={log.status}
                  amount={log.amount}
                  token={log.token}
                />

                {/* Status + Details row */}
                <div style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'0 8px 12px',
                  borderBottom: i < logs.length-1 ? `1px solid ${C.border}` : 'none',
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{
                      width:6, height:6, borderRadius:'50%',
                      background: STATUS_COLORS[log.status] ?? C.dim,
                      boxShadow: `0 0 4px ${STATUS_COLORS[log.status] ?? C.dim}40`,
                    }} />
                    <span style={{
                      fontFamily:C.M, fontSize:10, fontWeight:600,
                      color: STATUS_COLORS[log.status] ?? C.dim,
                      textTransform:'uppercase' as const,
                    }}>{log.status}</span>
                    {log.gas_percent && (
                      <span style={{ fontFamily:C.M, fontSize:9, color:C.dim }}>
                        · Gas: {log.gas_percent.toFixed(1)}%
                      </span>
                    )}
                  </div>

                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontFamily:C.M, fontSize:9, color:C.dim }}>{ago(log.created_at)}</span>
                    {log.tx_hash && (
                      <a href={`https://basescan.org/tx/${log.tx_hash}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontFamily:C.M, fontSize:9, color:C.sub, textDecoration:'none' }}>
                        ↗ TX
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
