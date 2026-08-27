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
# Money-match lobby standard. FIXED defaults: English version + one-button OFF. The Victory Condition
# (First-to-N) is set PER-MATCH from the securing wager (FT3/FT5) by arcade_host.sh; idle lobbies use
# ARCADE_FT_DEFAULT. We report the ACTUAL current settings (read from arcade_host's state file) so the
# Fleet card shows reality.
ARCADE_FT_DEFAULT="${ARCADE_FT:-3}"           # idle-lobby Victory Condition (First to N)
ARCADE_PLAYERS="${ARCADE_PLAYERS:-3}"         # player slots reported to the Fleet card — matches arcade_host.sh's create-menu Number-of-Players=3 (host-spectator + 2 players)
ARCADE_GAME="${ARCADE_GAME:-MvC2}"            # game label
STATE="${ARCADE_STATE_FILE:-$HOME/.local/share/retro-receipts/arcade-host/lobby_state}"
cur_ft(){  local FT=$ARCADE_FT_DEFAULT; [ -f "$STATE" ] && . "$STATE"; echo "${FT:-$ARCADE_FT_DEFAULT}"; }
cur_ob(){  local OB=off;  [ -f "$STATE" ] && . "$STATE"; [ "${OB:-off}" = off ] && echo false || echo true; }
cur_ver(){ local VER=en;  [ -f "$STATE" ] && . "$STATE"; [ "${VER:-en}" = en ] && echo US || echo JP; }

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
  if [ "$(alive)" = 0 ]; then launch_game; bash "$AH" boot "$ARCADE_FT_DEFAULT" >/dev/null 2>&1; return; fi
  local st id; st=$(bash "$AH" status); id=$(jget "$st" lobby_id)
  if [ -z "$id" ] || [ "$id" = "0" ]; then
    echo "[hostd] no lobby -> host"
    st=$(bash "$AH" host "$ARCADE_FT_DEFAULT"); id=$(jget "$st" lobby_id)
    if [ -z "$id" ] || [ "$id" = "0" ]; then   # host failed (not at anchor) -> cold boot recover
      echo "[hostd] host failed -> boot recover"; bash "$AH" boot "$ARCADE_FT_DEFAULT" >/dev/null 2>&1
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
  local st id owner join body hdr resp os sp act rst
  st=$(bash "$AH" status); id=$(jget "$st" lobby_id); owner=$(jget "$st" owner); join=$(jget "$st" join)
  if [ -z "$id" ] || [ "$id" = "0" ]; then echo "[hostd] no lobby to heartbeat"; return 1; fi
  os=$(os_info); sp=$(steam_ping)
  # 🎟 referee feed: `active` = standby (a game is being fought), and 🔍 N5 `ref` = the referee's
  # HEALTH snapshot (running = state file FRESH, armed/seat_p1/wid/score/done/last_report). One python
  # read emits both. absent/stale ref => running:false, so the server sees a dead referee.
  act=-1; refobj='{}'; rst="$(dirname "$STATE")/referee_state.json"
  if [ -f "$rst" ]; then
    read -r act refobj < <(python3 -c '
import json, time
d = json.load(open("'"$rst"'"))
fresh = time.time() - d.get("ts", 0) < 20
act = d.get("standby", 0) if fresh else -1
ref = {"running": True, "armed": bool(d.get("armed")), "seat_p1": d.get("seat_p1", ""),
       "wid": d.get("wid", ""), "s1": d.get("s1", 0), "s2": d.get("s2", 0),
       "done": bool(d.get("done")), "last_report": d.get("last_report", "")} if fresh else {"running": False}
print(act, json.dumps(ref))
' 2>/dev/null) || { act=-1; refobj='{}'; }
  fi
  body=$(printf '{"steamid":"%s","name":"%s","lobby_id":"%s","owner":"%s","join":"%s","region":"%s","os":"%s","steam_ping_ms":%s,"ft":%s,"one_button":%s,"version":"%s","players":%s,"game":"%s","active":%s,"ref":%s}' \
         "$owner" "$NODE_NAME" "$id" "$owner" "$join" "$REGION" "$os" "${sp:--1}" \
         "$(cur_ft)" "$(cur_ob)" "$(cur_ver)" "$ARCADE_PLAYERS" "$ARCADE_GAME" "${act:--1}" "$refobj")
  hdr=(-H 'content-type: application/json')
  [ -n "$HOST_TOKEN" ] && hdr+=(-H "authorization: Bearer $HOST_TOKEN")
  resp=$(curl -s -m 6 -X POST "$HOST/skinsync/arcade/host/heartbeat" "${hdr[@]}" -d "$body" 2>&1)
  echo "[hostd] HB lobby=$id owner=$owner active=$act -> ${resp:-<no response>}"
  # 🧾 referee feed: dump the raw reply — referee.py reads `assigned` (wager_id + fighters + best_of)
  # from it, so assignment awareness costs zero extra requests.
  printf '%s' "$resp" > "$(dirname "$STATE")/assigned_resp.json" 2>/dev/null || true
  # PER-MATCH FT: the server's `assigned` carries the match's best_of; set Victory Condition to its FT
  # (best_of = ft*2-1  =>  ft = (best_of+1)/2). If the current lobby's FT differs, cycle to match. The new
  # lobby id heartbeats next tick. ⚠ FOLLOW-UP: the server must re-sync the reserved wager's lobby_id to
  # this new lobby after the cycle (else the player's join link points at the pre-cycle lobby).
  local bo mft
  bo=$(printf '%s' "$resp" | grep -oE '"best_of":[0-9]+' | grep -oE '[0-9]+' | head -1)
  if [ -n "$bo" ] && [ "$bo" -gt 0 ]; then mft=$(( (bo + 1) / 2 ))
    if [ "$mft" != "$(cur_ft)" ]; then
      echo "[hostd] assigned FT$mft != current FT$(cur_ft) -> cycling lobby to match"
      bash "$AH" cycle "$mft" 2>&1 | sed 's/^/[hostd] cycle: /'; return
    fi
  fi
  # ROTATE-AFTER-SETTLE: server raises "rotate":true once this node's match paid out. Cycle to a fresh
  # idle lobby at the default FT (kicks the settled pair; new lobby id; ends in spectate).
  if printf '%s' "$resp" | grep -q '"rotate":true'; then
    echo "[hostd] ROTATE signalled -> cycling to a fresh lobby (FT$ARCADE_FT_DEFAULT)"
    bash "$AH" cycle "$ARCADE_FT_DEFAULT" 2>&1 | sed 's/^/[hostd] cycle: /'
  fi
}

