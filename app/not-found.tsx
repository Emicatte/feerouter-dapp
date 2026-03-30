export default function NotFound() {
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
      <h1 style={{ fontSize: 72, fontWeight: 800, margin: 0, lineHeight: 1 }}>404</h1>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 14,
        color: '#8A8FA8',
        marginTop: 12,
      }}>
        Page not found
      </p>
      <a
        href="/"
        style={{
          marginTop: 28,
          padding: '10px 24px',
          borderRadius: 10,
          background: 'rgba(59,130,246,0.12)',
          border: '1px solid rgba(59,130,246,0.25)',
          color: '#3B82F6',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          textDecoration: 'none',
        }}
      >
        Back to home
      </a>
    </div>
  )
}
