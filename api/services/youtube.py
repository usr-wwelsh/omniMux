import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import yt_dlp
from ytmusicapi import YTMusic

_ytm = YTMusic()


@dataclass
class SearchResult:
    youtube_id: str
    title: str
    artist: str
    duration: int  # seconds
    thumbnail_url: str
    url: str
    album: str = ""


@dataclass
class AlbumResult:
    playlist_id: str
    title: str
    artist: str
    track_count: int
    thumbnail_url: str
    url: str


def _best_thumb(thumbnails: list) -> str:
    if not thumbnails:
        return ""
    sized = [(t.get("width") or 0, t.get("url", "")) for t in thumbnails if t.get("url")]
    if not sized:
        return thumbnails[-1].get("url", "")
    # Prefer smallest thumbnail >= 200px; fall back to largest available
    candidates = [(w, u) for w, u in sized if w >= 200]
    if candidates:
        return min(candidates, key=lambda x: x[0])[1]
    return max(sized, key=lambda x: x[0])[1]


def _artist_name(r: dict, fallback: str = "Unknown") -> str:
    artists = r.get("artists") or []
    return artists[0]["name"] if artists else fallback


def search_youtube(query: str, limit: int = 20) -> list[SearchResult]:
    try:
        raw = _ytm.search(query, filter="songs", limit=limit)
    except Exception:
        raw = []

    results = []
    for r in (raw or [])[:limit]:
        vid = r.get("videoId")
        if not vid:
            continue
        results.append(SearchResult(
            youtube_id=vid,
            title=r.get("title", "Unknown"),
            artist=_artist_name(r),
            duration=r.get("duration_seconds") or 0,
            thumbnail_url=_best_thumb(r.get("thumbnails") or []),
            url=f"https://www.youtube.com/watch?v={vid}",
            album=(r.get("album") or {}).get("name", ""),
        ))
    return results


def search_youtube_albums(query: str, limit: int = 10) -> list[AlbumResult]:
    try:
        raw = _ytm.search(query, filter="albums", limit=limit)
    except Exception:
        raw = []

    results = []
    for r in (raw or [])[:limit]:
        playlist_id = r.get("playlistId") or r.get("browseId")
        if not playlist_id:
            continue
        results.append(AlbumResult(
            playlist_id=playlist_id,
            title=r.get("title", "Unknown Album"),
            artist=_artist_name(r, ""),
            track_count=r.get("trackCount") or 0,
            thumbnail_url=_best_thumb(r.get("thumbnails") or []),
            url=f"https://www.youtube.com/playlist?list={playlist_id}",
        ))
    return results


def _find_artist(artist: str) -> dict | None:
    try:
        results = _ytm.search(artist, filter="artists", limit=5)
        for r in (results or []):
            name = r.get("artist") or r.get("title", "")
            if artist.lower() in name.lower() or name.lower() in artist.lower():
                return _ytm.get_artist(r["browseId"])
    except Exception:
        pass
    return None


def _get_all_artist_albums(artist_data: dict, section_key: str) -> list[dict]:
    section = artist_data.get(section_key, {})
    browse_id = section.get("browseId")
    params = section.get("params")
    if browse_id and params:
        try:
            return _ytm.get_artist_albums(browse_id, params) or []
        except Exception:
            pass
    return section.get("results") or []


def _build_album_results(artist: str, album_list: list[dict]) -> list[AlbumResult]:
    results = []
    seen: set[str] = set()
    for album in album_list:
        playlist_id = album.get("playlistId") or album.get("audioPlaylistId")
        browse_id = album.get("browseId")
        if not playlist_id and not browse_id:
            continue
        pid = playlist_id or browse_id
        if pid in seen:
            continue
        seen.add(pid)
        url = (
            f"https://www.youtube.com/playlist?list={playlist_id}"
            if playlist_id
            else f"https://music.youtube.com/browse/{browse_id}"
        )
        results.append(AlbumResult(
            playlist_id=pid,
            title=album.get("title", "Unknown"),
            artist=artist,
            track_count=0,
            thumbnail_url=_best_thumb(album.get("thumbnails") or []),
            url=url,
        ))
    return results


def get_artist_topic_albums(artist: str, limit: int = 200, quick: bool = False) -> list[AlbumResult]:
    artist_data = _find_artist(artist)
    if not artist_data:
        return []

    results = []
    for section_key in ("albums", "singles"):
        section = artist_data.get(section_key, {})
        album_list = section.get("results") or [] if quick else _get_all_artist_albums(artist_data, section_key)
        results.extend(_build_album_results(artist, album_list))
    return results[:limit]


