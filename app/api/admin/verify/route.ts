import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'admin_session'

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value

  // Cookie-based auth (new flow)
  if (token) {
    const { validateToken } = await import('@/lib/auth/adminTokens')
    if (validateToken(token)) {
      return NextResponse.json({ status: 'ok', auth: 'cookie' })
    }
    // Token expired — clear cookie
    const res = NextResponse.json(
      { error: 'SESSION_EXPIRED', message: 'Session expired. Please log in again.' },
      { status: 401 },
    )
    res.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  }

  // Fallback: Authorization header (backward compatibility)
  const auth = req.headers.get('Authorization') ?? ''
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const secret = process.env.ADMIN_SECRET || ''

  if (secret && bearerToken && bearerToken === secret) {
    return NextResponse.json({ status: 'ok', auth: 'bearer' })
  }

  return NextResponse.json(
    { error: 'UNAUTHORIZED', message: 'Not authenticated.' },
    { status: 401 },
  )
}
