import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc

from db.database import get_db
from db.models import Download, TrackMapping
from routers.auth import get_current_user, require_non_guest, UserContext
from services.download_worker import process_download
from services.youtube import search_youtube

router = APIRouter()

# Keep references to prevent GC-cancellation of in-flight download tasks
_download_tasks: set[asyncio.Task] = set()


def _spawn_download(download_id: int, username: str, password: str) -> None:
    task = asyncio.create_task(process_download(download_id, username, password))
    _download_tasks.add(task)
    task.add_done_callback(_download_tasks.discard)


class DownloadRequest(BaseModel):
    youtube_url: str
    youtube_id: str
    title: str
    artist: str
    album: str | None = None


class DownloadResponse(BaseModel):
    download_id: int
    status: str
    already_cached: bool = False


class DownloadStatus(BaseModel):
    id: int
    youtube_id: str
    title: str
    artist: str
    status: str
    progress: int
    mood: str | None = None
    bpm: float | None = None
    energy: float | None = None
    key: str | None = None
    genre: str | None = None
    error: str | None = None


class PlaylistImportRequest(BaseModel):
    playlist_url: str
    playlist_name: str | None = None


class PlaylistImportResponse(BaseModel):
    queued: int
    download_ids: list[int]
    playlist_name: str | None = None


@router.post("/download", response_model=DownloadResponse)
async def start_download(
    body: DownloadRequest,
    user: UserContext = Depends(require_non_guest),
    db=Depends(get_db),
):
    # Check if already cached
    existing = await db.execute(
        select(TrackMapping).where(TrackMapping.youtube_id == body.youtube_id)
    )
    if existing.scalar_one_or_none():
        return DownloadResponse(download_id=0, status="completed", already_cached=True)

    # Check if already downloading
    in_progress = await db.execute(
        select(Download).where(
            Download.youtube_id == body.youtube_id,
            Download.status.in_(["queued", "downloading", "analyzing", "tagging", "scanning"]),
        )
    )
    existing_dl = in_progress.scalar_one_or_none()
    if existing_dl:
        return DownloadResponse(download_id=existing_dl.id, status=existing_dl.status)

    dl = Download(
        youtube_id=body.youtube_id,
        youtube_url=body.youtube_url,
        title=body.title,
        artist=body.artist,
        status="queued",
        target_album=body.album,
        navidrome_username=user.username,
        navidrome_password=user.password,
    )
    db.add(dl)
    await db.commit()
    await db.refresh(dl)

    _spawn_download(dl.id, user.username, user.password)

    return DownloadResponse(download_id=dl.id, status="queued")


@router.post("/download/{download_id}/cancel")
async def cancel_download(
    download_id: int,
    user: UserContext = Depends(get_current_user),
    db=Depends(get_db),
):
    dl = await db.get(Download, download_id)
    if not dl:
        raise HTTPException(status_code=404, detail="Download not found")
    if dl.status not in ("queued", "downloading", "analyzing", "tagging", "scanning"):
        raise HTTPException(status_code=400, detail="Download is not active")
    dl.status = "cancelled"
    await db.commit()
    return {"ok": True}


@router.get("/download/status/{download_id}", response_model=DownloadStatus)
async def get_download_status(
    download_id: int,
    user: UserContext = Depends(get_current_user),
    db=Depends(get_db),
):
    dl = await db.get(Download, download_id)
    if not dl:
        raise HTTPException(status_code=404, detail="Download not found")
    return DownloadStatus(
        id=dl.id,
        youtube_id=dl.youtube_id,
        title=dl.title,
        artist=dl.artist,
        status=dl.status,
        progress=dl.progress,
        mood=dl.mood,
        bpm=dl.bpm,
        energy=dl.energy,
        key=dl.key,
        genre=dl.genre,
        error=dl.error,
    )


@router.get("/downloads", response_model=list[DownloadStatus])
async def list_downloads(
    user: UserContext = Depends(get_current_user),
    db=Depends(get_db),
):
    result = await db.execute(
        select(Download).order_by(desc(Download.created_at)).limit(50)
    )
    downloads = result.scalars().all()
    return [
        DownloadStatus(
            id=dl.id,
            youtube_id=dl.youtube_id,
            title=dl.title,
            artist=dl.artist,
            status=dl.status,
            progress=dl.progress,
            mood=dl.mood,
            bpm=dl.bpm,
            energy=dl.energy,
            key=dl.key,
            genre=dl.genre,
            error=dl.error,
        )
        for dl in downloads
    ]


@router.get("/cached", response_model=list[str])
async def list_cached(
    user: UserContext = Depends(get_current_user),
    db=Depends(get_db),
):
    result = await db.execute(select(TrackMapping.youtube_id))
    return [row[0] for row in result.all()]


@router.post("/import/playlist", response_model=PlaylistImportResponse)
async def import_playlist(
    body: PlaylistImportRequest,
    user: UserContext = Depends(require_non_guest),
    db=Depends(get_db),
):
    entries = await asyncio.to_thread(_extract_playlist, body.playlist_url)
    download_ids = []

    for entry in entries:
        youtube_id = entry.get("id", "")
        if not youtube_id:
            continue

        # Skip deleted or private videos
        title = entry.get("title") or "Unknown"
        if title in ("[Deleted video]", "[Private video]"):
            continue

        # Skip if already cached
        existing = await db.execute(
            select(TrackMapping).where(TrackMapping.youtube_id == youtube_id)
        )
        if existing.scalar_one_or_none():
            continue

        dl = Download(
            youtube_id=youtube_id,
            youtube_url=f"https://www.youtube.com/watch?v={youtube_id}",
            title=title,
            artist=entry.get("channel") or entry.get("uploader") or "Unknown",
            status="queued",
            playlist_name=body.playlist_name or None,
            navidrome_username=user.username,
            navidrome_password=user.password,
        )
        db.add(dl)
        await db.commit()
        await db.refresh(dl)
        download_ids.append(dl.id)
        _spawn_download(dl.id, user.username, user.password)

    return PlaylistImportResponse(
        queued=len(download_ids),
        download_ids=download_ids,
        playlist_name=body.playlist_name or None,
    )


def _extract_playlist(url: str) -> list[dict]:
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "lazy_playlist": False,
        "skip_download": True,
        "ignoreerrors": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return []
            entries = info.get("entries", []) or []
            # Flatten one level in case of nested playlist
            flat = []
            for e in entries:
                if not e:
                    continue
                if e.get("_type") == "playlist":
                    flat.extend(e.get("entries") or [])
                else:
                    flat.append(e)
            return flat
    except Exception:
        return []
