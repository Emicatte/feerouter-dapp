"""
compliance_oracle.py v4 — Omni-chain + Swap-and-Forward Support

Novità rispetto a v3:
  - Supporto multi-chain (Ethereum L1 + Base L2)
  - EIP-712 con nuovo typehash V4:
    OracleApproval(sender, recipient, tokenIn, tokenOut, amountIn, nonce, deadline)
  - Record DAC8 con sourceChain + isSwap + tokenIn/tokenOut
  - Endpoint /api/v1/compliance/verify compatibile con V3 e V4
"""

import os
import hashlib
import hmac as hmac_lib
import time
import uuid
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Optional
from xml.dom import minidom

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, field_validator
from eth_account import Account
from eth_utils import to_hex, keccak
from dotenv import load_dotenv

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────
COMPLIANCE_SIGNER_KEY       = os.getenv("COMPLIANCE_SIGNER_PRIVATE_KEY")
CHAIN_ID_BASE               = int(os.getenv("CHAIN_ID_BASE", "84532"))
CHAIN_ID_ETH                = int(os.getenv("CHAIN_ID_ETH", "1"))
FEE_ROUTER_V4_BASE          = os.getenv("FEE_ROUTER_V4_BASE", "0x0")
FEE_ROUTER_V4_ETH           = os.getenv("FEE_ROUTER_V4_ETH", "0x0")
HMAC_SECRET                 = os.getenv("HMAC_SECRET", "change_me")
COMPLIANCE_DEADLINE_SECONDS = int(os.getenv("COMPLIANCE_DEADLINE_SECONDS", "120"))

if not COMPLIANCE_SIGNER_KEY:
    raise RuntimeError("COMPLIANCE_SIGNER_PRIVATE_KEY non configurata")

signer_account = Account.from_key(COMPLIANCE_SIGNER_KEY)

# ── Registry contratti per chain ───────────────────────────────────────────
ROUTER_REGISTRY = {
    1:      FEE_ROUTER_V4_ETH,
    8453:   FEE_ROUTER_V4_BASE,
    84532:  os.getenv("FEE_ROUTER_V3_ADDRESS", "0x0"),    # testnet
}

# ── Token registry multi-chain ─────────────────────────────────────────────
TOKEN_REGISTRY = {
    # Base Mainnet
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { "symbol": "USDC",  "decimals": 6,  "eur_rate": 0.92,    "chain": 8453, "category": "stablecoin_usd" },
    "0xfde4c96256153236af98292015ba958c14714c22": { "symbol": "USDT",  "decimals": 6,  "eur_rate": 0.92,    "chain": 8453, "category": "stablecoin_usd" },
    "0x60a3e35cc3064fc371f477011b3e9dd2313ec445": { "symbol": "EURC",  "decimals": 6,  "eur_rate": 1.0,     "chain": 8453, "category": "stablecoin_eur" },
    "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { "symbol": "cbBTC", "decimals": 8,  "eur_rate": 88000.0, "chain": 8453, "category": "crypto" },
    "0x4200000000000000000000000000000000000006": { "symbol": "WETH",  "decimals": 18, "eur_rate": 2200.0,  "chain": 8453, "category": "crypto" },
    # Ethereum Mainnet
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { "symbol": "USDC",  "decimals": 6,  "eur_rate": 0.92,    "chain": 1,    "category": "stablecoin_usd" },
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { "symbol": "USDT",  "decimals": 6,  "eur_rate": 0.92,    "chain": 1,    "category": "stablecoin_usd" },
    "0x1abaea1f7c830bd89acc67ec4af516284b1bc33c": { "symbol": "EURC",  "decimals": 6,  "eur_rate": 1.0,     "chain": 1,    "category": "stablecoin_eur" },
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { "symbol": "WBTC",  "decimals": 8,  "eur_rate": 88000.0, "chain": 1,    "category": "crypto" },
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { "symbol": "WETH",  "decimals": 18, "eur_rate": 2200.0,  "chain": 1,    "category": "crypto" },
    # ETH nativo (address(0))
    "0x0000000000000000000000000000000000000000": { "symbol": "ETH",   "decimals": 18, "eur_rate": 2200.0,  "chain": -1,   "category": "crypto" },
}

