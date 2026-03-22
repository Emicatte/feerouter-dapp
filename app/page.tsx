'use client'

/**
 * page.tsx — RPagos Gateway Main Page
 *
 * Features:
 *   - AccountHeader (wallet identity + activity) fisso in alto a destra
 *   - GPU-Accelerated Background con orbs animati
 *   - Staggered fade-in su tutti i componenti
 *   - TransferForm con NetworkSelector, Oracle EIP-712, Swap V3
 *   - Footer badges compliance (MiCA/DAC8, VASP, AML)
 */

import dynamic from 'next/dynamic'

// TransferForm importato dinamico — no SSR (wagmi richiede browser)
const TransferForm = dynamic(() => import('./TransferForm'), { ssr: false })
const AccountHeader = dynamic(() => import('./AccountHeader'), { ssr: false })

export default function Home() {
  return (
    <>
      {/* ── Background GPU layer ────────────────────────────────────── */}
      <div className="rp-bg" aria-hidden="true">
        <div className="rp-bg__base" />
        <div className="rp-orb rp-orb--1" />
        <div className="rp-orb rp-orb--2" />
        <div className="rp-orb rp-orb--3" />
        <div className="rp-orb rp-orb--4" />
        <div className="rp-orb rp-orb--5" />
        <div className="rp-bg__noise" />
      </div>

      {/* ── Account Header — fisso in alto a destra ────────────────── */}
      <div style={{ position: 'fixed', top: 16, right: 20, zIndex: 1000 }}>
        <AccountHeader />
      </div>

      {/* ── Contenuto ─────────────────────────────────────────────────── */}
      <main className="rp-content" style={{
        minHeight:      '100vh',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        padding:        '24px 16px',
        gap:            '32px',
      }}>

        {/* Hero text — stagger 0 */}
        <div className="rp-anim-0" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #ff007a, #00ffa3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>⚡</div>
            <span style={{
              fontFamily:    'var(--font-display)',
              fontSize:      '1.5rem',
              fontWeight:    800,
              color:         '#e2e2f0',
              letterSpacing: '-0.03em',
            }}>
              FeeRouter
            </span>
            <span style={{
              fontFamily:   'var(--font-mono)',
              fontSize:     11,
              fontWeight:   600,
              color:        '#00ffa3',
              background:   'rgba(0,255,163,0.1)',
              border:       '1px solid rgba(0,255,163,0.25)',
              borderRadius: 6,
              padding:      '2px 8px',
              letterSpacing: '0.05em',
            }}>Base</span>
            <span style={{
              fontFamily:   'var(--font-mono)',
              fontSize:     9,
              fontWeight:   500,
              color:        '#4a4a6a',
              background:   'rgba(255,255,255,0.04)',
              border:       '1px solid rgba(255,255,255,0.06)',
              borderRadius: 5,
              padding:      '2px 6px',
              letterSpacing: '0.04em',
            }}>v4</span>
          </div>

          <h1 style={{
            fontFamily:    'var(--font-display)',
            fontSize:      'clamp(2.2rem, 6vw, 4rem)',
            fontWeight:    700,
            lineHeight:    1.1,
            letterSpacing: '-0.04em',
            color:         '#e2e2f0',
            marginBottom:  12,
          }}>
            Send{' '}
            <span style={{
              background:          'linear-gradient(135deg, #ff007a 0%, #ff6b9d 40%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip:      'text',
            }}>anytime</span>
            ,{' '}<br />
            anywhere.
          </h1>

          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize:   13,
            color:      '#4a4a6a',
            letterSpacing: '0.02em',
          }}>
            Invia crypto con{' '}
            <span style={{ color: '#00ffa3' }}>fee splitting automatico</span>
            {' '}su Base Network.
          </p>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, marginTop: 10,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#00ffa3',
              boxShadow: '0 0 8px rgba(0,255,163,0.5)',
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: '#4a4a6a',
              letterSpacing: '0.04em',
            }}>
              Operativo · Multi-Chain · Compliance DAC8
            </span>
          </div>
        </div>

        {/* TransferForm — stagger 1 */}
        <div className="rp-anim-1" style={{ width: '100%', maxWidth: 480 }}>
          <TransferForm />
        </div>

        {/* Footer badges — stagger 2 */}
        <div className="rp-anim-2" style={{
          display:        'flex',
          alignItems:     'center',
          gap:            16,
          flexWrap:       'wrap',
          justifyContent: 'center',
        }}>
          {[
            { icon: '⚡', label: 'Base L2',        accent: false },
            { icon: '🔒', label: 'Non-Custodial',  accent: false },
            { icon: '📋', label: 'MiCA/DAC8',      accent: false },
            { icon: '🛡', label: 'AML Oracle',     accent: false },
            { icon: '🦄', label: 'Uniswap V3',     accent: false },
            { icon: '✓',  label: 'VASP Compliant', accent: true  },
          ].map(b => (
            <div key={b.label} style={{
              display:      'flex',
              alignItems:   'center',
              gap:          5,
              fontFamily:   'var(--font-mono)',
              fontSize:     10,
              color:        b.accent ? '#00ffa3' : '#4a4a6a',
              background:   b.accent ? 'rgba(0,255,163,0.06)' : 'rgba(255,255,255,0.03)',
              border:       `1px solid ${b.accent ? 'rgba(0,255,163,0.15)' : 'rgba(255,255,255,0.05)'}`,
              borderRadius: 8,
              padding:      '4px 10px',
            }}>
              <span>{b.icon}</span>
              <span>{b.label}</span>
            </div>
          ))}
        </div>

        {/* Powered by — stagger 3 */}
        <div className="rp-anim-3" style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: '#2a2a3a',
          letterSpacing: '0.06em',
          textAlign: 'center' as const,
          paddingBottom: 8,
        }}>
          RPagos Gateway · FeeRouterV4 · Built on Base
        </div>

      </main>
    </>
  )
}