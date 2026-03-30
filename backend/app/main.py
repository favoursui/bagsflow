import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import FRONTEND_ORIGIN
from app.core.websocket import manager
from app.services.bitquery import start_trade_stream
from app.api.routes import register_routes


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("BAGS//FLOW backend starting…")
    stream_task = asyncio.create_task(start_trade_stream())
    yield
    stream_task.cancel()
    print("Backend shutting down")


app = FastAPI(
    title       = "BAGS//FLOW API",
    description = "On-Chain Order Flow Dashboard",
    version     = "1.0.0",
    lifespan    = lifespan,
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins     = [
        FRONTEND_ORIGIN,
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── Routes ──
register_routes(app)


# ── WebSocket ──
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── Health ──
@app.get("/health")
async def health():
    return {
        "status":  "ok",
        "clients": len(manager.active),
    }