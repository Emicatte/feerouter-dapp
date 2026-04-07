/**
 * src/components/wallet/NetworkBadge.tsx — Network indicator badge
 *
 * Compact badge showing the current chain with a chain-specific color dot,
 * pulse animation during switching, and a tooltip with chain details.
 */

'use client';

import { useMemo } from 'react';
import { getChain, isSupportedChain } from '../../config/chains';

/** Chain-specific Tailwind bg colors */
const CHAIN_COLORS: Record<number, string> = {
  1: 'bg-blue-500',
  10: 'bg-red-500',
  56: 'bg-yellow-500',
  137: 'bg-purple-500',
  324: 'bg-indigo-400',
  8453: 'bg-blue-600',
  42161: 'bg-sky-500',
  42220: 'bg-emerald-500',
  43114: 'bg-red-600',
  81457: 'bg-yellow-300',
  84532: 'bg-blue-400',
};

/** Chain-specific Tailwind border colors for hover ring */
const CHAIN_RING_COLORS: Record<number, string> = {
  1: 'ring-blue-500/30',
  10: 'ring-red-500/30',
  56: 'ring-yellow-500/30',
  137: 'ring-purple-500/30',
  324: 'ring-indigo-400/30',
  8453: 'ring-blue-600/30',
  42161: 'ring-sky-500/30',
  42220: 'ring-emerald-500/30',
  43114: 'ring-red-600/30',
  81457: 'ring-yellow-300/30',
  84532: 'ring-blue-400/30',
};

/** NetworkBadge props */
export interface NetworkBadgeProps {
  /** Current chain ID */
  chainId: number;
  /** Whether a chain switch is in progress */
  isSwitching?: boolean;
  /** Additional CSS class names */
  className?: string;
}

/**
 * External link icon for the tooltip.
 * @internal
 */
function ExternalLinkIcon() {
  return (
    <svg
      className="inline-block h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

/**
 * Compact badge showing the current network.
 *
 * Features:
 * - Chain-specific dot color (Ethereum=blue, Arbitrum=sky, Polygon=purple, etc.)
 * - Pulse animation when `isSwitching` is true
 * - CSS-only tooltip with chain name, chain ID, and block explorer link
 * - "Unsupported" state for unknown chains
 */
export function NetworkBadge({
  chainId,
  isSwitching,
  className,
}: NetworkBadgeProps) {
  const chain = useMemo(() => getChain(chainId), [chainId]);
  const isSupported = isSupportedChain(chainId);

  const name = chain?.shortName ?? `Chain ${chainId}`;
  const fullName = chain?.name ?? `Unknown Chain (${chainId})`;
  const explorerUrl = chain?.blockExplorers?.[0]?.url;

  const dotColor = isSupported
    ? CHAIN_COLORS[chainId] ?? 'bg-gray-500'
    : 'bg-amber-400';
  const ringColor = isSupported
    ? CHAIN_RING_COLORS[chainId] ?? 'ring-gray-500/30'
    : 'ring-amber-400/30';

  return (
    <div className={`group relative inline-flex ${className ?? ''}`}>
      {/* Badge */}
      <span
        className={[
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
          'text-xs font-medium ring-1',
          isSupported ? 'bg-gray-800/80 text-gray-200' : 'bg-amber-500/10 text-amber-300',
          ringColor,
          'transition-all hover:ring-2',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-2 w-2 rounded-full',
            dotColor,
            isSwitching ? 'animate-pulse' : '',
          ].join(' ')}
        />
        {isSupported ? name : 'Unsupported'}
      </span>

      {/* Tooltip */}
      <div
        className={[
          'invisible group-hover:visible',
          'absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2',
          'w-48 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl',
          'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
          'pointer-events-none group-hover:pointer-events-auto',
        ].join(' ')}
        role="tooltip"
      >
        <p className="text-xs font-semibold text-white">{fullName}</p>
        <p className="mt-0.5 text-xs text-gray-400">Chain ID: {chainId}</p>
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          >
            Block Explorer <ExternalLinkIcon />
          </a>
        )}
        {!isSupported && (
          <p className="mt-1.5 text-xs text-amber-400">
            This network is not supported. Please switch to a supported chain.
          </p>
        )}
      </div>
    </div>
  );
}

NetworkBadge.displayName = 'NetworkBadge';
