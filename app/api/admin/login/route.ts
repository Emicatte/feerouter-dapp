import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ── Config ──────────────────────────────────────────────────

const COOKIE_NAME = 'admin_session'
const TOKEN_TTL = 8 * 60 * 60 // 8 hours in seconds

function getAdminSecret(): string {
  return process.env.ADMIN_SECRET || ''
}

// ── In-memory rate limiting ─────────────────────────────────

interface RateEntry {
  timestamps: number[]
  bannedUntil: number
}

const rateLimits = new Map<string, RateEntry>()
const RATE_WINDOW = 60_000       // 1 minute
const RATE_MAX = 5               // 5 attempts per minute
const BAN_WINDOW = 60 * 60_000   // 1 hour
const BAN_THRESHOLD = 10         // 10 failures in 1 hour → ban
const BAN_DURATION = 15 * 60_000 // 15 minutes

// Cleanup stale entries every 10 minutes
let lastCleanup = Date.now()
function cleanupRateLimits() {
  const now = Date.now()
  if (now - lastCleanup < 10 * 60_000) return
  lastCleanup = now
  for (const [ip, entry] of rateLimits.entries()) {
    const recent = entry.timestamps.filter(t => t > now - BAN_WINDOW)
    if (recent.length === 0 && entry.bannedUntil < now) {
      rateLimits.delete(ip)
    }
  }
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  )
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  cleanupRateLimits()
  const now = Date.now()
  let entry = rateLimits.get(ip)
  if (!entry) {
    entry = { timestamps: [], bannedUntil: 0 }
    rateLimits.set(ip, entry)
  }

  // Check ban
  if (entry.bannedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.bannedUntil - now) / 1000) }
  }

  // Check per-minute rate
  const recentMinute = entry.timestamps.filter(t => t > now - RATE_WINDOW)
  if (recentMinute.length >= RATE_MAX) {
    return { allowed: false, retryAfter: 60 }
  }

  return { allowed: true }
}

function recordFailure(ip: string): void {
  const now = Date.now()
  let entry = rateLimits.get(ip)
  if (!entry) {
    entry = { timestamps: [], bannedUntil: 0 }
    rateLimits.set(ip, entry)
  }
  entry.timestamps.push(now)

  // Check if ban threshold exceeded (failures in last hour)
  const recentHour = entry.timestamps.filter(t => t > now - BAN_WINDOW)
  entry.timestamps = recentHour // trim old entries
  if (recentHour.length >= BAN_THRESHOLD) {
    entry.bannedUntil = now + BAN_DURATION
  }
}

// ── Token store (in-memory with TTL) ────────────────────────

// TODO: For multi-instance deployments, move token store to Redis
const tokenStore = new Map<string, { expiresAt: number }>()

function generateToken(): string {
  const token = crypto.randomBytes(32).toString('hex')
  tokenStore.set(token, { expiresAt: Date.now() + TOKEN_TTL * 1000 })
  return token
}

export function validateToken(token: string): boolean {
  const entry = tokenStore.get(token)
  if (!entry) return false
  if (entry.expiresAt < Date.now()) {
    tokenStore.delete(token)
    return false
  }
  return true
}

export function revokeToken(token: string): void {
  tokenStore.delete(token)
}

// ── POST /api/admin/login ───────────────────────────────────

// TODO: Add TOTP-based 2FA here — after password verification,
// require a second factor before issuing the session token.

export async function POST(req: NextRequest) {
  const secret = getAdminSecret()
  if (!secret) {
    return NextResponse.json(
      { error: 'ADMIN_NOT_CONFIGURED', message: 'ADMIN_SECRET is not set.' },
      { status: 503 },
    )
  }

  const ip = getClientIp(req)
  const rateCheck = checkRateLimit(ip)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts. Try again later.', retry_after: rateCheck.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } },
    )
  }

  let body: { password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'BAD_REQUEST', message: 'Invalid JSON body.' },
      { status: 400 },
    )
  }

  const password = body.password?.trim()
  if (!password) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', message: 'Password is required.' },
      { status: 400 },
    )
  }

  // Constant-time comparison to prevent timing attacks
  const passwordBuf = Buffer.from(password)
  const secretBuf = Buffer.from(secret)
  const isValid = passwordBuf.length === secretBuf.length && crypto.timingSafeEqual(passwordBuf, secretBuf)

  if (!isValid) {
    recordFailure(ip)
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Invalid credentials.' },
      { status: 401 },
    )
  }

  // Generate session token and set httpOnly cookie
  const token = generateToken()
  const isSecure = process.env.NODE_ENV === 'production'

  const res = NextResponse.json({ status: 'ok' })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: TOKEN_TTL,
  })

  return res
}
