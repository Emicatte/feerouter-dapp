import { NextRequest, NextResponse }  from 'next/server'
import {
  keccak256, toHex, type Hex,
  recoverTypedDataAddress,           // ← self-verifica firma
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes }         from 'crypto'

// ── Config ─────────────────────────────────────────────────────────────────
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY as Hex | undefined

// Legge l'indirizzo del contratto per chain al momento della richiesta
// (NON a module-load time — evita il problema "env var non letta nel build")
// ⚠️  Aggiunto NEXT_PUBLIC_FEE_ROUTER_V4_ADDRESS come fallback — è il nome
//     usato su Vercel quando non si specifica la chain nel nome della var
function routerForChain(chainId: number): `0x${string}` {
  const e = (k: string) => process.env[k]
  switch (chainId) {
    case 8453:
      return (
        e('NEXT_PUBLIC_FEE_ROUTER_V4_BASE') ??
        e('NEXT_PUBLIC_FEE_ROUTER_V4_ADDRESS') ??
        e('NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS') ??
        e('NEXT_PUBLIC_FEE_ROUTER_ADDRESS') ??
        '0x0000000000000000000000000000000000000000'
      ) as `0x${string}`
    case 84532:
      return (
        e('NEXT_PUBLIC_FEE_ROUTER_V4_BASE_SEPOLIA') ??
        e('NEXT_PUBLIC_FEE_ROUTER_V4_ADDRESS') ??
        e('NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS') ??
        e('NEXT_PUBLIC_FEE_ROUTER_ADDRESS') ??
        '0x0000000000000000000000000000000000000000'
      ) as `0x${string}`
    case 1:
      return (
        e('NEXT_PUBLIC_FEE_ROUTER_V4_ETH') ??
        '0x0000000000000000000000000000000000000000'
      ) as `0x${string}`
    default:
      return '0x0000000000000000000000000000000000000000'
  }
}

const EUR_RATES: Record<string, number> = {
  ETH: 2200, USDC: 0.92, USDT: 0.92, EURC: 1.0,
  CBBTC: 88000, WBTC: 88000, DEGEN: 0.003,
}

const BLACKLIST = new Set([
  '0x722122df12d4e14e13ac3b6895a86e84145b6967',
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
  '0xd96f2b1c14db8458374d9aca76e26c3950113463',
  '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d',
])

