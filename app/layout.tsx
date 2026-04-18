import type { Metadata, Viewport } from 'next'
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
    icon: [
      
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Dark theme: prevents iOS Safari from rendering the status bar
  // in light mode when the app background is dark.
  themeColor: '#0a0a0f',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${inter.variable} ${dmMono.variable}`}>
      <head>
        
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body
        className={`${inter.className} overflow-x-hidden`}
        style={{ background: '#0a0a0f', minHeight: '100dvh' }}
      >
        <Providers>
          {children}
          <FooterGlobe />
        </Providers>
      </body>
    </html>
  )
}