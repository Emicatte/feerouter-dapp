/**
 * usePdfReceipt.ts — Generatore ricevute PDF B2B
 *
 * Libreria: jspdf (npm install jspdf)
 * Genera ricevuta professionale post-transazione con:
 *   - Header aziendale, timestamp, TX hash cliccabile
 *   - Mittente, destinatario, importo lordo, fee, netto
 *   - Riferimento fattura / ID fiscale (DAC8)
 *   - QR code link BaseScan opzionale
 */

import { jsPDF } from 'jspdf'

export interface ReceiptData {
  txHash:      string
  timestamp:   string
  sender:      string
  recipient:   string
  grossAmount: string
  netAmount:   string
  feeAmount:   string
  symbol:      string
  paymentRef:  string
  fiscalRef:   string
  eurValue?:   string
  network:     'Base Mainnet' | 'Base Sepolia'
}

export function generatePdfReceipt(data: ReceiptData): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const W  = 210
  const PINK    = [255, 0, 122]   as [number,number,number]
  const DARK    = [15,  15,  15]  as [number,number,number]
  const GRAY    = [80,  80,  80]  as [number,number,number]
  const LGRAY   = [200, 200, 200] as [number,number,number]
  const WHITE   = [255, 255, 255] as [number,number,number]
  const GREEN   = [0,   210, 106] as [number,number,number]

  // ── Background dark ────────────────────────────────────────────────────
  doc.setFillColor(...DARK)
  doc.rect(0, 0, W, 297, 'F')

  // ── Header bar ─────────────────────────────────────────────────────────
  doc.setFillColor(...PINK)
  doc.rect(0, 0, W, 32, 'F')

  doc.setTextColor(...WHITE)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('FeeRouter', 20, 15)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('B2B Payment Gateway', 20, 22)
  doc.text('base.feerouter.io', 20, 28)

  // Receipt badge
  doc.setFillColor(0, 0, 0, 0.3)
  doc.setFillColor(40, 40, 40)
  doc.roundedRect(W - 65, 8, 52, 16, 3, 3, 'F')
  doc.setTextColor(...WHITE)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('RICEVUTA', W - 56, 18)

  // ── Status badge ───────────────────────────────────────────────────────
  doc.setFillColor(...GREEN)
  doc.roundedRect(20, 40, 45, 8, 2, 2, 'F')
  doc.setTextColor(...DARK)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('✓ PAGAMENTO CONFERMATO', 23, 45.5)

  // Timestamp + Network
  doc.setTextColor(...GRAY)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(data.timestamp, W - 20, 44, { align: 'right' })
  doc.text(data.network, W - 20, 49, { align: 'right' })

  // ── Section: Parti ─────────────────────────────────────────────────────
  let y = 62

  const sectionTitle = (title: string, yPos: number) => {
    doc.setTextColor(...PINK)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.text(title.toUpperCase(), 20, yPos)
    doc.setDrawColor(...PINK)
    doc.setLineWidth(0.3)
    doc.line(20, yPos + 1.5, W - 20, yPos + 1.5)
  }

  const dataRow = (label: string, value: string, yPos: number, valueColor = WHITE) => {
    doc.setTextColor(...GRAY)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(label, 20, yPos)
    doc.setTextColor(...valueColor)
    doc.setFont('helvetica', 'bold')
    doc.text(value, W - 20, yPos, { align: 'right' })
  }

  sectionTitle('Parti Coinvolte', y)
  y += 8
  dataRow('Mittente', data.sender.slice(0,12) + '…' + data.sender.slice(-8), y)
  y += 7
  dataRow('Destinatario', data.recipient.slice(0,12) + '…' + data.recipient.slice(-8), y)
  y += 14

  // ── Section: Importi ───────────────────────────────────────────────────
  sectionTitle('Riepilogo Importi', y)
  y += 8

  dataRow('Importo Lordo', data.grossAmount + ' ' + data.symbol, y)
  if (data.eurValue) {
    doc.setTextColor(...GRAY)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text('≈ ' + data.eurValue + ' EUR', W - 20, y + 4, { align: 'right' })
    y += 4
  }
  y += 8

  // Box importo netto (evidenziato)
  doc.setFillColor(0, 50, 25)
  doc.roundedRect(18, y - 3, W - 36, 12, 2, 2, 'F')
  doc.setDrawColor(...GREEN)
  doc.setLineWidth(0.5)
  doc.roundedRect(18, y - 3, W - 36, 12, 2, 2, 'S')
  doc.setTextColor(...GRAY)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Importo Netto (99.5%)', 24, y + 3.5)
  doc.setTextColor(...GREEN)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(data.netAmount + ' ' + data.symbol, W - 24, y + 4, { align: 'right' })
  y += 17

  dataRow('Fee di Servizio (0.5%)', data.feeAmount + ' ' + data.symbol, y, [255, 157, 200])
  y += 14

  // ── Section: Riferimenti ───────────────────────────────────────────────
  sectionTitle('Riferimenti', y)
  y += 8
  if (data.paymentRef && data.paymentRef !== '—') {
    dataRow('Rif. Pagamento', data.paymentRef, y)
    y += 7
  }
  if (data.fiscalRef) {
    dataRow('ID Fiscale / Rif. Fattura', data.fiscalRef, y)
    y += 7
  }
  y += 7

  // ── TX Hash ────────────────────────────────────────────────────────────
  sectionTitle('Transazione On-Chain', y)
  y += 8
  doc.setTextColor(...GRAY)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('TX Hash:', 20, y)
  doc.setTextColor(100, 150, 255)
  doc.setFont('helvetica', 'bold')
  const txUrl = (data.network === 'Base Mainnet' ? 'https://basescan.org/tx/' : 'https://sepolia.basescan.org/tx/') + data.txHash
  doc.textWithLink(data.txHash.slice(0,32) + '…', 20, y + 6, { url: txUrl })
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(data.txHash.slice(32), 20, y + 11)
  y += 20

  // ── Footer ─────────────────────────────────────────────────────────────
  doc.setFillColor(20, 20, 20)
  doc.rect(0, 265, W, 32, 'F')

  doc.setTextColor(60, 60, 60)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('Documento generato automaticamente da FeeRouter B2B Gateway', W / 2, 272, { align: 'center' })
  doc.text('Smart Contract verificato su Base Network · Non costituisce fattura fiscale', W / 2, 278, { align: 'center' })
  doc.text('Per supporto: support@feerouter.io', W / 2, 284, { align: 'center' })

  doc.setTextColor(...GRAY)
  doc.setFontSize(8)
  doc.text('DAC8 / MiCA Ready', W / 2, 290, { align: 'center' })

  // ── Salva ──────────────────────────────────────────────────────────────
  const filename = 'ricevuta_' + (data.paymentRef || data.txHash.slice(0,8)) + '_' + Date.now() + '.pdf'
  doc.save(filename)
}
