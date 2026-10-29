import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.database import Base, get_db
from routers import covers, library
from routers.auth import UserContext, get_current_user, get_user_flexible
from services import covers as covers_service

JPEG = b"\xff\xd8\xff\xe0" + b"j" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 64
NAVIDROME_ART = b"\xff\xd8\xff\xe0navidrome-art"


class FakeNavidrome:
    def __init__(self):
        self.urls = []

    async def get(self, url, params=None):
        self.urls.append((url, dict(params or {})))
        return httpx.Response(200, content=NAVIDROME_ART, headers={"content-type": "image/jpeg"})


def make_app(sessions, role="user"):
    async def db():
        async with sessions() as s:
            yield s

    api = FastAPI()
    api.include_router(covers.router, prefix="/api")
    api.include_router(library.router, prefix="/api")
    api.dependency_overrides[get_db] = db
    user = UserContext(username="tester", password="secret", role=role)
    api.dependency_overrides[get_current_user] = lambda: user
    api.dependency_overrides[get_user_flexible] = lambda: user
    return api


@pytest.fixture
async def sessions():
    eng = create_async_engine("sqlite+aiosqlite://")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(eng, expire_on_commit=False)
    await eng.dispose()


@pytest.fixture
def client(sessions):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app(sessions)), base_url="http://test")


@pytest.fixture(autouse=True)
def navidrome(monkeypatch):
    fake = FakeNavidrome()
    monkeypatch.setattr(library, "_shared_client", lambda: fake)
    covers_service.invalidate()
    covers_service._song_albums.clear()
    return fake


def remote(monkeypatch, handler):
    monkeypatch.setattr(
        covers_service, "_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False),
    )


async def test_uploaded_cover_replaces_navidrome_art(client, navidrome):
    put = await client.put("/api/covers/a1", content=JPEG, headers={"content-type": "image/jpeg"})
    assert put.status_code == 200

    resp = await client.get("/api/library/cover/al-a1_65f0a1b2?size=300")

    assert resp.content == JPEG
    assert resp.headers["content-type"] == "image/jpeg"
    assert navidrome.urls == []


async def test_other_albums_still_use_navidrome_art(client):
    await client.put("/api/covers/a1", content=JPEG)

    resp = await client.get("/api/library/cover/al-a2_65f0a1b2")

    assert resp.content == NAVIDROME_ART


async def test_track_cover_resolves_to_its_albums_override(client, navidrome, monkeypatch):
    await client.put("/api/covers/a1", content=PNG)

    class WithSong(FakeNavidrome):
        async def get(self, url, params=None):
            if url.endswith("getSong.view"):
                body = {"subsonic-response": {"status": "ok", "song": {"id": "s42", "albumId": "a1"}}}
                return httpx.Response(200, json=body)
            return await super().get(url, params)

    monkeypatch.setattr(library, "_shared_client", lambda: WithSong())
    resp = await client.get("/api/library/cover/mf-s42_65f0a1b2")

    assert resp.content == PNG
    assert resp.headers["content-type"] == "image/png"


async def test_deleting_the_override_restores_navidrome_art(client):
    await client.put("/api/covers/a1", content=JPEG)

    assert (await client.delete("/api/covers/a1")).status_code == 200
    resp = await client.get("/api/library/cover/al-a1_65f0a1b2")

    assert resp.content == NAVIDROME_ART


async def test_listing_reports_overridden_albums_and_a_version_that_changes(client):
    empty = (await client.get("/api/covers")).json()
    await client.put("/api/covers/a1", content=JPEG)
    after = (await client.get("/api/covers")).json()

    assert empty["albums"] == []
    assert after["albums"] == ["a1"]
    assert after["version"] != empty["version"]


async def test_rejects_non_image_bytes(client):
    resp = await client.put("/api/covers/a1", content=b"<html>not an image</html>")

    assert resp.status_code == 415


async def test_rejects_oversized_uploads(client):
    resp = await client.put("/api/covers/a1", content=JPEG + b"x" * covers_service.MAX_BYTES)

    assert resp.status_code == 413


async def test_rejects_malformed_album_ids(client):
    resp = await client.put("/api/covers/..%2Fetc", content=JPEG)

    assert resp.status_code in (404, 422)


async def test_guests_cannot_change_covers(sessions):
    guest = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_app(sessions, role="guest")), base_url="http://test"
    )

    resp = await guest.put("/api/covers/a1", content=JPEG)

    assert resp.status_code == 403


async def test_picking_a_suggestion_stores_the_fetched_image(client, monkeypatch):
    remote(monkeypatch, lambda req: httpx.Response(200, content=JPEG))

    resp = await client.post(
        "/api/covers/a1/from-url", json={"url": "https://is1-ssl.mzstatic.com/image/600x600bb.jpg"}
    )

    assert resp.status_code == 200
    assert (await client.get("/api/library/cover/al-a1_x")).content == JPEG


