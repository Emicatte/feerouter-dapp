'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="it">
      <body style={{ background: '#0a0a0f', margin: 0 }}>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#E2E2F0',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <h1 style={{ fontSize: 48, fontWeight: 800, margin: 0 }}>Something went wrong</h1>
          <p style={{
            fontSize: 13,
            color: '#8A8FA8',
            marginTop: 12,
          }}>
            {error.message || 'A critical error occurred'}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 28,
              padding: '10px 24px',
              borderRadius: 10,
              background: 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.25)',
              color: '#3B82F6',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
