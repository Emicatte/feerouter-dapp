import withBundleAnalyzer from '@next/bundle-analyzer'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

// TODO: disable Vercel Toolbar for Production via Dashboard
// (Project Settings → Advanced → Vercel Toolbar → toggle off for Production).
// The toolbar script at https://vercel.live/_next-live/feedback/feedback.js is
// blocked by our CSP (intentional) but still generates console warnings.
// No runtime flag exists to suppress it from next.config — must be done in the dashboard.

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development'
const devConnect = isDev ? ' ws://localhost:* http://localhost:*' : ''

const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };
    return config;
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com",
            "font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com",
            "img-src 'self' data: blob: https:",
            `connect-src 'self' https://rpagos-backend.onrender.com wss://rpagos-backend.onrender.com https://*.infura.io https://*.alchemy.com https://*.llamarpc.com https://*.publicnode.com https://rpc.ankr.com https://mainnet.base.org https://sepolia.base.org https://arb1.arbitrum.io https://mainnet.optimism.io https://polygon-rpc.com https://bsc-dataseed.binance.org https://api.avax.network https://mainnet.era.zksync.io https://forno.celo.org https://rpc.blast.io https://api.trongrid.io https://api.shasta.trongrid.io wss://*.walletconnect.com wss://*.walletconnect.org https://*.walletconnect.org https://*.web3modal.org https://api.coingecko.com https://ipapi.co${devConnect}`,
            "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "upgrade-insecure-requests",
          ].join('; '),
        },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
    {
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
      ],
    },
    // ── Cache-Control ──────────────────────────────────────────
    // HTML pages: never cache, always revalidate
    {
      source: '/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
      ],
    },
    // Next.js static assets (hashed filenames): immutable, 1 year
    {
      source: '/_next/static/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    },
    // Next.js optimized images: 1 day + stale-while-revalidate
    {
      source: '/_next/image/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
      ],
    },
  ],
}

export default withNextIntl(analyzer(nextConfig))
