#!/usr/bin/env bash
# arcade_host.sh {host|create|spectate|leave|cycle|status} [FT]
# Hands-free MvC2 FC referee-host for the money-match / tournament arcade.
# Drives the game's OWN menus via ydotool with a FOCUS GUARD (wmctrl raises the game's
# XWayland window before every key, so it works even if the browser/PWA steals focus).
# Reads the lobby via the injector. Emits ONE JSON line with the join link.
#   host [FT]  = create a Custom Match lobby (English + one-button OFF + Victory=First-to-FT) then SPECTATE
#   create [FT]= create only (stay as player 1)
#   spectate   = toggle Play<->Spectate (LeftCtrl) in the current lobby
#   leave      = leave the lobby back to the anchor (Online Play / Custom Match)
#   cycle [FT] = leave -> create -> spectate (fresh referee lobby for the next match)
#   status     = read current lobby
#   FT (default $ARCADE_FT or 3) = First-to-N victory condition for money matches (3 or 5)
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
UP=103; DOWN=108; LEFT=105; RIGHT=106; ENTER=28; BACK=14; SPEC=29
focus(){ wmctrl -a "MARVEL vs. CAPCOM" 2>/dev/null; sleep 0.35; }
tap(){ focus; ydotool key "$1:1" >/dev/null 2>&1; sleep 0.03; ydotool key "$1:0" >/dev/null 2>&1; sleep 0.30; }
tapN(){ local k=$1 n=$2 i; for ((i=0;i<n;i++)); do tap "$k"; done; }
rl(){ printf 'read_lobby' > "$GD/nobd_arcade.cmd"; sleep 1.0; cat "$GD/nobd_arcade.result" 2>/dev/null; }
lobid(){ rl | grep -oE '"lobby_id":"[0-9]+"' | grep -oE '[0-9]+' | head -1; }

# ── LOBBY SETTINGS SETTER ──────────────────────────────────────────────────────────────
# The game PERSISTS the last-used Create-Lobby options within a session but RESETS them to
# FACTORY (Japanese / one-button On / First-to-1) on a game restart; and the Left/Right value
# pickers WRAP with no clamp. So we can't blind-set — we track {VER,OB,FT} in a state file and
# press the exact (wrap-aware) delta. do_boot re-seeds the factory baseline after each cold launch.
STATE="${ARCADE_STATE_FILE:-$HOME/.local/share/retro-receipts/arcade-host/lobby_state}"
_load_state(){ VER=jp; OB=on; FT=1; [ -f "$STATE" ] && . "$STATE"; }         # default = factory
_save_state(){ mkdir -p "$(dirname "$STATE")"; printf 'VER=%s\nOB=%s\nFT=%s\n' "$VER" "$OB" "$FT" > "$STATE"; }
_seed_factory(){ VER=jp; OB=on; FT=1; _save_state; }                         # after a cold boot

# set_options <target_ft> — from the Create-Lobby settings screen (cursor on Game/top):
#   Game Version -> English, One-button -> None(off), Victory Condition -> First-to-<ft>.
# Field order (from Game=0): Game(0) GameVersion(1) Crossregion(2) Comment(3) EventMode(4) One-button(5) Victory(6).
set_options(){ local tgt=${1:-3}; _load_state
  tap $DOWN                                    # Game(0) -> Game Version(1)
  [ "$VER" != "en" ] && { tap $RIGHT; VER=en; }   # Japanese <-> English is a 2-state toggle
  tapN $DOWN 4                                 # Game Version(1) -> One-button(5)
  [ "$OB" != "off" ] && { tap $RIGHT; OB=off; }   # On <-> None is a 2-state toggle
  tap $DOWN                                    # One-button(5) -> Victory Condition(6)
  local cur=$FT fwd back                       # First-to ring is 1..10, wraps both ways
  fwd=$(( ( tgt - cur + 10 ) % 10 )); back=$(( ( cur - tgt + 10 ) % 10 ))
  if [ "$fwd" -le "$back" ]; then tapN $RIGHT "$fwd"; else tapN $LEFT "$back"; fi
  FT=$tgt; _save_state
}

# create from the ANCHOR (Online Play w/ Custom Match selected): -> popup -> settings -> set -> CREATE.
do_create(){ local ft=${1:-3}
  tap $ENTER; sleep 0.7                        # anchor(Custom Match) -> popup (Create Lobby top)
  tap $ENTER; sleep 0.7                        # popup -> Create Lobby settings (Game top)
  set_options "$ft"                            # English + one-button OFF + Victory=First-to-ft
  tap $ENTER                                   # CREATE (Enter from any field confirms)
  local r id; for i in $(seq 15); do sleep 1; r=$(rl)
    id=$(echo "$r"|grep -oE '"lobby_id":"[0-9]+"'|grep -oE '[0-9]+'|head -1)
    [ -n "$id" ] && [ "$id" != "0" ] && { echo "$r"; return 0; }; done; echo "$(rl)"; return 1; }

# Full COLD BOOT: title "PRESS ENTER TO START" -> a created lobby. Cold boot = FACTORY settings, so
# we seed the factory baseline before set_options for a deterministic set.
do_boot(){ local ft=${1:-3}
  tap $ENTER; sleep 9                          # title -> loading -> main menu (Offline Play, top)
  tap $DOWN; tap $ENTER; sleep 0.9             # Offline -> Online, Enter -> Online Play (Casual top)
  tap $DOWN; tap $DOWN; tap $ENTER; sleep 0.9  # -> Custom Match, Enter -> popup (Create Lobby top)
  tap $ENTER; sleep 0.9                        # popup -> Create Lobby settings (Game top) = FACTORY
  _seed_factory                               # cold boot resets settings to factory (jp/on/FT1)
  set_options "$ft"                            # English + one-button OFF + Victory=First-to-ft
  tap $ENTER                                   # CREATE
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
  if [ -n "$id" ] && [ "$id" != "0" ]; then echo "{\"ok\":true,\"action\":\"$1\",\"lobby_id\":\"$id\",\"owner\":\"$owner\",\"join\":\"$join\",\"ft\":${FT:-0}}"
  else echo "{\"ok\":false,\"action\":\"$1\",\"lobby_id\":\"0\"}"; fi; }

FT_ARG="${2:-${ARCADE_FT:-3}}"
case "${1:-status}" in
  boot)     do_boot "$FT_ARG" >/dev/null; do_spectate; emit boot "$(rl)";;
  host)     do_create "$FT_ARG" >/dev/null; do_spectate; emit host "$(rl)";;
  create)   r=$(do_create "$FT_ARG"); emit create "$r";;
  spectate) do_spectate; emit spectate "$(rl)";;
  leave)    do_leave; emit leave "$(rl)";;
  cycle)    do_leave; do_create "$FT_ARG" >/dev/null; do_spectate; emit cycle "$(rl)";;
  status)   emit status "$(rl)";;
  calibrate) VER="${2:-en}"; OB="${3:-off}"; FT="${4:-3}"; _save_state; echo "{\"ok\":true,\"state\":{\"ver\":\"$VER\",\"ob\":\"$OB\",\"ft\":$FT}}";;
  *) echo "{\"ok\":false,\"error\":\"usage: {host|create|spectate|leave|cycle|status|calibrate} [FT]\"}";;
esac
