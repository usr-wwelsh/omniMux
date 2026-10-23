import base64
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

PREFIX = "enc:"


@lru_cache
def _fernet() -> Fernet:
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"omnimux-stored-credentials"
    ).derive(os.environ["JWT_SECRET"].encode())
    return Fernet(base64.urlsafe_b64encode(key))


def is_encrypted(value: str) -> bool:
    return value.startswith(PREFIX)


def encrypt(value: str) -> str:
    return PREFIX + _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str | None:
    if not is_encrypted(value):
        return value
    try:
        return _fernet().decrypt(value.removeprefix(PREFIX).encode()).decode()
    except InvalidToken:
        return None