// ── EIP-712 types — identici al contratto FeeRouterV4.sol ─────────────────
const ORACLE_TYPES = {
  OracleApproval: [
    { name: 'sender',    type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'tokenIn',   type: 'address' },
    { name: 'tokenOut',  type: 'address' },
    { name: 'amountIn',  type: 'uint256' },
    { name: 'nonce',     type: 'bytes32' },
    { name: 'deadline',  type: 'uint256' },
  ],
} as const

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
      amountInWei,        // ← WEI ESATTI dal frontend — r.toString()
      amountIn    = '0',  // solo per calcolo EUR
      symbol      = 'ETH',
      chainId     = 84532,
    } = body

    if (!sender || !recipient) {
      return NextResponse.json({ error: 'sender e recipient obbligatori' }, { status: 400 })
    }
    if (!amountInWei || amountInWei === '0') {
      return NextResponse.json({ error: 'amountInWei obbligatorio e > 0' }, { status: 400 })
    }
    if (!ORACLE_PRIVATE_KEY) {
      return NextResponse.json({
        approved:        false,
        riskLevel:       'BLOCKED',
        rejectionReason: 'Servizio Oracle non configurato. Aggiungi ORACLE_PRIVATE_KEY su Vercel.',
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

    // Risk score (float OK — non entra nella firma)
    const eurRate  = EUR_RATES[symUpper] ?? 1
    const eurValue = parseFloat(amountIn) * eurRate
    let riskScore  = 5
    if (eurValue > 50_000) riskScore = 35
    else if (eurValue > 10_000) riskScore = 20
    else if (eurValue > 5_000)  riskScore = 10
    const riskLevel = riskScore >= 80 ? 'BLOCKED' : riskScore >= 60 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW'

    // amountWei — SOLO BigInt(amountInWei), zero float
    let amountWei: bigint
    try { amountWei = BigInt(amountInWei) }
    catch { return NextResponse.json({ error: `amountInWei non valido: ${amountInWei}` }, { status: 400 }) }

    // Nonce: bytes32 (0x + 64 hex = 66 chars totali)
    const nonce    = ('0x' + randomBytes(32).toString('hex')) as Hex
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

    const paymentRef = keccak256(toHex(`PAY-${Date.now()}-${randomBytes(4).toString('hex')}`))
    const fiscalRef  = keccak256(toHex(`FISCAL-${symUpper}-${Date.now()}`))

    // Contratto — letto ORA (non a build time)
    const contractAddr = routerForChain(Number(chainId))

    // ── GUARD: contratto non configurato ──────────────────────────────────
    const ZERO = '0x0000000000000000000000000000000000000000'
    if (contractAddr === ZERO) {
      return NextResponse.json({
        approved:        false,
        riskLevel:       'BLOCKED',
        rejectionReason: `Contratto FeeRouter non deployato su chainId=${chainId}. Aggiungi la env var corretta su Vercel.`,
        _debug: { chainId, contractAddr, note: 'env var mancante o zero address' },
      }, { status: 503 })
    }

    const account = privateKeyToAccount(ORACLE_PRIVATE_KEY)

    // ── Dominio EIP-712 ───────────────────────────────────────────────────
    const domain = {
      name:              'FeeRouterV4' as const,
      version:           '4'           as const,
      chainId:           Number(chainId),
      verifyingContract: contractAddr,
    }

    const message = {
      sender:    senderN,
      recipient: recipientN,
      tokenIn:   tokenInN,
      tokenOut:  tokenOutN,
      amountIn:  amountWei,
      nonce,
      deadline,
    }

    console.log('\n[oracle/sign] ═══ FIRMA ═══')
    console.log('  domain:     ', JSON.stringify({ ...domain, chainId: domain.chainId }))
    console.log('  sender:     ', senderN)
    console.log('  recipient:  ', recipientN)
    console.log('  tokenIn:    ', tokenInN)
    console.log('  tokenOut:   ', tokenOutN)
    console.log('  amountWei:  ', amountWei.toString())
    console.log('  nonce:      ', nonce)
    console.log('  deadline:   ', deadline.toString())
    console.log('  signerAddr: ', account.address)
    console.log('[oracle/sign] ════════════\n')

    // ── Firma EIP-712 ─────────────────────────────────────────────────────
    const signature = await account.signTypedData({
      domain, types: ORACLE_TYPES, primaryType: 'OracleApproval', message,
    })

    // ── SELF-VERIFICA ─────────────────────────────────────────────────────
    const recovered = await recoverTypedDataAddress({
      domain, types: ORACLE_TYPES, primaryType: 'OracleApproval',
      message, signature,
    })

    if (recovered.toLowerCase() !== account.address.toLowerCase()) {
      console.error('[oracle/sign] ❌ SELF-VERIFICA FALLITA')
      console.error('  recovered: ', recovered)
      console.error('  expected:  ', account.address)
      return NextResponse.json({
        approved:        false,
        riskLevel:       'BLOCKED',
        rejectionReason: 'Errore interno: firma non verificabile. Contatta il supporto.',
        _debug: { recovered, expected: account.address },
      }, { status: 500 })
    }

    console.log('[oracle/sign] ✅ self-verifica OK — recovered:', recovered)

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
      dac8Reportable:  eurValue > 1000,
      eurValue:        Math.round(eurValue * 100) / 100,
      isEurc:          symUpper === 'EURC',
      isSwap:          tokenInN !== tokenOutN,
      sourceChain:     Number(chainId) === 8453 ? 'BASE' : Number(chainId) === 1 ? 'ETHEREUM' : 'BASE_SEPOLIA',
      gasless:         Number(chainId) !== 1,
      _debug: {
        contractAddr,
        amountWei: amountWei.toString(),
        signer:    account.address,
        recovered,
        chainId:   Number(chainId),
      },
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[oracle/sign] ❌ error:', message)
    return NextResponse.json({
      approved:        false,
      error:           message,
      riskLevel:       'BLOCKED',
      rejectionReason: 'Errore interno Oracle: ' + message.slice(0, 100),
    }, { status: 500 })
  }
}

// ── GET — health check ──────────────────────────────────────────────────────
export async function GET() {
  const account = ORACLE_PRIVATE_KEY
    ? privateKeyToAccount(ORACLE_PRIVATE_KEY as Hex)
    : null

  // Mostra i router letti NOW (non da build cache)
  const routers = {
    8453:     routerForChain(8453),
    84532:    routerForChain(84532),
    1:        routerForChain(1),
  }

  // ── Debug: verifica dominio EIP-712 ────────────────────────────────────
  const { keccak256: k256, encodeAbiParameters, parseAbiParameters } = await import('viem')
  function computeDomainHash(name: string, version: string, chainId: number, verifyingContract: string): string {
    try {
      const encoded = encodeAbiParameters(
        parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
        [
          k256(new TextEncoder().encode('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
          k256(new TextEncoder().encode(name)),
          k256(new TextEncoder().encode(version)),
          BigInt(chainId),
          verifyingContract as `0x${string}`,
        ]
      )
      return k256(encoded)
    } catch { return 'errore calcolo' }
  }

  const domainDebug = {
    84532: routers[84532] !== '0x0000000000000000000000000000000000000000'
      ? computeDomainHash('FeeRouterV4', '4', 84532, routers[84532])
      : 'N/A — contratto non configurato',
    8453: routers[8453] !== '0x0000000000000000000000000000000000000000'
      ? computeDomainHash('FeeRouterV4', '4', 8453, routers[8453])
      : 'N/A — contratto non configurato',
  }

  return NextResponse.json({
    status:        'online',
    version:       '4.6.0',
    configured:    !!ORACLE_PRIVATE_KEY,
    signerAddress: account?.address ?? 'NOT_CONFIGURED — aggiungi ORACLE_PRIVATE_KEY',
    routers,
    domainSeparatorHash: domainDebug,
    checklist: {
      '1_signer_match': {
        istruzione: 'signerAddress sopra deve essere IDENTICO a oracleSigner() sul contratto deployato',
        comeVerificare: 'Basescan Sepolia → indirizzo contratto → Read Contract → oracleSigner()',
        seDiseguali: 'Correggi ORACLE_PRIVATE_KEY su Vercel — usa la chiave privata del wallet impostato come oracleSigner nel costruttore',
      },
      '2_router_address': {
        istruzione: 'routers[84532] sopra deve = indirizzo contratto FeeRouterV4 su Base Sepolia',
        seZeroAddress: 'Aggiungi NEXT_PUBLIC_FEE_ROUTER_V4_BASE_SEPOLIA su Vercel con l\'indirizzo del contratto e RIDEPLOYA',
        nota: 'La env var NEXT_PUBLIC_* è baked-in al build — serve rebuild dopo ogni modifica',
      },
      '3_domain_separator': {
        istruzione: 'domainSeparatorHash[84532] sopra deve = domainSeparator() sul contratto',
        comeVerificare: 'Basescan Sepolia → contratto → Read Contract → domainSeparator()',
        seDiseguali: 'Verifica che name="FeeRouterV4" e version="4" nel costruttore del contratto deployato',
      },
    },
    // ── Debug env vars (valori mascherati per sicurezza) ────────────────
    envDebug: {
      NEXT_PUBLIC_FEE_ROUTER_V4_BASE_SEPOLIA: process.env.NEXT_PUBLIC_FEE_ROUTER_V4_BASE_SEPOLIA ? '✅ SET' : '❌ MISSING',
      NEXT_PUBLIC_FEE_ROUTER_V4_BASE:         process.env.NEXT_PUBLIC_FEE_ROUTER_V4_BASE         ? '✅ SET' : '❌ MISSING',
      NEXT_PUBLIC_FEE_ROUTER_V4_ADDRESS:      process.env.NEXT_PUBLIC_FEE_ROUTER_V4_ADDRESS      ? '✅ SET' : '❌ MISSING',
      NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS:      process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS      ? '✅ SET' : '❌ MISSING',
      NEXT_PUBLIC_FEE_ROUTER_ADDRESS:         process.env.NEXT_PUBLIC_FEE_ROUTER_ADDRESS         ? '✅ SET' : '❌ MISSING',
      ORACLE_PRIVATE_KEY:                     process.env.ORACLE_PRIVATE_KEY                     ? '✅ SET' : '❌ MISSING',
    },
  })
}