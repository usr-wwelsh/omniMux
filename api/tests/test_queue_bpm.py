import httpx
import pytest
from fastapi import FastAPI

from routers import devices
from routers.auth import UserContext, get_current_user


@pytest.fixture
def client(monkeypatch):
    async def noop():
        pass

    monkeypatch.setattr(devices, "_persist_queues", noop)
    devices._queues.clear()
    api = FastAPI()
    api.include_router(devices.router, prefix="/api")
    api.dependency_overrides[get_current_user] = lambda: UserContext(
        username="tester", password="secret", role="user"
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test")


async def test_queue_round_trip_keeps_track_bpm(client):
    track = {"id": "t1", "title": "T", "artist": "A", "album": "B", "bpm": 128}

    put = await client.put(
        "/api/queue",
        json={"tracks": [track], "index": 0, "active_device_id": "d1"},
    )
    got = await client.get("/api/queue")

    assert put.status_code == 200
    assert got.json()["tracks"][0]["bpm"] == 128