tick(){ ensure_host; ensure_token || true; heartbeat; }

# Explicit opt-OUT of the host pool: tell the server to drop this node now (vs waiting for the 45s TTL).
do_unregister(){
  ensure_token >/dev/null 2>&1 || true
  local resp; resp=$(curl -s -m 6 -X POST "$HOST/skinsync/arcade/host/unregister" -H "authorization: Bearer $HOST_TOKEN" 2>&1)
  echo "[hostd] unregister -> ${resp:-<no response>}"
}

# --- injector auto-deploy (idempotent) -------------------------------------------------------------
# The bash host flow drives the game through the injected proxy version.dll (arcade_host.sh reads the
# live lobby via nobd_arcade.cmd/.result). The agent materializes setup_proxy.sh + the built version.dll
# to $INJ_DIR; this installs them into the game dir + sets the Proton prefix DllOverride. Idempotent:
# a no-op once the override is set. Requires the game CLOSED (prefix edit) and the prefix already built
# (launch MvC2 once first) — both surfaced as clear messages, never a false success.
INJ_DIR="${INJ_DIR:-$HOME/.local/share/retro-receipts/injector}"
ensure_injector(){
  local sp="$INJ_DIR/setup_proxy.sh" dll="$INJ_DIR/version.dll" steam
  [ -f "$sp" ]  || { echo "[hostd] injector missing: $sp not materialized (host build lacks the injector)"; return 1; }
  [ -s "$dll" ] || { echo "[hostd] injector version.dll missing/empty: $dll (rebuild the agent with the bundled injector)"; return 1; }
  { [ -n "$GD" ] && [ -d "$GD" ]; } || { echo "[hostd] game dir not found (set \$MVC_GAME_DIR) — install MvC2 first"; return 1; }
  steam="$(cd "$GD/../../.." 2>/dev/null && pwd)"   # STEAM root = up two from steamapps/common/<game>
  if STEAM="$steam" GAMEDIR="$GD" SRC_DLL="$dll" bash "$sp" status 2>/dev/null | grep -q 'prefix override: SET'; then
    echo "[hostd] injector already deployed"; return 0
  fi
  if [ "$(alive)" != 0 ]; then
    echo "[hostd] injector needs installing but MvC2 is running — close the game, then re-toggle Host"; return 2
  fi
  echo "[hostd] deploying injector proxy (version.dll + prefix override)…"
  STEAM="$steam" GAMEDIR="$GD" SRC_DLL="$dll" bash "$sp" install
}

