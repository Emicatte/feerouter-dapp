"""
compliance_oracle.py v2 — Multi-Asset AML Oracle + EIP-712 Signer

Supporta: ETH, USDC, USDT, cbBTC, DEGEN

Endpoints:
  POST /api/v1/compliance/check  → AML check + firma EIP-712
  POST /api/v1/tx/callback       → Riceve record post-finality
  GET  /api/v1/compliance/status → Health check
  GET  /api/v1/tx/history        → Audit DAC8
  GET  /api/v1/signer/address    → Indirizzo signer per verifica on-chain

Avvio:
  python3 -m uvicorn compliance_oracle:app --port 8000 --reload
"""

import os
import hashlib
import hmac as hmac_lib
import time
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from eth_account import Account
from eth_utils import to_hex, keccak
from dotenv import load_dotenv

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────
COMPLIANCE_SIGNER_KEY       = os.getenv("COMPLIANCE_SIGNER_PRIVATE_KEY")
FEE_ROUTER_V3_ADDRESS       = os.getenv("FEE_ROUTER_V3_ADDRESS", "0x0000000000000000000000000000000000000000")
CHAIN_ID                    = int(os.getenv("CHAIN_ID", "84532"))
HMAC_SECRET                 = os.getenv("HMAC_SECRET", "change_me_in_production")
COMPLIANCE_DEADLINE_SECONDS = int(os.getenv("COMPLIANCE_DEADLINE_SECONDS", "120"))  # 2 min

if not COMPLIANCE_SIGNER_KEY:
    raise RuntimeError("COMPLIANCE_SIGNER_PRIVATE_KEY non configurata nel .env")

signer_account = Account.from_key(COMPLIANCE_SIGNER_KEY)

# ── Token config (Base Mainnet + Sepolia) ──────────────────────────────────
TOKEN_CONFIG = {
    "ETH": {
        "address":  "0x0000000000000000000000000000000000000000",
        "decimals": 18,
        "eur_rate": 2200.0,   # mock — produzione: Chainlink
        "gasless":  False,
    },
    "USDC": {
        "address":  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "decimals": 6,
        "eur_rate": 0.92,
        "gasless":  True,     # Pimlico Paymaster supportato
    },
    "USDT": {
        "address":  "0xfde4c96256153236af98292015ba958c14714c22",
        "decimals": 6,
        "eur_rate": 0.92,
        "gasless":  True,
    },
    "cbBTC": {
        "address":  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
        "decimals": 8,
        "eur_rate": 88000.0,
        "gasless":  False,
    },
    "DEGEN": {
        "address":  "0x4edbc9320305298056041910220e3663a92540b6",
        "decimals": 18,
        "eur_rate": 0.003,
        "gasless":  False,
    },
}

# ── AML Blacklist ──────────────────────────────────────────────────────────
BLACKLISTED_ADDRESSES = {
    "0x722122df12d4e14e13ac3b6895a86e84145b6967",  # Tornado Cash
    "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
    "0xd96f2b1c14db8458374d9aca76e26c3950113463",
    "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d",
}

MEDIUM_RISK_ADDRESSES: set = set()

DAC8_EUR_THRESHOLD = 1000.0

# ── In-memory store ────────────────────────────────────────────────────────
tx_store: list[dict] = []

# ── FastAPI ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="FeeRouter Compliance Oracle v2",
    description="Multi-Asset AML Oracle + EIP-712 Signer",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://fee-router-dapp.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ─────────────────────────────────────────────────────────────────
