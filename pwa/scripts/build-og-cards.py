#!/usr/bin/env python3
"""Build the per-route link-preview cards -> pwa/static/og/<route>.png (1200x630).

WHY THESE EXIST
  Every /app/* URL used to unfurl with one identical generic card, because the PWA is an SPA with no
  per-route prerender (svelte.config.js `fallback: index.html`) — so no scraper ever sees a route's
  <svelte:head>. The per-route tags are emitted server-side by og_preview() in
  RetroReceipts-server/server/src/routes.rs; THIS script draws the images those tags point at.

WHY FLAT PNGs AND NOT THE /rr/ogimg RENDERER
  /rr/ogimg reloads the system fontdb per render inside rr-server's single-threaded tiny_http loop, so a
  cache miss blocks every other request. That is an acceptable trade for one-per-set fight cards; it is
  the wrong shape for six pages anyone can spam-share. These are static, so they cost nothing to serve.

⚠ NO ROM-DERIVED ART IN HERE — ON PURPOSE
  These PNGs are COMMITTED to the repo. The project invariant is that the game's assets (sprites,
  palettes, stage art) never enter a repo; only pixels OF a match may be served, and these are neither.
  So every card is typographic + brand marks only. If character art is ever wanted on these, it must be
  generated at deploy time and gitignored, the way static/chars-png/ already is (see
  scripts/render-char-portraits.py, invoked from scripts/release-app.mjs) — do not bake sprites in here.

  usage:  python scripts/build-og-cards.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "static", "og")

W, H = 1200, 630

# Brand tokens, copied from pwa/src/app.css (the DARK palette — the card is always dark, since a link
# preview has no viewer theme to respond to).
BG = (10, 12, 18)          # --bg   #0a0c12
INK = (238, 241, 248)      # --ink  #eef1f8
MUTED = (122, 132, 156)

F_TITLE = "C:/Windows/Fonts/arialbd.ttf"
F_MONO = "C:/Windows/Fonts/consolab.ttf"
F_MONO_L = "C:/Windows/Fonts/consola.ttf"

# route slug -> (big title, ghost watermark, accent, subtitle)
# Titles/ghosts mirror each page's in-app <Masthead>, so the card matches the page it opens.
CARDS = [
    ("match",      "LIVE",        "ON AIR",   (255, 61, 104),  # --live
     "MONEY ON THE LINE  ·  GAMES IN PROGRESS  ·  THE TAPE OF EVERY ONE"),
    ("ranks",      "RANKS",       "LADDER",   (255, 176, 32),  # --gold
     "IRON TO GALACTUS  ·  EVERY RANKED PLAYER, ORDERED"),
    ("hosts",      "ARCADES",     "NETWORK",  (63, 177, 255),  # --p2
     "THE LIVE HOST NETWORK  ·  WHERE THE CABINETS ARE"),
    ("tournament", "TOURNAMENTS", "BRACKETS", (255, 106, 61),  # --p1
     "BRACKETS THAT RUN THEMSELVES  ·  FOLLOW IT LIVE"),
    ("library",    "TIER LIST",   "META",     (185, 140, 255),
     "WHICH TEAMS ACTUALLY WIN  ·  RANKED BY REAL WIN RATE"),
    ("skins",      "THE LOCKER",  "LOCKER",   (52, 211, 154),
     "YOUR FIGHTERS, YOUR COLORS  ·  WORN ON EVERY RECEIPT"),
]


def fit(font_path, text, target_w, start, tracking):
    """Largest size at which `text` (with `tracking` px between glyphs) fits `target_w`."""
    size = start
    while size > 12:
        f = ImageFont.truetype(font_path, size)
        if tracked_w(f, text, tracking) <= target_w:
            return f
        size -= 2
    return ImageFont.truetype(font_path, 12)


def tracked_w(font, text, tracking):
    return sum(font.getlength(c) for c in text) + tracking * max(0, len(text) - 1)


def draw_tracked(d, xy, text, font, fill, tracking):
    """PIL has no letter-spacing, so lay the string out glyph by glyph."""
    x, y = xy
    for c in text:
        d.text((x, y), c, font=font, fill=fill)
        x += font.getlength(c) + tracking


def card(slug, title, ghost, accent, sub):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # Vertical wash + a soft accent bloom behind the title, so the card is not a flat rectangle.
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(BG[0] + 9 * (1 - t)), int(BG[1] + 10 * (1 - t)), int(BG[2] + 16 * (1 - t))))
    # The bloom MUST be blurred: a raw ellipse blended at low alpha still shows a hard elliptical edge,
    # which reads as a dark oval smeared across the card rather than as a glow behind the title.
    bloom = Image.new("RGB", (W, H), BG)
    bd = ImageDraw.Draw(bloom)
    bd.ellipse([W // 2 - 400, H // 2 - 165, W // 2 + 400, H // 2 + 165], fill=accent)
    bloom = bloom.filter(ImageFilter.GaussianBlur(110))
    img = Image.blend(img, bloom, 0.16)
    d = ImageDraw.Draw(img)

    # Ghost watermark (the in-app Masthead has one behind every page title).
    gf = fit(F_TITLE, ghost, W - 120, 300, 16)
    gw = tracked_w(gf, ghost, 16)
    gl = Image.new("RGB", (W, H), BG)
    draw_tracked(ImageDraw.Draw(gl), ((W - gw) / 2, H / 2 - 168), ghost, gf, (150, 165, 200), 16)
    img = Image.blend(img, gl, 0.05)
    d = ImageDraw.Draw(img)

    # Eyebrow / source line.
    ef = ImageFont.truetype(F_MONO, 21)
    draw_tracked(d, (58, 44), "MARVEL VS CAPCOM 2  ·  RANKED", ef, MUTED, 3.0)
    right = "NOBD.NET/APP"
    draw_tracked(d, (W - 58 - tracked_w(ef, right, 3.0), 44), right, ef, MUTED, 3.0)

    # The page title — the thing that makes this card not look like the other five.
    tf = fit(F_TITLE, title, W - 200, 150, 8)
    tw = tracked_w(tf, title, 8)
    draw_tracked(d, ((W - tw) / 2, 236), title, tf, accent, 8)

    # Accent seam, then the subtitle.
    d.rectangle([(W - 300) / 2, 402, (W + 300) / 2, 405], fill=accent)
    sf = ImageFont.truetype(F_MONO, 20)
    tracking = 2.6
    while tracked_w(sf, sub, tracking) > W - 110 and sf.size > 12:
        sf = ImageFont.truetype(F_MONO, sf.size - 1)
    draw_tracked(d, ((W - tracked_w(sf, sub, tracking)) / 2, 442), sub, sf, INK, tracking)

    # Footer, matching the site card's wording.
    ff = ImageFont.truetype(F_MONO, 21)
    # Drawn, not typed: U+2713 is absent from Consolas and renders as a tofu box.
    cy = H - 51
    d.line([(59, cy), (65, cy + 7), (77, cy - 8)], fill=(255, 176, 32), width=3, joint="curve")
    draw_tracked(d, (90, H - 62), "VERIFIED RESULTS", ff, MUTED, 3.0)
    tag = "GET THAT RECEIPT!"
    draw_tracked(d, (W - 58 - tracked_w(ff, tag, 3.0), H - 62), tag, ff, MUTED, 3.0)

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.normpath(os.path.join(OUT_DIR, slug + ".png"))
    img.save(path, "PNG", optimize=True)
    print("  wrote %-14s %dx%d  %6.1f KB" % (slug + ".png", img.width, img.height, os.path.getsize(path) / 1024))


if __name__ == "__main__":
    print("building per-route OG cards -> static/og/")
    for c in CARDS:
        card(*c)
    print("done. these are referenced by og_preview() in RetroReceipts-server/server/src/routes.rs")
