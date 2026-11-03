import json
import stat

import pytest

from services.mood import analyze_mood

RESULT = {"mood": "Techno/Dark", "energy": 0.76, "tempo": 129.2, "key": "G# minor"}


@pytest.fixture
def fake_mood(tmp_path, monkeypatch):
    def install(script: str):
        path = tmp_path / "mood"
        path.write_text("#!/bin/sh\n" + script)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        monkeypatch.setenv("MOOD_BIN", str(path))
        return path

    return install


async def test_returns_parsed_analysis(fake_mood):
    fake_mood(f"echo '{json.dumps(RESULT)}'")

    assert await analyze_mood("/music/a.opus") == RESULT


async def test_passes_the_file_straight_through_without_transcoding(fake_mood, tmp_path):
    argv_log = tmp_path / "argv"
    fake_mood(f'echo "$@" > {argv_log}\necho \'{json.dumps(RESULT)}\'')

    await analyze_mood("/music/a b.opus")

    assert argv_log.read_text().strip() == "analyze --json /music/a b.opus"


async def test_returns_none_when_binary_fails(fake_mood):
    fake_mood('echo \'{"error":"boom"}\'\nexit 1')

    assert await analyze_mood("/music/a.opus") is None


async def test_returns_none_when_binary_is_missing(monkeypatch):
    monkeypatch.setenv("MOOD_BIN", "/nonexistent/mood")

    assert await analyze_mood("/music/a.opus") is None


async def test_returns_none_on_garbage_output(fake_mood):
    fake_mood("echo not-json")

    assert await analyze_mood("/music/a.opus") is None


async def test_returns_none_when_output_has_no_mood(fake_mood):
    fake_mood("echo '{}'")

    assert await analyze_mood("/music/a.opus") is None
