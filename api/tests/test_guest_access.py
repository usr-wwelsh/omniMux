import httpx
import pytest
from fastapi import FastAPI

from routers import download, tagger
from routers.auth import UserContext, get_current_user

GUEST = UserContext(username="omnimux_guest", password="secret", role="guest")

MUTATING_ROUTES = [
    ("/api/tagger/delete", {"file_paths": []}),
    ("/api/tagger/tags", {}),
    ("/api/tagger/retag", {}),
    ("/api/tagger/restore", {}),
    ("/api/tagger/merge-albums", {}),
    ("/api/tagger/flags", {"file_paths": [], "ignore_in_autodj": True}),
    ("/api/download/1/cancel", None),
]


@pytest.fixture
def guest_client():
    api = FastAPI()
    api.include_router(tagger.router, prefix="/api")
    api.include_router(download.router, prefix="/api")
    api.dependency_overrides[get_current_user] = lambda: GUEST
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test")


@pytest.mark.parametrize("path,body", MUTATING_ROUTES)
async def test_guest_cannot_mutate_shared_library(guest_client, path, body):
    resp = await guest_client.post(path, json=body)

    assert resp.status_code == 403
