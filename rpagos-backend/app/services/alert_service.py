"""
RSends Backend — Alert Service.

Sends critical alerts to Discord/Slack via incoming webhook.
Falls back to Telegram if webhook URL is not configured.

Usage:
    from app.services.alert_service import critical_alert
    await critical_alert("Reconciliation mismatch on chain 8453: 2.3%")

Integrated in:
  - reconciliation mismatch (circuit breaker opened)
  - sweep pipeline failure
  - RPC provider down (circuit breaker opened)
"""

import logging
from datetime import datetime, timezone

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def critical_alert(message: str) -> bool:
    """Send a critical alert to Discord/Slack webhook.

    If ALERT_WEBHOOK_URL is not configured, falls back to Telegram.
    Fire-and-forget: failures are logged, never raised.

    Returns:
        True if sent successfully, False otherwise.
    """
    settings = get_settings()
    webhook_url = settings.alert_webhook_url

    timestamp = datetime.now(timezone.utc).isoformat()
    full_message = f"**RSend CRITICAL**\n{message}\n{timestamp}"

    if webhook_url:
        return await _send_webhook(webhook_url, full_message)

    # Fallback to Telegram
    try:
        from app.services.notification_service import send_telegram_alert
        html_message = (
            f"<b>[CRITICAL]</b>\n{message}\n<i>{timestamp}</i>"
        )
        return await send_telegram_alert(html_message)
    except Exception as exc:
        logger.error("Critical alert failed (no webhook, Telegram error): %s", exc)
        return False


async def _send_webhook(url: str, message: str) -> bool:
    """Post to a Discord or Slack incoming webhook."""
    # Detect Discord vs Slack by URL pattern
    is_discord = "discord.com" in url or "discordapp.com" in url

    if is_discord:
        payload = {"content": message}
    else:
        # Slack format
        payload = {"text": message}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            logger.info("Critical alert sent via webhook: %s", message[:80])
            return True
    except Exception as exc:
        logger.error("Webhook alert failed: %s", exc)
        # Fallback to Telegram on webhook failure
        try:
            from app.services.notification_service import send_telegram_alert
            return await send_telegram_alert(
                f"<b>[CRITICAL]</b>\n{message}"
            )
        except Exception:
            return False
