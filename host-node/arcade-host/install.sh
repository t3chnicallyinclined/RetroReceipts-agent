#!/usr/bin/env bash
# Retro Receipts — arcade host-node installer (Linux). Idempotent.
# Copies the host-driver scripts to a canonical per-user location + installs the
# systemd --user unit. The tray's "Host this machine" toggle then just calls:
#   arcade_hostd.sh register | unregister | status
# Requires at runtime: ydotool (+ ydotoold running on /dev/uinput) and wmctrl.
set -eu

DEST="$HOME/.local/share/retro-receipts/arcade-host"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$DEST"
cp -f "$SRC/arcade_host.sh" "$SRC/arcade_hostd.sh" "$SRC/act_shot.sh" "$DEST/"
chmod +x "$DEST"/*.sh

mkdir -p "$HOME/.config/systemd/user"
cp -f "$SRC/arcade-hostd.service" "$HOME/.config/systemd/user/arcade-hostd.service"
systemctl --user daemon-reload 2>/dev/null || true

# runtime dependency check (warn, don't fail the install)
miss=0
for d in ydotool wmctrl; do command -v "$d" >/dev/null 2>&1 || { echo "[install] WARNING: '$d' not found — the host menu-automation needs it"; miss=1; }; done
pgrep -x ydotoold >/dev/null 2>&1 || echo "[install] NOTE: ydotoold not running — start it (needs access to /dev/uinput) before hosting"

echo "[install] installed to $DEST"
echo "[install] enable hosting:  bash \"$DEST/arcade_hostd.sh\" register   (or use the tray 'Host this machine' toggle)"
[ "$miss" = 0 ] && echo "[install] deps OK" || echo "[install] install missing deps, then run 'register'"
# For an always-on headless host that survives logout: loginctl enable-linger "$USER"  (may require sudo/polkit)
