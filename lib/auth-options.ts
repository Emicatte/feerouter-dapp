import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

/**
 * NextAuth v4 options shared between the route handler and any
 * server-side caller that needs `getServerSession(authOptions)`.
 *
 * Scope: Google OAuth handshake only. The Google `id_token` is stashed in
 * the JWT once; the actual backend session (httpOnly refresh + sid cookies
 * + bearer access_token) is established by a client-side bootstrap effect
 * that POSTs the id_token to /api/rp-auth/api/v1/auth/google so the
 * Set-Cookie headers land in the browser.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope: 'openid email profile',
          prompt: 'select_account',
        },
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 30 * 60 },
  callbacks: {
    async jwt({ token, account, trigger, session }) {
      if (account?.id_token) {
        ;(token as Record<string, unknown>).id_token = account.id_token
      }
      if (trigger === 'update' && session && (session as Record<string, unknown>).access_token) {
        ;(token as Record<string, unknown>).access_token = (session as Record<string, unknown>).access_token
        ;(token as Record<string, unknown>).id_token = undefined
      }
      return token
    },
    async session({ session, token }) {
      ;(session as unknown as Record<string, unknown>).id_token = (token as Record<string, unknown>).id_token
      ;(session as unknown as Record<string, unknown>).access_token = (token as Record<string, unknown>).access_token
      return session
    },
  },
}
