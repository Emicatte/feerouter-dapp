import { NextRequest, NextResponse } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const COOKIE_NAME = 'admin_session'

const intlMiddleware = createIntlMiddleware(routing)

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Admin auth guard (unchanged) ──────────────────────
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const session = req.cookies.get(COOKIE_NAME)?.value
    if (!session) {
      const loginUrl = req.nextUrl.clone()
      loginUrl.pathname = '/admin/login'
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // ── i18n routing for landing pages ────────────────────
  return intlMiddleware(req)
}

export const config = {
  // Match everything EXCEPT: /app, /api, /admin, /_next, static files
  matcher: [
    '/((?!api|_next|admin|merchant|pay|tokens|_vercel|.*\\..*).*)',
  ],
}
