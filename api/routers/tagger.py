from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import TrackFlags
from routers.auth import get_current_user, UserContext
from services.navidrome import trigger_scan
from services import tagger

router = APIRouter()


class TagWriteRequest(BaseModel):
    file_paths: list[str]
    tags: dict[str, str]


class DeleteRequest(BaseModel):
    file_paths: list[str]


class FlagRequest(BaseModel):
    file_paths: list[str]
    ignore_in_autodj: bool


@router.get("/tagger/tracks")
async def get_tracks(
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    tracks = tagger.list_tracks()

    # Fetch all ignore flags and index by (title_lower_stripped, artist_lower_stripped)
    result = await session.execute(select(TrackFlags))
    flags: dict[tuple[str, str], bool] = {
        (f.title.lower().strip(), f.artist.lower().strip()): f.ignore_in_autodj
        for f in result.scalars().all()
    }

    for track in tracks:
        key = (track["title"].lower().strip(), track["artist"].lower().strip())
        track["ignore_in_autodj"] = flags.get(key, False)

    return tracks


@router.post("/tagger/flags")
async def set_track_flags(
    body: FlagRequest,
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Set ignore_in_autodj flag for given file paths."""
    updated = 0
    errors = []

    for fp in body.file_paths:
        track = tagger.read_tags_for_path(fp)
        if not track:
            errors.append(f"Could not read tags: {fp}")
            continue

        title = track["title"].strip()
        artist = track["artist"].strip()
        if not title and not artist:
            errors.append(f"No title/artist in tags: {fp}")
            continue

        result = await session.execute(
            select(TrackFlags).where(
                TrackFlags.title == title,
                TrackFlags.artist == artist,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.ignore_in_autodj = body.ignore_in_autodj
        else:
            session.add(TrackFlags(title=title, artist=artist, ignore_in_autodj=body.ignore_in_autodj))
        updated += 1

    await session.commit()
    return {"updated": updated, "errors": errors}


@router.get("/tagger/ignored")
async def get_ignored_tracks(
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Return {title, artist} pairs for all tracks ignored in Auto DJ."""
    result = await session.execute(
        select(TrackFlags).where(TrackFlags.ignore_in_autodj == True)  # noqa: E712
    )
    return [{"title": f.title, "artist": f.artist} for f in result.scalars().all()]


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
