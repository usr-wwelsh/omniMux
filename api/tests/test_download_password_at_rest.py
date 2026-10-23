import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db import secretbox
from db.database import Base, clear_finished_passwords, encrypt_legacy_passwords
from db.models import Download


@pytest.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite://")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


def _download(password):
    return Download(
        youtube_id="abc", youtube_url="https://youtu.be/abc", title="t", artist="a",
        navidrome_username="alice", navidrome_password=password,
    )


async def _raw_password(engine, row_id):
    async with engine.connect() as conn:
        return (await conn.execute(
            text("SELECT navidrome_password FROM downloads WHERE id = :i"), {"i": row_id}
        )).scalar_one()


async def test_password_roundtrips_through_the_model(engine):
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as s:
        s.add(_download("hunter2"))
        await s.commit()

    async with sessions() as s:
        assert (await s.get(Download, 1)).navidrome_password == "hunter2"


async def test_password_is_not_stored_in_plaintext(engine):
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as s:
        s.add(_download("hunter2"))
        await s.commit()

    assert "hunter2" not in await _raw_password(engine, 1)


async def test_null_password_stays_null(engine):
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as s:
        s.add(_download(None))
        await s.commit()

    assert await _raw_password(engine, 1) is None


async def test_legacy_plaintext_row_is_still_readable(engine):
    async with engine.begin() as conn:
        await conn.execute(text(
            "INSERT INTO downloads (youtube_id, youtube_url, title, artist, status, progress, navidrome_password, created_at, updated_at)"
            " VALUES ('a','u','t','a','queued',0,'hunter2','2024-01-01','2024-01-01')"
        ))
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async with sessions() as s:
        assert (await s.get(Download, 1)).navidrome_password == "hunter2"


async def test_encrypt_legacy_passwords_rewrites_plaintext_rows(engine):
    async with engine.begin() as conn:
        await conn.execute(text(
            "INSERT INTO downloads (youtube_id, youtube_url, title, artist, status, progress, navidrome_password, created_at, updated_at)"
            " VALUES ('a','u','t','a','queued',0,'hunter2','2024-01-01','2024-01-01')"
        ))
        await encrypt_legacy_passwords(conn)

    raw = await _raw_password(engine, 1)
    assert "hunter2" not in raw
    assert secretbox.decrypt(raw) == "hunter2"


async def test_encrypt_legacy_passwords_is_idempotent(engine):
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as s:
        s.add(_download("hunter2"))
        await s.commit()
    before = await _raw_password(engine, 1)

    async with engine.begin() as conn:
        await encrypt_legacy_passwords(conn)

    assert await _raw_password(engine, 1) == before


def test_value_encrypted_under_another_secret_reads_as_none(monkeypatch):
    stored = secretbox.encrypt("hunter2")
    monkeypatch.setenv("JWT_SECRET", "a-different-secret-entirely-32-bytes!!")
    secretbox._fernet.cache_clear()

    assert secretbox.decrypt(stored) is None
    secretbox._fernet.cache_clear()


@pytest.mark.parametrize("status,expected_kept", [
    ("completed", False), ("failed", False), ("cancelled", False),
    ("queued", True), ("downloading", True),
])
async def test_clear_finished_passwords_only_touches_finished_rows(engine, status, expected_kept):
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as s:
        dl = _download("hunter2")
        dl.status = status
        s.add(dl)
        await s.commit()

    async with engine.begin() as conn:
        await clear_finished_passwords(conn)

    assert (await _raw_password(engine, 1) is not None) == expected_kept
