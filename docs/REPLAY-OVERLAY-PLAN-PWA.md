# REPLAY OVERLAY — PWA build plan (2026-09-03)

The PWA side of `docs/REPLAY-OVERLAY-SPEC.md` **rev 2** (on-picture overlay, 640×480 units) + the LATEST TAPE hero
(Tris, 2026-09-03). One phase per section: files, the data each needs (server contracts that do not exist yet are
marked with the spec's C-numbers and `docs/HANDOFF-LANE1-TAPE-ARCHIVE.md`), the ship gate, the risks. No time estimates.

Status legend: **BUILT** = in this repo now (Phase A landed with this plan) · **PWA-only** = no server change needed ·
**needs C-nn** = blocked on a server/agent contract · **UNKNOWN** = no source of truth found in this projects folder.

Direction that shaped this plan (verbatim intent): *"all metadata is inside the match replay"* — the overlay is drawn ON the
rendered picture, OBS-style, not in bands or pillars; *"NOW PLAYING becomes a render canvas showing our Retro Receipts
overlay of the LAST MATCH PLAYED; put it higher up — it is the first thing they see; the latest match is ready to render
and autostarts on load."*

---

## 0. The mechanism everything sits on (Phase A, BUILT)

**Template-driven (2026-09-04, BUILT — `docs/REPLAY-OVERLAY-TEMPLATE.md`).** Tris: *"the tape overlay should ship separate…
easier to change at a higher level if we want to change the template / fonts / metadata"* and *"the overlay can be shipped
from the server at time of replay"*. The `.ovl` layer is now rendered by `ReplayOverlay.svelte` from a versioned JSON template
(`static/replay/overlay/default.json` = spec rev 3; overridable by `/rr/update/overlay-template.json` with a 24 h cache, by
the tape read's `overlay.template`, or `?overlay=<url>` in dev) bound to ONE metadata schema (`OverlayMeta`, `lib/replay/
overlay.ts`): the server's `overlay.meta` verbatim when the tape read ships it (HANDOFF-LANE1-REPLAY-DATA.md STEP 4b — not
built server-side yet; a dev-manifest fixture `local_stage9_srv` exercises it), else assembled client-side from the row +
loadouts exactly as before. Placement no longer lives in Svelte CSS; the smoke's placement asserts, screenshots and the
readback-sha gate are unchanged, plus an alternate-template test (`?overlay=/replay/overlay/shifted.json` → P1 x 20, stamp y 60).

`pwa/src/lib/components/ReplayEmbed.svelte`:

- `.ovl` — a `640×480` DOM box, sibling of the `<canvas>` inside `.pic`, `transform: scale(k)` with `k = .pic.clientWidth / 640`
  (a `ResizeObserver` action `fitOverlay`), `transform-origin: 0 0`, `pointer-events: none` except links. Same DOM, same
  coordinates inline (k ≤ 1), fullscreen (k = `fsScale`: 2 at 1080p), phone landscape (0.8125), phone portrait (0.61).
  The canvas is never composited with it: `readback()` reads the scene target, so the L3 / skins / stock-sha gates are
  unchanged by construction — and the smoke asserts it (`--overlay`).
- Placement = the spec's §2.2 table in picture pixels, as `--ov-*` variables at the top of the `.ovl` rule:
  plates bottom y 430 / x 8 / right edge x 632 / ≤ 220 wide / `rgba(0,0,0,.65)` / 2 px `--p1`/`--p2` side bar when seats are
  known; credits stacked above, 17 px per line (`SkinCredit form="icon"`); record stamp centred x 320, top y 56, ≤ 104 wide,
  3 mono lines (+ `stock colors`); `SAVED` pill x 378 y 58 (when `meta.saved`); watermark y 437–449 centred.
- `showOverlay: 'full' | 'minimal' | 'off'` (`$derived`): full while not playing, for the first 3 s of play (`intro`), on
  hover (+ 3 s after the pointer leaves), and the last 3 s (`frame ≥ count − 180`); minimal once the SAME 2.5 s idle timer as
  the HUD fires (`poke()` now runs the timer inline too — `hud` only *fades the transport* in fullscreen); below k 0.75
  minimal-only while playing. `o` cycles auto → full → minimal → off (`cycleOverlay`, a 1.2 s toast); `setOverlay()` is
  exported for tests. The layer exists only in playable states (§2.5: the `.ov` state panels stand alone).
- Test hook `window.__<hookName>` (default `__rrEmbed`; the hero registers `__rrHero`) registered at mount and at ready,
  exposing `state · frame · count · key · overlay · overlayMode · hud · fullscreen · scale · setOverlay · load · play ·
  pause · seek · enterFullscreen · exitFullscreen · readback`.

---

## Phase A — the on-picture layer with today's data (BUILT, PWA-only)

### Files changed

| File | Change |
|---|---|
| `pwa/src/lib/components/ReplayEmbed.svelte` | the `.ovl` layer (§0); inline chrome-top shrunk to one 28 px `.metarow` (mode · FT/GAME · date · stage · duration · `stock colors`); fullscreen pillars/bands plain `#000` (no plates), the transport HUD anchored to the picture's bottom edge (`--fsby` = the letterbox under it), portrait keeps the static transport band; seat-anchored sides (`leftIsB`: P1 LEFT when `meta.p1/p2` name a side, else the row's order unlabelled + `stock colors`); `credits` prop (`SeatCredits = {steamid: Credit[]}`) — EMPTY today; `?devcredit=1` (DEV builds only) fakes 3 + 1 credits; §5f: readout `served → target` while seeking, the `skipping ahead…` pill exempt from the HUD fade (`.emb.fs.hudoff:not(.seeking) .note`); `o` key; `autoload` (the `closed` state: poster + `▶ Watch the tape`, nothing fetched until a tap); `hookName`; `onstate`; `meta.saved` → the SAVED pill; §5c nopack copy (`Tape's in. Art isn't.`) |
| `pwa/src/lib/components/SkinCredit.svelte` | NEW — suffix **Credit**; forms `line` (`STORM · "NIGHTFALL" by Ruby`), `icon` (16 px sprite wearing the skin + `"NAME" by Author`, 17 px — the overlay), `short` (`NIGHTFALL by Ruby`); own design = name only; SteamID author = dotted-underlined link to `/u/<sid>` with `aria-label="<name>'s profile"`; name-only author = plain text; stock = the caller renders nothing |
| `pwa/src/lib/components/PlayerPlate.svelte` | tag density gains the rank badge (12 px → `rankHref`) after the rating — the overlay plate's `[av 20][flag][name][badge][rating]` (§2.2 #1) |
| `pwa/src/lib/components/ReplayAffordance.svelte` | §5e: `🔒 SIGN IN` on the phone fold (`.xw` hidden ≤ 720 px), full copy on `title`/`aria-label` |
| `pwa/src/routes/match/+page.svelte` | the **LATEST TAPE hero** (below); the actions row of an expanded row unchanged |
| `pwa/scripts/smoke-replay.mjs` | `--overlay` and `--hero` gates (below); the watermark check moved to `.ovl .wm` |
| `docs/DESIGN-SYSTEM.md` | §8 amendments: the picture may be overlaid (replaces "chrome above/below"); **Credit** suffix; `--stream` = creator credit; `--p1`/`--p2` = seat accents; commandment 1 credit clause; commandment 9 seat-anchored exception; ReplayEmbed + SkinCredit rows |
| `docs/LIVE-TAB-SPEC.md` | §1.6 and §7.10 marked SUPERSEDED by REPLAY-OVERLAY-SPEC rev 2 §8.1 |

### The LATEST TAPE hero (`routes/match/+page.svelte`)

- Section `data-test="hero"`, titled **Latest Tape** (`the last match played, off its tape`), placed after the YOUR MATCH strip
  and **above LIVE MONEY** (your own live set outranks a replay; for everyone else the hero is the first thing on the tab).
  NOW PLAYING (games in progress) stays its own section below. **When live-match spectating exists
  (`mvc-live-match-spectate`), the hero switches to the live game** — the section is the slot, the content follows the clock.
- Resolver `pickHero`: the newest row whose `availability()` is `ready`/`saved` (rows are newest-first in `matchfeed.results`,
  `matchfeed.svelte.ts:20`); on the dev server (`import.meta.env.DEV || ?dev=1`) the newest local test tape by `ts`; else the
  newest result with its `pending`/`none`/`signin` state copy on the OG poster — **never an empty box**; zero results →
  `No tapes yet — the next finished set lands here.`
- Autoplay = the embed's own rule (`autoplay='auto'`: not under reduced motion / Save-Data). **Phones** (`Mobi|Android|iPhone…`
  UA, or coarse pointer + short side < 720) and Save-Data pass `autoload={false}` → the embed sits `closed` on the poster
  with `▶ Watch the tape`; **no tape or pack request until a tap**. No loop (plays once → `▶ Watch again` on the KO frame).
  Header actions: `THE TAPE ›` (SessionModal), `⧉ Copy link`, `⛶ Full screen` (`heroEmbed.enterFullscreen()` — one click).
- A picture being watched is never yanked: `pickHero` returns while the hero is `playing`/`paused`/`seeking`; a newer tape takes
  over only when the hero is idle. Expanding a result row pauses the hero (one picture at a time). The hero registers
  `window.__rrHero`; the row/sheet embeds keep `window.__rrEmbed`.

### Data (all from today's contracts)

| Datum | Source | Status |
|---|---|---|
| names, rating, avatar, flag, team | `ReplayMeta` from `metaOf()` / `metaOfLocal()` (`match/+page.svelte`), `SetReceipt`, `MatchReceipt` | live |
| set score / gameNo / FT | `meta.score`, `meta.gameNo`, `meta.ft` — only the set view passes them (`SetReceipt.svelte`); LIVE rows have none → W/L is the gold name only | live where present |
| seats (P1/P2) | `meta.p1/p2` ← `seatsOf(r)` (`source.ts:193`) needs `side` + `reporter` on the row — **absent on `match_result` and `/rr/session` games** (`matchfeed.svelte.ts:45-47`; HANDOFF §6) → **C10**; local test tapes carry `p1/p2` in `static/replay/index.json` | needs **C10** (else `stock colors`) |
| skin credits | `credits` prop — the public loadout is `{cid, colors}` only (`loadouts.svelte.ts:26-37`) | needs **C13** (renders empty; `?devcredit=1` in DEV) |
| stage name | `Stage <id>` — no `stage_id → name` table in the PWA | needs **C8** (LIVE-TAB-SPEC) |
| `SAVED` | `meta.saved` — nothing sets it; `POST /rr/tape/save` is "later" (HANDOFF §2) | needs the paid-save contract |
| replayable rows on prod | `GET /rr/tape?key=` 404s today (`source.ts:9-10`) → every prod row is `pending`/`none`; the hero shows the newest match's poster + state copy | needs lane 1's archive read (HANDOFF §2) |

### Ship gate (Phase A) — all PWA-side, all in this repo

1. `npm run check` → 0 errors / 0 warnings; `npm run build` clean.
2. `node scripts/smoke-replay.mjs --l3 http://localhost:8099 --skins --overlay --hero` → PASS:
   - stock frame-0 sha == the L3 dev player's; `?devskin=ff00ff` differs (unchanged gates);
   - **the layer is chrome, never pixels**: readback sha identical with the layer `full` and `off`, and equal to the stock
     baseline for the same tape;
   - the layer's client rect == the canvas rect (Δ ≤ 1.5 px) at 1280 wide inline, 1920×1080 fullscreen (k 2, picture 1280 px),
     844×390 (k 0.8125, picture 520 px), 390×844 (k 0.61); every element's rect ÷ k matches §2.2 within 1 px (plates x 8 /
     right 632 / bottom 430 / ≤ 220 wide, id row 20, credits 17 per line with the box top at 430 − 26 − 17n, stamp top 56 centred
     320 ≤ 104 wide, watermark y 437 h 12 centred 320); no element enters a §2.1 no-go zone (stamp inside x 269–374 y 55–101,
     watermark above y 453 and between x 66–574, plates above y 434);
   - timing: full for the first 3 s, minimal within 3.3 s of play, full on pause, full on hover, minimal 3 s after the pointer
     leaves; `o` cycles auto → full → minimal → off → auto; phone portrait minimal-only while playing, full on pause;
   - fullscreen: HUD fades ≤ 2.5 s idle (`.hudoff`, opacity 0), anchored to the picture's bottom edge; portrait transport static;
   - a11y: two `role="group"` plates labelled `Player 1: …` / `Player 2: …` before the transport in DOM order;
   - hero: reaches `playing` on load with no click (desktop); under an iPhone UA stays `closed` with **zero** tape/pack requests;
     under `prefers-reduced-motion: reduce` stops at `ready`; expanding a row pauses it.
