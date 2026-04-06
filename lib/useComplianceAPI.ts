/**
 * lib/useComplianceAPI.ts — DAC8 Compliance API Bridge
 *
 * Invia ComplianceRecord al backend FastAPI Python.
 * Endpoint: POST /api/v1/tx/callback
 *
 * Resilienza:
 *   1. Prova invio immediato dopo tx completed (~2s Base finality)
 *   2. Se server down → salva in localStorage queue (rp_pending_queue)
 *   3. Al prossimo avvio app → drain automatico della queue (retry)
 *   4. HMAC-SHA256 signature per autenticazione backend
 *
 * Sicurezza:
 *   - La firma HMAC è calcolata su: "fiscal_ref|tx_hash|gross_amount|currency|timestamp"
 *   - La chiave viene da NEXT_PUBLIC_HMAC_KEY (env var su Vercel)
 *   - PENDING_HMAC_SHA256 non viene mai usato in produzione
 *
 * Backend Python (FastAPI) atteso:
 *   POST /api/v1/tx/callback
 *   Headers: X-Signature: <hmac-sha256>
 *            Content-Type: application/json
 *   Body: ComplianceRecord JSON
 *   Response: { status: "ok", id: "..." }
 */

import { useCallback, useEffect } from 'react'
import type { ComplianceRecord } from './useComplianceEngine'
import { idempotencyKey } from './rsendFetch'

// ── Config ─────────────────────────────────────────────────────────────────
const API_BASE    = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const API_ENDPOINT = `${API_BASE}/api/v1/tx/callback`
const QUEUE_KEY   = 'rp_pending_queue'
const MAX_RETRIES = 5
const HMAC_KEY    = process.env.NEXT_PUBLIC_HMAC_KEY ?? 'dev_secret_replace_in_prod'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

// ── HMAC-SHA256 (Web Crypto API — client side) ─────────────────────────────
async function generateHmac(
  fiscalRef: string,
  txHash: string,
  grossAmount: string,
  currency: string,
  timestamp: string,
): Promise<string> {
  const message = `${fiscalRef}|${txHash}|${grossAmount}|${currency}|${timestamp}`
  try {
    const enc     = new TextEncoder()
    const keyData = enc.encode(HMAC_KEY)
    const msgData = enc.encode(message)
    const key     = await crypto.subtle.importKey(
      'raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    )
    const sig  = await crypto.subtle.sign('HMAC', key, msgData)
    const arr  = Array.from(new Uint8Array(sig))
    return arr.map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    if (IS_PRODUCTION) {
      console.error('[rp_compliance] HMAC generation failed — cannot send in production')
      return ''
    }
    return 'PENDING_HMAC_SHA256'
  }
}

// ── Tipi ───────────────────────────────────────────────────────────────────
interface QueueEntry {
  record:      ComplianceRecord
  attempts:    number
  lastAttempt: string
  createdAt:   string
}

interface ApiResult {
  success:  boolean
  queued:   boolean
  error?:   string
  response?: unknown
}

// ── Queue helpers ──────────────────────────────────────────────────────────
function getQueue(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveQueue(q: QueueEntry[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch { /* SSR */ }
}

function addToQueue(record: ComplianceRecord) {
  const q = getQueue()
  q.push({
    record,
    attempts:    0,
    lastAttempt: '',
    createdAt:   new Date().toISOString(),
  })
  saveQueue(q)
  console.warn('[rp_compliance] API down — record in queue:', record.compliance_id)
}

// ── Invio singolo record ───────────────────────────────────────────────────
async function sendRecord(record: ComplianceRecord): Promise<boolean> {
  try {
    const enriched = {
      ...record,
      currency: record.asset,
      timestamp: record.block_timestamp,
    }

    const grossAmount = String(enriched.gross_amount ?? enriched.fiat_gross ?? '0')
    const timestamp = enriched.timestamp

    const signature = await generateHmac(
      enriched.fiscal_ref,
      enriched.tx_hash,
      grossAmount,
      enriched.currency,
      timestamp,
    )

    // In produzione, non inviare se HMAC non è disponibile
    if (IS_PRODUCTION && !signature) {
      console.error('[rp_compliance] Cannot send without valid HMAC in production')
      return false
    }

    const payload = JSON.stringify(enriched)
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature':  signature,
        'X-Client':     'feerouter-dapp/1.0',
        'X-Idempotency-Key': idempotencyKey(),
      },
      body:    payload,
      signal:  AbortSignal.timeout(8000), // 8s timeout
    })

    if (!res.ok) {
      console.error('[rp_compliance] API error:', res.status, res.statusText)
      return false
    }

    const json = await res.json()
    console.log('[rp_compliance] API success:', json)
    return true
  } catch (e) {
    console.warn('[rp_compliance] API unreachable:', e instanceof Error ? e.message : e)
    return false
  }
}

// ── Hook principale ────────────────────────────────────────────────────────
export function useComplianceAPI() {

  // ── Drain queue al mount (retry pending records) ────────────────────────
  useEffect(() => {
    const drain = async () => {
      const q = getQueue()
      if (!q.length) return

      console.log(`[rp_compliance] Draining queue: ${q.length} pending records`)
      const remaining: QueueEntry[] = []

      for (const entry of q) {
        if (entry.attempts >= MAX_RETRIES) {
          console.warn('[rp_compliance] Max retries reached, discarding:', entry.record.compliance_id)
          continue
        }

        const ok = await sendRecord(entry.record)
        if (ok) {
          console.log('[rp_compliance] Queue record sent:', entry.record.compliance_id)
        } else {
          remaining.push({
            ...entry,
            attempts:    entry.attempts + 1,
            lastAttempt: new Date().toISOString(),
          })
        }
      }

      saveQueue(remaining)
      if (remaining.length > 0) {
        console.warn(`[rp_compliance] ${remaining.length} records still pending`)
      }
    }

    // Drain dopo 3s dal mount (non blocca il rendering)
    const t = setTimeout(drain, 3000)
    return () => clearTimeout(t)
  }, [])

  /**
   * submit — invia il record al backend.
   * Se fallisce, aggiunge alla queue locale per retry.
   */
  const submit = useCallback(async (
    record: ComplianceRecord
  ): Promise<ApiResult> => {
    console.log('[rp_compliance] Submitting:', record.compliance_id)

    const ok = await sendRecord(record)

    if (ok) {
      return { success: true, queued: false }
    }

    // Fallback: salva in queue locale
    addToQueue(record)
    return {
      success: false,
      queued:  true,
      error:   'Backend non raggiungibile. Record salvato in queue locale per retry.',
    }
  }, [])

  /**
   * submitAfterFinality — attende la finality L2 di Base (~2s)
   * poi invia il record. Chiamare subito dopo phase === 'done'.
   */
  const submitAfterFinality = useCallback(async (
    record: ComplianceRecord,
    finalityMs = 2500
  ): Promise<ApiResult> => {
    return new Promise(resolve => {
      setTimeout(async () => {
        const result = await submit(record)
        resolve(result)
      }, finalityMs)
    })
  }, [submit])

  return {
    submit,
    submitAfterFinality,
    getPendingCount: () => getQueue().length,
    clearQueue:      () => saveQueue([]),
  }
}
