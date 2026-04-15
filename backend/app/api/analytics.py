"""
analytics.py — Analytics endpoints powered by Birdeye + Bags API.

GET /api/analytics/top-tokens        → top 10 Bags tokens by market cap
GET /api/analytics/top-traders       → top traders across Bags ecosystem
GET /api/analytics/launches-with-mcap → recent launches enriched with mcap
"""

from fastapi import APIRouter, HTTPException, Query
from app.services import birdeye, bags

router = APIRouter()


# ── GET /api/analytics/top-tokens ────────────────────────────────────────────
@router.get("/analytics/top-tokens")
async def get_top_tokens(limit: int = Query(10, ge=1, le=20)):
    """Top Bags tokens by market cap from Birdeye."""
    try:
        tokens = await birdeye.get_top_tokens_by_mcap(limit=limit)
        return {"success": True, "response": tokens}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── GET /api/analytics/top-traders ───────────────────────────────────────────
@router.get("/analytics/top-traders")
async def get_top_traders(
    timeframe: str = Query("24h", description="24h | 7d | 30d"),
    limit:     int = Query(20, ge=1, le=50),
):
    """Top traders across all Bags tokens aggregated from Birdeye."""
    if timeframe not in ("24h", "7d", "30d"):
        raise HTTPException(status_code=400, detail="timeframe must be 24h, 7d, or 30d")
    try:
        traders = await birdeye.get_top_traders(timeframe=timeframe, limit=limit)
        return {"success": True, "response": traders}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── GET /api/analytics/launches-with-mcap ────────────────────────────────────
@router.get("/analytics/launches-with-mcap")
async def get_launches_with_mcap(limit: int = Query(20, ge=1, le=50)):
    """Recent Bags token launches enriched with market cap from Birdeye."""
    try:
        # Get launches from Bags API
        data    = await bags.get_token_launches(limit=limit)
        launches = data.get("response", []) if data.get("success") else []

        if not launches:
            return {"success": True, "response": []}

        # Get mints from launches
        mints = [l["tokenMint"] for l in launches if l.get("tokenMint")]

        # Enrich with market data from Birdeye
        market_data = await birdeye.get_tokens_market_data(mints)

        enriched = []
        for launch in launches:
            mint = launch.get("tokenMint")
            md   = market_data.get(mint, {})
            enriched.append({
                "name":          launch.get("name")   or launch.get("symbol") or mint[:6] if mint else "???",
                "symbol":        launch.get("symbol") or "???",
                "mint":          mint,
                "status":        launch.get("status") or "",
                "marketCap":     md.get("marketCap", 0),
                "price":         md.get("price", 0),
                "priceChange24h": md.get("priceChange24h", 0),
                "image":         launch.get("image") or "",
                "twitter":       launch.get("twitter") or "",
            })

        # Sort by market cap descending
        enriched.sort(key=lambda x: x["marketCap"] or 0, reverse=True)

        return {"success": True, "response": enriched}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))