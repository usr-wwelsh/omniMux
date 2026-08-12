"""Tests for the host-side updater daemon's business logic.

Runs with plain `pytest` from the deploy/ directory — no docker, no git repo,
no sockets. The HTTP transport layer is thin stdlib glue and isn't covered
here; everything that can go wrong lives in parse_commit_log and
UpdaterService's phase state machine, so that's what's tested.
"""
from pathlib import Path

import pytest

from omnimux_updater import CommandResult, UpdaterService, parse_commit_log


def test_parse_commit_log_empty_string_returns_no_commits():
    assert parse_commit_log("") == []


def test_parse_commit_log_splits_hash_and_subject():
    raw = "abc1234\x1fFix crash on empty playlist\ndef5678\x1fAdd changelog banner\n"
    assert parse_commit_log(raw) == [
        {"hash": "abc1234", "subject": "Fix crash on empty playlist"},
        {"hash": "def5678", "subject": "Add changelog banner"},
    ]


def test_parse_commit_log_skips_blank_lines():
    raw = "abc1234\x1fFix bug\n\n\ndef5678\x1fSecond commit\n"
    assert parse_commit_log(raw) == [
        {"hash": "abc1234", "subject": "Fix bug"},
        {"hash": "def5678", "subject": "Second commit"},
    ]


def test_parse_commit_log_preserves_delimiters_within_subject():
    raw = "abc1234\x1ffix: don't crash (issue #12)\n"
    assert parse_commit_log(raw) == [
        {"hash": "abc1234", "subject": "fix: don't crash (issue #12)"},
    ]


class FakeGit:
    """Stand-in for subprocess.run, keyed by the git subcommand."""

    def __init__(self, responses: dict[str, CommandResult]):
        self.responses = responses
        self.calls: list[list[str]] = []

    def __call__(self, args, cwd=None, timeout=None) -> CommandResult:
        self.calls.append(args)
        key = args[3] if len(args) > 3 else args[0]  # args[0:3] == ["git", "-C", repo]
        if key not in self.responses:
            raise AssertionError(f"unexpected command: {args}")
        return self.responses[key]


def make_service(run_cmd) -> UpdaterService:
    return UpdaterService(
        repo_dir=Path("/repo"),
        compose_file=Path("/repo/docker-compose.yml"),
        token="secret-token",
        run_cmd=run_cmd,
    )


def test_get_status_reports_up_to_date_when_head_matches_upstream():
    git = FakeGit({
        "fetch": CommandResult(0, "", ""),
        "rev-parse": CommandResult(0, "abc123\n", ""),
    })
    service = make_service(git)

    status = service.get_status()

    assert status == {
        "available": True,
        "current": "abc123",
        "latest": "abc123",
        "up_to_date": True,
        "commits": [],
        "error": None,
    }


def test_get_status_reports_pending_commits_when_behind():
    responses = {
        "fetch": CommandResult(0, "", ""),
        "log": CommandResult(0, "abc1234\x1fFix crash\ndef5678\x1fAdd feature\n", ""),
    }
    call_count = {"rev-parse": 0}

    def run_cmd(args, cwd=None, timeout=None):
        if args[3] == "rev-parse":
            call_count["rev-parse"] += 1
            # First call is HEAD, second is @{u}
            return CommandResult(0, "aaa0000\n" if call_count["rev-parse"] == 1 else "bbb1111\n", "")
        return responses[args[3]]

    service = make_service(run_cmd)
    status = service.get_status()

    assert status["up_to_date"] is False
    assert status["current"] == "aaa0000"
    assert status["latest"] == "bbb1111"
    assert status["commits"] == [
        {"hash": "abc1234", "subject": "Fix crash"},
        {"hash": "def5678", "subject": "Add feature"},
    ]
    assert status["error"] is None


def test_get_status_surfaces_fetch_failure_without_crashing():
    git = FakeGit({"fetch": CommandResult(1, "", "unable to access remote")})
    service = make_service(git)

    status = service.get_status()

    assert status["available"] is True
    assert status["error"] == "git fetch failed: unable to access remote"


def test_get_status_surfaces_missing_upstream():
    def run_cmd(args, cwd=None, timeout=None):
        if args[3] == "fetch":
            return CommandResult(0, "", "")
        if args[4] == "HEAD":
            return CommandResult(0, "aaa0000\n", "")
        return CommandResult(128, "", "no upstream configured")

    service = make_service(run_cmd)
    status = service.get_status()

    assert status["error"] == "no upstream branch configured"


def test_apply_update_rejects_concurrent_calls():
    service = make_service(lambda args, cwd=None, timeout=None: CommandResult(0, "", ""))
    service._phase = "building"  # simulate an update already in flight

    result = service.apply_update()

    assert result == {"accepted": False, "reason": "update already in progress"}


def test_run_update_success_walks_phases_to_done():
    git_calls = []

    def run_cmd(args, cwd=None, timeout=None):
        git_calls.append(args)
        return CommandResult(0, "ok", "")

    service = make_service(run_cmd)
    service._run_update()

    progress = service.get_progress()
    assert progress["phase"] == "done"
    assert progress["percent"] == 100
    assert progress["error"] is None
    # fetch, merge --ff-only, then docker compose
    assert any(a[:2] == ["git", "-C"] and "fetch" in a for a in git_calls)
    assert any(a[:2] == ["git", "-C"] and "merge" in a for a in git_calls)
    assert any(a[0] == "docker" for a in git_calls)


def test_run_update_stops_on_fetch_failure():
    def run_cmd(args, cwd=None, timeout=None):
        if "fetch" in args:
            return CommandResult(1, "", "network unreachable")
        raise AssertionError(f"should not run past fetch failure: {args}")

    service = make_service(run_cmd)
    service._run_update()

    progress = service.get_progress()
    assert progress["phase"] == "error"
    assert "network unreachable" in progress["error"]


def test_run_update_refuses_non_fast_forward_merge():
    def run_cmd(args, cwd=None, timeout=None):
        if "fetch" in args:
            return CommandResult(0, "", "")
        if "merge" in args:
            return CommandResult(1, "", "Not possible to fast-forward")
        raise AssertionError(f"should not reach docker build: {args}")

    service = make_service(run_cmd)
    service._run_update()

    progress = service.get_progress()
    assert progress["phase"] == "error"
    assert "fast-forward" in progress["error"].lower()


def test_run_update_stops_on_docker_build_failure():
    def run_cmd(args, cwd=None, timeout=None):
        if "fetch" in args or "merge" in args:
            return CommandResult(0, "", "")
        if args[0] == "docker":
            return CommandResult(1, "", "build failed: no space left on device")
        raise AssertionError(args)

    service = make_service(run_cmd)
    service._run_update()

    progress = service.get_progress()
    assert progress["phase"] == "error"
    assert "no space left on device" in progress["error"]
