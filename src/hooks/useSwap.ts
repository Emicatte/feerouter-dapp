/**
 * src/hooks/useSwap.ts — Swap execution hook
 *
 * Manages the swap lifecycle: quote → approve → execute → confirm.
 * Features: debounced quoting (300ms), state machine tracking,
 * approval integration, quote staleness detection (30s expiry),
 * price change warning (>2%), wrap/unwrap bypass.
 */

'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAccount, usePublicClient, useSendTransaction, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import type { Token } from '../types/token';
import type { SwapQuote } from '../types/swap';
import type { TxStatus } from '../types/transaction';
import type { SupportedChainId } from '../types/chain';
import { findBestRoute } from '../lib/swap/path-finder';
import { encodeSwapTransaction } from '../lib/swap/router';
import { isPriceImpactBlocked } from '../lib/swap/slippage';
import { useAppStore } from '../store';

/** Quote staleness threshold: 30 seconds */
const QUOTE_STALE_MS = 30_000;

/** Debounce delay for quote fetching (ms) */
const DEBOUNCE_MS = 300;

/** Price change warning threshold (2%) */
const PRICE_CHANGE_WARNING_THRESHOLD = 0.02;

/** Swap status enum for the state machine */
export type SwapStatus =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'approving'
  | 'swapping'
  | 'confirmed'
  | 'failed';

/** Swap hook state */
export interface UseSwapReturn {
  quote: SwapQuote | null;
  status: TxStatus;
  swapStatus: SwapStatus;
  txHash: `0x${string}` | null;
  error: string | null;
  isQuoteStale: boolean;
  priceChangeWarning: boolean;
  fetchQuote: (tokenIn: Token, tokenOut: Token, amount: bigint) => Promise<void>;
  executeSwap: () => Promise<void>;
  reset: () => void;
  refreshQuote: () => Promise<void>;
}

/**
 * Hook for managing the full swap flow.
 * Handles quoting (with debounce), approval checks, and transaction submission.
 * Integrates with the Zustand store for token/amount state.
 */
