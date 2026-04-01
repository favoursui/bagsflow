import httpx
from app.core.config import BAGS_BASE_URL, BAGS_API_KEY

HEADERS = {
    "x-api-key":    BAGS_API_KEY,
    "Content-Type": "application/json",
}


# Quote & Swap 

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
        "amount":       str(amount),   # send as string to avoid float precision issues
        "slippageMode": slippage_mode,
    }
    if slippage_mode == "manual":
        params["slippageBps"] = slippage_bps

    print(f"[QUOTE] params: {params}")

    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/trade/quote",
            headers=HEADERS,
            params=params,
        )
        data = res.json()
        print(f"[QUOTE] status={res.status_code} response={data}")

        if res.status_code == 500:
            raise ValueError("Bags API is unavailable — try again in a moment")
        if res.status_code == 400:
            raw = data.get("error") or data.get("message") or ""
            raise ValueError(raw or "Quote request rejected — try a different amount")
        if res.status_code == 404:
            raise ValueError("Token not found on Bags.fm — it may not have a pool yet")

        if not data.get("success"):
            # Extract the real message from Bags if available
            raw_error = data.get("error") or ""
            if "liquidity" in raw_error.lower():
                raise ValueError("Not enough liquidity for this trade")
            elif "amount" in raw_error.lower():
                raise ValueError(f"Invalid amount — {raw_error}")
            elif "slippage" in raw_error.lower():
                raise ValueError("Slippage too low — try increasing it")
            else:
                raise ValueError(raw_error or "Quote failed — try a smaller amount")

        return data


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


# Token & Pool 

async def get_token_launches(limit: int = 20) -> dict:
    """Fetch recent token launches from Bags."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{BAGS_BASE_URL}/token-launch/feed",
            headers=HEADERS,
        )
        res.raise_for_status()
        data = res.json()
        # API doesn't support limit param — trim here
        if data.get("success") and isinstance(data.get("response"), list):
            data["response"] = data["response"][:limit]
        return data


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


_sol_price_cache: dict = {"price": 0.0, "ts": 0.0}

async def _get_sol_price_usd() -> float:
    """Fetch live SOL/USD price from Jupiter. Cached for 60 seconds."""
    import time
    now = time.time()
    if now - _sol_price_cache["ts"] < 60 and _sol_price_cache["price"] > 0:
        return _sol_price_cache["price"]
    try:
        from app.core.config import SOL_MINT
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(
                "https://lite.jupiter.aggregator.io/price",
                params={"ids": SOL_MINT},
            )
            data  = res.json()
            price = float(data["data"][SOL_MINT]["price"])
            _sol_price_cache["price"] = price
            _sol_price_cache["ts"]    = now
            return price
    except Exception:
        # Fallback to a safe conservative estimate if Jupiter is unreachable
        return _sol_price_cache["price"] or 150.0


async def get_quote_for_mint(
    mint:          str,
    amount:        float,
    side:          str = "buy",
    slippage_mode: str = "auto",
    slippage_bps:  int = 50,
    decimals:      int = 9,
) -> dict:
    """
    Get a swap quote for a token mint.
    - buy:  amount is in SOL → convert to lamports (9 decimals)
    - sell: amount is in tokens → convert using token's decimals
    """
    from app.core.config import SOL_MINT

    if amount <= 0:
        raise ValueError("Amount must be greater than 0")

    # Fetch live SOL price to enforce $2 minimum
    sol_price_usd = await _get_sol_price_usd()
    min_sol       = 2.0 / sol_price_usd if sol_price_usd > 0 else 0.001

    if side == "buy":
        # buy: amount is in SOL — validate directly
        if amount > 10:
            raise ValueError("Max buy is 10 SOL per trade")
        if amount < min_sol:
            raise ValueError(f"Minimum buy is $2 (≈ {min_sol:.4f} SOL)")
        input_mint   = SOL_MINT
        output_mint  = mint
        raw_amount   = int(amount * 1_000_000_000)   # SOL → lamports
    else:
        # sell: amount is in tokens — get token price in SOL to validate
        input_mint   = mint
        output_mint  = SOL_MINT
        raw_amount   = int(amount * (10 ** decimals)) # tokens → smallest unit
        if raw_amount <= 0:
            raise ValueError("Amount too small — enter a larger token amount")
        # Estimate token value in SOL via a small probe quote (1 token)
        try:
            probe_raw = int(1 * (10 ** decimals))
            probe = await get_quote(
                input_mint    = mint,
                output_mint   = SOL_MINT,
                amount        = probe_raw,
                slippage_mode = "auto",
            )
            sol_per_token  = int(probe["response"]["outAmount"]) / 1_000_000_000
            trade_value_sol = amount * sol_per_token
            if trade_value_sol > 10:
                raise ValueError(f"Max sell is 10 SOL per trade (your {amount} tokens ≈ {trade_value_sol:.3f} SOL)")
            if trade_value_sol < min_sol:
                raise ValueError(f"Minimum sell is $2 (your {amount} tokens ≈ ${trade_value_sol * sol_price_usd:.2f})")
        except ValueError:
            raise
        except Exception:
            pass  # if probe fails, let the real quote proceed and Bags will error naturally

    print(f"[QUOTE] side={side} amount={amount} raw_amount={raw_amount} decimals={decimals}")

    return await get_quote(
        input_mint    = input_mint,
        output_mint   = output_mint,
        amount        = raw_amount,
        slippage_mode = slippage_mode,
        slippage_bps  = slippage_bps,
    )


# Analytics 

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