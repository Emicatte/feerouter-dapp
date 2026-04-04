'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet, base, baseSepolia, sepolia } from 'wagmi/chains'
import {
  RainbowKitProvider, darkTheme,
  connectorsForWallets,
} from '@rainbow-me/rainbowkit'
import {
  metaMaskWallet, coinbaseWallet, rainbowWallet,
  walletConnectWallet, injectedWallet, trustWallet, ledgerWallet,
} from '@rainbow-me/rainbowkit/wallets'
import '@rainbow-me/rainbowkit/styles.css'
import { useState, useEffect, createContext, useContext } from 'react'
import { useChainId, useSwitchChain } from 'wagmi'

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
  chains:     [base, mainnet, baseSepolia, sepolia] as const,
  connectors,
  transports: {
    [CHAIN.BASE]:         http(),
    [CHAIN.MAINNET]:      http(),
    [CHAIN.BASE_SEPOLIA]: http(),
    [CHAIN.SEPOLIA]:      http(),
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

  const supported: readonly number[] = [CHAIN.BASE, CHAIN.MAINNET, CHAIN.BASE_SEPOLIA, CHAIN.SEPOLIA]
  const isCorrectChain = supported.includes(chainId)
  const isL2           = chainId === CHAIN.BASE || chainId === CHAIN.BASE_SEPOLIA
  const gasWarning     = !isL2 && isCorrectChain
    ? 'Gas su Ethereum L1 è più costoso. Usa Base per transazioni minori.'
    : null

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
  useEffect(() => setMounted(true), [])

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
              {children}
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