"""
RSend Backend — Block Polling Fallback Service

Fallback per quando il webhook Alchemy non e' configurato (dev mode).
Ogni 12 secondi (block time di Base) poll eth_getBlockByNumber per
rilevare TX in arrivo sui wallet monitorati.

Attivazione:
  - Se ALCHEMY_WEBHOOK_SECRET e' vuoto -> polling attivo al boot
  - Se ALCHEMY_WEBHOOK_SECRET e' configurato -> polling disabilitato

Supporta:
  - ETH native transfers (via block transactions)
  - ERC-20 Transfer events (via eth_getLogs per Transfer topic)
"""

import asyncio
import logging
from typing import Optional

from sqlalchemy import select

from app.config import get_settings
from app.db.session import async_session
from app.models.forwarding_models import ForwardingRule
from app.services.sweep_service import (
    _rpc_call,
    process_incoming_tx,
    TOKEN_REGISTRY,
)

logger = logging.getLogger("polling_service")

POLL_INTERVAL = 12  # Base L2 block time (seconds)
DEFAULT_CHAIN_ID = 8453  # Base mainnet

# keccak256("Transfer(address,address,uint256)")
TRANSFER_EVENT_TOPIC = (
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
)


class BlockPoller:
    """
    Polls new blocks on a single chain for incoming transactions
    to monitored source wallet addresses.
    """

    def __init__(self, chain_id: int = DEFAULT_CHAIN_ID) -> None:
        self.chain_id = chain_id
        self._last_block: Optional[int] = None
        self._running = False
        self._task: Optional[asyncio.Task] = None

    # ── Lifecycle ────────────────────────────────────────────

    async def start(self) -> None:
        """Start the polling loop as a background task."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info(
            "[poller] Started block polling on chain %d (interval: %ds)",
            self.chain_id,
            POLL_INTERVAL,
        )

    async def stop(self) -> None:
        """Stop the polling loop gracefully."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("[poller] Stopped block polling")

    # ── Monitored addresses ─────────────────────────────────

    async def _get_monitored_addresses(self) -> set[str]:
        """Query all distinct source_wallet addresses from active rules."""
        async with async_session() as db:
            result = await db.execute(
                select(ForwardingRule.source_wallet)
                .where(
                    ForwardingRule.is_active == True,   # noqa: E712
                    ForwardingRule.is_paused == False,   # noqa: E712
                    ForwardingRule.chain_id == self.chain_id,
                )
                .distinct()
            )
            return {row[0].lower() for row in result.all()}

    # ── Main loop ───────────────────────────────────────────

    async def _poll_loop(self) -> None:
        """Main polling loop — runs until stopped."""
        while self._running:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("[poller] Poll cycle error: %s", e)
            await asyncio.sleep(POLL_INTERVAL)

    async def _poll_once(self) -> None:
        """Poll latest block(s) and process transactions."""
        # Get latest block number
        latest_hex = await _rpc_call(self.chain_id, "eth_blockNumber", [])
        latest = int(latest_hex, 16)

        if self._last_block is None:
            # First run: initialize at current block, don't process history
            self._last_block = latest
            logger.info("[poller] Initialized at block %d", latest)
            return

        if latest <= self._last_block:
            return  # No new blocks

        # Get monitored addresses
        monitored = await self._get_monitored_addresses()
        if not monitored:
            self._last_block = latest
            return

        # Process each new block (usually just 1)
        for block_num in range(self._last_block + 1, min(latest + 1, self._last_block + 6)):
            # Cap at 5 blocks per cycle to avoid RPC overload on restart
            block_hex = hex(block_num)
            try:
                block = await _rpc_call(
                    self.chain_id,
                    "eth_getBlockByNumber",
                    [block_hex, True],  # True = include full TX objects
                )
                if not block:
                    continue

                # Process native ETH transfers
                await self._process_native_transfers(block, monitored)

                # Process ERC-20 Transfer events via logs
                await self._process_erc20_transfers(block_hex, monitored)

            except Exception as e:
                logger.warning("[poller] Block %d error: %s", block_num, e)

        self._last_block = latest

    # ── Native ETH transfers ────────────────────────────────

    async def _process_native_transfers(
        self, block: dict, monitored: set[str]
    ) -> None:
        """Check block transactions for native ETH transfers to monitored addresses."""
        block_num = block.get("number")

        for tx in block.get("transactions", []):
            to_addr = (tx.get("to") or "").lower()
            if to_addr not in monitored:
                continue

            from_addr = (tx.get("from") or "").lower()
            tx_hash = tx.get("hash", "")
            value_hex = tx.get("value", "0x0")
            value_wei = int(value_hex, 16)

            # Skip zero-value TXs (contract calls, ERC-20 approvals, etc.)
            if value_wei == 0:
                continue

            value_eth = value_wei / 1e18

            logger.info(
                "[poller] Native ETH: %s -> %s | %.6f ETH | tx=%s | block=%s",
                from_addr[:10],
                to_addr[:10],
                value_eth,
                tx_hash[:16],
                block_num,
            )

            try:
                await process_incoming_tx(
                    from_addr=from_addr,
                    to_addr=to_addr,
                    value=value_eth,
                    tx_hash=tx_hash,
                    asset="ETH",
                    token_address=None,
                    token_decimals=18,
                    block_num=block_num,
                )
            except Exception as e:
                logger.error(
                    "[poller] process_incoming_tx (ETH) failed for %s: %s",
                    tx_hash[:16],
                    e,
                )

    # ── ERC-20 Transfer events ──────────────────────────────

    async def _process_erc20_transfers(
        self, block_hex: str, monitored: set[str]
    ) -> None:
        """
        Check ERC-20 Transfer(from, to, value) events in a block.

        Uses eth_getLogs with topic filter:
          topic[0] = Transfer event signature
          topic[2] = recipient address (padded to 32 bytes)
        """
        # Build topic filter: 'to' address is topic[2] in Transfer event
        # Pad each monitored address to bytes32 for topic matching
        padded_addrs = [
            "0x" + addr.replace("0x", "").zfill(64) for addr in monitored
        ]

        try:
            logs = await _rpc_call(
                self.chain_id,
                "eth_getLogs",
                [
                    {
                        "fromBlock": block_hex,
                        "toBlock": block_hex,
                        "topics": [
                            TRANSFER_EVENT_TOPIC,
                            None,           # topic[1] = from (any)
                            padded_addrs,   # topic[2] = to (our addresses)
                        ],
                    }
                ],
            )
        except Exception as e:
            logger.debug(
                "[poller] ERC-20 log query failed for block %s: %s",
                block_hex,
                e,
            )
            return

        if not logs:
            return

        for log_entry in logs:
            token_contract = (log_entry.get("address") or "").lower()
            topics = log_entry.get("topics", [])
            data = log_entry.get("data", "0x")
            tx_hash = log_entry.get("transactionHash", "")
            log_block = log_entry.get("blockNumber")

            if len(topics) < 3:
                continue

            # Decode from/to from topics (last 40 hex chars = 20 bytes = address)
            from_addr = "0x" + topics[1][-40:]
            to_addr = "0x" + topics[2][-40:]

            if to_addr.lower() not in monitored:
                continue

            # Decode transfer value from data
            raw_value = int(data, 16) if data and data != "0x" else 0
            if raw_value == 0:
                continue

            # Look up token info from registry
            token_key = (self.chain_id, token_contract)
            token_info = TOKEN_REGISTRY.get(token_key)
            decimals = token_info["decimals"] if token_info else 18
            symbol = token_info["symbol"] if token_info else "ERC20"

            value_human = raw_value / (10**decimals)

            logger.info(
                "[poller] ERC-20: %.4f %s -> %s | contract=%s | tx=%s",
                value_human,
                symbol,
                to_addr[:10],
                token_contract[:10],
                tx_hash[:16],
            )

            try:
                await process_incoming_tx(
                    from_addr=from_addr.lower(),
                    to_addr=to_addr.lower(),
                    value=value_human,
                    tx_hash=tx_hash,
                    asset=symbol,
                    token_address=token_contract,
                    token_decimals=decimals,
                    block_num=log_block,
                )
            except Exception as e:
                logger.error(
                    "[poller] process_incoming_tx (ERC-20) failed for %s: %s",
                    tx_hash[:16],
                    e,
                )


# ═══════════════════════════════════════════════════════════════
#  Module-level singleton & startup helper
# ═══════════════════════════════════════════════════════════════

_poller: Optional[BlockPoller] = None


async def start_polling_if_needed() -> Optional[BlockPoller]:
    """
    Start the block poller if ALCHEMY_WEBHOOK_SECRET is NOT configured.

    Called at application startup (lifespan). If the webhook secret is
    present, polling is skipped — the webhook handler takes over.
    """
    global _poller
    settings = get_settings()

    if settings.alchemy_webhook_secret:
        logger.info(
            "[poller] Alchemy webhook secret configured — polling disabled"
        )
        return None

    if _poller is not None:
        return _poller

    logger.info(
        "[poller] No webhook secret — starting fallback block polling"
    )
    _poller = BlockPoller(chain_id=DEFAULT_CHAIN_ID)
    await _poller.start()
    return _poller


async def stop_polling() -> None:
    """Stop the block poller (called at shutdown)."""
    global _poller
    if _poller:
        await _poller.stop()
        _poller = None
