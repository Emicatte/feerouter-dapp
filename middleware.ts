import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'admin_session'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Skip API routes — they use their own Authorization header
  if (pathname.startsWith('/api/')) return NextResponse.next()

  // Skip the login page itself to avoid redirect loop
  if (pathname === '/admin/login') return NextResponse.next()

  // Protect all /admin/* routes
  if (pathname.startsWith('/admin')) {
    const session = req.cookies.get(COOKIE_NAME)?.value
    if (!session) {
      const loginUrl = req.nextUrl.clone()
      loginUrl.pathname = '/admin/login'
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
