#!/usr/bin/env python3
"""build-char-anim.py — extract per-character IDLE-loop animation sprite-sheets for the PWA.

Phase 1 of the "idle animations on match cards" feature (RETRO RECEIPTS).

Pipeline (Option B — a faithful, headless port of the Skin Studio engine):
  1. `mvc2-skin-studio/tools/build_skin_studio_data.py <track03.bin>` decodes the ROM into,
     per character, PLxx_asm.json (sprite→part assembly), PLxx_edit.png/.json (part atlas,
     ALREADY coloured through palette bank 0) and PLxx_lut.json (palette banks).
  2. `mvc2-skin-studio/web/anim/PLxx.json` gives the animation cells; group 0 / sub-anim 0 is
     the standing / IDLE motion (sometimes with the walk cycle concatenated — we trim it).
  3. We composite each idle cell exactly like Skin Studio's `_compositeCell` (tile-editor.mjs
     ~L897) — part left edge = -dx, flip = pixel mirror only, parts drawn in reverse-record
     order so record 0 lands on top — then align every frame on absolute sprite coords exactly
     like its `_exportGif` (L1923). Because the atlas is already bank-0 coloured, compositing
     straight from the atlas RGBA is identical to the studio's index→cur recolour for the
     standard (unedited) palette, so no palette round-trip is needed.

Output (one per character, keyed by decimal char id to match static/chars/<id>.webp):
  app/static/chars-anim/<id>.webp  — horizontal sprite strip, N frames of W×H
  app/static/chars-anim/<id>.json  — { w, h, n, fps, durations[], loop, rawCells, trim }

Output is git-ignored (ROM-derived — never committed); rerun to regenerate.

Usage:
  python scripts/build-char-anim.py <path/to/track03.bin>
  python scripts/build-char-anim.py <path/to/track03.bin> --char PL00   # single char
  python scripts/build-char-anim.py <path/to/track03.bin> --keep-data    # keep intermediate _asm/_edit/_lut

Idle-loop trim rule:
  loop_len = first cell index >=2 whose sprite_id == cell[0].sprite_id  (the loop restarting;
             everything after is a repeat or the walk cycle) — else the whole sub-anim.
  loop_len is then clamped to [1, MAX_CELLS] to bound sheet size and to guard the rare merged
  monotonic idle+walk sub-anims that never return to the first sprite.
"""
import argparse, base64, json, os, subprocess, sys, tempfile, shutil

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REWRITE = os.path.normpath(os.path.join(HERE, ".."))
# REWRITE is the SvelteKit app root (pwa/ in RetroReceipts-agent — no app/ subdir). The sibling skin-studio
# repo is resolved via the SKIN_STUDIO env var, with a layout-agnostic default (two dirs up from the app root).
STUDIO = os.environ.get("SKIN_STUDIO") or os.path.normpath(os.path.join(REWRITE, "..", "..", "mvc2-skin-studio"))
ANIM_DIR = os.path.join(STUDIO, "web", "anim")
BUILDER = os.path.join(STUDIO, "tools", "build_skin_studio_data.py")
OUT_DIR = os.path.join(REWRITE, "static", "chars-anim")

MAX_LOOP = 30           # cap a *detected* idle loop (bounds sheet size; e.g. Cable's 25-frame idle)
MAX_NOLOOP = 20         # cap when NO loop is detected (conservative — can't tell where idle ends)
FPS = 60                # MvC2 runs at 60 Hz; cell `duration` is in game frames

# hex id -> name (from build_skin_studio_data.ALL_CHARS), for logging only
ALL_CHARS = [
    ('00','Ryu'),('01','Zangief'),('02','Guile'),('03','Morrigan'),('04','Anakaris'),
    ('05','Strider'),('06','Cyclops'),('07','Wolverine (metal)'),('08','Psylocke'),
    ('09','Iceman'),('0A','Rogue'),('0B','Captain America'),('0C','Spider-Man'),
    ('0D','Hulk'),('0E','Venom'),('0F','Dr. Doom'),('10','Tron'),('11','Jill'),
    ('12','Hayato'),('13','Ruby Heart'),('14','SonSon'),('15','Amingo'),('16','Marrow'),
    ('17','Cable'),('18','Abyss1'),('19','Abyss2'),('1A','Abyss3'),('1B','Chun-Li'),
    ('1C','Mega Man'),('1D','Roll'),('1E','Akuma'),('1F','B.B.Hood'),('20','Felicia'),
    ('21','Charlie'),('22','Sakura'),('23','Dan'),('24','Cammy'),('25','Dhalsim'),
    ('26','M.Bison'),('27','Ken'),('28','Gambit'),('29','Juggernaut'),('2A','Storm'),
    ('2B','Sabretooth'),('2C','Magneto'),('2D','Shuma-Gorath'),('2E','War Machine'),
    ('2F','Silver Samurai'),('30','Omega Red'),('31','Spiral'),('32','Colossus'),
    ('33','Iron Man'),('34','Sentinel'),('35','Blackheart'),('36','Thanos'),('37','Jin'),
    ('38','Captain Commando'),('39','Wolverine (bone)'),('3A','Servbot'),
]


