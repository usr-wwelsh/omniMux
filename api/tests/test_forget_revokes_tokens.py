import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.database import Base, get_db
from routers import auth, devices


@pytest.fixture
async def client():
    eng = create_async_engine("sqlite+aiosqlite://")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(eng, expire_on_commit=False)

    async def db():
        async with sessions() as s:
            yield s

    api = FastAPI()
    api.include_router(devices.router, prefix="/api")
    api.dependency_overrides[get_db] = db
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test")
    await eng.dispose()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


async def test_token_works_before_any_forget(client):
    token = auth._create_token("alice", "hunter2")

    resp = await client.get("/api/devices/known", headers=_bearer(token))

    assert resp.status_code == 200


async def test_forgetting_a_device_revokes_older_tokens(client):
    stolen = auth._create_token("alice", "hunter2")

    resp = await client.delete("/api/devices/known/phone", headers=_bearer(stolen))
    assert resp.status_code == 200

    after = await client.get("/api/devices/known", headers=_bearer(stolen))
    assert after.status_code == 401


async def test_forget_returns_a_fresh_token_for_the_caller(client):
    old = auth._create_token("alice", "hunter2")

    resp = await client.delete("/api/devices/known/phone", headers=_bearer(old))
    fresh = resp.json()["token"]

    after = await client.get("/api/devices/known", headers=_bearer(fresh))
    assert after.status_code == 200


async def test_forget_does_not_revoke_other_users(client):
    bob = auth._create_token("bob", "pw")
    alice = auth._create_token("alice", "hunter2")

    await client.delete("/api/devices/known/phone", headers=_bearer(alice))

    resp = await client.get("/api/devices/known", headers=_bearer(bob))
    assert resp.status_code == 200
