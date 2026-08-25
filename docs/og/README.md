# OG Fight Card — render spec (server lane)

`fight-card-template.svg` (1200×630) → rasterize with **resvg** at `/rr/ogimg/<session>.png`, LRU +
on-disk cache keyed by session id; `og_preview` points `og:image` at it for `/app/r/set/<id>` AND
`/s/<tail>`. Fonts: **DejaVu Sans / DejaVu Sans Mono** from the system fontdb (present on the VPS —
no shipping). All user text is substituted as literal strings — ESCAPE EVERYTHING (names are user data).

## Token mapping (from the same payload /rr/session serves)

| Token | Value | Notes |
|---|---|---|
| `{{TAIL}}` | session id hex suffix, UPPERCASE | header right |
| `{{LSCORE}} {{RSCORE}}` | set tally per seat (count wins per player over games) | left = players[0], right = players[1] **unless** one is the set winner — put the WINNER right (winner-reads-right, the app's convention) |
| `{{LCOLOR}} {{RCOLOR}}` | `#ffb020` for the winner's digit, `#e8ecf4` for the other; **both `#e8ecf4` when tied/live** | gold only when settled |
| `{{LNAME}} {{RNAME}}` | disp_name per seat | max width 430px @ 46px bold ≈ **17 chars** — ellipsize (`…`) past that |
| `{{LRANK}} {{LRATING}}` etc. | tier name + rating (from the session players' rating; tier via the same rankOf thresholds the PWA uses — or just the rating if tier is a bother) | mono, dim |
| `{{DATE}}` | `YYYY-MM-DD` of game 1 ts | |
| `{{GAMES}}` | games.length | |
| `{{DUR}}` | **wall-clock span: last game ts − first game ts** → `Nm SSs` (⚠ NOT the duration_s sum — tapes are per-game and often partial, a 10-game set rendered "1m 46s" from its one taped game); empty → omit segment AND its `·` separator | |
| `{{SEAL}}` | `● N/N VERIFIED` (verified\|\|confirmed count) — `LIVE SET` while unsettled | |
| `{{SEALCOLOR}}` | `#ffb020` when ALL games verified, else `#8a92ab`; `#ff3d68` for LIVE | |

## Sprites (`{{L/RSPRITE1..3}}`)

Replace each token with an `<image>` element (or empty string when absent). Game 1's team per seat
(`wteam`/`lteam` resolved through `winner`). PNGs: `/var/www/metasync-app/app/chars-png/<id>.png`
(deployed with every PWA release; PNG twins of the webp portraits, transparent, variable aspect).

Fixed cell height **140px**, bottom-aligned at **y=505** (so `y = 505 - 140 = 365`), width from the
PNG's aspect (`w = 140 * png_w / png_h`). Slot x anchors — left seat: `48, 188, 328`; right seat
(mirrored, outer-edge first): `x_right_edge = 1152, 1012, 872` and `x = x_right_edge - w`.

```xml
<image x="48" y="365" width="{w}" height="140" xlink:href="file:///var/www/metasync-app/app/chars-png/26.png"/>
```
⚠ **hrefs must be PLAIN ABSOLUTE PATHS** (`/var/www/...`), NOT `file://` URLs — usvg's default resolver
treats href as a filesystem path and a `file://` prefix silently renders ZERO portraits (found live at
first deploy: the card looked fine, squad rows empty). Base64 data URIs also work.

> STATUS 2026-08-25: LIVE (server 4248bce). The template is VENDORED into the server repo
> (`server/assets/`) and compiled in — design changes here need a peer re-copy + rebuild, ping them.

## Notes

- Single-theme card (dark #0a0c12) — OG images have no theme context.
- No flags/emoji in text nodes — DejaVu coverage is broad but emoji render as tofu in resvg; the seal's
  `●` is a DejaVu glyph and safe.
- Unknown/missing anything → drop the element, never render placeholders like "undefined".
- Cache-bust: a LIVE set's image may be re-requested — short TTL (60s) while unsettled, immutable after.