# Install/refresh any BUNDLED --user units without touching registration state (no unregister, no
# disable). Needed because `enable --now` does NOT apply a CHANGED unit definition to a running
# service (same PID, old ExecStart, NeedDaemonReload=no — verified live 2026-08-27): on a content
# change we daemon-reload AND restart the unit. Called at loop start, and safe to call any time.
ensure_units(){
  local dir; dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local udir="$HOME/.config/systemd/user" u
  mkdir -p "$udir"
  for u in arcade-refereed.service; do
    [ -f "$dir/$u" ] || continue
    if ! cmp -s "$dir/$u" "$udir/$u" 2>/dev/null; then
      cp "$dir/$u" "$udir/$u"
      systemctl --user daemon-reload
      # ⚠ PRESERVE OPERATOR STATE (2026-08-27 lesson): `restart` on a STOPPED unit STARTS it — a
      # refresh must never resurrect what an operator turned off (a deploy did exactly that, pulling
      # hosting back up 57s after the owner disabled it, via the referee's Requires= coupling).
      # Active → restart (a changed definition needs it). Inactive → file lands, unit STAYS DOWN.
      if systemctl --user is-active --quiet "$u" 2>/dev/null; then
        systemctl --user restart "$u" 2>/dev/null || true
        echo "[hostd] unit $u refreshed (+restart — was active, changed definition needs it)"
      else
        echo "[hostd] unit $u refreshed on disk (left STOPPED — operator state preserved)"
      fi
    elif ! systemctl --user is-active --quiet "$u" 2>/dev/null; then
      # unchanged + idle: enable only when WE are the running loop (hosting is on) — the loop-start
      # caller implies hosting; the CLI ensure-units case must not flip an operator's off switch.
      if [ "${ENSURE_UNITS_START:-0}" = 1 ]; then
        systemctl --user enable --now "$u" >/dev/null 2>&1 || true
        echo "[hostd] unit $u enabled (hosting loop is up, unit was idle)"
      fi
    fi
  done
}

case "${1:-tick}" in
  once|tick) tick;;
  loop) echo "[hostd] loop every ${INTERVAL:-8}s -> $HOST"; ENSURE_UNITS_START=1 ensure_units; while true; do tick; sleep "${INTERVAL:-8}"; done;;
  # non-destructive unit refresh for already-hosting nodes (the agent's startup refresh calls this):
  # picks up newly bundled / changed units with NO unregister and NO disable.
  ensure-units) ensure_units;;
  # opt IN to hosting: enable + start the supervised loop (it registers via its first heartbeat).
  register)   export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
              if ! ensure_injector; then
                echo "[hostd] REGISTER ABORTED — injector not deployed (see above); hosting NOT enabled"; exit 1
              fi
              systemctl --user enable --now arcade-hostd 2>/dev/null
              systemctl --user enable --now arcade-refereed 2>/dev/null || true
              echo "[hostd] REGISTERED — hosting ON (service: $(systemctl --user is-active arcade-hostd 2>/dev/null), referee: $(systemctl --user is-active arcade-refereed 2>/dev/null))";;
  # deploy/verify the injector ONLY (no service change). The agent calls this synchronously before
  # 'register' so the tray gets an HONEST answer — prefix-not-built / game-running surface as a nonzero exit.
  ensure-injector) ensure_injector; exit $?;;
  # opt OUT: drop from the pool now, then stop + disable the loop so it won't auto-host again.
  unregister) export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
              do_unregister
              systemctl --user disable --now arcade-hostd 2>/dev/null
              systemctl --user disable --now arcade-refereed 2>/dev/null || true
              echo "[hostd] UNREGISTERED — hosting OFF (service: $(systemctl --user is-active arcade-hostd 2>/dev/null))";;
  status)     export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
              echo "hosting: enabled=$(systemctl --user is-enabled arcade-hostd 2>/dev/null) active=$(systemctl --user is-active arcade-hostd 2>/dev/null)"
              echo "lobby: $(bash "$AH" status 2>/dev/null)";;
  *) echo "usage: arcade_hostd.sh {tick|loop|register|unregister|status|ensure-injector}";;
esac
