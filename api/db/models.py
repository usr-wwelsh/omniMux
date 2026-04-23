from datetime import datetime, timezone

from sqlalchemy import String, Integer, Float, DateTime, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Download(Base):
    __tablename__ = "downloads"

    id: Mapped[int] = mapped_column(primary_key=True)
    youtube_id: Mapped[str] = mapped_column(String(20), index=True)
    youtube_url: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(500))
    artist: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued/downloading/analyzing/tagging/scanning/completed/failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    mood: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    energy: Mapped[float | None] = mapped_column(Float, nullable=True)
    key: Mapped[str | None] = mapped_column(String(10), nullable=True)
    genre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_album: Mapped[str | None] = mapped_column(String(500), nullable=True)
    playlist_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    navidrome_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    navidrome_password: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class UserSettings(Base):
    __tablename__ = "user_settings"

    username: Mapped[str] = mapped_column(String(200), primary_key=True)
    data: Mapped[str] = mapped_column(Text, default='{}')
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TrackFlags(Base):
    __tablename__ = "track_flags"

    title: Mapped[str] = mapped_column(String(500), primary_key=True)
    artist: Mapped[str] = mapped_column(String(500), primary_key=True)
    ignore_in_autodj: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (UniqueConstraint("title", "artist"),)


class SystemConfig(Base):
    __tablename__ = "system_config"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TagSnapshot(Base):
    __tablename__ = "tag_snapshots"

    file_path: Mapped[str] = mapped_column(String(1000), primary_key=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    artist: Mapped[str] = mapped_column(String(500), default="")
    albumartist: Mapped[str] = mapped_column(String(500), default="")
    album: Mapped[str] = mapped_column(String(500), default="")
    genre: Mapped[str] = mapped_column(String(100), default="")
    year: Mapped[str] = mapped_column(String(10), default="")
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TrackMapping(Base):
    __tablename__ = "track_mappings"

    id: Mapped[int] = mapped_column(primary_key=True)
    youtube_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    file_path: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str] = mapped_column(String(500))
    artist: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (UniqueConstraint("youtube_id"),)
