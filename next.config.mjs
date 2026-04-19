import withBundleAnalyzer from '@next/bundle-analyzer'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
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
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: https: blob:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'self' http://localhost:* ws://localhost:* https://*.infura.io https://*.alchemy.com https://*.llamarpc.com https://*.publicnode.com https://rpc.ankr.com https://mainnet.base.org https://sepolia.base.org https://arb1.arbitrum.io https://mainnet.optimism.io https://polygon-rpc.com https://bsc-dataseed.binance.org https://api.avax.network https://mainnet.era.zksync.io https://forno.celo.org https://rpc.blast.io https://api.trongrid.io https://api.shasta.trongrid.io wss://*.walletconnect.com wss://*.walletconnect.org https://*.walletconnect.org https://*.web3modal.org https://api.coingecko.com https://ipapi.co https://*.railway.app",
            "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
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
  ],
}

export default withNextIntl(analyzer(nextConfig))