# ── AML ────────────────────────────────────────────────────────────────────
BLACKLISTED_ADDRESSES = {
    "0x722122df12d4e14e13ac3b6895a86e84145b6967",
    "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
    "0xd96f2b1c14db8458374d9aca76e26c3950113463",
    "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d",
}

DAC8_EUR_THRESHOLD = 1000.0
tx_store:      list[dict] = []
pending_store: list[dict] = []

# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RPagos Compliance Oracle v4 — Omni-chain",
    version="4.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://fee-router-dapp.vercel.app", "https://rpagos.com"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# ── Pydantic models ────────────────────────────────────────────────────────
class ComplianceVerifyRequest(BaseModel):
    sender:       str
    recipient:    str
    tokenIn:      str   # address(0) per ETH nativo
    tokenOut:     str   # uguale a tokenIn per direct transfer
    amountIn:     str   # formatted
    chainId:      int
    # Opzionali per backward compat con V3
    tokenAddress: Optional[str] = None
    symbol:       Optional[str] = None
    amount:       Optional[str] = None

    @field_validator("sender", "recipient")
    @classmethod
    def validate_addr(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("0x") or len(v) != 42:
            raise ValueError(f"Indirizzo non valido: {v}")
        return v.lower()

class ComplianceVerifyResponse(BaseModel):
    approved:           bool
    oracleSignature:    str
    oracleNonce:        str
    oracleDeadline:     int
    paymentRef:         str
    fiscalRef:          str
    riskScore:          int
    riskLevel:          str
    jurisdiction:       str
    dac8Reportable:     bool
    eurValue:           Optional[float] = None
    isEurc:             bool = False
    isSwap:             bool = False
    sourceChain:        str = "BASE"
    gasless:            bool = False
    rejectionReason:    Optional[str] = None

# ── Risk engine ────────────────────────────────────────────────────────────
def compute_risk(address: str, eur_value: float) -> tuple[int, str]:
    addr = address.lower()
    if addr in BLACKLISTED_ADDRESSES:
        return 100, "BLOCKED"
    score = 5
    if eur_value > 50_000:   score += 30
    elif eur_value > 10_000: score += 15
    elif eur_value > 5_000:  score += 5
    score = min(score, 100)
    level = "BLOCKED" if score >= 80 else "HIGH" if score >= 60 else "MEDIUM" if score >= 30 else "LOW"
    return score, level

def calc_eur(token_addr: str, amount_str: str) -> float:
    cfg = TOKEN_REGISTRY.get(token_addr.lower(), {})
    try:
        return float(amount_str) * cfg.get("eur_rate", 1.0)
    except (ValueError, TypeError):
        return 0.0

def get_chain_name(chain_id: int) -> str:
    return {1: "ETHEREUM", 8453: "BASE", 84532: "BASE_SEPOLIA"}.get(chain_id, f"CHAIN_{chain_id}")

# ── EIP-712 V4 signer ──────────────────────────────────────────────────────
def sign_oracle_v4(
    sender: str, recipient: str,
    token_in: str, token_out: str,
    amount_wei: int,
    nonce: bytes, deadline: int,
    chain_id: int, contract_address: str,
) -> str:
    """
    Firma OracleApproval V4 — supporta sia direct che swap.
    Typehash:
      OracleApproval(address sender, address recipient,
                     address tokenIn, address tokenOut,
                     uint256 amountIn, bytes32 nonce, uint256 deadline)
    """
    domain_type_hash = keccak(text=(
        "EIP712Domain(string name,string version,"
        "uint256 chainId,address verifyingContract)"
    ))
    domain_sep = keccak(b"".join([
        domain_type_hash,
        keccak(text="FeeRouterV4"),
        keccak(text="4"),
        chain_id.to_bytes(32, "big"),
        bytes.fromhex(contract_address[2:].zfill(64)),
    ]))

    type_hash = keccak(text=(
        "OracleApproval(address sender,address recipient,"
        "address tokenIn,address tokenOut,"
        "uint256 amountIn,bytes32 nonce,uint256 deadline)"
    ))

    def pad(a: str) -> bytes:
        return bytes.fromhex(a[2:].zfill(64))

    struct_hash = keccak(b"".join([
        type_hash,
        pad(sender), pad(recipient),
        pad(token_in), pad(token_out),
        amount_wei.to_bytes(32, "big"),
        nonce,
        deadline.to_bytes(32, "big"),
    ]))

    digest = keccak(b"\x19\x01" + domain_sep + struct_hash)
    sig = Account.sign_hash(digest, private_key=COMPLIANCE_SIGNER_KEY)
    return to_hex(sig.signature)

# ── Core compliance logic ──────────────────────────────────────────────────
async def _verify(req: ComplianceVerifyRequest) -> ComplianceVerifyResponse:
    # Normalizza V3 → V4 params
    token_in  = req.tokenIn.lower() if hasattr(req, 'tokenIn') else (req.tokenAddress or "0x" + "0"*40)
    token_out = req.tokenOut.lower() if hasattr(req, 'tokenOut') else token_in
    amount    = req.amountIn if req.amountIn else (req.amount or "0")
    is_swap   = token_in != token_out

    sender_norm    = req.sender.lower()
    recipient_norm = req.recipient.lower()

    eur_val = calc_eur(token_in, amount)

    # Risk check
    s_score, s_level = compute_risk(sender_norm, eur_val)
    if s_level == "BLOCKED":
        return ComplianceVerifyResponse(
            approved=False, oracleSignature="0x",
            oracleNonce="0x"+"0"*64, oracleDeadline=0,
            paymentRef="0x"+"0"*64, fiscalRef="0x"+"0"*64,
            riskScore=s_score, riskLevel="BLOCKED", jurisdiction="BLOCKED",
            dac8Reportable=False, sourceChain=get_chain_name(req.chainId),
            rejectionReason="Transazione negata per policy di conformità AML.",
        )

    r_score, r_level = compute_risk(recipient_norm, eur_val)
    if r_level in ("BLOCKED", "HIGH"):
        return ComplianceVerifyResponse(
            approved=False, oracleSignature="0x",
            oracleNonce="0x"+"0"*64, oracleDeadline=0,
            paymentRef="0x"+"0"*64, fiscalRef="0x"+"0"*64,
            riskScore=r_score, riskLevel=r_level, jurisdiction="EU_UNKNOWN",
            dac8Reportable=False, sourceChain=get_chain_name(req.chainId),
            rejectionReason="Transazione negata per policy di conformità AML.",
        )

    # Genera dati
    nonce       = os.urandom(32)
    deadline    = int(time.time()) + COMPLIANCE_DEADLINE_SECONDS
    payment_ref = keccak(text=f"PAY-{uuid.uuid4().hex[:12].upper()}")
    fiscal_ref  = keccak(text=f"FISCAL-{req.chainId}-{int(time.time())}")
    dac8        = eur_val > DAC8_EUR_THRESHOLD

    token_info  = TOKEN_REGISTRY.get(token_in, {})
    symbol      = token_info.get("symbol", "UNKNOWN")
    is_eurc     = token_info.get("category") == "stablecoin_eur"
    gasless     = req.chainId != 1  # gasless solo su L2

    # Amount in wei
    try:
        decimals   = token_info.get("decimals", 18)
        amount_wei = int(float(amount) * (10 ** decimals))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="amountIn non valido")

    # Seleziona router per chain
    contract_addr = ROUTER_REGISTRY.get(req.chainId, "0x" + "0"*40)

    sig = sign_oracle_v4(
        sender=sender_norm, recipient=recipient_norm,
        token_in=token_in, token_out=token_out,
        amount_wei=amount_wei, nonce=nonce, deadline=deadline,
        chain_id=req.chainId, contract_address=contract_addr,
    )

    # Salva in pending
    pending_store.append({
        "oracle_nonce":    to_hex(nonce),
        "sender":          sender_norm,
        "recipient":       recipient_norm,
        "token_in":        token_in,
        "token_out":       token_out,
        "symbol":          symbol,
        "amount":          amount,
        "eur_value":       round(eur_val, 2),
        "is_swap":         is_swap,
        "is_eurc":         is_eurc,
        "risk_score":      r_score,
        "risk_level":      r_level,
        "dac8_reportable": dac8,
        "source_chain":    get_chain_name(req.chainId),
        "chain_id":        req.chainId,
        "approved_at":     datetime.now(timezone.utc).isoformat(),
        "deadline":        deadline,
        "status":          "pending",
    })

    return ComplianceVerifyResponse(
        approved=True,
        oracleSignature = sig,
        oracleNonce     = to_hex(nonce),
        oracleDeadline  = deadline,
        paymentRef      = to_hex(payment_ref),
        fiscalRef       = to_hex(fiscal_ref),
        riskScore       = r_score,
        riskLevel       = r_level,
        jurisdiction    = "EU_UNKNOWN",
        dac8Reportable  = dac8,
        eurValue        = round(eur_val, 2),
        isEurc          = is_eurc,
        isSwap          = is_swap,
        sourceChain     = get_chain_name(req.chainId),
        gasless         = gasless,
    )

# ── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/v1/compliance/status")
async def status():
    return {
        "status":          "online",
        "version":         "4.0.0",
        "signer_address":  signer_account.address,
        "routers": {
            "BASE_MAINNET":  FEE_ROUTER_V4_BASE,
            "ETH_MAINNET":   FEE_ROUTER_V4_ETH,
        },
        "supported_chains": [1, 8453, 84532],
        "timestamp":       datetime.now(timezone.utc).isoformat(),
    }

@app.post("/api/v1/compliance/verify", response_model=ComplianceVerifyResponse)
async def compliance_verify(req: ComplianceVerifyRequest):
    """V4 endpoint — supporta tokenIn/tokenOut per swap."""
    return await _verify(req)

@app.post("/api/v1/compliance/check", response_model=ComplianceVerifyResponse)
async def compliance_check_compat(request: Request):
    """Backward compat con V3 — accetta {token} o {tokenAddress}."""
    body = await request.json()
    # Normalizza V3 → V4
    if "token" in body and "tokenIn" not in body:
        body["tokenIn"]  = body.pop("token")
        body["tokenOut"] = body["tokenIn"]
    if "tokenAddress" in body and "tokenIn" not in body:
        body["tokenIn"]  = body.pop("tokenAddress")
        body["tokenOut"] = body["tokenIn"]
    if "amount" in body and "amountIn" not in body:
        body["amountIn"] = body.pop("amount")
    req = ComplianceVerifyRequest(**body)
    return await _verify(req)

