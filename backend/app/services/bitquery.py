"""
bitquery.py — Real-time Solana trade stream via Bitquery EAP WebSocket.

Subscribes to DEX trades on Solana, normalises each trade into the
BAGS//FLOW wire format, and broadcasts to all connected WS clients.

Wire format (sent to frontend):
{
  "type":   "trade",
  "id":     "<unique str>",
  "token":  "<symbol or short mint>",
  "mint":   "<full mint address>",
  "side":   "BUY" | "SELL",
  "amount": <float USD>,
  "wallet": "<trader address>",
  "tx":     "<signature>",
  "time":   "<ISO-8601 UTC>"
}
"""

import asyncio
import json
import time
import traceback
from datetime import datetime, timezone

import httpx
import websockets

from app.core.config import BITQUERY_API_KEY, BITQUERY_WS_URL, WHALE_THRESHOLD_USD
from app.core.websocket import manager

# ── GraphQL subscription ──────────────────────────────────────────────────────
# Streams all Solana DEX trades in real-time from Bitquery EAP endpoint.
SUBSCRIPTION = """
subscription {
  Solana {
    DEXTradeByTokens(
      where: {
        Trade: { Currency: { MintAddress: { not: "11111111111111111111111111111111" } } }
        Transaction: { Result: { Success: true } }
      }
    ) {
      Transaction { Signature }
      Trade {
        Dex { ProtocolName }
        Side
        Amount
        AmountInUSD
        Currency {
          Symbol
          MintAddress
          Decimals
        }
        Price
        PriceInUSD
        Account { Address }
      }
      Block { Time }
    }
  }
}
"""

# ── Symbol cache (mint → symbol) to avoid repeated lookups ───────────────────
_symbol_cache: dict[str, str] = {}

RECONNECT_DELAY   = 5    # seconds before reconnect on error
MAX_RECONNECT     = 30   # max seconds between reconnect attempts


def _short_mint(mint: str) -> str:
    return f"{mint[:4]}…{mint[-4:]}" if len(mint) > 10 else mint


def _normalise(raw: dict) -> dict | None:
    """Convert a Bitquery DEXTradeByTokens record to BAGS//FLOW wire format."""
    try:
        trade    = raw["Trade"]
        tx_sig   = raw["Transaction"]["Signature"]
        block_t  = raw["Block"]["Time"]

        currency  = trade["Currency"]
        mint      = currency["MintAddress"]
        symbol    = currency.get("Symbol") or _short_mint(mint)
        decimals  = int(currency.get("Decimals", 9))

        amount_usd = float(trade.get("AmountInUSD") or 0)
        side_raw   = str(trade.get("Side", "")).upper()
        # Bitquery returns "buy" side as the currency being bought
        side       = "BUY" if "BUY" in side_raw else "SELL"
        wallet     = trade.get("Account", {}).get("Address", "unknown")

        # Cache symbol
        if mint not in _symbol_cache:
            _symbol_cache[mint] = symbol

        return {
            "type":   "trade",
            "id":     f"{tx_sig[:16]}-{int(time.time()*1000)}",
            "token":  symbol,
            "mint":   mint,
            "decimals": decimals,
            "side":   side,
            "amount": round(amount_usd, 2),
            "wallet": wallet,
            "tx":     tx_sig,
            "time":   block_t or datetime.now(timezone.utc).isoformat(),
            "whale":  amount_usd >= WHALE_THRESHOLD_USD,
        }
    except Exception:
        return None


async def _stream_once():
    """Open one WebSocket session to Bitquery and stream trades until closed."""
    headers = {
        "Authorization": f"Bearer {BITQUERY_API_KEY}",
        "Content-Type":  "application/json",
    }

    print("📡 Connecting to Bitquery stream…")
    async with websockets.connect(
        BITQUERY_WS_URL,
        additional_headers=headers,
        subprotocols=["graphql-ws"],
        ping_interval=20,
        ping_timeout=10,
    ) as ws:
        # graphql-ws handshake
        await ws.send(json.dumps({"type": "connection_init"}))

        ack = json.loads(await ws.recv())
        if ack.get("type") != "connection_ack":
            raise RuntimeError(f"Expected connection_ack, got: {ack}")

        print("✅ Bitquery stream connected")
        manager.set_stream_status(True)
        await manager.broadcast({"type": "status", "stream": "live"})

        # Start subscription
        await ws.send(json.dumps({
            "id":      "bags_trades",
            "type":    "subscribe",
            "payload": {"query": SUBSCRIPTION},
        }))

        async for raw_msg in ws:
            msg = json.loads(raw_msg)

            if msg.get("type") == "next":
                records = (
                    msg.get("payload", {})
                       .get("data", {})
                       .get("Solana", {})
                       .get("DEXTradeByTokens", [])
                )
                for record in records:
                    trade = _normalise(record)
                    if trade:
                        await manager.broadcast(trade)

            elif msg.get("type") == "error":
                print(f"⚠️  Bitquery subscription error: {msg.get('payload')}")

            elif msg.get("type") == "complete":
                print("📡 Bitquery subscription completed")
                break


async def start_trade_stream():
    """
    Persistent loop: connects to Bitquery, streams trades, reconnects on failure.
    Runs as a background task from app lifespan.
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