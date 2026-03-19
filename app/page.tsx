'use client'

/**
 * page.tsx — GPU-Accelerated Background + Staggered Fade-In
 *
 * Background: 5 orbs GPU-only (transform: translate3d + scale3d)
 *   - Zero top/left animati → zero layout thrashing
 *   - will-change pre-alloca layer GPU separati
 *   - contain: strict isola il repaint
 *   - Nessun resize listener React
 *
 * Staggered: rp-anim-0..5 → fadeUp cascata 0→80→160→240ms
 */

import dynamic from 'next/dynamic'

// TransferForm importato dinamico — no SSR (wagmi richiede browser)
const TransferForm = dynamic(() => import('./TransferForm'), { ssr: false })

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
            { icon: '⚡', label: 'Base L2' },
            { icon: '🔒', label: 'Non-Custodial' },
            { icon: '📋', label: 'MiCA/DAC8' },
            { icon: '🛡', label: 'AML Oracle' },
          ].map(b => (
            <div key={b.label} style={{
              display:      'flex',
              alignItems:   'center',
              gap:          5,
              fontFamily:   'var(--font-mono)',
              fontSize:     10,
              color:        '#4a4a6a',
              background:   'rgba(255,255,255,0.03)',
              border:       '1px solid rgba(255,255,255,0.05)',
              borderRadius: 8,
              padding:      '4px 10px',
            }}>
              <span>{b.icon}</span>
              <span>{b.label}</span>
            </div>
          ))}
        </div>

      </main>
    </>
  )
}