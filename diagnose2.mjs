import { createPublicClient, http, parseAbi, keccak256, encodePacked, encodeAbiParameters, parseAbiParameters } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'

function loadEnv(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      if (!process.env[t.slice(0,eq).trim()]) process.env[t.slice(0,eq).trim()] = t.slice(eq+1).trim()
    }
  } catch {}
}
loadEnv('.env.local')
loadEnv('.env')

const CONTRACT = process.env.NEXT_PUBLIC_FEE_ROUTER_V4_BASE_SEPOLIA
const account = privateKeyToAccount(process.env.ORACLE_PRIVATE_KEY)

const client = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
})

// Typehash V4: tokenIn, tokenOut, amountIn
const V4_TYPE = "OracleApproval(address sender,address recipient,address tokenIn,address tokenOut,uint256 amountIn,bytes32 nonce,uint256 deadline)"

// Typehash V3 possibile: token, amount (senza In/Out)
const V3_TYPE_A = "OracleApproval(address sender,address recipient,address token,uint256 amount,bytes32 nonce,uint256 deadline)"

// Typehash V3 possibile: con tokenAddress
const V3_TYPE_B = "OracleApproval(address sender,address recipient,address tokenAddress,uint256 amount,bytes32 nonce,uint256 deadline)"

console.log('\n══════════════════════════════════════════════')
console.log('  DIAGNOSTICA TYPEHASH')
console.log('══════════════════════════════════════════════\n')
console.log('V4 typehash:', keccak256(new TextEncoder().encode(V4_TYPE)))
console.log('V3-A typehash:', keccak256(new TextEncoder().encode(V3_TYPE_A)))
console.log('V3-B typehash:', keccak256(new TextEncoder().encode(V3_TYPE_B)))

// Parametri di test
const sender = account.address
const recipient = '0xa61A471FC226a06C681cf2Ec41d2C64a147b4392'
const ZERO = '0x0000000000000000000000000000000000000000'
const amountWei = 1000000000000000n // 0.001 ETH
const nonce = '0x' + '0'.repeat(63) + '1'
const deadline = BigInt(Math.floor(Date.now()/1000) + 600)

const domain = { name: 'FeeRouterV3', version: '3', chainId: 84532, verifyingContract: CONTRACT }

// Firma V4 (tokenIn, tokenOut, amountIn)
const sigV4 = await account.signTypedData({
  domain,
  types: { OracleApproval: [
    {name:'sender',type:'address'},{name:'recipient',type:'address'},
    {name:'tokenIn',type:'address'},{name:'tokenOut',type:'address'},
    {name:'amountIn',type:'uint256'},{name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'},
  ]},
  primaryType: 'OracleApproval',
  message: { sender, recipient, tokenIn: ZERO, tokenOut: ZERO, amountIn: amountWei, nonce, deadline },
})

// Firma V3-A (token, amount)
const sigV3A = await account.signTypedData({
  domain,
  types: { OracleApproval: [
    {name:'sender',type:'address'},{name:'recipient',type:'address'},
    {name:'token',type:'address'},{name:'amount',type:'uint256'},
    {name:'nonce',type:'bytes32'},{name:'deadline',type:'uint256'},
  ]},
  primaryType: 'OracleApproval',
  message: { sender, recipient, token: ZERO, amount: amountWei, nonce, deadline },
})

console.log('\nSimulando transferETHWithOracle con firma V4...')
try {
  await client.simulateContract({
    address: CONTRACT, account: sender,
    abi: parseAbi(['function transferETHWithOracle(address,bytes32,uint256,bytes) payable']),
    functionName: 'transferETHWithOracle',
    args: [recipient, nonce, deadline, sigV4],
    value: amountWei,
  })
  console.log('✅ V4 typehash FUNZIONA!')
} catch(e) {
  console.log('❌ V4 fallisce:', e.message?.slice(0,120))
}

console.log('\nSimulando transferETHWithOracle con firma V3-A...')
try {
  await client.simulateContract({
    address: CONTRACT, account: sender,
    abi: parseAbi(['function transferETHWithOracle(address,bytes32,uint256,bytes) payable']),
    functionName: 'transferETHWithOracle',
    args: [recipient, nonce, deadline, sigV3A],
    value: amountWei,
  })
  console.log('✅ V3-A typehash FUNZIONA!')
} catch(e) {
  console.log('❌ V3-A fallisce:', e.message?.slice(0,120))
}
