

import os
import hashlib
import hmac as hmac_lib
import time
import uuid
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Optional, List
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
FEE_ROUTER_V3_ADDRESS       = os.getenv("FEE_ROUTER_V3_ADDRESS", "0x0000000000000000000000000000000000000000")
CHAIN_ID                    = int(os.getenv("CHAIN_ID", "84532"))
HMAC_SECRET                 = os.getenv("HMAC_SECRET", "change_me_in_production")
COMPLIANCE_DEADLINE_SECONDS = int(os.getenv("COMPLIANCE_DEADLINE_SECONDS", "120"))

if not COMPLIANCE_SIGNER_KEY:
    raise RuntimeError("COMPLIANCE_SIGNER_PRIVATE_KEY non configurata nel .env")

signer_account = Account.from_key(COMPLIANCE_SIGNER_KEY)

# ── Token registry ─────────────────────────────────────────────────────────
TOKEN_CONFIG = {
    "ETH": {
        "address":  "0x0000000000000000000000000000000000000000",
        "decimals": 18,
        "eur_rate": 2200.0,
        "gasless":  False,
        "type":     "native",
        "category": "crypto",
    },
    "EURC": {
        "address":  "0x60a3e35cc3064fc371f477011b3e9dd2313ec445",
        "decimals": 6,
        "eur_rate": 1.0,        # 1 EURC = 1 EUR per definizione
        "gasless":  True,
        "type":     "erc20",
        "category": "stablecoin_eur",  # categoria speciale per DAC8
    },
    "USDC": {
        "address":  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "decimals": 6,
        "eur_rate": 0.92,
        "gasless":  True,
        "type":     "erc20",
        "category": "stablecoin_usd",
    },
    "USDT": {
        "address":  "0xfde4c96256153236af98292015ba958c14714c22",
        "decimals": 6,
        "eur_rate": 0.92,
        "gasless":  True,
        "type":     "erc20",
        "category": "stablecoin_usd",
    },
    "cbBTC": {
        "address":  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
        "decimals": 8,
        "eur_rate": 88000.0,
        "gasless":  False,
        "type":     "erc20",
        "category": "crypto",
    },
    "DEGEN": {
        "address":  "0x4edbc9320305298056041910220e3663a92540b6",
        "decimals": 18,
        "eur_rate": 0.003,
        "gasless":  False,
        "type":     "erc20",
        "category": "crypto",
    },
}

# ── AML Blacklist ──────────────────────────────────────────────────────────
BLACKLISTED_ADDRESSES = {
    "0x722122df12d4e14e13ac3b6895a86e84145b6967",
    "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
    "0xd96f2b1c14db8458374d9aca76e26c3950113463",
    "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfba9d",
}

MEDIUM_RISK_ADDRESSES: set = set()
DAC8_EUR_THRESHOLD = 1000.0

# ── In-memory store ────────────────────────────────────────────────────────
tx_store:       list[dict] = []   # TX confermate (post-callback)
pending_store:  list[dict] = []   # TX approvate, in attesa di conferma

