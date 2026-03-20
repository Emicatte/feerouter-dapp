/**
 * app/api/oracle/sign/route.ts — Next.js Oracle interno
 *
 * Sostituisce il server Python esterno.
 * Firma EIP-712 OracleApproval compatibile con FeeRouterV4.sol
 *
 * Variabile d'ambiente richiesta:
 *   ORACLE_PRIVATE_KEY=0x...  (chiave privata del signer)
 *
 * POST /api/oracle/sign
 * Body: { sender, recipient, tokenIn, tokenOut, amountIn, chainId }
 *
 * Response: OracleResponse (stesso formato del backend Python)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  keccak256, encodePacked,
  encodeAbiParameters, parseAbiParameters,
  toHex, hexToBytes,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'crypto'

// ── Configurazione ─────────────────────────────────────────────────────────
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY as Hex | undefined

// Indirizzi FeeRouterV4 per chain
const ROUTER_BY_CHAIN: Record<number, string> = {
  8453:     process.env.NEXT_PUBLIC_FEE_ROUTER_V4_BASE
         ?? process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS
         ?? process.env.NEXT_PUBLIC_FEE_ROUTER_ADDRESS
         ?? '0x0000000000000000000000000000000000000000',
  84532:    process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS
         ?? process.env.NEXT_PUBLIC_FEE_ROUTER_ADDRESS
         ?? '0x0000000000000000000000000000000000000000',
  1:        process.env.NEXT_PUBLIC_FEE_ROUTER_V4_ETH
         ?? '0x0000000000000000000000000000000000000000',
}

// DAC8 soglia (1000 EUR)
const DAC8_THRESHOLD = 1000

// Mock EUR rates (produzione: Chainlink)
const EUR_RATES: Record<string, number> = {
  ETH: 2200, USDC: 0.92, USDT: 0.92, EURC: 1.0, cbBTC: 88000, WBTC: 88000, DEGEN: 0.003,
}

// AML blacklist
const BLACKLIST = new Set([
  '0x722122df12d4e14e13ac3b6895a86e84145b6967',
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
  '0xd96f2b1c14db8458374d9aca76e26c3950113463',
  '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d',
])

// ── EIP-712 helpers ────────────────────────────────────────────────────────

function computeDomainSeparator(contractAddress: string, chainId: number): Hex {
  const domainTypeHash = keccak256(
    toHex(
      'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
    )
  )
  const nameHash    = keccak256(toHex('FeeRouterV4'))
  const versionHash = keccak256(toHex('4'))

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
      [
        domainTypeHash,
        nameHash,
        versionHash,
        BigInt(chainId),
        contractAddress as Hex,
      ]
    )
  )
}

function computeStructHash(
  sender:    string,
  recipient: string,
  tokenIn:   string,
  tokenOut:  string,
  amountIn:  bigint,
  nonce:     Hex,
  deadline:  bigint,
): Hex {
  const typeHash = keccak256(
    toHex(
      'OracleApproval(address sender,address recipient,address tokenIn,address tokenOut,uint256 amountIn,bytes32 nonce,uint256 deadline)'
    )
  )

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, address, address, address, address, uint256, bytes32, uint256'),
      [
        typeHash,
        sender    as Hex,
        recipient as Hex,
        tokenIn   as Hex,
        tokenOut  as Hex,
        amountIn,
        nonce,
        deadline,
      ]
    )
  )
}

function computeDigest(domainSeparator: Hex, structHash: Hex): Hex {
  return keccak256(
    encodePacked(
      ['string', 'bytes32', 'bytes32'],
      ['\x19\x01', domainSeparator, structHash]
    )
  )
}

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // 1. Leggi body
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 })
    }

    const {
      sender,
      recipient,
      tokenIn   = '0x0000000000000000000000000000000000000000',
      tokenOut  = '0x0000000000000000000000000000000000000000',
      amountIn  = '0',
      symbol    = 'ETH',
      chainId   = 84532,
    } = body

    // 2. Validazione base
    if (!sender || !recipient) {
      return NextResponse.json({ error: 'sender e recipient obbligatori' }, { status: 400 })
    }
    if (!ORACLE_PRIVATE_KEY) {
      return NextResponse.json({
        approved: false,
        error:    'ORACLE_PRIVATE_KEY non configurata. Aggiungi la variabile d\'ambiente.',
        riskLevel: 'BLOCKED',
        rejectionReason: 'Servizio Oracle non configurato.',
      }, { status: 503 })
    }

    const senderNorm    = sender.toLowerCase()
    const recipientNorm = recipient.toLowerCase()

    // 3. AML check
    if (BLACKLIST.has(senderNorm) || BLACKLIST.has(recipientNorm)) {
      return NextResponse.json({
        approved:        false,
        oracleSignature: '0x',
        oracleNonce:     '0x' + '0'.repeat(64),
        oracleDeadline:  0,
        paymentRef:      '0x' + '0'.repeat(64),
        fiscalRef:       '0x' + '0'.repeat(64),
        riskScore:       100,
        riskLevel:       'BLOCKED',
        jurisdiction:    'BLOCKED',
        dac8Reportable:  false,
        rejectionReason: 'Transazione negata per policy di conformità AML.',
      })
    }

    // 4. Risk score semplice (volume-based)
    const eurValue    = parseFloat(amountIn) * (EUR_RATES[symbol?.toUpperCase()] ?? 1)
    let   riskScore   = 5
    if (eurValue > 50_000) riskScore = 35
    else if (eurValue > 10_000) riskScore = 20
    else if (eurValue > 5_000)  riskScore = 10
    const riskLevel   = riskScore >= 80 ? 'BLOCKED' : riskScore >= 60 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW'
    const dac8        = eurValue > DAC8_THRESHOLD

    // 5. Genera nonce + deadline
    const nonceBytes  = randomBytes(32)
    const nonce       = ('0x' + nonceBytes.toString('hex')) as Hex
    const deadline    = BigInt(Math.floor(Date.now() / 1000) + 120) // 2 minuti

    // 6. paymentRef e fiscalRef (hash deterministici)
    const paymentRef  = keccak256(toHex(`PAY-${Date.now()}-${Math.random()}`))
    const fiscalRef   = keccak256(toHex(`FISCAL-${symbol}-${Date.now()}`))

    // 7. Calcola amountIn in wei (approssimato — usato solo per la firma)
    const decMap: Record<string, number> = {
      ETH: 18, USDC: 6, USDT: 6, EURC: 6, cbBTC: 8, WBTC: 8, DEGEN: 18,
    }
    const decimals     = decMap[symbol?.toUpperCase()] ?? 18
    const amountInWei  = BigInt(
      Math.floor(parseFloat(amountIn || '0') * 10 ** Math.min(decimals, 15))
    ) * BigInt(10 ** Math.max(0, decimals - 15))

    // 8. Indirizzo router per chain
    const contractAddress = ROUTER_BY_CHAIN[chainId] ?? '0x0000000000000000000000000000000000000000'

    // 9. Calcola digest EIP-712
    const domainSep  = computeDomainSeparator(contractAddress, chainId)
    const structHash = computeStructHash(
      senderNorm,
      recipientNorm,
      tokenIn.toLowerCase(),
      tokenOut.toLowerCase(),
      amountInWei,
      nonce,
      deadline,
    )
    const digest = computeDigest(domainSep, structHash)

    // 10. Firma con la chiave privata Oracle
    const account   = privateKeyToAccount(ORACLE_PRIVATE_KEY)
    const signature = await account.signMessage({
      message: { raw: hexToBytes(digest) },
    })

    // 11. Risposta — stesso formato del backend Python
    return NextResponse.json({
      approved:        true,
      oracleSignature: signature,
      oracleNonce:     nonce,
      oracleDeadline:  Number(deadline),
      paymentRef,
      fiscalRef,
      riskScore,
      riskLevel,
      jurisdiction:    'EU_UNKNOWN',
      dac8Reportable:  dac8,
      eurValue:        Math.round(eurValue * 100) / 100,
      isEurc:          symbol?.toUpperCase() === 'EURC',
      isSwap:          tokenIn.toLowerCase() !== tokenOut.toLowerCase(),
      sourceChain:     chainId === 8453 ? 'BASE' : chainId === 1 ? 'ETHEREUM' : 'BASE_SEPOLIA',
      gasless:         chainId !== 1,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[oracle/sign] error:', message)
    return NextResponse.json({
      approved:        false,
      error:           message,
      riskLevel:       'BLOCKED',
      rejectionReason: 'Errore interno Oracle. Riprova tra qualche secondo.',
    }, { status: 500 })
  }
}

// GET — health check
export async function GET() {
  const account = ORACLE_PRIVATE_KEY
    ? privateKeyToAccount(ORACLE_PRIVATE_KEY as Hex)
    : null

  return NextResponse.json({
    status:        'online',
    version:       '4.0.0-internal',
    signerAddress: account?.address ?? 'NOT_CONFIGURED',
    configured:    !!ORACLE_PRIVATE_KEY,
    chains:        Object.keys(ROUTER_BY_CHAIN).map(Number),
  })
}
