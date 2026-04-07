/**
 * src/components/swap/SwapCard.tsx — Main swap interface card
 *
 * Composes TokenInput, TokenSelector, SwapRoute, PriceImpact,
 * and ConfirmSwapModal into the primary swap UI.
 * Manages state via Zustand store and useSwap hook.
 */

'use client';

import { useCallback, useMemo, useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import type { Token } from '../../types/token';
import type { SupportedChainId } from '../../types/chain';
import { useAppStore } from '../../store';
import { useSwap } from '../../hooks/useSwap';
import { useTokenBalances } from '../../hooks/useTokenBalances';
import { useTokenApproval } from '../../hooks/useTokenApproval';
import { useGasEstimate } from '../../hooks/useGasEstimate';
import { CONTRACT_ADDRESSES } from '../../constants/addresses';
import { isPriceImpactBlocked } from '../../lib/swap/slippage';
import { TokenInput } from './TokenInput';
import { TokenSelector } from './TokenSelector';
import { SwapRoute } from './SwapRoute';
import { PriceImpact } from './PriceImpact';
import { ConfirmSwapModal } from './ConfirmSwapModal';

/** SwapCard props */
export interface SwapCardProps {
  className?: string;
}

/**
 * Main swap card component.
 * Orchestrates the full swap flow: select tokens, enter amount,
 * fetch quote, approve if needed, confirm, and execute.
 */
export function SwapCard({ className }: SwapCardProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId() as SupportedChainId;

  // Store state
  const tokenIn = useAppStore((s) => s.tokenIn);
  const tokenOut = useAppStore((s) => s.tokenOut);
  const amountIn = useAppStore((s) => s.amountIn);
  const amountOut = useAppStore((s) => s.amountOut);
  const isQuoting = useAppStore((s) => s.isQuoting);
  const setTokenIn = useAppStore((s) => s.setTokenIn);
  const setTokenOut = useAppStore((s) => s.setTokenOut);
  const setAmountIn = useAppStore((s) => s.setAmountIn);
  const flipTokens = useAppStore((s) => s.flipTokens);

  // Modals
  const activeModal = useAppStore((s) => s.activeModal);
  const openModal = useAppStore((s) => s.openModal);
  const closeModal = useAppStore((s) => s.closeModal);

  // Swap hook
  const {
    quote,
    swapStatus,
    txHash,
    error,
    isQuoteStale,
    priceChangeWarning,
    fetchQuote,
    executeSwap,
    reset: resetSwap,
    refreshQuote,
  } = useSwap();

  // Balances
  const { balances } = useTokenBalances(chainId);

  // Get balance for selected tokens
  const tokenInBalance = useMemo(() => {
    if (!tokenIn) return undefined;
    return balances.find(
      (b) => b.address.toLowerCase() === tokenIn.address.toLowerCase(),
    );
  }, [tokenIn, balances]);

  const tokenOutBalance = useMemo(() => {
    if (!tokenOut) return undefined;
    return balances.find(
      (b) => b.address.toLowerCase() === tokenOut.address.toLowerCase(),
    );
  }, [tokenOut, balances]);

  // Token approval
  const routerAddress = CONTRACT_ADDRESSES[chainId]?.uniswapV3Router;
  const parsedAmountIn = useMemo(() => {
    if (!tokenIn || !amountIn) return 0n;
    try {
      return parseUnits(amountIn, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [tokenIn, amountIn]);

  const {
    needsApproval,
    approvalStatus,
    approve,
  } = useTokenApproval(
    tokenIn?.isNative ? null : (tokenIn?.address ?? null),
    routerAddress,
    parsedAmountIn,
  );

  // Gas estimate
  const { estimate: gasEstimate } = useGasEstimate(chainId);

  // Insufficient balance check
  const hasInsufficientBalance = useMemo(() => {
    if (!tokenInBalance || parsedAmountIn === 0n) return false;
    return parsedAmountIn > tokenInBalance.balance;
  }, [tokenInBalance, parsedAmountIn]);

  // Fetch quote when inputs change
  useEffect(() => {
    if (!tokenIn || !tokenOut || parsedAmountIn === 0n) return;
    fetchQuote(tokenIn, tokenOut, parsedAmountIn);
  }, [tokenIn, tokenOut, parsedAmountIn, fetchQuote]);

  // Token list for selectors
  const tokenList = useMemo(() => {
    return balances.map((b) => ({
      address: b.address,
      chainId: b.chainId,
      decimals: b.decimals,
      symbol: b.symbol,
      name: b.name,
      logoURI: b.logoURI,
      tags: b.tags,
      isNative: b.isNative,
      isWrapped: b.isWrapped,
    }));
  }, [balances]);

  // Handlers
  const handleAmountChange = useCallback(
    (value: string) => {
      setAmountIn(value);
    },
    [setAmountIn],
  );

  const handleFlip = useCallback(() => {
    flipTokens();
    resetSwap();
  }, [flipTokens, resetSwap]);

  const handleSelectTokenIn = useCallback(
    (token: Token) => {
      // If selecting same as output, flip
      if (tokenOut && token.address.toLowerCase() === tokenOut.address.toLowerCase()) {
        flipTokens();
      } else {
        setTokenIn(token);
      }
      closeModal();
    },
    [tokenOut, setTokenIn, flipTokens, closeModal],
  );

  const handleSelectTokenOut = useCallback(
    (token: Token) => {
      if (tokenIn && token.address.toLowerCase() === tokenIn.address.toLowerCase()) {
        flipTokens();
      } else {
        setTokenOut(token);
      }
      closeModal();
    },
    [tokenIn, setTokenOut, flipTokens, closeModal],
  );

  const handleSwapClick = useCallback(async () => {
    if (needsApproval) {
      try {
        await approve();
      } catch {
        // Approval failed or rejected — don't proceed
        return;
      }
    }
    openModal('confirm-swap');
  }, [needsApproval, approve, openModal]);

  const handleConfirmSwap = useCallback(async () => {
    closeModal();
    await executeSwap();
  }, [closeModal, executeSwap]);

  // Determine button state
  const buttonState = useMemo(() => {
    if (!isConnected) return { text: 'Connect Wallet', disabled: true };
    if (!tokenIn) return { text: 'Select input token', disabled: true };
    if (!tokenOut) return { text: 'Select output token', disabled: true };
    if (!amountIn || parsedAmountIn === 0n) return { text: 'Enter an amount', disabled: true };
    if (hasInsufficientBalance) return { text: `Insufficient ${tokenIn.symbol} balance`, disabled: true };
    if (isQuoting) return { text: 'Fetching quote...', disabled: true };
    if (error && !quote) return { text: error, disabled: true };
    if (!quote) return { text: 'No route available', disabled: true };
    if (isPriceImpactBlocked(quote.priceImpact)) return { text: 'Price impact too high', disabled: true };
    if (approvalStatus === 'approving' || approvalStatus === 'confirming') return { text: 'Approving...', disabled: true };
    if (swapStatus === 'swapping') return { text: 'Swapping...', disabled: true };
    if (needsApproval) return { text: `Approve ${tokenIn.symbol}`, disabled: false };
    return { text: 'Swap', disabled: false };
  }, [
    isConnected, tokenIn, tokenOut, amountIn, parsedAmountIn,
    hasInsufficientBalance, isQuoting, error, quote,
    approvalStatus, swapStatus, needsApproval,
  ]);

  return (
    <div className={`swap-card ${className ?? ''}`}>
      <div className="swap-card__header">
        <h2>Swap</h2>
      </div>

      {/* Input token */}
      <TokenInput
        token={tokenIn}
        amount={amountIn}
        onAmountChange={handleAmountChange}
        onTokenSelect={() => openModal('token-selector-in')}
        balance={tokenInBalance?.formattedBalance}
        balanceRaw={tokenInBalance?.balance}
        label="You pay"
      />

      {/* Flip button */}
      <div className="swap-card__flip">
        <button
          type="button"
          onClick={handleFlip}
          className="swap-card__flip-btn"
          aria-label="Flip tokens"
        >
          &#8645;
        </button>
      </div>

      {/* Output token */}
      <TokenInput
        token={tokenOut}
        amount={amountOut}
        onAmountChange={() => {}}
        onTokenSelect={() => openModal('token-selector-out')}
        balance={tokenOutBalance?.formattedBalance}
        balanceRaw={tokenOutBalance?.balance}
        label="You receive"
        readOnly
      />

      {/* Quote details */}
      {quote && (
        <div className="swap-card__details">
          {/* Exchange rate */}
          <div className="swap-card__rate">
            1 {quote.inputToken.symbol} ={' '}
            {Number(quote.executionPrice).toFixed(6)} {quote.outputToken.symbol}
          </div>

          <SwapRoute route={quote.route} />
          <PriceImpact impactPercent={quote.priceImpact} />

          <div className="swap-card__detail-row">
            <span>Min. received</span>
            <span>
              {Number(formatUnits(quote.minimumReceived, quote.outputToken.decimals)).toFixed(6)}{' '}
              {quote.outputToken.symbol}
            </span>
          </div>

          {gasEstimate?.estimatedCostUsd != null && (
            <div className="swap-card__detail-row">
              <span>Gas</span>
              <span>~${gasEstimate.estimatedCostUsd.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Stale quote warning */}
      {isQuoteStale && quote && (
        <div className="swap-card__warning">
          Quote expired.{' '}
          <button type="button" onClick={refreshQuote} className="swap-card__refresh-link">
            Refresh
          </button>
        </div>
      )}

      {/* Price change warning */}
      {priceChangeWarning && (
        <div className="swap-card__warning" data-severity="medium">
          Price changed &gt;2% since last quote. Please review.
        </div>
      )}

      {/* Error display */}
      {error && <div className="swap-card__error">{error}</div>}

      {/* Tx success */}
      {txHash && swapStatus === 'confirmed' && (
        <div className="swap-card__success">
          Swap confirmed! Tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}
        </div>
      )}

      {/* Main action button */}
      <button
        type="button"
        onClick={handleSwapClick}
        disabled={buttonState.disabled}
        className="swap-card__btn"
      >
        {buttonState.text}
      </button>

      {/* Token selectors */}
      <TokenSelector
        tokens={tokenList}
        balances={balances}
        selectedToken={tokenIn}
        onSelect={handleSelectTokenIn}
        isOpen={activeModal === 'token-selector-in'}
        onClose={closeModal}
      />
      <TokenSelector
        tokens={tokenList}
        balances={balances}
        selectedToken={tokenOut}
        onSelect={handleSelectTokenOut}
        isOpen={activeModal === 'token-selector-out'}
        onClose={closeModal}
      />

      {/* Confirm swap modal */}
      {quote && (
        <ConfirmSwapModal
          quote={quote}
          isOpen={activeModal === 'confirm-swap'}
          onConfirm={handleConfirmSwap}
          onClose={closeModal}
          gasEstimate={gasEstimate}
          isExecuting={swapStatus === 'swapping'}
        />
      )}
    </div>
  );
}
