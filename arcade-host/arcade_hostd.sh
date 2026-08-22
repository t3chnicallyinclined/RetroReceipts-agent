#!/usr/bin/env bash
# arcade_hostd.sh {tick|loop|once} -- the HOST-NODE DAEMON.
# Keeps a spectate-referee lobby alive and heartbeats it to the server host pool so the
# server always knows an available host + its join link. Reuses arcade_host.sh for ALL
# game control (the one unified automation for tournament/arcade/money hosting).
# Self-heals: launches + cold-boots the game if it's down; recreates the lobby if it died.
#
# Env: METASYNC_HOST (default https://nobd.net), NODE_NAME (default hostname),
#      REGION (free text, e.g. "us-east"), HOST_TOKEN (optional bearer), INTERVAL (loop secs).
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
AH="${AH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/arcade_host.sh}"
HOST="${METASYNC_HOST:-https://nobd.net}"
NODE_NAME="${NODE_NAME:-$(hostname)}"
REGION="${REGION:-}"
HOST_TOKEN="${HOST_TOKEN:-}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.metasync_host_token}"
HOST_STEAMID="${HOST_STEAMID:-}"   # operator SteamID (owner of the lobbies); default = read from game
# arcade lobby STANDARD — what this node's automation creates its lobbies with (arcade_host.sh sets these
# on the Create-Lobby screen). Reported every heartbeat so the Fleet card shows the real lobby details.
ARCADE_FT="${ARCADE_FT:-2}"                  # Victory Condition target: First to N
ARCADE_ONE_BUTTON="${ARCADE_ONE_BUTTON:-false}"  # one-button special moves (arcade standard = off)
ARCADE_VERSION="${ARCADE_VERSION:-US}"        # game version (US = English Version)
ARCADE_PLAYERS="${ARCADE_PLAYERS:-2}"         # number of player slots
ARCADE_GAME="${ARCADE_GAME:-MvC2}"            # game label

alive(){ pgrep -cf '[M]arvelVsCapcomFightingCollection.exe'; }
jget(){ echo "$1" | grep -oE "\"$2\":\"[^\"]*\"" | head -1 | sed -E "s/\"$2\":\"([^\"]*)\"/\1/"; }

# Mint (once) + cache a SteamID-bound token so the auth'd heartbeat is accepted. The node key == this SteamID.
ensure_token(){
  [ -n "$HOST_TOKEN" ] && return 0
  if [ -s "$TOKEN_FILE" ]; then HOST_TOKEN=$(cat "$TOKEN_FILE"); [ -n "$HOST_TOKEN" ] && return 0; fi
  local sid resp
  sid="$HOST_STEAMID"; [ -z "$sid" ] && sid=$(jget "$(bash "$AH" status)" owner)
  [ -z "$sid" ] && { echo "[hostd] no steamid yet (no lobby) — will register after boot"; return 1; }
  HOST_STEAMID="$sid"
  resp=$(curl -s -m 6 -X POST "$HOST/skinsync/register" -H 'content-type: application/json' -d "{\"steamid\":\"$sid\"}")
  HOST_TOKEN=$(echo "$resp" | grep -oE '"token":"[^"]*"' | head -1 | sed -E 's/.*"token":"([^"]*)".*/\1/')
  [ -n "$HOST_TOKEN" ] && { echo "$HOST_TOKEN" > "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE" 2>/dev/null; echo "[hostd] registered node steamid=$sid"; return 0; }
  echo "[hostd] register failed: $resp"; return 1
}

launch_game(){
  echo "[hostd] launching game…"
  local PID; PID=$(pgrep -xo plasmashell)
  while IFS= read -r -d '' l; do case "$l" in DISPLAY=*|WAYLAND_DISPLAY=*|XDG_RUNTIME_DIR=*|DBUS_SESSION_BUS_ADDRESS=*|XAUTHORITY=*) export "$l";; esac; done < /proc/$PID/environ
  setsid nohup steam steam://rungameid/2634890 >/tmp/game_s.log 2>&1 </dev/null & disown
  sleep 40
}

# Ensure a live spectate-referee lobby exists (self-healing).
ensure_host(){
  if [ "$(alive)" = 0 ]; then launch_game; bash "$AH" boot >/dev/null 2>&1; return; fi
  local st id; st=$(bash "$AH" status); id=$(jget "$st" lobby_id)
  if [ -z "$id" ] || [ "$id" = "0" ]; then
    echo "[hostd] no lobby -> host"
    st=$(bash "$AH" host); id=$(jget "$st" lobby_id)
    if [ -z "$id" ] || [ "$id" = "0" ]; then   # host failed (not at anchor) -> cold boot recover
      echo "[hostd] host failed -> boot recover"; bash "$AH" boot >/dev/null 2>&1
    fi
  fi
}