def get_artist_topic_tracks(artist: str, limit: int = 2000) -> list[SearchResult]:
    artist_data = _find_artist(artist)
    if not artist_data:
        return []

    album_list = []
    for section_key in ("albums", "singles"):
        album_list.extend(_get_all_artist_albums(artist_data, section_key))
    if not album_list:
        return []

    def fetch_album(album: dict) -> list[SearchResult]:
        try:
            browse_id = album.get("browseId")
            if not browse_id:
                return []
            album_data = _ytm.get_album(browse_id)
            album_thumb = _best_thumb(
                album_data.get("thumbnails") or album.get("thumbnails") or []
            )
            tracks = []
            for track in (album_data.get("tracks") or []):
                vid = track.get("videoId")
                if not vid:
                    continue
                thumb = _best_thumb(track.get("thumbnails") or []) or album_thumb
                tracks.append(SearchResult(
                    youtube_id=vid,
                    title=track.get("title", "Unknown"),
                    artist=_artist_name(track, artist),
                    duration=track.get("duration_seconds") or 0,
                    thumbnail_url=thumb,
                    url=f"https://www.youtube.com/watch?v={vid}",
                    album=album.get("title", ""),
                ))
            return tracks
        except Exception:
            return []

    album_results: dict[int, list[SearchResult]] = {}
    with ThreadPoolExecutor(max_workers=min(8, len(album_list))) as ex:
        future_to_idx = {ex.submit(fetch_album, a): i for i, a in enumerate(album_list)}
        for future in as_completed(future_to_idx):
            album_results[future_to_idx[future]] = future.result()

    all_tracks: list[SearchResult] = []
    for i in range(len(album_list)):
        all_tracks.extend(album_results.get(i, []))

    return all_tracks[:limit]


def get_youtube_album_tracks(artist: str, album: str) -> list[SearchResult]:
    try:
        raw = _ytm.search(f"{artist} {album}", filter="albums", limit=5)
        for r in (raw or []):
            browse_id = r.get("browseId")
            if not browse_id:
                continue
            r_title = r.get("title", "").lower()
            if album.lower() not in r_title and r_title not in album.lower():
                continue
            album_data = _ytm.get_album(browse_id)
            album_thumb = _best_thumb(album_data.get("thumbnails") or [])
            tracks = []
            for track in (album_data.get("tracks") or []):
                vid = track.get("videoId")
                if not vid:
                    continue
                thumb = _best_thumb(track.get("thumbnails") or []) or album_thumb
                tracks.append(SearchResult(
                    youtube_id=vid,
                    title=track.get("title", "Unknown"),
                    artist=_artist_name(track, artist),
                    duration=track.get("duration_seconds") or 0,
                    thumbnail_url=thumb,
                    url=f"https://www.youtube.com/watch?v={vid}",
                ))
            return tracks
    except Exception:
        pass
    return []


def get_artist_youtube_albums(artist: str, limit: int = 20) -> list[AlbumResult]:
    return search_youtube_albums(f"{artist} full album", limit)


def get_playlist_tracks(playlist_url: str, fallback_artist: str = "") -> list[SearchResult]:
    """Fetch tracks from an arbitrary playlist URL via yt-dlp."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "lazy_playlist": False,
        "skip_download": True,
        "ignoreerrors": True,
    }
    results = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(playlist_url, download=False)
            if not info:
                return []
            for entry in (info.get("entries") or []):
                try:
                    if not entry or not entry.get("id"):
                        continue
                    youtube_id = entry["id"]
                    title = entry.get("title", "Unknown")
                    artist_name = entry.get("channel", entry.get("uploader", fallback_artist))
                    duration = entry.get("duration") or 0
                    thumbnails = entry.get("thumbnails") or []
                    thumb = thumbnails[-1].get("url", "") if thumbnails else entry.get("thumbnail", "")
                    results.append(SearchResult(
                        youtube_id=youtube_id,
                        title=title,
                        artist=artist_name,
                        duration=int(duration),
                        thumbnail_url=thumb,
                        url=f"https://www.youtube.com/watch?v={youtube_id}",
                    ))
                except Exception:
                    continue
    except Exception:
        pass
    return results