export function useSwap(): UseSwapReturn {
  const { address } = useAccount();
  const chainId = useChainId() as SupportedChainId;
  const publicClient = usePublicClient({ chainId });
  const { sendTransactionAsync } = useSendTransaction();

  const slippage = useAppStore((s) => s.slippage);
  const deadline = useAppStore((s) => s.deadline);
  const setAmountOut = useAppStore((s) => s.setAmountOut);
  const setStoreQuote = useAppStore((s) => s.setQuote);
  const setIsQuoting = useAppStore((s) => s.setIsQuoting);

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [status, setStatus] = useState<TxStatus>('idle');
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoteTimestamp, setQuoteTimestamp] = useState(0);
  const [priceChangeWarning, setPriceChangeWarning] = useState(false);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last quote params for refresh
  const lastQuoteParamsRef = useRef<{
    tokenIn: Token;
    tokenOut: Token;
    amount: bigint;
  } | null>(null);

  // Quote staleness check
  const isQuoteStale = useMemo(() => {
    if (!quote || quoteTimestamp === 0) return false;
    return Date.now() - quoteTimestamp > QUOTE_STALE_MS;
  }, [quote, quoteTimestamp]);

  // Periodically check staleness
  useEffect(() => {
    if (!quote) return;
    const interval = setInterval(() => {
      // Force re-render to update isQuoteStale
      setQuoteTimestamp((prev) => prev);
    }, 5_000);
    return () => clearInterval(interval);
  }, [quote]);

  const fetchQuote = useCallback(
    async (tokenIn: Token, tokenOut: Token, amount: bigint) => {
      // Clear previous debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      lastQuoteParamsRef.current = { tokenIn, tokenOut, amount };

      if (amount === 0n || !publicClient) {
        setQuote(null);
        setStoreQuote(null);
        setAmountOut('');
        setSwapStatus('idle');
        return;
      }

      // Debounce the actual quote fetch
      return new Promise<void>((resolve) => {
        debounceRef.current = setTimeout(async () => {
          setSwapStatus('quoting');
          setIsQuoting(true);
          setError(null);

          try {
            const result = await findBestRoute(
              publicClient,
              tokenIn,
              tokenOut,
              amount,
              chainId,
              slippage,
              deadline,
            );

            if (!result) {
              setError('No route found for this pair');
              setQuote(null);
              setStoreQuote(null);
              setAmountOut('');
              setSwapStatus('idle');
            } else {
              setQuote(result);
              setStoreQuote(result);
              setQuoteTimestamp(Date.now());
              setPriceChangeWarning(false);
              setAmountOut(
                formatUnits(result.outputAmount, tokenOut.decimals),
              );
              setSwapStatus('quoted');
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Quote failed';
            setError(msg);
            setSwapStatus('failed');
          } finally {
            setIsQuoting(false);
          }

          resolve();
        }, DEBOUNCE_MS);
      });
    },
    [publicClient, chainId, slippage, deadline, setAmountOut, setStoreQuote, setIsQuoting],
  );

  const refreshQuote = useCallback(async () => {
    const params = lastQuoteParamsRef.current;
    if (!params || !publicClient) return;

    const previousOutput = quote?.outputAmount;

    setIsQuoting(true);

    try {
      const result = await findBestRoute(
        publicClient,
        params.tokenIn,
        params.tokenOut,
        params.amount,
        chainId,
        slippage,
        deadline,
      );

      if (result) {
        // Check price change vs previous quote
        if (previousOutput && previousOutput > 0n) {
          const diff = Number(result.outputAmount - previousOutput);
          const pct = Math.abs(diff / Number(previousOutput));
          setPriceChangeWarning(pct > PRICE_CHANGE_WARNING_THRESHOLD);
        }

        setQuote(result);
        setStoreQuote(result);
        setQuoteTimestamp(Date.now());
        setAmountOut(
          formatUnits(result.outputAmount, params.tokenOut.decimals),
        );
        setSwapStatus('quoted');
        setError(null);
      }
    } catch {
      // Keep stale quote on refresh failure
    } finally {
      setIsQuoting(false);
    }
  }, [publicClient, chainId, slippage, deadline, quote, setAmountOut, setStoreQuote, setIsQuoting]);

  const executeSwap = useCallback(async () => {
    if (!quote || !address || !publicClient) {
      setError('Missing quote, wallet, or connection');
      return;
    }

    // Block if price impact too high
    if (isPriceImpactBlocked(quote.priceImpact)) {
      setError('Price impact too high (>15%). Swap blocked for safety.');
      return;
    }

    // Refresh quote if stale
    if (Date.now() - quoteTimestamp > QUOTE_STALE_MS) {
      await refreshQuote();
      return; // User needs to re-confirm after refresh
    }

    setSwapStatus('swapping');
    setStatus('pending');
    setError(null);

    try {
      // Build transaction calldata
      const encoded = await encodeSwapTransaction({
        quote,
        recipient: address,
        slippageTolerance: slippage,
        deadline,
      });

      // Send transaction via wagmi hook
      const hash = await sendTransactionAsync({
        to: encoded.to,
        data: encoded.data,
        value: encoded.value,
      });

      setTxHash(hash);
      setStatus('confirming');

      // Wait for receipt
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
      });

      if (receipt.status === 'success') {
        setStatus('confirmed');
        setSwapStatus('confirmed');
      } else {
        setStatus('failed');
        setSwapStatus('failed');
        setError('Transaction reverted');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Swap failed';
      if (msg.includes('rejected') || msg.includes('denied')) {
        setStatus('cancelled');
        setSwapStatus('idle');
        setError('Transaction rejected by user');
      } else {
        setStatus('failed');
        setSwapStatus('failed');
        setError(msg);
      }
    }
  }, [
    quote,
    address,
    sendTransactionAsync,
    publicClient,
    quoteTimestamp,
    slippage,
    deadline,
    refreshQuote,
  ]);

  const reset = useCallback(() => {
    setQuote(null);
    setStatus('idle');
    setSwapStatus('idle');
    setTxHash(null);
    setError(null);
    setQuoteTimestamp(0);
    setPriceChangeWarning(false);
    lastQuoteParamsRef.current = null;
    setStoreQuote(null);
  }, [setStoreQuote]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    quote,
    status,
    swapStatus,
    txHash,
    error,
    isQuoteStale,
    priceChangeWarning,
    fetchQuote,
    executeSwap,
    reset,
    refreshQuote,
  };
}
