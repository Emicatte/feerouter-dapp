"""
RSend AML Service — Anti-Money Laundering wallet screening.

Checks:
1. Blacklist locale (indirizzi noti malevoli/sanzionati)
2. Pattern sospetti (volume, frequenza, hop)
3. Alert automatici su trigger

Fonti blacklist:
- OFAC SDN List (US Treasury)
- EU Sanctions List
- Chainalysis / TRM Labs API (futuro)

Per ora: blacklist locale + API stub per provider esterni.
"""
import logging
from typing import Optional

from sqlalchemy import select
from app.db.session import async_session
from app.models.aml_models import BlacklistedWallet

logger = logging.getLogger("aml")


# Well-known sanctioned addresses (Tornado Cash, etc.)
# Fonte: OFAC Special Designated Nationals (SDN) List
HARDCODED_BLACKLIST = {
    "0x8589427373d6d84e98730d7795d8f6f8731fda16",  # Tornado Cash
    "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",  # Tornado Cash
    "0xd96f2b1cf787cf7e7f2fe874e2b540fb32995cb8",  # Tornado Cash
    "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfbf68",  # Tornado Cash
    # Aggiungi altri da OFAC SDN list
}


async def is_blacklisted(address: str) -> tuple[bool, Optional[str]]:
    """
    Check if an address is blacklisted.
    Returns (is_blocked, reason).
    """
    addr_lower = address.lower()

    # Check hardcoded list
    if addr_lower in HARDCODED_BLACKLIST:
        return True, "OFAC sanctioned address (Tornado Cash)"

    # Check database
    try:
        async with async_session() as db:
            result = await db.execute(
                select(BlacklistedWallet).where(
                    BlacklistedWallet.address == addr_lower,
                    BlacklistedWallet.is_active == True,  # noqa: E712
                )
            )
            entry = result.scalar_one_or_none()
            if entry:
                return True, f"Blacklisted: {entry.reason} (source: {entry.source})"
    except Exception as e:
        logger.warning("AML DB check failed (fail-open): %s", e)

    return False, None


async def screen_transaction(
    from_addr: str,
    to_addr: str,
    amount_wei: str,
    token: str = "ETH",
) -> dict:
    """
    Screen a transaction against AML rules.
    Returns screening result with pass/fail and reasons.
    """
    results = {"passed": True, "flags": [], "blocked": False}

    # Check sender
    blocked, reason = await is_blacklisted(from_addr)
    if blocked:
        results["passed"] = False
        results["blocked"] = True
        results["flags"].append(f"Sender blacklisted: {reason}")
        logger.warning("AML BLOCK: sender %s is blacklisted: %s", from_addr[:10], reason)

    # Check recipient
    blocked, reason = await is_blacklisted(to_addr)
    if blocked:
        results["passed"] = False
        results["blocked"] = True
        results["flags"].append(f"Recipient blacklisted: {reason}")
        logger.warning("AML BLOCK: recipient %s is blacklisted: %s", to_addr[:10], reason)

    # Volume check (high-value alert, non-blocking)
    try:
        amount_int = int(amount_wei)
        if amount_int > 10 * 10**18:  # > 10 ETH
            results["flags"].append(f"High value transaction: {amount_int / 10**18:.4f} ETH")
    except (ValueError, TypeError):
        pass

    return results


async def add_to_blacklist(
    address: str,
    reason: str,
    source: str = "manual",
    added_by: Optional[str] = None,
):
    """Add an address to the blacklist."""
    async with async_session() as db:
        entry = BlacklistedWallet(
            address=address.lower(),
            reason=reason,
            source=source,
            added_by=added_by,
        )
        db.add(entry)
        await db.commit()

    logger.warning("AML: Address %s added to blacklist: %s", address[:10], reason)


async def remove_from_blacklist(address: str):
    """Soft-remove an address from the blacklist."""
    async with async_session() as db:
        from sqlalchemy import update
        await db.execute(
            update(BlacklistedWallet)
            .where(BlacklistedWallet.address == address.lower())
            .values(is_active=False)
        )
        await db.commit()
