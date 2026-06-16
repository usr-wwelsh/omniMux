import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from routers.auth import UserContext, get_user_flexible
from services.navidrome import SUBSONIC_AUTH_KEYS, subsonic_auth_params

NAVIDROME_URL = os.environ.get("NAVIDROME_URL", "http://localhost:4533")

router = APIRouter()


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
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{NAVIDROME_URL}/rest/getCoverArt.view", params=params)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Cover art unavailable")
    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=86400"},
    )
