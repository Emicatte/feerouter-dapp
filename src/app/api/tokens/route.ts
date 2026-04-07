/**
 * src/app/api/tokens/route.ts — Token list API
 *
 * Returns the default token list for a given chain.
 * Note: Under src/app/ — not active until migration from root app/.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getDefaultTokens } from '../../../config/tokens';

/**
 * GET /api/tokens?chainId=8453
 * Returns tokens for the specified chain.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const chainId = Number(request.nextUrl.searchParams.get('chainId') ?? '8453');

  if (isNaN(chainId) || chainId <= 0) {
    return NextResponse.json({ error: 'Invalid chainId' }, { status: 400 });
  }

  const tokens = getDefaultTokens(chainId);
  return NextResponse.json({ chainId, tokens, count: tokens.length });
}
