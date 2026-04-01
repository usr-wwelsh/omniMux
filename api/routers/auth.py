import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from services.navidrome import validate_credentials

router = APIRouter()

JWT_SECRET = os.environ.get("JWT_SECRET", "omnimux-dev-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str


class UserContext(BaseModel):
    username: str
    password: str


def _create_token(username: str, password: str) -> str:
    payload = {
        "sub": username,
        "pwd": password,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> UserContext:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return UserContext(username=payload["sub"], password=payload["pwd"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(request: Request) -> UserContext:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = auth_header.removeprefix("Bearer ")
    return _decode_token(token)


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    valid = await validate_credentials(body.username, body.password)
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _create_token(body.username, body.password)
    return LoginResponse(token=token, username=body.username)
