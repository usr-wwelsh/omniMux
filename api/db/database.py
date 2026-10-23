import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from db import secretbox

DATA_DIR = os.environ.get("DATA_DIR", "./data")
DATABASE_URL = f"sqlite+aiosqlite:///{DATA_DIR}/omnimux.db"

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"timeout": 30},  # wait up to 30s for SQLite write lock
)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def encrypt_legacy_passwords(conn) -> None:
    rows = (await conn.execute(text(
        "SELECT id, navidrome_password FROM downloads"
        " WHERE navidrome_password IS NOT NULL AND navidrome_password NOT LIKE :prefix"
    ), {"prefix": secretbox.PREFIX + "%"})).all()
    for row_id, password in rows:
        await conn.execute(
            text("UPDATE downloads SET navidrome_password = :p WHERE id = :i"),
            {"p": secretbox.encrypt(password), "i": row_id},
        )


async def clear_finished_passwords(conn) -> None:
    await conn.execute(text(
        "UPDATE downloads SET navidrome_password = NULL"
        " WHERE status IN ('completed', 'failed', 'cancelled') AND navidrome_password IS NOT NULL"
    ))


async def init_db():
    from db.models import Download, TrackMapping, UserSettings, TrackFlags, SystemConfig, KnownDevice  # noqa: F401

    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.run_sync(Base.metadata.create_all)
        # Migrations: add columns if they don't exist yet
        for migration in [
            "ALTER TABLE downloads ADD COLUMN playlist_name VARCHAR(500)",
            "ALTER TABLE downloads ADD COLUMN navidrome_username VARCHAR(200)",
            "ALTER TABLE downloads ADD COLUMN navidrome_password VARCHAR(500)",
            "ALTER TABLE downloads ADD COLUMN target_album VARCHAR(500)",
            "ALTER TABLE downloads ADD COLUMN album_artist VARCHAR(500)",
            "ALTER TABLE tag_snapshots ADD COLUMN release_mbid VARCHAR(64) DEFAULT ''",
        ]:
            try:
                await conn.execute(text(migration))
            except Exception:
                pass
        await clear_finished_passwords(conn)
        await encrypt_legacy_passwords(conn)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
