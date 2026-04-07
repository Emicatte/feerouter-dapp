/**
 * src/components/swap/SwapRoute.tsx — Swap route visualization
 *
 * Shows the path tokens take through pools with fee tiers,
 * direct vs multi-hop indicator, and gas saving note.
 */

'use client';

import type { SwapRoute as SwapRouteType } from '../../types/swap';

/** SwapRoute props */
export interface SwapRouteProps {
  route: SwapRouteType | null;
  className?: string;
}

/**
 * Format a fee tier number (e.g. 3000) to a percentage string (e.g. "0.3%").
 * @internal
 */
function formatFeeTier(fee: number): string {
  return `${(fee / 10_000) * 100}%`;
}

/**
 * Visual representation of the swap route.
 * Shows: Token → (fee%) → Token for each hop.
 */
export function SwapRoute({ route, className }: SwapRouteProps) {
  if (!route) return null;

  const isMultiHop = route.path.length > 2;

  return (
    <div className={`swap-route ${className ?? ''}`}>
      <div className="swap-route__header">
        <span className="swap-route__label">Route</span>
        <span className="swap-route__type" data-multihop={isMultiHop}>
          {isMultiHop ? `${route.path.length - 1} hops` : 'Direct'}
        </span>
      </div>
      <div className="swap-route__path">
        {route.path.map((token, i) => (
          <span key={`${token.chainId}-${token.address}-${i}`} className="swap-route__step">
            <span className="swap-route__token">
              {token.logoURI && (
                <img
                  src={token.logoURI}
                  alt=""
                  width={16}
                  height={16}
                  className="swap-route__token-icon"
                />
              )}
              {token.symbol}
            </span>
            {i < route.pools.length && (
              <span className="swap-route__fee" aria-label={`${formatFeeTier(route.pools[i].fee)} fee`}>
                &rarr;
                <span className="swap-route__fee-label">
                  {formatFeeTier(route.pools[i].fee)}
                </span>
                &rarr;
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
