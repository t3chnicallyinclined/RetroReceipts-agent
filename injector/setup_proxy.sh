#!/usr/bin/env bash
# setup_proxy.sh -- install (or remove) the NOBD ARCADE proxy version.dll into the
# MvC2 (appid 2634890) Proton game directory, AND set the version=native,builtin
# DLL override directly in the game's Proton PREFIX registry so NO Steam launch
# option is needed. Run this ON the Bazzite box.
#
#   ./setup_proxy.sh install     # proxy + versionorig copy + prefix override
#   ./setup_proxy.sh uninstall   # restore original state
#   ./setup_proxy.sh status
#
# It does NOT launch the game. After 'install' the game just needs to be started
# normally from Steam -- no launch flag, no in-game capture click.
#
# IMPORTANT: the game must NOT be running while editing the prefix registry (Wine
# rewrites user.reg on prefix unload and would clobber the edit). Steam itself may
# stay open.
set -eu

STEAM="${STEAM:-$HOME/.local/share/Steam}"
GAMEDIR="${GAMEDIR:-$STEAM/steamapps/common/MARVEL vs. CAPCOM Fighting Collection}"
PFX="${PFX:-$STEAM/steamapps/compatdata/2634890/pfx}"
USERREG="$PFX/user.reg"
SRC_DLL="${SRC_DLL:-$(dirname "$0")/version.dll}"
REAL_VERSION="$PFX/drive_c/windows/system32/version.dll"

action="${1:-status}"
info() { printf '  %s\n' "$*"; }

game_running() { pgrep -f "MarvelVsCapcomFightingCollection.exe" >/dev/null 2>&1; }

# --- prefix DLL override (persists with no launch flag) -----------------------
# Edit user.reg directly (most reliable; no dependency on a runnable wine binary).
# Alternative, if you prefer: with the game's Proton wine reachable, run
#   WINEPREFIX="$PFX" "<Proton>/files/bin/wine" reg add \
#     "HKCU\\Software\\Wine\\DllOverrides" /v version /d native,builtin /f
set_override() {
  [ -f "$USERREG" ] || { echo "ERROR: $USERREG not found (launch the game once so Proton builds the prefix)"; exit 1; }
  cp -f "$USERREG" "$USERREG.nobd-bak"
  # drop any pre-existing version override (either "version" or "*version")
  sed -i '/^"\*\?version"="/d' "$USERREG"
  if grep -qF '[Software\\Wine\\DllOverrides]' "$USERREG"; then
    awk 'BEGIN{d=0}
         {print}
         (!d && index($0,"[Software\\\\Wine\\\\DllOverrides]")){print "\"version\"=\"native,builtin\"";d=1}' \
        "$USERREG" > "$USERREG.new" && mv "$USERREG.new" "$USERREG"
  else
    printf '\n[Software\\\\Wine\\\\DllOverrides] %s\n"version"="native,builtin"\n' \
      "$(date +%s)" >> "$USERREG"
  fi
  info "prefix override set: HKCU\\Software\\Wine\\DllOverrides  version=native,builtin"
}
unset_override() {
  [ -f "$USERREG" ] || return 0
  cp -f "$USERREG" "$USERREG.nobd-bak"
  sed -i '/^"\*\?version"="native,builtin"/d' "$USERREG"
  info "removed prefix version override"
}

case "$action" in
  install)
    [ -f "$SRC_DLL" ] || { echo "ERROR: built proxy not found: $SRC_DLL (run build.sh first)"; exit 1; }
    [ -d "$GAMEDIR" ] || { echo "ERROR: game dir not found: $GAMEDIR"; exit 1; }
    [ -f "$REAL_VERSION" ] || { echo "ERROR: prefix version.dll not found: $REAL_VERSION (launch the game once so Proton builds the prefix)"; exit 1; }
    if game_running; then echo "ERROR: MvC2 is running -- close it first (prefix registry edit)"; exit 1; fi

    echo "== installing NOBD ARCADE proxy =="
    cp -f "$REAL_VERSION" "$GAMEDIR/versionorig.dll"
    info "versionorig.dll  <- $REAL_VERSION"
    if [ -f "$GAMEDIR/version.dll" ] && ! grep -qa "versionorig" "$GAMEDIR/version.dll" 2>/dev/null; then
      cp -n "$GAMEDIR/version.dll" "$GAMEDIR/version.dll.orig-backup" || true
      info "backed up existing version.dll -> version.dll.orig-backup"
    fi
    cp -f "$SRC_DLL" "$GAMEDIR/version.dll"
    info "version.dll (proxy) -> $GAMEDIR/version.dll"
    set_override

    echo
    echo "== DONE. No Steam launch option, no capture click needed. =="
    echo "Just launch MvC2 from Steam and go to the online/custom-match menu."
    echo "Trigger a lobby by writing 'create' to:"
    echo "    $GAMEDIR/nobd_arcade.cmd"
    echo "Result appears in:"
    echo "    $GAMEDIR/nobd_arcade.result   (+ .ready heartbeat, .log)"
    ;;

  uninstall)
    if game_running; then echo "ERROR: MvC2 is running -- close it first"; exit 1; fi
    echo "== removing NOBD ARCADE proxy =="
    if [ -f "$GAMEDIR/version.dll" ] && grep -qa "versionorig" "$GAMEDIR/version.dll" 2>/dev/null; then
      rm -f "$GAMEDIR/version.dll"; info "removed proxy version.dll"
    fi
    if [ -f "$GAMEDIR/version.dll.orig-backup" ]; then
      mv -f "$GAMEDIR/version.dll.orig-backup" "$GAMEDIR/version.dll"; info "restored original version.dll"
    fi
    rm -f "$GAMEDIR/versionorig.dll" && info "removed versionorig.dll" || true
    unset_override
    ;;

  status)
    echo "GAMEDIR: $GAMEDIR"
    for f in version.dll versionorig.dll nobd_arcade.log nobd_arcade.ready \
             nobd_arcade.result nobd_arcade_capture.txt; do
      if [ -f "$GAMEDIR/$f" ]; then info "present: $f"; else info "absent : $f"; fi
    done
    if [ -f "$USERREG" ] && grep -q '^"\*\?version"="native,builtin"' "$USERREG"; then
      info "prefix override: SET (version=native,builtin)"
    else
      info "prefix override: NOT set"
    fi
    ;;

  *)
    echo "usage: $0 {install|uninstall|status}"; exit 1 ;;
esac
