'use client'

/**
 * CommandCenter.tsx — 5-Tab Command Center + Route Creation Wizard
 *
 * Routes:     Rule CRUD via 3-step wizard, empty state, active rules grid
 * Monitor:    Status cards, live WebSocket feed, emergency stop
 * History:    Filterable log table, pagination, export
 * Analytics:  Charts (AreaChart, PieChart, BarChart), stat cards
 * Groups:     Saved distribution lists for quick wizard setup
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useChainId, useBalance, useWriteContract } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'

import StatusCards from './StatusCards'
import RuleCard from './RuleCard'
import SweepFeed from './SweepFeed'
import EmergencyStop from './EmergencyStop'

import { useForwardingRules, type CreateRulePayload } from '../lib/useForwardingRules'
import { useSweepWebSocket } from '../lib/useSweepWebSocket'
import { useSweepStats } from '../lib/useSweepStats'
import { useDistributionList, type DistributionEntry } from '../lib/useDistributionList'
import { mutationHeaders, parseRSendError } from '../lib/rsendFetch'
import { parseEther, parseUnits, formatUnits, getAddress } from 'viem'
import { getRegistry } from '../lib/contractRegistry'
import { FEE_ROUTER_ABI } from '../lib/feeRouterAbi'


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
const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
const RSEND_FEE_PCT = 0.1

type Tab = 'routes' | 'monitor' | 'history' | 'analytics' | 'groups' | 'settings'
type WizardStep = 1 | 2 | 3
type DestMode = 'quick' | 'bulk'

interface Destination {
  address: string
  label: string
  percent: number
}

interface AdvancedSettings {
  threshold: string
  tokenFilter: string[]
  speed: 'economy' | 'normal' | 'fast'
  maxGas: string
  cooldown: string
  dailyLimit: string
  autoSwap: boolean
  swapTo: string
  scheduleEnabled: boolean
  schedDays: string[]
  schedFrom: string
  schedTo: string
  notifyEnabled: boolean
  notifyChannel: string
  chatId: string
  email: string
}

const DEFAULT_ADVANCED: AdvancedSettings = {
  threshold: '0.001', tokenFilter: [], speed: 'normal',
  maxGas: '50', cooldown: '60', dailyLimit: '',
  autoSwap: false, swapTo: '',
  scheduleEnabled: false, schedDays: [], schedFrom: '09:00', schedTo: '18:00',
  notifyEnabled: true, notifyChannel: 'telegram', chatId: '', email: '',
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum', 8453: 'Base', 10: 'Optimism', 42161: 'Arbitrum',
  137: 'Polygon', 84532: 'Base Sepolia', 11155111: 'Sepolia',
}

const TOKEN_OPTIONS = ['ETH', 'USDC', 'USDT', 'DAI', 'WETH', 'cbBTC']
const STATUS_OPTIONS = ['completed', 'failed', 'pending', 'executing', 'gas_too_high', 'skipped']

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'routes',    label: 'Routes',    icon: '\u27D0' },
  { key: 'monitor',   label: 'Monitor',   icon: '\u25C9' },
  { key: 'history',   label: 'History',   icon: '\u2630' },
  { key: 'analytics', label: 'Analytics', icon: '\u2197' },
  { key: 'groups',    label: 'Groups',    icon: '\u229E' },
  { key: 'settings',  label: 'Settings',  icon: '\u2699' },
]

const smooth = { type: 'spring' as const, bounce: 0, duration: 0.5 }
const tabContent = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
}

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? '60%' : '-60%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-60%' : '60%', opacity: 0 }),
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

function isValidAddr(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a)
}

function fiat(eth: number, price: number): string {
  const usd = eth * price
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(4)}`
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
//  CHART TOOLTIP
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
//  TOOLTIP COMPONENT
// ═══════════════════════════════════════════════════════════

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span
      style={{ position: 'relative', cursor: 'help' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          padding: '6px 10px', borderRadius: 8, marginBottom: 4,
          background: '#1a1a24', border: `1px solid ${C.border}`,
          color: C.sub, fontFamily: C.M, fontSize: 10,
          whiteSpace: 'nowrap', zIndex: 50,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}


// ═══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function CommandCenter({
  ownerAddress,
  chainId: chainIdProp,
  isVisible = true,
}: {
  ownerAddress?: string
  chainId?: number
  isVisible?: boolean
}) {
  const { address: hookAddr, isConnected } = useAccount()
  const hookChainId = useChainId()
  const address = ownerAddress ?? hookAddr
  const chainId = chainIdProp ?? hookChainId
  const { data: balance } = useBalance({ address: address as `0x${string}` | undefined })

  const [tab, setTab] = useState<Tab>('routes')
  const [tabLoading, setTabLoading] = useState(false)

  // ── ETH price (derived from stats, fallback $3200) ────
  const [ethPrice, setEthPrice] = useState(3200)

  // ── Hooks ─────────────────────────────────────────────
  const {
    rules, loading: rulesLoading,
    createRule, createRuleBatch, updateRule, deleteRule,
    pauseRule, resumeRule, emergencyStop,
  } = useForwardingRules(address)

  const { events, connected, wsStats } = useSweepWebSocket(address)
  const { stats, daily, loading: statsLoading } = useSweepStats(address)
  const { lists: distLists, loading: distLoading, createList: createDistList, deleteList: deleteDistList } = useDistributionList(address)

  // Derive ETH price from stats
  useEffect(() => {
    if (stats && stats.total_volume_eth > 0 && stats.total_volume_usd > 0) {
      setEthPrice(stats.total_volume_usd / stats.total_volume_eth)
    }
  }, [stats])

  // ── Gas price ─────────────────────────────────────────
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
      {/* ══════════ STATS SUMMARY BAR ══════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: '6px 12px', marginBottom: 8,
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 10, border: `1px solid ${C.border}`,
      }}>
        {[
          { label: 'Volume', value: stats ? `${stats.total_volume_eth.toFixed(4)} ETH` : '--', extra: stats ? `(${fiat(stats.total_volume_eth, ethPrice)})` : '', color: C.purple },
          { label: 'Sweeps', value: stats ? String(stats.total_sweeps) : '--', extra: '', color: C.blue },
          { label: 'Routes', value: String(activeRules), extra: '', color: C.green },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: s.color, boxShadow: `0 0 4px ${s.color}50` }} />
            <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
            <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 700, color: C.text }}>{s.value}</span>
            {s.extra && <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>{s.extra}</span>}
          </div>
        ))}
      </div>

      {/* ══════════ TAB BAR ══════════ */}
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

      {/* ══════════ TAB CONTENT ══════════ */}
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
              {tab === 'routes' && (
                <RoutesTab
                  address={address!}
                  chainId={chainId}
                  balance={balance}
                  ethPrice={ethPrice}
                  rules={rules}
                  loading={rulesLoading}
                  createRule={createRule}
                  createRuleBatch={createRuleBatch}
                  updateRule={updateRule}
                  deleteRule={deleteRule}
                  pauseRule={pauseRule}
                  resumeRule={resumeRule}
                  distLists={distLists}
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
                  ethPrice={ethPrice}
                  rules={rules}
                  wsStats={wsStats}
                />
              )}
              {tab === 'history' && (
                <HistoryTab address={address!} ethPrice={ethPrice} stats={stats} rules={rules} />
              )}
              {tab === 'analytics' && (
                <AnalyticsTab stats={stats} daily={daily} loading={statsLoading} ethPrice={ethPrice} isVisible={isVisible} />
              )}
              {tab === 'groups' && (
                <GroupsTab
                  lists={distLists}
                  loading={distLoading}
                  createList={createDistList}
                  deleteList={deleteDistList}
                />
              )}
              {tab === 'settings' && (
                <SettingsTab
                  address={address!}
                  chainId={chainId}
                  rules={rules}
                  emergencyStop={emergencyStop}
                  distLists={distLists}
                  distLoading={distLoading}
                  createDistList={createDistList}
                  deleteDistList={deleteDistList}
                />
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  ROUTES TAB
// ═══════════════════════════════════════════════════════════

function RoutesTab({
  address, chainId, balance, ethPrice, rules, loading,
  createRule, createRuleBatch, updateRule, deleteRule, pauseRule, resumeRule,
  distLists,
}: {
  address: string
  chainId: number
  balance: any
  ethPrice: number
  rules: any[]
  loading: boolean
  createRule: (p: CreateRulePayload) => Promise<any>
  createRuleBatch: (p: CreateRulePayload[]) => Promise<void>
  updateRule: (id: number, u: Record<string, any>) => Promise<void>
  deleteRule: (id: number) => Promise<void>
  pauseRule: (id: number) => Promise<void>
  resumeRule: (id: number) => Promise<void>
  distLists: any[]
}) {
  const [showWizard, setShowWizard] = useState(false)

  const handleToggle = async (id: number, active: boolean) => {
    try { await updateRule(id, { is_active: !active }) } catch {}
  }

  // Single portal instance — AnimatePresence inside so exit animation works after portal
  const wizardPortal = createPortal(
    <AnimatePresence>
      {showWizard && (
        <RouteWizard
          key="route-wizard"
          onClose={() => setShowWizard(false)}
          onCreate={createRule}
          onCreateBatch={createRuleBatch}
          address={address}
          chainId={chainId}
          balance={balance}
          ethPrice={ethPrice}
          distLists={distLists}
        />
      )}
    </AnimatePresence>
  , document.body)

  // ── Empty state ────────────────────────────────────────
  if (!loading && rules.length === 0) {
    return (
      <>
        <EmptyState onStart={() => setShowWizard(true)} />
        {wizardPortal}
      </>
    )
  }

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.sub }}>
          {rules.length} Route{rules.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowWizard(true)}
          style={{
            padding: '6px 14px', borderRadius: 10,
            background: `${C.purple}10`,
            border: `1px solid ${C.purple}25`,
            color: C.purple,
            fontFamily: C.D, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          + New Route
        </button>
      </div>

      {/* Rules grid */}
      {loading && rules.length === 0 ? (
        <TabSkeleton />
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

      {/* Wizard portal */}
      {wizardPortal}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  EMPTY STATE
// ═══════════════════════════════════════════════════════════

function EmptyState({ onStart }: { onStart: () => void }) {
  const features = [
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14M12 5l7 7-7 7" stroke={C.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: 'Auto-Forward',
      desc: 'Incoming funds automatically route to your chosen wallets',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6 12h4M14 8h4M14 16h4M10 12l4-4M10 12l4 4" stroke={C.purple} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: 'Split Routing',
      desc: 'Divide payments across multiple wallets with custom ratios',
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={C.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: 'Smart Gas',
      desc: 'Optimized fees with configurable speed and limits',
    },
  ]

  return (
    <div style={{ textAlign: 'center', padding: '20px 0 10px' }}>
      {/* SVG illustration */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        style={{ marginBottom: 5 }}
      >
        <svg width="180" height="100" viewBox="0 0 180 100" style={{ display: 'block', margin: '0 auto' }}>
          <circle cx="30" cy="50" r="14" fill={`${C.purple}12`} stroke={C.purple} strokeWidth="0.8" />
          <text x="30" y="53" textAnchor="middle" fill={C.purple} fontSize="10" fontFamily="var(--font-mono)">W</text>
          <circle cx="90" cy="28" r="11" fill={`${C.green}10`} stroke={C.green} strokeWidth="0.8" />
          <text x="90" y="31" textAnchor="middle" fill={C.green} fontSize="8" fontFamily="var(--font-mono)">A</text>
          <circle cx="90" cy="72" r="11" fill={`${C.blue}10`} stroke={C.blue} strokeWidth="0.8" />
          <text x="90" y="75" textAnchor="middle" fill={C.blue} fontSize="8" fontFamily="var(--font-mono)">B</text>
          <circle cx="150" cy="50" r="11" fill={`${C.red}10`} stroke={C.red} strokeWidth="0.8" />
          <text x="150" y="53" textAnchor="middle" fill={C.red} fontSize="8" fontFamily="var(--font-mono)">C</text>
          <line x1="44" y1="43" x2="79" y2="31" stroke={C.purple} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5">
            <animate attributeName="stroke-dashoffset" from="7" to="0" dur="1.5s" repeatCount="indefinite" />
          </line>
          <line x1="44" y1="57" x2="79" y2="69" stroke={C.purple} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5">
            <animate attributeName="stroke-dashoffset" from="7" to="0" dur="1.5s" repeatCount="indefinite" />
          </line>
          <line x1="101" y1="32" x2="139" y2="46" stroke={C.green} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.4">
            <animate attributeName="stroke-dashoffset" from="7" to="0" dur="1.8s" repeatCount="indefinite" />
          </line>
          <line x1="101" y1="68" x2="139" y2="54" stroke={C.blue} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.4">
            <animate attributeName="stroke-dashoffset" from="7" to="0" dur="1.8s" repeatCount="indefinite" />
          </line>
        </svg>
      </motion.div>

      {/* CTA */}
      <div style={{ fontFamily: C.D, fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 10 }}>
        No routes yet
      </div>
      
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onStart}
        style={{
          padding: '12px 28px', borderRadius: 14, border: 'none',
          background: `linear-gradient(135deg, ${C.red}, ${C.purple})`,
          color: '#fff', fontFamily: C.D, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', letterSpacing: '-0.01em',
          boxShadow: `0 4px 20px ${C.purple}25`,
          transition: 'all 0.2s',
        }}
      >
        Create your first route
      </motion.button>

      {/* Feature cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 20 }}>
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.08, duration: 0.4, ease: EASE }}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '14px 10px', textAlign: 'center',
            }}
          >
            <div style={{ marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 4 }}>
              {f.title}
            </div>
            <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, lineHeight: 1.4 }}>
              {f.desc}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  ROUTE WIZARD (3-step fullscreen overlay)
// ═══════════════════════════════════════════════════════════

function RouteWizard({
  onClose, onCreate, onCreateBatch, address, chainId, balance, ethPrice, distLists,
}: {
  onClose: () => void
  onCreate: (p: CreateRulePayload) => Promise<any>
  onCreateBatch: (p: CreateRulePayload[]) => Promise<void>
  address: string
  chainId: number
  balance: any
  ethPrice: number
  distLists: any[]
}) {
  const [step, setStep] = useState<WizardStep>(1)
  const [direction, setDirection] = useState(1)

  // Step 2 state
  const [destMode, setDestMode] = useState<DestMode>('quick')
  const [destinations, setDestinations] = useState<Destination[]>([{ address: '', label: '', percent: 100 }])
  const [csvText, setCsvText] = useState('')
  const [csvParsed, setCsvParsed] = useState<{ address: string; label: string; valid: boolean }[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advanced, setAdvanced] = useState<AdvancedSettings>({ ...DEFAULT_ADVANCED })

  // Step 3 state
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)

  // On-chain signing via writeContractAsync (always opens MetaMask)
  const { writeContractAsync } = useWriteContract()

  // Active destinations (resolved from quick or bulk)
  const activeDests: Destination[] = useMemo(() => {
    if (destMode === 'quick') return destinations
    return csvParsed.filter(r => r.valid).map((r, _, arr) => ({
      address: r.address, label: r.label, percent: Math.round(100 / arr.length),
    }))
  }, [destMode, destinations, csvParsed])

  const totalPercent = activeDests.reduce((s, d) => s + d.percent, 0)

  // Validation
  const canNext2 = activeDests.length > 0 &&
    activeDests.every(d => isValidAddr(d.address)) &&
    (activeDests.length === 1 || Math.abs(totalPercent - 100) < 1)

  // Navigation
  const goNext = () => { setDirection(1); setStep(s => Math.min(3, s + 1) as WizardStep) }
  const goBack = () => { setDirection(-1); setStep(s => Math.max(1, s - 1) as WizardStep) }

  // CSV parser
  const parseCsv = () => {
    const lines = csvText.trim().split('\n').filter(l => l.trim())
    const result = lines.map(line => {
      const parts = line.split(',').map(p => p.trim())
      const addr = parts[0] || ''
      const label = parts[1] || ''
      return { address: addr, label, valid: isValidAddr(addr) }
    })
    if (result.length > 1 && !result[0].valid && result[0].address.toLowerCase().includes('address')) {
      result.shift()
    }
    setCsvParsed(result)
  }

  // Build common payload fields from advanced settings
  const buildPayloadBase = (): Partial<CreateRulePayload> => ({
    owner_address: address,
    source_wallet: address,
    min_threshold: parseFloat(advanced.threshold) || 0.001,
    gas_strategy: advanced.speed === 'economy' ? 'slow' : advanced.speed,
    gas_limit_gwei: parseInt(advanced.maxGas) || 50,
    cooldown_sec: parseInt(advanced.cooldown) || 60,
    max_daily_vol: advanced.dailyLimit ? parseFloat(advanced.dailyLimit) : undefined,
    token_filter: advanced.tokenFilter.length > 0 ? advanced.tokenFilter : undefined,
    auto_swap: advanced.autoSwap,
    swap_to_token: advanced.autoSwap && advanced.swapTo.startsWith('0x') ? advanced.swapTo : undefined,
    notify_enabled: advanced.notifyEnabled,
    notify_channel: advanced.notifyChannel,
    telegram_chat_id: advanced.notifyChannel === 'telegram' && advanced.chatId ? advanced.chatId : undefined,
    email_address: advanced.notifyChannel === 'email' && advanced.email ? advanced.email : undefined,
    schedule_json: advanced.scheduleEnabled
      ? { days: advanced.schedDays, from: advanced.schedFrom, to: advanced.schedTo, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
      : undefined,
    chain_id: chainId,
  })

  // Create handler (ref guard prevents double-click)
  // Flow: oracle sign → writeContractAsync (MetaMask opens) → backend rule creation
  const handleCreate = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const base = buildPayloadBase()
      const dests = activeDests
      const primaryDest = dests[0]

      // ── Step 1: Oracle signature ──────────────────────────
      const registry = getRegistry(chainId)
      if (!registry) throw new Error(`Chain ${chainId} not supported`)

      const tokenAddr = base.token_address || '0x0000000000000000000000000000000000000000'
      const isNative = tokenAddr === '0x0000000000000000000000000000000000000000'
      const threshold = base.min_threshold ?? 0.001
      const amountWei = isNative
        ? parseEther(String(threshold))
        : parseUnits(String(threshold), 18) // ERC-20 decimals resolved below

      const oracleRes = await fetch('/api/oracle/sign', {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
          sender: address,
          recipient: primaryDest.address,
          tokenIn: tokenAddr,
          tokenOut: tokenAddr,
          amountIn: String(threshold),
          amountInWei: amountWei.toString(),
          symbol: base.token_symbol || 'ETH',
          chainId,
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!oracleRes.ok) throw new Error('Oracle signature request failed')
      const oracle = await oracleRes.json()
      if (!oracle.approved) throw new Error(oracle.rejectionReason || 'Oracle denied transaction')

      // ── Step 2: On-chain tx via MetaMask ──────────────────
      const recipientAddr = getAddress(primaryDest.address) as `0x${string}`
      let txHash: `0x${string}`

      if (isNative) {
        txHash = await writeContractAsync({
          address: registry.feeRouter,
          abi: FEE_ROUTER_ABI,
          functionName: 'transferETHWithOracle',
          args: [
            recipientAddr,
            oracle.oracleNonce as `0x${string}`,
            BigInt(oracle.oracleDeadline),
            oracle.oracleSignature as `0x${string}`,
          ],
          value: amountWei,
        })
      } else {
        txHash = await writeContractAsync({
          address: registry.feeRouter,
          abi: FEE_ROUTER_ABI,
          functionName: 'transferWithOracle',
          args: [
            tokenAddr as `0x${string}`,
            amountWei,
            recipientAddr,
            oracle.oracleNonce as `0x${string}`,
            BigInt(oracle.oracleDeadline),
            oracle.oracleSignature as `0x${string}`,
          ],
        })
      }
      console.log('[RSend] Route confirmed on-chain:', txHash)

      // ── Step 3: Create rule in backend ────────────────────
      if (dests.length === 1) {
        await onCreate({
          ...base,
          destination_wallet: dests[0].address,
          label: dests[0].label || undefined,
          split_enabled: false,
          split_percent: 100,
        } as CreateRulePayload)
      } else if (dests.length === 2 && destMode === 'quick') {
        await onCreate({
          ...base,
          destination_wallet: dests[0].address,
          label: dests[0].label || undefined,
          split_enabled: true,
          split_percent: dests[0].percent,
          split_destination: dests[1].address,
        } as CreateRulePayload)
      } else {
        const payloads: CreateRulePayload[] = dests.map(d => ({
          ...base,
          destination_wallet: d.address,
          label: d.label || undefined,
          split_enabled: false,
          split_percent: 100,
        } as CreateRulePayload))
        await onCreateBatch(payloads)
      }
      onClose()
    } catch (e: any) {
      // User rejection in MetaMask is NOT an error — silently cancel
      const isUserRejection =
        e?.code === 4001 ||
        e?.code === 'ACTION_REJECTED' ||
        /user (rejected|denied|cancelled)/i.test(e?.message ?? '')
      if (!isUserRejection) {
        setError(e instanceof Error ? e.message : 'Failed to create route')
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Load distribution group
  const loadGroup = (entries: DistributionEntry[]) => {
    setDestinations(entries.map(e => ({ address: e.address, label: e.label, percent: e.percent })))
    setDestMode('quick')
  }

  // Fix D — lock body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose} /* Fix E — close on backdrop click */
      style={{
        position: 'fixed', inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
      }}
    >
      {/* Modal panel */}
      <div
        onClick={e => e.stopPropagation()} /* Fix E — prevent panel clicks from closing */
        style={{
        width: '90%', maxWidth: 480,
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 10000,
        borderRadius: 16,
        boxSizing: 'border-box',
        background: C.card,
      }}>

        {/* ── Non-scrolling header: close + title + step bar ── */}
        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
          {/* Close */}
          <button onClick={onClose} style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', color: C.dim, cursor: 'pointer',
            fontFamily: C.D, fontSize: 20, padding: 8,
          }}>{'\u2715'}</button>

          {/* Title */}
          <div style={{ fontFamily: C.D, fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            Create Route
          </div>
          

          {/* Step bar */}
          <WizardStepBar step={step} />
        </div>

        {/* ── Scrollable body: step content + error ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 24px' }}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.35, ease: EASE }}
              style={{ minHeight: 200 }}
            >
              {step === 1 && (
                <Step1Source address={address} chainId={chainId} balance={balance} ethPrice={ethPrice} />
              )}
              {step === 2 && (
                <Step2Destinations
                  destMode={destMode} setDestMode={setDestMode}
                  destinations={destinations} setDestinations={setDestinations}
                  csvText={csvText} setCsvText={setCsvText}
                  csvParsed={csvParsed} parseCsv={parseCsv}
                  showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
                  advanced={advanced} setAdvanced={setAdvanced}
                  ethPrice={ethPrice}
                  distLists={distLists} loadGroup={loadGroup}
                />
              )}
              {step === 3 && (
                <Step3Review
                  address={address}
                  destinations={activeDests}
                  ethPrice={ethPrice}
                  balance={balance}
                  advanced={advanced}
                  confirmed={confirmed}
                  setConfirmed={setConfirmed}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Error */}
          {error && (
            <div style={{
              fontFamily: C.M, fontSize: 10, color: C.red, marginTop: 10,
              padding: '6px 10px', background: `${C.red}08`, borderRadius: 8,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* ── Non-scrolling footer: navigation buttons ── */}
        <div style={{ padding: '0 24px 32px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {step > 1 && (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={goBack}
                style={{
                  padding: '12px 20px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
                  color: C.sub, fontFamily: C.D, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                Back
              </motion.button>
            )}
            <div style={{ flex: 1 }} />
            {step < 3 ? (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={goNext}
                disabled={step === 2 && !canNext2}
                style={{
                  padding: '12px 28px', borderRadius: 12, border: 'none',
                  background: (step === 2 && !canNext2)
                    ? 'rgba(255,255,255,0.04)'
                    : `linear-gradient(135deg, ${C.red}, ${C.purple})`,
                  color: (step === 2 && !canNext2) ? 'rgba(255,255,255,0.35)' : '#fff',
                  fontFamily: C.D, fontSize: 13, fontWeight: 700,
                  cursor: (step === 2 && !canNext2) ? 'not-allowed' : 'pointer',
                  boxShadow: (step === 2 && !canNext2) ? 'none' : `0 4px 20px ${C.purple}25`,
                  transition: 'all 0.2s',
                }}
              >
                Continue
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleCreate}
                disabled={!confirmed || saving}
                style={{
                  padding: '12px 28px', borderRadius: 12, border: 'none',
                  background: (!confirmed || saving)
                    ? 'rgba(255,255,255,0.04)'
                    : `linear-gradient(135deg, ${C.red}, ${C.purple})`,
                  color: (!confirmed || saving) ? 'rgba(255,255,255,0.35)' : '#fff',
                  fontFamily: C.D, fontSize: 13, fontWeight: 700,
                  cursor: (!confirmed || saving) ? 'not-allowed' : 'pointer',
                  boxShadow: (!confirmed || saving) ? 'none' : `0 4px 20px ${C.purple}25`,
                  transition: 'all 0.2s',
                }}
              >
                {saving ? 'Check MetaMask to sign...' : 'Sign & Create Route'}
              </motion.button>
            )}
          </div>
        </div>

      </div>
    </motion.div>
  )
}


// ═══════════════════════════════════════════════════════════
//  WIZARD STEP BAR
// ═══════════════════════════════════════════════════════════

function WizardStepBar({ step }: { step: WizardStep }) {
  const steps = [
    { n: 1, label: 'Source' },
    { n: 2, label: 'Destinations' },
    { n: 3, label: 'Review' },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: step >= s.n ? `linear-gradient(135deg, ${C.red}, ${C.purple})` : 'rgba(255,255,255,0.06)',
            color: step >= s.n ? '#fff' : C.dim,
            fontFamily: C.D, fontSize: 11, fontWeight: 700,
            transition: 'all 0.3s',
            boxShadow: step === s.n ? `0 0 12px ${C.purple}40` : 'none',
          }}>
            {step > s.n ? '\u2713' : s.n}
          </div>
          <span style={{
            fontFamily: C.M, fontSize: 9, color: step >= s.n ? C.text : C.dim,
            marginLeft: 6, whiteSpace: 'nowrap',
          }}>
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div style={{
              flex: 1, height: 2, marginLeft: 8, marginRight: 8, borderRadius: 1,
              background: step > s.n
                ? `linear-gradient(90deg, ${C.red}, ${C.purple})`
                : 'rgba(255,255,255,0.06)',
              transition: 'background 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  STEP 1 — SOURCE WALLET
// ═══════════════════════════════════════════════════════════

function Step1Source({
  address, chainId, balance, ethPrice,
}: {
  address: string; chainId: number; balance: any; ethPrice: number
}) {
  const bal = balance ? parseFloat(balance.formatted) : 0
  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`

  return (
    <div>
      <div style={{ fontFamily: C.D, fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Source Wallet
      </div>
      <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginBottom: 16 }}>
        Incoming funds to this wallet will be automatically forwarded
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${C.purple}20`,
        borderRadius: 16, padding: '20px 18px',
      }}>
        {/* Address */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: `linear-gradient(135deg, ${C.purple}30, ${C.blue}30)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5" width="18" height="14" rx="3" stroke={C.purple} strokeWidth="1.5" />
              <path d="M3 10h18" stroke={C.purple} strokeWidth="1.5" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: C.M, fontSize: 13, color: C.text, fontWeight: 600 }}>
              {tr(address, 8, 6)}
            </div>
            <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
              Connected wallet
            </div>
          </div>
        </div>

        {/* Balance + Chain */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px',
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Balance
            </div>
            <div style={{ fontFamily: C.D, fontSize: 16, fontWeight: 700, color: C.text }}>
              {bal.toFixed(4)} {balance?.symbol || 'ETH'}
            </div>
            <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
              {fiat(bal, ethPrice)}
            </div>
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px',
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Network
            </div>
            <div style={{ fontFamily: C.D, fontSize: 16, fontWeight: 700, color: C.text }}>
              {chainName}
            </div>
            <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
              Chain ID {chainId}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  STEP 2 — DESTINATIONS
// ═══════════════════════════════════════════════════════════

function Step2Destinations({
  destMode, setDestMode, destinations, setDestinations,
  csvText, setCsvText, csvParsed, parseCsv,
  showAdvanced, setShowAdvanced, advanced, setAdvanced,
  ethPrice, distLists, loadGroup,
}: {
  destMode: DestMode; setDestMode: (m: DestMode) => void
  destinations: Destination[]; setDestinations: (d: Destination[]) => void
  csvText: string; setCsvText: (t: string) => void
  csvParsed: { address: string; label: string; valid: boolean }[]; parseCsv: () => void
  showAdvanced: boolean; setShowAdvanced: (fn: any) => void
  advanced: AdvancedSettings; setAdvanced: (fn: any) => void
  ethPrice: number
  distLists: any[]; loadGroup: (entries: DistributionEntry[]) => void
}) {
  const total = destinations.reduce((s, d) => s + d.percent, 0)

  const addDest = () => {
    if (destinations.length >= 5) return
    const even = Math.floor(100 / (destinations.length + 1))
    const updated = destinations.map(d => ({ ...d, percent: even }))
    updated.push({ address: '', label: '', percent: 100 - even * destinations.length })
    setDestinations(updated)
  }

  const removeDest = (i: number) => {
    const next = destinations.filter((_, idx) => idx !== i)
    if (next.length === 1) next[0].percent = 100
    setDestinations(next)
  }

  const updateDest = (i: number, field: keyof Destination, value: any) => {
    const next = [...destinations]
    next[i] = { ...next[i], [field]: value }
    setDestinations(next)
  }

  return (
    <div>
      <div style={{ fontFamily: C.D, fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Destinations
      </div>
      <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginBottom: 14 }}>
        Where should incoming funds be forwarded?
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['quick', 'bulk'] as DestMode[]).map(m => (
          <button
            key={m}
            onClick={() => setDestMode(m)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 10,
              background: destMode === m ? `${C.purple}12` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${destMode === m ? `${C.purple}30` : C.border}`,
              color: destMode === m ? C.purple : C.dim,
              fontFamily: C.D, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {m === 'quick' ? 'Quick Setup' : 'CSV Import'}
          </button>
        ))}
      </div>

      {/* Load from group */}
      {distLists.length > 0 && destMode === 'quick' && (
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Load from saved group</label>
          <select
            onChange={e => {
              const list = distLists.find((l: any) => l.id === Number(e.target.value))
              if (list) loadGroup(list.entries)
            }}
            defaultValue=""
            style={selectStyle}
          >
            <option value="" disabled>Select a group...</option>
            {distLists.map((l: any) => (
              <option key={l.id} value={l.id}>{l.name} ({l.entries?.length} destinations)</option>
            ))}
          </select>
        </div>
      )}

      {/* Quick mode */}
      {destMode === 'quick' && (
        <div>
          {destinations.map((d, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3, ease: EASE }}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${d.address && !isValidAddr(d.address) ? `${C.red}30` : C.border}`,
                borderRadius: 14, padding: '12px 14px', marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: destinations.length > 1 ? 10 : 0 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Wallet Address</label>
                  <input
                    value={d.address}
                    onChange={e => updateDest(i, 'address', e.target.value)}
                    placeholder="0x..."
                    style={{
                      ...inp,
                      borderColor: d.address && !isValidAddr(d.address) ? `${C.red}60` : undefined,
                    }}
                  />
                  {d.address && !isValidAddr(d.address) && (
                    <div style={{ fontFamily: C.M, fontSize: 9, color: C.red, marginTop: 2 }}>
                      Invalid address
                    </div>
                  )}
                </div>
                <div style={{ width: 120 }}>
                  <label style={labelStyle}>Label</label>
                  <input
                    value={d.label}
                    onChange={e => updateDest(i, 'label', e.target.value)}
                    placeholder="Treasury"
                    style={inp}
                  />
                </div>
                {destinations.length > 1 && (
                  <button
                    onClick={() => removeDest(i)}
                    style={{
                      alignSelf: 'flex-end', marginBottom: 1,
                      width: 28, height: 28, borderRadius: 8,
                      background: `${C.red}08`, border: `1px solid ${C.red}20`,
                      color: C.red, cursor: 'pointer', fontFamily: C.M, fontSize: 14,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {'\u2715'}
                  </button>
                )}
              </div>

              {/* Percentage slider (only when multiple dests) */}
              {destinations.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontFamily: C.D, fontSize: 13, fontWeight: 700, color: C.purple,
                    width: 44, textAlign: 'right',
                  }}>
                    {d.percent}%
                  </span>
                  <input
                    type="range"
                    min={0} max={100} step={1}
                    value={d.percent}
                    onChange={e => updateDest(i, 'percent', parseInt(e.target.value))}
                    style={{ flex: 1, accentColor: C.purple, height: 4 }}
                  />
                </div>
              )}
            </motion.div>
          ))}

          {/* Add destination */}
          {destinations.length < 5 && (
            <button
              onClick={addDest}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 10,
                background: 'transparent',
                border: `1px dashed ${C.dim}`,
                color: C.dim, fontFamily: C.D, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                marginBottom: 8,
              }}
            >
              + Add Destination
            </button>
          )}

          {/* Total check */}
          {destinations.length > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderRadius: 10,
              background: total === 100 ? `${C.green}08` : `${C.amber}08`,
              border: `1px solid ${total === 100 ? `${C.green}20` : `${C.amber}20`}`,
              marginBottom: 8,
            }}>
              <span style={{ fontFamily: C.M, fontSize: 11, color: total === 100 ? C.green : C.amber }}>
                Total: {total}%
              </span>
              {total !== 100 && (
                <span style={{ fontFamily: C.M, fontSize: 10, color: C.amber }}>
                  Must equal 100%
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk CSV mode */}
      {destMode === 'bulk' && (
        <div>
          <label style={labelStyle}>Paste CSV (address, label per line)</label>
          <textarea
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder={'0x1234...abcd, Treasury\n0x5678...efgh, Savings'}
            rows={5}
            style={{
              ...inp, resize: 'vertical', minHeight: 80,
              fontFamily: C.M, fontSize: 11, lineHeight: 1.6,
            }}
          />
          <button
            onClick={parseCsv}
            disabled={!csvText.trim()}
            style={{
              marginTop: 8, padding: '8px 16px', borderRadius: 10,
              background: csvText.trim() ? `${C.blue}12` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${csvText.trim() ? `${C.blue}25` : C.border}`,
              color: csvText.trim() ? C.blue : C.dim,
              fontFamily: C.D, fontSize: 11, fontWeight: 600, cursor: csvText.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            Parse CSV
          </button>

          {/* Preview table */}
          {csvParsed.length > 0 && (
            <div style={{
              marginTop: 10, background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '24px 1fr 1fr',
                gap: 6, padding: '6px 10px',
                borderBottom: `1px solid ${C.border}`,
                background: 'rgba(255,255,255,0.02)',
              }}>
                <span style={{ fontFamily: C.M, fontSize: 8, color: C.dim }}></span>
                <span style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase' }}>Address</span>
                <span style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase' }}>Label</span>
              </div>
              {csvParsed.map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr 1fr',
                  gap: 6, padding: '6px 10px',
                  borderBottom: i < csvParsed.length - 1 ? `1px solid ${C.border}` : 'none',
                }}>
                  <span style={{ fontFamily: C.M, fontSize: 11, color: row.valid ? C.green : C.red }}>
                    {row.valid ? '\u2713' : '\u2717'}
                  </span>
                  <span style={{ fontFamily: C.M, fontSize: 10, color: row.valid ? C.text : C.red, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tr(row.address, 10, 6)}
                  </span>
                  <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>
                    {row.label || '--'}
                  </span>
                </div>
              ))}
              <div style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>
                  {csvParsed.filter(r => r.valid).length} valid / {csvParsed.length} total
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Advanced Settings Accordion ──────────────── */}
      <div style={{ marginTop: 14 }}>
        <button
          onClick={() => setShowAdvanced((v: boolean) => !v)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 12,
            background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
            color: C.sub, fontFamily: C.D, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', textAlign: 'left',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <span>Advanced Settings</span>
          <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: showAdvanced ? 'rotate(180deg)' : 'none' }}>
            {'\u25BE'}
          </span>
        </button>
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
              style={{ overflow: 'hidden' }}
            >
              <AdvancedAccordion settings={advanced} onChange={setAdvanced} ethPrice={ethPrice} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  ADVANCED ACCORDION
// ═══════════════════════════════════════════════════════════

function AdvancedAccordion({
  settings, onChange, ethPrice,
}: {
  settings: AdvancedSettings
  onChange: (fn: (s: AdvancedSettings) => AdvancedSettings) => void
  ethPrice: number
}) {
  const upd = (field: keyof AdvancedSettings, value: any) =>
    onChange(s => ({ ...s, [field]: value }))

  return (
    <div style={{
      padding: '14px', marginTop: 6,
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${C.border}`,
      borderRadius: 12,
    }}>
      {/* Threshold */}
      <div style={{ marginBottom: 10 }}>
        <Tip text="Minimum amount to trigger auto-forwarding">
          <label style={labelStyle}>Minimum Amount (ETH)</label>
        </Tip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            value={settings.threshold}
            onChange={e => upd('threshold', e.target.value)}
            step="0.001" style={{ ...inp, flex: 1 }}
          />
          <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, whiteSpace: 'nowrap' }}>
            {fiat(parseFloat(settings.threshold) || 0, ethPrice)}
          </span>
        </div>
      </div>

      {/* Token filter */}
      <div style={{ marginBottom: 10 }}>
        <Tip text="Only forward these tokens (leave empty for all)">
          <label style={labelStyle}>Token Filter</label>
        </Tip>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TOKEN_OPTIONS.map(t => {
            const on = settings.tokenFilter.includes(t)
            return (
              <button
                key={t}
                onClick={() => onChange(s => ({
                  ...s,
                  tokenFilter: on ? s.tokenFilter.filter(x => x !== t) : [...s.tokenFilter, t],
                }))}
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

      {/* Speed */}
      <div style={{ marginBottom: 10 }}>
        <Tip text="Gas price strategy — Economy saves fees, Fast prioritizes speed">
          <label style={labelStyle}>Speed</label>
        </Tip>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { key: 'economy' as const, label: 'Economy', desc: 'Lower fees' },
            { key: 'normal' as const, label: 'Normal', desc: 'Balanced' },
            { key: 'fast' as const, label: 'Fast', desc: 'Priority' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => upd('speed', opt.key)}
              style={{
                flex: 1, padding: '8px 6px', borderRadius: 10,
                background: settings.speed === opt.key ? `${C.purple}12` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${settings.speed === opt.key ? `${C.purple}30` : C.border}`,
                color: settings.speed === opt.key ? C.purple : C.sub,
                fontFamily: C.D, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                textAlign: 'center', transition: 'all 0.15s',
              }}
            >
              <div>{opt.label}</div>
              <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, marginTop: 2 }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Max Gas + Cooldown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
        <div>
          <Tip text="Maximum gas price in gwei">
            <label style={labelStyle}>Max Gas (gwei)</label>
          </Tip>
          <input type="number" value={settings.maxGas} onChange={e => upd('maxGas', e.target.value)} style={inp} />
        </div>
        <div>
          <Tip text="Minimum wait time between forwards (seconds)">
            <label style={labelStyle}>Wait Time (sec)</label>
          </Tip>
          <input type="number" value={settings.cooldown} onChange={e => upd('cooldown', e.target.value)} style={inp} />
        </div>
      </div>

      {/* Daily limit */}
      <div style={{ marginBottom: 10 }}>
        <Tip text="Maximum daily forwarding volume">
          <label style={labelStyle}>Daily Limit (ETH)</label>
        </Tip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            value={settings.dailyLimit}
            onChange={e => upd('dailyLimit', e.target.value)}
            placeholder="No limit"
            style={{ ...inp, flex: 1 }}
          />
          {settings.dailyLimit && (
            <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, whiteSpace: 'nowrap' }}>
              {fiat(parseFloat(settings.dailyLimit) || 0, ethPrice)}
            </span>
          )}
        </div>
      </div>

      {/* Auto-swap */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: settings.autoSwap ? 8 : 10 }}>
        <Tip text="Automatically swap received tokens before forwarding">
          <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Auto-Swap</span>
        </Tip>
        <ToggleSwitch value={settings.autoSwap} onChange={v => upd('autoSwap', v)} />
      </div>
      {settings.autoSwap && (
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Swap to Token Address</label>
          <input value={settings.swapTo} onChange={e => upd('swapTo', e.target.value)} placeholder="0x..." style={inp} />
        </div>
      )}

      {/* Schedule */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: settings.scheduleEnabled ? 8 : 10 }}>
        <Tip text="Only forward during specific days and times">
          <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Schedule</span>
        </Tip>
        <ToggleSwitch value={settings.scheduleEnabled} onChange={v => upd('scheduleEnabled', v)} />
      </div>
      {settings.scheduleEnabled && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => {
              const on = settings.schedDays.includes(d.toLowerCase())
              return (
                <button
                  key={d}
                  onClick={() => onChange(s => ({
                    ...s,
                    schedDays: on ? s.schedDays.filter(x => x !== d.toLowerCase()) : [...s.schedDays, d.toLowerCase()],
                  }))}
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
              <input type="time" value={settings.schedFrom} onChange={e => upd('schedFrom', e.target.value)} style={inp} />
            </div>
            <div>
              <label style={labelStyle}>To</label>
              <input type="time" value={settings.schedTo} onChange={e => upd('schedTo', e.target.value)} style={inp} />
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: settings.notifyEnabled ? 8 : 0 }}>
        <Tip text="Get notified when funds are forwarded">
          <span style={{ fontFamily: C.D, fontSize: 11, color: C.sub }}>Notifications</span>
        </Tip>
        <ToggleSwitch value={settings.notifyEnabled} onChange={v => upd('notifyEnabled', v)} />
      </div>
      {settings.notifyEnabled && (
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 6 }}>
          <div>
            <label style={labelStyle}>Channel</label>
            <select value={settings.notifyChannel} onChange={e => upd('notifyChannel', e.target.value)} style={selectStyle}>
              <option value="telegram">Telegram</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{settings.notifyChannel === 'telegram' ? 'Chat ID' : 'Email'}</label>
            {settings.notifyChannel === 'telegram' ? (
              <input value={settings.chatId} onChange={e => upd('chatId', e.target.value)} placeholder="123456789" style={inp} />
            ) : (
              <input value={settings.email} onChange={e => upd('email', e.target.value)} placeholder="you@example.com" type="email" style={inp} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  STEP 3 — REVIEW
// ═══════════════════════════════════════════════════════════

function Step3Review({
  address, destinations, ethPrice, balance, advanced, confirmed, setConfirmed,
}: {
  address: string
  destinations: Destination[]
  ethPrice: number
  balance: any
  advanced: AdvancedSettings
  confirmed: boolean
  setConfirmed: (v: boolean) => void
}) {
  const userBal = balance ? parseFloat(balance.formatted) : 0
  const exampleEth = userBal > 0 ? userBal : 1
  const fee = exampleEth * RSEND_FEE_PCT / 100
  const afterFee = exampleEth - fee
  const total = destinations.reduce((s, d) => s + d.percent, 0)

  return (
    <div>
      <div style={{ fontFamily: C.D, fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Review Route
      </div>
      <div style={{ fontFamily: C.M, fontSize: 10, color: C.dim, marginBottom: 16 }}>
        Verify your configuration before signing
      </div>

      {/* ── Animated Flow Diagram ──────────────────── */}
      <FlowDiagram address={address} destinations={destinations} />

      {/* ── Calculation Table ──────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '14px 16px', marginBottom: 16,
      }}>
        <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 10 }}>
          {userBal > 0
            ? `Your balance: ${exampleEth.toFixed(4)} ETH (${fiat(exampleEth, ethPrice)})`
            : `Hypothetical example — if you receive ${exampleEth} ETH (${fiat(exampleEth, ethPrice)})`
          }
        </div>

        {/* Fee row */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 0', borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>
            RSends processing fee ({RSEND_FEE_PCT}%)
          </span>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontFamily: C.M, fontSize: 11, color: C.text }}>{fee.toFixed(4)} ETH</span>
            <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginLeft: 6 }}>{fiat(fee, ethPrice)}</span>
          </div>
        </div>

        {/* Destination rows */}
        {destinations.map((d, i) => {
          const amt = afterFee * (d.percent / Math.max(total, 1))
          return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0',
              borderBottom: i < destinations.length - 1 ? `1px solid ${C.border}` : 'none',
            }}>
              <span style={{ fontFamily: C.M, fontSize: 10, color: C.text }}>
                {d.label || tr(d.address)} ({d.percent}%)
              </span>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontFamily: C.M, fontSize: 11, color: C.green }}>{amt.toFixed(4)} ETH</span>
                <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginLeft: 6 }}>{fiat(amt, ethPrice)}</span>
              </div>
            </div>
          )
        })}

        {/* Total */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 0 0', marginTop: 6, borderTop: `1px solid ${C.border}`,
        }}>
          <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub }}>Total distributed</span>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontFamily: C.D, fontSize: 13, fontWeight: 700, color: C.text }}>{afterFee.toFixed(4)} ETH</span>
            <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginLeft: 6 }}>{fiat(afterFee, ethPrice)}</span>
          </div>
        </div>
      </div>

      {/* Settings summary */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16,
      }}>
        {[
          `${advanced.threshold} ETH min`,
          advanced.speed === 'economy' ? 'Economy speed' : advanced.speed === 'fast' ? 'Fast speed' : 'Normal speed',
          `${advanced.maxGas} gwei max`,
          `${advanced.cooldown}s cooldown`,
          ...(advanced.dailyLimit ? [`${advanced.dailyLimit} ETH/day`] : []),
          ...(advanced.tokenFilter.length > 0 ? [`Tokens: ${advanced.tokenFilter.join(', ')}`] : []),
          ...(advanced.autoSwap ? ['Auto-swap'] : []),
          ...(advanced.scheduleEnabled ? ['Scheduled'] : []),
          ...(advanced.notifyEnabled ? [advanced.notifyChannel] : []),
        ].map(tag => (
          <span key={tag} style={{
            fontFamily: C.M, fontSize: 9, color: C.sub,
            background: `${C.sub}10`, padding: '2px 7px', borderRadius: 6,
          }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Confirmation */}
      <label style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
        background: confirmed ? `${C.green}06` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${confirmed ? `${C.green}20` : C.border}`,
        transition: 'all 0.2s',
      }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
          style={{ marginTop: 2, accentColor: C.green }}
        />
        <div>
          <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 2 }}>
            I understand this rule will automatically forward incoming funds
          </div>
          <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>
            You will sign with your wallet to verify ownership. No funds will be moved until a transaction is detected.
          </div>
        </div>
      </label>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  ANIMATED FLOW DIAGRAM (SVG)
// ═══════════════════════════════════════════════════════════

function FlowDiagram({ address, destinations }: { address: string; destinations: Destination[] }) {
  const n = destinations.length
  const h = Math.max(80, 20 + n * 44)
  const midY = h / 2

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`,
      borderRadius: 14, padding: '14px 8px', marginBottom: 16,
    }}>
      <svg width="100%" viewBox={`0 0 480 ${h}`} style={{ display: 'block' }}>
        {/* Source node */}
        <rect x="4" y={midY - 18} width="86" height="36" rx="10"
          fill={`${C.purple}12`} stroke={C.purple} strokeWidth="0.8" />
        <text x="47" y={midY - 3} textAnchor="middle" fill={C.text} fontSize="8" fontFamily="var(--font-mono)">
          {address.slice(0, 6)}...{address.slice(-4)}
        </text>
        <text x="47" y={midY + 9} textAnchor="middle" fill={C.dim} fontSize="7" fontFamily="var(--font-mono)">
          Source
        </text>

        {/* Line source → RSends */}
        <line x1="90" y1={midY} x2="155" y2={midY}
          stroke={C.purple} strokeWidth="1" strokeDasharray="6 3" opacity="0.7">
          <animate attributeName="stroke-dashoffset" from="9" to="0" dur="1.2s" repeatCount="indefinite" />
        </line>

        {/* RSends fee node */}
        <rect x="155" y={midY - 18} width="76" height="36" rx="10"
          fill={`${C.blue}10`} stroke={C.blue} strokeWidth="0.8" />
        <text x="193" y={midY - 3} textAnchor="middle" fill={C.text} fontSize="9" fontFamily="var(--font-mono)">
          RSends
        </text>
        <text x="193" y={midY + 9} textAnchor="middle" fill={C.dim} fontSize="7" fontFamily="var(--font-mono)">
          {RSEND_FEE_PCT}% fee
        </text>

        {/* Destination nodes */}
        {destinations.map((d, i) => {
          const dy = n === 1 ? midY : 22 + i * ((h - 44) / Math.max(1, n - 1))
          return (
            <g key={i}>
              <line x1="231" y1={midY} x2="325" y2={dy}
                stroke={C.green} strokeWidth="1" strokeDasharray="6 3" opacity="0.6">
                <animate attributeName="stroke-dashoffset" from="9" to="0" dur="1.2s" repeatCount="indefinite" />
              </line>
              <rect x="325" y={dy - 18} width="148" height="36" rx="10"
                fill={`${C.green}08`} stroke={C.green} strokeWidth="0.8" />
              <text x="399" y={dy - 3} textAnchor="middle" fill={C.text} fontSize="8" fontFamily="var(--font-mono)">
                {d.label || `${d.address.slice(0, 6)}...${d.address.slice(-4)}`}
              </text>
              <text x="399" y={dy + 9} textAnchor="middle" fill={C.green} fontSize="8" fontFamily="var(--font-mono)" fontWeight="600">
                {d.percent}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  MONITOR TAB
// ═══════════════════════════════════════════════════════════

function MonitorTab({ gas, stats, activeRules, events, connected, emergencyStop, ethPrice, rules, wsStats }: {
  gas: number | null
  stats: any
  activeRules: number
  events: any[]
  connected: boolean
  emergencyStop: () => Promise<any>
  ethPrice: number
  rules: any[]
  wsStats: { totalEvents: number; reconnects: number }
}) {
  const [flash, setFlash] = useState(false)
  const prevLen = useRef(events.length)

  // Flash pipeline green on sweep_completed
  useEffect(() => {
    if (events.length > prevLen.current && events[0]?.type === 'sweep_completed') {
      setFlash(true)
    }
    prevLen.current = events.length
  }, [events.length])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [flash])

  const gl = gas === null ? { label: '--', color: C.dim }
    : gas < 0.01 ? { label: 'Optimal', color: C.green }
    : gas < 0.1 ? { label: 'Normal', color: C.amber }
    : { label: 'High', color: C.red }

  const vol = stats?.total_volume_eth ?? 0
  const cards = [
    { label: 'Gas', value: gas !== null ? gas.toFixed(4) : '--', unit: 'Gwei', badge: gl.label, color: gl.color },
    { label: 'Sweeps 24h', value: String(stats?.total_sweeps ?? 0), unit: '', badge: wsStats.totalEvents > 0 ? `${wsStats.totalEvents} ws` : null, color: C.blue },
    { label: 'Volume 24h', value: `${vol.toFixed(4)} ETH`, unit: '', badge: fiat(vol, ethPrice), color: C.purple },
    { label: 'Active Routes', value: String(activeRules), unit: '', badge: null, color: C.green },
  ]

  // Pipeline destinations
  const activeR = rules.filter((r: any) => r.is_active && !r.is_paused)
  const dests = activeR.slice(0, 5)
  const pipeH = Math.max(120, dests.length * 36 + 40)
  const midY = pipeH / 2

  return (
    <div>
      {/* Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {cards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, ...smooth }}
            style={{
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
              borderRadius: 14, padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{c.label}</span>
              {c.badge && (
                <span style={{ fontFamily: C.M, fontSize: 8, fontWeight: 600, color: c.color, background: `${c.color}12`, padding: '2px 6px', borderRadius: 6 }}>{c.badge}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%', background: c.color,
                boxShadow: `0 0 6px ${c.color}50`, flexShrink: 0, marginBottom: 1,
              }} />
              <span style={{ fontFamily: C.D, fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1 }}>{c.value}</span>
              {c.unit && <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>{c.unit}</span>}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Pipeline Visualization */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${flash ? `${C.green}40` : C.border}`,
        borderRadius: 14, padding: '14px 12px', marginBottom: 12,
        transition: 'border-color 0.6s, box-shadow 0.6s',
        boxShadow: flash ? `0 0 20px ${C.green}15, inset 0 0 20px ${C.green}08` : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub }}>Pipeline</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: connected ? C.green : C.red,
              boxShadow: connected ? `0 0 6px ${C.green}60` : 'none',
              animation: connected ? 'rpPulse 2s ease infinite' : 'none',
            }} />
            <span style={{ fontFamily: C.M, fontSize: 9, color: connected ? C.green : C.dim }}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
        <svg width="100%" viewBox={`0 0 360 ${pipeH}`} style={{ display: 'block' }}>
          {/* Source node */}
          <circle cx="40" cy={midY} r="18" fill={`${C.purple}12`} stroke={C.purple} strokeWidth="0.8" />
          <text x="40" y={midY + 3} textAnchor="middle" fill={C.purple} fontSize="8" fontFamily="var(--font-mono)">SRC</text>

          {/* RSends engine node */}
          <rect x="145" y={midY - 16} width="70" height="32" rx="10"
            fill={flash ? `${C.green}20` : `${C.green}08`} stroke={C.green} strokeWidth="0.8"
            style={{ transition: 'fill 0.6s' }}
          />
          <text x="180" y={midY + 4} textAnchor="middle" fill={C.green} fontSize="9" fontFamily="var(--font-display)" fontWeight="600">RSends</text>

          {/* Source → RSends line */}
          <line x1="58" y1={midY} x2="145" y2={midY} stroke={C.purple} strokeWidth="0.8" strokeDasharray="5 3" opacity="0.5">
            {connected && <animate attributeName="stroke-dashoffset" from="8" to="0" dur="1.2s" repeatCount="indefinite" />}
          </line>
          {/* Particle on source→RSends */}
          {connected && events.length > 0 && (
            <circle r="2.5" fill={C.purple} opacity="0.7">
              <animateMotion path={`M58,${midY} L145,${midY}`} dur="1.8s" repeatCount="indefinite" />
            </circle>
          )}

          {/* Destination nodes + lines */}
          {dests.length > 0 ? dests.map((d: any, i: number) => {
            const dy = (pipeH / (dests.length + 1)) * (i + 1)
            const col = [C.blue, C.green, C.purple, C.amber, C.red][i % 5]
            return (
              <g key={d.id}>
                <line x1="215" y1={midY} x2="300" y2={dy} stroke={col} strokeWidth="0.8" strokeDasharray="5 3" opacity="0.4">
                  {connected && <animate attributeName="stroke-dashoffset" from="8" to="0" dur="1.5s" repeatCount="indefinite" />}
                </line>
                {connected && events.length > 0 && (
                  <circle r="2" fill={col} opacity="0.6">
                    <animateMotion path={`M215,${midY} L300,${dy}`} dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx="320" cy={dy} r="14" fill={`${col}10`} stroke={col} strokeWidth="0.8" />
                <text x="320" y={dy + 3} textAnchor="middle" fill={col} fontSize="7" fontFamily="var(--font-mono)">
                  {(d.label || d.destination_wallet || '').slice(0, 4).toUpperCase() || `D${i + 1}`}
                </text>
              </g>
            )
          }) : (
            <g>
              <line x1="215" y1={midY} x2="300" y2={midY} stroke={C.dim} strokeWidth="0.8" strokeDasharray="5 3" opacity="0.3" />
              <circle cx="320" cy={midY} r="14" fill="rgba(255,255,255,0.03)" stroke={C.dim} strokeWidth="0.8" />
              <text x="320" y={midY + 3} textAnchor="middle" fill={C.dim} fontSize="7" fontFamily="var(--font-mono)">---</text>
            </g>
          )}
        </svg>
      </div>

      {/* Live Feed */}
      <SweepFeed events={events} connected={connected} />

      {/* Emergency Stop */}
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

function HistoryTab({ address, ethPrice, stats: overallStats, rules }: { address: string; ethPrice: number; stats: any; rules: any[] }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)

  const [fToken, setFToken] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fDateFrom, setFDateFrom] = useState('')
  const [fDateTo, setFDateTo] = useState('')
  const [fRoute, setFRoute] = useState('')
  const [fSearch, setFSearch] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

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
      if (fRoute) params.set('rule_id', fRoute)
      if (fSearch) params.set('search', fSearch)

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
  }, [address, page, fToken, fStatus, fDateFrom, fDateTo, fRoute, fSearch])

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
    if (fRoute) params.set('rule_id', fRoute)
    if (fSearch) params.set('search', fSearch)
    return `${BACKEND}/api/v1/forwarding/logs/export?${params}`
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
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

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
        {[
          { label: 'Total Routed', val: overallStats ? `${overallStats.total_volume_eth.toFixed(4)} ETH` : '--', sub: overallStats ? fiat(overallStats.total_volume_eth, ethPrice) : '', color: C.purple },
          { label: 'Fees', val: overallStats ? `${(overallStats.total_volume_eth * RSEND_FEE_PCT / 100).toFixed(6)} ETH` : '--', sub: overallStats ? fiat(overallStats.total_volume_eth * RSEND_FEE_PCT / 100, ethPrice) : '', color: C.amber },
          { label: 'Gas Spent', val: overallStats ? `${overallStats.total_gas_spent_eth.toFixed(6)} ETH` : '--', sub: overallStats ? fiat(overallStats.total_gas_spent_eth, ethPrice) : '', color: C.blue },
          { label: 'Success Rate', val: overallStats ? `${overallStats.success_rate}%` : '--', sub: overallStats ? `${overallStats.completed}/${overallStats.total_sweeps}` : '', color: overallStats?.success_rate >= 90 ? C.green : overallStats?.success_rate >= 70 ? C.amber : C.red },
        ].map(c => (
          <div key={c.label} style={{
            background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '8px 10px',
          }}>
            <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{c.label}</div>
            <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 700, color: c.color }}>{c.val}</div>
            {c.sub && <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, marginTop: 1 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Route</label>
          <select value={fRoute} onChange={e => { setFRoute(e.target.value); setPage(1) }} style={selectStyle}>
            <option value="">All</option>
            {rules.map((r: any) => <option key={r.id} value={r.id}>{r.label || `#${r.id}`}</option>)}
          </select>
        </div>
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
        <div>
          <label style={labelStyle}>TX Hash</label>
          <input value={fSearch} onChange={e => { setFSearch(e.target.value); setPage(1) }} placeholder="0x..." style={inp} />
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${C.border}`,
        borderRadius: 14, overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '32px 78px 44px 80px 1fr 60px 55px',
          gap: 4, padding: '8px 12px',
          borderBottom: `1px solid ${C.border}`,
          background: 'rgba(255,255,255,0.02)',
        }}>
          {['#', 'Time', 'Token', 'Amount', 'Route', 'TX', 'Status'].map(h => (
            <span key={h} style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {h}
            </span>
          ))}
        </div>

        {loading && logs.length === 0 ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[1, 2, 3].map(i => <Sk key={i} w="100%" h={28} r={6} />)}
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontFamily: C.D, fontSize: 12, color: C.dim }}>No transactions found</div>
          </div>
        ) : (
          logs.map((l, i) => {
            const sc = STATUS_COLORS[l.status] ?? C.dim
            const amtUsd = l.amount_usd != null ? l.amount_usd : (l.amount_human || 0) * ethPrice
            const isExpanded = expanded === l.id
            return (
              <div key={l.id}>
                <div
                  onClick={() => setExpanded(isExpanded ? null : l.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 78px 44px 80px 1fr 60px 55px',
                    gap: 4, padding: '8px 12px',
                    borderBottom: (i < logs.length - 1 && !isExpanded) ? `1px solid ${C.border}` : 'none',
                    alignItems: 'center',
                    cursor: 'pointer',
                    background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>#{l.rule_id}</span>
                  <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{fmtDate(l.created_at)}</span>
                  <span style={{ fontFamily: C.M, fontSize: 10, color: C.text, fontWeight: 600 }}>{l.token_symbol}</span>
                  <div>
                    <div style={{ fontFamily: C.M, fontSize: 10, color: C.text }}>
                      {l.amount_human?.toFixed(4)}
                    </div>
                    <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim }}>
                      {fiat(amtUsd / ethPrice, ethPrice)}
                    </div>
                  </div>
                  <span style={{ fontFamily: C.M, fontSize: 9, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tr(l.source_wallet)} {'\u2192'} {tr(l.destination_wallet)}
                  </span>
                  <span>
                    {l.tx_hash ? (
                      <a
                        href={`https://basescan.org/tx/${l.tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ fontFamily: C.M, fontSize: 9, color: C.blue, textDecoration: 'none' }}
                      >
                        {l.tx_hash.slice(0, 8)}...
                      </a>
                    ) : (
                      <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>--</span>
                    )}
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
                {/* Expanded detail row */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div style={{
                        padding: '10px 14px',
                        background: 'rgba(255,255,255,0.015)',
                        borderBottom: `1px solid ${C.border}`,
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                      }}>
                        <div>
                          <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', marginBottom: 3 }}>Recipients</div>
                          <div style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>
                            {tr(l.destination_wallet, 10, 6)}
                            {l.is_split && <span style={{ color: C.purple, marginLeft: 6 }}>{l.split_percent}%</span>}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', marginBottom: 3 }}>Gas</div>
                          <div style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>
                            {l.gas_cost_eth != null ? `${l.gas_cost_eth.toFixed(6)} ETH (${fiat(l.gas_cost_eth, ethPrice)})` : '--'}
                            {l.gas_percent != null && <span style={{ color: C.dim, marginLeft: 6 }}>{l.gas_percent.toFixed(1)}%</span>}
                          </div>
                        </div>
                        {l.error_message && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', marginBottom: 3 }}>Error</div>
                            <div style={{ fontFamily: C.M, fontSize: 10, color: C.red }}>{l.error_message}</div>
                          </div>
                        )}
                        {l.retry_count > 0 && (
                          <div>
                            <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', marginBottom: 3 }}>Retries</div>
                            <div style={{ fontFamily: C.M, fontSize: 10, color: C.amber }}>{l.retry_count}</div>
                          </div>
                        )}
                        {l.executed_at && (
                          <div>
                            <div style={{ fontFamily: C.M, fontSize: 8, color: C.dim, textTransform: 'uppercase', marginBottom: 3 }}>Executed</div>
                            <div style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{fmtDate(l.executed_at)}</div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
          <PaginationBtn label="\u2190" disabled={page <= 1} onClick={() => setPage(p => p - 1)} />
          <span style={{ fontFamily: C.M, fontSize: 11, color: C.sub }}>{page} / {totalPages}</span>
          <PaginationBtn label="\u2192" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} />
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  ANALYTICS TAB
// ═══════════════════════════════════════════════════════════

function AnalyticsTab({ stats: parentStats, daily: parentDaily, loading: parentLoading, ethPrice, isVisible = true }: {
  stats: any; daily: any[]; loading: boolean; ethPrice: number; isVisible?: boolean
}) {
  const [tokenBreakdown, setTokenBreakdown] = useState<{ name: string; value: number }[]>([])
  const [topRoutes, setTopRoutes] = useState<{ label: string; volume: number }[]>([])
  const { address } = useAccount()

  // Period selector
  type Period = '24h' | '7d' | '30d' | 'all'
  const [period, setPeriod] = useState<Period>('30d')
  const [periodStats, setPeriodStats] = useState<any>(null)
  const [periodDaily, setPeriodDaily] = useState<any[]>([])
  const [periodLoading, setPeriodLoading] = useState(false)

  // Use parent data for 30d, fetch for other periods
  const stats = period === '30d' ? parentStats : periodStats
  const daily = period === '30d' ? parentDaily : periodDaily
  const loading = period === '30d' ? parentLoading : periodLoading

  useEffect(() => {
    if (period === '30d' || !address) return
    setPeriodLoading(true)
    const fetchPeriod = async () => {
      try {
        const days = period === '24h' ? 1 : period === '7d' ? 7 : 365
        const [sRes, dRes] = await Promise.all([
          fetch(`${BACKEND}/api/v1/forwarding/stats?owner_address=${address.toLowerCase()}&period=${period}`, { signal: AbortSignal.timeout(15000) }),
          fetch(`${BACKEND}/api/v1/forwarding/stats/daily?owner_address=${address.toLowerCase()}&days=${days}`, { signal: AbortSignal.timeout(15000) }),
        ])
        if (sRes.ok) setPeriodStats(await sRes.json())
        if (dRes.ok) { const d = await dRes.json(); setPeriodDaily(d.data ?? []) }
      } catch { /* */ }
      setPeriodLoading(false)
    }
    fetchPeriod()
  }, [period, address])

  // Token breakdown + top routes
  useEffect(() => {
    if (!address) return
    const f = async () => {
      try {
        const res = await fetch(
          `${BACKEND}/api/v1/forwarding/logs?owner_address=${address.toLowerCase()}&per_page=200`,
          { signal: AbortSignal.timeout(15000) }
        )
        if (!res.ok) return
        const data = await res.json()
        const logs = data.logs ?? []
        const tokenMap: Record<string, number> = {}
        const routeMap: Record<string, number> = {}
        for (const l of logs) {
          const sym = l.token_symbol || 'ETH'
          tokenMap[sym] = (tokenMap[sym] || 0) + (l.amount_human || 0)
          const rLabel = l.label || `Route #${l.rule_id}`
          routeMap[rLabel] = (routeMap[rLabel] || 0) + (l.amount_human || 0)
        }
        setTokenBreakdown(
          Object.entries(tokenMap)
            .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(4)) }))
            .sort((a, b) => b.value - a.value)
        )
        setTopRoutes(
          Object.entries(routeMap)
            .map(([label, volume]) => ({ label, volume: parseFloat(volume.toFixed(4)) }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 5)
        )
      } catch { /* */ }
    }
    f()
  }, [address])

  const s = stats ?? {
    total_sweeps: 0, completed: 0, failed: 0,
    total_volume_eth: 0, total_volume_usd: 0, total_gas_spent_eth: 0,
    success_rate: 0, avg_sweep_time_sec: null,
  }

  // Traditional cost estimate: ~$5 per manual transfer
  const traditionalCost = s.total_sweeps * 5
  const actualCost = s.total_gas_spent_eth * ethPrice
  const feesSaved = Math.max(0, traditionalCost - actualCost)

  const statCards = [
    { label: 'Total Routed', value: `${s.total_volume_eth.toFixed(4)} ETH`, sub: fiat(s.total_volume_eth, ethPrice), color: C.purple },
    { label: 'Fees Saved', value: `$${feesSaved.toFixed(0)}`, sub: `vs ~$5/transfer traditional`, color: C.green },
    { label: 'Success Rate', value: `${s.success_rate}%`, sub: `${s.completed} of ${s.total_sweeps}`, color: s.success_rate >= 90 ? C.green : s.success_rate >= 70 ? C.amber : C.red },
    { label: 'Avg Time', value: s.avg_sweep_time_sec != null ? `${s.avg_sweep_time_sec.toFixed(1)}s` : '--', sub: 'per forward', color: C.blue },
  ]

  const statusBreakdown = [
    { name: 'Completed', value: s.completed, color: C.green },
    { name: 'Failed', value: s.failed, color: C.red },
    { name: 'Other', value: Math.max(0, s.total_sweeps - s.completed - s.failed), color: C.amber },
  ].filter(x => x.value > 0)

  const periods: { key: Period; label: string }[] = [
    { key: '24h', label: '24h' },
    { key: '7d', label: '7d' },
    { key: '30d', label: '30d' },
    { key: 'all', label: 'All' },
  ]

  return (
    <div>
      {/* Period Selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {periods.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: period === p.key ? `linear-gradient(135deg, ${C.red}, ${C.purple})` : 'rgba(255,255,255,0.04)',
              color: period === p.key ? '#fff' : C.dim,
              fontFamily: C.D, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[1, 2, 3, 4].map(i => <Sk key={i} w="100%" h={72} r={14} />)}
        </div>
      ) : (
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
              <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginTop: 2 }}>
                {c.sub}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Volume AreaChart */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '14px 12px 4px', marginBottom: 14,
      }}>
        <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 10 }}>
          Volume ({period === 'all' ? 'All Time' : period})
        </div>
        {!isVisible ? (
          <div style={{ height: 140 }} />
        ) : loading ? (
          <Sk w="100%" h={140} r={8} />
        ) : daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ccVolumeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.purple} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
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

      {/* Top Routes */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '14px 12px', marginBottom: 14,
      }}>
        <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 10 }}>
          Top Routes
        </div>
        {topRoutes.length > 0 ? topRoutes.map((r, i) => {
          const maxVol = topRoutes[0]?.volume || 1
          const pct = (r.volume / maxVol) * 100
          const col = PIE_COLORS[i % PIE_COLORS.length]
          return (
            <div key={r.label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontFamily: C.M, fontSize: 10, color: C.text }}>{r.label}</span>
                <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{r.volume} ETH</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.04)' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: i * 0.08, ease: EASE }}
                  style={{ height: '100%', borderRadius: 2, background: col }}
                />
              </div>
            </div>
          )
        }) : (
          <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>No data</span>
          </div>
        )}
      </div>

      {/* Two columns: PieChart + PieChart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {/* Token Breakdown */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '14px 8px',
        }}>
          <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 8, paddingLeft: 4 }}>
            Token Split
          </div>
          {!isVisible ? (
            <div style={{ height: 80 }} />
          ) : tokenBreakdown.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ResponsiveContainer width={80} height={80}>
                <PieChart>
                  <Pie data={tokenBreakdown} dataKey="value" innerRadius={20} outerRadius={35} paddingAngle={2} strokeWidth={0} animationDuration={600}>
                    {tokenBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
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
          background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '14px 8px',
        }}>
          <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 8, paddingLeft: 4 }}>
            Status
          </div>
          {!isVisible ? (
            <div style={{ height: 80 }} />
          ) : statusBreakdown.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ResponsiveContainer width={80} height={80}>
                <PieChart>
                  <Pie data={statusBreakdown} dataKey="value" innerRadius={20} outerRadius={35} paddingAngle={2} strokeWidth={0} animationDuration={600}>
                    {statusBreakdown.map((s, i) => <Cell key={i} fill={s.color} />)}
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
        background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '14px 12px 4px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: C.sub }}>
            Gas Efficiency ({period === 'all' ? 'All Time' : period})
          </span>
          {s.total_gas_spent_eth > 0 && (
            <span style={{ fontFamily: C.M, fontSize: 9, color: C.amber }}>
              {s.total_gas_spent_eth.toFixed(6)} ETH total ({fiat(s.total_gas_spent_eth, ethPrice)})
            </span>
          )}
        </div>
        {!isVisible ? (
          <div style={{ height: 120 }} />
        ) : loading ? (
          <Sk w="100%" h={120} r={8} />
        ) : daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="gas_total" name="Gas (ETH)" fill={C.amber} radius={[4, 4, 0, 0]} animationDuration={600} />
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
//  GROUPS TAB (Distribution Lists)
// ═══════════════════════════════════════════════════════════

function GroupsTab({
  lists, loading, createList, deleteList,
}: {
  lists: any[]
  loading: boolean
  createList: (name: string, entries: DistributionEntry[]) => Promise<any>
  deleteList: (id: number) => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [entries, setEntries] = useState<DistributionEntry[]>([{ address: '', label: '', percent: 100 }])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)

  const total = entries.reduce((s, e) => s + e.percent, 0)
  const canSave = name.trim() && entries.length > 0 &&
    entries.every(e => isValidAddr(e.address)) &&
    (entries.length === 1 || Math.abs(total - 100) < 1)

  const addEntry = () => {
    if (entries.length >= 5) return
    setEntries([...entries, { address: '', label: '', percent: 0 }])
  }

  const removeEntry = (i: number) => {
    const next = entries.filter((_, idx) => idx !== i)
    if (next.length === 1) next[0].percent = 100
    setEntries(next)
  }

  const handleSave = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await createList(name, entries)
      setName('')
      setEntries([{ address: '', label: '', percent: 100 }])
      setShowForm(false)
    } catch {} finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try { await deleteList(id) } catch {} finally {
      deletingRef.current = false
      setDeleting(false)
    }
    setConfirmDelete(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.sub }}>
          {lists.length} Group{lists.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowForm(s => !s)}
          style={{
            padding: '6px 14px', borderRadius: 10,
            background: showForm ? 'rgba(255,255,255,0.06)' : `${C.blue}10`,
            border: `1px solid ${showForm ? C.border : `${C.blue}25`}`,
            color: showForm ? C.dim : C.blue,
            fontFamily: C.D, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {showForm ? '\u2715 Cancel' : '+ New Group'}
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
            style={{ overflow: 'hidden', marginBottom: 12 }}
          >
            <div className="bf-blur-24s" style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, padding: 16,
            }}>
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Group Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Payroll" style={inp} />
              </div>

              {entries.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    value={e.address}
                    onChange={ev => {
                      const next = [...entries]; next[i] = { ...next[i], address: ev.target.value }; setEntries(next)
                    }}
                    placeholder="0x..."
                    style={{ ...inp, flex: 1 }}
                  />
                  <input
                    value={e.label}
                    onChange={ev => {
                      const next = [...entries]; next[i] = { ...next[i], label: ev.target.value }; setEntries(next)
                    }}
                    placeholder="Label"
                    style={{ ...inp, width: 80 }}
                  />
                  <input
                    type="number"
                    value={e.percent}
                    onChange={ev => {
                      const next = [...entries]; next[i] = { ...next[i], percent: parseInt(ev.target.value) || 0 }; setEntries(next)
                    }}
                    style={{ ...inp, width: 50, textAlign: 'center' }}
                  />
                  {entries.length > 1 && (
                    <button
                      onClick={() => removeEntry(i)}
                      style={{
                        width: 28, borderRadius: 8,
                        background: `${C.red}08`, border: `1px solid ${C.red}20`,
                        color: C.red, cursor: 'pointer', fontFamily: C.M, fontSize: 12,
                      }}
                    >{'\u2715'}</button>
                  )}
                </div>
              ))}

              {entries.length < 5 && (
                <button onClick={addEntry} style={{
                  width: '100%', padding: '6px 0', borderRadius: 8,
                  background: 'transparent', border: `1px dashed ${C.dim}`,
                  color: C.dim, fontFamily: C.M, fontSize: 10, cursor: 'pointer',
                  marginBottom: 8,
                }}>+ Add Entry</button>
              )}

              {entries.length > 1 && (
                <div style={{
                  fontFamily: C.M, fontSize: 9, color: total === 100 ? C.green : C.amber,
                  marginBottom: 8,
                }}>
                  Total: {total}% {total !== 100 ? '(must be 100%)' : '\u2713'}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={!canSave || saving}
                style={{
                  width: '100%', padding: '10px', borderRadius: 12, border: 'none',
                  background: canSave ? `linear-gradient(135deg, ${C.red}, ${C.purple})` : 'rgba(255,255,255,0.04)',
                  color: canSave ? '#fff' : 'rgba(255,255,255,0.35)',
                  fontFamily: C.D, fontSize: 12, fontWeight: 700,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                }}
              >
                {saving ? 'Saving...' : 'Save Group'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List of groups */}
      {loading && lists.length === 0 ? (
        <TabSkeleton />
      ) : lists.length === 0 && !showForm ? (
        <div style={{
          padding: 28, textAlign: 'center',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: 14, border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontFamily: C.D, fontSize: 13, color: C.dim, marginBottom: 4 }}>No groups yet</div>
          <div style={{ fontFamily: C.M, fontSize: 10, color: `${C.dim}80` }}>
            Save destination groups for quick route setup
          </div>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {lists.map((l: any) => (
            <motion.div
              key={l.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${C.border}`,
                borderRadius: 14, padding: 14, marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.text }}>
                  {l.name}
                </span>
                {confirmDelete === l.id ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => handleDelete(l.id)}
                      disabled={deleting}
                      style={{
                        padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.red}25`,
                        background: `${C.red}08`, color: C.red,
                        cursor: deleting ? 'wait' : 'pointer',
                        opacity: deleting ? 0.5 : 1,
                        fontFamily: C.M, fontSize: 9, fontWeight: 600,
                      }}
                    >{deleting ? 'Deleting...' : 'Confirm'}</button>
                    {!deleting && <button
                      onClick={() => setConfirmDelete(null)}
                      style={{
                        padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
                        background: 'transparent', color: C.dim, cursor: 'pointer',
                        fontFamily: C.M, fontSize: 9, fontWeight: 600,
                      }}
                    >Cancel</button>}
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(l.id)}
                    style={{
                      padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.red}25`,
                      background: `${C.red}08`, color: C.red, cursor: 'pointer',
                      fontFamily: C.M, fontSize: 9, fontWeight: 600,
                    }}
                  >Delete</button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(l.entries || []).map((e: DistributionEntry, i: number) => (
                  <span key={i} style={{
                    fontFamily: C.M, fontSize: 9, color: C.sub,
                    background: `${C.sub}10`, padding: '2px 7px', borderRadius: 6,
                  }}>
                    {e.label || tr(e.address)} {e.percent}%
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  SETTINGS TAB
// ═══════════════════════════════════════════════════════════

type SettingsSection = 'security' | 'notifications' | 'distribution' | 'export' | 'danger'

function SettingsTab({
  address, chainId, rules, emergencyStop,
  distLists, distLoading, createDistList, deleteDistList,
}: {
  address: string
  chainId: number
  rules: any[]
  emergencyStop: () => Promise<any>
  distLists: any[]
  distLoading: boolean
  createDistList: (name: string, entries: DistributionEntry[]) => Promise<any>
  deleteDistList: (id: number) => Promise<void>
}) {
  const [expanded, setExpanded] = useState<SettingsSection | null>('security')

  // ── Security: spending limits ──
  const [limits, setLimits] = useState<any>(null)
  const [limitsLoading, setLimitsLoading] = useState(false)

  // ── Notifications: global defaults (applied on new rules) ──
  const [notifyEnabled, setNotifyEnabled] = useState(true)
  const [notifyChannel, setNotifyChannel] = useState<'telegram' | 'email'>('telegram')
  const [chatId, setChatId] = useState('')
  const [email, setEmail] = useState('')
  const [notifySaved, setNotifySaved] = useState(false)

  // ── Distribution lists ──
  const [newListName, setNewListName] = useState('')
  const [newEntries, setNewEntries] = useState<DistributionEntry[]>([{ address: '', label: '', percent: 100 }])
  const [distSaving, setDistSaving] = useState(false)
  const distSavingRef = useRef(false)
  const [distConfirmDel, setDistConfirmDel] = useState<number | null>(null)
  const [distDeleting, setDistDeleting] = useState(false)
  const distDeletingRef = useRef(false)

  // ── Export ──
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv')
  const [exportDateFrom, setExportDateFrom] = useState('')
  const [exportDateTo, setExportDateTo] = useState('')
  const [dac8Year, setDac8Year] = useState(new Date().getFullYear())
  const [dac8Loading, setDac8Loading] = useState(false)
  const dac8Ref = useRef(false)
  const [dac8Result, setDac8Result] = useState<string | null>(null)

  // ── Danger ──
  const [confirmEmergency, setConfirmEmergency] = useState(false)
  const [emergencyLoading, setEmergencyLoading] = useState(false)
  const emergencyRef = useRef(false)
  const [emergencyResult, setEmergencyResult] = useState<string | null>(null)

  // Fetch spending limits
  useEffect(() => {
    if (expanded !== 'security') return
    setLimitsLoading(true)
    fetch(`${BACKEND}/api/v1/forwarding/spending-limits?source_address=${address.toLowerCase()}&chain_id=${chainId}`, {
      signal: AbortSignal.timeout(10000),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setLimits(d))
      .catch(() => {})
      .finally(() => setLimitsLoading(false))
  }, [expanded, address, chainId])

  // Load notification prefs from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`rsend_notif_${address}`)
      if (saved) {
        const p = JSON.parse(saved)
        setNotifyEnabled(p.enabled ?? true)
        setNotifyChannel(p.channel ?? 'telegram')
        setChatId(p.chatId ?? '')
        setEmail(p.email ?? '')
      }
    } catch {}
  }, [address])

  const saveNotifPrefs = () => {
    try {
      localStorage.setItem(`rsend_notif_${address}`, JSON.stringify({
        enabled: notifyEnabled, channel: notifyChannel, chatId, email,
      }))
      setNotifySaved(true)
      setTimeout(() => setNotifySaved(false), 2000)
    } catch {}
  }

  // Distribution list helpers
  const distTotal = newEntries.reduce((s, e) => s + e.percent, 0)
  const canSaveDist = newListName.trim() && newEntries.length > 0 &&
    newEntries.every(e => isValidAddr(e.address)) &&
    (newEntries.length === 1 || Math.abs(distTotal - 100) < 1)

  const handleCreateDist = async () => {
    if (distSavingRef.current) return
    distSavingRef.current = true
    setDistSaving(true)
    try {
      await createDistList(newListName, newEntries)
      setNewListName('')
      setNewEntries([{ address: '', label: '', percent: 100 }])
    } catch {} finally {
      distSavingRef.current = false
      setDistSaving(false)
    }
  }

  // Export handler
  const handleExport = () => {
    const params = new URLSearchParams({
      owner_address: address.toLowerCase(),
      format: exportFormat,
    })
    if (exportDateFrom) params.set('date_from', exportDateFrom)
    if (exportDateTo) params.set('date_to', exportDateTo)
    window.open(`${BACKEND}/api/v1/forwarding/logs/export?${params}`, '_blank')
  }

  // DAC8 handler (ref guard prevents double-click)
  const handleDac8 = async () => {
    if (dac8Ref.current) return
    dac8Ref.current = true
    setDac8Loading(true)
    setDac8Result(null)
    try {
      const res = await fetch(`${BACKEND}/api/v1/dac8/generate?fiscal_year=${dac8Year}`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({ owner_address: address }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `dac8_report_${dac8Year}.xml`
        a.click()
        URL.revokeObjectURL(url)
        setDac8Result('Report downloaded')
      } else {
        setDac8Result(await parseRSendError(res))
      }
    } catch (e) {
      setDac8Result(e instanceof Error ? e.message : 'Network error')
    } finally {
      dac8Ref.current = false
      setDac8Loading(false)
    }
  }

  // Emergency stop handler (ref guard prevents double-click)
  const handleEmergencyStop = async () => {
    if (emergencyRef.current) return
    emergencyRef.current = true
    setEmergencyLoading(true)
    try {
      const data = await emergencyStop()
      setEmergencyResult(`Paused ${data.paused_count ?? 0} rule(s)`)
      setConfirmEmergency(false)
    } catch (e) {
      setEmergencyResult(e instanceof Error ? e.message : 'Failed')
    } finally {
      emergencyRef.current = false
      setEmergencyLoading(false)
    }
    setTimeout(() => setEmergencyResult(null), 4000)
  }

  // Section header helper
  const SectionHeader = ({ id, label, icon, color }: { id: SettingsSection; label: string; icon: string; color: string }) => (
    <button
      onClick={() => setExpanded(expanded === id ? null : id)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', borderRadius: 12,
        background: expanded === id ? `${color}08` : 'rgba(255,255,255,0.02)',
        border: `1px solid ${expanded === id ? `${color}30` : C.border}`,
        color: expanded === id ? C.text : C.sub,
        fontFamily: C.D, fontSize: 12, fontWeight: 600,
        cursor: 'pointer', transition: 'all 0.2s',
        marginBottom: expanded === id ? 0 : 0,
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 14, opacity: 0.7 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim, transform: expanded === id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▸</span>
    </button>
  )

  const cardStyle: React.CSSProperties = {
    padding: '14px', borderRadius: 12,
    background: 'rgba(255,255,255,0.02)',
    border: `1px solid ${C.border}`,
  }

  const activeRules = rules.filter(r => r.is_active && !r.is_paused).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* ════════════ SECURITY ════════════ */}
      <SectionHeader id="security" label="Security" icon="🛡" color={C.blue} />
      <AnimatePresence>
        {expanded === 'security' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Spending Limits */}
              <div>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Spending Limits</div>
                {limitsLoading ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Sk w="33%" h={60} r={10} /><Sk w="33%" h={60} r={10} /><Sk w="33%" h={60} r={10} />
                  </div>
                ) : limits ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {[
                      { label: 'Per Hour', spent: limits.per_hour?.spent ?? 0, limit: limits.per_hour?.limit ?? 0, color: C.blue },
                      { label: 'Per Day', spent: limits.per_day?.spent ?? 0, limit: limits.per_day?.limit ?? 0, color: C.purple },
                      { label: 'Global Daily', spent: limits.global_daily?.spent ?? 0, limit: limits.global_daily?.limit ?? 0, color: C.green },
                    ].map(l => {
                      const pct = l.limit > 0 ? Math.min(100, (l.spent / l.limit) * 100) : 0
                      const warn = pct >= 80
                      return (
                        <div key={l.label} style={cardStyle}>
                          <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginBottom: 6 }}>{l.label}</div>
                          <div style={{ fontFamily: C.D, fontSize: 13, fontWeight: 700, color: warn ? C.amber : C.text }}>
                            {l.spent.toFixed(4)}
                          </div>
                          <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginBottom: 6 }}>
                            / {l.limit.toFixed(4)} ETH
                          </div>
                          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6, ease: EASE }}
                              style={{ height: '100%', borderRadius: 2, background: warn ? C.amber : l.color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ ...cardStyle, fontFamily: C.M, fontSize: 11, color: C.dim, textAlign: 'center' }}>
                    No limits configured
                  </div>
                )}
              </div>

              {/* Whitelist */}
              <div>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Approved Destinations</div>
                <div style={cardStyle}>
                  {rules.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {[...new Set(rules.map(r => r.destination_wallet))].map(dest => (
                        <div key={dest} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green }} />
                          <span style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>{tr(dest, 8, 6)}</span>
                          <span style={{ fontFamily: C.M, fontSize: 8, color: C.dim, background: `${C.green}10`, padding: '1px 5px', borderRadius: 4 }}>
                            whitelisted
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim, textAlign: 'center' }}>
                      No destinations configured
                    </div>
                  )}
                </div>
              </div>

              {/* Circuit Breaker */}
              <div>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Circuit Breaker</div>
                <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: activeRules > 0 ? C.green : C.dim,
                      boxShadow: activeRules > 0 ? `0 0 6px ${C.green}60` : 'none',
                    }} />
                    <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.text }}>
                      {activeRules > 0 ? 'Closed (Active)' : 'Open (Idle)'}
                    </span>
                  </div>
                  <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>
                    {activeRules} active rule{activeRules !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════ NOTIFICATIONS ════════════ */}
      <SectionHeader id="notifications" label="Notifications" icon="🔔" color={C.purple} />
      <AnimatePresence>
        {expanded === 'notifications' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Enable toggle */}
              <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.text }}>Enable Notifications</div>
                  <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginTop: 2 }}>Applied as default for new rules</div>
                </div>
                <ToggleSwitch value={notifyEnabled} onChange={setNotifyEnabled} />
              </div>

              {notifyEnabled && (
                <>
                  {/* Channel selector */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {(['telegram', 'email'] as const).map(ch => (
                      <button
                        key={ch}
                        onClick={() => setNotifyChannel(ch)}
                        style={{
                          ...cardStyle, textAlign: 'center', cursor: 'pointer',
                          borderColor: notifyChannel === ch ? `${C.purple}50` : C.border,
                          background: notifyChannel === ch ? `${C.purple}08` : 'rgba(255,255,255,0.02)',
                        }}
                      >
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{ch === 'telegram' ? '✈' : '✉'}</div>
                        <div style={{ fontFamily: C.D, fontSize: 11, fontWeight: 600, color: notifyChannel === ch ? C.text : C.sub, textTransform: 'capitalize' }}>
                          {ch}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Input field */}
                  {notifyChannel === 'telegram' ? (
                    <div>
                      <label style={labelStyle}>Telegram Chat ID</label>
                      <input
                        style={inp}
                        placeholder="e.g. -1001234567890"
                        value={chatId}
                        onChange={e => setChatId(e.target.value)}
                      />
                      <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginTop: 4 }}>
                        Add @RSendssBot to your group, then send /start to get the chat ID
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label style={labelStyle}>Email Address</label>
                      <input
                        style={inp}
                        placeholder="you@example.com"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Save button */}
                  <button
                    onClick={saveNotifPrefs}
                    style={{
                      padding: '8px 16px', borderRadius: 10, border: 'none',
                      background: notifySaved ? `${C.green}20` : `${C.purple}15`,
                      color: notifySaved ? C.green : C.purple,
                      fontFamily: C.D, fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    {notifySaved ? '✓ Saved' : 'Save Preferences'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════ DISTRIBUTION LISTS ════════════ */}
      <SectionHeader id="distribution" label="Distribution Lists" icon="📋" color={C.green} />
      <AnimatePresence>
        {expanded === 'distribution' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Existing lists */}
              {distLoading ? (
                <Sk w="100%" h={60} r={10} />
              ) : distLists.length > 0 ? (
                distLists.map(l => (
                  <div key={l.id} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.text }}>{l.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>
                          {(l.entries || []).length} recipient{(l.entries || []).length !== 1 ? 's' : ''}
                        </span>
                        {distConfirmDel === l.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              disabled={distDeleting}
                              onClick={async () => {
                                if (distDeletingRef.current) return
                                distDeletingRef.current = true
                                setDistDeleting(true)
                                try { await deleteDistList(l.id); setDistConfirmDel(null) } catch {} finally {
                                  distDeletingRef.current = false
                                  setDistDeleting(false)
                                }
                              }}
                              style={{ padding: '2px 8px', borderRadius: 5, border: 'none', background: C.red, color: '#fff', fontFamily: C.M, fontSize: 9, cursor: distDeleting ? 'wait' : 'pointer', opacity: distDeleting ? 0.5 : 1 }}>
                              {distDeleting ? '...' : 'Yes'}
                            </button>
                            {!distDeleting && <button onClick={() => setDistConfirmDel(null)}
                              style={{ padding: '2px 8px', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, fontFamily: C.M, fontSize: 9, cursor: 'pointer' }}>
                              No
                            </button>}
                          </div>
                        ) : (
                          <button onClick={() => setDistConfirmDel(l.id)}
                            style={{ padding: '2px 8px', borderRadius: 5, border: `1px solid ${C.red}25`, background: `${C.red}08`, color: C.red, fontFamily: C.M, fontSize: 9, cursor: 'pointer' }}>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(l.entries || []).map((e: DistributionEntry, i: number) => (
                        <span key={i} style={{ fontFamily: C.M, fontSize: 9, color: C.sub, background: `${C.sub}10`, padding: '2px 7px', borderRadius: 6 }}>
                          {e.label || tr(e.address)} {e.percent}%
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ ...cardStyle, textAlign: 'center', fontFamily: C.M, fontSize: 11, color: C.dim }}>
                  No distribution lists yet
                </div>
              )}

              {/* Create new list */}
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>New List</div>
                <input
                  style={inp}
                  placeholder="List name"
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                />
                {newEntries.map((entry, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 28px', gap: 4, alignItems: 'center' }}>
                    <input
                      style={inp}
                      placeholder="0x..."
                      value={entry.address}
                      onChange={e => {
                        const next = [...newEntries]
                        next[i] = { ...next[i], address: e.target.value }
                        setNewEntries(next)
                      }}
                    />
                    <input
                      style={{ ...inp, textAlign: 'center' }}
                      placeholder="%"
                      type="number"
                      value={entry.percent || ''}
                      onChange={e => {
                        const next = [...newEntries]
                        next[i] = { ...next[i], percent: Number(e.target.value) || 0 }
                        setNewEntries(next)
                      }}
                    />
                    {newEntries.length > 1 && (
                      <button
                        onClick={() => {
                          const next = newEntries.filter((_, idx) => idx !== i)
                          if (next.length === 1) next[0].percent = 100
                          setNewEntries(next)
                        }}
                        style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer', fontSize: 12 }}
                      >×</button>
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6 }}>
                  {newEntries.length < 5 && (
                    <button
                      onClick={() => setNewEntries([...newEntries, { address: '', label: '', percent: 0 }])}
                      style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.sub, fontFamily: C.M, fontSize: 9, cursor: 'pointer' }}
                    >+ Add Recipient</button>
                  )}
                  <button
                    onClick={handleCreateDist}
                    disabled={!canSaveDist || distSaving}
                    style={{
                      padding: '5px 12px', borderRadius: 8, border: 'none',
                      background: canSaveDist ? `${C.green}20` : 'rgba(255,255,255,0.04)',
                      color: canSaveDist ? C.green : C.dim,
                      fontFamily: C.D, fontSize: 10, fontWeight: 600,
                      cursor: canSaveDist ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {distSaving ? 'Saving...' : 'Create List'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════ EXPORT & COMPLIANCE ════════════ */}
      <SectionHeader id="export" label="Export & Compliance" icon="📊" color={C.amber} />
      <AnimatePresence>
        {expanded === 'export' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* DAC8 Report */}
              <div style={cardStyle}>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>DAC8 / CARF Report</div>
                <div style={{ fontFamily: C.M, fontSize: 10, color: C.sub, marginBottom: 10, lineHeight: 1.5 }}>
                  Generate an XML report for European DAC8 tax reporting obligations.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Year</label>
                  <select
                    style={{ ...selectStyle, width: 90 }}
                    value={dac8Year}
                    onChange={e => setDac8Year(Number(e.target.value))}
                  >
                    {[2024, 2025, 2026].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleDac8}
                    disabled={dac8Loading}
                    style={{
                      padding: '7px 14px', borderRadius: 8, border: 'none',
                      background: `${C.amber}15`, color: C.amber,
                      fontFamily: C.D, fontSize: 10, fontWeight: 600,
                      cursor: dac8Loading ? 'wait' : 'pointer',
                    }}
                  >
                    {dac8Loading ? 'Generating...' : 'Generate XML'}
                  </button>
                </div>
                {dac8Result && (
                  <div style={{ fontFamily: C.M, fontSize: 10, color: dac8Result.startsWith('Report') ? C.green : C.red, marginTop: 6 }}>
                    {dac8Result}
                  </div>
                )}
              </div>

              {/* Export Sweep Logs */}
              <div style={cardStyle}>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Export Sweep Logs</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={labelStyle}>From</label>
                    <input style={inp} type="date" value={exportDateFrom} onChange={e => setExportDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>To</label>
                    <input style={inp} type="date" value={exportDateTo} onChange={e => setExportDateTo(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Format</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['csv', 'json'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setExportFormat(f)}
                        style={{
                          padding: '4px 12px', borderRadius: 6, border: `1px solid ${exportFormat === f ? `${C.amber}40` : C.border}`,
                          background: exportFormat === f ? `${C.amber}10` : 'transparent',
                          color: exportFormat === f ? C.amber : C.dim,
                          fontFamily: C.M, fontSize: 10, fontWeight: 600,
                          cursor: 'pointer', textTransform: 'uppercase',
                        }}
                      >{f}</button>
                    ))}
                  </div>
                  <button
                    onClick={handleExport}
                    style={{
                      marginLeft: 'auto',
                      padding: '6px 14px', borderRadius: 8, border: 'none',
                      background: `${C.amber}15`, color: C.amber,
                      fontFamily: C.D, fontSize: 10, fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Download
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════ DANGER ZONE ════════════ */}
      <SectionHeader id="danger" label="Danger Zone" icon="⚠" color={C.red} />
      <AnimatePresence>
        {expanded === 'danger' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Emergency Stop */}
              <div style={{ ...cardStyle, borderColor: `${C.red}20` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.red }}>Emergency Stop</div>
                    <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, marginTop: 2 }}>
                      Immediately pause all {activeRules} active forwarding rule{activeRules !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                {emergencyResult && (
                  <div style={{
                    fontFamily: C.M, fontSize: 10, padding: '6px 10px', borderRadius: 8, marginBottom: 6,
                    background: emergencyResult.startsWith('Paused') ? `${C.green}10` : `${C.red}10`,
                    color: emergencyResult.startsWith('Paused') ? C.green : C.red,
                  }}>
                    {emergencyResult}
                  </div>
                )}
                {!confirmEmergency ? (
                  <button
                    onClick={() => setConfirmEmergency(true)}
                    disabled={activeRules === 0}
                    style={{
                      width: '100%', padding: '10px', borderRadius: 10,
                      border: `1px solid ${activeRules > 0 ? C.red : C.dim}`,
                      background: activeRules > 0 ? `${C.red}10` : 'transparent',
                      color: activeRules > 0 ? C.red : C.dim,
                      fontFamily: C.D, fontSize: 12, fontWeight: 700,
                      cursor: activeRules > 0 ? 'pointer' : 'not-allowed',
                      transition: 'all 0.2s',
                    }}
                  >
                    Stop All Routes
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleEmergencyStop}
                      disabled={emergencyLoading}
                      style={{
                        flex: 1, padding: '10px', borderRadius: 10, border: 'none',
                        background: C.red, color: '#fff',
                        fontFamily: C.D, fontSize: 12, fontWeight: 700,
                        cursor: emergencyLoading ? 'wait' : 'pointer',
                      }}
                    >
                      {emergencyLoading ? 'Stopping...' : 'Confirm Stop All'}
                    </button>
                    <button
                      onClick={() => setConfirmEmergency(false)}
                      style={{
                        padding: '10px 16px', borderRadius: 10,
                        border: `1px solid ${C.border}`, background: 'transparent',
                        color: C.sub, fontFamily: C.D, fontSize: 12, cursor: 'pointer',
                      }}
                    >Cancel</button>
                  </div>
                )}
              </div>

              {/* Info notice */}
              <div style={{
                padding: '10px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontFamily: C.M, fontSize: 9, color: C.dim, lineHeight: 1.6 }}>
                  Paused rules can be individually resumed from the Routes tab.
                  Rule deletion requires wallet signature and is permanent.
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════
//  REUSABLE COMPONENTS
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
