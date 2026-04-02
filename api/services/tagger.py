import os
from pathlib import Path

from mutagen import File as MutagenFile

MUSIC_DIR = os.environ.get("MUSIC_DIR", "./music")
AUDIO_EXTENSIONS = {".opus", ".ogg", ".mp3", ".flac", ".m4a", ".aac"}


def _read_tags(file_path: Path) -> dict | None:
    try:
        audio = MutagenFile(str(file_path), easy=True)
        if audio is None:
            return None
        return {
            "file_path": str(file_path),
            "title": (audio.get("title") or [""])[0],
            "artist": (audio.get("artist") or [""])[0],
            "album": (audio.get("album") or [""])[0],
            "genre": (audio.get("genre") or [""])[0],
            "year": (audio.get("date") or [""])[0][:4],
            "duration": int(audio.info.length) if audio.info else 0,
        }
    except Exception:
        return None


def list_tracks() -> list[dict]:
    tracks = []
    root = Path(MUSIC_DIR)
    for f in sorted(root.rglob("*")):
        if f.suffix.lower() in AUDIO_EXTENSIONS and f.is_file():
            track = _read_tags(f)
            if track:
                tracks.append(track)
    return tracks


def write_tags(file_paths: list[str], tags: dict) -> tuple[int, list[str]]:
    """Write non-empty tag fields to each file. Returns (updated_count, errors)."""
    updated = 0
    errors = []
    root = Path(MUSIC_DIR).resolve()

    for fp in file_paths:
        path = Path(fp).resolve()
        # Security: must be within MUSIC_DIR
        try:
            path.relative_to(root)
        except ValueError:
            errors.append(f"Path outside music dir: {fp}")
            continue

        if not path.exists():
            errors.append(f"File not found: {fp}")
            continue

        try:
            audio = MutagenFile(str(path), easy=True)
            if audio is None:
                errors.append(f"Could not open: {fp}")
                continue

            if tags.get("title"):
                audio["title"] = tags["title"]
            if tags.get("artist"):
                audio["artist"] = tags["artist"]
            if tags.get("album"):
                audio["album"] = tags["album"]
            if tags.get("genre"):
                audio["genre"] = tags["genre"]
            if tags.get("year"):
                audio["date"] = tags["year"]

            audio.save()
            updated += 1
        except Exception as e:
            errors.append(f"{path.name}: {e}")

    return updated, errors
