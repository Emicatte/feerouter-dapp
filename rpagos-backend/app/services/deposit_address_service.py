"""
RSend Backend — Deposit Address Service.

Genera indirizzi di deposito con keypair reali per ogni PaymentIntent.
Derivazione deterministica: keccak256(master_key_bytes + intent_id_bytes) -> child private key.

La private key NON viene salvata nel DB — viene ricostruita on-demand per il sweep.
Requisiti: DEPOSIT_MASTER_KEY in .env (0x-prefixed 64-char hex private key).

Funzioni principali:
  - generate_deposit_address(intent_id) -> address  (usata alla creazione dell'intent)
  - get_private_key_for_intent(intent_id) -> hex     (usata dal sweeper)
  - sweep_deposit(intent_id, destination, db)         (sweep fondi al merchant/treasury)
"""

import logging
from typing import Optional

from eth_account import Account
from eth_account.signers.local import LocalAccount

from app.config import get_settings

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════
#  Keccak-256 helper
# ═══════════════════════════════════════════════════════════════

def _keccak256(data: bytes) -> bytes:
    """Keccak-256 hash — usa eth_hash (compatibile EVM)."""
    try:
        from eth_hash.auto import keccak
        return keccak(data)
    except ImportError:
        # Fallback: eth_account include eth_hash internamente
        import hashlib
        try:
            import sha3
            return sha3.keccak_256(data).digest()
        except ImportError:
            logger.warning(
                "Neither eth_hash nor pysha3 available — using SHA-256 fallback. "
                "Install eth-hash[pycryptodome] for EVM-compatible addresses."
            )
            return hashlib.sha256(data).digest()


# ═══════════════════════════════════════════════════════════════
#  Key derivation — deterministic child keys from master key
# ═══════════════════════════════════════════════════════════════

def _get_master_key_bytes() -> bytes:
    """Legge DEPOSIT_MASTER_KEY da config e ritorna i 32 raw bytes."""
    settings = get_settings()
    master_key = settings.deposit_master_key

    if not master_key:
        raise ValueError(
            "DEPOSIT_MASTER_KEY non configurato. "
            "Impostalo in .env (0x-prefixed 64-char hex private key). "
            "CRITICO: se persa, i fondi nei deposit address non sono recuperabili."
        )

    # Rimuovi 0x prefix se presente
    hex_key = master_key.removeprefix("0x")
    if len(hex_key) != 64:
        raise ValueError(
            f"DEPOSIT_MASTER_KEY malformata: attesi 64 hex chars, trovati {len(hex_key)}. "
            "Formato: 0x + 64 caratteri esadecimali (32 bytes)."
        )

    return bytes.fromhex(hex_key)


def _derive_child_private_key(intent_id: str) -> bytes:
    """
    Deriva una child private key per un intent_id specifico.

    child_key = keccak256(master_key_bytes || intent_id_bytes)

    Questo produce una private key unica e riproducibile per ogni intent.
    La derivazione e' one-way: dall'address non si risale al master.
    """
    master_bytes = _get_master_key_bytes()
    payload = master_bytes + intent_id.encode("utf-8")
    child_key = _keccak256(payload)

    # Assicura che la chiave sia valida per secp256k1 (< curve order)
    # Il curve order di secp256k1 e' ~2^256, quindi quasi tutti i 32-byte
    # hash sono validi. In caso raro di chiave invalida, aggiungiamo un nonce.
    SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    key_int = int.from_bytes(child_key, "big")
    if key_int == 0 or key_int >= SECP256K1_ORDER:
        # Estremamente raro (~1 in 2^128), ma gestiamolo
        child_key = _keccak256(child_key + b"\x01")
        key_int = int.from_bytes(child_key, "big") % SECP256K1_ORDER
        child_key = key_int.to_bytes(32, "big")

    return child_key


# ═══════════════════════════════════════════════════════════════
#  Public API — Address generation
# ═══════════════════════════════════════════════════════════════

