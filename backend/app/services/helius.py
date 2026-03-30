import httpx
from app.core.config import HELIUS_RPC_URL


def _shorten(address: str) -> str:
    return f"{address[:4]}···{address[-4:]}" if len(address) > 10 else address


async def _rpc(method: str, params: list) -> dict:
    """Generic JSON-RPC helper."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            HELIUS_RPC_URL,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        )
        res.raise_for_status()
        return res.json()


async def get_sol_balance(address: str) -> float:
    """Return SOL balance for a wallet address."""
    try:
        data     = await _rpc("getBalance", [address])
        lamports = data.get("result", {}).get("value", 0)
        return lamports / 1_000_000_000
    except Exception:
        return 0.0


async def get_recent_transactions(address: str, limit: int = 10) -> list[str]:
    """Return recent transaction signatures for a wallet."""
    try:
        data = await _rpc("getSignaturesForAddress", [address, {"limit": limit}])
        sigs = data.get("result", [])
        return [s["signature"] for s in sigs]
    except Exception:
        return []


async def get_token_accounts(owner: str) -> list[dict]:
    """Return all SPL token accounts owned by a wallet."""
    try:
        data = await _rpc(
            "getTokenAccountsByOwner",
            [owner, {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
             {"encoding": "jsonParsed"}],
        )
        accounts = data.get("result", {}).get("value", [])
        return [
            {
                "mint":    a["account"]["data"]["parsed"]["info"]["mint"],
                "amount":  a["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmount"],
                "decimals": a["account"]["data"]["parsed"]["info"]["tokenAmount"]["decimals"],
            }
            for a in accounts
        ]
    except Exception:
        return []


async def get_wallet_label(address: str) -> str:
    """
    Try to resolve a human-readable label for a wallet via Helius DAS.
    Falls back to shortened address if no label found.
    """
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.post(
                HELIUS_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id": "label",
                    "method": "getAsset",
                    "params": {"id": address},
                },
            )
            asset = res.json().get("result", {})
            name  = (
                asset.get("content", {})
                     .get("metadata", {})
                     .get("name")
            )
            if name:
                return name
    except Exception:
        pass

    return _shorten(address)


async def get_mint_info(mint: str) -> dict:
    """Return raw parsed mint account info from Solana RPC."""
    try:
        data  = await _rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}])
        value = data.get("result", {}).get("value")
        if not value:
            return {}
        return value.get("data", {}).get("parsed", {}).get("info", {})
    except Exception:
        return {}