@app.post("/api/v1/tx/callback")
async def tx_callback(request: Request):
    """
    Receives confirmed TX data from the Next.js HMAC proxy (route.ts).

    Field contract (from route.ts):
      - X-Signature header: HMAC-SHA256 of full JSON body
      - body.x_signature:   HMAC-SHA256 of pipe-separated canonical message
      - body.compliance_id: flattened from compliance_record.compliance_id
      - body.merchant_transaction_id: alias for tx_hash
      - body.compliance_record: nested object with DAC8/MiCA fields
      - body.tx_hash, body.fiscal_ref, body.gross_amount, body.currency, body.timestamp
    """
    body_bytes = await request.body()
    body_str   = body_bytes.decode("utf-8")
    x_sig      = request.headers.get("X-Signature", "")
    if HMAC_SECRET != "change_me":
        expected = hmac_lib.new(HMAC_SECRET.encode(), body_str.encode(), hashlib.sha256).hexdigest()
        if not hmac_lib.compare_digest(expected, x_sig):
            raise HTTPException(status_code=401, detail="X-Signature non valida")
    try:
        data = json.loads(body_str)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="JSON non valido")

    # compliance_id: root (flattened by route.ts) or nested in compliance_record
    compliance_id = (
        data.get("compliance_id")
        or (data.get("compliance_record") or {}).get("compliance_id", "")
    )
    # merchant_transaction_id: route.ts maps this from tx_hash
    tx_hash = data.get("merchant_transaction_id") or data.get("tx_hash", "")

    for record in pending_store[:]:
        if record.get("oracle_nonce") == compliance_id:
            record.update({
                "tx_hash":      tx_hash,
                "status":       "confirmed",
                "confirmed_at": datetime.now(timezone.utc).isoformat(),
            })
            tx_store.append(record)
            pending_store.remove(record)
            break
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/api/v1/tx/history")
async def tx_history(limit: int = 50, offset: int = 0, chain_id: Optional[int] = None):
    records = tx_store
    if chain_id:
        records = [r for r in records if r.get("chain_id") == chain_id]
    return {"total": len(records), "records": records[offset: offset+limit]}

