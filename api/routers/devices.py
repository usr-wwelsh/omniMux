import asyncio
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from routers.auth import get_current_user, UserContext

logger = logging.getLogger(__name__)

router = APIRouter()

QUEUE_PERSIST_PATH = os.environ.get("OMNIMUX_QUEUE_PATH", "/tmp/omnimux_queue.json")

# In-memory sessions: {username: {device_id: session_dict}}
_sessions: dict[str, dict[str, dict]] = {}
SESSION_TTL_SECONDS = 90          # hard removal cutoff
SESSION_RECONNECTING_AFTER = 60   # show "reconnecting" state after this many seconds
_sessions_lock = asyncio.Lock()

# Server-side shared queue: {username: {tracks, index, active_device_id, queue_version}}
_queues: dict[str, dict] = {}
_queues_lock = asyncio.Lock()


def _load_queue_from_disk() -> None:
    """Read persisted queue state from disk on startup."""
    try:
        with open(QUEUE_PERSIST_PATH, "r") as f:
            data = json.load(f)
        _queues.update(data)
        logger.info(f"[omniMux] Loaded queue state from {QUEUE_PERSIST_PATH}")
    except FileNotFoundError:
        pass  # first run — nothing to load
    except Exception as e:
        logger.warning(f"[omniMux] Could not load queue state: {e}")


async def _persist_queues() -> None:
    """Write current queue state to disk (must be called inside _queues_lock)."""
    try:
        with open(QUEUE_PERSIST_PATH, "w") as f:
            json.dump(_queues, f)
    except Exception as e:
        logger.warning(f"[omniMux] Could not persist queue state: {e}")


_load_queue_from_disk()


class TrackInfo(BaseModel):
    id: str
    title: str
    artist: str
    album: str
    cover_url: str | None = None
    duration: float = 0


class DeviceHeartbeat(BaseModel):
    device_id: str
    device_name: str
    track: TrackInfo | None = None
    is_playing: bool = False
    current_time: float = 0


class DeviceSession(BaseModel):
    device_id: str
    device_name: str
    track: TrackInfo | None = None
    is_playing: bool = False
    current_time: float = 0
    updated_at: str = ''
    is_reconnecting: bool = False


@router.put("/devices/heartbeat")
async def heartbeat(
    body: DeviceHeartbeat,
    user: UserContext = Depends(get_current_user),
):
    async with _sessions_lock:
        if user.username not in _sessions:
            _sessions[user.username] = {}
        _sessions[user.username][body.device_id] = {
            "device_id": body.device_id,
            "device_name": body.device_name,
            "track": body.track.model_dump() if body.track else None,
            "is_playing": body.is_playing,
            "current_time": body.current_time,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    return {"ok": True}


class QueueTrack(BaseModel):
    id: str
    title: str
    artist: str
    artistId: str = ''
    album: str
    albumId: str = ''
    coverArt: str | None = None
    duration: float = 0
    streamUrl: str | None = None
    coverUrl: str | None = None


class QueueState(BaseModel):
    tracks: list[QueueTrack] = []
    index: int = -1
    active_device_id: str | None = None
    seek_to: float | None = None
    seek_issued_at: float | None = None
    queue_version: int = 0


class QueueSetRequest(BaseModel):
    tracks: list[QueueTrack]
    index: int
    active_device_id: str
    seek_to: float | None = None
    seek_issued_at: float | None = None
    queue_version: int | None = None


@router.get("/queue", response_model=QueueState)
async def get_queue(user: UserContext = Depends(get_current_user)):
    async with _queues_lock:
        q = dict(_queues.get(user.username, {}))
    return QueueState(
        tracks=[QueueTrack(**t) for t in q.get('tracks', [])],
        index=q.get('index', -1),
        active_device_id=q.get('active_device_id'),
        seek_to=q.get('seek_to'),
        seek_issued_at=q.get('seek_issued_at'),
        queue_version=q.get('queue_version', 0),
    )


@router.put("/queue")
async def set_queue(body: QueueSetRequest, user: UserContext = Depends(get_current_user)):
    async with _queues_lock:
        existing = _queues.get(user.username, {})
        current_version = existing.get('queue_version', 0)

        # Reject stale writes — only when client sends a version
        if body.queue_version is not None and body.queue_version != current_version:
            raise HTTPException(
                status_code=409,
                detail={"queue_version": current_version}
            )

        new_version = current_version + 1
        _queues[user.username] = {
            'tracks': [t.model_dump() for t in body.tracks],
            'index': body.index,
            'active_device_id': body.active_device_id,
            # Only update seek fields if the new request includes them
            'seek_to': body.seek_to if body.seek_to is not None else existing.get('seek_to'),
            'seek_issued_at': body.seek_issued_at if body.seek_issued_at is not None else existing.get('seek_issued_at'),
            'queue_version': new_version,
        }
        await _persist_queues()

    return {"ok": True, "queue_version": new_version}


@router.get("/devices", response_model=list[DeviceSession])
async def list_devices(
    user: UserContext = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)
    reconnecting_after = now - timedelta(seconds=SESSION_RECONNECTING_AFTER)

    async with _sessions_lock:
        user_sessions = dict(_sessions.get(user.username, {}))

    result = []
    for session in user_sessions.values():
        updated_at = datetime.fromisoformat(session["updated_at"])
        if updated_at <= cutoff:
            continue  # truly gone
        is_reconnecting = updated_at <= reconnecting_after
        result.append(DeviceSession(
            device_id=session["device_id"],
            device_name=session["device_name"],
            track=TrackInfo(**session["track"]) if session["track"] else None,
            is_playing=session["is_playing"],
            current_time=session["current_time"],
            updated_at=session["updated_at"],
            is_reconnecting=is_reconnecting,
        ))
    return result
