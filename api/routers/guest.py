import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import SystemConfig, utcnow
from routers.auth import (
    GUEST_USERNAME,
    LoginResponse,
    UserContext,
    _create_token,
    require_non_guest,
)
from services.navidrome import create_navidrome_user, validate_credentials

router = APIRouter()


class GuestLoginResponse(BaseModel):
    token: str
    username: str
    role: str
    password: str


class GuestConfigRequest(BaseModel):
    enabled: bool


@router.get("/guest/status")
async def guest_status(db: AsyncSession = Depends(get_db)):
    row = await db.get(SystemConfig, "guest_enabled")
    return {"enabled": row is not None and row.value == "true"}


@router.post("/guest/login", response_model=GuestLoginResponse)
async def guest_login(db: AsyncSession = Depends(get_db)):
    enabled_row = await db.get(SystemConfig, "guest_enabled")
    if not enabled_row or enabled_row.value != "true":
        raise HTTPException(status_code=403, detail="Guest access is not enabled")

    pwd_row = await db.get(SystemConfig, "guest_password")
    if not pwd_row or not pwd_row.value:
        raise HTTPException(status_code=500, detail="Guest account not configured")

    valid = await validate_credentials(GUEST_USERNAME, pwd_row.value)
    if not valid:
        raise HTTPException(status_code=500, detail="Guest account credentials are invalid")

    token = _create_token(GUEST_USERNAME, pwd_row.value, role="guest")
    return GuestLoginResponse(token=token, username=GUEST_USERNAME, role="guest", password=pwd_row.value)


@router.put("/guest/enabled")
async def set_guest_enabled(
    body: GuestConfigRequest,
    user: UserContext = Depends(require_non_guest),
    db: AsyncSession = Depends(get_db),
):
    if body.enabled:
        pwd_row = await db.get(SystemConfig, "guest_password")
        if not pwd_row:
            password = secrets.token_urlsafe(16)
            success = await create_navidrome_user(user.username, user.password, GUEST_USERNAME, password)
            if not success:
                raise HTTPException(
                    status_code=400,
                    detail="Failed to create guest user on Navidrome. Make sure your account has admin privileges.",
                )
            db.add(SystemConfig(key="guest_password", value=password, updated_at=utcnow()))
        else:
            # User already has a password — try to create in case account was deleted; ignore if already exists
            await create_navidrome_user(user.username, user.password, GUEST_USERNAME, pwd_row.value)

        enabled_row = await db.get(SystemConfig, "guest_enabled")
        if enabled_row:
            enabled_row.value = "true"
            enabled_row.updated_at = utcnow()
        else:
            db.add(SystemConfig(key="guest_enabled", value="true", updated_at=utcnow()))
    else:
        enabled_row = await db.get(SystemConfig, "guest_enabled")
        if enabled_row:
            enabled_row.value = "false"
            enabled_row.updated_at = utcnow()
        else:
            db.add(SystemConfig(key="guest_enabled", value="false", updated_at=utcnow()))

    await db.commit()
    return {"ok": True, "enabled": body.enabled}
