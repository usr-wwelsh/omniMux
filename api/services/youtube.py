import urllib.parse
from dataclasses import dataclass

import yt_dlp


@dataclass
class SearchResult:
    youtube_id: str
    title: str
    artist: str
    duration: int  # seconds
    thumbnail_url: str
    url: str


@dataclass
class AlbumResult:
    playlist_id: str
    title: str
    artist: str
    track_count: int
    thumbnail_url: str
    url: str


def search_youtube(query: str, limit: int = 20) -> list[SearchResult]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }

    results = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
        entries = info.get("entries", []) if info else []

        for entry in entries:
            if not entry:
                continue
            youtube_id = entry.get("id", "")
            title = entry.get("title", "Unknown")
            artist = entry.get("channel", entry.get("uploader", "Unknown"))
            duration = entry.get("duration") or 0
            thumbnail = entry.get("thumbnail", entry.get("thumbnails", [{}])[0].get("url", "") if entry.get("thumbnails") else "")

            results.append(SearchResult(
                youtube_id=youtube_id,
                title=title,
                artist=artist,
                duration=int(duration),
                thumbnail_url=thumbnail,
                url=f"https://www.youtube.com/watch?v={youtube_id}",
            ))

    results.sort(key=lambda r: 0 if "- topic" in r.artist.lower() else 1)
    return results


def _title_score(result: "AlbumResult", artist: str, album: str) -> tuple[int, int]:
    """Return (topic_bonus, title_similarity) — higher is better."""
    topic = 1 if "- topic" in result.artist.lower() else 0
    t = result.title.lower()
    a = album.lower()
    ar = artist.lower()
    if t == a:
        sim = 3
    elif a in t and ar in t:
        sim = 2
    elif a in t:
        sim = 1
    else:
        sim = 0
    return (topic, sim)


def get_youtube_album_tracks(artist: str, album: str) -> list[SearchResult]:
    """Find the YouTube album playlist for artist/album and return its tracks."""
    album_results = search_youtube_albums(f"{artist} {album}", limit=10)
    if not album_results:
        return []

    # Pick the best match: prefer Topic channel + closest title match
    best = max(album_results, key=lambda r: _title_score(r, artist, album))
    # Bail out if nothing remotely matches — avoids returning tracks from a random playlist
    if _title_score(best, artist, album) == (0, 0):
        return []

    playlist_url = best.url

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
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
                if not entry or not entry.get("id"):
                    continue
                youtube_id = entry["id"]
                title = entry.get("title", "Unknown")
                artist_name = entry.get("channel", entry.get("uploader", artist))
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
        pass
    return results


def search_youtube_albums(query: str, limit: int = 10) -> list[AlbumResult]:
    """Search YouTube for album playlists matching the query."""
    # sp=EgIQAw%3D%3D is YouTube's search filter for Type: Playlist
    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}&sp=EgIQAw%3D%3D"
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        "ignoreerrors": True,
    }
    results = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return []
            for entry in (info.get("entries") or []):
                if not entry or not entry.get("id"):
                    continue
                playlist_id = entry["id"]
                thumbnails = entry.get("thumbnails") or []
                thumb = thumbnails[-1].get("url", "") if thumbnails else entry.get("thumbnail", "")
                results.append(AlbumResult(
                    playlist_id=playlist_id,
                    title=entry.get("title", "Unknown Album"),
                    artist=entry.get("channel", entry.get("uploader", "")),
                    track_count=entry.get("playlist_count") or 0,
                    thumbnail_url=thumb,
                    url=entry.get("url") or f"https://www.youtube.com/playlist?list={playlist_id}",
                ))
                if len(results) >= limit:
                    break
    except Exception:
        pass
    return results
