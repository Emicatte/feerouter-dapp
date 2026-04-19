/**
 * components/shared/ChainFamilySwitch.tsx — Segmented pill per switchare
 * tra EVM / Solana / Tron. Mostra dot verde se il wallet è connesso.
 */
'use client'

import type { ChainFamily } from '../../lib/chain-adapters/types'

const FAMILIES: { key: ChainFamily; label: string; icon: string; color: string }[] = [
  { key: 'evm',    label: 'EVM',    icon: '\u27E0',  color: '#627EEA' },  // Ethereum diamond ⟠
  { key: 'solana', label: 'Solana', icon: '\u25CE',  color: '#9945FF' },  // ◎
  { key: 'tron',   label: 'Tron',   icon: '\u25C6',  color: '#FF0013' },  // ◆
]

export function ChainFamilySwitch({
  active,
  onSelect,
  connections,
}: {
  active: ChainFamily
  onSelect: (f: ChainFamily) => void
  connections: Record<ChainFamily, { isConnected: boolean }>
}) {
  return (
    <div style={{
      display: 'flex', gap: 2, padding: 2,
      background: 'rgba(10,10,10,0.04)', borderRadius: 10,
      border: '1px solid rgba(10,10,10,0.08)',
    }}>
      {FAMILIES.map(f => {
        const isActive = active === f.key
        const isConn = connections[f.key]?.isConnected
        return (
          <button
            key={f.key}
            onClick={() => onSelect(f.key)}
            style={{
              padding: '5px 10px', borderRadius: 8, border: 'none',
              background: isActive ? `${f.color}15` : 'transparent',
              color: isActive ? f.color : isConn ? 'rgba(10,10,10,0.55)' : 'rgba(10,10,10,0.4)',
              fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 4,
              opacity: isConn || isActive ? 1 : 0.5,
            }}
          >
            <span style={{ fontSize: 12 }}>{f.icon}</span>
            {f.label}
            {isConn && (
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: '#00D68F', boxShadow: '0 0 4px #00D68F50',
                display: 'inline-block',
              }} />
            )}
          </button>
        )
      })}
    </div>
  )
}
