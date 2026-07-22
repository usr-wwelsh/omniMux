import hashlib
import os
import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}  # key -> (expires_at, value)
_MAX_ENTRIES = 300

_DISK_DIR = os.path.join(os.environ.get("DATA_DIR", "./data"), "thumb_cache")
_DISK_MAX_ENTRIES = 500


def get(key: str, ttl: int) -> Any | None:
    entry = _store.get(key)
    if entry and time.time() < entry[0]:
        return entry[1]
    return None


def set(key: str, value: Any, ttl: int) -> None:
    now = time.time()
    expired = [k for k, (exp, _) in _store.items() if now >= exp]
    for k in expired:
        del _store[k]
    if len(_store) >= _MAX_ENTRIES and key not in _store:
        # Evict the soonest-to-expire entry
        oldest = min(_store, key=lambda k: _store[k][0])
        del _store[oldest]
    _store[key] = (now + ttl, value)


def _disk_path(key: str) -> str:
    return os.path.join(_DISK_DIR, hashlib.sha256(key.encode()).hexdigest())


def disk_get(key: str, ttl: int) -> tuple[bytes, str] | None:
    """Byte-blob cache backed by files under DATA_DIR, so large payloads
    (e.g. thumbnails) don't sit permanently in the process's resident memory."""
    path = _disk_path(key)
    try:
        stat = os.stat(path)
    except FileNotFoundError:
        return None
    if time.time() - stat.st_mtime > ttl:
        return None
    with open(path, "rb") as f:
        ct_len = int.from_bytes(f.read(2), "big")
        content_type = f.read(ct_len).decode()
        data = f.read()
    return data, content_type


def disk_set(key: str, data: bytes, content_type: str) -> None:
    os.makedirs(_DISK_DIR, exist_ok=True)
    _disk_evict_if_needed()
    ct_bytes = content_type.encode()
    with open(_disk_path(key), "wb") as f:
        f.write(len(ct_bytes).to_bytes(2, "big"))
        f.write(ct_bytes)
        f.write(data)


def _disk_evict_if_needed() -> None:
    try:
        entries = [os.path.join(_DISK_DIR, e) for e in os.listdir(_DISK_DIR)]
    except FileNotFoundError:
        return
    if len(entries) < _DISK_MAX_ENTRIES:
        return
    entries.sort(key=lambda p: os.stat(p).st_mtime)
    for p in entries[: len(entries) - _DISK_MAX_ENTRIES + 1]:
        try:
            os.remove(p)
        except FileNotFoundError:
            pass
