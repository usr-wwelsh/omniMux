from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import CoverOverride, utcnow
from routers.auth import UserContext, get_current_user, require_non_guest
from services import covers

router = APIRouter()

AlbumId = Path(pattern=covers.ALBUM_ID.pattern)


class FromUrl(BaseModel):
    url: str


@router.get("/covers")
async def list_overrides(
    user: UserContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ids = sorted(await covers.override_ids(db))
    latest = (await db.execute(select(func.max(CoverOverride.updated_at)))).scalar()
    return {"albums": ids, "version": latest.timestamp() if latest else 0}


@router.get("/covers/suggestions")
async def list_suggestions(
    artist: str = Query(max_length=300),
    album: str = Query(max_length=300),
    user: UserContext = Depends(require_non_guest),
):
    return await covers.suggestions(artist, album)


async def _store(db: AsyncSession, album_id: str, data: bytes) -> dict:
    try:
        content_type = covers.checked_image(data)
    except covers.CoverError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    row = await db.get(CoverOverride, album_id)
    if row:
        row.content_type, row.data, row.updated_at = content_type, data, utcnow()
    else:
        db.add(CoverOverride(album_id=album_id, content_type=content_type, data=data))
    await db.commit()
    covers.invalidate()
    return {"ok": True}


@router.put("/covers/{album_id}")
async def upload_cover(
    request: Request,
    album_id: str = AlbumId,
    user: UserContext = Depends(require_non_guest),
    db: AsyncSession = Depends(get_db),
):
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > covers.MAX_BYTES:
            raise HTTPException(status_code=413, detail="Image too large")
    return await _store(db, album_id, body)


@router.post("/covers/{album_id}/from-url")
async def pick_suggestion(
    body: FromUrl,
    album_id: str = AlbumId,
    user: UserContext = Depends(require_non_guest),
    db: AsyncSession = Depends(get_db),
):
    try:
        data = await covers.fetch_image(body.url)
    except covers.CoverError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)
    return await _store(db, album_id, data)


@router.delete("/covers/{album_id}")
async def reset_cover(
    album_id: str = AlbumId,
    user: UserContext = Depends(require_non_guest),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(CoverOverride).where(CoverOverride.album_id == album_id))
    await db.commit()
    covers.invalidate()
    return {"ok": True}
