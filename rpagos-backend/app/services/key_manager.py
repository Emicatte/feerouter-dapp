"""
RSends Backend — Key Management Service.

Signers:
  LocalSigner  — private key from env var (dev/testnet only, warns on mainnet)
  KMSSigner    — AWS KMS via boto3; key never leaves the HSM

Factory:
  get_signer(mode) where mode = SIGNER_MODE env var ("local" | "kms")

All signers implement the AbstractSigner interface.
"""

import abc
import asyncio
import logging
import time as _time
from typing import Optional

from eth_account import Account

from app.config import get_settings

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
#  Exception
# ═══════════════════════════════════════════════════════════════

class SignerError(Exception):
    """Key management or signing error."""
    pass


# ═══════════════════════════════════════════════════════════════
#  Abstract Interface
# ═══════════════════════════════════════════════════════════════

class AbstractSigner(abc.ABC):
    """Interface for transaction signers.

    Every signer must be able to:
      - sign_transaction(tx_dict) → raw signed TX bytes
      - get_address() → checksummed Ethereum address
    """

    @abc.abstractmethod
    async def sign_transaction(self, tx_dict: dict) -> bytes:
        """Sign an EVM transaction dictionary.

        Args:
            tx_dict: Fully-populated transaction dict
                     (to, value, gas, nonce, chainId, etc.).

        Returns:
            Raw signed transaction bytes ready for ``eth_sendRawTransaction``.
        """
        ...

    @abc.abstractmethod
    async def get_address(self) -> str:
        """Return the signer's Ethereum address (checksummed)."""
        ...


# ═══════════════════════════════════════════════════════════════
#  LocalSigner (env-var private key)
# ═══════════════════════════════════════════════════════════════

class LocalSigner(AbstractSigner):
    """Signs with a local private key loaded from ``SWEEP_PRIVATE_KEY``.

    WARNING:
        Only for development and testnet.
        Emits a loud warning if used on mainnet chain_ids.
    """

    MAINNET_CHAIN_IDS = frozenset({1, 8453, 42161, 137, 10, 56})

    def __init__(self, private_key: Optional[str] = None):
        settings = get_settings()
        self._key = private_key or settings.sweep_private_key
        if not self._key:
            raise SignerError(
                "No private key configured (set SWEEP_PRIVATE_KEY env var)"
            )

        self._account = Account.from_key(self._key)
        logger.info("LocalSigner initialised: %s", self._account.address)

    async def sign_transaction(self, tx_dict: dict) -> bytes:
        """Sign via local private key.

        Logs a WARNING when signing for mainnet chain_ids.
        """
        chain_id = tx_dict.get("chainId", 0)
        if chain_id in self.MAINNET_CHAIN_IDS:
            logger.warning(
                "LocalSigner used on MAINNET chain %d — use KMS in production!",
                chain_id,
            )

        signed = self._account.sign_transaction(tx_dict)
        return signed.raw_transaction

    async def get_address(self) -> str:
        return self._account.address


# ═══════════════════════════════════════════════════════════════
#  KMSSigner (AWS KMS — HSM-backed)
# ═══════════════════════════════════════════════════════════════

