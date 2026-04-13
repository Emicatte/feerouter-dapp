import type { Metadata } from 'next'
import { Inter, DM_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import dynamic from 'next/dynamic'

const FooterGlobe = dynamic(() => import('../components/FooterGlobe'), { ssr: false })

const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-display',
  display:  'swap',
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
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${dmMono.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body className={inter.className} style={{ background: '#0a0a0f' }}>
        <Providers>
          {children}
          <FooterGlobe />
        </Providers>
      </body>
    </html>
  )
}