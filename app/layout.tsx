import type { Metadata } from 'next'
import { Syne, DM_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

// ── Font con display swap — nessun FOUT ───────────────────────────────────
const syne = Syne({
  subsets:  ['latin'],
  variable: '--font-display',
  display:  'swap',
  weight:   ['400', '600', '700', '800'],
})

const dmMono = DM_Mono({
  subsets:  ['latin'],
  variable: '--font-mono',
  display:  'swap',
  weight:   ['400', '500'],
})

export const metadata: Metadata = {
  title:       'RPagos — Gateway B2B su Base',
  description: 'Gateway di pagamento Web3-native non-custodial su Base L2 con compliance MiCA/DAC8.',
  keywords:    ['Web3', 'Base', 'USDC', 'EURC', 'pagamenti', 'crypto', 'B2B'],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${syne.variable} ${dmMono.variable}`}>
      <body style={{ background: '#080810' }}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}