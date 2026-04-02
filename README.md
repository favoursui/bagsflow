# BAGS//FLOW

**Real-time on-chain order flow dashboard built on Bags.fm**

---

## What is BAGS//FLOW?

BAGS//FLOW is a live trading dashboard for the Bags.fm ecosystem on Solana. It streams every trade happening on Bags.fm tokens in real time and presents it in a clean, terminal-style UI, giving traders instant visibility into order flow, whale activity, and new token launches.

It also includes a fully functional **in-app swap panel** powered by the Bags API, letting users buy and sell Bags.fm tokens directly from the dashboard without leaving the page.

---

## Features

- **Live Trade Feed**: every swap on Bags.fm tokens streamed in real time via Helius WebSocket
- **Whale Alerts** : trades ≥ $500 flagged and highlighted instantly
- **Net Order Flow Chart**: buy vs sell pressure visualised per token
- **Top Traders Leaderboard** : ranked by volume in the current session
- **New Token Launches**: live feed of tokens launching on Bags.fm
- **In-App Swap Panel**: connect Phantom, Backpack, or Solflare and swap directly
  - Paste any Bags.fm token CA to validate and get a quote
  - Buy (SOL → token) or Sell (token → SOL)
  - Live quote from Meteora DAMM v2 via Bags API
  - Slippage control, price impact display, Solscan TXN link on success
  - Min trade: $2 and Max trade: 10 SOL

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS, Chart.js, Tailwind CSS |
| Backend | Python, FastAPI, uvicorn |
| Real-time stream | Helius WebSocket (`logsSubscribe`) |
| Trade execution | Bags.fm REST API + Meteora DAMM v2 |
| Token metadata | Helius DAS API |
| Serving | Nginx (reverse proxy + static files) |
| Containerisation | Docker + Docker Compose |

---

## Architecture

```
Browser
  │
  ├── GET /api/*  ──────────────────► FastAPI ──► Bags.fm API
  │                                      │
  └── WebSocket /ws ◄────────────────────┤
                                         │
                               Helius WebSocket
                               (logsSubscribe on
                                Meteora DBC + Bags
                                program addresses)
```

Nginx sits in front of everything, serves the static frontend and proxies `/api/` and `/ws` to the FastAPI backend. No CORS issues, single origin.

---

## Quick Start

### Prerequisites
- Docker + Docker Compose
- A Bags.fm API key → [dev.bags.fm](https://dev.bags.fm)
- A Helius API key → [helius.dev](https://helius.dev)

### Setup

```bash
git clone https://github.com/favoursui/bagsonchain
cd bagsonchain/backend

cp .env.example .env
# Fill in your keys in .env
```

**.env**
```
BAGS_API_KEY=your_bags_api_key
HELIUS_API_KEY=your_helius_api_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
FRONTEND_ORIGIN=http://localhost:5500
WHALE_THRESHOLD_USD=500
```

```bash
cd ..
docker compose build --no-cache && docker compose up
```

Open **http://localhost:5500** in your browser.

---

## How to Use

1. Open the dashboard
2. Trades appear in the feed as they happen on-chain
3. Whale trades (≥ $500) flash in the whale panel
4. Click **Connect Wallet** (top right) to open the swap panel
5. Paste any Bags.fm token contract address
6. Enter an amount, pick BUY or SELL, adjust slippage
7. Hit **Confirm Swap** and sign in your wallet

---

## Project Structure

```
bagsonchain/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── tokens.py      # Token info + quote endpoints
│   │   │   └── swap.py        # Swap + send transaction endpoints
│   │   ├── services/
│   │   │   ├── bags.py        # Bags.fm API client
│   │   │   ├── helius.py      # Helius RPC helpers
│   │   │   └── bitquery.py    # Helius WebSocket trade stream
│   │   ├── core/
│   │   │   ├── config.py      # Env config
│   │   │   └── websocket.py   # WS connection manager
│   │   └── main.py            # FastAPI app + launch poller
│   ├── .env.example
│   └── requirements.txt
├── frontend/
│   └── build/
│       ├── index.html
│       ├── css/style.css
│       └── js/
│           ├── dashboard.js   # Live feed, chart, leaderboard
│           └── swap.js        # Wallet connect + swap UI
├── nginx.conf
└── docker-compose.yaml
```

