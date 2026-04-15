from fastapi import FastAPI
from app.api.swap      import router as swap_router
from app.api.tokens    import router as tokens_router
from app.api.analytics import router as analytics_router


def register_routes(app: FastAPI):
    app.include_router(swap_router,      prefix="/api", tags=["Trade"])
    app.include_router(tokens_router,    prefix="/api", tags=["Tokens"])
    app.include_router(analytics_router, prefix="/api", tags=["Analytics"])