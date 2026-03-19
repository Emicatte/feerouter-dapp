'use client'

/**
 * TokenSelector.tsx — Professional Token Selector
 * Loghi ufficiali da TrustWallet Assets CDN
 * Dropdown custom (no <select> nativo — risolve il bug "scompare subito")
 */

import { useState, useEffect, useRef } from 'react'
import { formatUnits } from 'viem'

const T = {
  card:    '#111120',
  surface: '#0d0d1a',
  border:  'rgba(255,255,255,0.06)',
  emerald: '#00ffa3',
  muted:   '#4a4a6a',
  text:    '#e2e2f0',
  mono:    'var(--font-mono)',
}

// ── Token config con loghi ufficiali ───────────────────────────────────────
export const TOKENS_CONFIG = [
  {
    symbol:   'ETH',
    name:     'Ethereum',
    address:  undefined as `0x${string}` | undefined,
    decimals: 18,
    color:    '#627EEA',
    gasless:  false,
    isNative: true,
    logoURI:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  },
  {
    symbol:   'USDC',
    name:     'USD Coin',
    address:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
    decimals: 6,
    color:    '#2775CA',
    gasless:  true,
    isNative: false,
    logoURI:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  },
  {
    symbol:   'USDT',
    name:     'Tether USD',
    address:  '0xfde4C96256153236af98292015BA958c14714C22' as `0x${string}`,
    decimals: 6,
    color:    '#26A17B',
    gasless:  true,
    isNative: false,
    logoURI:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  },
  {
    symbol:   'cbBTC',
    name:     'Coinbase Wrapped BTC',
    address:  '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as `0x${string}`,
    decimals: 8,
    color:    '#F7931A',
    gasless:  false,
    isNative: false,
    logoURI:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png',
  },
  {
    symbol:   'DEGEN',
    name:     'Degen',
    address:  '0x4eDBc9320305298056041910220E3663A92540B6' as `0x${string}`,
    decimals: 18,
    color:    '#845ef7',
    gasless:  false,
    isNative: false,
    logoURI:  'https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png',
  },
] as const

export type TokenSymbol = typeof TOKENS_CONFIG[number]['symbol']
export type TokenConfig = typeof TOKENS_CONFIG[number]

export interface TokenOption extends TokenConfig {
  balance: bigint
}

// ── Token Logo con fallback colorato ──────────────────────────────────────
export function TokenLogo({
  token, size = 28,
}: {
  token: Pick<TokenConfig, 'symbol' | 'logoURI' | 'color'>
  size?: number
}) {
  const [imgError, setImgError] = useState(false)

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      overflow: 'hidden', flexShrink: 0,
      background: imgError ? token.color : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid rgba(255,255,255,0.08)`,
    }}>
      {!imgError ? (
        <img
          src={token.logoURI}
          alt={token.symbol}
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgError(true)}
        />
      ) : (
        <span style={{ fontSize: size * 0.4, fontWeight: 800, color: '#fff', letterSpacing: '-0.05em' }}>
          {token.symbol.slice(0, 2)}
        </span>
      )}
    </div>
  )
}

// ── Token Pill (inline nel form) ──────────────────────────────────────────
export function TokenPill({
  token, pink = false, onClick,
}: {
  token: TokenOption | null
  pink?: boolean
  onClick?: () => void
}) {
  if (!token) return null
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px 8px 8px', borderRadius: 18,
        background: pink ? T.emerald + '15' : '#1a1a2e',
        border: pink ? `1px solid ${T.emerald}30` : `1px solid ${T.border}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
      }}
    >
      <TokenLogo token={token} size={24} />
      <span style={{ fontSize: 14, fontWeight: 700, color: pink ? T.emerald : T.text }}>
        {token.symbol}
      </span>
      {!pink && onClick && (
        <span style={{ color: T.muted, fontSize: 11 }}>▾</span>
      )}
    </button>
  )
}

// ── Token Selector Dropdown ────────────────────────────────────────────────
export function TokenSelector({
  tokens,
  selected,
  onSelect,
}: {
  tokens: TokenOption[]
  selected: TokenOption | null
  onSelect: (t: TokenOption) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Chiudi cliccando fuori
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fmtBal = (t: TokenOption) => {
    const val = parseFloat(formatUnits(t.balance, t.decimals))
    return t.symbol === 'USDC' || t.symbol === 'USDT' ? val.toFixed(2)
      : t.symbol === 'cbBTC' ? val.toFixed(6)
      : val.toFixed(4)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <TokenPill token={selected} onClick={() => setOpen(o => !o)} />

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 260, zIndex: 1000,
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
          overflow: 'hidden',
          animation: 'fadeSlideIn 0.15s ease',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 14px 8px',
            fontFamily: T.mono, fontSize: 10,
            color: T.muted, fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.1em',
            borderBottom: `1px solid ${T.border}`,
          }}>
            Seleziona token
          </div>

          {/* Lista token */}
          {tokens.map(t => {
            const isSelected = t.symbol === selected?.symbol
            return (
              <button
                key={t.symbol}
                type="button"
                onClick={() => { onSelect(t); setOpen(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  gap: 12, padding: '11px 14px',
                  background: isSelected ? T.emerald + '0d' : 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${T.border}`,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent'
                }}
              >
                <TokenLogo token={t} size={32} />
                <div style={{ flex: 1, textAlign: 'left' as const }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: isSelected ? T.emerald : T.text }}>
                      {t.symbol}
                    </span>
                    {t.gasless && (
                      <span style={{ fontFamily: T.mono, fontSize: 9, color: T.emerald, background: T.emerald + '15', padding: '1px 5px', borderRadius: 4 }}>
                        ⛽ Gasless
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, marginTop: 1 }}>
                    {t.name}
                  </div>
                </div>
                <div style={{ textAlign: 'right' as const }}>
                  <div style={{ fontFamily: T.mono, fontSize: 12, color: T.text, fontWeight: 600 }}>
                    {fmtBal(t)}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>
                    {t.symbol}
                  </div>
                </div>
                {isSelected && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.emerald, flexShrink: 0 }} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