def idle_cells(anim):
    """Return (cells, raw_len, trim_len) for group 0 / sub-anim 0, trimmed to the idle loop.

    Detect the idle loop by PERIOD: the smallest p (>=2) whose second iteration matches the
    first, i.e. sprite_id[p+j] == sprite_id[j] for the whole confirming block min(p, raw-p).
    That block is a genuine loop restart (Zangief p=10, Tron p=16, Cable p=25) — after it the
    walk cycle begins, so we keep only [0:p]. A mere early revisit of sprite_id[0] mid-sway
    (e.g. B.B.Hood 85,84,85,86,…) does NOT satisfy the block match, so it isn't mistaken for a
    loop. If no period is found the sub-anim is one continuous motion (a pure idle); keep it,
    conservatively capped, since we can't otherwise tell where a hypothetical walk would start.
    """
    g0 = anim.get("groups", {}).get("0")
    if not g0 or not g0.get("subanims"):
        return None, 0, 0
    cells = g0["subanims"][0].get("cells", [])
    if not cells:
        return None, 0, 0
    raw = len(cells)
    sids = [c.get("sprite_id") for c in cells]
    period = None
    for p in range(2, raw):
        blk = min(p, raw - p)          # frames available to confirm the repeat
        if blk < 2:
            break
        if all(sids[p + j] == sids[j] for j in range(blk)):
            period = p
            break
    loop = min(period, MAX_LOOP) if period else min(raw, MAX_NOLOOP)
    loop = max(1, loop)
    return cells[:loop], raw, loop


def composite_cell(cell, asm, atlas, parts):
    """Port of Skin Studio tile-editor.mjs `_compositeCell` (applyActive=false).

    Returns (rgba_bytes, W, H, ax, ay) where ax/ay are the ABSOLUTE sprite origin so frames
    can be aligned across the animation. rgba_bytes is W*H*4. None if the cell is empty.
    """
    sid = cell.get("sprite_id")
    if sid is None or sid == 0xFFFF:
        return None
    recs = asm.get(str(sid & 0x7fff)) or asm.get(str(sid))
    if not recs:
        return None
    pl = []
    minx = miny = 10**9
    maxx = maxy = -10**9
    for r in recs:
        pr = parts.get(str(r["part"]))
        if not pr:
            continue
        w, h = pr["w"], pr["h"]
        flip, flipy = bool(r.get("flip")), bool(r.get("flipy"))
        # VALIDATED (tile-editor.mjs): part left = -dx (asm dx is negated vs the facing-0 atlas),
        # no -w; 0x4000 flip is a PIXEL mirror only (does NOT move the quad); flipy mirrors in Y.
        pdx = -r["dx"]
        pdy = -(r["dy"] + h) if flipy else r["dy"]
        pl.append((r["part"], pdx, pdy, w, h, flip, flipy))
        minx = min(minx, pdx); miny = min(miny, pdy)
        maxx = max(maxx, pdx + w); maxy = max(maxy, pdy + h)
    if not pl:
        return None
    W, H = maxx - minx, maxy - miny
    buf = bytearray(W * H * 4)
    # ENGINE TRUTH: parts layer by Z=1/W — record 0 is FRONT-most. Paint in REVERSE record
    # order so record 0 (drawn last) wins. No z-bias / active-layer for export.
    for (sel, pdx, pdy, w, h, flip, flipy) in reversed(pl):
        pr = parts[str(sel)]
        ax0, ay0 = pr["x"], pr["y"]
        ox, oy = pdx - minx, pdy - miny
        for py in range(h):
            sy = (h - 1 - py) if flipy else py
            srow = (ay0 + sy) * atlas.width
            drow = (oy + py) * W
            for px in range(w):
                sx = (w - 1 - px) if flip else px
                si = (srow + ax0 + sx) * 4
                if atlas_px[si + 3] == 0:
                    continue
                di = (drow + ox + px) * 4
                buf[di]     = atlas_px[si]
                buf[di + 1] = atlas_px[si + 1]
                buf[di + 2] = atlas_px[si + 2]
                buf[di + 3] = 255
    return bytes(buf), W, H, minx, miny


