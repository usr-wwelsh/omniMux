import asyncio

import httpx
import pytest
from fastapi import FastAPI

from routers import library
from routers.auth import UserContext, get_user_flexible

IMAGE = b"\xff\xd8\xff\xe0JFIF-ish-bytes"


def _response(status: int) -> httpx.Response:
    if status == 200:
        return httpx.Response(200, content=IMAGE, headers={"content-type": "image/jpeg"})
    return httpx.Response(status, text="Too Many Requests")


class FakeNavidrome:
    """Stands in for Navidrome's artwork endpoint, recording how many requests
    were in flight at once so the proxy's metering can be asserted on."""

    def __init__(self, statuses: list[int], hold: float = 0.0):
        self.statuses = list(statuses)
        self.hold = hold
        self.calls = 0
        self.in_flight = 0
        self.peak_in_flight = 0

    async def get(self, url: str, params=None) -> httpx.Response:
        self.in_flight += 1
        self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
        try:
            if self.hold:
                await asyncio.sleep(self.hold)
            status = self.statuses[min(self.calls, len(self.statuses) - 1)]
            self.calls += 1
            return _response(status)
        finally:
            self.in_flight -= 1


@pytest.fixture
def app():
    api = FastAPI()
    api.include_router(library.router, prefix="/api")
    api.dependency_overrides[get_user_flexible] = lambda: UserContext(
        username="tester", password="secret", role="admin"
    )
    return api


@pytest.fixture
def client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.fixture(autouse=True)
def fast_retries(monkeypatch):
    monkeypatch.setattr(library, "_COVER_RETRY_DELAYS", (0.0, 0.0, 0.0))


def use_navidrome(monkeypatch, fake: FakeNavidrome) -> None:
    monkeypatch.setattr(library, "_shared_client", lambda: fake)


async def test_serves_cover_art(client, monkeypatch):
    use_navidrome(monkeypatch, FakeNavidrome([200]))

    resp = await client.get("/api/library/cover/al-1?size=300")

    assert resp.status_code == 200
    assert resp.content == IMAGE


# Navidrome rejects artwork requests beyond its own concurrency budget with a
# 429 instead of queueing them. Passing that through paints a broken image onto
# a card whose art is perfectly fine, so the proxy has to absorb it.
async def test_retries_through_a_throttled_rejection(client, monkeypatch):
    fake = FakeNavidrome([429, 429, 200])
    use_navidrome(monkeypatch, fake)

    resp = await client.get("/api/library/cover/al-1?size=300")

    assert resp.status_code == 200
    assert resp.content == IMAGE
    assert fake.calls == 3


async def test_reports_failure_once_retries_are_exhausted(client, monkeypatch):
    use_navidrome(monkeypatch, FakeNavidrome([429]))

    resp = await client.get("/api/library/cover/al-1?size=300")

    assert resp.status_code == 429


async def test_missing_art_is_not_retried(client, monkeypatch):
    fake = FakeNavidrome([404])
    use_navidrome(monkeypatch, fake)

    resp = await client.get("/api/library/cover/al-1?size=300")

    assert resp.status_code == 404
    assert fake.calls == 1


async def test_meters_concurrent_requests_to_navidrome(client, monkeypatch):
    fake = FakeNavidrome([200], hold=0.02)
    use_navidrome(monkeypatch, fake)

    await asyncio.gather(
        *[client.get(f"/api/library/cover/al-{i}?size=300") for i in range(40)]
    )

    assert fake.calls == 40
    assert fake.peak_in_flight <= library._COVER_CONCURRENCY