@app.get("/api/v1/dac8/export")
async def dac8_export(format: str = Query("xml", enum=["xml", "json"])):
    reportable = [r for r in tx_store if r.get("dac8_reportable") and r.get("status") == "confirmed"]
    if format == "json":
        return {"format": "DAC8_JSON_v2", "records": reportable,
                "generated": datetime.now(timezone.utc).isoformat()}

    root = ET.Element("DAC8Report")
    root.set("xmlns", "urn:oecd:ties:dac8:v2")
    root.set("version", "2.0")
    root.set("generated", datetime.now(timezone.utc).isoformat())

    vasp = ET.SubElement(root, "ReportingFI")
    ET.SubElement(vasp, "Name").text        = "RPagos"
    ET.SubElement(vasp, "Jurisdiction").text = "EU"
    ET.SubElement(vasp, "OracleAddress").text = signer_account.address

    txs = ET.SubElement(root, "Transactions")
    ET.SubElement(txs, "TotalCount").text = str(len(reportable))
    ET.SubElement(txs, "TotalEUR").text   = str(round(sum(r.get("eur_value",0) for r in reportable), 2))

    for r in reportable:
        tx = ET.SubElement(txs, "Transaction")
        for k, v in [
            ("TxHash",      r.get("tx_hash","")),
            ("SourceChain", r.get("source_chain","UNKNOWN")),
            ("IsSwap",      str(r.get("is_swap", False)).lower()),
            ("TokenIn",     r.get("token_in","")),
            ("TokenOut",    r.get("token_out","")),
            ("Symbol",      r.get("symbol","")),
            ("Amount",      r.get("amount","")),
            ("EURValue",    str(r.get("eur_value",0))),
            ("IsEURC",      str(r.get("is_eurc",False)).lower()),
            ("Sender",      r.get("sender","")),
            ("Recipient",   r.get("recipient","")),
            ("RiskScore",   str(r.get("risk_score",0))),
            ("ConfirmedAt", r.get("confirmed_at","")),
        ]:
            ET.SubElement(tx, k).text = v

    xml_str = minidom.parseString(ET.tostring(root, encoding="unicode")).toprettyxml(indent="  ")
    return Response(content=xml_str, media_type="application/xml",
                    headers={"Content-Disposition": f"attachment; filename=dac8_v4_{int(time.time())}.xml"})

@app.get("/api/v1/signer/address")
async def signer_address():
    return {"address": signer_account.address}

if __name__ == "__main__":
    import uvicorn
    print(f"RPagos Compliance Oracle v4 | Signer: {signer_account.address}")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
