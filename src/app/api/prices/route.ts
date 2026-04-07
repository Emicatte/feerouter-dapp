/**
 * src/app/api/prices/route.ts — Price API
 *
 * Proxies price requests to CoinGecko with server-side caching.
 * Note: Under src/app/ — not active until migration from root app/.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { fetchPrices } from '../../../lib/price/oracle';

/** Default token IDs to fetch prices for */
const DEFAULT_IDS = ['ethereum', 'usd-coin', 'tether', 'dai', 'bitcoin', 'weth', 'arbitrum'];

/**
 * GET /api/prices?ids=ethereum,usd-coin
 * Returns current prices for the requested token IDs.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const idsParam = request.nextUrl.searchParams.get('ids');
  const ids = idsParam ? idsParam.split(',') : DEFAULT_IDS;

  try {
    const prices = await fetchPrices(ids);
    return NextResponse.json({ prices, cached: false });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch prices' },
      { status: 502 },
    );
  }
}
