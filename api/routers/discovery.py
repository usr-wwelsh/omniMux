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
from services.discovery import lastfm_similar

router = APIRouter()

_DISCOVER_TTL = 3600  # 1 hour


class DiscoverResult(BaseModel):
    artist: str
    title: str
    image_url: str = ""


@router.get("/discover", response_model=list[DiscoverResult])
async def discover(
    limit: int = Query(200, ge=1, le=500),
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    cache_key = f"discover:{user.username}:{limit}"
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

    # Sample up to 20 seeds, weighted toward recent (rows are insertion-ordered)
    recent = rows[-60:]
    seeds = random.sample(recent, min(20, len(recent)))

    tasks = [lastfm_similar(artist, title, limit=50) for title, artist in seeds]
    results = await asyncio.gather(*tasks)

    seen: set[tuple[str, str]] = set()
    suggestions: list[DiscoverResult] = []
    for tracks in results:
        for t in tracks:
            key = (t["title"].lower().strip(), t["artist"].lower().strip())
            if key not in seen and key not in owned:
                seen.add(key)
                suggestions.append(DiscoverResult(artist=t["artist"], title=t["title"], image_url=t.get("image", "")))
                if len(suggestions) >= limit:
                    break
        if len(suggestions) >= limit:
            break

    if suggestions:
        cache.set(cache_key, suggestions, _DISCOVER_TTL)
    return suggestions
