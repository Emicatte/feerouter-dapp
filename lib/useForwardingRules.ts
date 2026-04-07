'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSignMessage } from 'wagmi'
import { mutationHeaders, parseRSendError } from './rsendFetch'

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════

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
  signature?: string
  sign_timestamp?: number
}

// ═══════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════

export function useForwardingRules(address: string | undefined) {
  const [rules, setRules] = useState<ForwardingRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backendOffline, setBackendOffline] = useState(false)
  const failCountRef = useRef(0)
  const errorLoggedRef = useRef(false)
  const signingRef = useRef(false)
  const { signMessageAsync } = useSignMessage()

  // Guard: prevent concurrent signature requests
  // Timeout prevents infinite hang if MetaMask popup doesn't open
  const signOnce = useCallback(async (message: string): Promise<string> => {
    if (signingRef.current) throw new Error('Signature already in progress')
    signingRef.current = true
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          'Signature timed out — open your wallet and approve the pending request'
        )), 60_000)
      )
      return await Promise.race([signMessageAsync({ message }), timeout])
    } finally {
      signingRef.current = false
    }
  }, [signMessageAsync])

  // ── Fetch ──────────────────────────────────────────────

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
      failCountRef.current = 0
      errorLoggedRef.current = false
      setBackendOffline(false)
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : String(e))
      failCountRef.current++
      if (!errorLoggedRef.current) {
        console.debug('[useForwardingRules] Backend unreachable, silencing further errors')
        errorLoggedRef.current = true
      }
      if (failCountRef.current >= 5) setBackendOffline(true)
    }
    if (!silent) setLoading(false)
  }, [address])

  useEffect(() => { fetchRules() }, [fetchRules])

  useEffect(() => {
    if (!address) return
    const iv = setInterval(() => fetchRules(true), 30000)
    return () => clearInterval(iv)
  }, [address, fetchRules])

  // ── Create (single rule, wallet signature) ─────────────

  const createRule = useCallback(async (payload: CreateRulePayload) => {
    const isoTimestamp = new Date().toISOString()
    const walletAddr = payload.source_wallet
    const message = `RSends:${walletAddr}:${isoTimestamp}`
    const signature = await signOnce(message)

    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules`, {
      method: 'POST',
      headers: mutationHeaders({
        'X-Wallet-Address': walletAddr,
        'X-Wallet-Signature': signature,
        'X-Timestamp': isoTimestamp,
      }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(await parseRSendError(res))
    await fetchRules()
    return res.json()
  }, [fetchRules, signOnce])

  // ── Create batch (multiple rules, single wallet signature) ──

  const createRuleBatch = useCallback(async (payloads: CreateRulePayload[]) => {
    if (payloads.length === 0) return
    const isoTimestamp = new Date().toISOString()
    const walletAddr = payloads[0].source_wallet
    const message = `RSends:${walletAddr}:${isoTimestamp}`
    const signature = await signOnce(message)

    const authHeaders = {
      'X-Wallet-Address': walletAddr,
      'X-Wallet-Signature': signature,
      'X-Timestamp': isoTimestamp,
    }
    for (const payload of payloads) {
      const res = await fetch(`${BACKEND}/api/v1/forwarding/rules`, {
        method: 'POST',
        headers: mutationHeaders(authHeaders),
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await parseRSendError(res))
    }
    await fetchRules()
  }, [fetchRules, signOnce])

  // ── Update ─────────────────────────────────────────────

  const updateRule = useCallback(async (ruleId: number, updates: Record<string, any>) => {
    const isoTimestamp = new Date().toISOString()
    const message = `RSends:${address}:${isoTimestamp}`
    const signature = await signOnce(message)

    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}`, {
      method: 'PUT',
      headers: mutationHeaders({
        'X-Wallet-Address': address!,
        'X-Wallet-Signature': signature,
        'X-Timestamp': isoTimestamp,
      }),
      body: JSON.stringify(updates),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(await parseRSendError(res))
    await fetchRules()
  }, [address, fetchRules, signOnce])

  // ── Delete (wallet signature) ──────────────────────────

  const deleteRule = useCallback(async (ruleId: number) => {
    const isoTimestamp = new Date().toISOString()
    const message = `RSends:${address}:${isoTimestamp}`
    const signature = await signOnce(message)

    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}`, {
      method: 'DELETE',
      headers: mutationHeaders({
        'X-Wallet-Address': address!,
        'X-Wallet-Signature': signature,
        'X-Timestamp': isoTimestamp,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(await parseRSendError(res))
    await fetchRules()
  }, [address, fetchRules, signOnce])

  // ── Pause / Resume ─────────────────────────────────────

  const pauseRule = useCallback(async (ruleId: number) => {
    const isoTimestamp = new Date().toISOString()
    const message = `RSends:${address}:${isoTimestamp}`
    const signature = await signOnce(message)

    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}/pause`, {
      method: 'POST',
      headers: mutationHeaders({
        'X-Wallet-Address': address!,
        'X-Wallet-Signature': signature,
        'X-Timestamp': isoTimestamp,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(await parseRSendError(res))
    await fetchRules()
  }, [address, fetchRules, signOnce])

  const resumeRule = useCallback(async (ruleId: number) => {
    const isoTimestamp = new Date().toISOString()
    const message = `RSends:${address}:${isoTimestamp}`
    const signature = await signOnce(message)

    const res = await fetch(`${BACKEND}/api/v1/forwarding/rules/${ruleId}/resume`, {
      method: 'POST',
      headers: mutationHeaders({
        'X-Wallet-Address': address!,
        'X-Wallet-Signature': signature,
        'X-Timestamp': isoTimestamp,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(await parseRSendError(res))
    await fetchRules()
  }, [address, fetchRules, signOnce])

  // ── Emergency Stop ─────────────────────────────────────

  const emergencyStop = useCallback(async () => {
    const isoTimestamp = new Date().toISOString()
    const message = `RSends:${address}:${isoTimestamp}`
    const signature = await signOnce(message)

    const res = await fetch(`${BACKEND}/api/v1/forwarding/emergency-stop`, {
      method: 'POST',
      headers: mutationHeaders({
        'X-Wallet-Address': address!,
        'X-Wallet-Signature': signature,
        'X-Timestamp': isoTimestamp,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(await parseRSendError(res))
    const data = await res.json()
    await fetchRules()
    return data
  }, [address, fetchRules, signOnce])

  return {
    rules, loading, error, backendOffline,
    refresh: () => fetchRules(),
    createRule, createRuleBatch, updateRule, deleteRule,
    pauseRule, resumeRule, emergencyStop,
  }
}
