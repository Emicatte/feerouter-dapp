'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
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


function FeatureCardsRow({ t }: { t: ReturnType<typeof useTranslations> }) {
  const cards = [
    { key: 'autoForward',  icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M10 7l-2-2M10 7l-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { key: 'splitRouting', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4l4 3-4 3M7 4l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { key: 'smartGas',     icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2l-3 5h2l-1 5 4-6H7l1-4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg> },
  ] as const
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
      {cards.map(c => (
        <div key={c.key} className="bg-white border border-[rgba(200,81,44,0.2)] rounded-xl px-4 py-3.5">
          <div className="w-7 h-7 bg-[rgba(200,81,44,0.08)] rounded-[7px] flex items-center justify-center text-[#C8512C] mb-2.5">{c.icon}</div>
          <div className="text-[13px] font-medium text-[#2C2C2A] mb-[3px]">{t(`routes.${c.key}`)}</div>
          <div className="text-[11px] text-[#888780] leading-[1.45]">{t(`routes.${c.key}Desc`)}</div>
        </div>
      ))}
    </div>
  )
}


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
  const t = useTranslations('commandCenter')
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
  const switchTab = (next: Tab) => {
    if (next === tab) return
    setTabLoading(true)
    setTab(next)
    setTimeout(() => setTabLoading(false), 300)
  }

  const activeRules = rules.filter(r => r.is_active && !r.is_paused).length

  const familyDot =
    wallet.activeFamily === 'evm'    ? '#378ADD' :
    wallet.activeFamily === 'solana' ? '#7F77DD' :
                                       '#E24B4A'

  const chainLabel =
    wallet.activeFamily === 'evm'    ? (CHAIN_NAMES[chainId] || 'EVM') :
    wallet.activeFamily === 'solana' ? 'Solana' :
                                       'TRON'

  const volumeDisplay = stats ? fiat(stats.total_volume_eth, ethPrice) : '—'
  const sweepsDisplay = stats ? String(stats.total_sweeps) : '—'
  const routesDisplay = String(activeRules)

  // ── Not connected (any chain family) ──────────────────
  if (!isConnected && !wallet.activeAddress) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontFamily: C.D, fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          {t('connectWallet')}
        </div>
        <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim }}>
          {t('toAccessFlow')}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-5">

      {/* STATS STRIP */}
      <div className="mb-4 rounded-2xl border border-[rgba(200,81,44,0.35)] bg-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full inline-block" style={{ backgroundColor: familyDot }} />
          <span className="text-[12px] font-medium text-[#2C2C2A]">{chainLabel}</span>
        </div>

        <div className="flex items-center gap-5">
          <div className="flex flex-col gap-[2px]">
            <span className="text-[10px] uppercase tracking-[0.5px] font-medium text-[#888780]">{t('stats.volume')}</span>
            <span className="text-[14px] text-[#2C2C2A] font-mono font-medium">{volumeDisplay}</span>
          </div>
          <div className="w-px h-[28px] bg-[rgba(136,135,128,0.25)]" />
          <div className="flex flex-col gap-[2px]">
            <span className="text-[10px] uppercase tracking-[0.5px] font-medium text-[#888780]">{t('stats.sweeps')}</span>
            <span className="text-[14px] text-[#2C2C2A] font-mono font-medium">{sweepsDisplay}</span>
          </div>
          <div className="w-px h-[28px] bg-[rgba(136,135,128,0.25)]" />
          <div className="flex flex-col gap-[2px]">
            <span className="text-[10px] uppercase tracking-[0.5px] font-medium text-[#C8512C]">{t('stats.routes')}</span>
            <span className="text-[14px] text-[#2C2C2A] font-mono font-medium">{routesDisplay}</span>
          </div>
        </div>
      </div>

      {/* SUB-TAB BAR */}
      <div className={isMobile ? 'mb-5 overflow-x-auto hide-scrollbar' : 'mb-5 flex justify-center'}>
        <div className="inline-flex gap-[2px] p-[3px] rounded-[10px] border border-[rgba(200,81,44,0.2)] bg-white">
          {TABS.map(({ key, icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => switchTab(key)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'px-[14px] py-[6px] text-[12px] rounded-[7px] transition-colors font-display whitespace-nowrap',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,81,44,0.3)]',
                  'flex items-center gap-1.5',
                  active
                    ? 'bg-[rgba(200,81,44,0.1)] text-[#C8512C] font-medium border border-[rgba(200,81,44,0.25)]'
                    : 'bg-transparent text-[#888780] hover:text-[#2C2C2A] border border-transparent',
                ].join(' ')}
              >
                {!isMobile && <span className="text-[11px] opacity-80">{icon}</span>}
                <span>{t(`tabs.${key}`)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* SUB-TAB CONTENT */}
      <div className="mb-5">
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

      {/* FEATURE CARDS ROW */}
      <FeatureCardsRow t={t} />

    </div>
  )
}
