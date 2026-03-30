from fastapi import FastAPI
from app.api.swap import router as swap_router
from app.api.tokens import router as tokens_router


def register_routes(app: FastAPI):
    """Register all API routers onto the FastAPI app."""
    app.include_router(swap_router,   prefix="/api", tags=["Trade"])
    app.include_router(tokens_router, prefix="/api", tags=["Tokens"])