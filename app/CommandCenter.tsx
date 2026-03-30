'use client'

/**
 * CommandCenter.tsx — Full Command Center with 4 tabs
 *
 * Configure: Rule CRUD, split slider, pipeline preview
 * Monitor:   Status cards, live WebSocket feed, emergency stop
 * History:   Filterable log table, pagination, export
 * Analytics: Charts (AreaChart, PieChart, BarChart), stat cards
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'

import StatusCards from './StatusCards'
import RuleCard from './RuleCard'
import SplitSlider from './SplitSlider'
import SweepFeed from './SweepFeed'
import EmergencyStop from './EmergencyStop'

import { useForwardingRules, type CreateRulePayload } from '../lib/useForwardingRules'
import { useSweepWebSocket } from '../lib/useSweepWebSocket'
import { useSweepStats } from '../lib/useSweepStats'

// ═══════════════════════════════════════════════════════════
//  PALETTE & CONSTANTS
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

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

type Tab = 'configure' | 'monitor' | 'history' | 'analytics'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'configure', label: 'Configure', icon: '\u2699' },
  { key: 'monitor',   label: 'Monitor',   icon: '\u25C9' },
  { key: 'history',   label: 'History',   icon: '\u2630' },
  { key: 'analytics', label: 'Analytics', icon: '\u2197' },
]

const TOKEN_OPTIONS = ['ETH', 'USDC', 'USDT', 'DAI', 'WETH', 'cbBTC']
const STATUS_OPTIONS = ['completed', 'failed', 'pending', 'executing', 'gas_too_high', 'skipped']

const smooth = { type: 'spring' as const, bounce: 0, duration: 0.5 }
const tabContent = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFB547', executing: '#3B82F6', completed: '#00D68F',
  failed: '#FF4C6A', gas_too_high: '#FF8C00', skipped: '#8A8FA8',
}

const PIE_COLORS = [C.blue, C.green, C.purple, C.amber, C.red, '#06B6D4']

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function tr(a: string, s = 6, e = 4): string {
  return !a || a.length < s + e + 2 ? a : `${a.slice(0, s)}...${a.slice(-e)}`
}

function ago(ts: string | null): string {
  if (!ts) return '--'
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ═══════════════════════════════════════════════════════════
//  SKELETON
// ═══════════════════════════════════════════════════════════

function Sk({ w, h, r = 8 }: { w: string | number; h: number; r?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
      backgroundSize: '200% 100%',
      animation: 'rpShimmer 1.8s ease infinite',
    }} />
  )
}

function TabSkeleton() {
  return (
    <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Sk w="100%" h={60} r={14} />
      <Sk w="100%" h={80} r={14} />
      <Sk w="60%" h={14} />
      <Sk w="100%" h={60} r={14} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
//  INPUT STYLES
// ═══════════════════════════════════════════════════════════

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10,
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)',
  border: `1px solid ${C.border}`,
  color: C.text, fontFamily: C.M, fontSize: 12, outline: 'none',
}

const selectStyle: React.CSSProperties = { ...inp, appearance: 'none' as const }

const labelStyle: React.CSSProperties = {
  fontFamily: C.M, fontSize: 9, color: C.dim,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  display: 'block', marginBottom: 4,
}

// ═══════════════════════════════════════════════════════════
//  CUSTOM TOOLTIP FOR CHARTS
// ═══════════════════════════════════════════════════════════

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#1a1a24', border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '8px 12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    }}>
      <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ fontFamily: C.M, fontSize: 11, color: p.color || C.text }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}
        </div>
      ))}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function CommandCenter() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()

  const [tab, setTab] = useState<Tab>('configure')
  const [tabLoading, setTabLoading] = useState(false)

  // ── Hooks ──────────────────────────────────────────────
  const {
    rules, loading: rulesLoading,
    createRule, updateRule, deleteRule,
    pauseRule, resumeRule, emergencyStop,
  } = useForwardingRules(address)

  const { events, connected } = useSweepWebSocket(address)
  const { stats, daily, loading: statsLoading } = useSweepStats(address)

  // ── Gas price (independent RPC fetch) ─────────────────
  const [gas, setGas] = useState<number | null>(null)
  useEffect(() => {
    const f = async () => {
      try {
        const r = await fetch('https://mainnet.base.org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
        })
        setGas(parseInt((await r.json()).result, 16) / 1e9)
      } catch { /* */ }
    }
    f()
    const iv = setInterval(f, 15000)
    return () => clearInterval(iv)
  }, [])

  // ── Tab switch ────────────────────────────────────────
  const switchTab = (t: Tab) => {
    if (t === tab) return
    setTabLoading(true)
    setTab(t)
    setTimeout(() => setTabLoading(false), 300)
  }

  // ── Derived stats ─────────────────────────────────────
  const activeRules = rules.filter(r => r.is_active && !r.is_paused).length

  // ── Not connected ─────────────────────────────────────
  if (!isConnected) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontFamily: C.D, fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          Connect wallet
        </div>
        <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}>
          To access Command Center
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '8px 10px 10px' }}>
      {/* ═══════════════════════════════════════════════
          STATS SUMMARY BAR — always visible
         ═══════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: '6px 12px', marginBottom: 8,
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 10,
        border: `1px solid ${C.border}`,
      }}>
        {[
          { label: 'Sweeps', value: stats ? String(stats.total_sweeps) : '--', color: C.blue },
          { label: 'Vol 24h', value: stats ? `${stats.total_volume_eth.toFixed(4)} ETH` : '--', color: C.purple },
          { label: 'Rules', value: String(activeRules), color: C.green },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: s.color, boxShadow: `0 0 4px ${s.color}50` }} />
            <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
            <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 700, color: C.text }}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════
          TAB BAR
         ═══════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: `1px solid ${C.border}`,
        marginBottom: 12,
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            style={{
              flex: 1, padding: '10px 0',
              background: 'transparent', border: 'none',
              color: tab === t.key ? C.text : C.dim,
              fontFamily: C.D, fontSize: 11, fontWeight: tab === t.key ? 700 : 500,
              cursor: 'pointer', position: 'relative',
              transition: 'color 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            <span style={{ fontSize: 12 }}>{t.icon}</span>
            {t.label}
            {tab === t.key && (
              <motion.div
                layoutId="ccTab"
                style={{
                  position: 'absolute', bottom: -1, left: '10%', right: '10%',
                  height: 2, borderRadius: 1,
                  background: `linear-gradient(90deg, ${C.red}, ${C.purple})`,
                }}
                transition={smooth}
              />
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════
          TAB CONTENT
         ═══════════════════════════════════════════════ */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={tab}
          variants={tabContent}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={smooth}
        >
          {tabLoading ? <TabSkeleton /> : (
            <>
              {tab === 'configure' && (
                <ConfigureTab
                  address={address!}
                  chainId={chainId}
                  rules={rules}
                  loading={rulesLoading}
                  createRule={createRule}
                  updateRule={updateRule}
                  deleteRule={deleteRule}
                  pauseRule={pauseRule}
                  resumeRule={resumeRule}
                />
              )}
              {tab === 'monitor' && (
                <MonitorTab
                  gas={gas}
                  stats={stats}
                  activeRules={activeRules}
                  events={events}
                  connected={connected}
                  emergencyStop={emergencyStop}
                />
              )}
              {tab === 'history' && (
                <HistoryTab address={address!} />
              )}
              {tab === 'analytics' && (
                <AnalyticsTab stats={stats} daily={daily} loading={statsLoading} />
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  CONFIGURE TAB
// ═══════════════════════════════════════════════════════════

function ConfigureTab({
  address, chainId, rules, loading,
  createRule, updateRule, deleteRule, pauseRule, resumeRule,
}: {
  address: string
  chainId: number
  rules: any[]
  loading: boolean
  createRule: (p: CreateRulePayload) => Promise<any>
  updateRule: (id: number, u: Record<string, any>) => Promise<void>
  deleteRule: (id: number) => Promise<void>
  pauseRule: (id: number) => Promise<void>
  resumeRule: (id: number) => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [dest, setDest] = useState('')
  const [label, setLabel] = useState('')
  const [threshold, setThreshold] = useState('0.001')
  const [gasStrategy, setGasStrategy] = useState('normal')
  const [maxGas, setMaxGas] = useState('10')
  const [gasLimit, setGasLimit] = useState('50')
  const [cooldown, setCooldown] = useState('60')
  const [maxDailyVol, setMaxDailyVol] = useState('')
  const [tokenSymbol, setTokenSymbol] = useState('ETH')
  const [tokenFilter, setTokenFilter] = useState<string[]>([])

  // Split
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [splitPct, setSplitPct] = useState(70)
  const [dest2, setDest2] = useState('')

  // Auto-swap
  const [autoSwap, setAutoSwap] = useState(false)
  const [swapTo, setSwapTo] = useState('')

  // Notifications
  const [notifyEnabled, setNotifyEnabled] = useState(true)
  const [notifyChannel, setNotifyChannel] = useState('telegram')
  const [chatId, setChatId] = useState('')
  const [email, setEmail] = useState('')

  // Schedule
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [schedDays, setSchedDays] = useState<string[]>([])
  const [schedFrom, setSchedFrom] = useState('09:00')
  const [schedTo, setSchedTo] = useState('18:00')

  const resetForm = () => {
    setDest(''); setLabel(''); setThreshold('0.001'); setGasStrategy('normal')
    setMaxGas('10'); setGasLimit('50'); setCooldown('60'); setMaxDailyVol('')
    setTokenSymbol('ETH'); setTokenFilter([]); setSplitEnabled(false); setSplitPct(70)
    setDest2(''); setAutoSwap(false); setSwapTo(''); setNotifyEnabled(true)
    setNotifyChannel('telegram'); setChatId(''); setEmail('')
    setScheduleEnabled(false); setSchedDays([]); setSchedFrom('09:00'); setSchedTo('18:00')
    setError(null)
  }

  const handleCreate = async () => {
    if (!dest.startsWith('0x') || dest.length !== 42) {
      setError('Invalid destination address')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: CreateRulePayload = {
        owner_address: address,
        source_wallet: address,
        destination_wallet: dest,
        label: label || undefined,
        min_threshold: parseFloat(threshold) || 0.001,
        gas_strategy: gasStrategy,
        max_gas_percent: parseFloat(maxGas) || 10,
        gas_limit_gwei: parseInt(gasLimit) || 50,
        cooldown_sec: parseInt(cooldown) || 60,
        max_daily_vol: maxDailyVol ? parseFloat(maxDailyVol) : undefined,
        token_symbol: tokenSymbol,
        token_filter: tokenFilter.length > 0 ? tokenFilter : undefined,
        split_enabled: splitEnabled,
        split_percent: splitEnabled ? splitPct : 100,
        split_destination: splitEnabled ? dest2 : undefined,
        auto_swap: autoSwap,
        swap_to_token: autoSwap && swapTo.startsWith('0x') ? swapTo : undefined,
        notify_enabled: notifyEnabled,
        notify_channel: notifyChannel,
        telegram_chat_id: notifyChannel === 'telegram' && chatId ? chatId : undefined,
        email_address: notifyChannel === 'email' && email ? email : undefined,
        schedule_json: scheduleEnabled ? { days: schedDays, from: schedFrom, to: schedTo, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined,
        chain_id: chainId,
      }
      await createRule(payload)
      resetForm()
      setShowForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create rule')
    }
    setSaving(false)
  }

  const handleToggle = async (id: number, active: boolean) => {
    try { await updateRule(id, { is_active: !active }) } catch {}
  }

  const okToSave = dest.startsWith('0x') && dest.length === 42 && !saving

  return (
    <div>
      {/* New Rule button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.sub }}>
          {rules.length} Rule{rules.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => { setShowForm(s => !s); if (showForm) resetForm() }}
          style={{
            padding: '6px 14px', borderRadius: 10,
            background: showForm ? 'rgba(255,255,255,0.06)' : `${C.purple}10`,
            border: `1px solid ${showForm ? C.border : `${C.purple}25`}`,
            color: showForm ? C.dim : C.purple,
            fontFamily: C.D, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {showForm ? '\u2715 Cancel' : '+ New Rule'}
        </button>
      </div>

      {/* ── CREATE FORM ────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
            style={{ overflow: 'hidden', marginBottom: 12 }}
          >
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              border: `1px solid rgba(255,255,255,0.08)`,
              borderRadius: 16, padding: 16,
            }}>
              {/* Label */}
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Label (optional)</label>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="My savings rule" style={inp} />
              </div>

              {/* Destination */}
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Destination</label>
                <input value={dest} onChange={e => setDest(e.target.value)} placeholder="0x..." style={inp} />
              </div>

              {/* Split routing toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: splitEnabled ? 8 : 10 }}>
                <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Split Routing</span>
                <ToggleSwitch value={splitEnabled} onChange={setSplitEnabled} />
              </div>

              {splitEnabled && (
                <div style={{ marginBottom: 10 }}>
                  <SplitSlider value={splitPct} onChange={setSplitPct} dest1={dest || undefined} dest2={dest2 || undefined} />
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>Split Destination ({100 - splitPct}%)</label>
                    <input value={dest2} onChange={e => setDest2(e.target.value)} placeholder="0x..." style={inp} />
                  </div>
                </div>
              )}

              {/* Pipeline preview */}
              {dest.startsWith('0x') && (
                <PipelinePreview
                  source={address}
                  dest1={dest}
                  dest2={splitEnabled ? dest2 : undefined}
                  pct={splitEnabled ? splitPct : 100}
                />
              )}

              {/* Token & Threshold */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div>
                  <label style={labelStyle}>Token</label>
                  <select value={tokenSymbol} onChange={e => setTokenSymbol(e.target.value)} style={selectStyle}>
                    {TOKEN_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Min Threshold</label>
                  <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} step="0.001" style={inp} />
                </div>
              </div>

              {/* Gas config */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div>
                  <label style={labelStyle}>Gas Strategy</label>
                  <select value={gasStrategy} onChange={e => setGasStrategy(e.target.value)} style={selectStyle}>
                    <option value="fast">Fast</option>
                    <option value="normal">Normal</option>
                    <option value="slow">Slow</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Max Gas %</label>
                  <input type="number" value={maxGas} onChange={e => setMaxGas(e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={labelStyle}>Gas Limit (gwei)</label>
                  <input type="number" value={gasLimit} onChange={e => setGasLimit(e.target.value)} style={inp} />
                </div>
              </div>

              {/* Cooldown & Daily Vol */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Cooldown (sec)</label>
                  <input type="number" value={cooldown} onChange={e => setCooldown(e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={labelStyle}>Max Daily Vol</label>
                  <input type="number" value={maxDailyVol} onChange={e => setMaxDailyVol(e.target.value)} placeholder="No limit" style={inp} />
                </div>
              </div>

              {/* Token Filter */}
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Token Filter (accept these tokens)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {TOKEN_OPTIONS.map(t => {
                    const on = tokenFilter.includes(t)
                    return (
                      <button
                        key={t}
                        onClick={() => setTokenFilter(prev => on ? prev.filter(x => x !== t) : [...prev, t])}
                        style={{
                          padding: '4px 10px', borderRadius: 8,
                          background: on ? `${C.purple}15` : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${on ? `${C.purple}30` : C.border}`,
                          color: on ? C.purple : C.dim,
                          fontFamily: C.M, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Auto-swap toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: autoSwap ? 8 : 10 }}>
                <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Auto-Swap</span>
                <ToggleSwitch value={autoSwap} onChange={setAutoSwap} />
              </div>
              {autoSwap && (
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Swap To Token Address</label>
                  <input value={swapTo} onChange={e => setSwapTo(e.target.value)} placeholder="0x..." style={inp} />
                </div>
              )}

              {/* Notifications */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: notifyEnabled ? 8 : 10 }}>
                <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Notifications</span>
                <ToggleSwitch value={notifyEnabled} onChange={setNotifyEnabled} />
              </div>
              {notifyEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 6, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>Channel</label>
                    <select value={notifyChannel} onChange={e => setNotifyChannel(e.target.value)} style={selectStyle}>
                      <option value="telegram">Telegram</option>
                      <option value="email">Email</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>{notifyChannel === 'telegram' ? 'Chat ID' : 'Email'}</label>
                    {notifyChannel === 'telegram' ? (
                      <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="123456789" style={inp} />
                    ) : (
                      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" style={inp} />
                    )}
                  </div>
                </div>
              )}

              {/* Schedule */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: scheduleEnabled ? 8 : 10 }}>
                <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Schedule</span>
                <ToggleSwitch value={scheduleEnabled} onChange={setScheduleEnabled} />
              </div>
              {scheduleEnabled && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => {
                      const on = schedDays.includes(d.toLowerCase())
                      return (
                        <button
                          key={d}
                          onClick={() => setSchedDays(prev => on ? prev.filter(x => x !== d.toLowerCase()) : [...prev, d.toLowerCase()])}
                          style={{
                            padding: '4px 8px', borderRadius: 6,
                            background: on ? `${C.blue}15` : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${on ? `${C.blue}30` : C.border}`,
                            color: on ? C.blue : C.dim,
                            fontFamily: C.M, fontSize: 9, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          {d}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div>
                      <label style={labelStyle}>From</label>
                      <input type="time" value={schedFrom} onChange={e => setSchedFrom(e.target.value)} style={inp} />
                    </div>
                    <div>
                      <label style={labelStyle}>To</label>
                      <input type="time" value={schedTo} onChange={e => setSchedTo(e.target.value)} style={inp} />
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div style={{ fontFamily: C.M, fontSize: 10, color: C.red, marginBottom: 8, padding: '6px 10px', background: `${C.red}08`, borderRadius: 8 }}>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleCreate}
                disabled={!okToSave}
                style={{
                  width: '100%', padding: '14px', borderRadius: 14, border: 'none',
                  background: okToSave ? `linear-gradient(135deg, ${C.red}, ${C.purple})` : 'rgba(255,255,255,0.04)',
                  color: okToSave ? '#fff' : 'rgba(255,255,255,0.35)',
                  fontFamily: C.D, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em',
                  cursor: okToSave ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                  boxShadow: okToSave ? `0 4px 20px ${C.purple}25` : 'none',
                }}
              >
                {saving ? 'Creating...' : 'Create Rule'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── RULES LIST ─────────────────────────────── */}
      {loading && rules.length === 0 ? (
        <TabSkeleton />
      ) : rules.length === 0 ? (
        <div style={{
          padding: 28, textAlign: 'center',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 14, border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontFamily: C.D, fontSize: 13, color: C.dim, marginBottom: 4 }}>No rules yet</div>
          <div style={{ fontFamily: C.M, fontSize: 10, color: `${C.dim}80` }}>
            Create your first forwarding rule to get started
          </div>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {rules.map(r => (
            <RuleCard
              key={r.id}
              rule={r}
              onToggle={handleToggle}
              onPause={pauseRule}
              onResume={resumeRule}
              onDelete={deleteRule}
            />
          ))}
        </AnimatePresence>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  PIPELINE PREVIEW (Configure tab)
// ═══════════════════════════════════════════════════════════

function PipelinePreview({ source, dest1, dest2, pct }: {
  source: string; dest1: string; dest2?: string; pct: number
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '10px 12px', marginBottom: 10,
    }}>
      <svg width="100%" height={dest2 ? 60 : 36} viewBox={`0 0 320 ${dest2 ? 60 : 36}`}>
        {/* Source node */}
        <rect x="0" y={dest2 ? 20 : 8} width="60" height="20" rx="6" fill={`${C.purple}20`} stroke={C.purple} strokeWidth="0.5" />
        <text x="30" y={dest2 ? 34 : 22} textAnchor="middle" fill={C.text} fontSize="7" fontFamily="var(--font-mono)">
          {source.slice(0, 6)}...
        </text>

        {/* Primary path */}
        <line x1="60" y1={dest2 ? 30 : 18} x2="200" y2={dest2 ? 18 : 18} stroke={C.purple} strokeWidth="1" strokeDasharray="4 2">
          <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1.5s" repeatCount="indefinite" />
        </line>
        <rect x="200" y={dest2 ? 8 : 8} width="60" height="20" rx="6" fill={`${C.green}15`} stroke={C.green} strokeWidth="0.5" />
        <text x="230" y={dest2 ? 22 : 22} textAnchor="middle" fill={C.text} fontSize="7" fontFamily="var(--font-mono)">
          {dest1.slice(0, 6)}...
        </text>
        <text x="270" y={dest2 ? 22 : 22} textAnchor="start" fill={C.purple} fontSize="6" fontFamily="var(--font-mono)">
          {pct}%
        </text>

        {/* Split path */}
        {dest2 && dest2.startsWith('0x') && (
          <>
            <line x1="60" y1="30" x2="200" y2="48" stroke={C.blue} strokeWidth="1" strokeDasharray="4 2">
              <animate attributeName="stroke-dashoffset" from="6" to="0" dur="1.5s" repeatCount="indefinite" />
            </line>
            <rect x="200" y="38" width="60" height="20" rx="6" fill={`${C.blue}15`} stroke={C.blue} strokeWidth="0.5" />
            <text x="230" y="52" textAnchor="middle" fill={C.text} fontSize="7" fontFamily="var(--font-mono)">
              {dest2.slice(0, 6)}...
            </text>
            <text x="270" y="52" textAnchor="start" fill={C.blue} fontSize="6" fontFamily="var(--font-mono)">
              {100 - pct}%
            </text>
          </>
        )}
      </svg>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  MONITOR TAB
// ═══════════════════════════════════════════════════════════

function MonitorTab({ gas, stats, activeRules, events, connected, emergencyStop }: {
  gas: number | null
  stats: any
  activeRules: number
  events: any[]
  connected: boolean
  emergencyStop: () => Promise<any>
}) {
  return (
    <div>
      <StatusCards
        gas={gas}
        sweeps24h={stats?.total_sweeps ?? 0}
        volume24h={stats ? stats.total_volume_eth.toFixed(4) : '--'}
        activeRules={activeRules}
      />
      <SweepFeed events={events} connected={connected} />
      <EmergencyStop onStop={emergencyStop} activeCount={activeRules} />
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  HISTORY TAB
// ═══════════════════════════════════════════════════════════

interface LogEntry {
  id: number
  rule_id: number
  source_wallet: string
  destination_wallet: string
  amount_human: number
  amount_usd: number | null
  token_symbol: string
  gas_cost_eth: number | null
  gas_percent: number | null
  status: string
  tx_hash: string | null
  created_at: string | null
  executed_at: string | null
  is_split: boolean
  split_percent: number
  error_message: string | null
  retry_count: number
}

function HistoryTab({ address }: { address: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)

  // Filters
  const [fToken, setFToken] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fDateFrom, setFDateFrom] = useState('')
  const [fDateTo, setFDateTo] = useState('')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        owner_address: address.toLowerCase(),
        page: String(page),
        per_page: '15',
      })
      if (fToken) params.set('token', fToken)
      if (fStatus) params.set('status', fStatus)
      if (fDateFrom) params.set('date_from', new Date(fDateFrom).toISOString())
      if (fDateTo) params.set('date_to', new Date(fDateTo).toISOString())

      const res = await fetch(`${BACKEND}/api/v1/forwarding/logs?${params}`, {
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs ?? [])
        setTotalPages(data.pagination?.pages ?? 0)
        setTotal(data.pagination?.total ?? 0)
      }
    } catch { /* */ }
    setLoading(false)
  }, [address, page, fToken, fStatus, fDateFrom, fDateTo])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const exportUrl = (fmt: string) => {
    const params = new URLSearchParams({
      owner_address: address.toLowerCase(),
      format: fmt,
    })
    if (fToken) params.set('token', fToken)
    if (fStatus) params.set('status', fStatus)
    if (fDateFrom) params.set('date_from', new Date(fDateFrom).toISOString())
    if (fDateTo) params.set('date_to', new Date(fDateTo).toISOString())
    return `${BACKEND}/api/v1/forwarding/logs/export?${params}`
  }

  return (
    <div>
      {/* Summary bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.sub }}>
          {total} transaction{total !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <a href={exportUrl('csv')} target="_blank" rel="noopener noreferrer" style={{
            padding: '4px 10px', borderRadius: 8,
            background: `${C.blue}10`, border: `1px solid ${C.blue}20`,
            color: C.blue, fontFamily: C.M, fontSize: 9, fontWeight: 600,
            textDecoration: 'none', cursor: 'pointer',
          }}>CSV</a>
          <a href={exportUrl('json')} target="_blank" rel="noopener noreferrer" style={{
            padding: '4px 10px', borderRadius: 8,
            background: `${C.purple}10`, border: `1px solid ${C.purple}20`,
            color: C.purple, fontFamily: C.M, fontSize: 9, fontWeight: 600,
            textDecoration: 'none', cursor: 'pointer',
          }}>JSON</a>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Token</label>
          <select value={fToken} onChange={e => { setFToken(e.target.value); setPage(1) }} style={selectStyle}>
            <option value="">All</option>
            {TOKEN_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select value={fStatus} onChange={e => { setFStatus(e.target.value); setPage(1) }} style={selectStyle}>
            <option value="">All</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>From</label>
          <input type="date" value={fDateFrom} onChange={e => { setFDateFrom(e.target.value); setPage(1) }} style={inp} />
        </div>
        <div>
          <label style={labelStyle}>To</label>
          <input type="date" value={fDateTo} onChange={e => { setFDateTo(e.target.value); setPage(1) }} style={inp} />
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${C.border}`,
        borderRadius: 14, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '80px 50px 70px 1fr 65px 48px 60px',
          gap: 4, padding: '8px 12px',
          borderBottom: `1px solid ${C.border}`,
          background: 'rgba(255,255,255,0.02)',
        }}>
          {['Time', 'Token', 'Amount', 'From \u2192 To', 'TX', 'Gas', 'Status'].map(h => (
            <span key={h} style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {h}
            </span>
          ))}
        </div>

        {/* Rows */}
        {loading && logs.length === 0 ? (
          <div style={{ padding: 16 }}>
            {[1, 2, 3].map(i => <Sk key={i} w="100%" h={28} r={6} />)}
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontFamily: C.D, fontSize: 12, color: C.dim }}>No transactions found</div>
          </div>
        ) : (
          logs.map((l, i) => {
            const sc = STATUS_COLORS[l.status] ?? C.dim
            return (
              <div
                key={l.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 50px 70px 1fr 65px 48px 60px',
                  gap: 4, padding: '8px 12px',
                  borderBottom: i < logs.length - 1 ? `1px solid ${C.border}` : 'none',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{fmtDate(l.created_at)}</span>
                <span style={{ fontFamily: C.M, fontSize: 10, color: C.text, fontWeight: 600 }}>{l.token_symbol}</span>
                <span style={{ fontFamily: C.M, fontSize: 10, color: C.text }}>
                  {l.amount_human?.toFixed(4)}
                </span>
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tr(l.source_wallet)} -&gt; {tr(l.destination_wallet)}
                </span>
                <span>
                  {l.tx_hash ? (
                    <a
                      href={`https://basescan.org/tx/${l.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: C.M, fontSize: 9, color: C.blue, textDecoration: 'none' }}
                    >
                      {l.tx_hash.slice(0, 8)}...
                    </a>
                  ) : (
                    <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>--</span>
                  )}
                </span>
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>
                  {l.gas_cost_eth != null ? `${l.gas_cost_eth.toFixed(5)}` : '--'}
                </span>
                <span style={{
                  fontFamily: C.M, fontSize: 8, fontWeight: 600, color: sc,
                  textTransform: 'uppercase',
                  background: `${sc}10`, padding: '2px 6px', borderRadius: 4,
                  textAlign: 'center',
                }}>
                  {l.status}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
          <PaginationBtn label="\u2190" disabled={page <= 1} onClick={() => setPage(p => p - 1)} />
          <span style={{ fontFamily: C.M, fontSize: 11, color: C.sub }}>
            {page} / {totalPages}
          </span>
          <PaginationBtn label="\u2192" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} />
        </div>
      )}
    </div>
  )
}

function PaginationBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px', borderRadius: 8,
        background: disabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${C.border}`,
        color: disabled ? C.dim : C.text,
        fontFamily: C.M, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}


// ═══════════════════════════════════════════════════════════
//  ANALYTICS TAB
// ═══════════════════════════════════════════════════════════

function AnalyticsTab({ stats, daily, loading }: {
  stats: any; daily: any[]; loading: boolean
}) {
  // Per-token breakdown from logs (best effort)
  const [tokenBreakdown, setTokenBreakdown] = useState<{ name: string; value: number }[]>([])
  const { address } = useAccount()

  useEffect(() => {
    if (!address) return
    const f = async () => {
      try {
        const res = await fetch(
          `${BACKEND}/api/v1/forwarding/logs?owner_address=${address.toLowerCase()}&per_page=100`,
          { signal: AbortSignal.timeout(15000) }
        )
        if (!res.ok) return
        const data = await res.json()
        const logs = data.logs ?? []
        const map: Record<string, number> = {}
        for (const l of logs) {
          const sym = l.token_symbol || 'ETH'
          map[sym] = (map[sym] || 0) + (l.amount_human || 0)
        }
        setTokenBreakdown(
          Object.entries(map)
            .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(4)) }))
            .sort((a, b) => b.value - a.value)
        )
      } catch { /* */ }
    }
    f()
  }, [address])

  if (loading) return <TabSkeleton />

  const s = stats ?? {
    total_sweeps: 0, completed: 0, failed: 0,
    total_volume_eth: 0, total_gas_spent_eth: 0,
    success_rate: 0, avg_sweep_time_sec: null,
  }

  const statCards = [
    { label: 'Total Forwarded', value: `${s.total_volume_eth.toFixed(4)} ETH`, color: C.purple },
    { label: 'Gas Saved', value: `${s.total_gas_spent_eth.toFixed(6)} ETH`, color: C.green },
    { label: 'Success Rate', value: `${s.success_rate}%`, color: s.success_rate >= 90 ? C.green : s.success_rate >= 70 ? C.amber : C.red },
    { label: 'Avg Time', value: s.avg_sweep_time_sec != null ? `${s.avg_sweep_time_sec.toFixed(1)}s` : '--', color: C.blue },
  ]

  // Status breakdown for donut
  const statusBreakdown = [
    { name: 'Completed', value: s.completed, color: C.green },
    { name: 'Failed', value: s.failed, color: C.red },
    { name: 'Other', value: Math.max(0, s.total_sweeps - s.completed - s.failed), color: C.amber },
  ].filter(x => x.value > 0)

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {statCards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, ...smooth }}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '12px 14px',
            }}
          >
            <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{ fontFamily: C.D, fontSize: 16, fontWeight: 700, color: c.color }}>
              {c.value}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Volume AreaChart */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '14px 12px 4px', marginBottom: 14,
      }}>
        <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 10 }}>
          Daily Volume (30d)
        </div>
        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ccVolumeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.purple} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                hide
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip content={<ChartTip />} />
              <Area
                type="monotone"
                dataKey="volume_eth"
                name="Volume (ETH)"
                stroke={C.purple}
                strokeWidth={2}
                fill="url(#ccVolumeGrad)"
                dot={false}
                animationDuration={600}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}>No data yet</span>
          </div>
        )}
      </div>

      {/* Two columns: PieChart + BarChart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {/* Token Breakdown PieChart */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '14px 8px',
        }}>
          <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 8, paddingLeft: 4 }}>
            Token Split
          </div>
          {tokenBreakdown.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ResponsiveContainer width={80} height={80}>
                <PieChart>
                  <Pie
                    data={tokenBreakdown}
                    dataKey="value"
                    innerRadius={20}
                    outerRadius={35}
                    paddingAngle={2}
                    strokeWidth={0}
                    animationDuration={600}
                  >
                    {tokenBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {tokenBreakdown.map((t, i) => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span style={{ fontFamily: C.M, fontSize: 9, color: C.text }}>{t.name}</span>
                    <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginLeft: 'auto' }}>{t.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>No data</span>
            </div>
          )}
        </div>

        {/* Status Breakdown */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '14px 8px',
        }}>
          <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 8, paddingLeft: 4 }}>
            Status
          </div>
          {statusBreakdown.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ResponsiveContainer width={80} height={80}>
                <PieChart>
                  <Pie
                    data={statusBreakdown}
                    dataKey="value"
                    innerRadius={20}
                    outerRadius={35}
                    paddingAngle={2}
                    strokeWidth={0}
                    animationDuration={600}
                  >
                    {statusBreakdown.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {statusBreakdown.map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                    <span style={{ fontFamily: C.M, fontSize: 9, color: C.text }}>{s.name}</span>
                    <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginLeft: 'auto' }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>No data</span>
            </div>
          )}
        </div>
      </div>

      {/* Gas BarChart */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '14px 12px 4px',
      }}>
        <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 10 }}>
          Gas Efficiency (30d)
        </div>
        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Tooltip content={<ChartTip />} />
              <Bar
                dataKey="gas_total"
                name="Gas (ETH)"
                fill={C.amber}
                radius={[4, 4, 0, 0]}
                animationDuration={600}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}>No data yet</span>
          </div>
        )}
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  TOGGLE SWITCH (reusable)
// ═══════════════════════════════════════════════════════════

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: value ? C.green : 'rgba(255,255,255,0.08)',
        position: 'relative', transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 3,
        left: value ? 19 : 3, transition: 'left 0.2s',
      }} />
    </button>
  )
}