def generate_deposit_address(intent_id: str) -> str:
    """
    Genera un indirizzo di deposito con keypair reale per un PaymentIntent.

    L'indirizzo e' controllato da una private key derivata deterministicamente
    da DEPOSIT_MASTER_KEY + intent_id. I fondi inviati a questo indirizzo
    possono essere sweepati ricostruendo la private key.

    Args:
        intent_id: ID univoco del payment intent (es: "pi_abc123...")

    Returns:
        Indirizzo EVM checksummed "0x..." (42 caratteri)
    """
    child_key = _derive_child_private_key(intent_id)
    account: LocalAccount = Account.from_key(child_key)

    # Log solo l'address, MAI la private key
    logger.debug("Generated deposit address for %s: %s", intent_id, account.address)
    return account.address


def get_private_key_for_intent(intent_id: str) -> str:
    """
    Ricostruisce la private key per un intent_id specifico.

    Usata dal sweeper per firmare transazioni di sweep/forward.
    La private key non e' mai salvata nel DB — viene ricalcolata on-demand.

    Args:
        intent_id: ID univoco del payment intent

    Returns:
        Private key come hex string con 0x prefix (es: "0x1234...abcd")
    """
    child_key = _derive_child_private_key(intent_id)
    return "0x" + child_key.hex()


# ═══════════════════════════════════════════════════════════════
#  Sweep — trasferisci fondi dal deposit address al treasury
# ═══════════════════════════════════════════════════════════════