@pytest.mark.parametrize("url", [
    "http://is1-ssl.mzstatic.com/a.jpg",
    "https://evil.example.com/a.jpg",
    "https://mzstatic.com.evil.example.com/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://user@evil.example.com/a.jpg",
])
async def test_refuses_urls_outside_the_allowlist(client, monkeypatch, url):
    called = []
    remote(monkeypatch, lambda req: called.append(req) or httpx.Response(200, content=JPEG))

    resp = await client.post("/api/covers/a1/from-url", json={"url": url})

    assert resp.status_code == 400
    assert called == []


async def test_refuses_a_redirect_that_leaves_the_allowlist(client, monkeypatch):
    def handler(req):
        if req.url.host == "coverartarchive.org":
            return httpx.Response(307, headers={"location": "http://169.254.169.254/latest/meta-data"})
        return httpx.Response(200, content=JPEG)

    remote(monkeypatch, handler)

    resp = await client.post(
        "/api/covers/a1/from-url", json={"url": "https://coverartarchive.org/release/x/front-500"}
    )

    assert resp.status_code == 400


async def test_follows_a_redirect_within_the_allowlist(client, monkeypatch):
    def handler(req):
        if req.url.host == "coverartarchive.org":
            return httpx.Response(307, headers={"location": "https://ia800000.us.archive.org/img.jpg"})
        return httpx.Response(200, content=JPEG)

    remote(monkeypatch, handler)

    resp = await client.post(
        "/api/covers/a1/from-url", json={"url": "https://coverartarchive.org/release/x/front-500"}
    )

    assert resp.status_code == 200


DEEZER_ART = "https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg"


def suggestion_sources(monkeypatch, releases, deezer=None):
    def handler(req):
        if req.url.host == "itunes.apple.com":
            return httpx.Response(200, json={"results": [
                {"artworkUrl100": "https://is1-ssl.mzstatic.com/a/100x100bb.jpg"},
                {"artworkUrl100": "https://is1-ssl.mzstatic.com/b/100x100bb.jpg"},
            ]})
        if req.url.host == "api.deezer.com":
            if deezer is None:
                return httpx.Response(500)
            return httpx.Response(200, json={"data": [{"cover_xl": deezer}]})
        return httpx.Response(404)

    remote(monkeypatch, handler)

    async def release_ids(artist, album, limit):
        return releases

    monkeypatch.setattr(covers_service, "mb_release_ids", release_ids)


async def test_follows_the_archive_org_redirect_chain(client, monkeypatch):
    def handler(req):
        if req.url.host == "coverartarchive.org":
            return httpx.Response(307, headers={"location": "https://archive.org/download/mbid-x/mbid-x-1-500.jpg"})
        if req.url.host == "archive.org":
            return httpx.Response(302, headers={"location": "https://ia800000.us.archive.org/1/items/mbid-x/mbid-x-1-500.jpg"})
        return httpx.Response(200, content=JPEG)

    remote(monkeypatch, handler)

    resp = await client.post(
        "/api/covers/a1/from-url", json={"url": "https://coverartarchive.org/release/x/front-500"}
    )

    assert resp.status_code == 200


async def test_suggestions_come_from_itunes_deezer_and_every_cover_art_archive_release(client, monkeypatch):
    suggestion_sources(monkeypatch, ["m1", "m2"], deezer=DEEZER_ART)

    resp = await client.get("/api/covers/suggestions", params={"artist": "A", "album": "B"})

    assert [(s["source"], s["url"]) for s in resp.json()] == [
        ("iTunes", "https://is1-ssl.mzstatic.com/a/600x600bb.jpg"),
        ("iTunes", "https://is1-ssl.mzstatic.com/b/600x600bb.jpg"),
        ("Deezer", DEEZER_ART),
        ("Cover Art Archive", "https://coverartarchive.org/release/m1/front-500"),
        ("Cover Art Archive", "https://coverartarchive.org/release/m2/front-500"),
    ]


async def test_a_failing_source_does_not_hide_the_others(client, monkeypatch):
    suggestion_sources(monkeypatch, ["m1"], deezer=None)

    resp = await client.get("/api/covers/suggestions", params={"artist": "A", "album": "B"})

    assert [s["source"] for s in resp.json()] == ["iTunes", "iTunes", "Cover Art Archive"]


async def test_a_deezer_cover_can_be_picked(client, monkeypatch):
    remote(monkeypatch, lambda req: httpx.Response(200, content=JPEG))

    resp = await client.post("/api/covers/a1/from-url", json={"url": DEEZER_ART})

    assert resp.status_code == 200
