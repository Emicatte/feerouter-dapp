'use client'

/**
 * providers.tsx v2
 *
 * MULTI-NETWORK: base + baseSepolia configurate
 * CHAIN GUARD: hook useChainGuard per bloccare invii su rete sbagliata
 * ERROR INTERCEPTOR: decodifica errori wallet incluso EIP-1193 code 4001
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider }                    from 'wagmi'
import { base, baseSepolia }                from 'wagmi/chains'
import {
  getDefaultConfig,
  RainbowKitProvider,
  darkTheme,
} from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { useState, useEffect, createContext, useContext } from 'react'
import { useChainId, useSwitchChain }       from 'wagmi'

// ── Wagmi config con Base + Base Sepolia ───────────────────────────────────
const config = getDefaultConfig({
  appName:   'FeeRouter B2B',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
  chains:    [base, baseSepolia],
  ssr:       false,
})

// ── Query client ottimizzato ───────────────────────────────────────────────
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:  8_000,
        retry:      2,
        retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8_000),
      },
    },
  })
}

// ── Chain Guard Context ────────────────────────────────────────────────────
interface ChainGuardCtx {
  isCorrectChain: boolean
  currentChainId: number
  targetChainId:  number
  switchToTarget: () => void
  targetName:     string
}

const ChainGuardContext = createContext<ChainGuardCtx>({
  isCorrectChain: true,
  currentChainId: base.id,
  targetChainId:  base.id,
  switchToTarget: () => {},
  targetName:     'Base',
})

// Legge la chain target dall'env (default: Base Mainnet)
const TARGET_CHAIN_ID = process.env.NEXT_PUBLIC_TARGET_CHAIN_ID
  ? parseInt(process.env.NEXT_PUBLIC_TARGET_CHAIN_ID)
  : base.id

const TARGET_CHAIN_NAME = TARGET_CHAIN_ID === base.id ? 'Base Mainnet' : 'Base Sepolia'

function ChainGuardProvider({ children }: { children: React.ReactNode }) {
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  const isCorrectChain = chainId === TARGET_CHAIN_ID

  const switchToTarget = () => {
    switchChain({ chainId: TARGET_CHAIN_ID as typeof base.id | typeof baseSepolia.id })
  }

  return (
    <ChainGuardContext.Provider value={{
      isCorrectChain,
      currentChainId: chainId,
      targetChainId:  TARGET_CHAIN_ID,
      switchToTarget,
      targetName:     TARGET_CHAIN_NAME,
    }}>
      {children}
    </ChainGuardContext.Provider>
  )
}

export function useChainGuard() {
  return useContext(ChainGuardContext)
}

// ── Global Error Interceptor ───────────────────────────────────────────────

/**
 * Decodifica errori wallet/contract in messaggi italiani professionali.
 * Gestisce EIP-1193 (MetaMask), viem errors, contract reverts.
 */
export function decodeWalletError(error: unknown): {
  message: string
  type: 'rejected' | 'funds' | 'gas' | 'network' | 'contract' | 'unknown'
  isUserAction: boolean
} {
  const raw = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: number })?.code

  // EIP-1193: User rejected (code 4001)
  if (code === 4001 || raw.includes('rejected') || raw.includes('denied') || raw.includes('cancel')) {
    return {
      message: 'Firma negata: l\'operazione è stata annullata senza costi.',
      type: 'rejected',
      isUserAction: true,
    }
  }

  // Fondi insufficienti
  if (raw.includes('insufficient funds') || raw.includes('insufficient balance')) {
    return {
      message: 'Fondi insufficienti per completare la transazione. Verifica il saldo ETH per il gas.',
      type: 'funds',
      isUserAction: false,
    }
  }

  // Gas
  if (raw.includes('gas') || raw.includes('intrinsic')) {
    return {
      message: 'Errore nella stima del gas. La rete potrebbe essere congestionata. Riprova.',
      type: 'gas',
      isUserAction: false,
    }
  }

  // Rete sbagliata
  if (raw.includes('chain') || raw.includes('network') || raw.includes('chainId')) {
    return {
      message: 'Rete non corretta. Passa a ' + TARGET_CHAIN_NAME + ' in MetaMask.',
      type: 'network',
      isUserAction: false,
    }
  }

  // Contract revert
  if (raw.includes('revert') || raw.includes('execution reverted')) {
    if (raw.includes('ZeroAddress'))   return { message: 'Indirizzo non valido (zero address).', type: 'contract', isUserAction: false }
    if (raw.includes('ZeroAmount'))    return { message: 'Importo non può essere zero.', type: 'contract', isUserAction: false }
    if (raw.includes('ETHTransfer'))   return { message: 'Trasferimento ETH fallito. Il destinatario potrebbe aver rifiutato i fondi.', type: 'contract', isUserAction: false }
    return { message: 'Transazione rifiutata dal contratto. Verifica i parametri.', type: 'contract', isUserAction: false }
  }

  return {
    message: 'Errore imprevisto: ' + raw.slice(0, 100),
    type: 'unknown',
    isUserAction: false,
  }
}

// ── Chain Warning Banner ───────────────────────────────────────────────────
function ChainWarningBanner() {
  const { isCorrectChain, switchToTarget, targetName, currentChainId } = useChainGuard()

  if (isCorrectChain) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: 'rgba(245,158,11,0.95)', backdropFilter: 'blur(8px)',
      padding: '10px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      fontFamily: 'var(--font-mono)', fontSize: 13,
    }}>
      <span>⚠ Rete non corretta (Chain ID: {currentChainId}). Questa dApp richiede <strong>{targetName}</strong>.</span>
      <button
        onClick={switchToTarget}
        style={{
          padding: '4px 14px', borderRadius: 6, border: 'none',
          background: 'rgba(0,0,0,0.2)', color: '#fff',
          fontWeight: 700, cursor: 'pointer', fontSize: 12,
        }}
      >
        Cambia rete →
      </button>
    </div>
  )
}

// ── Provider root ──────────────────────────────────────────────────────────
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor:            '#ff007a',
            accentColorForeground:  'white',
            borderRadius:           'medium',
            fontStack:              'system',
          })}
          modalSize="compact"
        >
          {mounted && (
            <ChainGuardProvider>
              <ChainWarningBanner />
              {children}
            </ChainGuardProvider>
          )}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
