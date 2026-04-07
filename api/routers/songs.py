from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Download
from routers.auth import get_current_user, UserContext

router = APIRouter()


class SongRef(BaseModel):
    title: str
    artist: str


class EnrichRequest(BaseModel):
    songs: list[SongRef]


class EnrichedSong(BaseModel):
    title: str
    artist: str
    mood: str | None = None
    energy: float | None = None
    key: str | None = None
    bpm: float | None = None


@router.post("/songs/enrich", response_model=list[EnrichedSong])
async def enrich_songs(
    body: EnrichRequest,
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Given a list of {title, artist} pairs from the Navidrome random pool,
    return any enrichment data (mood, energy, key, bpm) stored in our DB
    from the mood analysis pipeline. Unmatched songs are omitted.
    """
    if not body.songs:
        return []

    # Fetch all completed downloads with any enrichment data in one query
    result = await session.execute(
        select(Download)
        .where(Download.status == "completed")
        .where(
            Download.mood.is_not(None)
            | Download.energy.is_not(None)
            | Download.key.is_not(None)
        )
    )
    downloads = result.scalars().all()

    # Index by normalized (title, artist) for fast lookup
    exact: dict[tuple[str, str], Download] = {}
    by_title: dict[str, list[Download]] = {}
    for dl in downloads:
        t = dl.title.lower().strip()
        a = dl.artist.lower().strip()
        exact[(t, a)] = dl
        by_title.setdefault(t, []).append(dl)

    enriched: list[EnrichedSong] = []
    for song in body.songs:
        t = song.title.lower().strip()
        a = song.artist.lower().strip()

        dl = exact.get((t, a))

        # Fuzzy artist match when exact fails
        if not dl and t in by_title:
            for candidate in by_title[t]:
                ca = candidate.artist.lower().strip()
                if a in ca or ca in a:
                    dl = candidate
                    break

        if dl:
            enriched.append(EnrichedSong(
                title=song.title,
                artist=song.artist,
                mood=dl.mood,
                energy=dl.energy,
                key=dl.key,
                bpm=dl.bpm,
            ))

    return enriched
