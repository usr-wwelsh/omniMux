import asyncio
import os
from collections import defaultdict
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import TrackFlags, TagSnapshot
from routers.auth import get_current_user, require_non_guest, UserContext
from services import albums
from services.discovery import fingerprint_lookup, lastfm_album_tracks, lookup_genre
from services.metadata import _primary_artist
from services.navidrome import trigger_scan
from services import tagger
from services.tagger import MUSIC_DIR

router = APIRouter()


async def _save_snapshot(session: AsyncSession, file_paths: list[str]) -> None:
    for fp in file_paths:
        tags = tagger.read_tags_for_path(fp)
        if not tags:
            continue
        existing = await session.get(TagSnapshot, fp)
        if existing:
            existing.title = tags.get("title", "")
            existing.artist = tags.get("artist", "")
            existing.albumartist = tags.get("albumartist", "")
            existing.album = tags.get("album", "")
            existing.genre = tags.get("genre", "")
            existing.year = tags.get("year", "")
            existing.release_mbid = tags.get("release_mbid", "")
        else:
            session.add(TagSnapshot(
                file_path=fp,
                title=tags.get("title", ""),
                artist=tags.get("artist", ""),
                albumartist=tags.get("albumartist", ""),
                album=tags.get("album", ""),
                genre=tags.get("genre", ""),
                year=tags.get("year", ""),
                release_mbid=tags.get("release_mbid", ""),
            ))
    await session.commit()


class TagWriteRequest(BaseModel):
    file_paths: list[str]
    tags: dict[str, str]


class DeleteRequest(BaseModel):
    file_paths: list[str]


class FlagRequest(BaseModel):
    file_paths: list[str]
    ignore_in_autodj: bool


@router.get("/tagger/tracks")
async def get_tracks(
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    limit: int = 200,
):
    tracks = await asyncio.to_thread(tagger.list_tracks, limit)

    # Fetch all ignore flags and index by (title_lower_stripped, artist_lower_stripped)
    result = await session.execute(select(TrackFlags))
    flags: dict[tuple[str, str], bool] = {
        (f.title.lower().strip(), f.artist.lower().strip()): f.ignore_in_autodj
        for f in result.scalars().all()
    }

    for track in tracks:
        key = (track["title"].lower().strip(), track["artist"].lower().strip())
        track["ignore_in_autodj"] = flags.get(key, False)

    return tracks


