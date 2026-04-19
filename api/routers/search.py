import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from routers.auth import require_non_guest, UserContext
from services import cache
from services.youtube import search_youtube, search_youtube_albums, get_youtube_album_tracks, get_artist_youtube_albums, get_playlist_tracks, get_artist_topic_tracks, get_artist_topic_albums

router = APIRouter()


class YouTubeResult(BaseModel):
    youtube_id: str
    title: str
    artist: str
    duration: int
    thumbnail_url: str
    url: str
    album: str = ""


class YouTubeAlbumResult(BaseModel):
    playlist_id: str
    title: str
    artist: str
    track_count: int
    thumbnail_url: str
    url: str


_TRACK_TTL = 3600    # 1 hour
_ALBUM_TTL = 7200    # 2 hours (slower to fetch, changes less)


@router.get("/youtube/playlist-tracks", response_model=list[YouTubeResult])
async def get_yt_playlist_tracks(
    url: str = Query(..., min_length=1),
    artist: str = Query(""),
    user: UserContext = Depends(require_non_guest),
):
    playlist_url = url
    key = f"playlist-tracks:{url}"
    cached = cache.get(key, _ALBUM_TTL)
    if cached is not None:
        return cached
    results = await asyncio.to_thread(get_playlist_tracks, playlist_url, artist)
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


@router.get("/youtube/artist-tracks", response_model=list[YouTubeResult])
async def search_yt_artist_tracks(
    artist: str = Query(..., min_length=1),
    limit: Optional[int] = Query(100, ge=1, le=200),
    user: UserContext = Depends(require_non_guest),
):
    key = f"artist-tracks:{artist}:{limit}"
    cached = cache.get(key, _ALBUM_TTL)
    if cached is not None:
        return cached
    results = await asyncio.to_thread(get_artist_topic_tracks, artist, limit)
    response = [
        YouTubeResult(
            youtube_id=r.youtube_id,
            title=r.title,
            artist=r.artist,
            duration=r.duration,
            thumbnail_url=r.thumbnail_url,
            url=r.url,
            album=r.album,
        )
        for r in results
    ]
    cache.set(key, response, _ALBUM_TTL)
    return response


@router.get("/youtube/artist-albums", response_model=list[YouTubeAlbumResult])
async def search_yt_artist_albums(
    artist: str = Query(..., min_length=1),
    limit: Optional[int] = Query(20, ge=1, le=40),
    user: UserContext = Depends(require_non_guest),
):
    key = f"artist-topic-albums:{artist}:{limit}"
    cached = cache.get(key, _ALBUM_TTL)
    if cached is not None:
        return cached
    results = await asyncio.to_thread(get_artist_topic_albums, artist, limit)
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
    topic_task = asyncio.to_thread(get_artist_topic_tracks, q, limit)
    search_task = asyncio.to_thread(search_youtube, q, limit)
    topic_results, search_results = await asyncio.gather(topic_task, search_task, return_exceptions=True)
    if isinstance(topic_results, Exception) or not topic_results:
        results = search_results if not isinstance(search_results, Exception) else []
    else:
        results = topic_results
    response = [
        YouTubeResult(
            youtube_id=r.youtube_id,
            title=r.title,
            artist=r.artist,
            duration=r.duration,
            thumbnail_url=r.thumbnail_url,
            url=r.url,
            album=r.album,
        )
        for r in results
    ]
    cache.set(key, response, _TRACK_TTL)
    return response
