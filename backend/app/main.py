import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import FRONTEND_ORIGIN
from app.core.websocket import manager
from app.services.bitquery import start_trade_stream
from app.services.bags import get_token_launches
from app.api.routes import register_routes


# Launch poller 
async def poll_launches(interval: int = 30):
    """
    Polls the Bags token launch feed every `interval` seconds and broadcasts
    any new launches to connected WebSocket clients.
    """
    seen: set[str] = set()
    print("🚀 Launch poller started")
    while True:
        try:
            data    = await get_token_launches(limit=20)
            launches = data.get("response", []) if data.get("success") else []
            for launch in launches:
                mint = launch.get("tokenMint")
                if not mint or mint in seen:
                    continue
                seen.add(mint)
                await manager.broadcast({
                    "type":    "launch",
                    "name":    launch.get("name")   or mint[:6],
                    "symbol":  launch.get("symbol") or "???",
                    "mint":    mint,
                    "status":  launch.get("status") or "",
                    "image":   launch.get("image")  or "",
                    "twitter": launch.get("twitter") or "",
                    "website": launch.get("website") or "",
                    "time":    "",
                })
        except asyncio.CancelledError:
            print("🚀 Launch poller cancelled")
            raise
        except Exception as e:
            print(f"⚠️  Launch poller error: {e}")

        await asyncio.sleep(interval)


# App lifespan 
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("BAGS//FLOW backend starting…")
    stream_task  = asyncio.create_task(start_trade_stream())
    launch_task  = asyncio.create_task(poll_launches(interval=30))
    yield
    stream_task.cancel()
    launch_task.cancel()
    await asyncio.gather(stream_task, launch_task, return_exceptions=True)
    print("Backend shut down")


app = FastAPI(
    title       = "BAGS//FLOW API",
    description = "On-Chain Order Flow Dashboard — built on Bags.fm",
    version     = "1.0.0",
    lifespan    = lifespan,
)

# CORS 
app.add_middleware(
    CORSMiddleware,
    allow_origins = [
        FRONTEND_ORIGIN,
        #"https://bagsflow.vercel.app",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
    ],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# Routes 
register_routes(app)


# WebSocket endpoint 
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()   # keep-alive; client can send pings
    except WebSocketDisconnect:
        manager.disconnect(ws)


# Health check
@app.get("/health")
async def health():
    return {
        "status":  "ok",
        "clients": len(manager.active),
        "stream":  "live" if getattr(manager, '_stream_ok', False) else "connecting",
    }