/**
 * src/lib/evm/multicall.ts — Batch balance reads via Multicall3
 *
 * Aggregates multiple balanceOf calls into a single RPC request,
 * including native balance. Supports chunking for large token lists
 * and graceful per-token error handling.
 */

import type { PublicClient } from 'viem';
import { formatUnits } from 'viem';
import { ERC20_ABI } from '../../constants/abis/erc20';
import type { Token, TokenBalance } from '../../types/token';
import { NATIVE_ADDRESS } from '../../constants/addresses';

/** Maximum calls per multicall batch (gas limit safety) */
const MAX_CALLS_PER_BATCH = 100;

/** Call descriptor for multicall */
export interface MulticallBalanceRequest {
  token: Token;
  owner: `0x${string}`;
}

/**
 * Split an array into chunks of a given size.
 * @internal
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Batch-read ERC-20 balances for multiple tokens in a single RPC call.
 * @param client - Viem public client
 * @param requests - Array of token + owner pairs
 * @returns Raw balances indexed by token address
 */
export async function batchReadBalances(
  client: PublicClient,
  requests: MulticallBalanceRequest[],
): Promise<Map<`0x${string}`, bigint>> {
  const balances = new Map<`0x${string}`, bigint>();

  // Filter out native tokens — they need getBalance, not multicall
  const erc20Requests = requests.filter(
    (r) => r.token.address.toLowerCase() !== NATIVE_ADDRESS.toLowerCase(),
  );

  // Process in chunks to stay within gas limits
  const chunks = chunk(erc20Requests, MAX_CALLS_PER_BATCH);

  for (const batch of chunks) {
    const contracts = batch.map(({ token, owner }) => ({
      address: token.address,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [owner] as const,
    }));

    try {
      const results = await client.multicall({ contracts });

      batch.forEach((req, i) => {
        const result = results[i];
        balances.set(
          req.token.address,
          result.status === 'success' ? (result.result as bigint) : 0n,
        );
      });
    } catch {
      // If entire batch fails, set all to 0n
      batch.forEach((req) => {
        balances.set(req.token.address, 0n);
      });
    }
  }

  return balances;
}

/**
 * Get all token balances for an address on a specific chain.
 * Includes native balance + all ERC20 tokens via multicall.
 * Each token that reverts is reported with balance 0n (does not fail the batch).
 *
 * @param tokens - List of tokens to check (including native)
 * @param owner - Wallet address
 * @param client - Viem public client
 */
export async function batchGetBalances(
  tokens: Token[],
  owner: `0x${string}`,
  client: PublicClient,
): Promise<TokenBalance[]> {
  const nativeToken = tokens.find(
    (t) => t.isNative || t.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase(),
  );
  const erc20Tokens = tokens.filter(
    (t) => !t.isNative && t.address.toLowerCase() !== NATIVE_ADDRESS.toLowerCase(),
  );

  // Fetch native balance + ERC20 balances in parallel
  const [nativeBalance, erc20Balances] = await Promise.all([
    nativeToken ? fetchNativeBalance(client, owner) : Promise.resolve(0n),
    batchReadBalances(
      client,
      erc20Tokens.map((token) => ({ token, owner })),
    ),
  ]);

  const result: TokenBalance[] = [];

  // Native token first
  if (nativeToken) {
    result.push({
      ...nativeToken,
      balance: nativeBalance,
      formattedBalance: formatUnits(nativeBalance, nativeToken.decimals),
      usdValue: null,
    });
  }

  // ERC20 tokens
  for (const token of erc20Tokens) {
    const bal = erc20Balances.get(token.address) ?? 0n;
    result.push({
      ...token,
      balance: bal,
      formattedBalance: formatUnits(bal, token.decimals),
      usdValue: null,
    });
  }

  return result;
}

/**
 * Fetch the native coin balance for an address.
 * @internal
 */
async function fetchNativeBalance(
  client: PublicClient,
  owner: `0x${string}`,
): Promise<bigint> {
  try {
    return await client.getBalance({ address: owner });
  } catch {
    return 0n;
  }
}
