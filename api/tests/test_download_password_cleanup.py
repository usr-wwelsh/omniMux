import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.database import Base, get_db
from db.models import Download
from routers import download
from routers.auth import UserContext, get_current_user
from services import download_worker


@pytest.fixture
async def sessions():
    eng = create_async_engine("sqlite+aiosqlite://")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(eng, expire_on_commit=False)
    await eng.dispose()


async def _seed(sessions, status="downloading"):
    async with sessions() as s:
        s.add(Download(
            youtube_id="abc", youtube_url="https://youtu.be/abc", title="t", artist="a",
            status=status, navidrome_username="alice", navidrome_password="hunter2",
        ))
        await s.commit()


async def _password(sessions):
    async with sessions() as s:
        return (await s.get(Download, 1)).navidrome_password


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
async def test_worker_clears_password_when_download_finishes(sessions, monkeypatch, status):
    monkeypatch.setattr(download_worker, "async_session", sessions)
    await _seed(sessions)

    await download_worker._update_download(1, status=status)

    assert await _password(sessions) is None


@pytest.mark.parametrize("status", ["downloading", "analyzing", "tagging", "scanning"])
async def test_worker_keeps_password_while_download_is_active(sessions, monkeypatch, status):
    monkeypatch.setattr(download_worker, "async_session", sessions)
    await _seed(sessions)

    await download_worker._update_download(1, status=status)

    assert await _password(sessions) == "hunter2"


async def test_cancel_clears_password(sessions):
    await _seed(sessions)
    api = FastAPI()
    api.include_router(download.router, prefix="/api")

    async def db():
        async with sessions() as s:
            yield s

    api.dependency_overrides[get_db] = db
    api.dependency_overrides[get_current_user] = lambda: UserContext(username="alice", password="hunter2")
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test")

    resp = await client.post("/api/download/1/cancel")

    assert resp.status_code == 200
    assert await _password(sessions) is None
