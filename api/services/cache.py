import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}  # key -> (expires_at, value)


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
    _store[key] = (now + ttl, value)
