'use client'

import { useState, useEffect, useCallback } from 'react'

// Same-origin proxy → see app/api/backend/[...path]/route.ts
const BACKEND = '/api/backend'

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════

export interface DistributionEntry {
  address: string
  label: string
  percent: number
}

export interface DistributionList {
  id: number
  owner_address: string
  name: string
  entries: DistributionEntry[]
  created_at: string | null
  updated_at: string | null
}

// ═══════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════

export function useDistributionList(address: string | undefined) {
  const [lists, setLists] = useState<DistributionList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLists = useCallback(async (silent = false) => {
    if (!address) return
    if (!silent) setLoading(true)
    try {
      const res = await fetch(
        `${BACKEND}/api/v1/distribution/lists?owner_address=${address.toLowerCase()}`,
        { signal: AbortSignal.timeout(15000) }
      )
      if (res.ok) {
        const data = await res.json()
        setLists(data.lists ?? [])
        setError(null)
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e))
    }
    if (!silent) setLoading(false)
  }, [address])

  useEffect(() => { fetchLists() }, [fetchLists])

  const createList = useCallback(async (name: string, entries: DistributionEntry[]) => {
    const res = await fetch(`${BACKEND}/api/v1/distribution/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address, name, entries }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `HTTP ${res.status}`)
    }
    await fetchLists()
    return res.json()
  }, [address, fetchLists])

  const deleteList = useCallback(async (id: number) => {
    const res = await fetch(`${BACKEND}/api/v1/distribution/lists/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await fetchLists()
  }, [address, fetchLists])

  return { lists, loading, error, refresh: () => fetchLists(), createList, deleteList }
}
