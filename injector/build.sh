#!/usr/bin/env bash
# build.sh -- cross-compile the NOBD ARCADE proxy version.dll with mingw-w64.
#
# Run this inside the Bazzite "tauri44" distrobox (Fedora 44), or any host with
# the mingw-w64 toolchain. Produces ./version.dll.
#
#   distrobox enter tauri44 -- bash -lc 'cd <injector> && ./build.sh'
#
# If mingw is missing, install it ONCE (Fedora):
#   sudo dnf install -y mingw64-gcc mingw64-binutils
#
# NOTE: no `pipefail` -- `grep -q` closes pipes early and would SIGPIPE objdump,
# producing flaky false negatives in the self-verify below.
set -eu
cd "$(dirname "$0")"

CC=${CC:-x86_64-w64-mingw32-gcc}
OBJDUMP=${OBJDUMP:-x86_64-w64-mingw32-objdump}
DLLTOOL=${DLLTOOL:-x86_64-w64-mingw32-dlltool}

if ! command -v "$CC" >/dev/null 2>&1; then
  echo "ERROR: $CC not found."
  echo "Install (Fedora/distrobox): sudo dnf install -y mingw64-gcc mingw64-binutils"
  exit 1
fi

CFLAGS="-O2 -Wall -Wextra -DNDEBUG -D__USE_MINGW_ANSI_STDIO=1"
LDFLAGS="-static-libgcc -Wl,--enable-stdcall-fixup -lkernel32"

# Fallback: canonical dlltool forwarder path (build the .exp from the .def,
# which encodes the DLL forwarders, then link it in).
build_with_dlltool() {
  echo "== dlltool forwarder build =="
  "$CC" $CFLAGS -c dllmain.c -o dllmain.o
  "$DLLTOOL" --input-def version_proxy.def --dllname version.dll \
             --output-exp version.exp
  "$CC" -shared -o version.dll dllmain.o version.exp $LDFLAGS
}

echo "== compiling with $($CC -dumpmachine) $($CC -dumpversion) =="

# Primary: one-shot shared link handing the forwarder .def straight to ld.
"$CC" -shared $CFLAGS -o version.dll dllmain.c version_proxy.def $LDFLAGS

echo "== built: $(ls -la version.dll | awk '{print $5, $NF}') =="

# ---- self-verify: exports must be FORWARDERS to versionorig.* ----------------
# Capture objdump output to a variable first, then grep the variable, so grep -q
# never closes a live objdump pipe (avoids SIGPIPE false negatives).
if command -v "$OBJDUMP" >/dev/null 2>&1; then
  EXPORTS="$("$OBJDUMP" -p version.dll || true)"
  if ! printf '%s' "$EXPORTS" | grep -qi "versionorig"; then
    echo "!! primary link produced no 'versionorig' forwarders; using dlltool fallback"
    build_with_dlltool
    EXPORTS="$("$OBJDUMP" -p version.dll || true)"
  fi
  echo "== export table (forwarders) =="
  printf '%s\n' "$EXPORTS" | grep -iE "forwarder|versionorig" || true
  if printf '%s' "$EXPORTS" | grep -qi "versionorig"; then
    echo "OK: version.dll exports forward to versionorig.dll"
  else
    echo "ERROR: no forwarders emitted by either method -- see README troubleshooting"
    exit 2
  fi
else
  echo "(objdump not found; skipping export self-verify)"
fi
echo "== done: version.dll ready =="
