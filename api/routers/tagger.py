import asyncio
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import TrackFlags, TagSnapshot
from routers.auth import get_current_user, require_non_guest, UserContext
from services.discovery import fingerprint_lookup, lastfm_album_tracks
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
        else:
            session.add(TagSnapshot(
                file_path=fp,
                title=tags.get("title", ""),
                artist=tags.get("artist", ""),
                albumartist=tags.get("albumartist", ""),
                album=tags.get("album", ""),
                genre=tags.get("genre", ""),
                year=tags.get("year", ""),
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
    await _save_snapshot(session, body.file_paths)
    sem = asyncio.Semaphore(3)
    results = {"retagged": 0, "skipped": 0, "errors": []}

    async def process_one(fp: str) -> None:
        async with sem:
            try:
                existing = tagger.read_tags_for_path(fp)
                tags: dict[str, str] = {}
                has_albumartist = bool(existing and existing.get("albumartist"))

                # Only derive albumartist if not already tagged
                if not has_albumartist and existing and existing.get("artist"):
                    tags["albumartist"] = _primary_artist(existing["artist"])

                # AcousticID for better title/artist/album
                meta = await fingerprint_lookup(fp)
                if meta:
                    for k in ("title", "artist", "album"):
                        if meta.get(k):
                            tags[k] = meta[k]
                    if not has_albumartist and meta.get("artist"):
                        tags["albumartist"] = _primary_artist(meta["artist"])

                if not tags:
                    results["skipped"] += 1
                    return
                updated, errs = tagger.write_tags([fp], tags)
                results["retagged"] += updated
                results["errors"].extend(errs)
            except Exception as e:
                results["errors"].append(f"{Path(fp).name}: {e}")

    await asyncio.gather(*[process_one(fp) for fp in body.file_paths])
    try:
        await trigger_scan(user.username, user.password)
    except Exception:
        pass
    return results


@router.post("/tagger/tags")
async def write_tags(
    body: TagWriteRequest,
    user: UserContext = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    await _save_snapshot(session, body.file_paths)
    updated, errors = tagger.write_tags(body.file_paths, body.tags)
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
        }.items() if v}
        updated, errs = tagger.write_tags([fp], tags)
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

    updated, errors = tagger.write_tags(to_merge, {
        "album": body.target_album,
        "albumartist": body.target_albumartist,
    })
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
        meta = await fingerprint_lookup(local_file)
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
