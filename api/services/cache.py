import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}  # key -> (expires_at, value)
_MAX_ENTRIES = 300


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
