'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWriteContract } from 'wagmi'
import { C, EASE, BACKEND, CHAIN_NAMES, inp, selectStyle, labelStyle, isValidAddr, tr, ToggleSwitch, Sk } from './shared'
import type { DistributionEntry } from '../../lib/useDistributionList'
import { getRegistry } from '../../lib/contractRegistry'
import { FEE_ROUTER_ABI } from '../../lib/feeRouterAbi'
import { mutationHeaders, parseRSendError } from '../../lib/rsendFetch'
import { logger } from '../../lib/logger'

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
    } catch (err) {
      logger.warn('CommandCenter', 'Load notification prefs failed', { error: String(err) })
    }
  }, [address])

  const saveNotifPrefs = () => {
    try {
      localStorage.setItem(`rsend_notif_${address}`, JSON.stringify({
        enabled: notifyEnabled, channel: notifyChannel, chatId, email,
      }))
      setNotifySaved(true)
      setTimeout(() => setNotifySaved(false), 2000)
    } catch (err) {
      logger.error('CommandCenter', 'Save notification prefs failed', { error: String(err) })
    }
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
    } catch (err) {
      logger.error('CommandCenter', 'Create distribution list failed', { error: String(err) })
    } finally {
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
                                try { await deleteDistList(l.id); setDistConfirmDel(null) } catch (err) {
                                  logger.error('CommandCenter', 'Delete dist list failed', { listId: String(l.id), error: String(err) })
                                } finally {
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

export default SettingsTab