# ── FastAPI app ────────────────────────────────────────────────────────────
app = FastAPI(
    title="RPagos Compliance Oracle v3",
    description="VASP Multi-Asset AML Oracle + DAC8 Bulk Reporting",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://fee-router-dapp.vercel.app",
        "https://rpagos.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic models ────────────────────────────────────────────────────────
class ComplianceVerifyRequest(BaseModel):
    sender:       str
    recipient:    str
    tokenAddress: str   # indirizzo contratto (address(0) per ETH)
    amount:       str
    symbol:       str
    chainId:      int

    @field_validator("sender", "recipient")
    @classmethod
    def validate_eth_addr(cls, v: str) -> str:
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
    gasless:            bool = False
    rejectionReason:    Optional[str] = None

# ── Risk Engine ────────────────────────────────────────────────────────────
def compute_risk(address: str, eur_value: float) -> tuple[int, str]:
    addr = address.lower()
    if addr in BLACKLISTED_ADDRESSES:
        return 100, "BLOCKED"
    base_score = 50 if addr in MEDIUM_RISK_ADDRESSES else 5
    if eur_value > 50_000:   base_score += 30
    elif eur_value > 10_000: base_score += 15
    elif eur_value > 5_000:  base_score += 5
    score = min(base_score, 100)
    level = "BLOCKED" if score >= 80 else "HIGH" if score >= 60 else "MEDIUM" if score >= 30 else "LOW"
    return score, level

def calc_eur(symbol: str, amount_str: str) -> float:
    try:
        cfg  = TOKEN_CONFIG.get(symbol.upper(), {})
        rate = cfg.get("eur_rate", 1.0)
        return float(amount_str) * rate
    except (ValueError, TypeError):
        return 0.0

# ── EIP-712 Signer ─────────────────────────────────────────────────────────
def sign_oracle_eip712(
    sender: str, recipient: str, token: str,
    amount_wei: int, nonce: bytes, deadline: int,
    chain_id: int, contract_address: str,
) -> str:
    """
    Firma OracleApproval EIP-712.
    Struct identica a FeeRouterV3._ORACLE_TYPEHASH:
      OracleApproval(address sender, address recipient, address token,
                     uint256 amount, bytes32 nonce, uint256 deadline)
    """
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

    oracle_type_hash = keccak(text=(
        "OracleApproval(address sender,address recipient,"
        "address token,uint256 amount,bytes32 nonce,uint256 deadline)"
    ))

    def pad(a: str) -> bytes:
        return bytes.fromhex(a[2:].zfill(64))

    struct_hash = keccak(b"".join([
        oracle_type_hash,
        pad(sender), pad(recipient), pad(token),
        amount_wei.to_bytes(32, "big"),
        nonce,
        deadline.to_bytes(32, "big"),
    ]))

    digest = keccak(b"\x19\x01" + domain_separator + struct_hash)
    sig    = Account.sign_hash(digest, private_key=COMPLIANCE_SIGNER_KEY)
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
        "status":           "online",
        "version":          "3.0.0",
        "signer_address":   signer_account.address,
        "fee_router_v3":    FEE_ROUTER_V3_ADDRESS,
        "chain_id":         CHAIN_ID,
        "supported_tokens": list(TOKEN_CONFIG.keys()),
        "timestamp":        datetime.now(timezone.utc).isoformat(),
    }


async def _process_compliance_request(req: ComplianceVerifyRequest) -> ComplianceVerifyResponse:
    """Core compliance logic riusata da /verify e /check."""
    sender_norm    = req.sender.lower()
    recipient_norm = req.recipient.lower()
    symbol_upper   = req.symbol.upper()
    is_eurc        = symbol_upper == "EURC"

    eur_val = calc_eur(symbol_upper, req.amount)

    # Risk check sender
    s_score, s_level = compute_risk(sender_norm, eur_val)
    if s_level == "BLOCKED":
        return ComplianceVerifyResponse(
            approved=False, oracleSignature="0x",
            oracleNonce="0x"+"0"*64, oracleDeadline=0,
            paymentRef="0x"+"0"*64, fiscalRef="0x"+"0"*64,
            riskScore=s_score, riskLevel="BLOCKED",
            jurisdiction="BLOCKED", dac8Reportable=False,
            isEurc=is_eurc, gasless=False,
            rejectionReason="Transazione negata per policy di conformità AML.",
        )

    # Risk check recipient
    r_score, r_level = compute_risk(recipient_norm, eur_val)
    if r_level in ("BLOCKED", "HIGH"):
        return ComplianceVerifyResponse(
            approved=False, oracleSignature="0x",
            oracleNonce="0x"+"0"*64, oracleDeadline=0,
            paymentRef="0x"+"0"*64, fiscalRef="0x"+"0"*64,
            riskScore=r_score, riskLevel=r_level,
            jurisdiction="EU_UNKNOWN", dac8Reportable=False,
            isEurc=is_eurc, gasless=False,
            rejectionReason="Transazione negata per policy di conformità AML.",
        )

    # Genera dati
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

    token_addr = (
        "0x0000000000000000000000000000000000000000"
        if symbol_upper == "ETH"
        else req.tokenAddress.lower()
    )

    signature = sign_oracle_eip712(
        sender=sender_norm, recipient=recipient_norm,
        token=token_addr, amount_wei=amount_wei,
        nonce=nonce, deadline=deadline,
        chain_id=req.chainId, contract_address=FEE_ROUTER_V3_ADDRESS,
    )

    # Salva in pending_store
    pending_store.append({
        "oracle_nonce":    to_hex(nonce),
        "sender":          sender_norm,
        "recipient":       recipient_norm,
        "token":           req.tokenAddress,
        "symbol":          symbol_upper,
        "amount":          req.amount,
        "eur_value":       round(eur_val, 2),
        "risk_score":      r_score,
        "risk_level":      r_level,
        "dac8_reportable": dac8,
        "is_eurc":         is_eurc,
        "jurisdiction":    "EU_UNKNOWN",
        "approved_at":     datetime.now(timezone.utc).isoformat(),
        "deadline":        deadline,
        "status":          "pending",
    })

    return ComplianceVerifyResponse(
        approved=True,
        oracleSignature = signature,
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
        gasless         = gasless,
    )


