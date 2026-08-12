#!/usr/bin/env python3
"""Opt-in host-side updater for omniMux.

Runs directly on the host (outside Docker) as a systemd service, listening on
a Unix domain socket. The omnimux-api container talks to it over that socket
to check for and apply updates — this keeps the docker socket, and therefore
root-equivalent host access, out of every container. See deploy/README.md.

Stdlib only: this has to run with whatever python3 is already on the host,
with no venv or pip install step.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import socketserver
import subprocess
import threading
from collections import namedtuple
from http.server import BaseHTTPRequestHandler
from pathlib import Path

CommandResult = namedtuple("CommandResult", "returncode stdout stderr")

# Records are hash\x1fsubject so a subject containing "#" or punctuation can
# never be mistaken for the delimiter.
_LOG_FORMAT = "%h\x1f%s"


def parse_commit_log(raw: str) -> list[dict]:
    commits = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        commit_hash, _, subject = line.partition("\x1f")
        commits.append({"hash": commit_hash, "subject": subject})
    return commits


def _default_run_cmd(args: list[str], cwd: str | None = None, timeout: int = 600) -> CommandResult:
    proc = subprocess.run(args, cwd=cwd, timeout=timeout, capture_output=True, text=True)
    return CommandResult(proc.returncode, proc.stdout, proc.stderr)


class UpdaterService:
    def __init__(self, repo_dir: Path, compose_file: Path, token: str, run_cmd=None):
        self.repo_dir = Path(repo_dir)
        self.compose_file = Path(compose_file)
        self.token = token
        self._run_cmd = run_cmd or _default_run_cmd

        self._lock = threading.Lock()
        self._phase = "idle"
        self._percent = 0
        self._log_tail = ""
        self._error: str | None = None

    # -- git helpers --

    def _git(self, *args: str, timeout: int = 60) -> CommandResult:
        return self._run_cmd(["git", "-C", str(self.repo_dir), *args], cwd=str(self.repo_dir), timeout=timeout)

    # -- status --

    def get_status(self) -> dict:
        fetch = self._git("fetch", "--quiet")
        if fetch.returncode != 0:
            return self._status_error(f"git fetch failed: {fetch.stderr.strip()}")

        head = self._git("rev-parse", "HEAD")
        if head.returncode != 0:
            return self._status_error(f"git rev-parse HEAD failed: {head.stderr.strip()}")

        upstream = self._git("rev-parse", "@{u}")
        if upstream.returncode != 0:
            return self._status_error("no upstream branch configured")

        current = head.stdout.strip()
        latest = upstream.stdout.strip()

        if current == latest:
            return {
                "available": True,
                "current": current[:7],
                "latest": latest[:7],
                "up_to_date": True,
                "commits": [],
                "error": None,
            }

        log = self._git("log", f"--format={_LOG_FORMAT}", f"{current}..{latest}")
        commits = parse_commit_log(log.stdout) if log.returncode == 0 else []

        return {
            "available": True,
            "current": current[:7],
            "latest": latest[:7],
            "up_to_date": False,
            "commits": commits,
            "error": None,
        }

    @staticmethod
    def _status_error(message: str) -> dict:
        return {
            "available": True,
            "current": None,
            "latest": None,
            "up_to_date": None,
            "commits": [],
            "error": message,
        }

    # -- progress --

    def get_progress(self) -> dict:
        with self._lock:
            return {
                "phase": self._phase,
                "percent": self._percent,
                "log_tail": self._log_tail,
                "error": self._error,
            }

    def _set(self, phase: str, percent: int, log_tail: str = "") -> None:
        with self._lock:
            self._phase = phase
            self._percent = percent
            if log_tail:
                self._log_tail = log_tail

    def _fail(self, message: str) -> None:
        logging.error("update failed: %s", message)
        with self._lock:
            self._phase = "error"
            self._error = message

    # -- apply --

    def apply_update(self) -> dict:
        with self._lock:
            if self._phase not in ("idle", "done", "error"):
                return {"accepted": False, "reason": "update already in progress"}
            self._phase = "starting"
            self._percent = 0
            self._error = None

        thread = threading.Thread(target=self._run_update, daemon=True)
        thread.start()
        return {"accepted": True}

    def _run_update(self) -> None:
        self._set("fetching", 10)
        fetch = self._git("fetch", "--quiet")
        if fetch.returncode != 0:
            return self._fail(f"git fetch failed: {fetch.stderr.strip()}")

        self._set("pulling", 30)
        merge = self._git("merge", "--ff-only", "@{u}")
        if merge.returncode != 0:
            return self._fail(f"git merge --ff-only failed: {merge.stderr.strip()}")

        self._set("building", 50)
        build = self._run_cmd(
            ["docker", "compose", "-f", str(self.compose_file), "up", "-d", "--build"],
            cwd=str(self.repo_dir),
            timeout=1800,
        )
        if build.returncode != 0:
            return self._fail(f"docker compose up failed: {build.stderr.strip()[-2000:]}")

        self._set("done", 100, log_tail=build.stdout.strip()[-2000:])
        logging.info("update applied successfully")


class _Handler(BaseHTTPRequestHandler):
    service: UpdaterService = None  # bound per-server by build_server()

    def address_string(self) -> str:
        return "unix"

    def log_message(self, fmt: str, *args) -> None:
        logging.info("%s - %s", self.address_string(), fmt % args)

    def _authorized(self) -> bool:
        got = self.headers.get("X-Updater-Token", "")
        return hmac.compare_digest(got, self.service.token)

    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if not self._authorized():
            return self._write_json(401, {"error": "unauthorized"})
        if self.path == "/status":
            return self._write_json(200, self.service.get_status())
        if self.path == "/progress":
            return self._write_json(200, self.service.get_progress())
        self._write_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self._authorized():
            return self._write_json(401, {"error": "unauthorized"})
        if self.path == "/apply":
            result = self.service.apply_update()
            status = 202 if result.get("accepted") else 409
            return self._write_json(status, result)
        self._write_json(404, {"error": "not found"})


class ThreadingUnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def build_server(service: UpdaterService, socket_path: str) -> ThreadingUnixHTTPServer:
    socket_dir = os.path.dirname(socket_path)
    if socket_dir:
        os.makedirs(socket_dir, exist_ok=True)
    if os.path.exists(socket_path):
        os.remove(socket_path)

    handler = type("BoundHandler", (_Handler,), {"service": service})
    server = ThreadingUnixHTTPServer(socket_path, handler)
    # Gated by the bearer token, not filesystem perms: the container's uid
    # rarely lines up with the host's, and this socket only ever exposes the
    # two operations above — never the raw docker API.
    os.chmod(socket_path, 0o666)
    return server


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s omnimux-updater %(message)s")

    repo_dir = Path(os.environ.get("OMNIMUX_REPO_DIR", Path(__file__).resolve().parent.parent))
    socket_path = os.environ.get("OMNIMUX_UPDATER_SOCKET", "/run/omnimux-updater/updater.sock")
    token = os.environ.get("OMNIMUX_UPDATER_TOKEN")
    if not token:
        raise SystemExit("OMNIMUX_UPDATER_TOKEN must be set — refusing to start unauthenticated")

    compose_file = repo_dir / "docker-compose.yml"
    service = UpdaterService(repo_dir=repo_dir, compose_file=compose_file, token=token)
    server = build_server(service, socket_path)

    logging.info("listening on %s (repo=%s)", socket_path, repo_dir)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if os.path.exists(socket_path):
            os.remove(socket_path)


if __name__ == "__main__":
    main()
