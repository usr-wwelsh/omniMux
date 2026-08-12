#!/usr/bin/env bash
# Installs the opt-in host-side auto-update helper: generates a token, wires
# up the systemd service, and drops a docker-compose.override.yml next to
# docker-compose.yml so `docker compose up -d` picks up the socket mount
# without you hand-editing the tracked compose file. See deploy/README.md
# for what this does and why, and for how to undo it.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo ./deploy/install.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_AS_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
ENV_FILE=/etc/omnimux/updater.env
UNIT_FILE=/etc/systemd/system/omnimux-updater.service

if [[ ! -f "$REPO_DIR/docker-compose.yml" ]]; then
  echo "Couldn't find docker-compose.yml under $REPO_DIR — run this from an omniMux checkout." >&2
  exit 1
fi

if ! id -nG "$RUN_AS_USER" | grep -qw docker; then
  echo "Warning: $RUN_AS_USER is not in the 'docker' group — docker compose up will fail when the updater runs." >&2
  echo "Fix with: sudo usermod -aG docker $RUN_AS_USER (then log back in)" >&2
fi

mkdir -p /etc/omnimux

if [[ -f "$ENV_FILE" ]]; then
  echo "Reusing existing token in $ENV_FILE"
  TOKEN="$(grep -oP '(?<=^OMNIMUX_UPDATER_TOKEN=).*' "$ENV_FILE")"
else
  TOKEN="$(openssl rand -hex 32)"
  install -m 600 /dev/null "$ENV_FILE"
  {
    echo "OMNIMUX_REPO_DIR=$REPO_DIR"
    echo "OMNIMUX_UPDATER_SOCKET=/run/omnimux-updater/updater.sock"
    echo "OMNIMUX_UPDATER_TOKEN=$TOKEN"
  } > "$ENV_FILE"
  echo "Wrote $ENV_FILE (mode 600)"
fi

sed \
  -e "s#^User=.*#User=$RUN_AS_USER#" \
  -e "s#^WorkingDirectory=.*#WorkingDirectory=$REPO_DIR#" \
  -e "s#^ExecStart=.*#ExecStart=/usr/bin/python3 $REPO_DIR/deploy/omnimux_updater.py#" \
  "$SCRIPT_DIR/omnimux-updater.service" > "$UNIT_FILE"
echo "Wrote $UNIT_FILE"

OVERRIDE_FILE="$REPO_DIR/docker-compose.override.yml"
if [[ -f "$OVERRIDE_FILE" ]]; then
  echo "Leaving existing $OVERRIDE_FILE alone — merge the UPDATER_TOKEN from $ENV_FILE into it by hand if needed."
else
  sed "s#change-me#$TOKEN#" "$SCRIPT_DIR/docker-compose.override.yml.example" > "$OVERRIDE_FILE"
  chown "$RUN_AS_USER" "$OVERRIDE_FILE"
  echo "Wrote $OVERRIDE_FILE"
fi

systemctl daemon-reload
systemctl enable --now omnimux-updater
echo
echo "omnimux-updater is running. Last step: docker compose up -d"
