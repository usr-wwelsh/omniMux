import httpx

from main import app, load_cors_origins


def test_no_origins_allowed_when_unset():
    assert load_cors_origins(None) == []
    assert load_cors_origins("") == []


def test_origins_parsed_from_comma_separated_list():
    raw = " https://a.example , https://b.example ,"

    assert load_cors_origins(raw) == ["https://a.example", "https://b.example"]


def test_wildcard_origin_is_rejected():
    assert load_cors_origins("*,https://a.example") == ["https://a.example"]


async def test_foreign_origin_gets_no_cors_headers_with_cookie():
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    resp = await client.get(
        "/api/health", headers={"Origin": "https://evil.example", "Cookie": "omnimux_token=x"}
    )

    assert "access-control-allow-origin" not in resp.headers
