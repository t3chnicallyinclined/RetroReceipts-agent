# REPLAY OVERLAY — the template format (v1, 2026-09-04)

Tris: *"the tape overlay should ship separate — something we apply and change over the rendered tape, so it is easier to
change at a higher level if we want to change the template / fonts / metadata."* And: *"the overlay can be shipped from
the server at time of replay — small, with its metadata / rendered overlay."*

So the on-picture overlay is a **template-driven layer**: a versioned JSON document fully describes what is drawn and
where (640×480 picture units), bound to ONE metadata schema that either the server ships with the tape read or the PWA
assembles client-side. The renderer (`pwa/src/lib/components/ReplayOverlay.svelte`) has no hard-coded plates — a
template change needs no code change. Design of record for the placements: `docs/REPLAY-OVERLAY-SPEC.md` rev 3; the
rev 3 layout IS the built-in default template, `pwa/static/replay/overlay/default.json`.

Code: `pwa/src/lib/replay/overlay.ts` (types, bindings, `bindCtx`, the loader), `ReplayOverlay.svelte` (renderer),
`ReplayEmbed.svelte` (data path + mount), `lib/replay/source.ts` (the `overlay` field on a tape source).

---

## 1. Where the template comes from (load order)

| # | Source | When | Cache |
|---|---|---|---|
| 1 | `?overlay=<url>` | dev builds or `?dev=1` — preview any template in place | none (`no-store`) |
| 2 | the tape read's `overlay.template` (`GET /rr/tape?key=` → `overlay.template`, STEP 4b) | when the server ships one with the tape; 404/invalid → next | browser |
| 3 | `GET /rr/update/overlay-template.json` | the server's static template, same posture as `changelog.json` | **24 h** in `localStorage` (`rr.overlay.template.v1`; a miss is cached 1 h) |
| 4 | `static/replay/overlay/default.json` | the built-in (this repo) | `force-cache` |
| 5 | `INLINE` (overlay.ts) | last resort when even the static file fails: the two name rows + the watermark | — |

`window.__rrEmbed.template` reports `<from>:<name>` (`preview|tape|server|builtin|inline`); the `.ovl` node carries
`data-template="<name>"`. `dropOverlayTemplateCache()` forgets the server copy.

## 2. The binding schema — `OverlayMeta` (one shape for both producers)

```jsonc
{
  "mode": "ranked", "ft": 3, "game": 3, "date_ms": 1756937640000, "stage_id": 13, "stage_name": null, "duration_s": 118,
  "seats_known": true,          // absent = true (the server's p1/p2 ARE the seats); false = row order, `stock colors`
  "saved": false,               // paid save → the SAVED pill
  "watermark": "RETRO RECEIPTS · nobd.net/app/ranks",   // the part after ` · ` is the link text
  "p1": { "steamid": "7656…", "name": "Tris", "rank": "VIBRANIUM", "rating": 1147, "games": 120, "avatar": "…",
          "won": true, "team": [42, 44, 52], "score": 2,
          "credits": [ { "cid": 42, "name": "NIGHTFALL", "author_steamid": "7656…", "author_name": "Ruby", "own": false } ] },
  "p2": { … }
}
```

- **Server**: the block on the tape read (`HANDOFF-LANE1-REPLAY-DATA.md` STEP 4b) — `overlay: {template, version, meta}`,
  ≤ 2 KB, resolved server-side at request time (seats from STEP 2, credits from STEP 3's loadout provenance, names via
  `disp_name`). The embed binds `meta` **verbatim** — no client-side lookups, `?devcredit` ignored.
- **Client** (block absent — every prod tape today): `ReplayEmbed` assembles the same shape from the row (`ReplayMeta`),
  the loadouts store and the seat rule (P1 left when `meta.p1/p2` name a side), `credits` from the `credits` prop (empty
  until C13).
- `rank` is a display string only; the badge derives its tier from `rating` + `games` (commandment 6).

`bindCtx(meta)` adds the derived fields templates bind to: `p1.profile` (`/u/<sid>` when a 17-digit SteamID), `p1.creators`
(`[{name, steamid?, href}]` — the UNIQUE creators of that side's credited skins in slot order; `own` and
`author_steamid === wearer` contribute nothing), `p1.creditsText`, `p1.label` (`Player 1: Tris`, or the bare name when seats
are unknown), `modeLabel`, `money`, `record` (`🪙 MONEY · FT3 · G3`), `date` (viewer-local `YYYY-MM-DD HH:MM`), `stageText`
(`STAGE 13` or the name upper-cased), `duration` (`m:ss`), `seatsKnown`, `saved`, `watermark.text` / `watermark.link`,
`ranksHref`, `base`.

## 3. The template document

```jsonc
{
  "version": 1,                       // the only accepted version; anything else → the next source in the load order
  "name": "retro-receipts-default",   // shown in data-template and the test hook
  "fonts": [ { "family": "Barlow Condensed", "url": null } ],   // declared, not loaded (url reserved for a later @font-face loader)
  "tokens": { "ink": "#eef1f8", "gold": "#ffb020", "stream": "#8b6dff", "scrim": "rgba(0,0,0,0.65)", … },
  "styles": { "display": { "font": "'Barlow Condensed', Inter, …", "size": 12, "weight": 900, "italic": true, "lineHeight": 11, "outline": true }, … },
  "elements": [ … ]                   // the tree; top-level elements are placed absolutely in 640×480 units
}
```

### 3.1 Element fields

