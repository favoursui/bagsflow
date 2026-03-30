import httpx
from app.core.config import HELIUS_RPC_URL


async def get_sol_balance(address: str) -> float:
    """Get SOL balance for a wallet."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.post(
                HELIUS_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id":      1,
                    "method":  "getBalance",
                    "params":  [address],
                },
            )
            data     = res.json()
            lamports = data.get("result", {}).get("value", 0)
            return lamports / 1_000_000_000
    except Exception:
        return 0.0


async def get_recent_transactions(address: str, limit: int = 10) -> list:
    """Get recent transaction signatures for a wallet."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                HELIUS_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id":      1,
                    "method":  "getSignaturesForAddress",
                    "params":  [address, {"limit": limit}],
                },
            )
            data = res.json()
            sigs = data.get("result", [])
            return [s["signature"] for s in sigs]
    except Exception:
        return []


async def get_wallet_label(address: str) -> str:
    """Return a short label for a wallet address."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.post(
                HELIUS_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id":      1,
                    "method":  "getAccountInfo",
                    "params":  [address, {"encoding": "jsonParsed"}],
                },
            )
            data  = res.json()
            value = data.get("result", {}).get("value")
            if value is None:
                return shorten(address)
            return shorten(address)
    except Exception:
        return shorten(address)


def shorten(address: str) -> str:
    return f"{address[:4]}···{address[-4:]}" if len(address) > 10 else address