from fastapi import WebSocket
import json


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        print(f"[WS] Client connected — {len(self.active)} total")

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        print(f"[WS] Client disconnected — {len(self.active)} total")

    async def broadcast(self, data: dict):
        """Send a message to all connected frontend clients."""
        if not self.active:
            return
        msg  = json.dumps(data)
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


# Singleton — imported everywhere
manager = ConnectionManager()