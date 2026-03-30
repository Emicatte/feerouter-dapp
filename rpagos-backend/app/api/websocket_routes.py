"""
RSend Backend — WebSocket Sweep Feed (Command Center)

WS /ws/sweep-feed/{owner_address}

Message types (server → client):
  - incoming_detected   — Alchemy webhook rileva TX in entrata
  - sweep_executing     — sweep parte
  - sweep_completed     — sweep confermato on-chain
  - sweep_error         — sweep fallito
  - stats_update        — ogni 30s con gas/volume/count
  - rule_updated        — regola modificata
  - emergency_stop      — emergency stop triggerato

Client → server:
  - {"type": "replay", "after_event_id": <int>}  — richiedi eventi persi
  - {"type": "pong"}                              — risposta a ping
"""

import asyncio
import json
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import case, func, select

from app.db.session import async_session
from app.models.forwarding_models import ForwardingRule, SweepLog, SweepStatus
from app.services.cache_service import get_redis

ws_router = APIRouter()

ETH_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
MAX_CONNS_PER_OWNER = 5
EVENT_BUFFER_SIZE = 50
REDIS_EVENTS_KEY = "ws:events:{owner}"
REDIS_EVENT_TTL = 3600  # 1h


# ═══════════════════════════════════════════════════════════
#  Connection Manager
# ═══════════════════════════════════════════════════════════