3. Screenshots in `pwa/smoke-out/`: `overlay-inline.png`, `overlay-inline-minimal.png`, `overlay-fullscreen-1920x1080.png`,
   `overlay-fullscreen-1920x1080-minimal.png`, `overlay-phone-landscape-844x390.png`, `overlay-phone-portrait-390x844.png`,
   `hero-phone-closed.png`, `live-tab-local_stage9.png` (the tab with the hero), `embed-local_stage9.png`.
4. Manual: the LIVE-TAB-SPEC §6.5 keyboard walk with a screen reader (Space/←→/Home/End/F/**O**/Esc) — not automatable here.

### Risks

- **Fullscreen in headless Chrome** goes through the real Fullscreen API or the pseudo path (`position: fixed`); the gate accepts
  either (it asserts `.emb.fs` + geometry), but a real device is the only proof of the orientation lock and the iPhone hint.
- **Two players at once** (hero + an expanded row): the hero pauses, but its worker and GPU textures stay allocated until the
  route unmounts. If a low-end box stutters, dispose the hero on expand instead of pausing (one-line change in `+page.svelte`).
- **The hero on prod today** never plays (no tape read) — it is the newest match's poster + `Tape not in yet` / `No tape for this
  one` copy until lane 1 ships `/rr/tape`. That is the designed state, not a bug.
- **Overlay text at k 0.61** (phone portrait) is 8 px physical — below the floor; the spec accepts it because the layer is
  minimal-only while playing there and the `Turn your phone` hint moves the viewer to landscape (k 0.81).
- **Reduced-motion crossfade**: the full→minimal switch is a 300 ms opacity/visibility transition; reduced motion cuts it (CSS).
- `?devcredit=1` is guarded by `import.meta.env.DEV` — a production build never fakes a credit (a fake `by Ruby` on a real
  player's skin would be a lie on a public page).

---

## Phase B — provenance + credit (needs **C13**; C14 optional)

### Files

| File | Change |
|---|---|
| `pwa/src/lib/stores/loadouts.svelte.ts` | `normalize()` keeps `{cid: hex[16]}` for the remapper and gains a parallel `credits: {steamid: {cid: Credit}}` from the same read (`skin_id, name, author_steamid, author_name, source`); `peek()`/`of()`/`prime()` unchanged for every consumer; new `creditsOf(steamid): Credit[]` (own-design flag = `author_steamid === steamid`) |
| `pwa/src/lib/components/ReplayEmbed.svelte` | `credits` prop defaults to `loadouts.creditsOf(left/right.steamid)` when null (same fetch, same cache); `?devcredit` stays DEV-only |
| `pwa/src/routes/skins/[cid]/+page.svelte` | `wear()` sends `{cid, colors, skin_id, source, author_name}` from `trying` (`vaultId` → `vault`; a code card → `code` + the code's author; a community card → `community` + `a`); saving a code to the vault sends the code's `author` instead of `''`; rack cards read `by <author>` (linked when a SteamID is known) via `SkinCredit form="line"` in place of `shared code · by X` |
| `pwa/src/lib/stores/vault.svelte.ts` | `save()` accepts `author` (empty = own design — never store a name string for yourself, DESIGN-SYSTEM.md:59) |
| `pwa/src/lib/components/DyeStation.svelte` | unchanged behaviour (`author: ''` = own design) |
| `pwa/src/routes/skins/+page.svelte` | locker stage `skinLabel` gains the author: `“NIGHTFALL” · by Ruby · ● WORN` (`SkinCredit form="short"`) |
| `pwa/src/routes/u/[steamid]/+page.svelte` | under the hero plate's 68 px sprites: `WEARING` + one `SkinCredit` per credited skin; own design reads `own design` |
| `pwa/src/lib/skincodes.ts` | **C14** (optional): share code v2 with an optional 17-digit `author_steamid` so a pasted code can link its creator (+17 chars); v1 codes keep decoding |

### Data

| Datum | Contract | Status |
|---|---|---|
| `skin_id, name, author_steamid, author_name, source` per `CharSkin` on `GET /rr/loadout` (own + public + batch) | **C13** (spec §4.1-4.2; server `routes.rs:587-613`, `models.rs:39-43`) | PROPOSED — not built |
| equip `POST /rr/loadout` accepting `skin_id, source, author_name`; `author_steamid` resolved from `skin_id` → vault owner | **C13** | PROPOSED |
| `author_name` resolved at READ time via `disp_name` (a renamed creator is credited under the current name on every old replay) | **C13** | PROPOSED |
| creator SteamID inside a share code | **C14** (PWA-only; `skincodes.ts:45-61`) | PROPOSED (Q3 for Tris) |

### Gate

Three accounts on the dev server against a C13-serving server: A designs and wears (name only, no by-line); B wears A's skin
from a code (`by A` plain before C14, linked after); C wears a community skin (`by <string>`, plain); stock shows nothing.
A renames on Steam → every surface (overlay, rack, locker, profile) shows the new name without a redeploy. With three
credited skins the plate box top sits at y 353 ± 1 at 1× (`--overlay` gate, real data instead of `?devcredit`). The smoke's
`--overlay` run keeps passing with `?devcredit` removed from the script and real credits on the test tape's P1.

### Risks

- The write path drops provenance in three places today (`[cid]/+page.svelte:64-77, 158`; `vault.svelte.ts:79`) — each is a
  one-field change but all three must land together or old loadouts show `legacy` (nothing truthful to say → no line, §3.2).
- Name strings for yourself are never stored (SSOT names); the own-design rule relies on `author_steamid === wearer`, which the
  server must set from the vault owner, not trust from the client.
- Credit lines ride the wearer's CURRENT loadout (spec §4.3): a replay credits what the wearer wears now (Q2 for Tris).

---

## Phase C — seats (needs **C10**; tape-envelope derivation is PWA-only)

### Files

| File | Change |
|---|---|
| `pwa/src/lib/replay/source.ts` | `seatsOf()` unchanged; a new `seatsFromEnvelope(bytes)` that reads `reporter`, `side`, `winner`, `loser` from the v5 tape envelope's top-level fields (one `DecompressionStream` pass over the ≤ 14 MB gz; the engine decompresses again — Phase C measures the cost) |
| `pwa/src/lib/components/ReplayEmbed.svelte` | after the tape bytes land (`fetchProgress` in `start()`), derive seats when `meta.p1/p2` are absent and feed `opts.skins` accordingly (`feedSkins()`), flip the `stock colors` marker off, colour the side bars; the plates re-sort to P1 LEFT the moment seats resolve (before the first frame draws) |
| `pwa/src/lib/stores/matchfeed.svelte.ts` | consume `wside`/`lside`/`reporter` on `match_result` deltas and the feed seed (fields already declared, `45-47`) |
| `pwa/src/lib/components/SetReceipt.svelte` / `MatchReceipt.svelte` | pass `p1/p2` from the session/receipt payload once C10 echoes them |
| `pwa/src/lib/stores/matchfeed.svelte.ts` + `ReplayEmbed.svelte` / `ReplayAffordance.svelte` | the bus `{type:'tape', key, state:'ready'}` event (HANDOFF §3): a `requested` panel flips itself to `loading`, a collapsed row flips `⏳ → ▶` — no polling; after 3 min `Still pulling — the archive is slow tonight.` + `Try again` (`probeServer(key, true)`) |

### Data

| Datum | Contract | Status |
|---|---|---|
| `wside`, `lside`, `reporter` on the ONE `match_result` builder and on `/rr/session` games | **C10** (HANDOFF §6; server `app.rs:944-975`, `stats.rs:43-45, 384`) | PROPOSED — the row's plates and side bars need it BEFORE the tape loads |
| the tape envelope's `reporter`/`side`/`winner`/`loser` | already uploaded (HANDOFF §1 sidecar fields; `REPLAY-META-SKINS-SPEC.md` §1) | live in every tape; **UNKNOWN** whether the v5 top-level fields are cheaply readable client-side before the engine opens the tape |
| bus event `{type:'tape', key, state}` | HANDOFF §3 | contract exists, server not built, client not wired |

### Gate

The skins gate from `REPLAY-META-SKINS-SPEC.md` §3.3 on a LIVE row: the frame sha differs from stock only in each character's
palette indices, on the correct side; the side bars match the health bars' sides on the picture; a requested archived tape
flips `⏳ → ▶` with no reload; the envelope read adds < 1 s to TTFF on a 14 MB tape (measured, logged on `onready`).

### Risks

- Envelope-derived seats and C10-echoed seats can disagree (a stale reporter side); the tape is the ground truth for the picture —
  the embed prefers the envelope and logs a mismatch.
- Derivation happens after the fetch: for ~1 s the plates render in row order, then re-anchor. Acceptable (the picture has not
  drawn yet); never re-sort after the first frame.

---

## Phase D — reach: tournaments, creator stats, the poster (needs **C11**, **C15**, **C7**)

### Files

| File | Change |
|---|---|
| `pwa/src/lib/tourney.ts` | `BracketMatch` gains `session_id?` (+ `match_key?`) |
| `pwa/src/routes/tournament/[id]/+page.svelte` (+ the TO console) | `ReplayAffordance size="chip"` in the match-card header, right of the state chip, only when `state === 'done' && session_id`; tap → SessionModal (THE TAPE) for that set — per-game `▶ REPLAY` already lives there (`SetReceipt.svelte`); until C11 nothing (never a `▶ TAPE` of unknown availability) |
| `pwa/src/routes/u/[steamid]/+page.svelte` | a `StatTile` row **SKINS**: `N designs` · `worn by M players` · `in K replays` (K only when the archive indexes by player) + a rack of the creator's public designs (opens the wearer-side try-on) |
| `pwa/src/lib/share.ts` / `SetReceipt.svelte` / `ReplayEmbed.svelte` (`poster` prop) | share links and the embed poster switch from `GET /rr/ogimg/<session>.png` to `GET /rr/poster/<match_key>.png` when it 200s (fallback to the fight card) |
| `pwa/src/lib/replay/export.ts` (NEW, spec only) | the client-side composite (below) |

### The export path — poster still = canvas frame + overlay composited (SPEC ONLY, no build)

**One template, three renderers.** The poster binds the SAME template document to the SAME `OverlayMeta` as the player
(`REPLAY-OVERLAY-TEMPLATE.md` §5): server-side (C7) the `elements[]` tree renders to SVG text nodes at 2× in the existing
fight-card pipeline (SVG → resvg → PNG) over the KO frame; client-side the live `.ovl` DOM goes through an SVG
`<foreignObject>` over `readback()` pixels. Placements therefore cannot drift between the player and the poster, and a
template shipped at `/rr/update/overlay-template.json` restyles both without a deploy.

Two producers, one artefact (a 1200×630 PNG, spec §2.4): the 640×480 scene rendered at 2× (1280×960) with the overlay in
its **full** state, letterboxed into 1200×630 → picture 840×630 (k 1.3125), plain `#000` around it, KO frame (session stats
`deaths`, else N−60, never frame 0).

