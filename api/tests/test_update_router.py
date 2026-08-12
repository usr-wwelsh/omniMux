import httpx
import pytest
from fastapi import FastAPI

from routers import update
from routers.auth import UserContext, get_current_user
from services import updater


@pytest.fixture
def app():
    api = FastAPI()
    api.include_router(update.router, prefix="/api")
    api.dependency_overrides[get_current_user] = lambda: UserContext(
        username="tester", password="secret", role="user"
    )
    return api


@pytest.fixture
def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_status_reports_unavailable_when_updater_not_configured(client, monkeypatch):
    monkeypatch.setattr(updater, "get_status", lambda: _async_result(None))

    resp = await client.get("/api/update/status")

    assert resp.status_code == 200
    assert resp.json() == {"available": False}


async def test_status_passes_through_updater_payload(client, monkeypatch):
    payload = {"available": True, "current": "abc123", "latest": "def456", "up_to_date": False,
               "commits": [{"hash": "def456", "subject": "fix: bug"}], "error": None}
    monkeypatch.setattr(updater, "get_status", lambda: _async_result(payload))

    resp = await client.get("/api/update/status")

    assert resp.status_code == 200
    assert resp.json() == payload


async def test_progress_reports_unavailable_when_updater_unreachable(client, monkeypatch):
    monkeypatch.setattr(updater, "get_progress", lambda: _async_result(None))

    resp = await client.get("/api/update/progress")

    assert resp.json() == {"available": False}


async def test_progress_wraps_updater_payload_with_available_flag(client, monkeypatch):
    payload = {"phase": "building", "percent": 50, "log_tail": "", "error": None}
    monkeypatch.setattr(updater, "get_progress", lambda: _async_result(payload))

    resp = await client.get("/api/update/progress")

    assert resp.json() == {"available": True, **payload}


async def test_apply_returns_202_when_accepted(client, monkeypatch):
    monkeypatch.setattr(updater, "apply_update", lambda: _async_result({"accepted": True}))

    resp = await client.post("/api/update/apply")

    assert resp.status_code == 202
    assert resp.json() == {"accepted": True}


async def test_apply_returns_409_when_already_in_progress(client, monkeypatch):
    body = {"accepted": False, "reason": "update already in progress"}
    monkeypatch.setattr(updater, "apply_update", lambda: _async_result(body))

    resp = await client.post("/api/update/apply")

    assert resp.status_code == 409
    assert resp.json() == body


async def test_apply_returns_503_when_updater_unreachable(client, monkeypatch):
    body = {"accepted": False, "reason": "updater unreachable"}
    monkeypatch.setattr(updater, "apply_update", lambda: _async_result(body))

    resp = await client.post("/api/update/apply")

    assert resp.status_code == 503
    assert resp.json() == body


async def test_guest_cannot_view_update_status(app, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: UserContext(
        username="omnimux_guest", password="secret", role="guest"
    )
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    monkeypatch.setattr(updater, "get_status", lambda: _async_result(None))

    resp = await client.get("/api/update/status")

    assert resp.status_code == 403


async def test_guest_cannot_trigger_apply(app, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: UserContext(
        username="omnimux_guest", password="secret", role="guest"
    )
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    monkeypatch.setattr(updater, "apply_update", lambda: _async_result({"accepted": True}))

    resp = await client.post("/api/update/apply")

    assert resp.status_code == 403


async def _async_result(value):
    return value
