import type { Metadata } from 'next'
import { Syne, DM_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

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
  title:       'RSends',
  description: 'Automazione finanziaria Web3 non-custodial su Base L2 con split routing e compliance DAC8.',
  keywords:    ['Web3', 'Base', 'USDC', 'EURC', 'pagamenti', 'crypto', 'B2B', 'split routing', 'DAC8'],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${syne.variable} ${dmMono.variable}`}>
      <body style={{ background: '#0a0a0f' }}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}