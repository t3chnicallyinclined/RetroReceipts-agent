#!/usr/bin/env python3
"""Render the MvC2 character idle portraits used by the web versus screen (MyMatch.svelte).

Source: `idle_frames.json` from the desktop app repo (mvc-live-skins/web/idle_frames.json) — ROM-derived
idle-frame data. Each entry is keyed by char id and holds { w, h, bank0, frames }:
  • bank0  = 16-colour RGBA palette (index 0 is transparent)
  • frames[0].px = base64 → w*h bytes, one palette index per pixel
We decode the first idle frame, colour it through bank0, trim the transparent margin, and write a tiny
lossless webp per character to app/static/chars/<id>.webp. Those are served (via the normal PWA deploy) at
/app/chars/<id>.webp and pointed at by MyMatch's portrait chips (with an abbreviation-tile fallback).

Output is git-ignored (ROM-derived — never committed); rerun this to regenerate.

Usage:
  python scripts/render-char-portraits.py [path/to/idle_frames.json]
"""
import base64
import json
import os
import sys

from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8")   # Windows console defaults to cp1252 → the "→" in the summary print crashes it (and would abort the deploy)
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
# app root is HERE/.. (pwa/ in RetroReceipts-agent — no app/ subdir). idle_frames source via the IDLE_FRAMES
# env var, with a layout-agnostic default (three dirs up from scripts/ → the projects-root sibling mvc-live-skins).
DEFAULT_SRC = os.environ.get("IDLE_FRAMES") or os.path.normpath(os.path.join(HERE, "..", "..", "..", "mvc-live-skins", "web", "idle_frames.json"))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "static", "chars"))


def render(entry):
    w, h, pal = entry["w"], entry["h"], entry["bank0"]
    px = base64.b64decode(entry["frames"][0]["px"])
    if len(px) != w * h:
        raise ValueError(f"pixel count {len(px)} != {w}x{h}")
    img = Image.new("RGBA", (w, h))
    img.putdata([tuple(pal[b]) for b in px])
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def tron_from_atlas():
    """Portrait for id 16 from chars-anim/16.webp frame 0 (the atlas is the correct Tron source)."""
    here = os.path.dirname(os.path.abspath(__file__))
    anim_dir = os.path.normpath(os.path.join(here, "..", "static", "chars-anim"))
    t = json.load(open(os.path.join(anim_dir, "16.json")))
    img = Image.open(os.path.join(anim_dir, "16.webp")).convert("RGBA")
    f0 = img.crop((0, 0, t["w"], t["h"]))
    bbox = f0.getbbox()
    return f0.crop(bbox) if bbox else f0


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    data = json.load(open(src))
    os.makedirs(OUT_DIR, exist_ok=True)
    n = total = 0
    for cid, entry in data.items():
        try:
            # id 16 (Tron Bonne): idle_frames.json carries the WRONG shape here (Servbot's frame colored
            # through Tron's bank) — render her portrait from frame 0 of the CORRECT animated atlas instead.
            if cid == "16":
                img = tron_from_atlas()
            else:
                img = render(entry)
            path = os.path.join(OUT_DIR, f"{cid}.webp")
            img.save(path, "WEBP", lossless=True, quality=100)
            n += 1
            total += os.path.getsize(path)
        except Exception as e:  # noqa: BLE001 — a bad entry shouldn't abort the batch
            print(f"  skip {cid}: {e}")
    print(f"rendered {n} portraits → {OUT_DIR} ({total // 1024} KB total)")


if __name__ == "__main__":
    main()
