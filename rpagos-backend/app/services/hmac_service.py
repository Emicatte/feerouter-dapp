"""
RPagos Backend Core — Servizio di verifica HMAC.

Verifica la x_signature inviata dal frontend usando HMAC-SHA256.
Il frontend genera la firma così:
  HMAC_SHA256(secret, fiscal_ref + tx_hash + amount + currency + timestamp)
"""

import hashlib
import hmac
from app.config import get_settings


def compute_signature(
    fiscal_ref: str,
    tx_hash: str,
    amount: float,
    currency: str,
    timestamp: str,
) -> str:
    """
    Calcola la firma HMAC-SHA256 attesa.

    Il messaggio da firmare segue lo stesso ordine del frontend:
    fiscal_ref|tx_hash|amount|currency|timestamp
    """
    settings = get_settings()
    message = f"{fiscal_ref}|{tx_hash}|{amount}|{currency}|{timestamp}"
    signature = hmac.new(
        settings.hmac_secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return signature


def verify_signature(
    x_signature: str,
    fiscal_ref: str,
    tx_hash: str,
    amount: float,
    currency: str,
    timestamp: str,
) -> bool:
    """
    Verifica che x_signature corrisponda al payload.

    Usa hmac.compare_digest per prevenire timing attacks.
    In modalità dev, accetta anche la firma placeholder del frontend.
    """
    settings = get_settings()

    # Il frontend usa "PENDING_HMAC_SHA256" come placeholder
    if settings.debug and x_signature == "PENDING_HMAC_SHA256":
        return True

    expected = compute_signature(fiscal_ref, tx_hash, amount, currency, timestamp)
    return hmac.compare_digest(x_signature, expected)