def build_char(hexid, data_dir):
    """Build one character's idle sheet + timing. Returns dict result or None on skip."""
    char = f"PL{hexid.upper()}"
    anim_path = os.path.join(ANIM_DIR, f"{char}.json")
    asm_path = os.path.join(data_dir, f"{char}_asm.json")
    edit_path = os.path.join(data_dir, f"{char}_edit.json")
    atlas_path = os.path.join(data_dir, f"{char}_edit.png")
    for p in (anim_path, asm_path, edit_path, atlas_path):
        if not os.path.exists(p):
            return {"char": char, "skip": f"missing {os.path.basename(p)}"}

    anim = json.load(open(anim_path))
    cid = anim.get("char_id")
    cells, raw_len, trim_len = idle_cells(anim)
    if not cells:
        return {"char": char, "cid": cid, "skip": "no idle cells"}

    asm = json.load(open(asm_path))["assemblies"]
    parts = json.load(open(edit_path))["parts"]
    atlas = Image.open(atlas_path).convert("RGBA")
    global atlas_px
    atlas_px = atlas.tobytes()

    comps = [composite_cell(c, asm, parts=parts, atlas=atlas) for c in cells]
    valid = [c for c in comps if c]
    if not valid:
        return {"char": char, "cid": cid, "skip": "no valid frames"}

    # global bbox across all frames (Skin Studio _exportGif alignment)
    gminx = min(c[3] for c in valid)
    gminy = min(c[4] for c in valid)
    gmaxx = max(c[3] + c[1] for c in valid)
    gmaxy = max(c[4] + c[2] for c in valid)
    W, H = gmaxx - gminx, gmaxy - gminy

    n = len(comps)
    sheet = Image.new("RGBA", (W * n, H), (0, 0, 0, 0))
    durations = []
    for i, (cell, comp) in enumerate(zip(cells, comps)):
        durations.append(int(cell.get("duration", 6)))
        if not comp:
            continue
        rgba, cw, ch, ax, ay = comp
        frame = Image.frombytes("RGBA", (cw, ch), rgba)
        sheet.paste(frame, (i * W + (ax - gminx), (ay - gminy)), frame)

    os.makedirs(OUT_DIR, exist_ok=True)
    webp_path = os.path.join(OUT_DIR, f"{cid}.webp")
    json_path = os.path.join(OUT_DIR, f"{cid}.json")
    sheet.save(webp_path, "WEBP", lossless=True, quality=100, method=6)
    timing = {"w": W, "h": H, "n": n, "fps": FPS, "durations": durations,
              "loop": True, "rawCells": raw_len, "trim": trim_len}
    json.dump(timing, open(json_path, "w"), separators=(",", ":"))
    return {"char": char, "cid": cid, "w": W, "h": H, "n": n,
            "raw": raw_len, "trim": trim_len, "bytes": os.path.getsize(webp_path)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("track", help="Path to the GDI data track (track03.bin)")
    ap.add_argument("--char", default=None, help="Single char, e.g. PL00 or 00")
    ap.add_argument("--data-dir", default=None, help="Reuse an existing _asm/_edit/_lut dir (skip ROM decode)")
    ap.add_argument("--keep-data", action="store_true", help="Keep the intermediate data dir")
    args = ap.parse_args()

    if args.char:
        hexid = args.char.upper().replace("PL", "")
        chars = [(h, n) for h, n in ALL_CHARS if h == hexid]
        if not chars:
            sys.exit(f"unknown char {args.char}")
    else:
        chars = ALL_CHARS

    # 1. decode the ROM (or reuse a prior data dir)
    data_dir = args.data_dir
    tmp = None
    if not data_dir:
        if not os.path.exists(args.track):
            sys.exit(f"ROM not found: {args.track}")
        tmp = tempfile.mkdtemp(prefix="charanim_")
        data_dir = tmp
        cmd = [sys.executable, BUILDER, args.track, "--out", data_dir, "--no-backup"]
        if args.char:
            cmd += ["--char", f"PL{chars[0][0]}"]
        print("decoding ROM ->", data_dir)
        subprocess.run(cmd, check=True)

    # 2. build sheets
    print(f"\nbuilding idle sheets -> {OUT_DIR}")
    ok = skip = 0
    total = 0
    for hexid, name in chars:
        res = build_char(hexid, data_dir)
        if res.get("skip"):
            print(f"  {res['char']:6} {name:18} SKIP ({res['skip']})")
            skip += 1
        else:
            total += res["bytes"]
            trimnote = f" (trimmed {res['raw']}->{res['trim']})" if res["raw"] != res["trim"] else ""
            print(f"  {res['char']:6} {name:18} id={res['cid']:<2} {res['n']:2}f {res['w']}x{res['h']} "
                  f"{res['bytes']//1024}KB{trimnote}")
            ok += 1
    print(f"\nDone: {ok} built, {skip} skipped, {total//1024} KB total -> {OUT_DIR}")

    if tmp and not args.keep_data:
        shutil.rmtree(tmp, ignore_errors=True)
    elif tmp:
        print(f"intermediate data kept at {tmp}")


if __name__ == "__main__":
    main()
