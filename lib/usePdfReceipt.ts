
import jsPDF from 'jspdf'

export interface PdfReceiptParams {
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
  network:     string
}

export function generatePdfReceipt(p: PdfReceiptParams): void {
  const doc  = new jsPDF({ unit: 'mm', format: 'a4' })
  const isEurc = p.symbol.toUpperCase() === 'EURC'

  // ── Colori ────────────────────────────────────────────────────────────
  const C = {
    bg:     [8,   8,   16]  as [number,number,number],
    card:   [17,  17,  32]  as [number,number,number],
    em:     [0,   255, 163] as [number,number,number],
    emDark: [0,   180, 120] as [number,number,number],
    text:   [226, 226, 240] as [number,number,number],
    muted:  [74,  74,  106] as [number,number,number],
    border: [40,  40,  60]  as [number,number,number],
    euBlue: [0,   51,  153] as [number,number,number],
    euGold: [255, 204, 0]   as [number,number,number],
  }

  const W = 210, H = 297
  const margin = 15

  // ── Background ─────────────────────────────────────────────────────────
  doc.setFillColor(...C.bg)
  doc.rect(0, 0, W, H, 'F')

  // ── Header band ────────────────────────────────────────────────────────
  doc.setFillColor(...C.card)
  doc.rect(0, 0, W, 45, 'F')

  // Accent line
  doc.setFillColor(...C.em)
  doc.rect(0, 0, W, 1.5, 'F')

  // ── Logo / Brand ───────────────────────────────────────────────────────
  doc.setTextColor(...C.em)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('RPagos', margin, 20)

  doc.setTextColor(...C.muted)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Gateway di Pagamento B2B su Base Network', margin, 27)

  // EURC badge nell'header se applicabile
  if (isEurc) {
    doc.setFillColor(...C.euBlue)
    doc.roundedRect(W - margin - 52, 10, 52, 14, 3, 3, 'F')
    doc.setFillColor(...C.euGold)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text('★ EURC · Euro Stablecoin', W - margin - 49, 19)
  }

  // Titolo ricevuta
  doc.setTextColor(...C.text)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  const receiptTitle = isEurc
    ? 'Ricevuta Fiscale Europea — ERC-20 Euro'
    : 'Ricevuta di Pagamento On-Chain'
  doc.text(receiptTitle, margin, 38)

  // ── Metadata row ───────────────────────────────────────────────────────
  let y = 56
  doc.setFontSize(8)
  doc.setTextColor(...C.muted)
  doc.setFont('courier', 'normal')

  const meta = [
    ['DATA',    new Date(p.timestamp).toLocaleString('it-IT')],
    ['NETWORK', p.network],
    ['TX HASH', p.txHash.slice(0, 24) + '…' + p.txHash.slice(-8)],
  ]
  meta.forEach(([label, val], i) => {
    const x = margin + i * 62
    doc.setTextColor(...C.muted)
    doc.text(label, x, y)
    doc.setTextColor(...C.text)
    doc.text(val, x, y + 5)
  })

  // ── Divider ────────────────────────────────────────────────────────────
  y += 14
  doc.setDrawColor(...C.border)
  doc.setLineWidth(0.3)
  doc.line(margin, y, W - margin, y)
  y += 8

  // ── Importi principali ─────────────────────────────────────────────────
  doc.setFillColor(...C.card)
  doc.roundedRect(margin, y, W - margin * 2, 36, 4, 4, 'F')
  doc.setDrawColor(...C.em)
  doc.setLineWidth(0.4)
  doc.roundedRect(margin, y, W - margin * 2, 36, 4, 4, 'S')

  // Label importo
  const amtLabel = isEurc ? 'IMPORTO LORDO (EUR)' : `IMPORTO LORDO (${p.symbol})`
  doc.setFontSize(8)
  doc.setTextColor(...C.muted)
  doc.setFont('courier', 'normal')
  doc.text(amtLabel, margin + 6, y + 8)

  // Valore lordo
  const grossDisplay = isEurc
    ? `€ ${p.grossAmount}`
    : `${p.grossAmount} ${p.symbol}`
  doc.setFontSize(24)
  doc.setTextColor(...C.em)
  doc.setFont('helvetica', 'bold')
  doc.text(grossDisplay, margin + 6, y + 22)

  // EUR controvalore (solo se non EURC)
  if (!isEurc && p.eurValue) {
    doc.setFontSize(11)
    doc.setTextColor(...C.muted)
    doc.setFont('helvetica', 'normal')
    doc.text(`≈ ${p.eurValue}`, W - margin - 6, y + 22, { align: 'right' })
  }

  // Nota EURC standard UE
  if (isEurc) {
    doc.setFontSize(7)
    doc.setTextColor(...C.muted)
    doc.setFont('courier', 'normal')
    doc.text('Valuta di Riferimento: EUR (EURC on Base) — Dir. 2013/34/UE', margin + 6, y + 30)
  }

  y += 44

  // ── Split breakdown ────────────────────────────────────────────────────
  doc.setFontSize(9)
  doc.setFont('courier', 'normal')

  const splitRows = [
    { label: isEurc ? 'Importo Netto (99.5%)' : `Importo Netto (99.5%)`, value: isEurc ? `€ ${p.netAmount}` : `${p.netAmount} ${p.symbol}`, highlight: true  },
    { label: 'Commissione Gateway (0.5%)',                                value: isEurc ? `€ ${p.feeAmount}` : `${p.feeAmount} ${p.symbol}`, highlight: false },
    { label: 'Tipo',                                                      value: isEurc ? 'Euro Stablecoin (ERC-20 su Base)' : `Cripto Asset (${p.symbol} su Base)`, highlight: false },
  ]

  splitRows.forEach((row, i) => {
    const rowY = y + i * 12
    doc.setFillColor(...C.card)
    doc.rect(margin, rowY, W - margin * 2, 10, 'F')

    doc.setTextColor(...C.muted)
    doc.setFontSize(8)
    doc.text(row.label, margin + 4, rowY + 6.5)

    doc.setTextColor(row.highlight ? C.em[0] : C.text[0], row.highlight ? C.em[1] : C.text[1], row.highlight ? C.em[2] : C.text[2])
    doc.setFont(row.highlight ? 'helvetica' : 'courier', row.highlight ? 'bold' : 'normal')
    doc.setFontSize(row.highlight ? 9 : 8)
    doc.text(row.value, W - margin - 4, rowY + 6.5, { align: 'right' })
  })

  y += splitRows.length * 12 + 8

  // ── Indirizzi ──────────────────────────────────────────────────────────
  doc.setDrawColor(...C.border)
  doc.line(margin, y, W - margin, y)
  y += 6

  const addrRows = [
    ['MITTENTE (SENDER)',     p.sender],
    ['DESTINATARIO (RECIPIENT)', p.recipient],
  ]
  addrRows.forEach(([label, addr]) => {
    doc.setTextColor(...C.muted)
    doc.setFontSize(7)
    doc.setFont('courier', 'normal')
    doc.text(label, margin, y)
    doc.setTextColor(...C.text)
    doc.setFontSize(8)
    doc.text(addr, margin, y + 5)
    y += 13
  })

  // ── Riferimenti DAC8 ───────────────────────────────────────────────────
  doc.setDrawColor(...C.border)
  doc.line(margin, y, W - margin, y)
  y += 6

  doc.setFillColor(...C.card)
  doc.roundedRect(margin, y, W - margin * 2, 30, 3, 3, 'F')

  doc.setFontSize(8)
  doc.setFont('courier', 'bold')
  doc.setTextColor(...C.em)
  doc.text('DATI FISCALI (DAC8 / MiCA)', margin + 4, y + 7)

  const dac8Rows = [
    ['payment_ref', p.paymentRef],
    ['fiscal_ref',  p.fiscalRef ],
  ]
  dac8Rows.forEach(([k, v], i) => {
    doc.setFont('courier', 'normal')
    doc.setTextColor(...C.muted)
    doc.setFontSize(7)
    doc.text(k, margin + 4, y + 14 + i * 8)
    doc.setTextColor(...C.text)
    doc.text(v.slice(0, 60), margin + 34, y + 14 + i * 8)
  })

  y += 38

  // ── EURC European Standards Note ──────────────────────────────────────
  if (isEurc) {
    doc.setFillColor(0, 51, 153)
    doc.roundedRect(margin, y, W - margin * 2, 22, 3, 3, 'F')

    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 204, 0)
    doc.text('★  RICEVUTA CONFORME AGLI STANDARD CONTABILI UE', margin + 4, y + 7)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(200, 210, 255)
    doc.text('Emessa ai sensi della Dir. 2013/34/UE (Contabilità) · Reg. UE 2023/1114 (MiCA) · Dir. 2011/16/UE (DAC8)', margin + 4, y + 13)
    doc.text(`Valuta ufficiale: EUR · Token: EURC (Circle) su Base Network · Nessuna conversione FX applicata`, margin + 4, y + 19)

    y += 28
  }

  // ── QR placeholder (URL BaseScan) ─────────────────────────────────────
  const basescanUrl = p.network.includes('Sepolia')
    ? `https://sepolia.basescan.org/tx/${p.txHash}`
    : `https://basescan.org/tx/${p.txHash}`

  doc.setFontSize(7)
  doc.setFont('courier', 'normal')
  doc.setTextColor(...C.muted)
  doc.text('Verifica on-chain:', margin, y + 6)
  doc.setTextColor(...C.em)
  doc.text(basescanUrl, margin, y + 12)

  // ── Footer ─────────────────────────────────────────────────────────────
  doc.setFillColor(...C.card)
  doc.rect(0, H - 18, W, 18, 'F')
  doc.setFillColor(...C.em)
  doc.rect(0, H - 18, W, 0.5, 'F')

  doc.setFontSize(7)
  doc.setFont('courier', 'normal')
  doc.setTextColor(...C.muted)
  doc.text('RPagos · Gateway VASP su Base Network · rpagos.com', margin, H - 10)
  doc.text(`Generata: ${new Date().toLocaleString('it-IT')}`, W - margin, H - 10, { align: 'right' })

  // ── Salva ──────────────────────────────────────────────────────────────
  const filename = isEurc
    ? `RPagos_EURC_${p.txHash.slice(2, 10)}.pdf`
    : `RPagos_${p.symbol}_${p.txHash.slice(2, 10)}.pdf`

  doc.save(filename)
}
