from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.services import bags

router = APIRouter()


class SwapRequest(BaseModel):
    quoteResponse:  dict
    userPublicKey:  str


class SendRequest(BaseModel):
    transaction:          str
    lastValidBlockHeight: int


@router.get("/quote")
async def get_quote(
    inputMint:    str = Query(...),
    outputMint:   str = Query(...),
    amount:       int = Query(...),
    slippageMode: str = Query("auto"),
    slippageBps:  int = Query(50),
):
    try:
        quote_data = await bags.get_quote(
            input_mint    = inputMint,
            output_mint   = outputMint,
            amount        = amount,
            slippage_mode = slippageMode,
            slippage_bps  = slippageBps,
        )
        return {
            "success": True,
            "response": quote_data
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/swap")
async def create_swap(body: SwapRequest):
    try:
        return await bags.create_swap_transaction(
            quote_response  = body.quoteResponse,
            user_public_key = body.userPublicKey,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/send-transaction")
async def send_transaction(body: SendRequest):
    try:
        return await bags.send_transaction(
            transaction             = body.transaction,
            last_valid_block_height = body.lastValidBlockHeight,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))