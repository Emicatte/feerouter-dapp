/**
 * app/providers-solana.tsx — Solana wallet provider
 *
 * Wrapped separately to avoid polluting the EVM provider tree.
 * Loaded via dynamic() with ssr: false to prevent SSR issues.
 */
'use client'

import { useMemo } from 'react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'

// NOTE: CSS import moved to providers.tsx to avoid chunk-loading failures
// with Next.js dynamic() imports.

export default function SolanaProviders({ children }: { children: React.ReactNode }) {
  const network = WalletAdapterNetwork.Mainnet
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC || clusterApiUrl(network),
    [network]
  )
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
