'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import {
  mainnet, optimism, bsc, polygon, zksync,
  base, arbitrum, celo, avalanche, blast,
  baseSepolia, sepolia,
} from 'wagmi/chains'
import {
  RainbowKitProvider, darkTheme,
  connectorsForWallets,
} from '@rainbow-me/rainbowkit'
import {
  metaMaskWallet, coinbaseWallet, rainbowWallet,
  walletConnectWallet, injectedWallet, trustWallet, ledgerWallet,
} from '@rainbow-me/rainbowkit/wallets'
import '@rainbow-me/rainbowkit/styles.css'
import '@solana/wallet-adapter-react-ui/styles.css'
import dynamic from 'next/dynamic'
import { useState, useEffect, createContext, useContext } from 'react'
import { usePathname } from 'next/navigation'
import { useChainId, useSwitchChain } from 'wagmi'
import { registerAdapter } from '../lib/chain-adapters/registry'
import { createEVMAdapter } from '../lib/chain-adapters/evm-adapter'
import { createSolanaAdapter } from '../lib/chain-adapters/solana-adapter'
import { createTronAdapter } from '../lib/chain-adapters/tron-adapter'

const SolanaProviders = dynamic(() => import('./providers-solana'), { ssr: false })
const TronProvider = dynamic(() => import('./providers-tron').then(m => ({ default: m.TronProvider })), { ssr: false })

// ── Register all chain adapters at module load ────────────────────────────
const EVM_CHAIN_IDS = [1, 10, 56, 137, 324, 8453, 42161, 42220, 43114, 81457, 84532]
EVM_CHAIN_IDS.forEach(id => registerAdapter(createEVMAdapter(id)))
registerAdapter(createSolanaAdapter())
registerAdapter(createTronAdapter())

// ── Valori letterali — necessari per Wagmi v2 type safety ──────────────────
// NON usare base.id / mainnet.id nelle chiamate switchChain o confronti:
// quei campi sono tipizzati come `number`, non come `8453 | 1 | ...`
const CHAIN = {
  BASE:         8453   as const,
  MAINNET:      1      as const,
  BASE_SEPOLIA: 84532  as const,
  SEPOLIA:      11155111 as const,
} as const

type SupportedChainId = typeof CHAIN[keyof typeof CHAIN]

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID!

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Raccomandati',
      wallets:   [metaMaskWallet, coinbaseWallet, rainbowWallet],
    },
    {
      groupName: 'Altri',
      wallets:   [walletConnectWallet, trustWallet, ledgerWallet, injectedWallet],
    },
  ],
  { appName: 'RPagos — Omni-chain Gateway', projectId: WC_PROJECT_ID }
)

// ── Wagmi config ───────────────────────────────────────────────────────────
// Usiamo le chain objects per createConfig (necessario per metadata)
// ma i chainId numerici per tutto il resto
const config = createConfig({
  chains: [
    base,          // Default — FeeRouterV4
    mainnet,
    arbitrum,
    optimism,
    polygon,
    bsc,
    avalanche,
    zksync,
    celo,
    blast,
    baseSepolia,   // Testnet ultimo
    sepolia,
  ] as const,
  connectors,
  transports: {
    [base.id]:        http('https://mainnet.base.org'),
    [mainnet.id]:     http('https://eth.llamarpc.com'),
    [arbitrum.id]:    http('https://arb1.arbitrum.io/rpc'),
    [optimism.id]:    http('https://mainnet.optimism.io'),
    [polygon.id]:     http('https://polygon-rpc.com'),
    [bsc.id]:         http('https://bsc-dataseed.binance.org'),
    [avalanche.id]:   http('https://api.avax.network/ext/bc/C/rpc'),
    [zksync.id]:      http('https://mainnet.era.zksync.io'),
    [celo.id]:        http('https://forno.celo.org'),
    [blast.id]:       http('https://rpc.blast.io'),
    [baseSepolia.id]: http('https://sepolia.base.org'),
    [sepolia.id]:     http(),
  },
  ssr: false,
})

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 8_000, retry: 2 } },
  })
}

// ── Chain Guard ────────────────────────────────────────────────────────────
interface ChainGuardCtx {
  isCorrectChain:  boolean
  isL2:            boolean
  currentChainId:  number
  switchToBase:    () => void
  switchToMainnet: () => void
  gasWarning:      string | null
}

