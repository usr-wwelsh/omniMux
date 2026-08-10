import asyncio
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from routers.auth import UserContext, get_user_flexible
from services.navidrome import SUBSONIC_AUTH_KEYS, subsonic_auth_params

NAVIDROME_URL = os.environ.get("NAVIDROME_URL", "http://localhost:4533")

router = APIRouter()

# Navidrome meters its own artwork work and answers the overflow with 429 rather
# than queueing it. A library page asks for every album's cover at once, so
# without metering here a large library turns most of its own cards into broken
# images. Requests wait for a slot instead, and a rejection that slips through
# anyway is retried rather than handed to the browser.
_COVER_CONCURRENCY = int(os.environ.get("COVER_MAX_CONCURRENCY", "4"))
_COVER_RETRY_DELAYS = (0.2, 0.6, 1.2)
_COVER_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})

_cover_slots = asyncio.Semaphore(_COVER_CONCURRENCY)

# One pooled client for cover art: a client per request means a fresh connection
# per cover, which is its own source of exhaustion under the same burst.
_cover_client: httpx.AsyncClient | None = None


def _shared_client() -> httpx.AsyncClient:
    global _cover_client
    if _cover_client is None:
        _cover_client = httpx.AsyncClient(
            timeout=30,
            limits=httpx.Limits(
                max_connections=_COVER_CONCURRENCY * 2,
                max_keepalive_connections=_COVER_CONCURRENCY,
            ),
        )
    return _cover_client


async def close_shared_client() -> None:
    global _cover_client
    if _cover_client is not None:
        await _cover_client.aclose()
        _cover_client = None

# Subsonic endpoints that mutate state — this proxy is otherwise a transparent
# passthrough, so guest accounts must be blocked from these explicitly.
_GUEST_BLOCKED_ENDPOINTS = frozenset({
    "createPlaylist.view",
    "updatePlaylist.view",
    "deletePlaylist.view",
})


def _forwarded_params(request: Request, user: UserContext) -> list[tuple[str, str]]:
    """Client query params (repeats preserved) minus any auth keys, plus
    server-side Subsonic auth so the client never supplies credentials."""
    params = [
        (k, v)
        for k, v in request.query_params.multi_items()
        if k not in SUBSONIC_AUTH_KEYS
    ]
    params.extend(subsonic_auth_params(user.username, user.password).items())
    return params


@router.get("/library/rest/{endpoint}")
async def subsonic_proxy(
    endpoint: str,
    request: Request,
    user: UserContext = Depends(get_user_flexible),
):
    """Generic JSON proxy for Subsonic REST calls. Auth is injected server-side."""
    if user.role == "guest" and endpoint in _GUEST_BLOCKED_ENDPOINTS:
        raise HTTPException(status_code=403, detail="Guests cannot perform this action")
    params = _forwarded_params(request, user)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{NAVIDROME_URL}/rest/{endpoint}", params=params)
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


@router.get("/library/stream/{track_id}")
async def stream(
    track_id: str,
    request: Request,
    user: UserContext = Depends(get_user_flexible),
):
    """Range-aware audio stream proxy."""
    params = subsonic_auth_params(user.username, user.password)
    params["id"] = track_id
    headers = {}
    if (rng := request.headers.get("range")) is not None:
        headers["Range"] = rng

    client = httpx.AsyncClient(timeout=None)
    req = client.build_request(
        "GET", f"{NAVIDROME_URL}/rest/stream.view", params=params, headers=headers
    )
    upstream = await client.send(req, stream=True)

    passthrough = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() in ("content-type", "content-length", "content-range", "accept-ranges")
    }

    async def body():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(body(), status_code=upstream.status_code, headers=passthrough)


async def _fetch_cover(params: dict) -> httpx.Response:
    """Fetch cover art from Navidrome, holding a concurrency slot for each
    attempt and retrying the statuses that mean "busy" rather than "no art"."""
    client = _shared_client()
    for delay in (*_COVER_RETRY_DELAYS, None):
        async with _cover_slots:
            resp = await client.get(f"{NAVIDROME_URL}/rest/getCoverArt.view", params=params)
        if delay is None or resp.status_code not in _COVER_RETRY_STATUS:
            return resp
        await asyncio.sleep(delay)
    return resp


@router.get("/library/cover/{cover_id}")
async def cover(
    cover_id: str,
    request: Request,
    user: UserContext = Depends(get_user_flexible),
):
    """Cover-art proxy."""
    params = subsonic_auth_params(user.username, user.password)
    params["id"] = cover_id
    if (size := request.query_params.get("size")) is not None:
        params["size"] = size
    resp = await _fetch_cover(params)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Cover art unavailable")
    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=86400"},
    )
