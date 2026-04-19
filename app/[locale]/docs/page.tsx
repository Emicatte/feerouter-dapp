import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'

export const metadata: Metadata = {
  title: 'API Documentation — RSends',
  description: 'REST API reference, SDKs, and integration guides for RSends. Coming soon.',
}

export default function DocsPage() {
  return (
    <main style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-display)',
      color: '#0A0A0A',
      background: '#FAFAFA',
      padding: '24px',
    }}>
      <div style={{ maxWidth: 560, width: '100%' }}>

        <nav style={{ marginBottom: 40, fontSize: 13 }} aria-label="Breadcrumb">
          <ol style={{ display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', padding: 0, margin: 0, color: 'rgba(10,10,10,0.55)' }}>
            <li>
              <Link href="/" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.15s' }}>
                Home
              </Link>
            </li>
            <li style={{ color: 'rgba(10,10,10,0.25)' }}>/</li>
            <li style={{ color: '#0A0A0A', fontWeight: 500 }}>Docs</li>
          </ol>
        </nav>

        <p style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          color: '#C8512C',
          fontWeight: 500,
          marginBottom: 16,
          textTransform: 'uppercase',
        }}>
          API Documentation
        </p>

        <h1 style={{
          fontSize: 'clamp(36px, 6vw, 56px)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          margin: '0 0 16px',
        }}>
          Docs
        </h1>

        <p style={{
          fontSize: 16,
          color: 'rgba(10,10,10,0.6)',
          lineHeight: 1.6,
          margin: '0 0 40px',
        }}>
          REST endpoints, SDKs, webhooks reference, and integration guides for RSends.
          Full documentation coming soon.
        </p>

        <div style={{
          background: '#FFFFFF',
          border: '1px solid rgba(10,10,10,0.08)',
          borderRadius: 16,
          padding: '32px',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>
            In the meantime
          </h2>
          <p style={{
            fontSize: 14,
            color: 'rgba(10,10,10,0.6)',
            lineHeight: 1.6,
            margin: '0 0 24px',
          }}>
            If you want early access to the API or have integration questions, reach out directly.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a
              href="mailto:emiliocatteddu@gmail.com"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#0A0A0A',
                color: '#fff',
                padding: '10px 20px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'opacity 0.15s',
              }}
            >
              Email us →
            </a>
            <Link
              href="/app"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid rgba(10,10,10,0.15)',
                color: '#0A0A0A',
                padding: '10px 20px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'border-color 0.15s',
              }}
            >
              Try the dashboard
            </Link>
          </div>
        </div>

      </div>
    </main>
  )
}
