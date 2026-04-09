/**
 * Test script — genera una ricevuta PDF con dati realistici.
 * Esegui: npx tsx scripts/test-receipt.ts
 */
import { generatePdfReceipt } from '../lib/usePdfReceipt'
import jsPDF from 'jspdf'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Monkey-patch jsPDF.save per Node.js (nessun browser → salva su filesystem)
jsPDF.prototype.save = function (filename: string) {
  const outPath = join(process.cwd(), filename)
  const buffer = Buffer.from(this.output('arraybuffer'))
  writeFileSync(outPath, buffer)
  console.log(`✅ PDF salvato: ${outPath}`)
}

async function main() {
  const now = new Date()

  // ── Test 1: USDC su Base (con controparte + exchange rate) ──
  await generatePdfReceipt({
    txHash: '0x8a3f1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a',
    timestamp: now.toISOString(),
    sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
    recipient: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    grossAmount: '1500.00',
    netAmount: '1492.50',
    feeAmount: '7.50',
    symbol: 'USDC',
    paymentRef: 'PAY-2026-0408-RSN001',
    fiscalRef: 'FSC-a3b8c1d4e5f6-2026',
    eurValue: '1380.00',
    network: 'Base',

    emittente: {
      legalName: 'RSend S.r.l.',
      vatNumber: 'IT12345678901',
      registeredOffice: 'Via Example 1, 55100 Lucca (LU)',
      pec: 'rsend@pec.it',
      rea: 'LU-123456',
    },

    controparte: {
      name: 'Acme Corp S.p.A.',
      vatNumber: 'IT09876543210',
    },

    exchangeRate: {
      tokenSymbol: 'USDC',
      fiatCurrency: 'EUR',
      rate: 0.92,
      source: 'CoinGecko API (coingecko.com)',
      fetchedAt: now.toISOString(),
    },
  })

  // ── Test 2: EURC su Base (nessun exchange rate) ──
  await generatePdfReceipt({
    txHash: '0x1122334455667788990011223344556677889900aabbccddeeff00112233445566',
    timestamp: now.toISOString(),
    sender: '0xAaBbCcDdEeFf00112233445566778899AaBbCcDd',
    recipient: '0x1234567890abcdef1234567890abcdef12345678',
    grossAmount: '2500.00',
    netAmount: '2487.50',
    feeAmount: '12.50',
    symbol: 'EURC',
    paymentRef: 'PAY-2026-0408-EUR002',
    fiscalRef: 'FSC-e7f8a9b0c1d2-2026',
    network: 'Base',

    emittente: {
      legalName: 'RSend S.r.l.',
      vatNumber: 'IT12345678901',
      registeredOffice: 'Via Example 1, 55100 Lucca (LU)',
      pec: 'rsend@pec.it',
    },
  })

  // ── Test 3: ETH su Ethereum (exchange rate alto) ──
  await generatePdfReceipt({
    txHash: '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    timestamp: now.toISOString(),
    sender: '0x388C818CA8B9251b393131C08a736A67ccB19297',
    recipient: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    grossAmount: '0.5000',
    netAmount: '0.4975',
    feeAmount: '0.0025',
    symbol: 'ETH',
    paymentRef: 'PAY-2026-0408-ETH003',
    fiscalRef: 'FSC-c3d4e5f6a7b8-2026',
    network: 'Ethereum',

    emittente: {
      legalName: 'RSend S.r.l.',
      vatNumber: 'IT12345678901',
      registeredOffice: 'Via Example 1, 55100 Lucca (LU)',
      pec: 'rsend@pec.it',
    },

    exchangeRate: {
      tokenSymbol: 'ETH',
      fiatCurrency: 'EUR',
      rate: 2847.32,
      source: 'CoinGecko API (coingecko.com)',
      fetchedAt: now.toISOString(),
    },
  })

  console.log('\n🎉 3 ricevute generate: USDC (Base), EURC (Base), ETH (Ethereum)')
}

main().catch(console.error)
