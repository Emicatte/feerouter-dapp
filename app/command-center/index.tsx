'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useAccount, useChainId, useBalance } from 'wagmi'
import { useUniversalWallet } from '../../hooks/useUniversalWallet'
import { useForwardingRules } from '../../lib/useForwardingRules'
import { useSplitContracts } from '../../lib/useSplitContracts'
import { useSweepWebSocket } from '../../lib/useSweepWebSocket'
import { useSweepStats } from '../../lib/useSweepStats'
import { useDistributionList } from '../../lib/useDistributionList'
import { useIsMobile } from '../../hooks/useIsMobile'
import { logger } from '../../lib/logger'

import { C, TABS, CHAIN_NAMES, smooth, tabContent, fiat, TabSkeleton } from './shared'
import type { Tab } from './shared'

const RoutesTab = dynamic(() => import('./RoutesTab'), { loading: () => <TabSkeleton /> })
const SplitsTab = dynamic(() => import('./SplitsTab'), { loading: () => <TabSkeleton /> })
const MonitorTab = dynamic(() => import('./MonitorTab'), { loading: () => <TabSkeleton /> })
const HistoryTab = dynamic(() => import('./HistoryTab'), { loading: () => <TabSkeleton /> })
const AnalyticsTab = dynamic(() => import('./AnalyticsTab'), { loading: () => <TabSkeleton /> })
const GroupsTab = dynamic(() => import('./GroupsTab'), { loading: () => <TabSkeleton /> })
const SettingsTab = dynamic(() => import('./SettingsTab'), { loading: () => <TabSkeleton /> })


export default function CommandCenter({
  ownerAddress,
  chainId: chainIdProp,
  isVisible = true,
  deepLink,
  onDeepLinkConsumed,
}: {
  ownerAddress?: string
  chainId?: number
  isVisible?: boolean
  deepLink?: string | null
  onDeepLinkConsumed?: () => void
}) {
  const { address: hookAddr, isConnected } = useAccount()
  const hookChainId = useChainId()
  const address = ownerAddress ?? hookAddr
  const chainId = chainIdProp ?? hookChainId
  const { data: balance } = useBalance({ address: address as `0x${string}` | undefined })
  const wallet = useUniversalWallet()
  const isMobile = useIsMobile()

  const [tab, setTab] = useState<Tab>('routes')
  const [tabLoading, setTabLoading] = useState(false)
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | null>(null)

  useEffect(() => {
    if (deepLink === 'apikeys') {
      setTab('settings')
      setSettingsInitialSection('apikeys')
      onDeepLinkConsumed?.()
    }
  }, [deepLink, onDeepLinkConsumed])

  // ── ETH price (derived from stats, fallback $3200) ────
  const [ethPrice, setEthPrice] = useState(3200)

  // ── Hooks ─────────────────────────────────────────────
  const {
    rules, loading: rulesLoading,
    createRule, createRuleBatch, updateRule, deleteRule,
    pauseRule, resumeRule, emergencyStop,
  } = useForwardingRules(address)

  // N-wallet split system (S2/S3) — coexists with legacy forwarding rules.
  const {
    contracts: splitContracts,
    loading: splitLoading,
    createContract: createSplitContract,
    deactivateContract: deactivateSplitContract,
    simulateSplit,
    listExecutions: listSplitExecutions,
    refresh: refreshSplitContracts,
  } = useSplitContracts(address)

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
      } catch (err) {
        logger.warn('CommandCenter', 'Gas price fetch failed', { error: String(err) })
      }
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

  // ── Not connected (any chain family) ──────────────────
  if (!isConnected && !wallet.activeAddress) {
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
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 8 : 16,
        padding: '6px 12px', marginBottom: 8,
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 10, border: `1px solid ${C.border}`,
        ...(isMobile ? { flexWrap: 'wrap' } : {}),
      }}>
        {/* Chain family badge */}
        <div style={{
          padding: '3px 8px', borderRadius: 6,
          ...(isMobile ? { flex: '1 1 100%', textAlign: 'center' as const } : {}),
          background: wallet.activeFamily === 'evm' ? '#627EEA15' :
                      wallet.activeFamily === 'solana' ? '#9945FF15' : '#FF001315',
          fontFamily: C.D, fontSize: 10, fontWeight: 600,
          color: wallet.activeFamily === 'evm' ? '#627EEA' :
                 wallet.activeFamily === 'solana' ? '#9945FF' : '#FF0013',
        }}>
          {wallet.activeFamily === 'evm' ? `⟠ ${CHAIN_NAMES[chainId] || 'EVM'}` :
           wallet.activeFamily === 'solana' ? '◎ Solana' : '◆ TRON'}
        </div>

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
      <div className={isMobile ? 'hide-scrollbar' : ''} style={{
        display: 'flex', gap: 0,
        borderBottom: `1px solid ${C.border}`,
        marginBottom: 12,
        ...(isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : {}),
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            style={{
              flex: isMobile ? 'none' : 1,
              padding: '10px 0',
              ...(isMobile ? { minWidth: 72, paddingLeft: 8, paddingRight: 8 } : {}),
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
                  createSplitContract={createSplitContract}
                  simulateSplit={simulateSplit}
                  updateRule={updateRule}
                  deleteRule={deleteRule}
                  pauseRule={pauseRule}
                  resumeRule={resumeRule}
                  distLists={distLists}
                  activeFamily={wallet.activeFamily}
                  isMobile={isMobile}
                />
              )}
              {tab === 'splits' && (
                <SplitsTab
                  contracts={splitContracts}
                  loading={splitLoading}
                  deactivateContract={deactivateSplitContract}
                  listExecutions={listSplitExecutions}
                  refresh={refreshSplitContracts}
                  activeFamily={wallet.activeFamily}
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
                  activeFamily={wallet.activeFamily}
                />
              )}
              {tab === 'history' && (
                <HistoryTab address={address!} ethPrice={ethPrice} stats={stats} rules={rules} activeFamily={wallet.activeFamily} walletAddress={wallet.activeAddress?.raw ?? null} />
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
                  activeFamily={wallet.activeFamily}
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
                  initialSection={settingsInitialSection as any}
                  onInitialSectionConsumed={() => setSettingsInitialSection(null)}
                />
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
