from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from routers.auth import require_non_guest, UserContext
from services import updater

router = APIRouter()


@router.get("/update/status")
async def get_update_status(user: UserContext = Depends(require_non_guest)):
    status = await updater.get_status()
    if status is None:
        return {"available": False}
    return status


@router.get("/update/progress")
async def get_update_progress(user: UserContext = Depends(require_non_guest)):
    progress = await updater.get_progress()
    if progress is None:
        return {"available": False}
    return {"available": True, **progress}


@router.post("/update/apply")
async def apply_update(user: UserContext = Depends(require_non_guest)):
    result = await updater.apply_update()
    if result.get("accepted"):
        return JSONResponse(status_code=202, content=result)
    status_code = 409 if result.get("reason") == "update already in progress" else 503
    return JSONResponse(status_code=status_code, content=result)