@router.post("/tagger/flags")
async def set_track_flags(
    body: FlagRequest,
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Set ignore_in_autodj flag for given file paths."""
    updated = 0
    errors = []

    for fp in body.file_paths:
        track = tagger.read_tags_for_path(fp)
        if not track:
            errors.append(f"Could not read tags: {fp}")
            continue

        title = track["title"].strip()
        artist = track["artist"].strip()
        if not title and not artist:
            errors.append(f"No title/artist in tags: {fp}")
            continue

        result = await session.execute(
            select(TrackFlags).where(
                TrackFlags.title == title,
                TrackFlags.artist == artist,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.ignore_in_autodj = body.ignore_in_autodj
        else:
            session.add(TrackFlags(title=title, artist=artist, ignore_in_autodj=body.ignore_in_autodj))
        updated += 1

    await session.commit()
    return {"updated": updated, "errors": errors}


@router.get("/tagger/ignored")
async def get_ignored_tracks(
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Return {title, artist} pairs for all tracks ignored in Auto DJ."""
    result = await session.execute(
        select(TrackFlags).where(TrackFlags.ignore_in_autodj == True)  # noqa: E712
    )
    return [{"title": f.title, "artist": f.artist} for f in result.scalars().all()]


class RetagRequest(BaseModel):
    file_paths: list[str]


@router.post("/tagger/retag")
async def retag_tracks(
    body: RetagRequest,
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Retag files, deciding the album once per album rather than once per file.

    A fingerprint identifies a *recording*, and a recording sits on every release it
    was ever licensed to. Asking each file separately is what used to split an album
    into five; here the files vote, and the whole group takes one answer.
    """
    await _save_snapshot(session, body.file_paths)
    results: dict = {"retagged": 0, "skipped": 0, "albums": 0, "errors": []}

    existing_tags: dict[str, dict] = {}
    for fp in body.file_paths:
        tags = tagger.read_tags_for_path(fp)
        if tags:
            existing_tags[fp] = tags

    # Fingerprint everything first — the album decision needs the whole batch.
    sem = asyncio.Semaphore(3)

    async def fingerprint(fp: str) -> tuple[str, dict | None]:
        async with sem:
            try:
                hint = existing_tags.get(fp, {})
                return fp, await fingerprint_lookup(
                    fp,
                    album_hint=hint.get("album", ""),
                    release_mbid=hint.get("release_mbid", ""),
                )
            except Exception as e:
                results["errors"].append(f"{Path(fp).name}: {e}")
                return fp, None

    prints = dict(await asyncio.gather(*[fingerprint(fp) for fp in body.file_paths]))

    identities = await _resolve_batch_albums(body.file_paths, existing_tags, prints)
    results["albums"] = len({i.get("release_mbid") or i.get("album") for i in identities.values() if i})

    async def apply(fp: str) -> None:
        async with sem:
            try:
                await _apply_one(fp, existing_tags.get(fp, {}), prints.get(fp) or {},
                                 identities.get(fp) or {}, results)
            except Exception as e:
                results["errors"].append(f"{Path(fp).name}: {e}")

    await asyncio.gather(*[apply(fp) for fp in body.file_paths])
    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return results


async def _apply_one(
    fp: str, existing: dict, meta: dict, identity: dict, results: dict
) -> None:
    """Write one file's share of the batch's decisions."""
    tags: dict[str, str] = {}

    for k in ("title", "artist"):
        if meta.get(k):
            tags[k] = meta[k]

    # Album fields come from the group, never from this file's own lookup.
    for k in ("album", "albumartist", "release_mbid", "release_group_mbid", "compilation"):
        if identity.get(k):
            tags[k] = identity[k]
    if identity.get("year") and not existing.get("year"):
        tags["year"] = identity["year"]

    if not tags.get("albumartist") and not existing.get("albumartist"):
        source = tags.get("artist") or existing.get("artist", "")
        if source:
            tags["albumartist"] = _primary_artist(source)

    if identity.get("release_mbid"):
        candidates = meta.get("releases") or []
        num = albums.track_number(candidates, identity["release_mbid"])
        if num:
            tags["tracknumber"] = num
        disc = albums.disc_number(candidates, identity["release_mbid"])
        if disc:
            tags["discnumber"] = disc

    # Replace the mood label that older downloads wrote into genre
    # with a real MusicBrainz genre. Snapshots above make this undoable.
    genre = await lookup_genre(
        tags.get("artist") or existing.get("artist", ""),
        tags.get("album") or existing.get("album", ""),
    )
    if genre:
        tags["genre"] = genre

    if not tags:
        results["skipped"] += 1
        return

    # Moving a file to an album we have no release ID for means any ID still on it
    # is from the album it just left, and Navidrome would honour that over the name.
    clear = ["release_mbid", "release_group_mbid"] if tags.get("album") and not tags.get("release_mbid") else []
    updated, errs = tagger.write_tags([fp], tags, clear=clear)
    results["retagged"] += updated
    results["errors"].extend(errs)


async def _resolve_batch_albums(
    file_paths: list[str],
    existing_tags: dict[str, dict],
    prints: dict[str, dict | None],
) -> dict[str, dict]:
    """Map each file to the album identity its group agreed on.

    Two passes. First: if most of the batch shares one release, the user selected an
    album — including one previously scattered under several names, which is exactly
    the case merge-albums existed to clean up by hand. Otherwise: group by the album
    the files currently claim and resolve each group on its own.
    """
    def candidates(fp: str) -> list[dict]:
        return (prints.get(fp) or {}).get("releases") or []

    groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    for fp in file_paths:
        tags = existing_tags.get(fp, {})
        album = tags.get("album", "")
        # "YouTube" is not an album — those files have no group to belong to and are
        # resolved one at a time, on their own unambiguous evidence.
        key = (fp, "") if albums.is_placeholder(album) else (
            albums.norm_album(album),
            albums.norm_album(tags.get("albumartist") or tags.get("artist", "")),
        )
        groups[key].append(fp)

    identities: dict[str, dict] = {}

    # Repair pass. Many tiny groups is the signature of one album that got split;
    # a batch already sitting in album-sized groups is a discography, and folding
    # that onto its best-selling compilation would be the same bug in reverse.
    scattered = len(groups) >= 3 and len(file_paths) / len(groups) <= 3
    if len(file_paths) >= 3 and scattered:
        whole_batch = albums.choose_release(
            [candidates(fp) for fp in file_paths], min_coverage=0.7
        )
        if whole_batch:
            identity = albums.identity_from_release(whole_batch)
            for fp in file_paths:
                if any(c.get("id") == whole_batch["id"] for c in candidates(fp)):
                    identities[fp] = identity
            if len(identities) == len(file_paths):
                return identities
            groups = defaultdict(
                list, {k: [fp for fp in v if fp not in identities] for k, v in groups.items()}
            )

    for members in groups.values():
        if not members:
            continue
        tags = existing_tags.get(members[0], {})
        hint_album = tags.get("album", "")
        album_key = "" if albums.is_placeholder(hint_album) else albums.norm_album(hint_album)
        hint_mbid = next(
            (existing_tags.get(fp, {}).get("release_mbid", "") for fp in members
             if existing_tags.get(fp, {}).get("release_mbid")),
            "",
        )

        # A lone file has no one to agree with, so it may only take an album the
        # hint confirms; a placeholder album ("YouTube") has nothing to preserve.
        min_coverage = 0.5 if len(members) > 1 else 1.0
        chosen = albums.choose_release(
            [candidates(fp) for fp in members],
            hint_album=hint_album,
            hint_release_mbid=hint_mbid,
            min_coverage=min_coverage,
        )
        if not chosen:
            continue
        if len(members) == 1 and not chosen.get("matched_hint") and not albums.is_placeholder(hint_album):
            continue

        fallback = tags.get("albumartist") or tags.get("artist", "")
        identity = albums.identity_from_release(chosen, fallback)
        # Keep the name the library already uses when it's the same album under a
        # different edition suffix — renaming for cosmetics only churns the library.
        if album_key and albums.norm_album(identity.get("album", "")) == album_key:
            identity["album"] = hint_album
        for fp in members:
            identities[fp] = identity

    return identities


@router.post("/tagger/tags")
async def write_tags(
    body: TagWriteRequest,
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    await _save_snapshot(session, body.file_paths)
    new_album = body.tags.get("album", "")

    updated, errors = 0, []
    for fp in body.file_paths:
        # A hand-edited album name must win over the MusicBrainz album ID already on
        # the file, or Navidrome keeps grouping by the ID and the rename looks lost.
        current = tagger.read_tags_for_path(fp) or {}
        clear = (
            ["release_mbid", "release_group_mbid"]
            if new_album and albums.norm_album(new_album) != albums.norm_album(current.get("album", ""))
            else []
        )
        u, errs = tagger.write_tags([fp], body.tags, clear=clear)
        updated += u
        errors.extend(errs)

    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return {"updated": updated, "errors": errors}


class RestoreRequest(BaseModel):
    file_paths: list[str]


@router.post("/tagger/restore")
async def restore_tags(
    body: RestoreRequest,
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    restored = 0
    skipped = 0
    errors: list[str] = []

    for fp in body.file_paths:
        snap = await session.get(TagSnapshot, fp)
        if not snap:
            skipped += 1
            continue
        tags = {k: v for k, v in {
            "title": snap.title,
            "artist": snap.artist,
            "albumartist": snap.albumartist,
            "album": snap.album,
            "genre": snap.genre,
            "year": snap.year,
            "release_mbid": snap.release_mbid,
        }.items() if v}
        # A MusicBrainz album ID added since the snapshot outranks the restored
        # album name, so putting the name back means taking that ID away too.
        clear = [] if snap.release_mbid else ["release_mbid", "release_group_mbid"]
        updated, errs = tagger.write_tags([fp], tags, clear=clear)
        restored += updated
        errors.extend(errs)

    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return {"restored": restored, "skipped": skipped, "errors": errors}


class SourceAlbum(BaseModel):
    album: str
    artist: str


class MergeAlbumsRequest(BaseModel):
    target_album: str
    target_albumartist: str
    source_albums: list[SourceAlbum]


@router.post("/tagger/merge-albums")
async def merge_albums(
    body: MergeAlbumsRequest,
    user: UserContext = Depends(get_current_user),
):
    all_tracks = await asyncio.to_thread(tagger.list_tracks)
    source_keys: set[tuple[str, str]] = set()
    for s in body.source_albums:
        source_keys.add((s.album.lower().strip(), s.artist.lower().strip()))

    to_merge = []
    for t in all_tracks:
        alb = t["album"].lower().strip()
        aa = t["albumartist"].lower().strip()
        ar = t["artist"].lower().strip()
        if (alb, aa) in source_keys or (alb, ar) in source_keys:
            to_merge.append(t["file_path"])

    if not to_merge:
        return {"merged": 0, "errors": ["No matching tracks found"]}

    # Sources can carry different MusicBrainz album IDs, and Navidrome groups on
    # those before the name — leaving them would keep the albums apart anyway.
    updated, errors = tagger.write_tags(
        to_merge,
        {"album": body.target_album, "albumartist": body.target_albumartist},
        clear=["release_mbid", "release_group_mbid"],
    )
    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return {"merged": updated, "errors": errors}


class ReorderTrack(BaseModel):
    title: str
    track_number: int


class ReorderAlbumRequest(BaseModel):
    album: str
    albumartist: str
    tracks: list[ReorderTrack]


_MB_HEADERS = {"User-Agent": "omniMux/0.1 (omnimux.wwel.sh)"}


async def _mb_release_tracks(release_mbid: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://musicbrainz.org/ws/2/release/{release_mbid}",
                params={"inc": "recordings", "fmt": "json"},
                headers=_MB_HEADERS,
            )
        release = resp.json()
        tracks = []
        for medium in release.get("media", []):
            offset = medium.get("position", 1) - 1
            for t in medium.get("tracks", []):
                pos = t.get("position", 0) + offset * 1000
                tracks.append({"title": t.get("title", ""), "rank": pos})
        return tracks
    except Exception:
        return []


@router.get("/tagger/album-track-order")
async def album_track_order(
    artist: str,
    album: str,
    user: UserContext = Depends(require_non_guest),
):
    # Find a local file for this album to fingerprint
    all_tracks = await asyncio.to_thread(tagger.list_tracks)
    album_lower = album.lower().strip()
    artist_lower = artist.lower().strip()
    local_file = next((
        t["file_path"] for t in all_tracks
        if t.get("album", "").lower().strip() == album_lower
        and (
            t.get("albumartist", "").lower().strip() == artist_lower
            or t.get("artist", "").lower().strip() == artist_lower
        )
    ), None)

    if local_file:
        meta = await fingerprint_lookup(local_file, album_hint=album)
        if meta and meta.get("release_mbid"):
            tracks = await _mb_release_tracks(meta["release_mbid"])
            if tracks:
                return tracks

    # Fall back to Last.fm text search
    return await lastfm_album_tracks(artist, album)


@router.post("/tagger/reorder-album")
async def reorder_album(
    body: ReorderAlbumRequest,
    user: UserContext = Depends(require_non_guest),
    session: AsyncSession = Depends(get_db),
):
    all_tracks = await asyncio.to_thread(tagger.list_tracks)
    album_lower = body.album.lower().strip()
    albumartist_lower = body.albumartist.lower().strip()

    # Index local tracks by title for this album
    album_files: dict[str, str] = {}
    for t in all_tracks:
        t_album = t.get("album", "").lower().strip()
        t_aa = t.get("albumartist", "").lower().strip()
        t_ar = t.get("artist", "").lower().strip()
        if t_album == album_lower and (t_aa == albumartist_lower or t_ar == albumartist_lower):
            album_files[t["title"].lower().strip()] = t["file_path"]

    if not album_files:
        return {"updated": 0, "errors": [f"No local tracks found for album '{body.album}'"]}

    file_map: dict[str, str] = {}
    unmatched: list[str] = []
    for item in body.tracks:
        fp = album_files.get(item.title.lower().strip())
        if fp:
            file_map[fp] = str(item.track_number)
        else:
            unmatched.append(item.title)

    if not file_map:
        return {"updated": 0, "errors": ["No tracks matched"]}

    await _save_snapshot(session, list(file_map.keys()))
    updated = 0
    errors: list[str] = []
    for fp, num in file_map.items():
        u, e = tagger.write_tags([fp], {"tracknumber": num})
        updated += u
        errors.extend(e)
    if unmatched:
        errors.append(f"Unmatched: {', '.join(unmatched)}")

    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return {"updated": updated, "errors": errors}


@router.post("/tagger/delete")
async def delete_tracks(
    body: DeleteRequest,
    user: UserContext = Depends(get_current_user),
):
    deleted, errors = tagger.delete_tracks(body.file_paths)
    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return {"deleted": deleted, "errors": errors}
