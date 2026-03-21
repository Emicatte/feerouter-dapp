import { createPublicClient, http, parseAbi, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'

function loadEnv(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  } catch {}
}
loadEnv('.env.local')
loadEnv('.env')

const CONTRACT = (
  process.env.NEXT_PUBLIC_FEE_ROUTER_V4_BASE_SEPOLIA ??
  process.env.NEXT_PUBLIC_FEE_ROUTER_V3_ADDRESS ??
  '0x0000000000000000000000000000000000000000'
)
const ORACLE_KEY = process.env.ORACLE_PRIVATE_KEY

console.log('\n══════════════════════════════════════════════════════')
console.log('  FeeRouterV4 — DIAGNOSTICA')
console.log('══════════════════════════════════════════════════════\n')
console.log('Contratto:', CONTRACT)
console.log('ORACLE_PRIVATE_KEY:', ORACLE_KEY ? ORACLE_KEY.slice(0,6)+'...'+ORACLE_KEY.slice(-4)+' ('+ORACLE_KEY.length+' chars)' : 'MISSING')

const account = privateKeyToAccount(ORACLE_KEY)
console.log('Oracle address:', account.address)

const oracleDomain = keccak256(encodeAbiParameters(
  parseAbiParameters('bytes32, bytes32, bytes32, uint256, address'),
  [
    keccak256(new TextEncoder().encode('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
    keccak256(new TextEncoder().encode('FeeRouterV4')),
    keccak256(new TextEncoder().encode('4')),
    84532n,
    CONTRACT,
  ]
))
console.log('Oracle domainSep:', oracleDomain)

const client = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
})

const abi = parseAbi([
  'function oracleSigner() view returns (address)',
  'function domainSeparator() view returns (bytes32)',
])

const [signer, domain] = await Promise.all([
  client.readContract({ address: CONTRACT, abi, functionName: 'oracleSigner' }),
  client.readContract({ address: CONTRACT, abi, functionName: 'domainSeparator' }),
])

console.log('\n── ON-CHAIN ───────────────────────────────────────')
console.log('oracleSigner():', signer)
console.log('domainSeparator():', domain)

console.log('\n── CONFRONTO ──────────────────────────────────────')
console.log('Signer match:', signer.toLowerCase() === account.address.toLowerCase() ? '✅' : '❌ MISMATCH!')
console.log('Domain match:', domain.toLowerCase() === oracleDomain.toLowerCase() ? '✅' : '❌ MISMATCH!')

if (signer.toLowerCase() !== account.address.toLowerCase()) {
  console.log('\n🔧 Il contratto aspetta signer:', signer)
  console.log('   Ma ORACLE_PRIVATE_KEY genera:', account.address)
  console.log('   → Cambia ORACLE_PRIVATE_KEY oppure chiama setOracleSigner()')
}