async def sweep_deposit(
    intent_id: str,
    destination: str,
    *,
    token_address: Optional[str] = None,
    currency: str = "ETH",
    chain: str = "BASE",
) -> Optional[str]:
    """
    Sweeppa i fondi da un deposit address verso il destination address.

    Flusso:
      1. Ricostruisce la private key del deposit address
      2. Controlla il balance (native o ERC-20)
      3. Se il deposit address non ha ETH per il gas, invia gas dal hot wallet
      4. Invia tutti i fondi a destination
      5. Ritorna il tx_hash dello sweep

    Args:
        intent_id: ID del payment intent
        destination: Indirizzo destinazione (treasury o merchant wallet)
        token_address: Contratto ERC-20 (None per native ETH)
        currency: "ETH", "USDC", ecc.
        chain: "BASE", "ETH", "ARBITRUM"

    Returns:
        tx_hash dello sweep, oppure None se balance = 0
    """
    from web3 import Web3

    settings = get_settings()

    # ── RPC URL ──────────────────────────────────────────────
    rpc_urls = {
        "BASE": f"https://base-mainnet.g.alchemy.com/v2/{settings.alchemy_api_key}",
        "ETH": f"https://eth-mainnet.g.alchemy.com/v2/{settings.alchemy_api_key}",
        "ARBITRUM": f"https://arb-mainnet.g.alchemy.com/v2/{settings.alchemy_api_key}",
    }
    rpc_url = rpc_urls.get(chain.upper())
    if not rpc_url:
        raise ValueError(f"Chain '{chain}' non supportata per sweep. Supportate: {list(rpc_urls.keys())}")

    w3 = Web3(Web3.HTTPProvider(rpc_url))

    # ── Ricostruisci keypair deposit ─────────────────────────
    child_key = get_private_key_for_intent(intent_id)
    deposit_account: LocalAccount = Account.from_key(child_key)
    deposit_addr = deposit_account.address

    logger.info(
        "Sweep start: intent=%s deposit=%s -> destination=%s currency=%s",
        intent_id, deposit_addr, destination, currency,
    )

    # ── ERC-20 token addresses per chain ─────────────────────
    USDC_ADDRESSES = {
        "BASE": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "ETH": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "ARBITRUM": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    }
    USDT_ADDRESSES = {
        "ETH": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "ARBITRUM": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    }

    # Determina se e' un token ERC-20 o native
    is_native = currency.upper() == "ETH"

    if not is_native and token_address is None:
        # Risolvi automaticamente token address noti
        token_map = {"USDC": USDC_ADDRESSES, "USDT": USDT_ADDRESSES}
        chain_tokens = token_map.get(currency.upper(), {})
        token_address = chain_tokens.get(chain.upper())
        if not token_address:
            raise ValueError(
                f"Token address per {currency} su {chain} non noto. "
                f"Passa token_address esplicitamente."
            )

    # ── Check balance ────────────────────────────────────────
    if is_native:
        balance = w3.eth.get_balance(deposit_addr)
        if balance == 0:
            logger.info("Sweep skip: deposit=%s balance=0 ETH", deposit_addr)
            return None
    else:
        # ERC-20 balance check
        erc20_abi = [
            {
                "constant": True,
                "inputs": [{"name": "_owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "balance", "type": "uint256"}],
                "type": "function",
            },
            {
                "constant": False,
                "inputs": [
                    {"name": "_to", "type": "address"},
                    {"name": "_value", "type": "uint256"},
                ],
                "name": "transfer",
                "outputs": [{"name": "", "type": "bool"}],
                "type": "function",
            },
        ]
        token_contract = w3.eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=erc20_abi,
        )
        balance = token_contract.functions.balanceOf(deposit_addr).call()
        if balance == 0:
            logger.info("Sweep skip: deposit=%s balance=0 %s", deposit_addr, currency)
            return None

    # ── Gas funding: deposit address potrebbe non avere ETH ──
    native_balance = w3.eth.get_balance(deposit_addr)
    gas_price = w3.eth.gas_price
    estimated_gas = 65_000 if not is_native else 21_000
    gas_needed = gas_price * estimated_gas

    if native_balance < gas_needed:
        # Invia gas dal hot wallet
        gas_to_send = gas_needed - native_balance + (gas_price * 5_000)  # margine extra

        hot_wallet_key = settings.sweep_private_key
        if not hot_wallet_key:
            raise ValueError("SWEEP_PRIVATE_KEY non configurato — impossibile inviare gas per lo sweep")

        hot_account: LocalAccount = Account.from_key(hot_wallet_key)
        gas_fund_tx = {
            "from": hot_account.address,
            "to": deposit_addr,
            "value": gas_to_send,
            "gas": 21_000,
            "gasPrice": gas_price,
            "nonce": w3.eth.get_transaction_count(hot_account.address),
            "chainId": w3.eth.chain_id,
        }

        signed_gas_tx = hot_account.sign_transaction(gas_fund_tx)
        gas_tx_hash = w3.eth.send_raw_transaction(signed_gas_tx.raw_transaction)
        w3.eth.wait_for_transaction_receipt(gas_tx_hash, timeout=120)

        logger.info(
            "Gas funded: hot_wallet=%s -> deposit=%s amount=%s wei tx=%s",
            hot_account.address, deposit_addr, gas_to_send, gas_tx_hash.hex(),
        )

    # ── Build sweep TX ───────────────────────────────────────
    nonce = w3.eth.get_transaction_count(deposit_addr)

    if is_native:
        # Sweep native ETH: invia tutto meno il gas
        sweep_gas = 21_000
        sweep_value = w3.eth.get_balance(deposit_addr) - (gas_price * sweep_gas)
        if sweep_value <= 0:
            logger.warning("Sweep skip: insufficient balance after gas for intent=%s", intent_id)
            return None

        sweep_tx = {
            "from": deposit_addr,
            "to": Web3.to_checksum_address(destination),
            "value": sweep_value,
            "gas": sweep_gas,
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": w3.eth.chain_id,
        }
    else:
        # Sweep ERC-20: transfer(destination, balance)
        sweep_tx = token_contract.functions.transfer(
            Web3.to_checksum_address(destination),
            balance,
        ).build_transaction({
            "from": deposit_addr,
            "gas": estimated_gas,
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": w3.eth.chain_id,
        })

    # ── Sign & send ──────────────────────────────────────────
    signed_tx = deposit_account.sign_transaction(sweep_tx)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)

    logger.info(
        "Sweep sent: intent=%s deposit=%s -> %s amount=%s %s tx=%s",
        intent_id, deposit_addr, destination, balance, currency, tx_hash.hex(),
    )

    return tx_hash.hex()
