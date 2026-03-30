'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0f',
      color: '#E2E2F0',
      fontFamily: 'var(--font-display)',
    }}>
      <h1 style={{ fontSize: 48, fontWeight: 800, margin: 0 }}>Something went wrong</h1>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: '#8A8FA8',
        marginTop: 12,
        maxWidth: 400,
        textAlign: 'center',
      }}>
        {error.message || 'An unexpected error occurred'}
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
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  )
}