1. **Client composite (PWA, no server)** — for `⧉ Copy image` / `Save poster` on a player that already has the frame:
   - the pixels: `player.readback()` (RGBA of the scene target, the exact bytes the L3 gate compares) → `ImageData` →
     `OffscreenCanvas(1280, 960)` with `imageSmoothingEnabled = false` (2× nearest — the game's pixels, unfiltered);
   - the layer: the SAME `.ovl` subtree serialised into an SVG `<foreignObject>` (`XMLSerializer` + the component's
     computed styles inlined per node, fonts embedded as data: URIs — Inter/JetBrains Mono are the app's own files;
     avatars and 16 px sprite icons drawn from their already-loaded `<img>`/`<canvas>` sources as data: URIs, so no
     cross-origin taint) → `drawImage` at 2× onto the composite; then the 1200×630 letterbox → `canvas.toBlob('image/png')`;
   - **UNKNOWN**: whether Steam avatar images are CORS-enabled for canvas use (`steamstatic.com`); if not, the avatar is
     omitted from the export (the name is the credit) — decide when built. No html-to-canvas library: the layer is < 20
     nodes and the fonts are ours;
   - gate: the poster's 840×630 picture region, downscaled back to 640×480 by integer sampling, is byte-equal to the
     embed's `readback()` of the same frame (the layer is drawn AFTER, so the region under it is compared with the
     layer hidden).
