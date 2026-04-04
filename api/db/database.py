import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

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


async def init_db():
    from db.models import Download, TrackMapping  # noqa: F401

    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.run_sync(Base.metadata.create_all)
        # Migrations: add columns if they don't exist yet
        for migration in [
            "ALTER TABLE downloads ADD COLUMN playlist_name VARCHAR(500)",
            "ALTER TABLE downloads ADD COLUMN navidrome_username VARCHAR(200)",
            "ALTER TABLE downloads ADD COLUMN navidrome_password VARCHAR(500)",
            "ALTER TABLE downloads ADD COLUMN target_album VARCHAR(500)",
        ]:
            try:
                await conn.execute(text(migration))
            except Exception:
                pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