# --- node telemetry for the fleet map ---
OS_INFO=""
os_info(){ [ -n "$OS_INFO" ] && { echo "$OS_INFO"; return; }; local p; p=$(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"); OS_INFO="${p:-$(uname -s)} $(uname -r | cut -d- -f1)"; echo "$OS_INFO"; }
steam_ping(){ # TCP connect ms to a stable Steam endpoint (reachability/latency signal); -1 on failure
  local t; t=$(curl -o /dev/null -s -m 3 -w '%{time_connect}' https://api.steampowered.com 2>/dev/null)
  [ -n "$t" ] && awk -v x="$t" 'BEGIN{ if(x+0>0) printf "%d", x*1000; else print "-1" }' || echo "-1"; }

heartbeat(){
  local st id owner join body hdr resp os sp
  st=$(bash "$AH" status); id=$(jget "$st" lobby_id); owner=$(jget "$st" owner); join=$(jget "$st" join)
  if [ -z "$id" ] || [ "$id" = "0" ]; then echo "[hostd] no lobby to heartbeat"; return 1; fi
  os=$(os_info); sp=$(steam_ping)
  body=$(printf '{"steamid":"%s","name":"%s","lobby_id":"%s","owner":"%s","join":"%s","region":"%s","os":"%s","steam_ping_ms":%s,"ft":%s,"one_button":%s,"version":"%s","players":%s,"game":"%s"}' \
         "$owner" "$NODE_NAME" "$id" "$owner" "$join" "$REGION" "$os" "${sp:--1}" \
         "$ARCADE_FT" "$ARCADE_ONE_BUTTON" "$ARCADE_VERSION" "$ARCADE_PLAYERS" "$ARCADE_GAME")
  hdr=(-H 'content-type: application/json')
  [ -n "$HOST_TOKEN" ] && hdr+=(-H "authorization: Bearer $HOST_TOKEN")
  resp=$(curl -s -m 6 -X POST "$HOST/skinsync/arcade/host/heartbeat" "${hdr[@]}" -d "$body" 2>&1)
  echo "[hostd] HB lobby=$id owner=$owner -> ${resp:-<no response>}"
  # ROTATE-AFTER-SETTLE: the server raises "rotate":true on the heartbeat once the match this node
  # refereed has paid out. Leave the lobby (kicks the settled pair) + create a fresh one so the next
  # quarter gets a clean cabinet with a NEW lobby id. cycle ends in spectate (both player slots free).
  if printf '%s' "$resp" | grep -q '"rotate":true'; then
    echo "[hostd] ROTATE signalled -> cycling to a fresh lobby"
    bash "$AH" cycle 2>&1 | sed 's/^/[hostd] cycle: /'
  fi
}

tick(){ ensure_host; ensure_token || true; heartbeat; }

# Explicit opt-OUT of the host pool: tell the server to drop this node now (vs waiting for the 45s TTL).
do_unregister(){
  ensure_token >/dev/null 2>&1 || true
  local resp; resp=$(curl -s -m 6 -X POST "$HOST/skinsync/arcade/host/unregister" -H "authorization: Bearer $HOST_TOKEN" 2>&1)
  echo "[hostd] unregister -> ${resp:-<no response>}"
}

case "${1:-tick}" in
  once|tick) tick;;
  loop) echo "[hostd] loop every ${INTERVAL:-8}s -> $HOST"; while true; do tick; sleep "${INTERVAL:-8}"; done;;
  # opt IN to hosting: enable + start the supervised loop (it registers via its first heartbeat).
  register)   export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
              systemctl --user enable --now arcade-hostd 2>/dev/null
              echo "[hostd] REGISTERED — hosting ON (service: $(systemctl --user is-active arcade-hostd 2>/dev/null))";;
  # opt OUT: drop from the pool now, then stop + disable the loop so it won't auto-host again.
  unregister) export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
              do_unregister
              systemctl --user disable --now arcade-hostd 2>/dev/null
              echo "[hostd] UNREGISTERED — hosting OFF (service: $(systemctl --user is-active arcade-hostd 2>/dev/null))";;
  status)     export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
              echo "hosting: enabled=$(systemctl --user is-enabled arcade-hostd 2>/dev/null) active=$(systemctl --user is-active arcade-hostd 2>/dev/null)"
              echo "lobby: $(bash "$AH" status 2>/dev/null)";;
  *) echo "usage: arcade_hostd.sh {tick|loop|register|unregister|status}";;
esac
