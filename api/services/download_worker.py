import asyncio
import os
import re
from pathlib import Path

import yt_dlp
from sqlalchemy import select

from db.database import async_session
from db.models import Download, TrackMapping
from services.discovery import fingerprint_lookup
from services.metadata import tag_file
from services.navidrome import trigger_scan, search_song, get_or_create_playlist, add_song_to_playlist

MUSIC_DIR = os.environ.get("MUSIC_DIR", "./music")
MAX_CONCURRENT = 3

_semaphore = asyncio.Semaphore(MAX_CONCURRENT)
_in_progress: set[str] = set()
_mood_semaphore = asyncio.Semaphore(1)  # one mood analysis at a time


def _sanitize(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    return name.strip().rstrip(".")[:200]


async def _update_download(download_id: int, **kwargs) -> None:
    async with async_session() as session:
        dl = await session.get(Download, download_id)
        if dl:
            for k, v in kwargs.items():
                setattr(dl, k, v)
            await session.commit()


async def process_download(download_id: int, username: str, password: str) -> None:
    async with _semaphore:
        async with async_session() as session:
            dl = await session.get(Download, download_id)
            if not dl:
                return

            youtube_id = dl.youtube_id
            if youtube_id in _in_progress:
                await _update_download(download_id, status="failed", error="Already downloading")
                return
            _in_progress.add(youtube_id)

        # Re-check status after waiting for the semaphore — may have been cancelled
        async with async_session() as session:
            dl = await session.get(Download, download_id)
            if not dl or dl.status == "cancelled":
                _in_progress.discard(youtube_id)
                return

        try:
            await _do_download(download_id, username, password)
        finally:
            _in_progress.discard(youtube_id)


async def _do_download(download_id: int, username: str, password: str) -> None:
    async with async_session() as session:
        dl = await session.get(Download, download_id)
        if not dl:
            return
        youtube_url = dl.youtube_url
        title = dl.title
        artist = dl.artist
        youtube_id = dl.youtube_id
        playlist_name = dl.playlist_name
        target_album = dl.target_album

    artist_dir = Path(MUSIC_DIR) / _sanitize(artist)
    artist_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(artist_dir / f"{_sanitize(title)}.%(ext)s")

    # Step 1: Download
    await _update_download(download_id, status="downloading", progress=0)

    progress_state = {"percent": 0}

    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            if total > 0:
                progress_state["percent"] = int(downloaded / total * 80)  # 80% for download

    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "opus",
            "preferredquality": "128",
        }],
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress_hook],
    }

    try:
        info = await asyncio.to_thread(_yt_download, youtube_url, ydl_opts)
    except Exception as e:
        await _update_download(download_id, status="failed", error=str(e))
        return

    # Find the output file
    file_path = _find_output_file(artist_dir, _sanitize(title))
    if not file_path:
        await _update_download(download_id, status="failed", error="Output file not found after download")
        return

    await _update_download(download_id, progress=80, file_path=str(file_path))

    # Check for cancellation before the slow mood analysis step
    async with async_session() as session:
        dl = await session.get(Download, download_id)
        if dl and dl.status == "cancelled":
            file_path.unlink(missing_ok=True)
            return

    # Step 2: Mood analysis
    await _update_download(download_id, status="analyzing", progress=85)
    mood_result = await _analyze_mood(str(file_path))

    # Step 3: AcousticID metadata enrichment — override sloppy YT metadata if confident match
    try:
        acoustid_meta = await fingerprint_lookup(str(file_path))
        if acoustid_meta:
            if acoustid_meta.get("title"):
                info["title"] = acoustid_meta["title"]
            if acoustid_meta.get("artist"):
                info["artist"] = acoustid_meta["artist"]
            if acoustid_meta.get("album") and not target_album:
                info["album"] = acoustid_meta["album"]
    except Exception:
        pass

    # Step 4: Tag
    await _update_download(download_id, status="tagging", progress=90)
    try:
        # When downloading an album, use the initiating artist as albumartist so all
        # tracks group together in Navidrome regardless of per-track featured artists.
        album_artist = artist if target_album else None
        await tag_file(str(file_path), info, mood_result, target_album=target_album, album_artist=album_artist)
    except Exception as e:
        await _update_download(download_id, status="failed", error=f"Tagging failed: {e}")
        return

    # Step 4: Trigger Navidrome scan
    await _update_download(download_id, status="scanning", progress=95)
    try:
        await trigger_scan(username, password)
    except Exception:
        pass  # non-fatal

    # Step 5: Save mapping and mark complete
    mood_str = mood_result.get("mood", "") if mood_result else None
    bpm_val = mood_result.get("tempo") if mood_result else None
    energy_val = mood_result.get("energy") if mood_result else None
    key_val = mood_result.get("key") if mood_result else None
    genre_val = info.get("genre", mood_str) or None

    async with async_session() as session:
        existing = await session.execute(
            select(TrackMapping).where(TrackMapping.youtube_id == info.get("id", ""))
        )
        if not existing.scalar_one_or_none():
            session.add(TrackMapping(
                youtube_id=info.get("id", ""),
                file_path=str(file_path),
                title=info.get("title", "Unknown"),
                artist=info.get("artist", info.get("channel", "Unknown")),
            ))
            await session.commit()

    await _update_download(
        download_id,
        status="completed",
        progress=100,
        file_path=str(file_path),
        mood=mood_str,
        bpm=bpm_val,
        energy=energy_val,
        key=key_val,
        genre=genre_val,
    )

    if playlist_name:
        tagged_title = info.get("title", title)
        tagged_artist = info.get("artist", info.get("channel", artist))
        await _add_to_navidrome_playlist(tagged_title, tagged_artist, playlist_name, username, password)


def _yt_download(url: str, opts: dict) -> dict:
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=True)


def _find_output_file(directory: Path, title: str) -> Path | None:
    for ext in [".opus", ".ogg", ".mp3", ".m4a", ".webm"]:
        candidate = directory / f"{title}{ext}"
        if candidate.exists():
            return candidate
    # Fallback: find most recently created file
    files = sorted(directory.iterdir(), key=lambda f: f.stat().st_mtime, reverse=True)
    return files[0] if files else None


async def _add_to_navidrome_playlist(title: str, artist: str, playlist_name: str, username: str, password: str) -> None:
    # Retry finding the song — scan may take a moment to index
    song_id = None
    for _ in range(6):
        await asyncio.sleep(5)
        try:
            song_id = await search_song(title, artist, username, password)
        except Exception:
            pass
        if song_id:
            break
    if not song_id:
        return
    try:
        playlist_id = await get_or_create_playlist(playlist_name, username, password)
        if playlist_id:
            await add_song_to_playlist(playlist_id, song_id, username, password)
    except Exception:
        pass


async def _analyze_mood(file_path: str) -> dict | None:
    async with _mood_semaphore:
        import json
        import sys
        import tempfile

        analyze_path = file_path
        tmp_path = None

        try:
            # mood_detector doesn't support opus; convert a 60s sample to flac
            if Path(file_path).suffix.lower() == ".opus":
                tmp = tempfile.NamedTemporaryFile(suffix=".flac", delete=False)
                tmp_path = tmp.name
                tmp.close()
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y",
                    "-t", "60",
                    "-i", file_path,
                    "-threads", "1",
                    tmp_path,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await proc.wait()
                analyze_path = tmp_path

            # Run in a subprocess so ML model memory is freed when it exits
            worker = Path(__file__).parent / "mood_worker.py"
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(worker), analyze_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode != 0 or not stdout:
                return None
            return json.loads(stdout)
        except Exception:
            return None
        finally:
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)
