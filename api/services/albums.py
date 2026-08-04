"""Album identity — decided once for a set of tracks, applied identically to all of them.

A recording appears on dozens of MusicBrainz releases (original, reissues, every
compilation it was ever licensed to). Resolving that per file, independently, is
what splits one album into five. Everything here takes a *set* of tracks and
returns a single answer for the whole set.
"""

import asyncio
import re
from collections import defaultdict

from services import cache

# Albums that carry no identity — never worth resolving or preserving.
PLACEHOLDER_ALBUMS = {
    "", "youtube", "unknown", "unknown album", "single", "singles",
    "various", "various artists", "topic",
}

VARIOUS_ARTISTS = "Various Artists"

_EDITION_RE = re.compile(
    r"\s*[\(\[][^\)\]]*\b(deluxe|expanded|remaster(?:ed)?|edition|version|reissue|"
    r"anniversary|bonus|explicit|clean|mono|stereo|disc\s*\d+)\b[^\)\]]*[\)\]]",
    re.IGNORECASE,
)
_SUFFIX_RE = re.compile(
    r"\s*[-–]\s*(single|ep|deluxe\b.*|remaster(?:ed)?\b.*|.*\bedition)$", re.IGNORECASE
)
_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")

_RESOLVE_TTL = 90 * 24 * 3600
_locks: dict[str, asyncio.Lock] = {}


def norm_album(name: str) -> str:
    """Comparison key. Edition suffixes and punctuation are not album identity —
    "Abbey Road (Remastered)" and "Abbey Road" are the same album."""
    s = (name or "").lower()
    s = _EDITION_RE.sub("", s)
    s = _SUFFIX_RE.sub("", s)
    s = _PUNCT_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


def is_placeholder(album: str) -> bool:
    return norm_album(album) in PLACEHOLDER_ALBUMS


def _date_int(release: dict) -> int:
    """Sortable release date; undated releases sort last."""
    y, m, d = release.get("year") or 0, release.get("month") or 0, release.get("day") or 0
    if not y:
        return 99999999
    return y * 10000 + (m or 1) * 100 + (d or 1)


def choose_release(
    candidate_sets: list[list[dict]],
    hint_album: str = "",
    hint_release_mbid: str = "",
    min_coverage: float = 0.5,
) -> dict | None:
    """Pick the one release a whole set of tracks agrees on.

    `candidate_sets` holds one list of AcoustID release candidates per file (empty
    lists allowed). Returns the winning release with a `coverage` key, or None when
    the set doesn't agree well enough — in which case the caller must leave the
    existing album tags alone rather than guess.
    """
    populated = [c for c in candidate_sets if c]
    if not populated:
        return None

    votes: dict[str, int] = defaultdict(int)
    info: dict[str, dict] = {}
    for candidates in populated:
        for mbid in {c["id"] for c in candidates if c.get("id")}:
            votes[mbid] += 1
        for c in candidates:
            if c.get("id"):
                info.setdefault(c["id"], c)

    if not votes:
        return None

    if hint_release_mbid and hint_release_mbid in info:
        winner = hint_release_mbid
        matched_hint = True
    else:
        hint_key = norm_album(hint_album) if not is_placeholder(hint_album) else ""
        total = len(populated)

        def score(mbid: str) -> tuple:
            rel = info[mbid]
            count = rel.get("track_count") or 0
            # Every track of an album is also on the box set and the greatest-hits,
            # and those score *better* on raw agreement because they contain
            # everything. So agreement is only a threshold to clear; among releases
            # that clear it, the album is the tightest one that can still hold its
            # own voters — 8 tracks on an 8-track album, not on a 61-track set.
            return (
                1 if hint_key and norm_album(rel.get("title", "")) == hint_key else 0,
                1 if votes[mbid] / total >= min_coverage else 0,
                1 if (not count or count >= votes[mbid]) else 0,
                -(count or 100000),
                votes[mbid],
                -len(rel.get("title", "")),   # prefer the plain title over "(Deluxe Edition)"
                -_date_int(rel),              # prefer the original over later reissues
                mbid,                         # deterministic: every track must land here
            )

        winner = max(votes, key=score)
        matched_hint = bool(hint_key) and score(winner)[0] == 1
        # Agreement means more than one file naming the same release. Without that
        # floor a two-file group would let either file's own release win outright —
        # the per-file guess this exists to prevent.
        if not matched_hint and (
            votes[winner] / total < min_coverage or votes[winner] < min(2, total)
        ):
            return None

        # One file agrees with nobody. It may only claim an album when all of its
        # own candidates name the same one anyway — otherwise this is the coin-flip
        # that scatters albums, just with a smaller sample.
        if total == 1 and not matched_hint:
            if len({norm_album(info[m].get("title", "")) for m in votes}) > 1:
                return None

    return {
        **info[winner],
        "coverage": votes[winner] / len(populated),
        "matched_hint": matched_hint,
    }


def track_number(candidates: list[dict], release_mbid: str) -> str:
    """This file's position on the chosen release, as a tag-ready string."""
    for c in candidates or []:
        if c.get("id") == release_mbid and c.get("track_number"):
            return str(c["track_number"])
    return ""


def disc_number(candidates: list[dict], release_mbid: str) -> str:
    """Which disc of the chosen release. Without it, track 10 of disc 1 and track 10
    of disc 2 collide into one position."""
    for c in candidates or []:
        if c.get("id") == release_mbid and (c.get("medium") or 0) > 1:
            return str(c["medium"])
    return ""


def identity_from_release(release: dict, fallback_artist: str = "") -> dict:
    """Turn a chosen release into the tag fields every track in it must share."""
    artist = (release.get("artist") or "").strip()
    is_comp = norm_album(artist) == "various artists" or release.get("is_compilation")
    if is_comp:
        albumartist = VARIOUS_ARTISTS
    else:
        albumartist = artist or fallback_artist

    identity = {
        "album": release.get("title", ""),
        "albumartist": albumartist,
        "release_mbid": release.get("id", ""),
        "release_group_mbid": release.get("release_group_id", ""),
        "compilation": "1" if is_comp else "",
    }
    if release.get("year"):
        identity["year"] = str(release["year"])
    return {k: v for k, v in identity.items() if v}


async def resolve_release(artist: str, album: str) -> dict | None:
    """Look up a release by name when there's nothing to fingerprint yet.

    Cached and locked per (artist, album) so a burst of concurrent downloads from
    one album resolves it exactly once — and therefore identically.
    """
    from services.discovery import mb_search_release

    artist, album = (artist or "").strip(), (album or "").strip()
    if is_placeholder(album):
        return None

    key = f"release:{norm_album(artist)}:{norm_album(album)}"
    cached = cache.json_get(key, _RESOLVE_TTL)
    if cached is not None:
        return cached or None

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = cache.json_get(key, _RESOLVE_TTL)
        if cached is not None:
            return cached or None
        try:
            release = await mb_search_release(artist, album)
        except Exception:
            return None
        cache.json_set(key, release or {})
        return release or None
