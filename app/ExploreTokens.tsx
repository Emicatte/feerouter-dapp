'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TOKEN_LIST, SUPPORTED_CHAINS } from './tokens/tokenRegistry'
import TokenDetailView from './TokenDetailView'
import type { TokenMarket } from '@/lib/types/tokenMarket'

const C = {
  bg: '#0a0a0f',
  surface: '#111118',
  card: '#16161f',
  border: 'rgba(255,255,255,0.06)',
  text: '#E2E2F0',
  sub: '#8A8FA8',
  dim: '#4A4E64',
  green: '#00D68F',
  red: '#FF4C6A',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  D: 'var(--font-display)',
  M: 'var(--font-mono)',
}

const RANK_ORDER = [
  'bitcoin', 'ethereum', 'tron', 'binancecoin', 'avalanche-2',
  'polygon-ecosystem-token', 'optimism', 'arbitrum', 'celo',
  'usd-coin', 'tether', 'dai', 'celo-dollar', 'usdb', 'usdd', 'weth',
]

const PREVIEW_COUNT = 5
const INITIAL_FULL_ROWS = 12
const MARKET_REFRESH_MS = 5 * 60 * 1000

// Deterministic colored bubbles — fallback when CHAIN_ICONS below 404 or undefined.
const CHAIN_COLORS = [
  '#627EEA', '#F3BA2F', '#8247E5', '#E84142',
  '#28A0F0', '#FCFF52', '#FF0420', '#FF3B30', '#25292E',
]

// CoinGecko-hosted chain icons (real images). onError falls back to letter bubble.
const CHAIN_ICONS: Record<number, string> = {
  1:     'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  10:    'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  56:    'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  137:   'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  324:   'https://assets.coingecko.com/asset_platforms/images/121/small/zksync.jpeg',
  8453:  'https://assets.coingecko.com/asset_platforms/images/131/small/base.jpeg',
  42161: 'https://assets.coingecko.com/coins/images/16547/small/arb.jpg',
  42220: 'https://assets.coingecko.com/coins/images/11090/small/InjXBNx9_400x400.jpg',
  43114: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  81457: 'https://assets.coingecko.com/asset_platforms/images/177/small/blast.jpeg',
  84532: 'https://assets.coingecko.com/asset_platforms/images/131/small/base.jpeg',
  728126428: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
}

type TokenRow = {
  coingeckoId: string
  symbol: string
  name: string
  logoUrl: string
  chainIds: number[]
}

// ── Formatting ────────────────────────────────────────────────────────────

function formatUsd(v: number | undefined): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—'
  let maxFrac: number
  if (v >= 100) maxFrac = 2
  else if (v >= 1) maxFrac = 4
  else if (v >= 0.01) maxFrac = 4
  else maxFrac = 6
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFrac,
  })
}

// ── Sparkline ─────────────────────────────────────────────────────────────

let _sparkIdCounter = 0
function nextSparkId() {
  _sparkIdCounter += 1
  return `spark-${_sparkIdCounter}`
}

