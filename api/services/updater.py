"""Client for the opt-in host-side updater daemon (see deploy/).

Talks over a Unix socket the daemon owns — never the docker socket, never a
host shell. If the socket or token isn't configured, every call here
degrades to "unavailable" rather than raising, so the update banner simply
doesn't appear on installs that haven't opted in.
"""
import os

import httpx

SOCKET_PATH = os.environ.get("OMNIMUX_UPDATER_SOCKET", "/run/omnimux-updater/updater.sock")
TOKEN = os.environ.get("UPDATER_TOKEN", "")


def _client() -> httpx.AsyncClient:
    transport = httpx.AsyncHTTPTransport(uds=SOCKET_PATH)
    return httpx.AsyncClient(transport=transport, base_url="http://updater", timeout=10.0)


def is_configured() -> bool:
    return bool(TOKEN) and os.path.exists(SOCKET_PATH)


async def _get(path: str) -> dict | None:
    if not is_configured():
        return None
    try:
        async with _client() as client:
            resp = await client.get(path, headers={"X-Updater-Token": TOKEN})
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


async def get_status() -> dict | None:
    return await _get("/status")


async def get_progress() -> dict | None:
    return await _get("/progress")


async def apply_update() -> dict:
    if not is_configured():
        return {"accepted": False, "reason": "updater not configured"}
    try:
        async with _client() as client:
            resp = await client.post("/apply", headers={"X-Updater-Token": TOKEN})
    except httpx.HTTPError:
        return {"accepted": False, "reason": "updater unreachable"}
    try:
        return resp.json()
    except ValueError:
        return {"accepted": False, "reason": "updater returned an invalid response"}