class ComplianceCheckRequest(BaseModel):
    sender:    str
    recipient: str
    token:     str   # indirizzo contratto token (address(0) per ETH)
    amount:    str   # formatted (es. "100.500000")
    symbol:    str   # "ETH", "USDC", "USDT", "cbBTC", "DEGEN"
    chainId:   int

    @field_validator("sender", "recipient")
    @classmethod
    def validate_address(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("0x") or len(v) != 42:
            raise ValueError(f"Indirizzo non valido: {v}")
        return v.lower()

class ComplianceCheckResponse(BaseModel):
    approved:            bool
    oracleSignature:     str
    oracleNonce:         str   # bytes32 hex
    oracleDeadline:      int
    paymentRef:          str
    fiscalRef:           str
    riskScore:           int
    riskLevel:           str   # "LOW" | "MEDIUM" | "HIGH" | "BLOCKED"
    jurisdiction:        str
    dac8Reportable:      bool
    eurValue:            Optional[float] = None
    gasless:             bool = False
    rejectionReason:     Optional[str] = None

class TxCallbackRequest(BaseModel):
    compliance_id:          str
    tx_hash:                str
    sender_address:         str
    recipient_address:      str
    amount:                 str
    currency:               str
    fiat_amount:            Optional[str] = None
    fiat_currency:          str = "EUR"
    payment_ref:            str
    fiscal_ref:             str
    network:                str
    merchant_transaction_id: Optional[str] = None
    x_signature:            str

# ── Risk Engine ────────────────────────────────────────────────────────────
def compute_risk_score(address: str, eur_value: float) -> tuple[int, str]:
    """
    Ritorna (score: 0-100, level: str).
    
    0-29:   LOW     — transazione normale
    30-59:  MEDIUM  — enhanced due diligence (DAC8 flagged)
    60-79:  HIGH    — blocco manuale richiesto
    80-100: BLOCKED — rifiuto automatico
    
    Fattori: blacklist, volume EUR, pattern (futuro: Chainalysis)
    """
    addr = address.lower()
    
    if addr in BLACKLISTED_ADDRESSES:
        return 100, "BLOCKED"
    
    if addr in MEDIUM_RISK_ADDRESSES:
        base_score = 50
    else:
        base_score = 5
    
    # Volume-based risk: transazioni >50k EUR aumentano score
    if eur_value > 50_000:
        base_score += 30
    elif eur_value > 10_000:
        base_score += 15
    elif eur_value > 5_000:
        base_score += 5
    
    score = min(base_score, 100)
    
    if score >= 80:
        level = "BLOCKED"
    elif score >= 60:
        level = "HIGH"
    elif score >= 30:
        level = "MEDIUM"
    else:
        level = "LOW"
    
    return score, level

def calc_eur_value(symbol: str, amount_str: str) -> float:
    """Calcola controvalore EUR (mock — produzione: Chainlink)."""
    try:
        cfg  = TOKEN_CONFIG.get(symbol.upper(), {})
        rate = cfg.get("eur_rate", 1.0)
        return float(amount_str) * rate
    except (ValueError, TypeError):
        return 0.0

# ── EIP-712 Signer ─────────────────────────────────────────────────────────
def sign_oracle_eip712(
    sender:           str,
    recipient:        str,
    token:            str,
    amount_wei:       int,
    nonce:            bytes,
    deadline:         int,
    chain_id:         int,
    contract_address: str,
) -> str:
    """
    Firma EIP-712 OracleApproval.
    
    Struct identica a FeeRouterV3._ORACLE_TYPEHASH:
      OracleApproval(
        address sender,
        address recipient,
        address token,
        uint256 amount,
        bytes32 nonce,
        uint256 deadline
      )
    """
    # Domain separator
    domain_type_hash = keccak(text=(
        "EIP712Domain(string name,string version,"
        "uint256 chainId,address verifyingContract)"
    ))
    domain_separator = keccak(b"".join([
        domain_type_hash,
        keccak(text="FeeRouterV3"),
        keccak(text="3"),
        chain_id.to_bytes(32, "big"),
        bytes.fromhex(contract_address[2:].zfill(64)),
    ]))

    # Struct hash
    oracle_type_hash = keccak(text=(
        "OracleApproval(address sender,address recipient,"
        "address token,uint256 amount,bytes32 nonce,uint256 deadline)"
    ))

    # Pad address a 32 bytes (ABI encoding per address)
    def pad_addr(a: str) -> bytes:
        return bytes.fromhex(a[2:].zfill(64))

    struct_hash = keccak(b"".join([
        oracle_type_hash,
        pad_addr(sender),
        pad_addr(recipient),
        pad_addr(token),
        amount_wei.to_bytes(32, "big"),
        nonce,                           # già bytes32
        deadline.to_bytes(32, "big"),
    ]))

    # Final digest: \x19\x01 + domainSeparator + structHash
    digest = keccak(b"\x19\x01" + domain_separator + struct_hash)

    # Sign
    sig = Account.sign_hash(digest, private_key=COMPLIANCE_SIGNER_KEY)
    return to_hex(sig.signature)

def verify_hmac(payload: str, signature: str) -> bool:
    expected = hmac_lib.new(
        HMAC_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return hmac_lib.compare_digest(expected, signature)

# ── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/v1/compliance/status")
async def status():
    return {
        "status":          "online",
        "version":         "2.0.0",
        "signer_address":  signer_account.address,
        "fee_router_v3":   FEE_ROUTER_V3_ADDRESS,
        "chain_id":        CHAIN_ID,
        "supported_tokens": list(TOKEN_CONFIG.keys()),
        "timestamp":       datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/v1/compliance/check", response_model=ComplianceCheckResponse)
async def compliance_check(req: ComplianceCheckRequest):
    """
    Pre-flight AML check + EIP-712 Oracle signature.

    FLOW:
      1. Calcola controvalore EUR
      2. Risk scoring sender + recipient
      3. Se approved: genera nonce + firma digest EIP-712
      4. Restituisce oracleSignature al frontend
    """
    sender_norm    = req.sender.lower()
    recipient_norm = req.recipient.lower()
    symbol_upper   = req.symbol.upper()

    # Calcola EUR value
    eur_val = calc_eur_value(symbol_upper, req.amount)

    # Risk check sender
    sender_score, sender_level = compute_risk_score(sender_norm, eur_val)
    if sender_level == "BLOCKED":
        return ComplianceCheckResponse(
            approved         = False,
            oracleSignature  = "0x",
            oracleNonce      = "0x" + "0" * 64,
            oracleDeadline   = 0,
            paymentRef       = "0x" + "0" * 64,
            fiscalRef        = "0x" + "0" * 64,
            riskScore        = sender_score,
            riskLevel        = "BLOCKED",
            jurisdiction     = "BLOCKED",
            dac8Reportable   = False,
            gasless          = False,
            rejectionReason  = "Sender bloccato dalla lista AML/OFAC.",
        )

    # Risk check recipient
    risk_score, risk_level = compute_risk_score(recipient_norm, eur_val)

    if risk_level in ("BLOCKED", "HIGH"):
        reason = (
            "Indirizzo in blacklist AML/OFAC. Transazione bloccata."
            if risk_level == "BLOCKED"
            else f"Risk Score troppo alto ({risk_score}/100). Enhanced Due Diligence richiesta."
        )
        return ComplianceCheckResponse(
            approved         = False,
            oracleSignature  = "0x",
            oracleNonce      = "0x" + "0" * 64,
            oracleDeadline   = 0,
            paymentRef       = "0x" + "0" * 64,
            fiscalRef        = "0x" + "0" * 64,
            riskScore        = risk_score,
            riskLevel        = risk_level,
            jurisdiction     = "EU_UNKNOWN",
            dac8Reportable   = False,
            gasless          = False,
            rejectionReason  = reason,
        )

    # ── Genera dati compliance ─────────────────────────────────────────────
    nonce       = os.urandom(32)
    deadline    = int(time.time()) + COMPLIANCE_DEADLINE_SECONDS
    payment_ref = keccak(text=f"PAY-{uuid.uuid4().hex[:12].upper()}")
    fiscal_ref  = keccak(text=f"FISCAL-{symbol_upper}-{int(time.time())}")
    dac8        = eur_val > DAC8_EUR_THRESHOLD
    gasless     = TOKEN_CONFIG.get(symbol_upper, {}).get("gasless", False)

    # Amount in wei
    try:
        decimals   = TOKEN_CONFIG.get(symbol_upper, {}).get("decimals", 18)
        amount_wei = int(float(req.amount) * (10 ** decimals))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="amount non valido")

    # Token address (address(0) per ETH)
    token_addr = (
        "0x0000000000000000000000000000000000000000"
        if symbol_upper == "ETH"
        else req.token.lower()
    )

    # Firma EIP-712
    signature = sign_oracle_eip712(
        sender           = sender_norm,
        recipient        = recipient_norm,
        token            = token_addr,
        amount_wei       = amount_wei,
        nonce            = nonce,
        deadline         = deadline,
        chain_id         = req.chainId,
        contract_address = FEE_ROUTER_V3_ADDRESS,
    )

    # Salva per audit
    tx_store.append({
        "oracle_nonce":    to_hex(nonce),
        "sender":          sender_norm,
        "recipient":       recipient_norm,
        "token":           req.token,
        "symbol":          symbol_upper,
        "amount":          req.amount,
        "eur_value":       round(eur_val, 2),
        "risk_score":      risk_score,
        "risk_level":      risk_level,
        "dac8_reportable": dac8,
        "jurisdiction":    "EU_UNKNOWN",
        "approved_at":     datetime.now(timezone.utc).isoformat(),
        "deadline":        deadline,
        "status":          "pending",
    })

    return ComplianceCheckResponse(
        approved         = True,
        oracleSignature  = signature,
        oracleNonce      = to_hex(nonce),
        oracleDeadline   = deadline,
        paymentRef       = to_hex(payment_ref),
        fiscalRef        = to_hex(fiscal_ref),
        riskScore        = risk_score,
        riskLevel        = risk_level,
        jurisdiction     = "EU_UNKNOWN",
        dac8Reportable   = dac8,
        eurValue         = round(eur_val, 2),
        gasless          = gasless,
    )


@app.post("/api/v1/tx/callback")
async def tx_callback(request: Request):
    body_bytes = await request.body()
    body_str   = body_bytes.decode("utf-8")

    x_sig = request.headers.get("X-Signature", "")
    if not verify_hmac(body_str, x_sig):
        raise HTTPException(status_code=401, detail="X-Signature non valida")

    try:
        data = json.loads(body_str)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="JSON non valido")

    for record in tx_store:
        if record.get("oracle_nonce") == data.get("compliance_id"):
            record["tx_hash"]      = data.get("merchant_transaction_id", "")
            record["status"]       = "confirmed"
            record["confirmed_at"] = datetime.now(timezone.utc).isoformat()
            break

    return {
        "status":    "ok",
        "id":        data.get("compliance_id", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/tx/history")
async def tx_history(limit: int = 50, offset: int = 0):
    return {
        "total":   len(tx_store),
        "limit":   limit,
        "offset":  offset,
        "records": tx_store[offset: offset + limit],
    }


@app.get("/api/v1/signer/address")
async def signer_address():
    return {"address": signer_account.address}


@app.get("/api/v1/tokens")
async def supported_tokens():
    """Lista token supportati con config pubblica (senza chiavi)."""
    return {
        sym: {
            "address":  cfg["address"],
            "decimals": cfg["decimals"],
            "gasless":  cfg["gasless"],
        }
        for sym, cfg in TOKEN_CONFIG.items()
    }


if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("FeeRouter Compliance Oracle v2.0")
    print(f"Signer:    {signer_account.address}")
    print(f"Router V3: {FEE_ROUTER_V3_ADDRESS}")
    print(f"Chain ID:  {CHAIN_ID}")
    print(f"Tokens:    {', '.join(TOKEN_CONFIG.keys())}")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
