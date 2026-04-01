"""
bitquery.py — Real-time Solana trade stream via Helius WebSocket.

Subscribes to logs from the Meteora DAMM v2 and Bags.fm program addresses,
parses swap events, enriches with token metadata, and broadcasts to all
connected WS clients.

Wire format (sent to frontend):
{
  "type":     "trade",
  "id":       "<unique str>",
  "token":    "<symbol or short mint>",
  "mint":     "<token mint address>",
  "side":     "BUY" | "SELL",
  "amount":   <float USD>,
  "wallet":   "<trader address>",
  "tx":       "<signature>",
  "time":     "<ISO-8601 UTC>",
  "whale":    <bool>
}
"""

import asyncio
import json
import time
import traceback
from datetime import datetime, timezone

import websockets

from app.core.config import HELIUS_API_KEY, HELIUS_RPC_URL, WHALE_THRESHOLD_USD
from app.core.websocket import manager

# ── Bags.fm / Meteora program addresses to watch ─────────────────────────────
WATCH_PROGRAMS = [
    "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",  # Meteora DBC (Bags launches)
    "BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv",  # Bags.fm creator program
]

RECONNECT_DELAY = 5
MAX_RECONNECT   = 30

# ── Symbol cache ──────────────────────────────────────────────────────────────
_symbol_cache: dict[str, str] = {}


def _short_mint(mint: str) -> str:
    return f"{mint[:4]}…{mint[-4:]}" if len(mint) > 10 else mint


def _build_ws_url() -> str:
    """Use Helius RPC WebSocket endpoint."""
    key = HELIUS_API_KEY
    if key:
        return f"wss://mainnet.helius-rpc.com/?api-key={key}"
    return "wss://api.mainnet-beta.solana.com"


async def _get_token_symbol(mint: str) -> str:
    """Fetch token symbol via Helius DAS, with caching."""
    if mint in _symbol_cache:
        return _symbol_cache[mint]

    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.post(
                HELIUS_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id": "sym",
                    "method": "getAsset",
                    "params": {"id": mint},
                },
            )
            asset  = res.json().get("result", {})
            symbol = (
                asset.get("content", {})
                     .get("metadata", {})
                     .get("symbol")
                or _short_mint(mint)
            )
            _symbol_cache[mint] = symbol
            return symbol
    except Exception:
        return _short_mint(mint)


def _parse_logs(logs: list[str], signature: str, accounts: list[str]) -> dict | None:
    """
    Parse swap event from transaction logs.
    Looks for swap-related log entries and extracts trade info.
    """
    is_swap = any(
        any(kw in log.lower() for kw in ["swap", "trade", "buy", "sell", "amm", "pool"])
        for log in logs
    )
    if not is_swap:
        return None

    # Determine side from logs
    side = "BUY"
    for log in logs:
        l = log.lower()
        if "sell" in l or "output" in l:
            side = "SELL"
            break

    # Try to extract amount from logs (look for numeric patterns)
    amount_usd = 0.0
    for log in logs:
        if "amount" in log.lower():
            parts = log.split()
            for p in parts:
                try:
                    val = float(p.replace(",", ""))
                    if val > amount_usd:
                        amount_usd = val
                except ValueError:
                    continue

    # Use first non-program account as the token mint guess
    known_programs = set(WATCH_PROGRAMS + [
        "11111111111111111111111111111111",
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bF3",
        "ComputeBudget111111111111111111111111111111",
    ])
    mint = next(
        (a for a in accounts if len(a) >= 32 and a not in known_programs),
        accounts[0] if accounts else "unknown"
    )

    wallet = accounts[-1] if len(accounts) > 1 else "unknown"

    return {
        "type":    "trade",
        "id":      f"{signature[:16]}-{int(time.time()*1000)}",
        "token":   _symbol_cache.get(mint, _short_mint(mint)),
        "mint":    mint,
        "side":    side,
        "amount":  round(amount_usd, 2),
        "wallet":  wallet,
        "tx":      signature,
        "time":    datetime.now(timezone.utc).isoformat(),
        "whale":   amount_usd >= WHALE_THRESHOLD_USD,
    }


async def _stream_once():
    """Open one WebSocket session to Helius and stream trades."""
    ws_url = _build_ws_url()
    print(f"📡 Connecting to Helius stream…")

    async with websockets.connect(
        ws_url,
        ping_interval=20,
        ping_timeout=10,
    ) as ws:
        # Subscribe to logs mentioning our programs
        for i, program in enumerate(WATCH_PROGRAMS):
            await ws.send(json.dumps({
                "jsonrpc": "2.0",
                "id":      i + 1,
                "method":  "logsSubscribe",
                "params":  [
                    {"mentions": [program]},
                    {"commitment": "confirmed"},
                ],
            }))

        print("✅ Helius stream connected")
        manager.set_stream_status(True)
        await manager.broadcast({"type": "status", "stream": "live"})

        async for raw_msg in ws:
            msg = json.loads(raw_msg)

            # Subscription confirmation
            if "result" in msg:
                continue

            # Incoming log notification
            params = msg.get("params", {})
            value  = params.get("result", {}).get("value", {})
            if not value:
                continue

            logs      = value.get("logs", [])
            signature = value.get("signature", "")
            err       = value.get("err")

            # Skip failed transactions
            if err:
                continue

            # Get account keys from the transaction
            accounts = []
            tx_data  = value.get("transaction", {})
            if isinstance(tx_data, dict):
                msg_data = tx_data.get("message", {})
                if isinstance(msg_data, dict):
                    accounts = msg_data.get("accountKeys", [])

            trade = _parse_logs(logs, signature, accounts)
            if not trade:
                continue

            # Async fetch symbol if not cached
            if trade["mint"] not in _symbol_cache and trade["mint"] != "unknown":
                asyncio.create_task(_enrich_and_broadcast(trade))
            else:
                await manager.broadcast(trade)


async def _enrich_and_broadcast(trade: dict):
    """Fetch token symbol then broadcast."""
    symbol = await _get_token_symbol(trade["mint"])
    trade["token"] = symbol
    await manager.broadcast(trade)


async def start_trade_stream():
    """
    Persistent loop: connects to Helius, streams trades, reconnects on failure.
    """
    delay = RECONNECT_DELAY
    while True:
        try:
            await _stream_once()
        except asyncio.CancelledError:
            print("📡 Trade stream cancelled — shutting down")
            manager.set_stream_status(False)
            raise
        except Exception as e:
            manager.set_stream_status(False)
            await manager.broadcast({"type": "status", "stream": "reconnecting"})
            print(f"⚠️  Trade stream error: {e} — reconnecting in {delay}s")
            traceback.print_exc()
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RECONNECT)
        else:
            delay = RECONNECT_DELAY