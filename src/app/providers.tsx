/**
 * src/app/providers.tsx — Client-side providers wrapper
 *
 * Wraps the app with WagmiProvider, QueryClientProvider, and RainbowKit.
 */

'use client';

import { type ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '../config/wagmi';

/** Providers props */
export interface ProvidersProps {
  children: ReactNode;
}

/**
 * Root providers wrapper for the Web3 wallet connector.
 * Creates a fresh QueryClient per mount to avoid shared state in SSR.
 */
export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5 * 60_000,
          gcTime: 10 * 60_000,
          refetchOnWindowFocus: false,
        },
      },
    }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
