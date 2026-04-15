import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { sender, recipient, token, amount, sourceChainId, destChainId } = body

  // TODO: AML check tramite backend Python
  // Per ora: approva tutto (placeholder)
  const approved = true
  const riskLevel = 'LOW'

  return NextResponse.json({
    approved,
    riskLevel,
    sourceChainId,
    destChainId,
    token,
    amount,
  })
}
