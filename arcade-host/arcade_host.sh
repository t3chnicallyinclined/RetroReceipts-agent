#!/usr/bin/env bash
# arcade_host.sh {host|create|spectate|leave|cycle|status}
# Hands-free MvC2 FC referee-host for the quarter-match arcade.
# Drives the game's OWN menus via ydotool with a FOCUS GUARD (wmctrl raises the game's
# XWayland window before every key, so it works even if the browser/PWA steals focus).
# Reads the lobby via the injector. Emits ONE JSON line with the join link.
#   host     = create a Custom Match lobby then drop to SPECTATE (both player slots free) -- THE arcade action
#   create   = create only (stay as player 1)
#   spectate = toggle Play<->Spectate (LeftCtrl) in the current lobby
#   leave    = leave the lobby back to the anchor (Online Play / Custom Match)
#   cycle    = leave -> create -> spectate (fresh referee lobby for the next quarter)
#   status   = read current lobby
set -u
# Auto-detect the MvC Fighting Collection game dir across common Steam layouts.
# Override with $MVC_GAME_DIR (or $GD) if your library is elsewhere.
_detect_gd(){ local g="MARVEL vs. CAPCOM Fighting Collection" b;
  [ -n "${MVC_GAME_DIR:-}" ] && { printf '%s' "$MVC_GAME_DIR"; return; }
  for b in "$HOME/.local/share/Steam/steamapps/common" "$HOME/.steam/steam/steamapps/common" \
           "$HOME/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/common" \
           "/var/home/$USER/.local/share/Steam/steamapps/common"; do
    [ -d "$b/$g" ] && { printf '%s' "$b/$g"; return; }; done; }
GD="${GD:-$(_detect_gd)}"
PID=$(pgrep -xo plasmashell)
while IFS= read -r -d '' line; do case "$line" in DISPLAY=*|WAYLAND_DISPLAY=*|XDG_RUNTIME_DIR=*|DBUS_SESSION_BUS_ADDRESS=*|XAUTHORITY=*) export "$line";; esac; done < /proc/$PID/environ 2>/dev/null
export YDOTOOL_SOCKET=/tmp/.ydotool_socket
UP=103; DOWN=108; ENTER=28; BACK=14; SPEC=29
focus(){ wmctrl -a "MARVEL vs. CAPCOM" 2>/dev/null; sleep 0.35; }
tap(){ focus; ydotool key "$1:1" >/dev/null 2>&1; sleep 0.03; ydotool key "$1:0" >/dev/null 2>&1; sleep 0.30; }
rl(){ printf 'read_lobby' > "$GD/nobd_arcade.cmd"; sleep 1.0; cat "$GD/nobd_arcade.result" 2>/dev/null; }
lobid(){ rl | grep -oE '"lobby_id":"[0-9]+"' | grep -oE '[0-9]+' | head -1; }

do_create(){ tap $ENTER; sleep 0.7; tap $ENTER; sleep 0.7; tap $ENTER
  local r id; for i in $(seq 15); do sleep 1; r=$(rl)
    id=$(echo "$r"|grep -oE '"lobby_id":"[0-9]+"'|grep -oE '[0-9]+'|head -1)
    [ -n "$id" ] && [ "$id" != "0" ] && { echo "$r"; return 0; }; done; echo "$(rl)"; return 1; }
# Full COLD BOOT: from the title screen "PRESS ENTER TO START" all the way to a created lobby.
# Deterministic: cold boot always defaults the main-menu cursor to Offline Play(top), submenus open at top.
do_boot(){ tap $ENTER; sleep 9                       # title -> loading -> main menu (Offline Play, top)
  tap $DOWN; tap $ENTER; sleep 0.9                   # Offline -> Online, Enter -> Online Play (Casual top)
  tap $DOWN; tap $DOWN; tap $ENTER; sleep 0.9        # -> Custom Match, Enter -> popup (Create Lobby top)
  tap $ENTER; sleep 0.9                              # popup -> Create Lobby settings (Game top)
  tap $ENTER                                         # CREATE
  local r id; for i in $(seq 18); do sleep 1; r=$(rl)
    id=$(echo "$r"|grep -oE '"lobby_id":"[0-9]+"'|grep -oE '[0-9]+'|head -1)
    [ -n "$id" ] && [ "$id" != "0" ] && { echo "$r"; return 0; }; done; echo "$(rl)"; return 1; }
do_spectate(){ tap $SPEC; sleep 0.8; }
do_leave(){ local cur; cur=$(lobid); { [ -z "$cur" ] || [ "$cur" = "0" ]; } && return 0
  tap $BACK; sleep 0.6; tap $UP; sleep 0.2; tap $ENTER; sleep 5; }
emit(){ local j="$2" id owner join
  id=$(echo "$j"|grep -oE '"lobby_id":"[0-9]+"'|grep -oE '[0-9]+'|head -1)
  owner=$(echo "$j"|grep -oE '"owner":"[0-9]+"'|grep -oE '[0-9]+'|head -1)
  join=$(echo "$j"|grep -oE 'steam://joinlobby/[0-9/]+'|head -1)
  if [ -n "$id" ] && [ "$id" != "0" ]; then echo "{\"ok\":true,\"action\":\"$1\",\"lobby_id\":\"$id\",\"owner\":\"$owner\",\"join\":\"$join\"}"
  else echo "{\"ok\":false,\"action\":\"$1\",\"lobby_id\":\"0\"}"; fi; }

case "${1:-status}" in
  boot)     do_boot >/dev/null; do_spectate; emit boot "$(rl)";;       # from the title screen -> hosting + spectating (cold start)
  host)     do_create >/dev/null; do_spectate; emit host "$(rl)";;     # create + spectate, THEN link is ready to publish
  create)   r=$(do_create); emit create "$r";;
  spectate) do_spectate; emit spectate "$(rl)";;
  leave)    do_leave; emit leave "$(rl)";;
  cycle)    do_leave; do_create >/dev/null; do_spectate; emit cycle "$(rl)";;
  status)   emit status "$(rl)";;
  *) echo "{\"ok\":false,\"error\":\"usage: {host|create|spectate|leave|cycle|status}\"}";;
esac
