/**
 * src/app/page.tsx — Main page
 *
 * Composes header (logo + chain selector + connect), tabbed content
 * (Swap / Portfolio / Activity), mobile bottom tabs, toast container,
 * and error boundaries.
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import { useAccount, useChainId } from 'wagmi';
import type { SupportedChainId } from '../types/chain';
import { ConnectButton } from '../components/wallet/ConnectButton';
import { ChainSelector } from '../components/wallet/ChainSelector';
import { SwapCard } from '../components/swap/SwapCard';
import { TotalValue } from '../components/portfolio/TotalValue';
import { BalanceList } from '../components/portfolio/BalanceList';
import { ToastContainer } from '../components/shared/Toast';
import { AppErrorBoundary } from '../components/shared/ErrorBoundary';
import { useChainSwitch } from '../hooks/useChainSwitch';
import { useTokenBalances } from '../hooks/useTokenBalances';

/** Tab identifiers */
type Tab = 'swap' | 'portfolio' | 'activity';

// ── SVG Icons for mobile tabs ────────────────────────────────

function SwapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3l4 4-4 4" />
      <path d="M20 7H4" />
      <path d="M8 21l-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  );
}

function PortfolioIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

/**
 * Main page — header, tabbed content, mobile nav, and toast overlay.
 */
export default function HomePage() {
  const { isConnected } = useAccount();
  const chainId = useChainId() as SupportedChainId;
  const [activeTab, setActiveTab] = useState<Tab>('swap');

  const { switchChain, isSwitching } = useChainSwitch();
  const { balances, isLoading: balancesLoading } = useTokenBalances(chainId);

  /** Total USD value of all token holdings */
  const totalUsd = useMemo(() => {
    if (balancesLoading || balances.length === 0) return null;
    const sum = balances.reduce((acc, b) => acc + (b.usdValue ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [balances, balancesLoading]);

  const handleSwitchChain = useCallback(
    (id: SupportedChainId) => {
      switchChain(id);
    },
    [switchChain],
  );

  return (
    <div className="app">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__logo">
            <div className="app-header__logo-icon" aria-hidden="true">W3</div>
            <span className="app-header__wordmark">Swap</span>
          </div>
          <div className="app-header__actions">
            {isConnected && (
              <ChainSelector
                currentChainId={chainId}
                onSelect={handleSwitchChain}
                isSwitching={isSwitching}
              />
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────── */}
      <main className="app-main">
        {/* Desktop tab bar */}
        <nav className="app-tabs" aria-label="Main navigation">
          <button
            type="button"
            className="app-tabs__btn"
            data-active={activeTab === 'swap'}
            onClick={() => setActiveTab('swap')}
          >
            Swap
          </button>
          <button
            type="button"
            className="app-tabs__btn"
            data-active={activeTab === 'portfolio'}
            onClick={() => setActiveTab('portfolio')}
          >
            Portfolio
          </button>
          <button
            type="button"
            className="app-tabs__btn"
            data-active={activeTab === 'activity'}
            onClick={() => setActiveTab('activity')}
          >
            Activity
          </button>
        </nav>

        {/* Tab: Swap */}
        {activeTab === 'swap' && (
          <AppErrorBoundary section="Swap">
            <SwapCard />
          </AppErrorBoundary>
        )}

        {/* Tab: Portfolio */}
        {activeTab === 'portfolio' && (
          <AppErrorBoundary section="Portfolio">
            {isConnected ? (
              <>
                <TotalValue totalUsd={totalUsd} isLoading={balancesLoading} />
                <BalanceList balances={balances} isLoading={balancesLoading} />
              </>
            ) : (
              <div className="app-empty-state">
                <svg className="app-empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <h3 className="app-empty-state__title">Connect your wallet</h3>
                <p className="app-empty-state__message">
                  Connect a wallet to view your portfolio and token balances.
                </p>
              </div>
            )}
          </AppErrorBoundary>
        )}

        {/* Tab: Activity */}
        {activeTab === 'activity' && (
          <div className="app-empty-state">
            <svg className="app-empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <h3 className="app-empty-state__title">Activity</h3>
            <p className="app-empty-state__message">
              Your recent swaps and transactions will appear here.
            </p>
          </div>
        )}
      </main>

      {/* ── Mobile bottom tabs ──────────────────────────────── */}
      <nav className="app-mobile-tabs" aria-label="Main navigation">
        <div className="app-mobile-tabs__inner">
          <button
            type="button"
            className="app-mobile-tabs__btn"
            data-active={activeTab === 'swap'}
            onClick={() => setActiveTab('swap')}
            aria-label="Swap"
          >
            <SwapIcon className="app-mobile-tabs__icon" />
            <span>Swap</span>
          </button>
          <button
            type="button"
            className="app-mobile-tabs__btn"
            data-active={activeTab === 'portfolio'}
            onClick={() => setActiveTab('portfolio')}
            aria-label="Portfolio"
          >
            <PortfolioIcon className="app-mobile-tabs__icon" />
            <span>Portfolio</span>
          </button>
          <button
            type="button"
            className="app-mobile-tabs__btn"
            data-active={activeTab === 'activity'}
            onClick={() => setActiveTab('activity')}
            aria-label="Activity"
          >
            <ActivityIcon className="app-mobile-tabs__icon" />
            <span>Activity</span>
          </button>
        </div>
      </nav>

      {/* ── Toast overlay ───────────────────────────────────── */}
      <ToastContainer />
    </div>
  );
}
