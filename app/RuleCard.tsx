'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import type { ForwardingRule } from '../lib/useForwardingRules'

const C = {
  bg: '#0a0a0f', surface: '#111118', card: '#16161f',
  border: 'rgba(255,255,255,0.06)', text: '#E2E2F0',
  sub: '#8A8FA8', dim: '#4A4E64', green: '#00D68F',
  red: '#FF4C6A', amber: '#FFB547', blue: '#3B82F6',
  purple: '#8B5CF6',
  D: 'var(--font-display)', M: 'var(--font-mono)',
}

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

interface Props {
  rule: ForwardingRule
  onToggle: (id: number, active: boolean) => void
  onPause: (id: number) => void
  onResume: (id: number) => void
  onDelete: (id: number) => void
}

export default function RuleCard({ rule, onToggle, onPause, onResume, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isPaused = rule.is_paused
  const isActive = rule.is_active && !isPaused

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${isPaused ? `${C.amber}20` : isActive ? `${C.green}15` : C.border}`,
        borderRadius: 14,
        padding: 14,
        marginBottom: 8,
        opacity: rule.is_active ? 1 : 0.5,
        transition: 'border-color 0.2s, opacity 0.2s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: isPaused ? C.amber : isActive ? C.green : C.dim,
            boxShadow: isPaused ? `0 0 6px ${C.amber}50` : isActive ? `0 0 6px ${C.green}50` : 'none',
          }} />
          <span style={{ fontFamily: C.D, fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rule.label || `Rule #${rule.id}`}
          </span>
          {isPaused && (
            <span style={{ fontFamily: C.M, fontSize: 8, color: C.amber, background: `${C.amber}12`, padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
              PAUSED
            </span>
          )}
        </div>

        {/* Toggle switch */}
        <button
          onClick={() => onToggle(rule.id, rule.is_active)}
          style={{
            width: 34, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
            background: isActive ? C.green : 'rgba(255,255,255,0.08)',
            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          }}
        >
          <div style={{
            width: 12, height: 12, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3,
            left: isActive ? 19 : 3, transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Route info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontFamily: C.M, fontSize: 11, color: C.sub }}>{tr(rule.source_wallet)}</span>
        <span style={{ fontFamily: C.M, fontSize: 10, color: C.dim }}>-&gt;</span>
        <span style={{ fontFamily: C.M, fontSize: 11, color: C.text }}>{tr(rule.destination_wallet)}</span>
      </div>

      {/* Split info */}
      {rule.split_enabled && rule.split_destination && (
        <div style={{
          background: `${C.purple}08`, border: `1px solid ${C.purple}15`,
          borderRadius: 8, padding: '6px 10px', marginBottom: 8,
        }}>
          <div style={{ fontFamily: C.M, fontSize: 9, color: C.purple, marginBottom: 2 }}>SPLIT ROUTING</div>
          <div style={{ fontFamily: C.M, fontSize: 10, color: C.sub }}>
            {rule.split_percent}% -&gt; Primary &middot; {100 - rule.split_percent}% -&gt; {tr(rule.split_destination)}
          </div>
        </div>
      )}

      {/* Params row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <Tag label={`${rule.min_threshold} ${rule.token_symbol}`} />
        <Tag label={rule.gas_strategy} />
        <Tag label={`${rule.gas_limit_gwei} gwei`} />
        <Tag label={`${rule.cooldown_sec}s cd`} />
        {rule.max_daily_vol && <Tag label={`${rule.max_daily_vol} max/d`} />}
        {rule.auto_swap && <Tag label="Auto-swap" color={C.amber} />}
        {rule.notify_enabled && <Tag label={rule.notify_channel} color={C.blue} />}
      </div>

      {/* Stats + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>
            {rule.sweep_count ?? 0} sweeps
          </span>
          <span style={{ fontFamily: C.M, fontSize: 9, color: C.dim }}>
            Last: {ago(rule.last_sweep ?? null)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {rule.is_active && (
            <ActionBtn
              label={isPaused ? 'Resume' : 'Pause'}
              color={isPaused ? C.green : C.amber}
              onClick={() => isPaused ? onResume(rule.id) : onPause(rule.id)}
            />
          )}
          {confirmDelete ? (
            <>
              <ActionBtn label="Confirm" color={C.red} onClick={() => { onDelete(rule.id); setConfirmDelete(false) }} />
              <ActionBtn label="Cancel" color={C.dim} onClick={() => setConfirmDelete(false)} />
            </>
          ) : (
            <ActionBtn label="Delete" color={C.red} onClick={() => setConfirmDelete(true)} />
          )}
        </div>
      </div>
    </motion.div>
  )
}

function Tag({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 9, color: color ?? '#8A8FA8',
      background: `${color ?? '#8A8FA8'}10`, padding: '2px 7px',
      borderRadius: 6, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', borderRadius: 6, border: `1px solid ${color}25`,
        background: `${color}08`, color, cursor: 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}
