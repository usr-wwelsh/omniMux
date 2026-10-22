import pytest

from routers.auth import load_jwt_secret


@pytest.mark.parametrize("raw", [None, "", "   ", "change-me-in-production", "omnimux-dev-secret"])
def test_missing_or_placeholder_secret_is_refused(raw):
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        load_jwt_secret(raw)


def test_real_secret_is_accepted():
    assert load_jwt_secret("0f3a" * 16) == "0f3a" * 16
