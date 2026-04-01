import io
from pathlib import Path

import httpx
from mutagen.oggopus import OggOpus
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, TBPM, TXXX, APIC, COMM
from mutagen.flac import Picture
import base64


async def _download_thumbnail(url: str) -> bytes | None:
    if not url:
        return None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=10)
            if resp.status_code == 200:
                return resp.content
    except Exception:
        pass
    return None


def _build_metadata(info: dict, mood_result: dict | None) -> dict:
    meta = {
        "title": info.get("title", "Unknown"),
        "artist": info.get("artist", info.get("channel", "Unknown")),
        "album": info.get("album", "YouTube"),
        "date": info.get("upload_date", "")[:4] if info.get("upload_date") else "",
        "genre": info.get("genre", ""),
        "youtube_id": info.get("id", ""),
    }

    if mood_result:
        meta["mood"] = mood_result.get("mood", "")
        meta["bpm"] = str(int(round(mood_result.get("tempo", 0))))
        meta["energy"] = str(round(mood_result.get("energy", 0), 2))
        meta["key"] = mood_result.get("key", "")
        if not meta["genre"] and mood_result.get("mood"):
            meta["genre"] = mood_result["mood"]

    return meta


async def tag_file(file_path: str, info: dict, mood_result: dict | None, target_album: str | None = None) -> None:
    meta = _build_metadata(info, mood_result)
    if target_album:
        meta["album"] = target_album
    thumbnail_url = info.get("thumbnail", "")
    cover_data = await _download_thumbnail(thumbnail_url)
    ext = Path(file_path).suffix.lower()

    if ext == ".opus" or ext == ".ogg":
        _tag_opus(file_path, meta, cover_data)
    elif ext == ".mp3":
        _tag_mp3(file_path, meta, cover_data)


def _tag_opus(file_path: str, meta: dict, cover_data: bytes | None) -> None:
    audio = OggOpus(file_path)
    audio["title"] = meta["title"]
    audio["artist"] = meta["artist"]
    audio["album"] = meta["album"]
    if meta["date"]:
        audio["date"] = meta["date"]
    if meta["genre"]:
        audio["genre"] = meta["genre"]
    if meta.get("mood"):
        audio["mood"] = meta["mood"]
    if meta.get("bpm"):
        audio["bpm"] = meta["bpm"]
    if meta.get("energy"):
        audio["energy"] = meta["energy"]
    if meta.get("key"):
        audio["key"] = meta["key"]
    audio["youtube_id"] = meta["youtube_id"]

    if cover_data:
        pic = Picture()
        pic.data = cover_data
        pic.type = 3  # front cover
        pic.mime = "image/jpeg"
        audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]

    audio.save()


def _tag_mp3(file_path: str, meta: dict, cover_data: bytes | None) -> None:
    try:
        audio = MP3(file_path, ID3=ID3)
        if audio.tags is None:
            audio.add_tags()
    except Exception:
        audio = MP3(file_path)
        audio.add_tags()

    tags = audio.tags
    tags.add(TIT2(encoding=3, text=meta["title"]))
    tags.add(TPE1(encoding=3, text=meta["artist"]))
    tags.add(TALB(encoding=3, text=meta["album"]))
    if meta["date"]:
        tags.add(TDRC(encoding=3, text=meta["date"]))
    if meta["genre"]:
        tags.add(TCON(encoding=3, text=meta["genre"]))
    if meta.get("bpm"):
        tags.add(TBPM(encoding=3, text=meta["bpm"]))
    if meta.get("mood"):
        tags.add(TXXX(encoding=3, desc="MOOD", text=meta["mood"]))
    if meta.get("energy"):
        tags.add(TXXX(encoding=3, desc="ENERGY", text=meta["energy"]))
    if meta.get("key"):
        tags.add(TXXX(encoding=3, desc="KEY", text=meta["key"]))
    tags.add(TXXX(encoding=3, desc="YOUTUBE_ID", text=meta["youtube_id"]))

    if cover_data:
        tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover_data))

    audio.save()
