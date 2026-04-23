import asyncio
import random

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Download
from routers.auth import get_current_user, UserContext
from services import cache
from services.discovery import lastfm_similar, enrich_images

router = APIRouter()

_DISCOVER_TTL = 3600
_IMG_TTL = 7 * 24 * 3600
_IMG_MISS_TTL = 600  # retry failures after 10 min instead of poisoning for a week


class DiscoverResult(BaseModel):
    artist: str
    title: str
    image_url: str = ""
    score: float = 0.0
    seed_artist: str = ""


@router.get("/discover", response_model=list[DiscoverResult])
async def discover(
    limit: int = Query(100, ge=1, le=500),
    fresh: bool = Query(False),
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    cache_key = f"discover:{user.username}:{limit}"
    if not fresh:
        cached = cache.get(cache_key, _DISCOVER_TTL)
        if cached is not None:
            return cached

    result = await session.execute(
        select(Download.title, Download.artist)
        .where(Download.status == "completed")
    )
    rows = result.all()
    if not rows:
        return []

    owned: set[tuple[str, str]] = {
        (t.lower().strip(), a.lower().strip()) for t, a in rows
    }
    owned_artists: set[str] = {a.lower().strip() for _, a in rows}

    n_rows = len(rows)
    third = n_rows // 3
    eras = [
        rows[:third] if third > 0 else [],
        rows[third : 2 * third] if third > 0 else [],
        rows[2 * third :] if third > 0 else rows,
    ]
    seeds = []
    for era in eras:
        if era:
            seeds.extend(random.sample(era, min(7, len(era))))

    tasks = [lastfm_similar(artist, title, limit=50) for title, artist in seeds]
    results = await asyncio.gather(*tasks)

    all_tracks = []
    for (_, seed_art), tracks in zip(seeds, results):
        for t in tracks:
            all_tracks.append({**t, "seed_artist": str(seed_art)})
    random.shuffle(all_tracks)

    seen: set[tuple[str, str]] = set()
    artist_count: dict[str, int] = {}
    suggestions: list[dict] = []

    for t in all_tracks:
        key = (t["title"].lower().strip(), t["artist"].lower().strip())
        artist_key = t["artist"].lower().strip()

        if key in seen or key in owned:
            continue

        if artist_key in owned_artists:
            if artist_count.get(artist_key, 0) >= 2:
                continue
            artist_count[artist_key] = artist_count.get(artist_key, 0) + 1

        seen.add(key)
        suggestions.append(t)

        if len(suggestions) >= limit:
            break

    results_out = [
        DiscoverResult(
            artist=t["artist"],
            title=t["title"],
            score=t.get("score", 0.0),
            seed_artist=t.get("seed_artist", ""),
        )
        for t in suggestions
    ]

    # Avoid caching tiny result sets — usually means Last.fm rate-limited us.
    if len(results_out) >= max(10, limit // 5):
        cache.set(cache_key, results_out, _DISCOVER_TTL)
    return results_out


class ImageRequest(BaseModel):
    artist: str
    title: str


@router.post("/discover/images", response_model=list[DiscoverResult])
async def discover_images(
    tracks: list[ImageRequest],
    user: UserContext = Depends(get_current_user),
):
    cached_results: list[dict] = []
    to_fetch: list[dict] = []

    for t in tracks:
        img_key = f"img:{t.artist}:{t.title}"
        cached_url = cache.get(img_key, _IMG_TTL)
        if cached_url is not None:
            cached_results.append({"artist": t.artist, "title": t.title, "image": cached_url})
        else:
            to_fetch.append({"artist": t.artist, "title": t.title})

    if to_fetch:
        try:
            await asyncio.wait_for(enrich_images(to_fetch), timeout=15.0)
        except asyncio.TimeoutError:
            pass
        for t in to_fetch:
            img = t.get("image", "")
            key = f"img:{t['artist']}:{t['title']}"
            cache.set(key, img, _IMG_TTL if img else _IMG_MISS_TTL)
        cached_results.extend(to_fetch)

    return [
        DiscoverResult(artist=t["artist"], title=t["title"], image_url=t.get("image", ""))
        for t in cached_results
    ]
