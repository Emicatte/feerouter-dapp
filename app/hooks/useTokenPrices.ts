'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'
const REFRESH_INTERVAL = 60_000 // 60 secondi

export interface TokenPrices {
  [coingeckoId: string]: { eur: number; usd: number }
}

/**
 * Hook che fetcha i prezzi da /api/v1/prices ogni 60 secondi.
 * Ritorna un map: coingeckoId -> { eur: number, usd: number }
 */
export function useTokenPrices() {
  const [prices, setPrices] = useState<TokenPrices>({})
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/api/v1/prices`)
      if (!res.ok) return
      const data = await res.json()
      // data = { eur: { ethereum: 1785, ... }, usd: { ethereum: 2057, ... }, cached: true }
      const eur: Record<string, number> = data.eur ?? {}
      const usd: Record<string, number> = data.usd ?? {}

      const merged: TokenPrices = {}
      const allIds = new Set([...Object.keys(eur), ...Object.keys(usd)])
      for (const id of allIds) {
        merged[id] = { eur: eur[id] ?? 0, usd: usd[id] ?? 0 }
      }
      setPrices(merged)
    } catch {
      // Silently fail — keep stale prices
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrices()
    intervalRef.current = setInterval(fetchPrices, REFRESH_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchPrices])

  return { prices, isLoading, refetch: fetchPrices }
}