class KMSSigner(AbstractSigner):
    """Signs via AWS KMS — the private key never leaves the HSM.

    Requirements:
      - ``boto3`` installed
      - KMS key with ``ECC_SECG_P256K1`` key spec
      - IAM permissions: ``kms:Sign``, ``kms:GetPublicKey``

    Features:
      - Address derived from KMS public key, cached after first call
      - Retry with exponential backoff (max 3 attempts)
      - EIP-2 low-s normalisation
    """

    MAX_RETRIES = 3
    BASE_DELAY = 0.5  # seconds

    def __init__(
        self,
        key_id: Optional[str] = None,
        region: Optional[str] = None,
    ):
        settings = get_settings()
        self._key_id = key_id or settings.kms_key_id
        self._region = region or settings.aws_region

        if not self._key_id:
            raise SignerError("No KMS key ID configured (set KMS_KEY_ID env var)")

        try:
            import boto3
        except ImportError:
            raise SignerError("boto3 is required for KMS signer: pip install boto3")

        self._kms = boto3.client("kms", region_name=self._region)
        self._cached_address: Optional[str] = None
        logger.info(
            "KMSSigner initialised: key=%s region=%s",
            self._key_id,
            self._region,
        )

    # ── Address derivation ────────────────────────────────

    async def get_address(self) -> str:
        """Derive Ethereum address from KMS public key (cached)."""
        if self._cached_address:
            return self._cached_address

        address = await asyncio.to_thread(self._derive_address)
        self._cached_address = address
        return address

    def _derive_address(self) -> str:
        """Synchronous address derivation from KMS."""
        from eth_keys import keys as eth_keys
        from cryptography.hazmat.primitives.serialization import (
            Encoding,
            PublicFormat,
            load_der_public_key,
        )

        response = self._kms.get_public_key(KeyId=self._key_id)
        pub_key_der = response["PublicKey"]

        # Parse DER → uncompressed point (04 || x || y)
        pub_key = load_der_public_key(pub_key_der)
        raw_bytes = pub_key.public_bytes(
            Encoding.X962, PublicFormat.UncompressedPoint
        )

        # eth_keys expects 64 bytes (x || y) without the 0x04 prefix
        pub = eth_keys.PublicKey(raw_bytes[1:])
        address = pub.to_checksum_address()

        logger.info("KMS address derived: %s", address)
        return address

    # ── Transaction signing ───────────────────────────────

    async def sign_transaction(self, tx_dict: dict) -> bytes:
        """Sign a transaction via KMS.

        Supports legacy (type 0) and EIP-1559 (type 2) transactions.
        """
        return await asyncio.to_thread(self._sign_sync, tx_dict)

    def _sign_sync(self, tx_dict: dict) -> bytes:
        """Synchronous signing pipeline."""
        from eth_account._utils.legacy_transactions import (
            serializable_unsigned_transaction_from_dict,
            encode_transaction,
        )

        # Prepare unsigned transaction and compute hash
        unsigned = serializable_unsigned_transaction_from_dict(tx_dict)
        msg_hash = unsigned.hash()

        # Sign hash via KMS
        r, s = self._kms_sign_hash(bytes(msg_hash))

        # Determine recovery parameter v
        v_raw = self._recover_v(bytes(msg_hash), r, s)

        # EIP-155 v encoding
        chain_id = tx_dict.get("chainId")
        if chain_id:
            v = v_raw + 35 + chain_id * 2
        else:
            v = v_raw + 27

        return encode_transaction(unsigned, vrs=(v, r, s))

    def _kms_sign_hash(self, msg_hash: bytes) -> tuple[int, int]:
        """Sign a 32-byte hash via KMS with retry + backoff.

        Returns:
            (r, s) integers with EIP-2 low-s normalisation.
        """
        from cryptography.hazmat.primitives.asymmetric.utils import (
            decode_dss_signature,
        )

        der_signature: Optional[bytes] = None

        for attempt in range(self.MAX_RETRIES):
            try:
                response = self._kms.sign(
                    KeyId=self._key_id,
                    Message=msg_hash,
                    MessageType="DIGEST",
                    SigningAlgorithm="ECDSA_SHA_256",
                )
                der_signature = response["Signature"]
                break
            except Exception as exc:
                if attempt < self.MAX_RETRIES - 1:
                    delay = self.BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "KMS sign attempt %d failed: %s — retrying in %.1fs",
                        attempt + 1,
                        exc,
                        delay,
                    )
                    _time.sleep(delay)
                else:
                    raise SignerError(
                        f"KMS signing failed after {self.MAX_RETRIES} attempts: {exc}"
                    )

        r, s = decode_dss_signature(der_signature)

        # EIP-2: ensure s is in lower half of curve order
        SECP256K1_ORDER = (
            0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
        )
        if s > SECP256K1_ORDER // 2:
            s = SECP256K1_ORDER - s

        return r, s

    def _recover_v(self, msg_hash: bytes, r: int, s: int) -> int:
        """Determine recovery parameter v by trial (0 or 1)."""
        from eth_keys.datatypes import Signature

        address = self._cached_address or self._derive_address()

        for v_candidate in (0, 1):
            try:
                sig = Signature(vrs=(v_candidate, r, s))
                recovered = sig.recover_public_key_from_msg_hash(msg_hash)
                if recovered.to_checksum_address().lower() == address.lower():
                    return v_candidate
            except Exception:
                continue

        raise SignerError("Failed to determine recovery parameter v")


# ═══════════════════════════════════════════════════════════════
#  Factory
# ═══════════════════════════════════════════════════════════════

_signer: Optional[AbstractSigner] = None


def get_signer(mode: Optional[str] = None) -> AbstractSigner:
    """Get or create the configured signer (singleton).

    Args:
        mode: ``"local"`` or ``"kms"``. Defaults to ``SIGNER_MODE`` env var.

    Returns:
        An ``AbstractSigner`` instance.
    """
    global _signer

    if _signer is not None:
        return _signer

    settings = get_settings()
    mode = mode or settings.signer_mode

    if mode == "kms":
        _signer = KMSSigner()
    else:
        _signer = LocalSigner()

    return _signer
