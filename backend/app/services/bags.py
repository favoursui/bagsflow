import httpx
from app.core.config import BAGS_BASE_URL, BAGS_API_KEY

HEADERS = {
    "x-api-key":    BAGS_API_KEY,
    "Content-Type": "application/json",
}


# ── Quote & Swap ──────────────────────────────────────────────────────────────

async def get_quote(
    input_mint:    str,
    output_mint:   str,
    amount:        int,
    slippage_mode: str = "auto",
    slippage_bps:  int = 50,
) -> dict:
    """Fetch a trade quote from Bags API."""
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
            f"{BAGS_BASE_URL}/solana/transaction/send",
            headers=HEADERS,
            json={
                "transaction":          transaction,
                "lastValidBlockHeight": last_valid_block_height,
            },
        )
        res.raise_for_status()
        return res.json()


# ── Token & Pool ──────────────────────────────────────────────────────────────

async def get_token_launches(limit: int = 20) -> dict:
    """Fetch recent token launches from Bags."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/token/launch/feed",
            headers=HEADERS,
            params={"limit": limit},
        )
        res.raise_for_status()
        return res.json()


async def get_bags_pools() -> dict:
    """Fetch all active Bags liquidity pools."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/solana/bags/pools",
            headers=HEADERS,
        )
        res.raise_for_status()
        return res.json()


async def get_token_by_mint(mint: str) -> dict:
    """Fetch pool info for a given token mint address."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/solana/bags/pools/token-mint",
            headers=HEADERS,
            params={"tokenMint": mint},
        )
        res.raise_for_status()
        return res.json()


async def get_token_metadata(mint: str) -> dict:
    """
    Fetch token name, symbol, decimals from Helius enhanced metadata API.
    Falls back to basic mint info if unavailable.
    """
    from app.core.config import HELIUS_RPC_URL
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            HELIUS_RPC_URL,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getAccountInfo",
                "params": [mint, {"encoding": "jsonParsed"}],
            },
        )
        data     = res.json()
        info     = data.get("result", {}).get("value", {}).get("data", {}).get("parsed", {}).get("info", {})
        decimals = info.get("decimals", 9)
        supply   = info.get("supply", "0")

    # Try Helius DAS for name/symbol
    name, symbol = mint[:6] + "…", "???"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            das = await client.post(
                HELIUS_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id": "das",
                    "method": "getAsset",
                    "params": {"id": mint},
                },
            )
            asset = das.json().get("result", {})
            name   = asset.get("content", {}).get("metadata", {}).get("name", name)
            symbol = asset.get("content", {}).get("metadata", {}).get("symbol", symbol)
    except Exception:
        pass

    return {"name": name, "symbol": symbol, "decimals": decimals, "supply": supply}


async def get_quote_for_mint(
    mint:          str,
    amount_sol:    float,
    side:          str = "buy",
    slippage_mode: str = "auto",
    slippage_bps:  int = 50,
) -> dict:
    """
    Get a swap quote for a token mint.
    Converts SOL amount to lamports and sets input/output mints by side.
    """
    from app.core.config import SOL_MINT
    lamports = int(amount_sol * 1_000_000_000)

    if side == "buy":
        input_mint, output_mint = SOL_MINT, mint
    else:
        input_mint, output_mint = mint, SOL_MINT

    return await get_quote(
        input_mint    = input_mint,
        output_mint   = output_mint,
        amount        = lamports,
        slippage_mode = slippage_mode,
        slippage_bps  = slippage_bps,
    )


# ── Analytics ─────────────────────────────────────────────────────────────────

async def get_token_lifetime_fees(mint: str) -> dict:
    """Fetch lifetime fee stats for a token."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/solana/bags/analytics/fees/lifetime",
            headers=HEADERS,
            params={"tokenMint": mint},
        )
        res.raise_for_status()
        return res.json()