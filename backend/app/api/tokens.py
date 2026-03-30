from fastapi import APIRouter, HTTPException, Query
from app.services import bags

router = APIRouter()


@router.get("/launches")
async def get_launches(limit: int = Query(20, ge=1, le=100)):
    try:
        return await bags.get_token_launches(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/pools")
async def get_pools():
    try:
        return await bags.get_bags_pools()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))