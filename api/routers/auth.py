import base64
import os
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from pydantic import BaseModel

from services.navidrome import validate_credentials

router = APIRouter()

PLACEHOLDER_SECRETS = {"change-me-in-production", "omnimux-dev-secret"}


def load_jwt_secret(raw: str | None) -> str:
    secret = (raw or "").strip()
    if not secret or secret in PLACEHOLDER_SECRETS:
        raise RuntimeError("JWT_SECRET is unset or a placeholder; generate one with `openssl rand -hex 32`")
    return secret


JWT_SECRET = load_jwt_secret(os.environ.get("JWT_SECRET"))
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 72
GUEST_USERNAME = os.environ.get("OMNIMUX_GUEST_USERNAME", "omnimux_guest")

# httpOnly cookie carrying the JWT, so <audio>/<img> media requests to the
# proxy authenticate without ever putting credentials in a URL.
TOKEN_COOKIE = "omnimux_token"
# Plain-HTTP installs still work; the cookie turns Secure on its own whenever
# the request arrived over TLS, or unconditionally via this override.
COOKIE_SECURE = os.environ.get("OMNIMUX_COOKIE_SECURE", "false").lower() == "true"


def _is_https(request: Request) -> bool:
    forwarded = request.headers.get("X-Forwarded-Proto", "").split(",")[0].strip().lower()
    return forwarded == "https" or request.url.scheme == "https"


def set_token_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        key=TOKEN_COOKIE,
        value=token,
        max_age=JWT_EXPIRY_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE or _is_https(request),
        path="/",
    )


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    role: str = "user"


class UserContext(BaseModel):
    username: str
    password: str
    role: str = "user"


def _build_fernet(secret: str) -> Fernet:
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"omnimux-token-credentials"
    ).derive(secret.encode())
    return Fernet(base64.urlsafe_b64encode(key))


_fernet = _build_fernet(JWT_SECRET)


def _create_token(username: str, password: str, role: str = "user") -> str:
    payload = {
        "sub": username,
        "pwd": _fernet.encrypt(password.encode()).decode(),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> UserContext:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return UserContext(
            username=payload["sub"],
            password=_fernet.decrypt(payload["pwd"].encode()).decode(),
            role=payload.get("role", "user"),
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except (jwt.InvalidTokenError, InvalidToken, KeyError):
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(request: Request) -> UserContext:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = auth_header.removeprefix("Bearer ")
    return _decode_token(token)


async def get_user_flexible(request: Request) -> UserContext:
    """Authenticate from a Bearer header (XHR) or the token cookie (media tags)."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return _decode_token(auth_header.removeprefix("Bearer "))
    cookie_token = request.cookies.get(TOKEN_COOKIE)
    if cookie_token:
        return _decode_token(cookie_token)
    raise HTTPException(status_code=401, detail="Missing authorization")


async def require_non_guest(user: UserContext = Depends(get_current_user)) -> UserContext:
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Guests cannot perform this action")
    return user


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request, response: Response):
    valid = await validate_credentials(body.username, body.password)
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _create_token(body.username, body.password)
    set_token_cookie(request, response, token)
    return LoginResponse(token=token, username=body.username, role="user")


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(TOKEN_COOKIE, path="/")
    return {"ok": True}
