import asyncio
import html
import json
import os
import re
import subprocess

import httpx

from services import albums, cache

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


def _parse_release(rel: dict, rec: dict) -> dict | None:
    """Flatten one AcoustID release into a candidate the album resolver can vote on."""
    if not isinstance(rel, dict) or not rel.get("id"):
        return None

    date = rel.get("date") or {}
    artists = rel.get("artists") or []
    entry = {
        "id": rel["id"],
        "title": rel.get("title", ""),
        "artist": artists[0].get("name", "") if artists else "",
        "year": date.get("year") or 0,
        "month": date.get("month") or 0,
        "day": date.get("day") or 0,
        "track_count": rel.get("track_count") or 0,
        "release_group_id": (rel.get("releasegroup") or {}).get("id", ""),
        "recording_title": rec.get("title", ""),
        "recording_id": rec.get("id", ""),
    }

    rec_artists = rec.get("artists") or []
    if rec_artists:
        entry["recording_artist"] = rec_artists[0].get("name", "")

    # Track position, when the lookup returned mediums
    for medium in rel.get("mediums") or []:
        tracks = medium.get("tracks") or []
        if tracks:
            entry["track_number"] = tracks[0].get("position") or 0
            entry["medium"] = medium.get("position") or 0
            break

    # A release whose artist differs from the recording's is a compilation of
    # other people's work — Navidrome needs that flagged or it splits by artist.
    if entry["artist"] and entry.get("recording_artist"):
        entry["is_compilation"] = albums.norm_album(entry["artist"]) == "various artists"

    return entry


