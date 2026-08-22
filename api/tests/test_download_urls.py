"""The download/import endpoints must refuse non-YouTube URLs at the trust
boundary — before yt-dlp ever sees them (SSRF)."""
import httpx
import pytest
from fastapi import FastAPI

from routers import download
from routers.auth import UserContext, require_non_guest


@pytest.fixture
def app():
    api = FastAPI()
    api.include_router(download.router, prefix="/api")
    api.dependency_overrides[require_non_guest] = lambda: UserContext(
        username="tester", password="secret", role="user"
    )
    return api


@pytest.fixture
def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_import_video_rejects_internal_url_before_extraction(client, monkeypatch):
    def fail_extract(url):
        raise AssertionError("yt-dlp extraction must not run for disallowed URLs")

    monkeypatch.setattr(download, "_extract_video", fail_extract)
    resp = await client.post(
        "/api/import/video", json={"video_url": "http://169.254.169.254/latest/meta-data/"}
    )
    assert resp.status_code == 400


async def test_download_rejects_internal_url(client):
    resp = await client.post(
        "/api/download",
        json={
            "youtube_url": "http://localhost:8800/api/downloads",
            "youtube_id": "dQw4w9WgXcQ",
            "title": "x",
            "artist": "y",
        },
    )
    assert resp.status_code == 400


async def test_download_rejects_malformed_video_id(client):
    resp = await client.post(
        "/api/download",
        json={
            "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "youtube_id": "../../etc/passwd",
            "title": "x",
            "artist": "y",
        },
    )
    assert resp.status_code == 400


async def test_channel_playlists_rejects_internal_url(client):
    resp = await client.get(
        "/api/youtube/channel-playlists", params={"url": "http://127.0.0.1:4533"}
    )
    assert resp.status_code == 400
