from dotenv import load_dotenv
import os

load_dotenv()

# ── API Keys ──
BAGS_API_KEY      = os.getenv("BAGS_API_KEY", "")
BITQUERY_API_KEY  = os.getenv("BITQUERY_API_KEY", "")
HELIUS_API_KEY    = os.getenv("HELIUS_API_KEY", "")

# ── CORS ──
FRONTEND_ORIGIN   = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5500")

# ── Whale threshold ──
WHALE_THRESHOLD_USD = float(os.getenv("WHALE_THRESHOLD_USD", "500"))

# ── Base URLs ──
BAGS_BASE_URL     = "https://public-api-v2.bags.fm/api/v1"
BITQUERY_WS_URL   = "wss://streaming.bitquery.io/eap"

# ── Solana RPC (Helius preferred, fallback to public) ──
_helius_key       = HELIUS_API_KEY
HELIUS_RPC_URL    = (
    f"https://mainnet.helius-rpc.com/?api-key={_helius_key}"
    if _helius_key
    else os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
)

# ── SOL mint ──
SOL_MINT          = "So11111111111111111111111111111111111111112"