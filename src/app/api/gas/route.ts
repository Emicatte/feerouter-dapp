/**
 * src/app/api/gas/route.ts — Gas price API
 *
 * Returns current gas prices for a given chain.
 * Note: Under src/app/ — not active until migration from root app/.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createEvmPublicClient } from '../../../lib/evm/client';
import type { SupportedChainId } from '../../../types/chain';
import { isSupportedChain } from '../../../config/chains';

/**
 * GET /api/gas?chainId=8453
 * Returns the current gas price for the specified chain.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const chainId = Number(request.nextUrl.searchParams.get('chainId') ?? '8453');

  if (!isSupportedChain(chainId)) {
    return NextResponse.json({ error: 'Unsupported chain' }, { status: 400 });
  }

  try {
    const client = createEvmPublicClient(chainId as SupportedChainId);
    const gasPrice = await client.getGasPrice();

    return NextResponse.json({
      chainId,
      gasPriceWei: gasPrice.toString(),
      gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch gas price' },
      { status: 502 },
    );
  }
}
