import { NextResponse } from 'next/server'
import { getAllCoingeckoIds } from '../../tokens/tokenRegistry'

/**
 * Bulk market data for ExploreTokens: one upstream request covers every
 * supported coingecko id — price, 24h change, 7d sparkline, logo URL.
 *
 * Per-id /market_chart calls get rate-limited on CoinGecko free tier
 * (~10-30 req/min), so we collapse 16+ requests into one /coins/markets
 * call and cache server-side for 5 min. Stale cache is returned if upstream
 * is unreachable, so the UI degrades gracefully rather than 502-ing.
 */

export type TokenMarket = {
  price: number | null
  change24h: number | null
  sparkline: number[]
  image: string | null
  marketCap: number | null
  volume: number | null
}

const TTL = 5 * 60 * 1000
let cache: { data: Record<string, TokenMarket>; ts: number } | null = null

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json(cache.data, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  }

  try {
    const ids = getAllCoingeckoIds().join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&sparkline=true&price_change_percentage=24h`,
      { signal: AbortSignal.timeout(10000), cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
    const coins = await res.json()

    const result: Record<string, TokenMarket> = {}
    if (Array.isArray(coins)) {
      for (const c of coins) {
        if (!c?.id) continue
        result[c.id] = {
          price: typeof c.current_price === 'number' ? c.current_price : null,
          change24h:
            typeof c.price_change_percentage_24h === 'number'
              ? c.price_change_percentage_24h
              : null,
          sparkline: Array.isArray(c.sparkline_in_7d?.price)
            ? (c.sparkline_in_7d.price.filter((n: unknown) => typeof n === 'number') as number[])
            : [],
          image: typeof c.image === 'string' ? c.image : null,
          marketCap: typeof c.market_cap === 'number' ? c.market_cap : null,
          volume: typeof c.total_volume === 'number' ? c.total_volume : null,
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      const missing = getAllCoingeckoIds().filter(id => !(id in result))
      if (missing.length > 0) {
        console.warn('[tokens-market] CoinGecko returned no data for:', missing.join(', '))
      }
    }

    cache = { data: result, ts: Date.now() }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch (err) {
    if (cache) {
      return NextResponse.json(cache.data, {
        headers: { 'Cache-Control': 'public, max-age=60' },
      })
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
