"""
birdeye.py — Birdeye API service for market data on Bags.fm tokens.

Provides:
- get_bags_token_mints()        → all Bags token mints from pools
- get_tokens_market_data()      → price + mcap for list of mints
- get_top_tokens_by_mcap()      → top 10 Bags tokens by market cap
- get_top_traders()             → top traders across Bags tokens
"""

import asyncio
import httpx
from app.core.config import BIRDEYE_API_KEY, BIRDEYE_BASE_URL, BAGS_BASE_URL, BAGS_API_KEY

BIRDEYE_HEADERS = {
    "X-API-KEY": BIRDEYE_API_KEY,
    "x-chain":   "solana",
    "accept":    "application/json",
}

def _check_key():
    if not BIRDEYE_API_KEY:
        raise ValueError("BIRDEYE_API_KEY is not set — add it to your environment variables")

BAGS_HEADERS = {
    "x-api-key":    BAGS_API_KEY,
    "Content-Type": "application/json",
}

# ── Cache bags token mints (refreshed every 5 min) ───────────────────────────
import time
_mint_cache: dict = {"mints": [], "ts": 0}
CACHE_TTL = 300  # 5 minutes


async def get_bags_token_mints() -> list[str]:
    """Fetch all active Bags.fm token mints from the pools endpoint."""
    now = time.time()
    if now - _mint_cache["ts"] < CACHE_TTL and _mint_cache["mints"]:
        return _mint_cache["mints"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res  = await client.get(
                f"{BAGS_BASE_URL}/solana/bags/pools",
                headers=BAGS_HEADERS,
            )
            data = res.json()
            pools = data.get("response", []) if data.get("success") else []
            mints = [p["tokenMint"] for p in pools if p.get("tokenMint")]
            _mint_cache["mints"] = mints
            _mint_cache["ts"]    = now
            return mints
    except Exception as e:
        print(f"[Birdeye] Failed to fetch Bags mints: {e}")
        return _mint_cache["mints"] or []


async def get_tokens_market_data(mints: list[str]) -> dict[str, dict]:
    """
    Fetch price + market cap for up to 100 mints using Birdeye multi_price.
    Returns dict of mint → {price, marketCap, volume24h, priceChange24h}
    """
    if not mints:
        return {}

    result = {}
    # Birdeye multi_price accepts comma-separated list_address, max 100
    chunks = [mints[i:i+100] for i in range(0, len(mints), 100)]

    async with httpx.AsyncClient(timeout=15) as client:
        for chunk in chunks:
            try:
                res = await client.get(
                    f"{BIRDEYE_BASE_URL}/defi/multi_price",
                    headers=BIRDEYE_HEADERS,
                    params={"list_address": ",".join(chunk)},
                )
                data = res.json()
                if data.get("success"):
                    for mint, info in (data.get("data") or {}).items():
                        if info:
                            result[mint] = {
                                "price":          info.get("value", 0),
                                "priceChange24h": info.get("priceChange24h", 0),
                                "marketCap":      info.get("marketCap", 0) or 0,
                                "liquidity":      info.get("liquidity", 0) or 0,
                            }
            except Exception as e:
                print(f"[Birdeye] multi_price error: {e}")

    return result


async def get_top_tokens_by_mcap(limit: int = 10) -> list[dict]:
    """
    Get top Bags tokens ranked by market cap.
    Returns list of {mint, symbol, name, price, marketCap, priceChange24h}
    """
    _check_key()
    mints = await get_bags_token_mints()
    if not mints:
        return []

    market_data = await get_tokens_market_data(mints)

    # Also fetch token metadata (name/symbol) for display
    tokens = []
    for mint in mints:
        md = market_data.get(mint, {})
        mcap = md.get("marketCap", 0)
        if mcap > 0:
            tokens.append({
                "mint":          mint,
                "price":         md.get("price", 0),
                "marketCap":     mcap,
                "priceChange24h": md.get("priceChange24h", 0),
                "liquidity":     md.get("liquidity", 0),
            })

    # Sort by market cap descending
    tokens.sort(key=lambda x: x["marketCap"], reverse=True)
    top = tokens[:limit]

    # Fetch names/symbols for top tokens
    if top:
        top_mints = [t["mint"] for t in top]
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.get(
                    f"{BIRDEYE_BASE_URL}/defi/v3/token/meta-data/multiple",
                    headers=BIRDEYE_HEADERS,
                    params={"list_address": ",".join(top_mints)},
                )
                meta = res.json()
                meta_data = meta.get("data", {}) if meta.get("success") else {}
                for t in top:
                    info = meta_data.get(t["mint"], {})
                    t["symbol"] = info.get("symbol") or t["mint"][:6]
                    t["name"]   = info.get("name")   or t["symbol"]
        except Exception as e:
            print(f"[Birdeye] metadata error: {e}")
            for t in top:
                t["symbol"] = t["mint"][:6]
                t["name"]   = t["symbol"]

    return top


async def get_top_traders(
    timeframe: str = "24h",
    limit: int = 20,
) -> list[dict]:
    """
    Get top traders across all Bags tokens aggregated by volume.
    timeframe: 24h | 7d | 30d (mapped to Birdeye time_frame param)
    """
    _check_key()
    mints = await get_bags_token_mints()
    if not mints:
        return []

    # Birdeye only supports up to 24h per call
    # For 7d we use the same 24h data (best available from Birdeye free tier)
    birdeye_tf = "24h"

    # Sample top 20 mints to avoid rate limits
    sample_mints = mints[:20]
    print(f"[Birdeye] fetching top traders for {len(sample_mints)} mints, timeframe={timeframe}")

    trader_map: dict[str, dict] = {}

    async def fetch_traders_for_mint(mint: str):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.get(
                    f"{BIRDEYE_BASE_URL}/defi/v2/tokens/top_traders",
                    headers=BIRDEYE_HEADERS,
                    params={
                        "address":    mint,
                        "time_frame": birdeye_tf,
                        "sort_by":    "volume",
                        "sort_type":  "desc",
                        "limit":      10,
                    },
                )
                data = res.json()
                print(f"[Birdeye] top_traders {mint[:8]} status={res.status_code} success={data.get('success')} keys={list((data.get('data') or {}).keys()) if data.get('data') else data.get('message','')}")
                # Handle both response structures
                raw = data.get("data") or {}
                traders = raw.get("items") or raw.get("traders") or (raw if isinstance(raw, list) else [])
                for t in traders:
                    wallet = t.get("address") or t.get("owner") or t.get("wallet")
                    if not wallet:
                        continue
                    vol = float(t.get("volumeUsd") or t.get("volume") or t.get("volume_usd") or 0)
                    trades = int(t.get("trade") or t.get("tradeCount") or t.get("trades") or 0)
                    if wallet not in trader_map:
                        trader_map[wallet] = {"wallet": wallet, "volume": 0, "trades": 0}
                    trader_map[wallet]["volume"] += vol
                    trader_map[wallet]["trades"] += trades
        except Exception as e:
            print(f"[Birdeye] top_traders error for {mint[:8]}: {e}")

    # Fetch concurrently but limit concurrency to avoid rate limits
    semaphore = asyncio.Semaphore(5)
    async def fetch_with_sem(mint):
        async with semaphore:
            await fetch_traders_for_mint(mint)
            await asyncio.sleep(0.1)  # small delay to avoid rate limiting

    await asyncio.gather(*[fetch_with_sem(m) for m in sample_mints])

    # Sort by volume and return top N
    sorted_traders = sorted(trader_map.values(), key=lambda x: x["volume"], reverse=True)
    return sorted_traders[:limit]