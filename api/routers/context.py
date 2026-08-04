import asyncio

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from routers.auth import get_current_user, UserContext
from services import cache
from services.discovery import lastfm_artist_info, lastfm_album_info

router = APIRouter()

# Bios and release notes effectively never change, and the upstream APIs are
# rate-limited across every omniMux install sharing the bundled key.
_CONTEXT_TTL = 30 * 24 * 3600
_MISS_TTL = 6 * 3600  # retry empty results the same day rather than in a month
_LOOKUP_TIMEOUT = 12.0


class ArtistContext(BaseModel):
    name: str = ""
    bio: str = ""
    url: str = ""
    tags: list[str] = []
    listeners: int = 0
    playcount: int = 0
    similar: list[dict] = []
    type: str = ""
    origin: str = ""
    country: str = ""
    began: str = ""
    ended: str = ""
    members: list[str] = []
    member_of: list[str] = []
    found: bool = False


class AlbumContext(BaseModel):
    name: str = ""
    artist: str = ""
    wiki: str = ""
    url: str = ""
    tags: list[str] = []
    listeners: int = 0
    playcount: int = 0
    found: bool = False


async def _cached_lookup(key: str, coro_factory) -> dict:
    hit = cache.json_get(key, _CONTEXT_TTL)
    if hit is not None and hit.get("found"):
        return hit
    # A miss is cached only briefly, so a transient upstream failure doesn't
    # blank the panel for a month.
    if hit is not None and cache.json_get(key, _MISS_TTL) is not None:
        return hit

    try:
        result = await asyncio.wait_for(coro_factory(), timeout=_LOOKUP_TIMEOUT)
    except Exception:
        return {"found": False}

    payload = {**result, "found": bool(result)}
    cache.json_set(key, payload)
    return payload


@router.get("/context/artist", response_model=ArtistContext)
async def artist_context(
    name: str = Query(..., min_length=1),
    user: UserContext = Depends(get_current_user),
):
    key = f"ctx:artist:{name.lower().strip()}"
    data = await _cached_lookup(key, lambda: lastfm_artist_info(name))
    return ArtistContext(**data)


@router.get("/context/album", response_model=AlbumContext)
async def album_context(
    artist: str = Query(..., min_length=1),
    album: str = Query(..., min_length=1),
    user: UserContext = Depends(get_current_user),
):
    key = f"ctx:album:{artist.lower().strip()}:{album.lower().strip()}"
    data = await _cached_lookup(key, lambda: lastfm_album_info(artist, album))
    return AlbumContext(**data)
