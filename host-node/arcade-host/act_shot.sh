#!/usr/bin/env bash
# usage: act_shot.sh <keycode> [keycode ...]   -- FOCUS the game, tap each (25ms), then screenshot.
PID=$(pgrep -xo plasmashell)
while IFS= read -r -d '' line; do case "$line" in DISPLAY=*|WAYLAND_DISPLAY=*|XDG_RUNTIME_DIR=*|DBUS_SESSION_BUS_ADDRESS=*|XAUTHORITY=*) export "$line";; esac; done < /proc/$PID/environ
export YDOTOOL_SOCKET=/tmp/.ydotool_socket
wmctrl -a "MARVEL vs. CAPCOM" 2>/dev/null; sleep 0.4   # FOCUS GUARD (game is XWayland; wmctrl raises it)
for k in "$@"; do ydotool key "$k:1" >/dev/null 2>&1; sleep 0.03; ydotool key "$k:0" >/dev/null 2>&1; sleep 0.28; done
sleep 0.6
out=/tmp/mvc_shot.png; rm -f "$out"
spectacle -b -n -f -o "$out" >/dev/null 2>&1; sleep 1
[ -s "$out" ] && echo "SHOT_OK $(stat -c%s "$out")" || echo "NO_SHOT"
