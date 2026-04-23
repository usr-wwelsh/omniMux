import asyncio
import json
import os
import subprocess

import httpx

_CK = bytes([0x4f, 0x2a, 0x71, 0x93, 0x1c, 0x8b])
_AK = bytes([34, 66, 41, 247, 116, 185, 28, 91, 38, 220])
_LK = bytes([42, 28, 73, 164, 125, 237, 124, 26, 69, 245, 126, 185, 42, 78, 66, 165, 43, 237, 42, 31, 68, 164, 127, 179, 118, 30, 67, 161, 37, 237, 45, 19])


def _dk(data: bytes) -> str:
    return bytes(b ^ _CK[i % len(_CK)] for i, b in enumerate(data)).decode()


ACOUSTID_KEY = os.environ.get("ACOUSTID_KEY") or _dk(_AK)
LASTFM_KEY = os.environ.get("LASTFM_KEY") or _dk(_LK)
_MB_HEADERS = {"User-Agent": "omniMux/0.1 (omnimux.wwel.sh)"}


def _run_fpcalc(path: str) -> tuple[int, str] | None:
    try:
        result = subprocess.run(
            ["fpcalc", "-json", path],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        return int(data["duration"]), data["fingerprint"]
    except Exception:
        return None


async def fingerprint_lookup(path: str) -> dict | None:
    """Fingerprint a local file and return canonical metadata from AcousticID/MusicBrainz, or None."""
    fp_result = await asyncio.to_thread(_run_fpcalc, path)
    if not fp_result:
        return None
    duration, fp = fp_result

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://api.acoustid.org/v2/lookup",
                    params={
                        "client": ACOUSTID_KEY,
                        "duration": duration,
                        "fingerprint": fp,
                        "meta": "recordings releases",
                    },
                )
            data = resp.json()
            break
        except Exception:
            await asyncio.sleep(2 ** attempt)
    else:
        return None

    if data.get("status") != "ok" or not data.get("results"):
        return None

    best = max(data["results"], key=lambda r: r.get("score", 0))
    if best.get("score", 0) < 0.85:
        return None

    recordings = best.get("recordings", [])
    if not recordings:
        return None

    rec = recordings[0]
    meta: dict = {"title": rec.get("title", ""), "mbid": rec.get("id", "")}
    artists = rec.get("artists", [])
    if artists:
        meta["artist"] = artists[0].get("name", "")
        meta["artist_mbid"] = artists[0].get("id", "")
    releases = rec.get("releases", [])
    if releases:
        meta["album"] = releases[0].get("title", "")
        meta["release_mbid"] = releases[0].get("id", "")
    return meta


_LASTFM_PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"


def _best_image(images) -> str:
    if not images or not isinstance(images, list):
        return ""
    for size in ("extralarge", "large", "medium", "small"):
        for img in images:
            if not isinstance(img, dict):
                continue
            if img.get("size") == size and img.get("#text"):
                url = img["#text"]
                if _LASTFM_PLACEHOLDER not in url:
                    return url
    return ""


async def _musicbrainz_artwork(artist: str, title: str) -> str:
    """Fetch album artwork from MusicBrainz Cover Art Archive."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(
                "https://musicbrainz.org/ws/2/recording",
                params={"query": f'"{title}" AND artist:"{artist}"', "limit": 5, "fmt": "json"},
                headers=_MB_HEADERS,
            )
        recordings = resp.json().get("recordings", [])
        for recording in recordings:
            releases = recording.get("releases", [])
            for release in releases:
                mbid = release.get("id", "")
                if mbid:
                    try:
                        art_resp = await client.get(
                            f"https://coverartarchive.org/release/{mbid}/front.json",
                            timeout=2,
                        )
                        if art_resp.status_code == 200:
                            data = art_resp.json()
                            images = data.get("images", [])
                            if images:
                                return images[0].get("image", "")
                    except Exception:
                        continue
        return ""
    except Exception:
        return ""


async def _itunes_artwork(artist: str, title: str, retries: int = 2) -> str:
    """Fetch album artwork from iTunes Search API with retries."""
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.get(
                    "https://itunes.apple.com/search",
                    params={
                        "term": f"{artist} {title}",
                        "media": "music",
                        "limit": 1,
                    },
                )
            results = resp.json().get("results", [])
            if results:
                url = results[0].get("artworkUrl100", "")
                if url:
                    return url.replace("100x100bb", "500x500bb")
        except Exception:
            pass
        if attempt < retries - 1:
            await asyncio.sleep(0.3 * (2 ** attempt))
    return ""


async def enrich_images(tracks: list[dict]) -> list[dict]:
    """Fetch missing album art from MusicBrainz or iTunes in parallel batches."""
    to_enrich = [t for t in tracks if not t.get("image")]
    if not to_enrich:
        return tracks

    async def _fetch_and_update(track: dict) -> None:
        """Fetch image from MusicBrainz first, fall back to iTunes."""
        img = await _musicbrainz_artwork(track["artist"], track["title"])
        if not img:
            img = await _itunes_artwork(track["artist"], track["title"])
        if img:
            track["image"] = img

    # Batch in groups of 20 for parallel requests (MB is slower)
    batch_size = 20
    for i in range(0, len(to_enrich), batch_size):
        batch = to_enrich[i : i + batch_size]
        await asyncio.gather(*[_fetch_and_update(t) for t in batch], return_exceptions=True)

    return tracks


async def lastfm_similar(artist: str, title: str, limit: int = 10) -> list[dict]:
    """Return similar tracks from Last.fm. Falls back to artist.getSimilar if track is unknown."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://ws.audioscrobbler.com/2.0/",
                params={
                    "method": "track.getSimilar",
                    "artist": artist,
                    "track": title,
                    "api_key": LASTFM_KEY,
                    "format": "json",
                    "limit": limit,
                },
            )
        tracks = resp.json().get("similartracks", {}).get("track", [])
        if tracks:
            return [
                {
                    "artist": t["artist"]["name"],
                    "title": t["name"],
                    "image": _best_image(t.get("image", [])),
                    "score": float(t.get("match", 0)),
                }
                for t in tracks
            ]
    except Exception:
        pass

    # Fallback: artist.getSimilar — much higher coverage since it only needs the artist name
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://ws.audioscrobbler.com/2.0/",
                params={
                    "method": "artist.getSimilar",
                    "artist": artist,
                    "api_key": LASTFM_KEY,
                    "format": "json",
                    "limit": limit,
                },
            )
        similar_artists = resp.json().get("similarartists", {}).get("artist", [])
        if not similar_artists:
            return []

        # Get top tracks for each similar artist (parallel, capped at 20)
        sa_names = [sa["name"] for sa in similar_artists[:20] if sa.get("name")]

        async def _top_tracks(name: str, artist_score: float) -> list[dict]:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    tr = await client.get(
                        "https://ws.audioscrobbler.com/2.0/",
                        params={
                            "method": "artist.getTopTracks",
                            "artist": name,
                            "api_key": LASTFM_KEY,
                            "format": "json",
                            "limit": 3,
                        },
                    )
                top = tr.json().get("toptracks", {}).get("track", [])
                return [
                    {"artist": name, "title": t["name"], "image": _best_image(t.get("image", [])), "score": artist_score}
                    for t in top
                ]
            except Exception:
                return []

        nested = await asyncio.gather(*[
            _top_tracks(sa["name"], float(sa.get("match", 0)))
            for sa in similar_artists[:20] if sa.get("name")
        ])
        return [t for tracks in nested for t in tracks]
    except Exception:
        return []
