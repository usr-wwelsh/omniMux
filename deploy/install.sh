#!/usr/bin/env bash
# Installs the opt-in host-side auto-update helper: generates a token, wires
# up the systemd service, and sets UPDATER_TOKEN in the repo's .env (creating
# it from .env.example if it doesn't exist yet). Everything else already in
# .env — JWT_SECRET, anything else you've set — is left untouched. See
# deploy/README.md for what this does and why, and for how to undo it.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Needs root: sudo ./deploy/install.sh (or run this as root directly)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_AS_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
HOST_ENV_FILE=/etc/omnimux/updater.env
UNIT_FILE=/etc/systemd/system/omnimux-updater.service
REPO_ENV_FILE="$REPO_DIR/.env"

if [[ ! -f "$REPO_DIR/docker-compose.yml" ]]; then
  echo "Couldn't find docker-compose.yml under $REPO_DIR — run this from an omniMux checkout." >&2
  exit 1
fi

# root always has docker socket access regardless of group membership —
# this only matters for a non-root RUN_AS_USER.
if [[ "$(id -u "$RUN_AS_USER")" -ne 0 ]] && ! id -nG "$RUN_AS_USER" | grep -qw docker; then
  echo "Warning: $RUN_AS_USER is not in the 'docker' group — docker compose up will fail when the updater runs." >&2
  echo "Fix with: usermod -aG docker $RUN_AS_USER (then log back in)" >&2
fi

# Sets KEY=VALUE in FILE, replacing an existing line for KEY if present and
# leaving every other line untouched — used on the repo's .env so this never
# clobbers JWT_SECRET or anything else already set there.
set_env_var() {
  local file="$1" key="$2" value="$3"
  if [[ -f "$file" ]] && grep -q "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

if [[ -f "$HOST_ENV_FILE" ]] && grep -q '^OMNIMUX_UPDATER_TOKEN=' "$HOST_ENV_FILE"; then
  TOKEN="$(grep -oP '(?<=^OMNIMUX_UPDATER_TOKEN=).*' "$HOST_ENV_FILE")"
  echo "Reusing existing token from $HOST_ENV_FILE"
else
  TOKEN="$(openssl rand -hex 32)"
fi

mkdir -p /etc/omnimux
{
  echo "OMNIMUX_REPO_DIR=$REPO_DIR"
  echo "OMNIMUX_UPDATER_SOCKET=/run/omnimux-updater/updater.sock"
  echo "OMNIMUX_UPDATER_TOKEN=$TOKEN"
} > "$HOST_ENV_FILE"
chmod 600 "$HOST_ENV_FILE"
echo "Wrote $HOST_ENV_FILE"

sed \
  -e "s#^User=.*#User=$RUN_AS_USER#" \
  -e "s#^WorkingDirectory=.*#WorkingDirectory=$REPO_DIR#" \
  -e "s#^ExecStart=.*#ExecStart=/usr/bin/python3 $REPO_DIR/deploy/omnimux_updater.py#" \
  "$SCRIPT_DIR/omnimux-updater.service" > "$UNIT_FILE"
echo "Wrote $UNIT_FILE"

if [[ ! -f "$REPO_ENV_FILE" ]]; then
  cp "$REPO_DIR/.env.example" "$REPO_ENV_FILE"
  echo "Created $REPO_ENV_FILE from .env.example — edit JWT_SECRET in it before going further"
fi
set_env_var "$REPO_ENV_FILE" "UPDATER_TOKEN" "$TOKEN"
chown "$RUN_AS_USER" "$REPO_ENV_FILE"
chmod 600 "$REPO_ENV_FILE"
echo "Set UPDATER_TOKEN in $REPO_ENV_FILE (left everything else in that file alone)"

systemctl daemon-reload
systemctl enable --now omnimux-updater
echo
echo "omnimux-updater is running. Last step: docker compose up -d"
