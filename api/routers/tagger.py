from fastapi import APIRouter, Depends
from pydantic import BaseModel

from routers.auth import get_current_user, UserContext
from services.navidrome import trigger_scan
from services import tagger

router = APIRouter()


class TagWriteRequest(BaseModel):
    file_paths: list[str]
    tags: dict[str, str]


class DeleteRequest(BaseModel):
    file_paths: list[str]


@router.get("/tagger/tracks")
async def get_tracks(user: UserContext = Depends(get_current_user)):
    return tagger.list_tracks()


@router.post("/tagger/tags")
async def write_tags(
    body: TagWriteRequest,
    user: UserContext = Depends(get_current_user),
):
    updated, errors = tagger.write_tags(body.file_paths, body.tags)
    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return {"updated": updated, "errors": errors}


@router.post("/tagger/delete")
async def delete_tracks(
    body: DeleteRequest,
    user: UserContext = Depends(get_current_user),
):
    deleted, errors = tagger.delete_tracks(body.file_paths)
    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return {"deleted": deleted, "errors": errors}
