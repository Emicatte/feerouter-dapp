import { idempotencyKey, parseRSendError } from './rsendFetch'

const BACKEND_URL = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'
const HMAC_SECRET = process.env.NEXT_PUBLIC_HMAC_SECRET || ''

async function computeHMAC(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface CallbackPayload {
  txHash: string
  grossStr: string
  netStr: string
  feeStr: string
  symbol: string
  recipient?: string
  paymentRef?: string
  fiscalRef?: string
  eurValue?: string
  timestamp?: string
  isTestnet?: boolean
  complianceRecord?: {
    compliance_id: string
    block_timestamp: string
    fiat_rate?: number
    asset: string
    fiat_gross?: number
    ip_jurisdiction: string
    mica_applicable: boolean
    fiscal_ref: string
    network: string
    dac8_reportable: boolean
  }
}

export function useBackendCallback() {
  return async (data: CallbackPayload) => {
    const ts = data.timestamp || new Date().toISOString()
    const grossAmount = parseFloat(data.grossStr)

    const message = `${data.fiscalRef}|${data.txHash}|${grossAmount}|${data.symbol}|${ts}`
    const signature = HMAC_SECRET
      ? await computeHMAC(HMAC_SECRET, message)
      : 'PENDING_HMAC_SHA256'

    const payload = {
      fiscal_ref: data.fiscalRef || `RP-${Date.now()}`,
      payment_ref: data.paymentRef,
      tx_hash: data.txHash,
      gross_amount: grossAmount,
      net_amount: parseFloat(data.netStr),
      fee_amount: parseFloat(data.feeStr),
      currency: data.symbol,
      eur_value: data.eurValue ? parseFloat(data.eurValue) : undefined,
      network: data.isTestnet ? 'BASE_SEPOLIA' : 'BASE_MAINNET',
      is_testnet: data.isTestnet || false,
      recipient: data.recipient,
      status: 'completed',
      timestamp: ts,
      x_signature: signature,
      compliance_record: data.complianceRecord,
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/tx/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey(),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errMsg = await parseRSendError(res)
        console.error('[RPagos Backend] Callback failed:', errMsg)
        return { success: false, error: errMsg }
      }
      const result = await res.json()
      console.log('[RPagos Backend] TX logged:', result)
      return { success: true, data: result }
    } catch (err) {
      console.error('[RPagos Backend] Network error:', err)
      return { success: false, error: err }
    }
  }
}

