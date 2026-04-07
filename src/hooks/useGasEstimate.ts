/**
 * src/hooks/useGasEstimate.ts — Gas estimation hook
 *
 * Provides real-time gas price, cost estimation with 20% buffer,
 * and USD cost calculation. Uses wagmi v2 compatible APIs.
 */

'use client';

import { useMemo, useState, useEffect } from 'react';
import { useGasPrice, useEstimateGas, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import type { GasEstimate } from '../types/transaction';

/** Return type of the gas estimate hook */
export interface UseGasEstimateReturn {
  gasPrice: bigint | undefined;
  estimate: GasEstimate | null;
  isLoading: boolean;
  maxFeePerGas: bigint | undefined;
  maxPriorityFeePerGas: bigint | undefined;
  isEIP1559: boolean;
}

/** Gas buffer: 20% added to raw estimate for safety */
const GAS_BUFFER_BPS = 2000n; // 20%
const BPS_BASE = 10000n;

/**
 * Apply a 20% buffer to a gas estimate.
 * @internal
 */
function applyBuffer(gasLimit: bigint): bigint {
  return gasLimit + (gasLimit * GAS_BUFFER_BPS) / BPS_BASE;
}

/**
 * Hook for fetching current gas prices and estimating transaction costs.
 * Supports EIP-1559 (type 2) with legacy fallback.
 *
 * @param chainId - Target chain for gas estimation
 * @param txData - Optional transaction data for estimateGas
 * @param ethPriceUsd - Optional ETH price in USD for cost calculation
 */
export function useGasEstimate(
  chainId?: number,
  txData?: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
  },
  ethPriceUsd?: number,
): UseGasEstimateReturn {
  const publicClient = usePublicClient({ chainId });

  // Gas price (works on all chains)
  const { data: gasPrice, isLoading: gasPriceLoading } = useGasPrice({
    chainId,
    query: { refetchInterval: 15_000 },
  });

  // EIP-1559 fee data via public client
  const [maxFeePerGas, setMaxFeePerGas] = useState<bigint | undefined>();
  const [maxPriorityFeePerGas, setMaxPriorityFeePerGas] = useState<bigint | undefined>();

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function fetchFees() {
      try {
        const fees = await publicClient!.estimateFeesPerGas();
        if (!cancelled) {
          setMaxFeePerGas(fees.maxFeePerGas ?? undefined);
          setMaxPriorityFeePerGas(fees.maxPriorityFeePerGas ?? undefined);
        }
      } catch {
        // Chain doesn't support EIP-1559
        if (!cancelled) {
          setMaxFeePerGas(undefined);
          setMaxPriorityFeePerGas(undefined);
        }
      }
    }

    fetchFees();
    const interval = setInterval(fetchFees, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicClient]);

  const isEIP1559 = !!(maxFeePerGas && maxPriorityFeePerGas);

  // Estimate gas for the specific transaction if provided
  const { data: rawGasEstimate, isLoading: estimateLoading } = useEstimateGas({
    to: txData?.to,
    data: txData?.data,
    value: txData?.value,
    chainId,
    query: { enabled: !!txData?.to },
  });

  // Build full GasEstimate with buffer and USD cost
  const estimate = useMemo((): GasEstimate | null => {
    if (!rawGasEstimate) return null;

    const bufferedGasLimit = applyBuffer(rawGasEstimate);

    const effectiveMaxFeePerGas = maxFeePerGas ?? gasPrice ?? 0n;
    const effectiveMaxPriorityFeePerGas = maxPriorityFeePerGas ?? 0n;

    const estimatedCostWei = bufferedGasLimit * effectiveMaxFeePerGas;

    let estimatedCostUsd: number | null = null;
    if (ethPriceUsd && ethPriceUsd > 0) {
      const costEth = Number(formatUnits(estimatedCostWei, 18));
      estimatedCostUsd = costEth * ethPriceUsd;
    }

    return {
      gasLimit: bufferedGasLimit,
      maxFeePerGas: effectiveMaxFeePerGas,
      maxPriorityFeePerGas: effectiveMaxPriorityFeePerGas,
      estimatedCostWei,
      estimatedCostUsd,
    };
  }, [rawGasEstimate, maxFeePerGas, maxPriorityFeePerGas, gasPrice, ethPriceUsd]);

  return {
    gasPrice,
    estimate,
    isLoading: gasPriceLoading || estimateLoading,
    maxFeePerGas,
    maxPriorityFeePerGas,
    isEIP1559,
  };
}
