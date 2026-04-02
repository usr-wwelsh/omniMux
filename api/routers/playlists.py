import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db, async_session
from db.models import Download
from routers.auth import get_current_user, UserContext
from services.download_worker import _analyze_mood
from services.navidrome import get_or_create_playlist, replace_playlist_songs, search_song

router = APIRouter()


@router.post("/playlists/sync-moods")
async def sync_mood_playlists(
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(Download)
        .where(Download.status == "completed")
        .where(Download.mood.is_not(None))
    )
    downloads = result.scalars().all()

    by_mood: dict[str, list[Download]] = {}
    for dl in downloads:
        if dl.mood:
            by_mood.setdefault(dl.mood.lower(), []).append(dl)

    async def resolve_song_id(dl: Download) -> str | None:
        try:
            return await search_song(dl.title, dl.artist, user.username, user.password)
        except Exception:
            return None

    synced: dict[str, int] = {}
    for mood, dls in by_mood.items():
        song_ids = [sid for sid in await asyncio.gather(*[resolve_song_id(dl) for dl in dls]) if sid]
        if not song_ids:
            continue
        playlist_name = f"Mood: {mood.title()}"
        playlist_id = await get_or_create_playlist(playlist_name, user.username, user.password)
        if playlist_id:
            await replace_playlist_songs(playlist_id, song_ids, user.username, user.password)
            synced[mood] = len(song_ids)

    return {"synced": synced}


@router.post("/playlists/backfill-moods")
async def backfill_moods(
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Re-run mood analysis on completed downloads that are missing mood data."""
    result = await session.execute(
        select(Download)
        .where(Download.status == "completed")
        .where(Download.mood.is_(None))
        .where(Download.file_path.is_not(None))
    )
    downloads = result.scalars().all()

    updated = 0
    for dl in downloads:
        mood_result = await _analyze_mood(dl.file_path)
        if not mood_result:
            continue
        async with async_session() as s:
            d = await s.get(Download, dl.id)
            if d:
                d.mood = mood_result.get("mood") or None
                d.bpm = mood_result.get("tempo")
                d.energy = mood_result.get("energy")
                d.key = mood_result.get("key")
                await s.commit()
        updated += 1

    return {"updated": updated, "total": len(downloads)}
