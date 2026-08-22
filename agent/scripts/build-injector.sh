#!/usr/bin/env bash
# build-injector.sh — release-pipeline prestep: build the host-node injector proxy
# (version.dll) with mingw-w64 and STAGE it where the agent's build.rs embeds it via
# include_bytes! (agent/assets/version.dll). Run on the LINUX build box BEFORE
# `cargo build` of the agent.
#
# ABORT-IF-MISSING: a host-capable release must never ship without the injector, so a
# failed/empty build stops the pipeline (the exact analog of the PWA build-char-anim
# preregen gate). In a plain dev checkout you can skip this — the agent's build.rs is
# graceful when the dll is absent (host materialize just reports "not bundled").
#
#   scripts/build-injector.sh                          # build + stage (default paths)
#   INJECTOR_DIR=… ASSETS_DIR=… scripts/build-injector.sh
#
# Requires mingw-w64 on the build box (Fedora/distrobox: sudo dnf install -y mingw64-gcc mingw64-binutils).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# agent/scripts → repo root is two up; the injector is a repo sibling under host-node/.
INJECTOR_DIR="${INJECTOR_DIR:-$(cd "$HERE/../.." && pwd)/host-node/injector}"
ASSETS_DIR="${ASSETS_DIR:-$HERE/../assets}"            # → agent/assets
DEST="$ASSETS_DIR/version.dll"

[ -d "$INJECTOR_DIR" ] || { echo "✗ injector dir not found: $INJECTOR_DIR" >&2; exit 1; }

if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
  echo "✗ mingw-w64 not found (x86_64-w64-mingw32-gcc)." >&2
  echo "  Install once — Fedora/distrobox: sudo dnf install -y mingw64-gcc mingw64-binutils" >&2
  exit 1
fi

echo "▶ build injector proxy (mingw-w64) in $INJECTOR_DIR"
# Reuse the proven, self-verifying injector build (it self-checks the versionorig forwarders).
# Invoke via `bash` (not ./): a fresh `git clone` drops build.sh's +x bit, so relying on the mode
# bit fails in a clean CI checkout (confirmed on the build box).
( cd "$INJECTOR_DIR" && bash build.sh )

SRC="$INJECTOR_DIR/version.dll"
[ -f "$SRC" ] || { echo "✗ build.sh produced no version.dll — aborting (a host-less release is not shippable)" >&2; exit 2; }

mkdir -p "$ASSETS_DIR"
cp -f "$SRC" "$DEST"
sz="$(stat -c%s "$DEST" 2>/dev/null || wc -c <"$DEST")"
echo "✅ staged injector → $DEST (${sz} bytes)"