2. **Server render (C7, UNKNOWN owner)** — for share links and Discord embeds (the only place a creator's name reaches a chat):
   the fight-card pipeline (`ogimg.rs`, SVG → resvg → PNG with `chars-png` portraits) draws the identity half today; the picture
   half needs a headless tape-frame render that does not exist server-side (the render lane's WebGPU path is browser-only).
   Until it exists the poster stays the OG fight card. The same composite per frame is the (later) video export.

### Data

| Datum | Contract | Status |
|---|---|---|
| `session_id` on `BracketMatch` | **C11** (HANDOFF §6; server `tourney.rs`) | PROPOSED |
| `GET /rr/profile` → `skins: {designs, worn_by, in_replays?}` | **C15** (spec §4.4) | PROPOSED; `in_replays` also needs the archive's per-player tape index — **UNKNOWN** whether lane 1 indexes by player (HANDOFF §1 sidecars are per session/match) |
| `GET /rr/poster/<match_key>.png` | **C7** (LIVE-TAB-SPEC C7) | UNKNOWN owner |
| the KO frame index per game | `/rr/session` stats `deaths` (`SetReceipt.svelte:42, 234-242`) | live where the stats exist |

### Gate

A bracket `done` card opens the right set; the poster's picture region is byte-equal to the embed's `readback()` of the same
frame (client composite) and, once C7 exists, the server poster equals the client composite pixel-for-pixel; creator counts
reconcile against `loadouts.json` by a script; a share link's OG image shows the credit line ≥ 7 px in a 500-wide chat embed.

### Risks

- The poster is a public image while replays are sign-in only (Q7 for Tris): keep or strip the names/credits from the public still.
- `in K replays` is a definition, not a measurement, until the archive index exists (Q8).
- The tournament chip is nothing until C11; do not infer a set from `p1/p2 + ts`.

---

## Cross-phase: what stays UNKNOWN in this folder

- The exact `POST /rr/loadout` arm on the server (spec §4.2 flags it; not read here — server repo is not this lane).
- Whether the v5 tape envelope's top-level fields are cheaply readable before the engine opens it (Phase C measures).
- Whether the agent can build an asset pack for a tape (**C12**; no pack builder found under `agent/`) — the nopack panel
  therefore offers no `Pack it with Retro Receipts ›` action yet, only the honest copy.
- A `stage_id → name` table (**C8**) — `Stage 13` until the render lane ships it.
- Steam avatar CORS for the client composite (Phase D).
