import httpx
import asyncio
from app.core.config import BAGS_BASE_URL, BAGS_API_KEY
from app.core.websocket import manager

HEADERS = {
    "x-api-key":    BAGS_API_KEY,
    "Content-Type": "application/json",
}


async def start_trade_stream():
    """Stream real-time trade data to connected WebSocket clients.
    
    TODO: Implement actual trade streaming from Bags API.
    This should connect to Bags WebSocket or poll for trades
    and broadcast to WebSocket clients via manager.
    """
    print("📡 Trade stream started")
    try:
        while True:
            # Placeholder: implement actual trade data fetching here
            await asyncio.sleep(10)  # Prevent busy loop
            # Example: await manager.broadcast({"trade": data})
    except asyncio.CancelledError:
        print("📡 Trade stream stopped")
        raise


async def get_quote(
    input_mint:    str,
    output_mint:   str,
    amount:        int,
    slippage_mode: str = "auto",
    slippage_bps:  int = 50,
) -> dict:
    params = {
        "inputMint":    input_mint,
        "outputMint":   output_mint,
        "amount":       amount,
        "slippageMode": slippage_mode,
    }
    if slippage_mode == "manual":
        params["slippageBps"] = slippage_bps

    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/trade/quote",
            headers=HEADERS,
            params=params,
        )
        res.raise_for_status()
        return res.json()


async def create_swap_transaction(quote_response: dict, user_public_key: str) -> dict:
    """Build a swap transaction from a quote."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            f"{BAGS_BASE_URL}/trade/swap",
            headers=HEADERS,
            json={
                "quoteResponse":  quote_response,
                "userPublicKey":  user_public_key,
            },
        )
        res.raise_for_status()
        return res.json()


async def send_transaction(transaction: str, last_valid_block_height: int) -> dict:
    """Submit a signed transaction to Solana via Bags API."""
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            f"{BAGS_BASE_URL}/transaction/send",
            headers=HEADERS,
            json={
                "transaction":          transaction,
                "lastValidBlockHeight": last_valid_block_height,
            },
        )
        res.raise_for_status()
        return res.json()


async def get_token_launches(limit: int = 20) -> dict:
    """Fetch recent token launches from Bags."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/token/launches",
            headers=HEADERS,
            params={"limit": limit},
        )
        res.raise_for_status()
        return res.json()


async def get_bags_pools() -> dict:
    """Fetch all active Bags liquidity pools."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/pools",
            headers=HEADERS,
        )
        res.raise_for_status()
        return res.json()