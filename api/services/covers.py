import asyncio
import re
from urllib.parse import urljoin, urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import CoverOverride
from services.discovery import mb_release_ids
from services.navidrome import NAVIDROME_URL, subsonic_auth_params

MAX_BYTES = 5 * 1024 * 1024
ALBUM_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_HOST_SUFFIXES = (".mzstatic.com", ".archive.org", ".dzcdn.net")
_HOSTS = frozenset({"coverartarchive.org", "archive.org"})
_MAX_REDIRECTS = 3
MAX_RELEASES = 5
_SONG_CACHE_MAX = 5000

_ids: set[str] | None = None
_song_albums: dict[str, str] = {}


class CoverError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail


def sniff(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def checked_image(data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise CoverError(413, "Image too large")
    content_type = sniff(data)
    if content_type is None:
        raise CoverError(415, "Unsupported image type")
    return content_type


def allowed_url(url: str) -> bool:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.username or parts.password or parts.port not in (None, 443):
        return False
    host = parts.hostname or ""
    return host in _HOSTS or host.endswith(_HOST_SUFFIXES)


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=10, follow_redirects=False)


async def fetch_image(url: str) -> bytes:
    async with _client() as client:
        for _ in range(_MAX_REDIRECTS + 1):
            if not allowed_url(url):
                raise CoverError(400, "URL not allowed")
            async with client.stream("GET", url) as resp:
                if resp.is_redirect:
                    url = urljoin(url, resp.headers.get("location", ""))
                    continue
                if resp.status_code != 200:
                    raise CoverError(502, "Image fetch failed")
                data = b""
                async for chunk in resp.aiter_bytes():
                    data += chunk
                    if len(data) > MAX_BYTES:
                        raise CoverError(413, "Image too large")
                return data
    raise CoverError(400, "Too many redirects")


async def _itunes(artist: str, album: str) -> list[dict]:
    async with _client() as client:
        resp = await client.get(
            "https://itunes.apple.com/search",
            params={"term": f"{artist} {album}", "entity": "album", "limit": 8},
        )
    return [
        {"url": item["artworkUrl100"].replace("100x100bb", "600x600bb"), "source": "iTunes"}
        for item in resp.json().get("results", [])
        if item.get("artworkUrl100")
    ]


async def _deezer(artist: str, album: str) -> list[dict]:
    async with _client() as client:
        resp = await client.get(
            "https://api.deezer.com/search/album",
            params={"q": f'artist:"{artist}" album:"{album}"', "limit": 5},
        )
    resp.raise_for_status()
    return [
        {"url": item["cover_xl"], "source": "Deezer"}
        for item in resp.json().get("data", [])
        if item.get("cover_xl")
    ]


async def _cover_art_archive(artist: str, album: str) -> list[dict]:
    return [
        {"url": f"https://coverartarchive.org/release/{mbid}/front-500", "source": "Cover Art Archive"}
        for mbid in await mb_release_ids(artist, album, MAX_RELEASES)
    ]


async def suggestions(artist: str, album: str) -> list[dict]:
    results = await asyncio.gather(
        _itunes(artist, album), _deezer(artist, album), _cover_art_archive(artist, album),
        return_exceptions=True,
    )
    seen: set[str] = set()
    found = []
    for source in results:
        if isinstance(source, BaseException):
            continue
        for s in source:
            if s["url"] not in seen and allowed_url(s["url"]):
                seen.add(s["url"])
                found.append(s)
    return found


def invalidate() -> None:
    global _ids
    _ids = None


async def override_ids(db: AsyncSession) -> set[str]:
    global _ids
    if _ids is None:
        _ids = set((await db.execute(select(CoverOverride.album_id))).scalars())
    return _ids


async def album_for_cover(cover_id: str, username: str, password: str, client) -> str | None:
    kind, _, rest = cover_id.partition("-")
    stem = rest.rsplit("_", 1)[0]
    if kind == "al":
        return stem
    if kind != "mf":
        return None
    if stem not in _song_albums:
        params = subsonic_auth_params(username, password)
        params["id"] = stem
        resp = await client.get(f"{NAVIDROME_URL}/rest/getSong.view", params=params)
        if resp.status_code != 200:
            return None
        song = resp.json().get("subsonic-response", {}).get("song", {})
        if not song.get("albumId"):
            return None
        if len(_song_albums) >= _SONG_CACHE_MAX:
            _song_albums.clear()
        _song_albums[stem] = song["albumId"]
    return _song_albums[stem]
