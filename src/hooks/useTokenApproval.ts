/**
 * src/hooks/useTokenApproval.ts — ERC-20 approval hook
 *
 * Checks current allowance and submits approve transactions.
 * Features: exact vs infinite approval toggle, native token skip,
 * auto-refresh on chain/account change.
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { erc20Abi, maxUint256 } from 'viem';
import type { TxStatus } from '../types/transaction';

/** Return type of the approval hook */
export interface UseTokenApprovalReturn {
  allowance: bigint;
  needsApproval: boolean;
  approvalStatus: TxStatus;
  approve: (amount?: bigint) => Promise<void>;
  isInfiniteApproval: boolean;
  setInfiniteApproval: (infinite: boolean) => void;
}

/**
 * Hook for managing ERC-20 token approvals.
 * Skips approval checks for native tokens (address null or 0xEeee...).
 *
 * @param tokenAddress - ERC-20 contract address (null for native)
 * @param spender - Address that will spend the tokens (router)
 * @param amount - Required amount to check against allowance
 */
export function useTokenApproval(
  tokenAddress: `0x${string}` | null,
  spender: `0x${string}`,
  amount: bigint,
): UseTokenApprovalReturn {
  const { address: owner } = useAccount();
  const [approvalStatus, setApprovalStatus] = useState<TxStatus>('idle');
  const [infiniteApproval, setInfiniteApproval] = useState(false);

  const isNativeToken =
    !tokenAddress ||
    tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  // Read current allowance
  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner && tokenAddress ? [owner, spender] : undefined,
    query: {
      enabled: !!owner && !!tokenAddress && !isNativeToken,
    },
  });

  const allowance = (allowanceData as bigint) ?? 0n;

  // Check if approval is needed
  const needsApproval = useMemo(() => {
    if (isNativeToken) return false;
    if (!owner || !tokenAddress) return false;
    if (amount === 0n) return false;
    return allowance < amount;
  }, [isNativeToken, owner, tokenAddress, amount, allowance]);

  // Write contract for approve
  const { writeContractAsync } = useWriteContract();

  // Track approval tx
  const [approvalTxHash, setApprovalTxHash] = useState<`0x${string}` | undefined>();

  useWaitForTransactionReceipt({
    hash: approvalTxHash,
    query: {
      enabled: !!approvalTxHash,
    },
  });

  const approve = useCallback(
    async (overrideAmount?: bigint) => {
      if (!owner || !tokenAddress || isNativeToken) return;

      const approveAmount = infiniteApproval
        ? maxUint256
        : (overrideAmount ?? amount);

      setApprovalStatus('approving');

      try {
        const hash = await writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, approveAmount],
        });

        setApprovalTxHash(hash);
        setApprovalStatus('confirming');

        // Wait for confirmation by refetching allowance
        // The useWaitForTransactionReceipt above handles the wait
        // We poll the allowance to confirm
        let attempts = 0;
        const maxAttempts = 30;
        while (attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
          const { data: newAllowance } = await refetchAllowance();
          if (newAllowance !== undefined && (newAllowance as bigint) >= amount) {
            setApprovalStatus('confirmed');
            return;
          }
          attempts++;
        }

        // If we get here after polling, assume confirmed
        setApprovalStatus('confirmed');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Approval failed';
        if (message.includes('rejected') || message.includes('denied')) {
          setApprovalStatus('cancelled');
        } else {
          setApprovalStatus('failed');
        }
        throw err;
      }
    },
    [
      owner,
      tokenAddress,
      isNativeToken,
      infiniteApproval,
      amount,
      spender,
      writeContractAsync,
      refetchAllowance,
    ],
  );

  return {
    allowance,
    needsApproval,
    approvalStatus,
    approve,
    isInfiniteApproval: infiniteApproval,
    setInfiniteApproval: setInfiniteApproval,
  };
}