@app.post("/api/v1/compliance/verify", response_model=ComplianceVerifyResponse)
async def compliance_verify(req: ComplianceVerifyRequest):
    """
    Endpoint principale VASP — AML check + EIP-712 Oracle signature.
    Parametro `tokenAddress` invece di `token` per maggiore chiarezza.
    """
    return await _process_compliance_request(req)


@app.post("/api/v1/compliance/check", response_model=ComplianceVerifyResponse)
async def compliance_check_compat(request: Request):
    """
    Backward compatibility con frontend v4/v5 che usa /check.
    Accetta sia {token} che {tokenAddress}.
    """
    body = await request.json()
    # Normalizza campo token → tokenAddress
    if "token" in body and "tokenAddress" not in body:
        body["tokenAddress"] = body.pop("token")
    req = ComplianceVerifyRequest(**body)
    return await _process_compliance_request(req)


@app.post("/api/v1/tx/callback")
async def tx_callback(request: Request):
    """Riceve ComplianceRecord post-finality con verifica HMAC."""
    body_bytes = await request.body()
    body_str   = body_bytes.decode("utf-8")

    x_sig = request.headers.get("X-Signature", "")
    if HMAC_SECRET != "change_me_in_production" and not verify_hmac(body_str, x_sig):
        raise HTTPException(status_code=401, detail="X-Signature non valida")

    try:
        data = json.loads(body_str)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="JSON non valido")

    # Sposta da pending a confirmed
    for record in pending_store[:]:
        if record.get("oracle_nonce") == data.get("compliance_id"):
            record["tx_hash"]      = data.get("merchant_transaction_id", "")
            record["status"]       = "confirmed"
            record["confirmed_at"] = datetime.now(timezone.utc).isoformat()
            tx_store.append(record)
            pending_store.remove(record)
            break

    return {
        "status":    "ok",
        "id":        data.get("compliance_id", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/tx/history")
async def tx_history(limit: int = 50, offset: int = 0, symbol: Optional[str] = None):
    records = tx_store
    if symbol:
        records = [r for r in records if r.get("symbol", "").upper() == symbol.upper()]
    return {
        "total":   len(records),
        "limit":   limit,
        "offset":  offset,
        "records": records[offset: offset + limit],
    }


# ── DAC8 Bulk Reporting ────────────────────────────────────────────────────

@app.get("/api/v1/dac8/summary")
async def dac8_summary():
    """Riepilogo aggregato per simbolo e giurisdizione."""
    reportable = [r for r in tx_store if r.get("dac8_reportable") and r.get("status") == "confirmed"]
    by_symbol: dict[str, dict] = {}
    for r in reportable:
        sym = r.get("symbol", "UNKNOWN")
        if sym not in by_symbol:
            by_symbol[sym] = {"count": 0, "total_eur": 0.0, "is_eurc": r.get("is_eurc", False)}
        by_symbol[sym]["count"]     += 1
        by_symbol[sym]["total_eur"] += r.get("eur_value", 0.0)

    return {
        "total_reportable":   len(reportable),
        "total_eur_volume":   round(sum(r.get("eur_value", 0.0) for r in reportable), 2),
        "eurc_transactions":  sum(1 for r in reportable if r.get("is_eurc")),
        "by_symbol":          by_symbol,
        "threshold_eur":      DAC8_EUR_THRESHOLD,
        "generated_at":       datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/dac8/export")
async def dac8_export(
    format: str = Query("xml", enum=["xml", "json"]),
    from_date: Optional[str] = None,
    symbol: Optional[str] = None,
):
    """
    DAC8 Bulk Export — XML conforme direttiva 2011/16/UE (DAC8).
    
    In produzione: filtrare per periodo fiscale (trimestrale/annuale).
    XML segue la struttura richiesta dall'Agenzia delle Entrate italiana
    e dagli equivalenti EU per VASP reporting.
    """
    records = [r for r in tx_store if r.get("dac8_reportable") and r.get("status") == "confirmed"]

    if symbol:
        records = [r for r in records if r.get("symbol", "").upper() == symbol.upper()]

    if format == "json":
        return {
            "format":    "DAC8_JSON_v1",
            "generated": datetime.now(timezone.utc).isoformat(),
            "vasp":      {"name": "RPagos", "jurisdiction": "EU", "chain": "BASE"},
            "records":   records,
        }

    # ── XML Generation ─────────────────────────────────────────────────────
    root = ET.Element("DAC8Report")
    root.set("xmlns", "urn:oecd:ties:dac8:v1")
    root.set("version", "1.0")
    root.set("generated", datetime.now(timezone.utc).isoformat())

    # VASP info
    vasp = ET.SubElement(root, "ReportingFI")
    ET.SubElement(vasp, "Name").text        = "RPagos"
    ET.SubElement(vasp, "Jurisdiction").text = "EU"
    ET.SubElement(vasp, "Chain").text       = "BASE"
    ET.SubElement(vasp, "OracleAddress").text = signer_account.address

    # Transactions
    txs = ET.SubElement(root, "Transactions")
    ET.SubElement(txs, "TotalCount").text  = str(len(records))
    ET.SubElement(txs, "TotalEUR").text    = str(round(sum(r.get("eur_value", 0.0) for r in records), 2))

    for r in records:
        tx = ET.SubElement(txs, "Transaction")
        ET.SubElement(tx, "TxHash").text        = r.get("tx_hash", "")
        ET.SubElement(tx, "OracleNonce").text    = r.get("oracle_nonce", "")
        ET.SubElement(tx, "Sender").text         = r.get("sender", "")
        ET.SubElement(tx, "Recipient").text      = r.get("recipient", "")
        ET.SubElement(tx, "Asset").text          = r.get("symbol", "")
        ET.SubElement(tx, "Amount").text         = r.get("amount", "")
        ET.SubElement(tx, "EURValue").text       = str(r.get("eur_value", 0.0))
        ET.SubElement(tx, "Currency").text       = "EUR" if r.get("is_eurc") else "N/A"
        ET.SubElement(tx, "IsEURC").text         = str(r.get("is_eurc", False)).lower()
        ET.SubElement(tx, "Jurisdiction").text   = r.get("jurisdiction", "EU_UNKNOWN")
        ET.SubElement(tx, "RiskScore").text      = str(r.get("risk_score", 0))
        ET.SubElement(tx, "ConfirmedAt").text    = r.get("confirmed_at", "")
        ET.SubElement(tx, "DAC8Reportable").text = "true"

    # Pretty print XML
    xml_str = minidom.parseString(ET.tostring(root, encoding="unicode")).toprettyxml(indent="  ")

    return Response(
        content=xml_str,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename=dac8_export_{int(time.time())}.xml"},
    )


@app.get("/api/v1/signer/address")
async def signer_address():
    return {"address": signer_account.address}


@app.get("/api/v1/tokens")
async def supported_tokens():
    return {
        sym: {
            "address":  cfg["address"],
            "decimals": cfg["decimals"],
            "gasless":  cfg["gasless"],
            "type":     cfg["type"],
            "category": cfg["category"],
        }
        for sym, cfg in TOKEN_CONFIG.items()
    }


if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("RPagos Compliance Oracle v3.0 — VASP Multi-Asset")
    print(f"Signer:    {signer_account.address}")
    print(f"Router V3: {FEE_ROUTER_V3_ADDRESS}")
    print(f"Chain ID:  {CHAIN_ID}")
    print(f"Tokens:    {', '.join(TOKEN_CONFIG.keys())}")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)