| Field | Meaning |
|---|---|
| `id`, `class` | `class` = DOM class hooks (bindable) for tests; styling never comes from CSS classes |
| `kind` | `text` (default) · `rank` (the tier badge: `rating`/`games` = binding paths, `badge` = size px) · `list` (one node per item of `items`; each item binds as `item.*`; `separator` = `", "` or `{text, ml, mr}`) · `group` (has `children`) |
| `anchor`, `x`, `y` | top-level placement: `top-left` (`left:x; top:y`), `top-right` (`right:x`), `top-center` (centred on x 320, `top:y`), `bottom-*` (`bottom:y`), `center` |
| `w`, `h`, `mt`, `ml`, `mr`, `gap` | max-width, height, margins, flex gap — picture px |
| `layout`, `align`, `justify`, `reverse` | `row`/`column`; column `align` = the cross-axis edge (`left`/`right`/`center`); row `justify` = `start`/`end`/`center`; `reverse` flips the order (P2's row 1 mirrors P1's) |
| `style` + overrides | a named style from `styles`; any of `font size weight italic lineHeight letterSpacing uppercase outline color opacity underline ellipsis` on the element wins |
| `color`, `box.fill` | a token name, a CSS colour, or a binding (`{{p1.won ? gold : ink}}`) |
| `outline` | text: the 1 px dark outline + 2 px glow (`OUTLINE` in overlay.ts); rank: a 1 px drop shadow |
| `box` | `{fill, radius, padding: [v, h] | n}` |
| `borderTop` | e.g. `1px dotted faint` (token names resolve) |
| `visibility` | `always` (default) · `full` (only in the full form — fades out 300 ms and leaves the flow in minimal; back instantly) · `minimal` (only in minimal) |
| `when` | a binding path that must be truthy, `!path` negates — else the element is not rendered (`p1.creators`, `!seatsKnown`, `saved`) |
| `content`, `href`, `label`/`ariaLabel`, `title`, `aria: "hidden"`, `role` | text/link/accessibility; all bindable |

### 3.2 Bindings

- `{{path}}` → the value at that dotted path in the context (`''` when absent).
- `{{path ? A : B}}` (or `{{!path ? A : B}}`) → A or B, each resolved as: a token name → its value; a `'quoted'` literal; a
  path → its value; otherwise the word itself (so `{{p1.won ? won : ''}}` yields a class name).
- Truthiness: arrays non-empty, strings non-empty, numbers not NaN (a score of `0` shows), booleans as-is.

### 3.3 The default template, annotated (= spec rev 3 §2.2)

| Element | Placement | Bound to |
|---|---|---|
| `p1` (group, `pid p1`, role group, label `Player 1: <name>`) | `top-left` x 8 y 0, column, ≤ 250 wide | rows: |
| `p1.r1` (row, h 11, mt 1, gap 4) | y 1–12 | `nm` = `{{p1.name}}` in `display` (gold if `p1.won`, link `p1.profile`, ellipsis) · `rk` = the badge from `p1.rating`/`p1.games` (10 px → `ranksHref`, when `p1.rating`) · `rt` = `{{p1.rating}}` mono · `sc` = `{{p1.score}}` when present |
| `p1.r2` (row, h 11, mt 1, gap 4, mono) | y 13–24 | `lb` = `Skin by:` (when `p1.creators`) · `by` = list of `p1.creators` (`{{item.name}}`, link `item.href`, `stream`, separator `,` ml −3) |
| `p2` / `p2.r1` / `p2.r2` | `top-right` x 8 (right edge x 632); row 1 `reverse`, row 2 `justify: end` | mirror of P1 |
| `stamp` (column, ≤ 104, box scrim r 3 pad 0/4, `visibility: full`) | `top-center` y 56 (the dead gap under the timer) | `{{record}}` (gold when money) / `{{date}}` / `{{stageText}}` / `stock colors` when `!seatsKnown` |
| `saved` (pill, gold, `visibility: full`, when `saved`) | `top-left` x 378 y 58 h 12 | `SAVED` |
| `wm` (row, box wmScrim r 2 pad 0/6, mono 11 caps) | `top-center` y 437 h 12 | `{{watermark.text}}` · `{{watermark.link}}` → `ranksHref` |

The smoke test (`scripts/smoke-replay.mjs --overlay`) asserts this geometry within 1 px at k 1 / 2 / 0.81 / 0.61, that an
alternate template (`static/replay/overlay/shifted.json` via `?overlay=`) moves P1 to x 20 and the stamp to y 60 with no
code change, that a dev-manifest row carrying an `overlay` block (`local_stage9_srv`) renders its names/credits/watermark
verbatim, and that `readback()` is byte-identical with any template — the layer is chrome, never pixels.

## 4. Changing the overlay without a PWA deploy

1. Copy `default.json`, edit, keep `"version": 1`, give it a new `name`.
2. Preview it: `nobd.net/app/match?dev=1&overlay=<url of your json>` (the hero and every row render it).
3. Ship it at `/rr/update/overlay-template.json` (the server's static-file path; same posture as `changelog.json`). Clients
   pick it up within 24 h (or at once after `dropOverlayTemplateCache()`); a per-tape template can also ride the tape read.

Fonts: the default declares Barlow Condensed and JetBrains Mono but does not load them (the app bundles neither today —
the display face falls back to the Inter/Segoe italic stack). `fonts[].url` is reserved for a template-driven `@font-face`
loader when Tris decides a font download is worth it.

## 5. The poster / export composite (spec only — Phase D)

The same template bound to the same `OverlayMeta` produces the poster: the server (C7) renders `elements[]` to SVG text
nodes at 2× (the fight-card pipeline already draws SVG → resvg → PNG) over the KO frame, letterboxed into 1200×630; the
client composite draws the SAME DOM (`.ovl`) through an SVG `<foreignObject>` over `readback()` pixels. One template,
three renderers (DOM, server SVG, client SVG) — placements can never drift between the player and the poster.
