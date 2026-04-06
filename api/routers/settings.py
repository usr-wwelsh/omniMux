import json

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import UserSettings, utcnow
from routers.auth import get_current_user, UserContext

router = APIRouter()


@router.get("/settings")
async def get_settings(
    user: UserContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(UserSettings, user.username)
    if not row:
        return {}
    return json.loads(row.data or '{}')


@router.put("/settings")
async def put_settings(
    body: dict,
    user: UserContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(UserSettings, user.username)
    if row:
        row.data = json.dumps(body)
        row.updated_at = utcnow()
    else:
        row = UserSettings(username=user.username, data=json.dumps(body))
        db.add(row)
    await db.commit()
    return {"ok": True}
