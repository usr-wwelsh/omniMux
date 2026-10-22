import httpx
import pytest
from fastapi import FastAPI

from routers import auth


@pytest.fixture
def client(monkeypatch):
    async def accept(username, password):
        return True

    monkeypatch.setattr(auth, "validate_credentials", accept)
    api = FastAPI()
    api.include_router(auth.router, prefix="/api")
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test")


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
