import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from db.database import init_db, async_session
from db.models import Download
from routers import auth, search, download, devices, playlists, tagger, settings


async def _recover_stuck_downloads() -> None:
    """Re-queue any downloads that were interrupted by a previous restart."""
    from routers.download import _spawn_download

    stuck_statuses = ["queued", "downloading", "analyzing", "tagging", "scanning"]
    async with async_session() as session:
        result = await session.execute(
            select(Download).where(Download.status.in_(stuck_statuses))
        )
        stuck = result.scalars().all()

    for dl in stuck:
        if dl.navidrome_username and dl.navidrome_password:
            # Reset to queued so status is accurate before re-spawning
            async with async_session() as session:
                d = await session.get(Download, dl.id)
                if d:
                    d.status = "queued"
                    d.progress = 0
                    d.error = None
                    await session.commit()
            _spawn_download(dl.id, dl.navidrome_username, dl.navidrome_password)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _recover_stuck_downloads()
    yield


app = FastAPI(title="omniMux API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(download.router, prefix="/api", tags=["download"])
app.include_router(devices.router, prefix="/api", tags=["devices"])
app.include_router(playlists.router, prefix="/api", tags=["playlists"])
app.include_router(tagger.router, prefix="/api", tags=["tagger"])
app.include_router(settings.router, prefix="/api", tags=["settings"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
