import httpx
import pytest

from services import updater


class FakeUpdaterClient:
    """Stands in for the httpx.AsyncClient talking over the updater's Unix
    socket, keyed by path so tests can script per-endpoint responses."""

    def __init__(self, responses: dict):
        self.responses = responses
        self.calls: list[tuple[str, str]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, path, headers=None):
        self.calls.append(("GET", path))
        return self._resolve(path)

    async def post(self, path, headers=None):
        self.calls.append(("POST", path))
        return self._resolve(path)

    def _resolve(self, path):
        result = self.responses[path]
        if isinstance(result, Exception):
            raise result
        return result


def use_fake_client(monkeypatch, responses: dict) -> FakeUpdaterClient:
    fake = FakeUpdaterClient(responses)
    monkeypatch.setattr(updater, "_client", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def configured(monkeypatch, tmp_path):
    """Most tests want is_configured() == True; the two unconfigured tests
    override this themselves."""
    socket_path = tmp_path / "updater.sock"
    socket_path.touch()
    monkeypatch.setattr(updater, "SOCKET_PATH", str(socket_path))
    monkeypatch.setattr(updater, "TOKEN", "test-token")


async def test_get_status_returns_none_when_socket_missing(monkeypatch):
    monkeypatch.setattr(updater, "SOCKET_PATH", "/no/such/socket")

    assert await updater.get_status() is None


async def test_get_status_returns_none_when_token_unset(monkeypatch):
    monkeypatch.setattr(updater, "TOKEN", "")

    assert await updater.get_status() is None


async def test_get_status_returns_parsed_body(monkeypatch):
    body = {"available": True, "current": "abc123", "latest": "def456", "up_to_date": False, "commits": [], "error": None}
    use_fake_client(monkeypatch, {"/status": httpx.Response(200, json=body)})

    result = await updater.get_status()

    assert result == body


async def test_get_status_returns_none_on_unreachable_socket(monkeypatch):
    use_fake_client(monkeypatch, {"/status": httpx.ConnectError("no such file or directory")})

    assert await updater.get_status() is None


async def test_get_status_returns_none_on_unauthorized(monkeypatch):
    use_fake_client(monkeypatch, {"/status": httpx.Response(401, json={"error": "unauthorized"})})

    assert await updater.get_status() is None


async def test_get_progress_returns_parsed_body(monkeypatch):
    body = {"phase": "building", "percent": 50, "log_tail": "", "error": None}
    use_fake_client(monkeypatch, {"/progress": httpx.Response(200, json=body)})

    assert await updater.get_progress() == body


async def test_apply_update_returns_accepted_body(monkeypatch):
    use_fake_client(monkeypatch, {"/apply": httpx.Response(202, json={"accepted": True})})

    assert await updater.apply_update() == {"accepted": True}


async def test_apply_update_forwards_rejection_body(monkeypatch):
    use_fake_client(monkeypatch, {"/apply": httpx.Response(409, json={"accepted": False, "reason": "update already in progress"})})

    assert await updater.apply_update() == {"accepted": False, "reason": "update already in progress"}


async def test_apply_update_reports_unreachable_without_raising(monkeypatch):
    use_fake_client(monkeypatch, {"/apply": httpx.ConnectError("refused")})

    result = await updater.apply_update()

    assert result == {"accepted": False, "reason": "updater unreachable"}


async def test_apply_update_reports_not_configured(monkeypatch):
    monkeypatch.setattr(updater, "TOKEN", "")

    result = await updater.apply_update()

    assert result == {"accepted": False, "reason": "updater not configured"}
