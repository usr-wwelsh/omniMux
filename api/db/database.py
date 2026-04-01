import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATA_DIR = os.environ.get("DATA_DIR", "./data")
DATABASE_URL = f"sqlite+aiosqlite:///{DATA_DIR}/omnimux.db"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from db.models import Download, TrackMapping  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migration: add playlist_name if it doesn't exist yet
        try:
            await conn.execute(text("ALTER TABLE downloads ADD COLUMN playlist_name VARCHAR(500)"))
        except Exception:
            pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
