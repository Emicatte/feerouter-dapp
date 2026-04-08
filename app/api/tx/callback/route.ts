import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

/**
 * POST /api/tx/callback — Server-side HMAC proxy.
 *
 * The frontend sends the callback payload HERE (no secret needed client-side).
 * This route:
 *  1. Reads HMAC_SECRET from server-only env var
 *  2. Computes HMAC-SHA256 over the canonical message
 *  3. Forwards the signed payload to the Python backend
 *
 * The HMAC secret NEVER leaves the server.
 */

const BACKEND_URL = process.env.RPAGOS_BACKEND_URL || process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'
const HMAC_SECRET = process.env.HMAC_SECRET || ''

function computeHmac(message: string): string {
  return createHmac('sha256', HMAC_SECRET).update(message).digest('hex')
}

export async function POST(req: NextRequest) {
  if (!HMAC_SECRET) {
    return NextResponse.json(
      { error: 'HMAC_NOT_CONFIGURED', message: 'Server HMAC_SECRET is not set.' },
      { status: 503 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
      { status: 400 },
    )
  }

  const {
    fiscal_ref, tx_hash, gross_amount, currency, timestamp,
  } = body as Record<string, string | number>

  if (!fiscal_ref || !tx_hash || gross_amount == null || !currency || !timestamp) {
    return NextResponse.json(
      { error: 'MISSING_FIELDS', message: 'fiscal_ref, tx_hash, gross_amount, currency, timestamp are required.' },
      { status: 400 },
    )
  }

  // Canonical message — must match backend's compute_signature format
  const message = `${fiscal_ref}|${tx_hash}|${gross_amount}|${currency}|${timestamp}`
  const signature = computeHmac(message)

  // Attach HMAC and forward to backend
  const payload = { ...body, x_signature: signature }

  // Forward idempotency key from client if present
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const idempKey = req.headers.get('X-Idempotency-Key')
  if (idempKey) headers['X-Idempotency-Key'] = idempKey

  try {
    const backendRes = await fetch(`${BACKEND_URL}/api/v1/tx/callback`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })

    const data = await backendRes.json().catch(() => ({}))
    return NextResponse.json(data, { status: backendRes.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'BACKEND_UNREACHABLE', message: `Failed to reach backend: ${msg}` },
      { status: 502 },
    )
  }
}
