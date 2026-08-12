# Auto-update (opt-in)

omniMux's web UI can show an "update available" banner with a one-line
changelog, and a button that pulls + rebuilds on your host. This is **off by
default**, in two independent ways:

- **Host capability** — nothing below is installed until you run it. Without
  it, the api container can't reach an updater and the banner never appears,
  no matter what.
- **In-app switch** — once installed, whether the banner actually shows is a
  toggle in Settings → Updates (off by default there too), so it's a
  deliberate choice on both sides, not just infrastructure that happens to
  exist.

## Why a separate host service

Applying an update means running `git pull` and `docker compose up -d
--build` on the host. The `omnimux-api` container can't do that itself
without either mounting `/var/run/docker.sock` into it (root-equivalent
access to your whole host from a container that also parses YouTube search
results) or a docker-socket-proxy sidecar. Instead, `omnimux_updater.py` runs
directly on the host as its own systemd service, and the api container talks
to it over a Unix socket that can only do two things: report the changelog,
and trigger an update. No docker API access, no host shell, ever reaches the
container.

## Install

```bash
sudo ./deploy/install.sh
docker compose up -d
```

That generates a token, writes `/etc/omnimux/updater.env` and
`/etc/systemd/system/omnimux-updater.service`, drops a
`docker-compose.override.yml` next to `docker-compose.yml` with the token and
socket mount filled in (Compose merges override files automatically — the
tracked `docker-compose.yml` is never touched), and starts the service.
`docker-compose.override.yml` is gitignored since it holds the token.

Then flip **Settings → Updates → Show update banner** on in the web UI — the
install script only grants the *capability*; the banner itself stays off
until that switch is on.

Re-running `install.sh` is safe — it reuses the existing token and env file
instead of generating a new one.

### Manual install

If you'd rather not run a script as root, do the same four things by hand:
copy `deploy/omnimux-updater.service` to `/etc/systemd/system/`, copy
`deploy/updater.env.example` to `/etc/omnimux/updater.env` (mode 600) and fill
in `OMNIMUX_REPO_DIR` / a token from `openssl rand -hex 32`, edit `User=` /
`WorkingDirectory=` / `ExecStart=` in the unit file to match your checkout,
then copy `deploy/docker-compose.override.yml.example` to
`docker-compose.override.yml` in the repo root with the same token. Finish
with `sudo systemctl daemon-reload && sudo systemctl enable --now
omnimux-updater`.

## Updating the updater itself

`omnimux_updater.py` runs as a plain systemd service on the host, outside
docker compose, so it isn't restarted by the update it triggers. If a future
release changes this file, `sudo systemctl restart omnimux-updater` after
pulling picks up the change.

## Uninstall

```bash
sudo systemctl disable --now omnimux-updater
sudo rm /etc/systemd/system/omnimux-updater.service /etc/omnimux/updater.env
sudo systemctl daemon-reload
rm docker-compose.override.yml
```

Then re-run `docker compose up -d`. The web UI falls back to hiding the
update banner entirely, whatever the Settings toggle says.
