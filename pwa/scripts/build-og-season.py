#!/usr/bin/env python3
"""Share card for a finished season's wrap-up page -> pwa/static/og/season-<id>.png (1200x630).

Same method and rules as the per-route cards (docs/og/README.md, build-og-cards.py on og-per-route-cards):
a flat PNG drawn with Pillow, committed, dark only (#0a0c12: a link preview has no viewer theme), Arial/Consolas
from the system fonts, typographic + brand marks only (NO ROM-derived art: these PNGs are committed), no emoji,
no flags, drawn marks instead of glyphs the fonts lack, names as stored and ellipsized when they cannot fit.

The numbers are read from the server (public, read-only GETs) and nothing is hard-coded, so the card can be
re-drawn the moment a season's totals are final:

  python scripts/build-og-season.py --api https://nobd.net --season season0

  --api       base URL of the server (a bare host works; /rr and /skinsync are both tried)
  --season    season id from GET /rr/seasons (default: season0)
  --social D  also write the share images for posts into directory D: <id>-card-1200x630.png and
              <id>-portrait-1080x1350.png
  --line TXT  the line printed at the foot of the portrait image (default: none)

Deterministic: no timestamps, no randomness; the same API answers give the same bytes.
Served at https://nobd.net/app/og/season-<id>.png once the PWA is released; the server's og_preview() arm for
/app/season/<id> points og:image at it.

Facebook and Discord crop to about 1.91:1 and show the card small, so the title and the champion sit well inside
a 60px margin and are sized to stay readable at 500px wide (title >= 110px, champion >= 60px, places 2-3 >= 38px).
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "static", "og"))

# Dark palette from pwa/src/app.css (the card is always dark)
BG = (10, 12, 18)
INK = (238, 241, 248)
DIM = (138, 145, 168)
MUTED = (122, 132, 156)
GOLD = (255, 176, 32)
LINE = (39, 45, 62)
PANEL = (18, 21, 31)
MOLTEN = (255, 92, 44)

FONTS = "C:/Windows/Fonts/"
F_BLACK = FONTS + "ariblk.ttf"     # the heavy display face (sheared for italic, as the page's headings are italic)
F_BOLD = FONTS + "arialbd.ttf"
F_MONO = FONTS + "consolab.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def tracked_w(f, text, tracking):
    return sum(f.getlength(c) for c in text) + tracking * max(0, len(text) - 1)


def draw_tracked(d, xy, text, f, fill, tracking):
    x, y = xy
    for c in text:
        d.text((x, y), c, font=f, fill=fill)
        x += f.getlength(c) + tracking


def fit_text(path, text, max_w, start, floor):
    """Largest font size (<= start) at which `text` fits max_w; below `floor` the text is ellipsized instead."""
    size = start
    while size >= floor:
        f = font(path, size)
        if f.getlength(text) <= max_w:
            return f, text
        size -= 2
    f = font(path, floor)
    t = text
    while len(t) > 1 and f.getlength(t + "\u2026") > max_w:
        t = t[:-1]
    return f, t + "\u2026"


def italic_layer(size, text, f, fill, shear=0.2):
    """Draw `text` in an italic by shearing a transparent layer (Arial Black has no italic cut)."""
    w = int(f.getlength(text)) + 60
    h = int(f.size * 1.5)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((30, int(f.size * 0.1)), text, font=f, fill=fill)
    return layer.transform(layer.size, Image.AFFINE, (1, shear, -shear * h * 0.55, 0, 1, 0), resample=Image.BICUBIC)


def paste_italic(img, xy, text, f, fill, shear=0.2):
    lay = italic_layer(0, text, f, fill, shear)
    img.paste(lay, (int(xy[0]) - 30, int(xy[1])), lay)
    return int(f.getlength(text))


def get(api, season, what, extra=""):
    """GET a season endpoint; tries /rr first then /skinsync. None on any failure."""
    api = api.rstrip("/")
    for prefix in ("/rr", "/skinsync"):
        url = f"{api}{prefix}/{what}{'&' if '?' in what else '?'}season={urllib.parse.quote(season)}{extra}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"accept": "application/json"}), timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            continue
    return None


def load(api, season):
    seasons = get(api, "", "seasons") or {}
    # /seasons takes no ?season=, but the extra query is ignored by the server
    label = next((s["label"] for s in seasons.get("seasons", []) if s.get("id") == season), None) or season
    board = get(api, season, "leaderboard?tab=rating&period=all&scope=ranked&limit=3") or {}
    summ = get(api, season, "season/summary") or {}
    high = get(api, season, "season/highlights") or {}
    players = [p for p in board.get("players", []) if p.get("name")][:3]
    pos = lambda v: v if isinstance(v, (int, float)) and v > 0 else None
    totals = []
    pl = summ.get("players") or {}
    played = pos(pl.get("played"))
    roster = pos(pl.get("roster"))
    g = pos((summ.get("games") or {}).get("total"))
    dd = pos(high.get("days"))
    unl = pos(pl.get("unlisted"))
    if roster:
        # a server with a season roster: the game total is the headline, then who played it
        if g:
            totals.append(f"{int(g):,} GAMES")
        totals.append(f"{int(roster):,} PLAYERS ON THE APP")
        if unl:
            totals.append(f"{int(unl):,} OPPONENTS")
    else:
        if played:
            totals.append(f"{int(played):,} PLAYERS")
        if g:
            totals.append(f"{int(g):,} GAMES")
        if dd:
            totals.append(f"{int(dd)} DAYS")
    return label, players, totals


def background(w, h):
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(BG[0] + 9 * (1 - t)), int(BG[1] + 10 * (1 - t)), int(BG[2] + 16 * (1 - t))))
    bloom = Image.new("RGB", (w, h), BG)
    ImageDraw.Draw(bloom).ellipse([w // 2 - w // 3, -h // 4, w // 2 + w // 3, h // 3], fill=GOLD)
    img = Image.blend(img, bloom.filter(ImageFilter.GaussianBlur(120)), 0.10)
    return img


def mark(d, x, y, s=34):
    """The Retro Receipts mark: an orange rounded square with the receipt bars, drawn (no asset)."""
    d.rounded_rectangle([x, y, x + s, y + s], radius=max(4, s // 6), fill=MOLTEN)
    bar = max(2, s // 12)
    for i, ln in enumerate((0.64, 0.64, 0.4)):
        yy = y + int(s * 0.2) + i * int(s * 0.17)
        d.rounded_rectangle([x + int(s * 0.16), yy, x + int(s * 0.16) + int(s * 0.68 * ln / 0.64), yy + bar], radius=1, fill=BG)
    for i in range(6):
        d.rectangle([x + int(s * 0.16) + i * int(s * 0.12), y + int(s * 0.68), x + int(s * 0.16) + i * int(s * 0.12) + max(2, s // 14), y + int(s * 0.86)], fill=BG)


def champion_plate(img, x, y, w, h, players, scale=1.0, stack=False):
    """Gold champion line + 2nd/3rd in ink. Returns nothing; draws into img."""
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x, y, x + w, y + h], radius=int(18 * scale), fill=PANEL, outline=(80, 66, 30), width=2)
    d.rounded_rectangle([x, y, x + int(8 * scale), y + h], radius=int(4 * scale), fill=GOLD)
    pad = int(34 * scale)
    if not players:
        f = font(F_BOLD, int(34 * scale))
        d.text((x + pad, y + h // 2 - int(20 * scale)), "No ranked players finished", font=f, fill=DIM)
        return
    champ = players[0]
    cf = font(F_MONO, int(22 * scale))
    draw_tracked(d, (x + pad, y + int(22 * scale)), "CHAMPION", cf, GOLD, 4.0 * scale)
    rating = str(int(champ.get("rating", 0)))
    rf = font(F_MONO, int(88 * scale))
    rw = rf.getlength(rating)
    d.text((x + w - pad, y + int(104 * scale)), rating, font=rf, fill=GOLD, anchor='rs')
    nf, name = fit_text(F_BOLD, champ["name"], w - 2 * pad - rw - int(30 * scale), int(70 * scale), int(44 * scale))
    d.text((x + pad, y + int(104 * scale)), name, font=nf, fill=GOLD, anchor='ls')
    # 2nd and 3rd, in ink with ratings
    base = int((140 if scale == 1.0 and stack else 150) * scale)
    pitch = int((50 if scale == 1.0 else 64) * scale)
    row_y = y + base
    d.line([(x + pad, row_y - int(14 * scale)), (x + w - pad, row_y - int(14 * scale))], fill=LINE, width=2)
    colw = w - 2 * pad if stack else (w - 2 * pad) // 2
    for i, p in enumerate(players[1:3]):
        cx = x + pad + (0 if stack else i * colw)
        row_y = (y + base + i * pitch) if stack else row_y
        pf = font(F_MONO, int(26 * scale))
        d.text((cx, row_y + int(36 * scale)), str(i + 2), font=pf, fill=MUTED, anchor='ls')
        r = str(int(p.get("rating", 0)))
        rr = font(F_MONO, int(38 * scale))
        rrw = rr.getlength(r)
        nf2, nm = fit_text(F_BOLD, p["name"], colw - int(70 * scale) - rrw - int(64 * scale), int(46 * scale) if stack else int(40 * scale), int(26 * scale))
        d.text((cx + int(36 * scale), row_y + int(36 * scale)), nm, font=nf2, fill=INK, anchor='ls')
        d.text((cx + colw - int(24 * scale), row_y + int(36 * scale)), r, font=rr, fill=INK, anchor='rs')


def card_landscape(label, players, totals):
    W, H = 1200, 630
    img = background(W, H)
    d = ImageDraw.Draw(img)
    ef = font(F_MONO, 21)
    draw_tracked(d, (60, 40), "SEASON FINALE", ef, MUTED, 4.0)
    right = "NOBD.NET/APP"
    draw_tracked(d, (W - 60 - tracked_w(ef, right, 3.0), 40), right, ef, MUTED, 3.0)
    title = label.upper()
    tf = font(F_BLACK, 124)
    while tf.getlength(title) > W - 160 and tf.size > 60:
        tf = font(F_BLACK, tf.size - 4)
    paste_italic(img, (60, 72), title, tf, INK)
    d = ImageDraw.Draw(img)
    sub = font(F_BLACK, 38)
    paste_italic(img, (62, 72 + int(tf.size * 1.22)), "IS IN THE BOOKS", sub, DIM)
    d = ImageDraw.Draw(img)
    d.rectangle([62, 72 + int(tf.size * 1.22) + 58, 62 + 130, 72 + int(tf.size * 1.22) + 61], fill=GOLD)
    champion_plate(img, 60, 298, W - 120, 246, players, stack=True)
    d = ImageDraw.Draw(img)
    foot = "  ·  ".join(totals)
    if foot:
        # the footer must not run into the brand mark on the right: shrink it until it fits
        size, track = 24, 3.0
        ff = font(F_MONO, size)
        while tracked_w(ff, foot, track) > 780 and size > 15:
            size -= 1
            track = max(1.5, track - 0.15)
            ff = font(F_MONO, size)
        draw_tracked(d, (60, H - 62 + (24 - size) // 2), foot, ff, MUTED, track)
    wm = font(F_BOLD, 24)
    t = "RETRO RECEIPTS"
    tw = tracked_w(wm, t, 2.0)
    mark(d, W - 60 - int(tw) - 46, H - 70, 34)
    draw_tracked(d, (W - 60 - tw, H - 66), t, wm, INK, 2.0)
    return img


def card_portrait(label, players, totals, line):
    W, H = 1080, 1350
    img = background(W, H)
    d = ImageDraw.Draw(img)
    ef = font(F_MONO, 24)
    draw_tracked(d, (60, 56), "SEASON FINALE", ef, MUTED, 4.0)
    right = "NOBD.NET/APP"
    draw_tracked(d, (W - 60 - tracked_w(ef, right, 3.0), 56), right, ef, MUTED, 3.0)
    words = label.upper().split(" ")
    tf = font(F_BLACK, 168)
    while max(tf.getlength(w) for w in words) > W - 140 and tf.size > 80:
        tf = font(F_BLACK, tf.size - 6)
    y = 104
    top = y
    for w in words:
        paste_italic(img, (60, y), w, tf, INK, 0.2)
        y += int(tf.size * 0.98)
    sub = font(F_BLACK, 56)
    sy = y + int(0.26 * tf.size)
    paste_italic(img, (62, sy), "IS IN THE BOOKS", sub, DIM)
    d = ImageDraw.Draw(img)
    d.rectangle([62, sy + 96, 62 + 170, sy + 100], fill=GOLD)
    py = sy + 150
    ph = int(150 * 1.35) + 2 * int(64 * 1.35) + 28
    champion_plate(img, 60, py, W - 120, ph, players, scale=1.35, stack=True)
    d = ImageDraw.Draw(img)
    foot = "  \u00b7  ".join(totals)
    fy = py + ph + 46
    if foot:
        # shrink until the whole footer fits inside the margins (it never runs off the card)
        size, track = 30, 3.0
        ff = font(F_MONO, size)
        while tracked_w(ff, foot, track) > W - 120 and size > 15:
            size -= 1
            track = max(1.5, track - 0.15)
            ff = font(F_MONO, size)
        draw_tracked(d, (60, fy + (30 - size) // 2), foot, ff, MUTED, track)
    if line:
        lf = font(F_BOLD, 40)
        lines, cur = [], ""
        for wd in line.split(" "):
            if lf.getlength((cur + " " + wd).strip()) > W - 120:
                lines.append(cur)
                cur = wd
            else:
                cur = (cur + " " + wd).strip()
        lines.append(cur)
        ly = fy + 92
        d.rectangle([60, ly - 26, 60 + 90, ly - 23], fill=GOLD)
        for ln in lines:
            d.text((60, ly), ln, font=lf, fill=INK)
            ly += 52
    wm = font(F_BOLD, 28)
    t = "RETRO RECEIPTS"
    tw = tracked_w(wm, t, 2.0)
    mark(d, W - 60 - int(tw) - 54, H - 84, 40)
    draw_tracked(d, (W - 60 - tw, H - 78), t, wm, INK, 2.0)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--season", default="season0")
    ap.add_argument("--social")
    ap.add_argument("--line", default="")
    a = ap.parse_args()
    label, players, totals = load(a.api, a.season)
    if not players and not totals:
        print("no data from %s for %s: refusing to draw an empty card" % (a.api, a.season))
        sys.exit(1)
    os.makedirs(OUT_DIR, exist_ok=True)
    card = card_landscape(label, players, totals)
    path = os.path.join(OUT_DIR, f"season-{a.season}.png")
    card.save(path, "PNG", optimize=True)
    print("wrote %s  %dx%d  %.1f KB" % (path, card.width, card.height, os.path.getsize(path) / 1024))
    if a.social:
        os.makedirs(a.social, exist_ok=True)
        card.save(os.path.join(a.social, f"{a.season}-card-1200x630.png"), "PNG", optimize=True)
        pt = card_portrait(label, players, totals, a.line)
        pt.save(os.path.join(a.social, f"{a.season}-portrait-1080x1350.png"), "PNG", optimize=True)
        print("wrote social images into", a.social)
    print("data:", label, [(p["name"], p.get("rating")) for p in players], totals)


if __name__ == "__main__":
    main()
