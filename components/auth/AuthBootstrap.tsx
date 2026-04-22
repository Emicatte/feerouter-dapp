'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useRef } from 'react'

/**
 * After NextAuth completes the Google OAuth redirect, the session carries
 * a one-shot `id_token`. This effect exchanges it with the RPagos backend
 * via the same-origin cookie-aware proxy so the httpOnly refresh + sid
 * cookies land in the browser. The resulting `access_token` is pushed
 * back into the NextAuth JWT via `useSession().update()`.
 */
export function AuthBootstrap() {
  const { data: session, update } = useSession()
  const exchanging = useRef(false)

  useEffect(() => {
    const s = session as { id_token?: string; access_token?: string } | null
    const idToken = s?.id_token
    const accessToken = s?.access_token
    if (!idToken || accessToken || exchanging.current) return

    exchanging.current = true
    void (async () => {
      try {
        const res = await fetch('/api/rp-auth/api/v1/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_token: idToken }),
          credentials: 'include',
        })
        if (!res.ok) return
        const data = (await res.json()) as { access_token?: string }
        if (!data.access_token) return
        await update({ access_token: data.access_token })
      } catch {
        /* swallow: the next sign-in attempt will retry */
      } finally {
        exchanging.current = false
      }
    })()
  }, [session, update])

  return null
}
