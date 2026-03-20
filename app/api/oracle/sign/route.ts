/**
 * app/api/oracle/sign/route.ts — Oracle EIP-712 interno
 *
 * FIX CRITICO: signMessage() aggiunge il prefisso Ethereum (\x19Ethereum Signed Message\n32)
 * sopra al digest EIP-712 che ha già \x19\x01 → doppio prefisso → firma sbagliata
 * → contratto recupera address(0) → MetaMask dice "burn address"
 *
 * SOLUZIONE: account.sign({ hash: digest }) firma il raw hash senza prefissi aggiuntivi,
 * esattamente come ECDSA.recover(digest, sig) nel contratto Solidity.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  parseUnits,
  parseEther,
  toHex,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'crypto'

// ── Config ─────────────────────────────────────────────────────────────────
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY as Hex | undefined

const ROUTER_BY_CHAIN: Record<number, `0x${string}`> = {
  8453:  (process.env.NEXT_PUBLIC_FEE_ROUTER_V4_BASE
       ?? process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS
       ?? process.env.NEXT_PUBLIC_FEE_ROUTER_ADDRESS
       ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  84532: (process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS
       ?? process.env.NEXT_PUBLIC_FEE_ROUTER_ADDRESS
       ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  1:     (process.env.NEXT_PUBLIC_FEE_ROUTER_V4_ETH
       ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
}

const EUR_RATES: Record<string, number> = {
  ETH: 2200, USDC: 0.92, USDT: 0.92, EURC: 1.0, cbBTC: 88000, WBTC: 88000, DEGEN: 0.003,
}

const DECIMALS_MAP: Record<string, number> = {
  ETH: 18, USDC: 6, USDT: 6, EURC: 6, CBBTC: 8, WBTC: 8, DEGEN: 18,
}

const BLACKLIST = new Set([
  '0x722122df12d4e14e13ac3b6895a86e84145b6967',
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
  '0xd96f2b1c14db8458374d9aca76e26c3950113463',
  '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d',
])

// ── EIP-712 — identico al contratto Solidity ────────────────────────────────
//
// Solidity:
//   keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
//   keccak256(bytes("FeeRouterV4"))
//   keccak256(bytes("4"))
//
// keccak256(abi.encode(domainTypeHash, nameHash, versionHash, chainId, address(this)))

function domainSeparator(contractAddress: `0x${string}`, chainId: number): Hex {
  const domainTypeHash = keccak256(toHex(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
  ))
  const nameHash    = keccak256(toHex('FeeRouterV4'))
  const versionHash = keccak256(toHex('4'))

  return keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
    [domainTypeHash, nameHash, versionHash, BigInt(chainId), contractAddress]
  ))
}

// Solidity:
//   keccak256("OracleApproval(address sender,address recipient,address tokenIn,address tokenOut,uint256 amountIn,bytes32 nonce,uint256 deadline)")
//   keccak256(abi.encode(TYPEHASH, sender, recipient, tokenIn, tokenOut, amountIn, nonce, deadline))

function structHash(
  sender:    `0x${string}`,
  recipient: `0x${string}`,
  tokenIn:   `0x${string}`,
  tokenOut:  `0x${string}`,
  amountIn:  bigint,
  nonce:     Hex,
  deadline:  bigint,
): Hex {
  const typeHash = keccak256(toHex(
    'OracleApproval(address sender,address recipient,address tokenIn,address tokenOut,uint256 amountIn,bytes32 nonce,uint256 deadline)'
  ))

  return keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32, address, address, address, address, uint256, bytes32, uint256'),
    [typeHash, sender, recipient, tokenIn, tokenOut, amountIn, nonce, deadline]
  ))
}

// Solidity: keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
function eip712Digest(ds: Hex, sh: Hex): Hex {
  return keccak256(encodePacked(
    ['bytes2', 'bytes32', 'bytes32'],
    ['0x1901', ds, sh]
  ))
}

// ── POST ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 })

    const {
      sender,
      recipient,
      tokenIn     = '0x0000000000000000000000000000000000000000',
      tokenOut    = '0x0000000000000000000000000000000000000000',
      amountIn    = '0',    // formatted string es. "0.001"
      amountInWei,          // wei string — priorità su amountIn
      symbol      = 'ETH',
      chainId     = 84532,
    } = body

    if (!sender || !recipient) {
      return NextResponse.json({ error: 'sender e recipient obbligatori' }, { status: 400 })
    }

    if (!ORACLE_PRIVATE_KEY) {
      return NextResponse.json({
        approved:        false,
        riskLevel:       'BLOCKED',
        rejectionReason: 'Servizio Oracle non configurato. Aggiungi ORACLE_PRIVATE_KEY.',
      }, { status: 503 })
    }

    const senderN    = sender.toLowerCase()    as `0x${string}`
    const recipientN = recipient.toLowerCase() as `0x${string}`
    const tokenInN   = tokenIn.toLowerCase()   as `0x${string}`
    const tokenOutN  = tokenOut.toLowerCase()  as `0x${string}`
    const symUpper   = (symbol as string).toUpperCase()

    // AML check
    if (BLACKLIST.has(senderN) || BLACKLIST.has(recipientN)) {
      return NextResponse.json({
        approved: false, oracleSignature: '0x',
        oracleNonce: ('0x' + '0'.repeat(64)) as Hex,
        oracleDeadline: 0, paymentRef: '0x', fiscalRef: '0x',
        riskScore: 100, riskLevel: 'BLOCKED', jurisdiction: 'BLOCKED',
        dac8Reportable: false,
        rejectionReason: 'Transazione negata per policy di conformità AML.',
      })
    }

    // Risk score
    const eurRate  = EUR_RATES[symUpper] ?? 1
    const eurValue = parseFloat(amountIn) * eurRate
    let riskScore  = 5
    if (eurValue > 50_000) riskScore = 35
    else if (eurValue > 10_000) riskScore = 20
    else if (eurValue > 5_000)  riskScore = 10
    const riskLevel   = riskScore >= 80 ? 'BLOCKED' : riskScore >= 60 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW'
    const dac8        = eurValue > 1000

    // Nonce: bytes32 casuale
    const nonce = ('0x' + randomBytes(32).toString('hex')) as Hex

    // Deadline: ora + 20 minuti (1200 secondi)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

    // paymentRef + fiscalRef
    const paymentRef = keccak256(toHex(`PAY-${Date.now()}-${randomBytes(4).toString('hex')}`))
    const fiscalRef  = keccak256(toHex(`FISCAL-${symUpper}-${Date.now()}`))

    // amountIn in wei — usa amountInWei dal frontend se disponibile (già in wei esatti)
    let amountWei: bigint
    if (amountInWei && amountInWei !== '0') {
      amountWei = BigInt(amountInWei)
    } else {
      const dec = DECIMALS_MAP[symUpper] ?? 18
      try {
        amountWei = dec === 18
          ? parseEther(amountIn || '0')
          : parseUnits(amountIn || '0', dec)
      } catch {
        amountWei = 0n
      }
    }

    // Indirizzo contratto per chain
    const contractAddr = ROUTER_BY_CHAIN[chainId as number]
      ?? '0x0000000000000000000000000000000000000000' as `0x${string}`

    console.log('[oracle/sign] →', {
      chainId, contractAddr,
      sender: senderN, recipient: recipientN,
      tokenIn: tokenInN, tokenOut: tokenOutN,
      amountWei: amountWei.toString(), nonce, deadline: deadline.toString(),
    })

    // EIP-712
    const ds = domainSeparator(contractAddr, chainId as number)
    const sh = structHash(senderN, recipientN, tokenInN, tokenOutN, amountWei, nonce, deadline)
    const digest = eip712Digest(ds, sh)

    // ── FIRMA RAW — senza prefisso Ethereum ──────────────────────────────
    // account.sign({ hash }) è equivalente a secp256k1.sign(digest)
    // → ECDSA.recover(digest, sig) nel contratto recupera l'indirizzo corretto
    // ❌ NON usare signMessage() → aggiunge \x19Ethereum Signed Message\n32
    const account   = privateKeyToAccount(ORACLE_PRIVATE_KEY)
    const sigResult = await account.sign({ hash: digest })

    console.log('[oracle/sign] ✅ signed:', { signer: account.address, sig: sigResult.slice(0,20)+'...' })

    return NextResponse.json({
      approved:        true,
      oracleSignature: sigResult,
      oracleNonce:     nonce,
      oracleDeadline:  Number(deadline),
      paymentRef,
      fiscalRef,
      riskScore,
      riskLevel,
      jurisdiction:    'EU_UNKNOWN',
      dac8Reportable:  dac8,
      eurValue:        Math.round(eurValue * 100) / 100,
      isEurc:          symUpper === 'EURC',
      isSwap:          tokenInN !== tokenOutN,
      sourceChain:     chainId === 8453 ? 'BASE' : chainId === 1 ? 'ETHEREUM' : 'BASE_SEPOLIA',
      gasless:         chainId !== 1,
      debug: {
        contractAddr,
        amountWei: amountWei.toString(),
        signer: account.address,
      },
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[oracle/sign] ❌ error:', message)
    return NextResponse.json({
      approved:        false,
      error:           message,
      riskLevel:       'BLOCKED',
      rejectionReason: 'Errore interno Oracle: ' + message.slice(0, 80),
    }, { status: 500 })
  }
}

// GET — health check + debug
export async function GET() {
  const account = ORACLE_PRIVATE_KEY
    ? privateKeyToAccount(ORACLE_PRIVATE_KEY as Hex)
    : null

  return NextResponse.json({
    status:        'online',
    version:       '4.1.0',
    signerAddress: account?.address ?? 'NOT_CONFIGURED',
    configured:    !!ORACLE_PRIVATE_KEY,
    routers:       ROUTER_BY_CHAIN,
    note:          'Usa account.sign({hash}) per firma EIP-712 raw (no prefisso Ethereum)',
  })
}