'use client'

import { useState, useEffect, useCallback } from 'react'

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

export interface ForwardingRule {
  id: number
  user_id: string
  label: string | null
  source_wallet: string
  destination_wallet: string
  split_enabled: boolean
  split_percent: number
  split_destination: string | null
  is_active: boolean
  is_paused: boolean
  min_threshold: number
  gas_strategy: string
  max_gas_percent: number
  gas_limit_gwei: number
  cooldown_sec: number
  max_daily_vol: number | null
  token_address: string | null
  token_symbol: string
  token_filter: string[]
  auto_swap: boolean
  swap_to_token: string | null
  notify_enabled: boolean
  notify_channel: string
  telegram_chat_id: string | null
  email_address: string | null
  schedule_json: Record<string, any> | null
  chain_id: number
  created_at: string | null
  updated_at: string | null
  sweep_count?: number
  last_sweep?: string | null
}

export interface CreateRulePayload {
  owner_address: string
  source_wallet: string
  destination_wallet: string
  label?: string
  split_enabled?: boolean
  split_percent?: number
  split_destination?: string
  min_threshold?: number
  gas_strategy?: string
  max_gas_percent?: number
  gas_limit_gwei?: number
  cooldown_sec?: number
  max_daily_vol?: number | null
  token_address?: string | null
  token_symbol?: string
  token_filter?: string[]
  auto_swap?: boolean
  swap_to_token?: string | null
  notify_enabled?: boolean
  notify_channel?: string
  telegram_chat_id?: string
  email_address?: string
  schedule_json?: Record<string, any> | null
  chain_id?: number
}

export function useForwardingRules(address: string | undefined) {
  const [rules, setRules] = useState<ForwardingRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRules = useCallback(async (silent = false) => {
    if (!address) return
    if (!silent) setLoading(true)
    try {
      const res = await fetch(
        `${BACKEND}/api/v1/forwarding/rules?owner_address=${address.toLowerCase()}`,
        { signal: AbortSignal.timeout(15000) }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRules(data.rules ?? [])
      setError(null)
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e))
    }
    if (!silent) setLoading(false)
  }, [address])

  useEffect(() => { fetchRules() }, [fetchRules])

  useEffect(() => {
    if (!address) return
    const iv = setInterval(() => fetchRules(true), 15000)
    return () => clearInterval(iv)
  }, [address, fetchRules])

  const createRule = useCallback(async (payload: CreateRulePayload) => {
    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `HTTP ${res.status}`)
    }
    await fetchRules()
    return res.json()
  }, [fetchRules])

  const updateRule = useCallback(async (ruleId: number, updates: Record<string, any>) => {
    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address, ...updates }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await fetchRules()
  }, [address, fetchRules])

  const deleteRule = useCallback(async (ruleId: number) => {
    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await fetchRules()
  }, [address, fetchRules])

  const pauseRule = useCallback(async (ruleId: number) => {
    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await fetchRules()
  }, [address, fetchRules])

  const resumeRule = useCallback(async (ruleId: number) => {
    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await fetchRules()
  }, [address, fetchRules])

  const emergencyStop = useCallback(async () => {
    const res = await fetch(`${BACKEND}/api/v1/forwarding/emergency-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: address }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    await fetchRules()
    return data
  }, [address, fetchRules])

  return {
    rules, loading, error,
    refresh: () => fetchRules(),
    createRule, updateRule, deleteRule,
    pauseRule, resumeRule, emergencyStop,
  }
}
