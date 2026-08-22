"""URL validation at the trust boundary: only YouTube hosts may reach yt-dlp,
so a signed-in user can't use download/import endpoints to make the server
fetch internal addresses (SSRF)."""
import pytest

from services.youtube import validate_youtube_url


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "http://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/playlist?list=PL1234567890",
        "https://www.youtube.com/@artist/playlists",
        "https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
    ],
)
def test_accepts_youtube_urls(url):
    assert validate_youtube_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8800/api/downloads",
        "http://127.0.0.1/x",
        "https://example.com/watch?v=x",
        "file:///etc/passwd",
        "ftp://youtube.com/video",
        "javascript:alert(1)",
        "https://youtube.com@evil.com/watch",
        "https://youtube.com.evil.com/watch",
        "https://youtube.com:8080/watch?v=x",
        "",
        "   ",
        "not a url",
    ],
)
def test_rejects_non_youtube_urls(url):
    with pytest.raises(ValueError):
        validate_youtube_url(url)


def test_rejects_userinfo_in_url():
    with pytest.raises(ValueError):
        validate_youtube_url("https://user:pass@www.youtube.com/watch?v=x")
