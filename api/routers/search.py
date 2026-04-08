import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from routers.auth import require_non_guest, UserContext
from services import cache
from services.youtube import search_youtube, search_youtube_albums, get_youtube_album_tracks

router = APIRouter()


class YouTubeResult(BaseModel):
    youtube_id: str
    title: str
    artist: str
    duration: int
    thumbnail_url: str
    url: str


class YouTubeAlbumResult(BaseModel):
    playlist_id: str
    title: str
    artist: str
    track_count: int
    thumbnail_url: str
    url: str


_TRACK_TTL = 3600    # 1 hour
_ALBUM_TTL = 7200    # 2 hours (slower to fetch, changes less)


@router.get("/youtube/album-tracks", response_model=list[YouTubeResult])
async def search_yt_album_tracks(
    artist: str = Query(..., min_length=1),
    album: str = Query(..., min_length=1),
    user: UserContext = Depends(require_non_guest),
):
    key = f"album-tracks:{artist}:{album}"
    cached = cache.get(key, _ALBUM_TTL)
    if cached is not None:
        return cached
    results = await asyncio.to_thread(get_youtube_album_tracks, artist, album)
    response = [
        YouTubeResult(
            youtube_id=r.youtube_id,
            title=r.title,
            artist=r.artist,
            duration=r.duration,
            thumbnail_url=r.thumbnail_url,
            url=r.url,
        )
        for r in results
    ]
    cache.set(key, response, _ALBUM_TTL)
    return response


@router.get("/youtube/albums", response_model=list[YouTubeAlbumResult])
async def search_yt_albums(
    q: str = Query(..., min_length=1),
    limit: Optional[int] = Query(10, ge=1, le=20),
    user: UserContext = Depends(require_non_guest),
):
    key = f"albums:{q}:{limit}"
    cached = cache.get(key, _ALBUM_TTL)
    if cached is not None:
        return cached
    results = await asyncio.to_thread(search_youtube_albums, q, limit)
    response = [
        YouTubeAlbumResult(
            playlist_id=r.playlist_id,
            title=r.title,
            artist=r.artist,
            track_count=r.track_count,
            thumbnail_url=r.thumbnail_url,
            url=r.url,
        )
        for r in results
    ]
    cache.set(key, response, _ALBUM_TTL)
    return response


@router.get("/youtube", response_model=list[YouTubeResult])
async def search_yt(
    q: str = Query(..., min_length=1),
    limit: Optional[int] = Query(20, ge=1, le=50),
    user: UserContext = Depends(require_non_guest),
):
    key = f"tracks:{q}:{limit}"
    cached = cache.get(key, _TRACK_TTL)
    if cached is not None:
        return cached
    results = await asyncio.to_thread(search_youtube, q, limit)
    response = [
        YouTubeResult(
            youtube_id=r.youtube_id,
            title=r.title,
            artist=r.artist,
            duration=r.duration,
            thumbnail_url=r.thumbnail_url,
            url=r.url,
        )
        for r in results
    ]
    cache.set(key, response, _TRACK_TTL)
    return response
