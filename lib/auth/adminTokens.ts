import crypto from 'crypto'

// ── Token store (in-memory with TTL) ────────────────────────
// TODO: For multi-instance deployments, move token store to Redis

const TOKEN_TTL = 8 * 60 * 60 // 8 hours in seconds

const tokenStore = new Map<string, { expiresAt: number }>()

export function generateToken(): string {
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

export const TOKEN_TTL_SECONDS = TOKEN_TTL
