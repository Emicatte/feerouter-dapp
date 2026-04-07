/**
 * src/components/swap/ConfirmSwapModal.tsx — Swap confirmation dialog
 *
 * Shows full swap details and requires explicit confirmation.
 * Features: rate display, minimum received, price impact severity,
 * gas cost, slippage warning, 3-second countdown for high-impact trades.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatUnits } from 'viem';
import type { SwapQuote } from '../../types/swap';
import type { GasEstimate } from '../../types/transaction';
import { getPriceImpactSeverity, isPriceImpactBlocked } from '../../lib/swap/slippage';
import { PriceImpact } from './PriceImpact';

/** ConfirmSwapModal props */
export interface ConfirmSwapModalProps {
  quote: SwapQuote;
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
  gasEstimate?: GasEstimate | null;
  isExecuting?: boolean;
}

/** Countdown duration for high-impact swaps (seconds) */
const HIGH_IMPACT_COUNTDOWN = 3;

/**
 * Modal for confirming swap details before execution.
 * Enforces a 3-second countdown when price impact is high.
 */
export function ConfirmSwapModal({
  quote,
  isOpen,
  onConfirm,
  onClose,
  gasEstimate,
  isExecuting,
}: ConfirmSwapModalProps) {
  const [countdown, setCountdown] = useState(0);

  const severity = getPriceImpactSeverity(quote.priceImpact);
  const isBlocked = isPriceImpactBlocked(quote.priceImpact);
  const needsCountdown = severity === 'high' || severity === 'blocked';

  // Start countdown when modal opens for high-impact trades
  useEffect(() => {
    if (!isOpen || !needsCountdown) {
      setCountdown(0);
      return;
    }

    setCountdown(HIGH_IMPACT_COUNTDOWN);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, needsCountdown]);

  const handleConfirm = useCallback(() => {
    if (isBlocked || countdown > 0 || isExecuting) return;
    onConfirm();
  }, [isBlocked, countdown, isExecuting, onConfirm]);

  if (!isOpen) return null;

  const inputFormatted = formatUnits(quote.inputAmount, quote.inputToken.decimals);
  const outputFormatted = formatUnits(quote.outputAmount, quote.outputToken.decimals);
  const minReceivedFormatted = formatUnits(
    quote.minimumReceived,
    quote.outputToken.decimals,
  );

  const canConfirm = !isBlocked && countdown === 0 && !isExecuting;

  return (
    <div className="confirm-swap__overlay" onClick={onClose}>
      <div
        className="confirm-swap"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm swap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-swap__header">
          <h3>Confirm Swap</h3>
          <button
            type="button"
            onClick={onClose}
            className="confirm-swap__close"
            aria-label="Close"
            disabled={isExecuting}
          >
            &times;
          </button>
        </div>

        {/* Token amounts */}
        <div className="confirm-swap__amounts">
          <div className="confirm-swap__token-row">
            <span className="confirm-swap__amount">
              {Number(inputFormatted).toFixed(6)}
            </span>
            <span className="confirm-swap__symbol">
              {quote.inputToken.symbol}
            </span>
          </div>
          <div className="confirm-swap__arrow" aria-hidden="true">
            &darr;
          </div>
          <div className="confirm-swap__token-row">
            <span className="confirm-swap__amount">
              {Number(outputFormatted).toFixed(6)}
            </span>
            <span className="confirm-swap__symbol">
              {quote.outputToken.symbol}
            </span>
          </div>
        </div>

        {/* Swap details */}
        <div className="confirm-swap__details">
          <div className="confirm-swap__detail-row">
            <span>Rate</span>
            <span>
              1 {quote.inputToken.symbol} = {Number(quote.executionPrice).toFixed(6)}{' '}
              {quote.outputToken.symbol}
            </span>
          </div>

          <PriceImpact impactPercent={quote.priceImpact} />

          <div className="confirm-swap__detail-row">
            <span>Minimum received</span>
            <span>
              {Number(minReceivedFormatted).toFixed(6)} {quote.outputToken.symbol}
            </span>
          </div>

          <div className="confirm-swap__detail-row">
            <span>Slippage tolerance</span>
            <span>{quote.slippageTolerance}%</span>
          </div>

          <div className="confirm-swap__detail-row">
            <span>Route</span>
            <span>
              {quote.route.path.map((t) => t.symbol).join(' → ')}
            </span>
          </div>

          <div className="confirm-swap__detail-row">
            <span>Fee</span>
            <span>{(quote.fee.percentage * 100).toFixed(2)}%</span>
          </div>

          {gasEstimate && (
            <div className="confirm-swap__detail-row">
              <span>Estimated gas</span>
              <span>
                {gasEstimate.estimatedCostUsd != null
                  ? `~$${gasEstimate.estimatedCostUsd.toFixed(2)}`
                  : `${formatUnits(gasEstimate.estimatedCostWei, 18).slice(0, 8)} ETH`}
              </span>
            </div>
          )}
        </div>

        {/* Warnings */}
        {quote.slippageTolerance > 1 && (
          <div className="confirm-swap__warning" data-severity="medium">
            High slippage tolerance ({quote.slippageTolerance}%). You may receive
            significantly less than expected.
          </div>
        )}

        {/* Confirm button */}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="confirm-swap__btn"
          data-severity={severity}
        >
          {isExecuting
            ? 'Swapping...'
            : isBlocked
              ? 'Swap Blocked (Price Impact Too High)'
              : countdown > 0
                ? `Confirm in ${countdown}s...`
                : 'Confirm Swap'}
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={isExecuting}
          className="confirm-swap__cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
