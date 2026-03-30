from dotenv import load_dotenv
import os

load_dotenv()

# ── API Keys ──
BAGS_API_KEY     = os.getenv("BAGS_API_KEY", "")
BITQUERY_API_KEY = os.getenv("BITQUERY_API_KEY", "")
HELIUS_API_KEY   = os.getenv("HELIUS_API_KEY", "")

# ── CORS ──
FRONTEND_ORIGIN  = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5500")

# ── Base URLs ──
BAGS_BASE_URL    = "https://public-api-v2.bags.fm/api/v1"
HELIUS_RPC_URL   = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
BITQUERY_WS_URL  = "wss://streaming.bitquery.io/eap"

# ── Solana ──
SOL_MINT         = "So11111111111111111111111111111111111111112"