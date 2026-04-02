from fastapi import APIRouter, HTTPException, Query
from app.services import bags

router = APIRouter()


# get token mint 
@router.get("/token/{mint}")
async def get_token_info(mint: str):
    """
    Validate a Bags token mint address and return pool info + metadata.
    Used by the swap panel to confirm a CA is real before quoting.
    """
    if len(mint) < 32:
        raise HTTPException(status_code=400, detail="Invalid mint address")
    try:
        pool_data = await bags.get_token_by_mint(mint=mint)
        if not pool_data.get("success"):
            raise HTTPException(status_code=404, detail="Token not found on Bags.fm")

        # Enrich with on-chain metadata (name, symbol, decimals)
        meta = await bags.get_token_metadata(mint=mint)

        return {
            "success": True,
            "response": {
                **pool_data.get("response", {}),
                "name":     meta["name"],
                "symbol":   meta["symbol"],
                "decimals": meta["decimals"],
                "supply":   meta["supply"],
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# get token mint quote 
@router.get("/token/{mint}/quote")
async def get_token_quote(
    mint:         str,
    amount:       float = Query(...,   description="Amount in SOL (buy) or tokens (sell)"),
    side:         str   = Query("buy", description="'buy' or 'sell'"),
    decimals:     int   = Query(9,     description="Token decimals (required for sell)"),
    slippageMode: str   = Query("auto"),
    slippageBps:  int   = Query(50),
):
    """
    Get a swap quote for a token CA.
    - buy:  amount is SOL
    - sell: amount is tokens (decimals param required)
    Returns the full quote ready to pass to POST /api/swap.
    """
    if len(mint) < 32:
        raise HTTPException(status_code=400, detail="Invalid mint address")
    if side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be 'buy' or 'sell'")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")
    try:
        data = await bags.get_quote_for_mint(
            mint          = mint,
            amount        = amount,
            side          = side,
            slippage_mode = slippageMode,
            slippage_bps  = slippageBps,
            decimals      = decimals,
        )
        return data
    except ValueError as e:
        # Bags API returned success=false — pass message to frontend
        return {"success": False, "error": str(e)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# get launches 
@router.get("/launches")
async def get_launches(limit: int = Query(20, ge=1, le=100)):
    try:
        return await bags.get_token_launches(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# Get pools 
@router.get("/pools")
async def get_pools():
    try:
        return await bags.get_bags_pools()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


#  get sol-price 
@router.get("/sol-price")
async def get_sol_price():
    """Return current SOL/USD price from Jupiter."""
    import httpx
    from app.core.config import SOL_MINT
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res  = await client.get(
                "https://lite.jupiter.aggregator.io/price",
                params={"ids": SOL_MINT},
            )
            data  = res.json()
            price = float(data["data"][SOL_MINT]["price"])
            return {"success": True, "price": price}
    except Exception as e:
        return {"success": False, "price": 0, "error": str(e)}