'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import RuleCard from '../RuleCard'
import { logger } from '../../lib/logger'
import type { ChainFamily } from '../../lib/chain-adapters/types'
import type { CreateRulePayload } from '../../lib/useForwardingRules'
import type {
  CreateSplitContractPayload,
  SimulateSplitPayload,
  SimulationResult,
  SplitContract,
} from '../../lib/useSplitContracts'
import { C, EASE, TabSkeleton } from './shared'

const RouteWizard = dynamic(() => import('./RouteWizard'), { ssr: false })

function RoutesTab({
  address, chainId, balance, ethPrice, rules, loading,
  createRule, createRuleBatch, createSplitContract, simulateSplit,
  updateRule, deleteRule, pauseRule, resumeRule,
  distLists, activeFamily, isMobile,
}: {
  address: string
  chainId: number
  balance: any
  ethPrice: number
  rules: any[]
  loading: boolean
  createRule: (p: CreateRulePayload) => Promise<any>
  createRuleBatch: (p: CreateRulePayload[]) => Promise<void>
  createSplitContract?: (p: CreateSplitContractPayload) => Promise<SplitContract>
  simulateSplit?: (p: SimulateSplitPayload) => Promise<SimulationResult>
  updateRule: (id: number, u: Record<string, any>) => Promise<void>
  deleteRule: (id: number) => Promise<void>
  pauseRule: (id: number) => Promise<void>
  resumeRule: (id: number) => Promise<void>
  distLists: any[]
  activeFamily: ChainFamily
  isMobile?: boolean
}) {
  const t = useTranslations('commandCenter.routes')

  // ── Non-EVM guard: auto-forwarding is EVM-only for now ──
  if (activeFamily !== 'evm') {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>
          {activeFamily === 'solana' ? '◎' : '◆'}
        </div>
        <div style={{ fontFamily: C.D, fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          {t('nonEvmTitle', { chain: activeFamily === 'solana' ? 'Solana' : 'TRON' })}
        </div>
        <div style={{ fontFamily: C.M, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
          {t('nonEvmDesc')}
        </div>
      </div>
    )
  }

  const [showWizard, setShowWizard] = useState(false)

  const handleToggle = async (id: number, active: boolean) => {
    try {
      await updateRule(id, { is_active: !active })
    } catch (err) {
      logger.error('CommandCenter', 'Toggle rule failed', { ruleId: String(id), error: String(err) })
    }
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
          onCreateSplitContract={createSplitContract}
          onSimulateSplit={simulateSplit}
          address={address}
          chainId={chainId}
          balance={balance}
          ethPrice={ethPrice}
          distLists={distLists}
          isMobile={isMobile}
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
          {t('newRoute')}
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
  const t = useTranslations('commandCenter.routes')
  const features = [
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14M12 5l7 7-7 7" stroke={C.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('autoForward'),
      desc: t('autoForwardDesc'),
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6 12h4M14 8h4M14 16h4M10 12l4-4M10 12l4 4" stroke={C.purple} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('splitRouting'),
      desc: t('splitRoutingDesc'),
    },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={C.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('smartGas'),
      desc: t('smartGasDesc'),
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
        {t('noRoutesYet')}
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
        {t('createFirstRoute')}
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
              background: 'rgba(10,10,10,0.03)',
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

export default RoutesTab
