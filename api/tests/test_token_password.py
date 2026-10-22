import jwt
import pytest
from fastapi import HTTPException

from routers import auth


def test_token_payload_does_not_expose_password():
    token = auth._create_token("alice", "hunter2")

    payload = jwt.decode(token, options={"verify_signature": False})

    assert "hunter2" not in str(payload)
    assert "hunter2" not in token


def test_token_roundtrips_credentials():
    token = auth._create_token("alice", "hunter2", role="guest")

    user = auth._decode_token(token)

    assert (user.username, user.password, user.role) == ("alice", "hunter2", "guest")


def test_token_encrypted_under_other_secret_is_rejected(monkeypatch):
    token = auth._create_token("alice", "hunter2")
    monkeypatch.setattr(auth, "JWT_SECRET", "a-different-secret-entirely-32-bytes!!")
    monkeypatch.setattr(auth, "_fernet", auth._build_fernet(auth.JWT_SECRET))

    with pytest.raises(HTTPException) as exc:
        auth._decode_token(token)

    assert exc.value.status_code == 401
