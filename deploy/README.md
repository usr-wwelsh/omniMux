# Auto-update (opt-in)

omniMux's web UI can show an "update available" banner with a one-line
changelog, and a button that pulls + rebuilds on your host. This is **off by
default** — without the pieces below installed, the banner never appears and
nothing about your deployment changes.

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

1. Copy the unit and env file:

   ```bash
   sudo cp deploy/omnimux-updater.service /etc/systemd/system/
   sudo mkdir -p /etc/omnimux
   sudo cp deploy/updater.env.example /etc/omnimux/updater.env
   sudo chmod 600 /etc/omnimux/updater.env
   ```

2. Edit `/etc/omnimux/updater.env`:
   - `OMNIMUX_REPO_DIR` — absolute path to your omniMux checkout.
   - `OMNIMUX_UPDATER_TOKEN` — generate with `openssl rand -hex 32`.

3. Edit `/etc/systemd/system/omnimux-updater.service`:
   - `User=` — a user that owns the checkout and is in the `docker` group.
   - `WorkingDirectory=` / the path in `ExecStart=` — match your checkout location.

4. In `docker-compose.yml`, set `UPDATER_TOKEN` on `omnimux-api` to the same
   value as `OMNIMUX_UPDATER_TOKEN` above, and confirm the socket volume mount
   is uncommented (see the comment in `docker-compose.yml`).

5. Enable and start:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now omnimux-updater
   sudo systemctl status omnimux-updater
   ```

6. `docker compose up -d` to pick up the new mount. The update banner will
   appear in the web UI once a new commit lands on your tracked branch.

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
```

Then remove the socket volume from `docker-compose.yml` and re-run `docker
compose up -d`. The web UI falls back to hiding the update banner entirely.
