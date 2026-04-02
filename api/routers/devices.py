from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from routers.auth import get_current_user, UserContext

router = APIRouter()

# In-memory sessions: {username: {device_id: session_dict}}
_sessions: dict[str, dict[str, dict]] = {}
SESSION_TTL_SECONDS = 60

# Server-side shared queue: {username: {tracks, index, active_device_id}}
_queues: dict[str, dict] = {}


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


@router.put("/devices/heartbeat")
async def heartbeat(
    body: DeviceHeartbeat,
    user: UserContext = Depends(get_current_user),
):
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


class QueueSetRequest(BaseModel):
    tracks: list[QueueTrack]
    index: int
    active_device_id: str


@router.get("/queue", response_model=QueueState)
async def get_queue(user: UserContext = Depends(get_current_user)):
    q = _queues.get(user.username, {})
    return QueueState(
        tracks=[QueueTrack(**t) for t in q.get('tracks', [])],
        index=q.get('index', -1),
        active_device_id=q.get('active_device_id'),
    )


@router.put("/queue")
async def set_queue(body: QueueSetRequest, user: UserContext = Depends(get_current_user)):
    _queues[user.username] = {
        'tracks': [t.model_dump() for t in body.tracks],
        'index': body.index,
        'active_device_id': body.active_device_id,
    }
    return {"ok": True}


@router.get("/devices", response_model=list[DeviceSession])
async def list_devices(
    user: UserContext = Depends(get_current_user),
):
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=SESSION_TTL_SECONDS)
    user_sessions = _sessions.get(user.username, {})
    result = []
    for session in user_sessions.values():
        updated_at = datetime.fromisoformat(session["updated_at"])
        if updated_at > cutoff:
            result.append(DeviceSession(
                device_id=session["device_id"],
                device_name=session["device_name"],
                track=TrackInfo(**session["track"]) if session["track"] else None,
                is_playing=session["is_playing"],
                current_time=session["current_time"],
            ))
    return result
