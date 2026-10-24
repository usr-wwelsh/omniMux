import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.database import Base, get_db
from routers import auth


@pytest.fixture
async def client(monkeypatch):
    eng = create_async_engine("sqlite+aiosqlite://")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(eng, expire_on_commit=False)

    async def db():
        async with sessions() as s:
            yield s

    async def accept(username, password):
        return True

    monkeypatch.setattr(auth, "validate_credentials", accept)
    api = FastAPI()
    api.include_router(auth.router, prefix="/api")
    api.dependency_overrides[get_db] = db
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test")
    await eng.dispose()


async def _login(client, **headers):
    return await client.post(
        "/api/login", json={"username": "u", "password": "p"}, headers=headers
    )


async def test_cookie_is_not_secure_over_plain_http(client):
    resp = await _login(client)

    assert "secure" not in resp.headers["set-cookie"].lower()


async def test_cookie_is_secure_behind_tls_terminating_proxy(client):
    resp = await _login(client, **{"X-Forwarded-Proto": "https"})

    assert "secure" in resp.headers["set-cookie"].lower()


async def test_cookie_is_secure_when_env_forces_it(client, monkeypatch):
    monkeypatch.setattr(auth, "COOKIE_SECURE", True)

    resp = await _login(client)

    assert "secure" in resp.headers["set-cookie"].lower()