const ChainGuardContext = createContext<ChainGuardCtx>({
  isCorrectChain:  true,
  isL2:            true,
  currentChainId:  CHAIN.BASE,
  switchToBase:    () => {},
  switchToMainnet: () => {},
  gasWarning:      null,
})

function ChainGuardProvider({ children }: { children: React.ReactNode }) {
  const chainId         = useChainId()
  const { switchChain } = useSwitchChain()

  const supported: readonly number[] = [
    base.id, mainnet.id, arbitrum.id, optimism.id, polygon.id,
    bsc.id, avalanche.id, zksync.id, celo.id, blast.id,
    baseSepolia.id, sepolia.id,
  ]
  const isCorrectChain = supported.includes(chainId)
  const isL2           = chainId === CHAIN.BASE || chainId === CHAIN.BASE_SEPOLIA
  const gasWarning     = null

  return (
    <ChainGuardContext.Provider value={{
      isCorrectChain,
      isL2,
      currentChainId:  chainId,
      // Valori letterali → TypeScript soddisfatto
      switchToBase:    () => switchChain({ chainId: CHAIN.BASE }),
      switchToMainnet: () => switchChain({ chainId: CHAIN.MAINNET }),
      gasWarning,
    }}>
      {children}
    </ChainGuardContext.Provider>
  )
}

export function useChainGuard() {
  return useContext(ChainGuardContext)
}

function GasWarningBanner() {
  const { gasWarning, switchToBase } = useChainGuard()
  if (!gasWarning) return null
  return (
    <div className="bf-blur-8" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: 'rgba(245,158,11,0.9)',
      padding: '9px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      fontFamily: 'var(--font-display)', fontSize: 13,
    }}>
      <span>⚠ {gasWarning}</span>
      <button
        onClick={switchToBase}
        style={{
          padding: '3px 12px', borderRadius: 6, border: 'none',
          background: 'rgba(0,0,0,0.2)', color: '#fff',
          fontWeight: 700, cursor: 'pointer', fontSize: 12,
        }}
      >
        Passa a Base →
      </button>
    </div>
  )
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()
  useEffect(() => setMounted(true), [])

  // Admin pages don't need wallet providers — render children directly
  if (pathname?.startsWith('/admin') || pathname?.startsWith('/pay') || pathname?.startsWith('/merchant')) {
    return <>{children}</>
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor:           '#00ffa3',
            accentColorForeground: '#000',
            borderRadius:          'medium',
            overlayBlur:           'small',
          })}
          modalSize="compact"
          appInfo={{ appName: 'RPagos', learnMoreUrl: 'https://rpagos.com' }}
        >
          {mounted && (
            <ChainGuardProvider>
              <GasWarningBanner />
              <SolanaProviders>
                <TronProvider>
                  {children}
                </TronProvider>
              </SolanaProviders>
            </ChainGuardProvider>
          )}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

// ── Export chain constants per uso nel resto dell'app ──────────────────────
export { CHAIN, type SupportedChainId }

export function decodeWalletError(error: unknown): {
  message: string; type: string; isUserAction: boolean
} {
  const raw  = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: number })?.code
  if (code === 4001 || raw.includes('rejected') || raw.includes('denied'))
    return { message: 'Firma annullata senza costi.', type: 'rejected', isUserAction: true }
  if (raw.includes('OracleSignatureInvalid'))
    return { message: 'Transazione negata per policy di conformità AML.', type: 'oracle', isUserAction: false }
  if (raw.includes('MEVGuard'))
    return { message: 'Slippage non configurato.', type: 'mev', isUserAction: false }
  if (raw.includes('InsufficientLiquidity'))
    return { message: "Liquidità insufficiente. Riduci l'importo o cambia token.", type: 'liquidity', isUserAction: false }
  if (raw.includes('SlippageExceeded'))
    return { message: 'Slippage superato. Riprova.', type: 'slippage', isUserAction: false }
  if (raw.includes('insufficient funds'))
    return { message: 'Fondi insufficienti per il gas.', type: 'funds', isUserAction: false }
  return { message: 'Errore: ' + raw.slice(0, 100), type: 'unknown', isUserAction: false }
}