class SweepFeedManager:
    """Gestisce connessioni WebSocket per owner_address."""

    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)
        self._event_counter: int = int(time.time() * 1000)
        self._bg_tasks: list[asyncio.Task] = []

    # ── Lifecycle ───────────────────────────────────────

    def start_background_tasks(self) -> None:
        self._bg_tasks.append(asyncio.create_task(self._heartbeat_loop()))
        self._bg_tasks.append(asyncio.create_task(self._stats_loop()))

    async def shutdown(self) -> None:
        for task in self._bg_tasks:
            task.cancel()
        await asyncio.gather(*self._bg_tasks, return_exceptions=True)
        self._bg_tasks.clear()
        # Chiudi tutte le connessioni
        for owner, sockets in list(self._connections.items()):
            for ws in sockets:
                try:
                    await ws.close(code=1001, reason="server_shutdown")
                except Exception:
                    pass
            sockets.clear()

    # ── Connect / Disconnect ────────────────────────────

    async def connect(self, owner: str, ws: WebSocket) -> bool:
        if len(self._connections[owner]) >= MAX_CONNS_PER_OWNER:
            return False
        await ws.accept()
        self._connections[owner].append(ws)
        return True

    def disconnect(self, owner: str, ws: WebSocket) -> None:
        conns = self._connections.get(owner, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(owner, None)

    @property
    def active_connections(self) -> int:
        return sum(len(v) for v in self._connections.values())

    def connected_owners(self) -> set[str]:
        return set(self._connections.keys())

    # ── Broadcast ───────────────────────────────────────

    async def broadcast(
        self,
        owner: str,
        event_type: str,
        data: dict,
    ) -> None:
        """Invia evento a tutti i client dell'owner e salva in Redis buffer."""
        self._event_counter += 1
        event = {
            "event_id": self._event_counter,
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data,
        }

        # Salva in Redis per replay
        await self._push_event(owner, event)

        # Invia a tutte le connessioni dell'owner
        dead: list[WebSocket] = []
        for ws in self._connections.get(owner, []):
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(owner, ws)

    async def broadcast_to_all(self, event_type: str, data: dict) -> None:
        """Broadcast a TUTTI gli owner connessi (es. gas price update globale)."""
        for owner in list(self._connections.keys()):
            await self.broadcast(owner, event_type, data)

    # ── Redis Event Buffer ──────────────────────────────

    async def _push_event(self, owner: str, event: dict) -> None:
        try:
            r = await get_redis()
            key = REDIS_EVENTS_KEY.format(owner=owner)
            await r.lpush(key, json.dumps(event, default=str))
            await r.ltrim(key, 0, EVENT_BUFFER_SIZE - 1)
            await r.expire(key, REDIS_EVENT_TTL)
        except Exception:
            pass  # Redis down — eventi non bufferizzati, non bloccare

    async def get_missed_events(
        self, owner: str, after_event_id: int
    ) -> list[dict]:
        """Ritorna eventi con event_id > after_event_id (per reconnect)."""
        try:
            r = await get_redis()
            key = REDIS_EVENTS_KEY.format(owner=owner)
            raw_list = await r.lrange(key, 0, EVENT_BUFFER_SIZE - 1)
            events = []
            for raw in reversed(raw_list):  # LPUSH → più recente è a indice 0
                ev = json.loads(raw)
                if ev.get("event_id", 0) > after_event_id:
                    events.append(ev)
            return events
        except Exception:
            return []

    # ── Background: Heartbeat (15s) ─────────────────────

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(15)
            ping = {"type": "ping", "timestamp": datetime.now(timezone.utc).isoformat()}
            dead_pairs: list[tuple[str, WebSocket]] = []
            for owner, sockets in list(self._connections.items()):
                for ws in sockets:
                    try:
                        await ws.send_json(ping)
                    except Exception:
                        dead_pairs.append((owner, ws))
            for owner, ws in dead_pairs:
                self.disconnect(owner, ws)

    # ── Background: Stats (30s) ─────────────────────────

    async def _stats_loop(self) -> None:
        while True:
            await asyncio.sleep(30)
            owners = list(self._connections.keys())
            if not owners:
                continue

            for owner in owners:
                if owner not in self._connections:
                    continue
                try:
                    stats = await self._build_stats(owner)
                    await self.broadcast(owner, "stats_update", stats)
                except Exception:
                    pass

    async def _build_stats(self, owner: str) -> dict:
        """Costruisci stats 24h per un owner."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        async with async_session() as db:
            # Rule IDs dell'owner
            rule_ids_q = select(ForwardingRule.id).where(
                ForwardingRule.user_id == owner
            )

            result = await db.execute(
                select(
                    func.count().label("sweep_count_24h"),
                    func.count().filter(
                        SweepLog.status == SweepStatus.completed
                    ).label("completed_24h"),
                    func.coalesce(func.sum(SweepLog.amount_human), 0).label("volume_eth_24h"),
                    func.coalesce(
                        func.sum(
                            case(
                                (SweepLog.amount_usd.isnot(None), SweepLog.amount_usd),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("volume_usd_24h"),
                    func.coalesce(
                        func.sum(
                            case(
                                (SweepLog.gas_cost_eth.isnot(None), SweepLog.gas_cost_eth),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("gas_spent_24h"),
                ).where(
                    SweepLog.rule_id.in_(rule_ids_q),
                    SweepLog.created_at >= cutoff,
                )
            )
            row = result.one()

            # Active rules count
            active_q = await db.execute(
                select(func.count()).select_from(ForwardingRule).where(
                    ForwardingRule.user_id == owner,
                    ForwardingRule.is_active == True,   # noqa: E712
                    ForwardingRule.is_paused == False,   # noqa: E712
                )
            )
            active_rules = active_q.scalar()

        # Gas price corrente via RPC
        gas_gwei = await self._fetch_gas_price()

        return {
            "sweep_count_24h": row.sweep_count_24h,
            "completed_24h": row.completed_24h,
            "volume_eth_24h": round(float(row.volume_eth_24h), 6),
            "volume_usd_24h": round(float(row.volume_usd_24h), 2),
            "gas_spent_eth_24h": round(float(row.gas_spent_24h), 8),
            "current_gas_gwei": gas_gwei,
            "active_rules": active_rules,
            "connected_clients": len(self._connections.get(owner, [])),
        }

    async def _fetch_gas_price(self) -> Optional[float]:
        """Fetch gas price corrente da Base RPC."""
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                res = await client.post(
                    "https://mainnet.base.org",
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "eth_gasPrice",
                        "params": [],
                    },
                    timeout=5,
                )
                gas_wei = int(res.json().get("result", "0x0"), 16)
                return round(gas_wei / 1e9, 4)
        except Exception:
            return None


# ═══════════════════════════════════════════════════════════
#  Singleton
# ═══════════════════════════════════════════════════════════

feed_manager = SweepFeedManager()


# ═══════════════════════════════════════════════════════════
#  WebSocket Endpoint
# ═══════════════════════════════════════════════════════════

@ws_router.websocket("/ws/sweep-feed/{owner_address}")
async def sweep_feed(websocket: WebSocket, owner_address: str):
    owner = owner_address.lower()

    # Valida indirizzo
    if not ETH_ADDR_RE.match(owner_address):
        await websocket.close(code=4001, reason="invalid_address")
        return

    # Limite connessioni
    if not await feed_manager.connect(owner, websocket):
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "data": {"message": f"Max {MAX_CONNS_PER_OWNER} connections per address"},
        })
        await websocket.close(code=4002, reason="max_connections")
        return

    # Welcome message
    await websocket.send_json({
        "type": "connected",
        "data": {
            "owner": owner,
            "buffer_size": EVENT_BUFFER_SIZE,
            "heartbeat_interval_sec": 15,
            "stats_interval_sec": 30,
        },
    })

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "data": {"message": "Invalid JSON"},
                })
                continue

            msg_type = msg.get("type")

            if msg_type == "pong":
                # Heartbeat response — noop
                continue

            elif msg_type == "replay":
                # Client vuole eventi persi dopo riconnessione
                after_id = msg.get("after_event_id", 0)
                if not isinstance(after_id, (int, float)):
                    after_id = 0
                missed = await feed_manager.get_missed_events(owner, int(after_id))
                await websocket.send_json({
                    "type": "replay_response",
                    "data": {
                        "events": missed,
                        "count": len(missed),
                    },
                })

            else:
                await websocket.send_json({
                    "type": "error",
                    "data": {"message": f"Unknown message type: {msg_type}"},
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        feed_manager.disconnect(owner, websocket)