function Sparkline({
  data,
  width = 100,
  height = 32,
  loading,
}: {
  data: number[] | undefined
  width?: number
  height?: number
  loading?: boolean
}) {
  const gradientIdRef = useRef<string>('')
  if (!gradientIdRef.current) gradientIdRef.current = nextSparkId()

  if (!data || data.length < 2) {
    return (
      <div
        style={{
          width,
          height,
          borderRadius: 4,
          background: loading
            ? 'linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
            : 'rgba(255,255,255,0.03)',
          backgroundSize: loading ? '200% 100%' : undefined,
          animation: loading ? 'rsShimmer 1.4s ease-in-out infinite' : undefined,
        }}
      />
    )
  }

  // Downsample for smoothness/perf when we have many hourly points.
  const sampled =
    data.length > 60
      ? data.filter((_, i) => i % Math.ceil(data.length / 50) === 0)
      : data

  const min = Math.min(...sampled)
  const max = Math.max(...sampled)
  const range = max - min || 1
  const PAD_Y = 2

  const pts = sampled.map((v, i) => ({
    x: (i / (sampled.length - 1)) * width,
    y: PAD_Y + (1 - (v - min) / range) * (height - PAD_Y * 2),
  }))

  // Catmull-Rom → cubic bezier for smooth curves.
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]

    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }

  const isUp = sampled[sampled.length - 1] >= sampled[0]
  const color = isUp ? C.green : C.red
  const gid = gradientIdRef.current
  const fillPath = `${d} L ${width.toFixed(2)},${height.toFixed(2)} L 0,${height.toFixed(2)} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gid})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Bulk market data hook ─────────────────────────────────────────────────

function useMarketData() {
  const [data, setData] = useState<Record<string, TokenMarket>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const res = await fetch('/api/tokens-market')
        if (!res.ok) return
        const json = await res.json()
        if (mounted && json && typeof json === 'object') {
          setData(json as Record<string, TokenMarket>)
        }
      } catch {
        /* swallow — stale data stays on screen */
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, MARKET_REFRESH_MS)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return { data, loading }
}

// ── Logo components ───────────────────────────────────────────────────────

function TokenLogo({
  symbol,
  src,
  size = 28,
}: {
  symbol: string
  src: string | null | undefined
  size?: number
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: C.D,
          fontSize: Math.round(size * 0.42),
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {symbol.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={symbol}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'block',
        objectFit: 'cover',
        background: 'rgba(255,255,255,0.04)',
      }}
    />
  )
}

function ChainIcon({ chainId, size = 16 }: { chainId: number; size?: number }) {
  const [failed, setFailed] = useState(false)
  const info = (SUPPORTED_CHAINS as Record<number, { name: string }>)[chainId]
  if (!info) return null
  const src = CHAIN_ICONS[chainId]

  if (!src || failed) {
    const letter = info.name.slice(0, 1).toUpperCase()
    const bg = CHAIN_COLORS[chainId % CHAIN_COLORS.length]
    return (
      <div
        title={info.name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: bg,
          border: '1px solid rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: C.D,
          fontSize: Math.round(size * 0.55),
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {letter}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={info.name}
      title={info.name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid rgba(0,0,0,0.2)',
        flexShrink: 0,
        display: 'block',
        objectFit: 'cover',
        background: 'rgba(255,255,255,0.04)',
      }}
    />
  )
}

function ChainStack({ chainIds }: { chainIds: number[] }) {
  const MAX = 4
  const visible = chainIds.slice(0, MAX)
  const extra = chainIds.length - visible.length
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {visible.map((id, i) => (
        <div key={id} style={{ marginLeft: i === 0 ? 0 : -4 }}>
          <ChainIcon chainId={id} />
        </div>
      ))}
      {extra > 0 && (
        <span
          style={{
            marginLeft: 6,
            fontFamily: C.M,
            fontSize: 11,
            color: C.sub,
          }}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}

// ── Skeleton cell (shimmer) ──────────────────────────────────────────────

function ShimmerBar({ width, height = 12 }: { width: number | string; height?: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: 4,
        background:
          'linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
        backgroundSize: '200% 100%',
        animation: 'rsShimmer 1.4s ease-in-out infinite',
        verticalAlign: 'middle',
      }}
    />
  )
}

// ── Filter pill ───────────────────────────────────────────────────────────

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={e => {
        if (active) return
        e.currentTarget.style.color = C.text
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={e => {
        if (active) return
        e.currentTarget.style.color = C.sub
        e.currentTarget.style.borderColor = C.border
        e.currentTarget.style.background = 'transparent'
      }}
      style={{
        padding: '6px 12px',
        background: active ? C.purple : 'transparent',
        border: `1px solid ${active ? C.purple : C.border}`,
        borderRadius: 999,
        color: active ? '#fff' : C.sub,
        cursor: 'pointer',
        fontFamily: C.D,
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        letterSpacing: '0.02em',
        transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function ExploreTokens() {
  const { data: market, loading: marketLoading } = useMarketData()
  const [expanded, setExpanded] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState<number | 'all'>('all')
  const [showAllFull, setShowAllFull] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [selectedCoingeckoId, setSelectedCoingeckoId] = useState<string | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const allRows = useMemo<TokenRow[]>(() => {
    const rowsMap = new Map<string, TokenRow>()
    for (const t of TOKEN_LIST) {
      const existing = rowsMap.get(t.coingeckoId)
      if (existing) {
        if (!existing.chainIds.includes(t.chainId)) existing.chainIds.push(t.chainId)
      } else {
        rowsMap.set(t.coingeckoId, {
          coingeckoId: t.coingeckoId,
          symbol: t.symbol,
          name: t.name,
          logoUrl: t.logoUrl,
          chainIds: [t.chainId],
        })
      }
    }
    return Array.from(rowsMap.values()).sort((a, b) => {
      const ra = RANK_ORDER.indexOf(a.coingeckoId)
      const rb = RANK_ORDER.indexOf(b.coingeckoId)
      if (ra !== -1 && rb !== -1) return ra - rb
      if (ra !== -1) return -1
      if (rb !== -1) return 1
      return a.name.localeCompare(b.name)
    })
  }, [])

  const previewRows = useMemo(() => allRows.slice(0, PREVIEW_COUNT), [allRows])

  const filteredRows = useMemo(() => {
    if (selectedChainId === 'all') return allRows
    return allRows.filter(r => r.chainIds.includes(selectedChainId))
  }, [allRows, selectedChainId])

  const visibleFullRows = showAllFull ? filteredRows : filteredRows.slice(0, INITIAL_FULL_ROWS)

  const chainEntries = Object.entries(SUPPORTED_CHAINS) as [
    string,
    { name: string; nativeCurrency: string; explorerUrl: string; iconUrl: string },
  ][]

  // Grid — preview uses 5 cols (no Chains), full desktop uses 6.
  // minmax(0,1fr) prevents the token cell from pushing right-aligned cells when names are long.
  const previewGrid = isMobile
    ? '32px minmax(0,1fr) 90px 72px 70px'
    : '40px minmax(0,1fr) 130px 100px 120px'
  const fullGrid = isMobile
    ? '32px minmax(0,1fr) 90px 72px 70px'
    : '40px minmax(0,1fr) 130px 100px 120px 100px'

  return (
    <section
      style={{
        position: 'relative',
        background: 'transparent',
        padding: '80px 16px 80px',
        width: '100%',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative' }}>
        {/* Header — hidden when viewing a token's detail */}
        {!selectedCoingeckoId && (
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile || !expanded ? 'column' : 'row',
            alignItems: isMobile || !expanded ? 'flex-start' : 'flex-end',
            justifyContent: 'space-between',
            gap: 20,
            marginBottom: 24,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: C.D,
                fontSize: 11,
                fontWeight: 700,
                color: C.blue,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Explore
            </div>
            <h2
              style={{
                fontFamily: C.D,
                fontSize: 'clamp(32px, 5vw, 48px)',
                fontWeight: 700,
                color: C.text,
                margin: 0,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
              }}
            >
              Tokens
            </h2>
            <p
              style={{
                fontFamily: C.D,
                fontSize: 14,
                color: C.sub,
                margin: '10px 0 0',
                maxWidth: 520,
              }}
            >
              Discover and track all supported tokens across 11+ chains
            </p>
          </div>

          {/* Chain filter pills — only in expanded view */}
          {expanded && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                maxWidth: isMobile ? '100%' : 420,
                justifyContent: isMobile ? 'flex-start' : 'flex-end',
              }}
            >
              <FilterPill
                active={selectedChainId === 'all'}
                onClick={() => setSelectedChainId('all')}
                label="All Chains"
              />
              {chainEntries.map(([id, info]) => (
                <FilterPill
                  key={id}
                  active={selectedChainId === Number(id)}
                  onClick={() => setSelectedChainId(Number(id))}
                  label={info.name}
                />
              ))}
            </div>
          )}
        </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {selectedCoingeckoId ? (
            <motion.div
              key="detail"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <TokenDetailView
                coingeckoId={selectedCoingeckoId}
                market={market[selectedCoingeckoId]}
                marketLoading={marketLoading}
                onBack={() => setSelectedCoingeckoId(null)}
                isMobile={isMobile}
              />
            </motion.div>
          ) : !expanded ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <TableContainer variant="preview">
                <TableHeader grid={previewGrid} showSparkline showChains={false} />
                {previewRows.map((row, idx) => {
                  const m = market[row.coingeckoId]
                  return (
                    <TokenRowUI
                      key={row.coingeckoId}
                      row={row}
                      rank={idx + 1}
                      grid={previewGrid}
                      isLast={idx === previewRows.length - 1}
                      price={m?.price ?? undefined}
                      change={m?.change24h ?? undefined}
                      spark={m?.sparkline}
                      image={m?.image ?? null}
                      sparkLoading={!m || m.sparkline.length < 2}
                      pricesLoading={marketLoading}
                      showChains={false}
                      onOpen={setSelectedCoingeckoId}
                    />
                  )
                })}
              </TableContainer>

              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                <ExploreCTA onClick={() => setExpanded(true)} />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <TableContainer>
                <TableHeader grid={fullGrid} showSparkline showChains={!isMobile} />
                {visibleFullRows.length === 0 ? (
                  <div
                    style={{
                      padding: '40px 18px',
                      textAlign: 'center',
                      fontFamily: C.D,
                      fontSize: 13,
                      color: C.sub,
                    }}
                  >
                    No tokens on this chain.
                  </div>
                ) : (
                  visibleFullRows.map((row, idx) => {
                    const m = market[row.coingeckoId]
                    return (
                      <TokenRowUI
                        key={row.coingeckoId}
                        row={row}
                        rank={idx + 1}
                        grid={fullGrid}
                        isLast={idx === visibleFullRows.length - 1}
                        price={m?.price ?? undefined}
                        change={m?.change24h ?? undefined}
                        spark={m?.sparkline}
                        image={m?.image ?? null}
                        sparkLoading={!m || m.sparkline.length < 2}
                        pricesLoading={marketLoading}
                        showChains={!isMobile}
                        onOpen={setSelectedCoingeckoId}
                      />
                    )
                  })
                )}
              </TableContainer>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 12,
                  marginTop: 20,
                  flexWrap: 'wrap',
                }}
              >
                {!showAllFull && filteredRows.length > INITIAL_FULL_ROWS && (
                  <GhostButton onClick={() => setShowAllFull(true)}>
                    Show all tokens ({filteredRows.length})
                  </GhostButton>
                )}
                <GhostButton
                  onClick={() => {
                    setExpanded(false)
                    setShowAllFull(false)
                    setSelectedChainId('all')
                  }}
                >
                  ← Show less
                </GhostButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style>{`
        @keyframes rsShimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </section>
  )
}