async def fingerprint_lookup(
    path: str, album_hint: str = "", release_mbid: str = ""
) -> dict | None:
    """Canonical metadata for one local file, from AcoustID/MusicBrainz.

    Returns every release the recording appears on under `releases`, because one
    file cannot decide which of them is "the" album — only the set of files can.
    An `album`/`release_mbid` is filled in only when a hint pins it or the file's
    own candidates are unambiguous; otherwise the caller keeps what it had.
    """
    fp_result = await asyncio.to_thread(_run_fpcalc, path)
    if not fp_result:
        return None
    duration, fp = fp_result

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.acoustid.org/v2/lookup",
                    params={
                        "client": ACOUSTID_KEY,
                        "duration": duration,
                        "fingerprint": fp,
                        # "releases" and "releasegroups" are alternatives, not
                        # additive — asking for both returns neither. "tracks" is
                        # what carries each release's track positions.
                        "meta": "recordings releases tracks",
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

    # Several recordings can share a fingerprint (remasters, re-releases). Take
    # title/artist from the most-sourced one, but collect releases from all of
    # them so the album resolver sees every release the track could belong to.
    rec = max(recordings, key=lambda r: r.get("sources", 0))
    meta: dict = {"title": rec.get("title", ""), "mbid": rec.get("id", "")}
    artists = rec.get("artists") or []
    if artists:
        meta["artist"] = artists[0].get("name", "")
        meta["artist_mbid"] = artists[0].get("id", "")

    candidates: list[dict] = []
    seen: set[str] = set()
    for recording in recordings:
        for rel in recording.get("releases") or []:
            entry = _parse_release(rel, recording)
            if entry and entry["id"] not in seen:
                seen.add(entry["id"])
                candidates.append(entry)
    meta["releases"] = candidates

    chosen = albums.choose_release(
        [candidates], hint_album=album_hint, hint_release_mbid=release_mbid, min_coverage=1.0
    )
    if chosen:
        meta["album"] = chosen.get("title", "")
        meta["release_mbid"] = chosen.get("id", "")
        num = albums.track_number(candidates, chosen.get("id", ""))
        if num:
            meta["track_number"] = num

    return meta


async def mb_search_release(artist: str, album: str) -> dict | None:
    """Find a release by name, for tracks that aren't downloaded yet.

    Prefers the earliest official release in the release group so an album and its
    reissues collapse onto one identity.
    """
    query = f'release:"{album}" AND artist:"{artist}"' if artist else f'release:"{album}"'
    data = await _musicbrainz_get(
        "https://musicbrainz.org/ws/2/release",
        {"query": query, "fmt": "json", "limit": 10},
    )
    releases = data.get("releases") or []
    if not releases:
        return None

    target = albums.norm_album(album)
    matches = [r for r in releases if albums.norm_album(r.get("title", "")) == target] or releases

    def rank(r: dict) -> tuple:
        credit = r.get("artist-credit") or []
        name = credit[0].get("name", "") if credit else ""
        date = (r.get("date") or "").replace("-", "")
        return (
            r.get("score", 0),
            -int(date.ljust(8, "0")) if date else -99999999,
            albums.norm_album(name) == albums.norm_album(artist),
        )

    best = max(matches, key=rank)
    credit = best.get("artist-credit") or []
    date = (best.get("date") or "").split("-")
    group = best.get("release-group") or {}
    return {
        "id": best.get("id", ""),
        "title": best.get("title", ""),
        "artist": credit[0].get("name", "") if credit else "",
        "year": int(date[0]) if date and date[0].isdigit() else 0,
        "track_count": best.get("track-count") or 0,
        "release_group_id": group.get("id", ""),
        "is_compilation": "Compilation" in (group.get("secondary-types") or []),
    }


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
    """Fetch missing album art (iTunes first, MusicBrainz fallback) with shared client."""
    to_enrich = [t for t in tracks if not t.get("image")]
    if not to_enrich:
        return tracks

    sem = asyncio.Semaphore(8)

    async def _fetch_and_update(track: dict) -> None:
        async with sem:
            img = await _itunes_artwork(track["artist"], track["title"])
            if not img:
                img = await _musicbrainz_artwork(track["artist"], track["title"])
            if img:
                track["image"] = img

    await asyncio.gather(*[_fetch_and_update(t) for t in to_enrich], return_exceptions=True)
    return tracks


_LASTFM_SEM = asyncio.Semaphore(4)


async def _lastfm_call(client: httpx.AsyncClient, params: dict) -> dict:
    """Throttled Last.fm GET with retry. Returns parsed JSON or {}."""
    async with _LASTFM_SEM:
        for attempt in range(3):
            try:
                resp = await client.get("https://ws.audioscrobbler.com/2.0/", params=params)
                if resp.status_code == 200:
                    return resp.json()
                if resp.status_code == 429:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
            except Exception:
                pass
            await asyncio.sleep(0.4 * (2 ** attempt))
    return {}


async def lastfm_similar(artist: str, title: str, limit: int = 10) -> list[dict]:
    """Return similar tracks from Last.fm. Falls back to artist.getSimilar if track is unknown."""
    async with httpx.AsyncClient(timeout=10) as client:
        data = await _lastfm_call(client, {
            "method": "track.getSimilar",
            "artist": artist,
            "track": title,
            "api_key": LASTFM_KEY,
            "format": "json",
            "limit": limit,
        })
        tracks = data.get("similartracks", {}).get("track", [])
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

        data = await _lastfm_call(client, {
            "method": "artist.getSimilar",
            "artist": artist,
            "api_key": LASTFM_KEY,
            "format": "json",
            "limit": limit,
        })
        similar_artists = data.get("similarartists", {}).get("artist", [])
        if not similar_artists:
            return []

        async def _top_tracks(name: str, artist_score: float) -> list[dict]:
            d = await _lastfm_call(client, {
                "method": "artist.getTopTracks",
                "artist": name,
                "api_key": LASTFM_KEY,
                "format": "json",
                "limit": 3,
            })
            top = d.get("toptracks", {}).get("track", [])
            return [
                {"artist": name, "title": t["name"], "image": _best_image(t.get("image", [])), "score": artist_score}
                for t in top
            ]

        nested = await asyncio.gather(*[
            _top_tracks(sa["name"], float(sa.get("match", 0)))
            for sa in similar_artists[:15] if sa.get("name")
        ], return_exceptions=True)
        return [t for result in nested if isinstance(result, list) for t in result]


_TAG_RE = re.compile(r"<[^>]+>")
# Last.fm appends this boilerplate to every bio; the link is preserved separately
# as the attribution URL, so drop the sentence itself.
_READ_MORE_RE = re.compile(r"\s*Read more on Last\.fm.*$", re.IGNORECASE | re.DOTALL)
_USER_CONTENT_RE = re.compile(r"\s*User-contributed text is available under.*$", re.IGNORECASE | re.DOTALL)


def _clean_bio(raw: str) -> str:
    """Last.fm bios are HTML fragments with trailing attribution boilerplate."""
    if not raw:
        return ""
    text = _TAG_RE.sub("", raw)
    text = html.unescape(text)
    text = _READ_MORE_RE.sub("", text)
    text = _USER_CONTENT_RE.sub("", text)
    return text.strip()


def _tag_names(container, limit: int = 8) -> list[str]:
    """Last.fm returns tags as {'tag': [...]}, a bare dict, or '' when empty."""
    if not isinstance(container, dict):
        return []
    tags = container.get("tag", [])
    if isinstance(tags, dict):
        tags = [tags]
    if not isinstance(tags, list):
        return []
    return [t["name"] for t in tags if isinstance(t, dict) and t.get("name")][:limit]


def _as_int(value) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0


_MB_SEM = asyncio.Semaphore(1)
_MB_MIN_INTERVAL = 1.1  # MusicBrainz allows ~1 req/s for anonymous clients
_mb_last_call = 0.0


async def _musicbrainz_get(url: str, params: dict) -> dict:
    """Serialised, rate-limited MusicBrainz GET. Back-to-back calls get a 503,
    which silently drops the enrichment, so space them out and retry."""
    global _mb_last_call
    async with _MB_SEM:
        for attempt in range(3):
            wait = _MB_MIN_INTERVAL - (asyncio.get_event_loop().time() - _mb_last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                async with httpx.AsyncClient(timeout=8) as client:
                    resp = await client.get(url, params=params, headers=_MB_HEADERS)
                _mb_last_call = asyncio.get_event_loop().time()
                if resp.status_code == 200:
                    return resp.json()
                if resp.status_code != 503:
                    return {}
            except Exception:
                _mb_last_call = asyncio.get_event_loop().time()
            await asyncio.sleep(1.0 * (attempt + 1))
    return {}


async def _musicbrainz_artist(mbid: str) -> dict:
    """Formation date, origin, and line-up for an artist, keyed by MusicBrainz ID."""
    if not mbid:
        return {}
    data = await _musicbrainz_get(
        f"https://musicbrainz.org/ws/2/artist/{mbid}",
        {"fmt": "json", "inc": "artist-rels"},
    )
    if not data:
        return {}

    life_span = data.get("life-span") or {}
    out: dict = {
        "type": data.get("type") or "",
        "country": data.get("country") or "",
        "began": (life_span.get("begin") or "")[:10],
        "ended": (life_span.get("end") or "")[:10],
    }
    area = data.get("area") or {}
    begin_area = data.get("begin-area") or {}
    out["origin"] = begin_area.get("name") or area.get("name") or ""

    # "member of band" relations point at the members when direction is backward
    # (we're the band) and at the bands when forward (we're a person). MusicBrainz
    # emits one relation per instrument and per stint, so dedupe by name.
    members: list[str] = []
    member_of: list[str] = []
    for rel in data.get("relations") or []:
        if not isinstance(rel, dict) or rel.get("type") != "member of band":
            continue
        name = (rel.get("artist") or {}).get("name")
        if not name:
            continue
        bucket = members if rel.get("direction") == "backward" else member_of
        if name not in bucket:
            bucket.append(name)
    out["members"] = members[:12]
    out["member_of"] = member_of[:12]
    return out


def _top_genre(entity: dict) -> str:
    """Pick the highest-voted MusicBrainz genre. Counts separate real consensus
    ('trip hop', 20) from the long tail of one-off tags."""
    genres = [
        g for g in (entity.get("genres") or [])
        if isinstance(g, dict) and g.get("name")
    ]
    if not genres:
        return ""
    best = max(genres, key=lambda g: (g.get("count") or 0, g["name"]))
    return best["name"]


async def _mb_release_group_genre(artist: str, album: str) -> str:
    search = await _musicbrainz_get(
        "https://musicbrainz.org/ws/2/release-group",
        {"query": f'artist:"{artist}" AND releasegroup:"{album}"', "fmt": "json", "limit": 1},
    )
    groups = search.get("release-groups") or []
    if not groups:
        return ""
    detail = await _musicbrainz_get(
        f"https://musicbrainz.org/ws/2/release-group/{groups[0]['id']}",
        {"fmt": "json", "inc": "genres"},
    )
    return _top_genre(detail)


async def _mb_artist_genre(artist: str) -> str:
    search = await _musicbrainz_get(
        "https://musicbrainz.org/ws/2/artist",
        {"query": f'artist:"{artist}"', "fmt": "json", "limit": 1},
    )
    artists = search.get("artists") or []
    if not artists:
        return ""
    detail = await _musicbrainz_get(
        f"https://musicbrainz.org/ws/2/artist/{artists[0]['id']}",
        {"fmt": "json", "inc": "genres"},
    )
    return _top_genre(detail)


# Placeholder album used when a single is downloaded without album context —
# never worth a release-group search.
_PLACEHOLDER_ALBUMS = {"", "youtube", "unknown", "single", "singles"}


async def lookup_genre(artist: str, album: str | None) -> str:
    """Real musical genre for a track, from MusicBrainz. Album-level first, then
    artist-level for singles. Returns '' when MusicBrainz has no opinion."""
    artist = (artist or "").strip()
    if not artist:
        return ""
    album = (album or "").strip()

    key = f"genre:{artist.lower()}:{album.lower()}"
    cached = cache.json_get(key, 30 * 24 * 3600)
    if cached is not None:
        return cached.get("genre", "")

    genre = ""
    try:
        if album and album.lower() not in _PLACEHOLDER_ALBUMS:
            genre = await _mb_release_group_genre(artist, album)
        if not genre:
            genre = await _mb_artist_genre(artist)
    except Exception:
        return ""

    cache.json_set(key, {"genre": genre})
    return genre


async def lastfm_artist_info(artist: str) -> dict:
    """Biography, tags, popularity, and similar artists for an artist."""
    async with httpx.AsyncClient(timeout=10) as client:
        data = await _lastfm_call(client, {
            "method": "artist.getInfo",
            "artist": artist,
            "api_key": LASTFM_KEY,
            "format": "json",
            "autocorrect": "1",
        })

    info = data.get("artist")
    if not isinstance(info, dict):
        return {}

    bio = info.get("bio") if isinstance(info.get("bio"), dict) else {}
    stats = info.get("stats") if isinstance(info.get("stats"), dict) else {}
    similar_raw = info.get("similar") if isinstance(info.get("similar"), dict) else {}
    similar = similar_raw.get("artist", [])
    if isinstance(similar, dict):
        similar = [similar]

    out = {
        "name": info.get("name", artist),
        "mbid": info.get("mbid", ""),
        "url": info.get("url", ""),
        "bio": _clean_bio(bio.get("content", "") or bio.get("summary", "")),
        "tags": _tag_names(info.get("tags")),
        "listeners": _as_int(stats.get("listeners")),
        "playcount": _as_int(stats.get("playcount")),
        "similar": [
            {"name": s["name"], "url": s.get("url", "")}
            for s in similar
            if isinstance(s, dict) and s.get("name")
        ][:8],
    }

    mb = await _musicbrainz_artist(out["mbid"])
    out.update({
        "type": mb.get("type", ""),
        "origin": mb.get("origin", ""),
        "country": mb.get("country", ""),
        "began": mb.get("began", ""),
        "ended": mb.get("ended", ""),
        "members": mb.get("members", []),
        "member_of": mb.get("member_of", []),
    })
    return out


async def lastfm_album_info(artist: str, album: str) -> dict:
    """Release notes, tags, and popularity for an album."""
    async with httpx.AsyncClient(timeout=10) as client:
        data = await _lastfm_call(client, {
            "method": "album.getInfo",
            "artist": artist,
            "album": album,
            "api_key": LASTFM_KEY,
            "format": "json",
            "autocorrect": "1",
        })

    info = data.get("album")
    if not isinstance(info, dict):
        return {}

    # wiki.published is the Last.fm edit timestamp, not a release date — omitted
    # deliberately, the album's own year tag is the trustworthy source.
    wiki = info.get("wiki") if isinstance(info.get("wiki"), dict) else {}
    return {
        "name": info.get("name", album),
        "artist": info.get("artist", artist),
        "mbid": info.get("mbid", ""),
        "url": info.get("url", ""),
        "wiki": _clean_bio(wiki.get("content", "") or wiki.get("summary", "")),
        "tags": _tag_names(info.get("tags")),
        "listeners": _as_int(info.get("listeners")),
        "playcount": _as_int(info.get("playcount")),
    }


async def lastfm_album_tracks(artist: str, album: str) -> list[dict]:
    """Return tracks in album order from Last.fm. Each dict has 'title' and 'rank'."""
    async with httpx.AsyncClient(timeout=10) as client:
        data = await _lastfm_call(client, {
            "method": "album.getInfo",
            "artist": artist,
            "album": album,
            "api_key": LASTFM_KEY,
            "format": "json",
        })
    tracks = data.get("album", {}).get("tracks", {}).get("track", [])
    if not isinstance(tracks, list):
        tracks = [tracks] if tracks else []
    return [
        {"title": t["name"], "rank": int(t.get("@attr", {}).get("rank", i + 1))}
        for i, t in enumerate(tracks)
        if t.get("name")
    ]