// ── Reusable UI pieces ────────────────────────────────────────────────────

function TableContainer({
  children,
  variant = 'default',
}: {
  children: React.ReactNode
  variant?: 'preview' | 'default'
}) {
  const isPreview = variant === 'preview'
  return (
    <div
      style={{
        background: isPreview
          ? 'linear-gradient(135deg, rgba(59,130,246,0.05), rgba(139,92,246,0.05)), rgba(22,22,31,0.6)'
          : 'rgba(22,22,31,0.6)',
        borderRadius: 16,
        border: `1px solid ${isPreview ? 'rgba(139,92,246,0.12)' : C.border}`,
        overflow: 'hidden',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {children}
    </div>
  )
}

function TableHeader({
  grid,
  showSparkline,
  showChains,
}: {
  grid: string
  showSparkline: boolean
  showChains: boolean
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: grid,
        gap: 12,
        padding: '12px 18px',
        borderBottom: `1px solid ${C.border}`,
        fontFamily: C.D,
        fontSize: 11,
        fontWeight: 600,
        color: C.dim,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      <div>#</div>
      <div>Token</div>
      <div style={{ textAlign: 'right' }}>Price</div>
      <div style={{ textAlign: 'right' }}>24h</div>
      {showSparkline && <div style={{ textAlign: 'right' }}>7d</div>}
      {showChains && <div style={{ textAlign: 'right' }}>Chains</div>}
    </div>
  )
}

function TokenRowUI({
  row,
  rank,
  grid,
  isLast,
  price,
  change,
  spark,
  image,
  sparkLoading,
  pricesLoading,
  showChains,
  onOpen,
}: {
  row: TokenRow
  rank: number
  grid: string
  isLast: boolean
  price: number | undefined
  change: number | undefined
  spark: number[] | undefined
  image: string | null
  sparkLoading: boolean
  pricesLoading: boolean
  showChains: boolean
  onOpen?: (coingeckoId: string) => void
}) {
  const chColor =
    change === undefined || change === null || Number.isNaN(change)
      ? C.dim
      : change >= 0
      ? C.green
      : C.red

  return (
    <div
      onClick={onOpen ? () => onOpen(row.coingeckoId) : undefined}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
        e.currentTarget.style.borderLeftColor = C.purple
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderLeftColor = 'transparent'
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: grid,
        gap: 12,
        padding: '14px 18px',
        alignItems: 'center',
        borderLeft: '2px solid transparent',
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.04)',
        transition: 'background 150ms ease, border-left-color 150ms ease',
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontFamily: C.M, fontSize: 13, color: C.dim }}>{rank}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <TokenLogo symbol={row.symbol} src={image} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: C.D,
              fontSize: 14,
              fontWeight: 500,
              color: C.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.name}
          </div>
          <div
            style={{
              fontFamily: C.D,
              fontSize: 11,
              color: C.sub,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {row.symbol}
          </div>
        </div>
      </div>

      <div
        style={{
          fontFamily: C.M,
          fontSize: 14,
          fontWeight: 600,
          color: price !== undefined ? C.text : C.dim,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {pricesLoading && price === undefined ? <ShimmerBar width={72} /> : formatUsd(price)}
      </div>

      <div
        style={{
          fontFamily: C.M,
          fontSize: 13,
          fontWeight: 600,
          color: chColor,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        {pricesLoading && change === undefined ? (
          <ShimmerBar width={48} />
        ) : change === undefined || change === null || Number.isNaN(change) ? (
          '—'
        ) : (
          <>
            <span style={{ marginRight: 3 }}>{change >= 0 ? '▲' : '▼'}</span>
            {Math.abs(change).toFixed(2)}%
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 6,
            padding: 4,
            display: 'inline-flex',
          }}
        >
          <Sparkline data={spark} loading={sparkLoading} />
        </div>
      </div>

      {showChains && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ChainStack chainIds={row.chainIds} />
        </div>
      )}
    </div>
  )
} 

function ExploreCTA({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(139,92,246,0.6)'
        e.currentTarget.style.boxShadow = '0 0 24px rgba(139,92,246,0.25)'
        const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLSpanElement | null
        if (arrow) arrow.style.transform = 'translateX(4px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(139,92,246,0.3)'
        e.currentTarget.style.boxShadow = 'none'
        const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLSpanElement | null
        if (arrow) arrow.style.transform = 'translateX(0)'
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '13px 26px',
        background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))',
        border: '1px solid rgba(139,92,246,0.3)',
        borderRadius: 12,
        color: C.text,
        cursor: 'pointer',
        fontFamily: C.D,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.02em',
        transition: 'border-color 180ms ease, box-shadow 220ms ease',
      }}
    >
      Explore tokens
      <span
        data-arrow
        style={{
          display: 'inline-block',
          transition: 'transform 180ms ease',
        }}
      >
        →
      </span>
    </button>
  )
}

function GhostButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.color = C.text
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = C.sub
        e.currentTarget.style.borderColor = C.border
        e.currentTarget.style.background = 'transparent'
      }}
      style={{
        padding: '10px 20px',
        background: 'transparent',
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        color: C.sub,
        cursor: 'pointer',
        fontFamily: C.D,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.02em',
        transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
      }}
    >
      {children}
    </button>
  )
}
