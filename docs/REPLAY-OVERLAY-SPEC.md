# REPLAY OVERLAY + CREATOR CREDIT — spec (2026-09-03, rev 2: ON-PICTURE)

The replay gets a broadcast overlay **drawn on the rendered screen, the way OBS draws an overlay**: P1's plate
bottom-left, P2's bottom-right (the game's own HUD sides), the match record under the timer, RETRO RECEIPTS
bottom-centre — and **credit for every custom skin on screen that someone else made**. One layer in 640×480
picture coordinates that scales with the picture, so it is identical inline, in fullscreen, on phones, and in
the exported poster/video.

Status: DESIGN. No Svelte/TS/Rust was changed for this spec. Every claim is cited to a file:line in this
projects folder or marked **UNKNOWN**. Mockup: `docs/mockups/replay-overlay.html` (self-contained; game art =
labelled placeholder boxes; Google Fonts only). Parent spec: `docs/LIVE-TAB-SPEC.md` (§7 ReplayEmbed).

Tris's direction (verbatim intent): *"give credit for skins used/selected if they are by a creator — need to
give credit. This can all be in the overlay, like an OBS overlay, with the user's name on their side and proper
placement for the other metadata like skin attribution."* Revision: *"the overlay is just that — we draw ON the
rendered screen like OBS draws an overlay, so all metadata is inside the match replay."* Earlier: metadata =
names, rank badge linking to `nobd.net/app/ranks`, date/time, stage, and a `RETRO RECEIPTS · nobd.net/app/ranks`
watermark; each player's own cloud skin shows on their side.

**The rule that changes (rev 2):** the game's pixels stay exact underneath — the overlay is a separate layer,
never drawn into the WebGPU canvas, and every pixel gate reads the scene target (`player.readback()`,
`ReplayEmbed.svelte:665-670`), not the composite — but **the picture may be overlaid**. This amends
LIVE-TAB-SPEC §1.6 / §7.10 ("nothing overlays the 640×480 picture") and `ReplayEmbed.svelte:25-26`; the
render-only-game-assets rule is untouched (the layer is HTML chrome, not drawn game art).

Hard rules: house voice, short copy, tokens from `pwa/src/app.css:6-34`; sizes in picture pixels (9 px x-height
floor at 1× so type survives 640 px and reads at 2×/4×); mobile + desktop; accessible.

---

## 0. What exists today (source of truth)

| Thing | Where | Today |
|---|---|---|
| The embed | `pwa/src/lib/components/ReplayEmbed.svelte` | chrome-top = plate A · score/mode/FT/game/date/stage/duration · plate B (`771-782`); picture capped at 640 px inline (`934-947`); transport under it (`842`); watermark `RETRO RECEIPTS · nobd.net/app/ranks · date` under the transport (`849`, CSS `1213-1237`); fullscreen = 3-column grid `a pic b`, plates in the pillars, transport as a 56 px fading HUD over the bottom of the picture on a 60 % scrim (`1247-1335`); portrait = rows `a / pic / b` (`1337-1372`); HUD fade 2.5 s (`615-620`) |
| The picture element | `ReplayEmbed.svelte:787-839` | `.pic` is `position: relative` with the canvas + absolutely-positioned `.ov` state overlays already inside it — the overlay layer is one more absolutely-positioned child |
| The real frame measured for this spec | `scratchpad/frame_60_res4_box.png` (a rendered frame, 650×488 with a 2–3 px box border; game area x 3–646, y 2–485 ⇒ coordinates below are normalised x−3, y−2, ±4 px) | see §2.1 |
| Who is left/right | `routes/match/+page.svelte:241-254` (`metaOf`: **a = winner**, b = loser); `SetReceipt.svelte:325-347` (a = left seat, b = right seat = viewer/winner); `MatchReceipt.svelte:101-117` (a = challenger) | the embed renders `meta.a` left, `meta.b` right — three callers, three different meanings of "left" |
| Physical seats | `ReplayEmbed.svelte:53-55` (`meta.p1/p2`), `lib/replay/source.ts:189-197` (`seatsOf` needs `side`+`reporter`), `matchfeed.svelte.ts:45-47` (fields declared, "absent today") | the emitter paints P1's loadout on slots 0/2/4 and P2's on 1/3/5 (`ReplayEmbed.svelte:202-231`); unknown seats = stock |
| Seats on the server | `RetroReceipts-server/server/src/models.rs:291-293` (`wside`/`lside` on `MatchLog`: reporter-claimed physical side of the winner/loser) | emitted **only** on the money receipt (`receipt.rs:203`); **not** in the ONE `match_result` builder (`app.rs:944-975`) and **not** on `/rr/session` games (`stats.rs:43-45, 384`) |
| Seats in the tape | `mvc-live-skins-quarters/docs/REPLAY-META-SKINS-SPEC.md` §1 | the tape envelope carries `reporter`, `winner`, `loser`, `side`, `local_pn`, `seat_map` |
| Public loadout | `routes.rs:587-613` → `{ok, steamid, loadout:[{cid, colors[16]}]}`; batch `?steamids=` (≤25, players without a loadout omitted) | `CharSkin {cid: u8, colors: Vec<u32>}` (`models.rs:39-43`) — **no skin id, no author** |
| The equip write | `loadouts.svelte.ts:293-313` `POST /rr/loadout {cid, colors}` | the rack knows which vault card was tried on (`trying.vaultId`, `routes/skins/[cid]/+page.svelte:37, 54`) but `wear()` sends only the palette (`64-77`) — **provenance is dropped here** |
| The vault | `vault.svelte.ts:1-17, 72-90`; server `handle_skin_save` (`routes.rs:2408-2449`), `SavedSkin {id, cid, name, palette, author, created_ms, updated_ms}` (`models.rs:77-91`) | `author` is a free string ≤60; the PWA **always sends `author: ''`** (`vault.svelte.ts:79`, `DyeStation.svelte:162`); a saved share-code skin also drops the code's author (`[cid]/+page.svelte:158`) |
| Share codes | `lib/skincodes.ts:2-19, 45-61` | carry `author` as a ≤40-byte string ("credit … renders wherever the skin shows") — a name, not a SteamID |
| Community library | `[cid]/+page.svelte:87-111` (`static/community/<cid>.json` = `{a: author, p: [16 ints]}`) | credited by name string only ("after the PalMod scene") |
| Where credit shows today | rack cards `by you` / `shared code · by X` / `CAPCOM · 2000` (`[cid]/+page.svelte:153, 169, 185, 208`); locker stage `“NAME” · ● WORN` (`skins/+page.svelte:135`) | nowhere outside the studio: nothing on a replay, a receipt, or a profile |
| Rank badge link | `PlayerPlate.svelte:75` (`rankHref`), used by the embed (`ReplayEmbed.svelte:709` → `{base}/ranks`) | shipped |
| Poster | `ReplayEmbed.svelte:74-75, 788-792`; `ReplaySheet.svelte:58` | the OG fight card `GET /rr/ogimg/<session>.png` (server SVG→PNG via resvg + `chars-png` portraits, `ogimg.rs:17, 264-269`); no tape-frame poster exists (LIVE-TAB-SPEC C7) |
| Availability states | `lib/replay/source.ts:20-27, 157-187`; `ReplayAffordance.svelte:187-204`; `ReplayEmbed.svelte:58, 808-834` | `ready · pending · archived · requested · expired · none · unsupported · signin` + `nopack` (embed-only) |
| Archive contract | `mvc-live-skins-quarters/docs/HANDOFF-LANE1-TAPE-ARCHIVE.md` §2-3, §6 | `GET /rr/tape?key=`, `POST /rr/tape/request` → `pending`, bus event `{type:'tape', key, state:'ready'}`; §6 asks lane 1 for `side`+`reporter` on results/session games and a set reference on `BracketMatch` |
| Tournament rows | `lib/tourney.ts:42-60` (`BracketMatch`: no `session_id`/`match_key`); card `routes/tournament/[id]/+page.svelte:228-238` | no replay affordance anywhere in tournaments |

---

## 1. Decisions (one line each)

1. **The overlay is a layer on the picture.** A 640×480 DOM layer inside `.pic`, `transform: scale(picture width / 640)`, `pointer-events: none` except its links. It is never drawn into the canvas; `readback()` and every sha gate read the scene target and are unaffected.
2. **Sides are the game's sides.** P1's plate bottom-LEFT, P2's bottom-RIGHT — under the same side's health bar and next to the same side's LEVEL pod. The one surface where "winner reads right" yields; the winner is marked in gold, never re-sorted (commandment 9).
3. **Unknown seats = the row's order, unlabelled.** No side accent, no guess; the picture plays stock and the record stamp says `stock colors` (§5a).
4. **Everything lives in the HUD's own dead zones.** Measured on a real frame (§2.1): the plates sit in the lower thirds above the LEVEL pods; the record stamp sits in the gap between the two assist stacks under the timer; the watermark sits on the hairline above the hyper bars. Nothing is placed over a health bar, a portrait, the timer, a LEVEL pod or a hyper bar.
5. **Full overlay for the first 3 s, on pause, hover/tap, and the last 3 s; a minimal form (plates without credits + watermark) while playing.** Reason in §2.5; Q9 asks Tris to confirm or make it always-on.
6. **Credit is a line under the plate.** `[16 px sprite] NIGHTFALL by Ruby`, one per credited skin, stacked upward from the plate, at most three. Stock = nothing. Own-made = the name without a by-line (§3.4; Q1).
7. **The creator's name is a link** when we hold a SteamID; a plain string when we hold only a name. Never an `@` — the app has no handles; names come from the one resolver (`app.rs:954-956`, DESIGN-SYSTEM.md:59, 77).
8. **Fullscreen pillars are plain black.** No plates there (rev 2): the overlay travels with the picture, so a 16:9 screen shows black pillars and the same 640×480 layer scaled to the picture.
9. **Provenance rides the loadout.** `GET /rr/loadout` gains `skin_id, name, author_steamid, author_name, source` per character (§4). The tape stays identity-free (`REPLAY-META-SKINS-SPEC.md` §1).
10. **Derive seats before asking.** The tape envelope already names the reporter's side; the embed reads it after the fetch so skins paint on old tapes too. The server echo is still requested (§5a).
11. **Tournaments open the set, not a game.** (§5b)

---

## 2. The overlay — on-picture placement (640×480 units)

### 2.1 The game's own HUD, measured on a real frame

`frame_60_res4_box.png`, normalised to 640×480 (±4 px). These are the no-go zones.

| Game HUD element | x | y | Note |
|---|---|---|---|
| P1 portrait | 0–42 | 25–101 | three stacked portraits at the far left |
| P1 health + assist bars, names | 46–269 | 25–101 | main bar y 31–42, names y 49–57, assists y 62–91, assist names y 74–101 |
| Timer ring + `TIME` | 304–337 | 25–52 | top-centre |
| **Dead gap between the assist stacks** | **269–374** | **55–101** | 105 × 46 px of plain stage under the timer — the record stamp goes here |
| P2 health + assist bars, names | 374–595 | 25–101 | mirror |
| P2 portrait | 598–640 | 25–101 | |
| The fight | 0–640 | 101–434 | characters' feet at ≈ y 440–450 |
| P1 LEVEL pod | 0–66 | 434–476 | bottom-left |
| P1 hyper bar | 57–296 | 453–473 | |
| **Gap between the hyper bars** | 296–337 | 453–473 | only 41 px wide — too narrow for the watermark at the type floor (§2.2) |
| P2 hyper bar | 337–596 | 453–473 | |
| P2 LEVEL pod | 574–640 | 434–476 | bottom-right |

### 2.2 Placement table — the overlay layer

All values in picture pixels; the layer scales uniformly with the picture. Type: names Inter 700 13 px
(x-height 9), record/credit/rating JetBrains Mono 12 px (x-height ≈ 9), score Barlow Condensed 900 italic 18 px,
watermark JetBrains Mono 11 px caps (decorative; the one line under the floor, §6). Plates use
`rgba(0,0,0,.65)` — not the suggested `.55`, because `--ink` on `.55` black over a white game pixel is 3.3:1
and on `.65` it is 5.3:1 (§6). Corner radius 3 px, padding 3 px.

| # | Element | Anchor | x | y | w | h | Opacity / fill | Full | Minimal |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **P1 plate** — `[2 px --p1 bar][av 20][flag][name 13 px, gold if winner][rank badge 12 → /ranks][rating 12 mono][set score 18 cond.]` | bottom-left, bottom edge y 430 | 8 | 404–430 | auto ≤ 220 | 26 | plate `rgba(0,0,0,.65)`, text `--ink`/`--dim`, side bar `--p1` | ● | ● |
| 2 | **P1 credits** — up to 3 lines `[spr 16] "NIGHTFALL" by Ruby`, stacked ABOVE the plate, newest slot at the bottom (slot order top→bottom = point, second, anchor) | bottom-left, grows upward from y 404 | 8 | 353–404 (3 lines) / 370–404 (2) / 387–404 (1) | same as the plate | 17 per line | same plate fill (one box with the plate: h 26 + 17 n) | ● | — |
| 3 | **P2 plate** — mirror of #1, right-aligned, side bar `--p2` on the right edge | bottom-right, right edge x 632 | 632 − w | 404–430 | auto ≤ 220 | 26 | as #1 | ● | ● |
| 4 | **P2 credits** — mirror of #2 | bottom-right, grows upward | 632 − w | as #2 | as #3 | 17 per line | as #2 | ● | — |
| 5 | **Record stamp** — 3 mono lines centred: `RANKED · FT3 · G3` / `2026-09-02 21:14` / `CLOCK TOWER` (`stock colors` appended as a 4th line only in the seats-unknown state) | top-centre, under `TIME` | 269–374 (centred on x 320, auto width ≤ 104) | 56–98 | ≤ 104 | 42 (3 × 14) | `rgba(0,0,0,.65)`, text `--dim`; mode chip text `--gold` when money | ● | — |
| 6 | **Watermark** — `RETRO RECEIPTS · nobd.net/app/ranks` (link) | bottom-centre, on the hairline above the hyper bars | 204–436 (centred, auto ≈ 232) | 437–449 | ≈ 232 | 12 | `rgba(0,0,0,.5)`, text `rgba(255,255,255,.7)` | ● | ● |
| 7 | **`SAVED` pill** (paid save, LIVE-TAB-SPEC §7.11) | right of the record stamp | 378–420 | 58–70 | ≈ 42 | 12 | gold fill, `--gold-ink` text | ● | — |
| 8 | **Transport HUD** (fullscreen only, unchanged) | bottom edge of the picture, over #1/#3/#6 while shown | 0 | 424–480 | 640 | 56 | `rgba(0,0,0,.6)`; fades 2.5 s (`ReplayEmbed.svelte:615-620, 1292-1304`) | on poke | on poke |

Collision checks against §2.1: #1/#3 end at y 430, the LEVEL pods start at y 434 (4 px clear); #1 starts at
x 8 and the P1 pod occupies x 0–66 **below** y 434 only; #5 sits inside the 105 × 46 dead gap with 1 px to
spare each side; #6 sits at y 437–449 between the pods (x 66–574 is free at that height) and above the bars
(y 453). The full-mode credit stack tops out at y 353 — the lower 16 % of the corner, where a cornered
character's legs can pass under it; that is the one accepted overlap, and it is why credits are not persistent (§2.5).

Why the watermark is not *between* the hyper bars: the gap is 41 px (§2.1) and the shortest honest watermark
at 11 px mono is ≈ 232 px. Splitting it into two 5 px lines would break the type floor, so it sits 4 px above
the bars, centred between the pods — still bottom-centre, still clear of every bar.

Why the score is in the plates, not the stamp: `2 – 1 · RANKED · FT3 · G3` at 12 px mono is 166 px and the
gap is 105; a scorebug puts the digit next to the name anyway.

### 2.3 Implementation shape (so the layer is identical everywhere)

```
.pic (position: relative; aspect-ratio 4/3)              ← ReplayEmbed.svelte:936-947
  canvas 640×480                                          ← the game's pixels, untouched
  .ovl  { position:absolute; left:0; top:0; width:640px; height:480px;
          transform: scale(var(--k)); transform-origin: 0 0; pointer-events: none }
        --k = picture CSS width / 640  (inline 1×, fullscreen fsScale, phone landscape 0.81, portrait 0.61)
    .plate.p1  .plate.p2  .stamp  .wm  (links: pointer-events: auto)
```

- Same DOM, same coordinates in every frame; fullscreen just changes `--k` (today's `--fsw`, `768`).
  The pillars/bands of `ReplayEmbed.svelte:1247-1372` lose their plates and become plain `#000`.
- The layer is a sibling of the canvas, never composited into it, so `readback()` (`665-670`) and the L3/skins
  gates are unchanged by construction. The **exported poster/video** is the composite (scene + layer) — the
  only artefact that contains both, and it is produced from the same DOM (§2.4).
- Physical sizes per frame (13 px name): inline 1× → 13 px; fullscreen 1080p (2×) → 26 px; 4K (4×) → 52 px;
  phone landscape 844×390 (0.81×) → 10.5 px; phone portrait 390 wide (0.61×) → 8 px. Below `--k` 0.75 the
  layer is **minimal-only while playing** (the full form still appears on pause) — the geometry stays
  identical, only the timing rule tightens; the `Turn your phone` hint (`ReplayEmbed.svelte:838`) is the fix.

### 2.4 The poster still and exported video

Same layer, baked. Poster = 1200×630 (the OG size, `ogimg.rs:268`) = the 640×480 composite centred at 1×
with plain `#000` around it (no pillar plates — rev 2), so the still equals a screenshot of the player. Frame
choice: the last KO (session stats `deaths`, `SetReceipt.svelte:42, 234-242`), else N−60; never frame 0. Full
overlay state (credits shown). Text floor holds because the credit line is 12 px at 1× — on a 1200-wide card
downscaled to ~500 px in a chat embed that is 5 px; **the poster therefore renders the layer at 2× inside a
1280×960 composite letterboxed into 1200×630** (picture 840×630, layer `--k` 1.31). UNKNOWN: server-side
tape-frame render (C7) — the fight-card SVG pipeline draws the identity half today; until it exists the poster
stays the OG fight card. Video export (later) = the same composite per frame.

### 2.5 Timing — full vs minimal

| State | Layer |
|---|---|
| `ready` (poster shown), first 3 s of `playing` | **full**: plates + credits + stamp + watermark (+ SAVED) |
| `playing` after 3 s | **minimal**: plates (no credits) + watermark. Crossfade 300 ms; reduced motion = cut |
| `paused`, `seeking`, `ended`, hover (pointer over `.pic`), tap/poke in fullscreen | **full** while it lasts (+ 3 s after the pointer leaves) |
| last 3 s before `ended` | **full** (end credits) |
| `unavailable`/`nopack`/`error`/`loading` | no layer — the `.ov` state panels stand alone (`808-837`) |

Why not always-on: the full form covers up to 220 × 77 px in each lower corner (≈ 5.5 % of the picture each) —
exactly where a cornered character, a super freeze and the LEVEL pod's flash live. Minimal keeps the OBS feel
(names + watermark are 26 px and 12 px tall, in the HUD's own dead rows) and any screenshot still carries the
watermark. Credit still reaches every viewer: at the start, at the end, and on any pause. Q9.

### 2.6 Inline vs fullscreen vs phone (what changes)

| Frame | Picture (`--k`) | Around the picture | Transport |
|---|---|---|---|
| Inline card | ≤ 640 px (1×) | `--panel` chrome-top **shrinks to one 28 px meta row** (mode · FT · game · date · stage · duration · actions) — the plates moved onto the picture; the actions row stays (`match/+page.svelte:443-458`) | 44 px row under the picture, unchanged |
| Fullscreen 16:9 | 2× at 1080p, 4× at 4K | plain `#000` pillars/bands — no plates, no watermark (all on the picture) | fading HUD over the bottom 56 px |
| Phone landscape 844×390 | 0.81× | `#000` pillars 162 px, empty | fading HUD, 48 px targets |
| Phone portrait | 0.61× | `#000` bands; the transport in the bottom band never fades (`1357-1367`) | static |
| Poster | 1.31× | `#000` | none |

---

## 3. Creator credit — the rules

### 3.1 The line

```
[spr 16] "NIGHTFALL" by Ruby
 └char┘   └skin name┘  └author: link to /u/<author_steamid> when known, plain text when not┘
```

- The character is its own 16 px still sprite (`CharSprite still`, wearing the skin — `PlayerPlate.svelte:82`),
  not a text tag: it costs 16 px where `STORM · ` costs 50. Skin name quoted, `--ink`, 700. `by <name>`:
  `--stream` (skins/worn hue, DESIGN-SYSTEM.md:15) — a link when `author_steamid` is present.
- 12 px JetBrains Mono, 17 px leading (16 px icon + 1). Max width 220 px = icon 16 + gap 4 + 28 characters.
- Truncation order: drop the quotes → ellipsis the skin name at 14 chars → never drop the author. The author is the point.

### 3.2 When a line appears

| Skin on the character | Overlay line | Reason |
|---|---|---|
| stock (no loadout entry) | nothing | Tris: "stock = nothing shown" |
| custom, `author_steamid === wearer` | `[spr] "NIGHTFALL"` (no by-line) | the plate above is the credit; the name is the way into the rack (Q1) |
| custom, `author_steamid` present, ≠ wearer | `[spr] "NIGHTFALL" by <Ruby>` (linked) | the credit |
| custom, only `author_name` (share code / community) | `[spr] "NIGHTFALL" by Ruby` (plain) | we hold a name, not an identity — credit it, don't fake a link |
| custom, no name and no author (legacy loadout, DyeStation not saved) | nothing | nothing truthful to say; the skin still paints |
| loadout unknown (seats unknown, §5a) | nothing; the stamp gains `stock colors` | the picture is stock — a credit for a skin not on screen would be a lie |

### 3.3 Three custom skins on one side

Three lines stacked above the plate in slot order (point on top, anchor nearest the plate — the anchor is the
character most likely on screen at the end). The box grows upward from y 404 to y 353 (§2.2 #2); both corners
can carry three at once with no collision because each plate owns its corner. Credits show only in the full
state (§2.5), so the 77 px box is on screen for the first 3 s, the last 3 s, and whenever the viewer pauses.
Phone landscape (0.81×) renders the same box at 62 px physical — legible; portrait (0.61×) shows credits on
pause only (§2.3).

### 3.4 Wearer is the author

`author_steamid === wearer.steamid` → no by-line anywhere on the replay; in the studio it reads `by you`
(already, `[cid]/+page.svelte:169`); on the wearer's profile it reads `own design`. A creator wearing their own
skin still counts in their creator stats (§4.4) — they are a wearer too.

### 3.5 Credit beyond the replay

| Surface | What | Where in code |
|---|---|---|
| **Skin studio — rack card** | `by <author>` (linked when SteamID known) replaces the bare `shared code · by X`; community cards keep the string credit | `[cid]/+page.svelte:149-160, 163-179, 198-215` |
| **Skin studio — locker stage** | `“NIGHTFALL” · by Ruby · ● WORN` under each main (today: `“NAME” · ● WORN`, `skins/+page.svelte:135`) | `skinLabel` (`74-80`) gains the author |
| **Wearer's profile** (`/u/<sid>`) | under the hero plate's 68 px sprites: one `SkinCredit` line per credited skin (`WEARING · STORM "NIGHTFALL" by Ruby · CABLE "DUSK" by Ruby`) | `routes/u/[steamid]/+page.svelte:227-241` |
| **Creator's profile** | a `StatTile`-row section **SKINS**: `N designs` · `worn by M players` · `in K replays` (§4.4) + a rack of their public designs (opens the wearer-side try-on) | new section after the hero; `StatTile.svelte` |
| **Receipts** (THE TAPE) | no lines — the receipt is the record of the set, not of costumes; the sprites already wear the skins (`SetReceipt.svelte:391-395, 436, 447`). The `ⓘ CUSTOM SKINS ON` hint (`420`) stays | — |
| **Live cards / boards** | none — density (commandment 8: shed from the edges) | — |

`SkinCredit.svelte` = ONE component for the line, consumed by the overlay layer, the rack, the locker, the
profile (outside the picture it may use the text character tag instead of the icon). Suffix: none of
Banner/Card/Row/Plate/Tile/Receipt/Embed fits a one-line attribution; proposed amendment (§8): **Credit** = a
one-line attribution (thing · name · author link), leaf, owns no fetches.

---

## 4. Provenance end to end (the loadout payload)

### 4.1 Proposed public shape

```jsonc
GET /rr/loadout?steamid=<sid>   →  { ok, steamid, loadout: [ CharSkin… ] }
CharSkin = {
  cid: 42, colors: [16 × 0xRRGGBB],            // today (models.rs:39-43) — unchanged, the tray depends on it
  skin_id?: "uuid",                            // the vault SavedSkin.id it was equipped from
  name?: "NIGHTFALL",                          // SavedSkin.name at equip time (display; re-read from the vault when skin_id resolves)
  author_steamid?: "7656…",                    // the vault OWNER of skin_id, or the code's author when it carried an id (Q3)
  author_name?: "Ruby",                        // resolved at READ time via disp_name when author_steamid is set; else the string we hold
  source?: "vault" | "code" | "community" | "legacy"
}
```

The brief's proposal `[{cid, colors, skin_id, name, author_steamid, author_name}]` is adopted with one
addition, `source`, because the credit rule differs by source (§3.2) and the server should not have to infer
it from which fields are null.

### 4.2 The write path (where provenance is lost today and how it is kept)

| Step | Today | Change |
|---|---|---|
| Try-on from a vault card | `tryOn(v.palette, v.name, 'you', v.id)` — the rack knows the id (`[cid]/+page.svelte:173`) | — |
| WEAR IT | `loadouts.equipOwn(cid, pal)` → `POST /rr/loadout {cid, colors}` (`64-77`; `loadouts.svelte.ts:300-303`) | pass `{cid, colors, skin_id, source}` from `trying` (`vaultId` → `vault`; a code card → `code` + `author_name`; a community card → `community` + `author_name`) |
| Server equip | stores `CharSkin` (`routes.rs:587-613` region; **UNKNOWN** exact POST arm — not read) | store the extra fields; resolve `author_steamid` from `skin_id` (an index `skin_id → owner` over `user_skins`, `app.rs:103-105`; the Surreal mirror `skin:<id>` already exists, `routes.rs:2446`) |
| Save a code to the vault | `vault.save(cid, name, palette)` sends `author: ''` (`[cid]/+page.svelte:158`; `vault.svelte.ts:79`) | send `codeSkin.author`; the vault's `author` field finally carries something |
| Save from the Dye Station | `author: ''` (`DyeStation.svelte:162`; `vault.svelte.ts:79`) | leave `author` empty = **own design** (the owner is the author by definition; never store a name string for yourself — SSOT names, DESIGN-SYSTEM.md:59) |
| Share code | carries `author` string (`skincodes.ts:45-61`) | v2 code adds an optional 17-digit `author_steamid` so a pasted code can link its creator (Q3) |
| Public read | `{cid, colors}` (`routes.rs:597-601`) | echo the new fields; **`author_name` is computed at read time** from `author_steamid` when set (`disp_name`), so a renamed creator is credited under their current name on every old replay |

Client store: `loadouts.svelte.ts:normalize` (`26-37`) keeps `{cid: hex[16]}` for the palette remapper and
gains a parallel `credits: {cid: {skin_id, name, author_steamid, author_name, source}}` — same fetch, same
cache, `peek()` unchanged for every existing consumer.

### 4.3 The re-resolution rule

Skins are resolved at replay time, never baked (`REPLAY-META-SKINS-SPEC.md` §1). Credit follows the same rule:
a replay shows **what the wearer wears now** and credits **who made that**. If Tris wants "what they wore that
night", the server must snapshot `CharSkin[]` per `match_key` at result time — a different product (Q2).
(The exported poster/video is the exception by nature: it bakes whatever was true at export time.)

### 4.4 Creator stats (the creator's profile)

| Stat | Definition | Cost |
|---|---|---|
| `N designs` | `user_skins[creator].len()` (`app.rs:103`) | free |
| `worn by M players` | count of loadouts (`app.loadouts`, `app.rs:111`) with any `author_steamid === creator` | one pass over `loadouts.json` (≤ a few thousand rows); cache per creator, invalidate on any loadout write |
| `in K replays` | replays that render with a skin by this creator = Σ over wearers of (their tapes with `state ∈ {ready, archived, saved}`) | needs the tape index per player (HANDOFF §1 sidecars; **UNKNOWN** whether lane 1 indexes by player) — Phase D |

The first two ship with the payload; the third waits for the archive index.

---

## 5. Today's unknowns — a UX decision for each

### 5a. LIVE rows and session games have no seats (P1/P2 unknown)

**Fact:** the server already knows — `wside`/`lside` on every `MatchLog` (`models.rs:291-293`) — and emits it on
the money receipt (`receipt.rs:203`) but not on `match_result` (`app.rs:944-975`) or `/rr/session` games
(`stats.rs:43-45, 384`). The tape envelope also carries the reporter's side (`REPLAY-META-SKINS-SPEC.md` §1).

**Decision:**
1. **Derive first.** After the tape bytes land (`ReplayEmbed.svelte:272`), read `reporter` + `side` (+ `winner`/`loser`)
   from the envelope and run `seatsOf` on them before `p.load(...)` (`292-300`) — the same function, tape-fed.
   Skins then paint on every tape that already exists, with zero server work. **UNKNOWN**: whether the v5
   envelope's top-level fields are cheaply readable client-side (one `DecompressionStream` pass over a
   ≤ 14 MB gz; the engine decompresses it again — acceptable, Phase C measures it).
2. **Still ask for the echo (C10).** The row's plates and the credit lines render *before* the tape loads, and
   the LIVE list primes loadouts per row (`match/+page.svelte:181-187`); they need `side` + `reporter` on the
   payload (HANDOFF §6). Both the ONE builder and the session games: add `"wside": m.wside, "lside": m.lside,
   "reporter": m.reporter` — fields the struct already has.
3. **Until either lands:** the picture plays **stock**; the plates carry no `--p1`/`--p2` side bar (sides are the
   row's order, unlabelled); the record stamp gains a 4th line `stock colors` (title: "Seats unknown for this
   tape — colors are the game's own"). No credit lines (§3.2). No "skins pending" banner: a note about missing
   chrome is noise on top of a picture that is correct either way.
4. The plates' team sprites (if shown outside the picture, e.g. the chrome-top row) may still wear the owners'
   skins while the picture is stock — tolerated **only** in this state and why the `stock colors` marker exists.

### 5b. Tournament bracket rows have no set reference

**Fact:** `BracketMatch` has `p1/p2/winner/score/state/lobby_id/on_stream` and no `session_id`/`match_key`
(`lib/tourney.ts:42-60`); the card renders id, state chip, two seats (`tournament/[id]/+page.svelte:228-238`).
HANDOFF §6 already asks lane 1 for the reference.

**Decision:** the affordance lives on the **match card header**, right of the state chip, only when
`state === 'done'` **and** `session_id` is present (C11). It is `ReplayAffordance size="chip"` with the set's
availability, and tapping it opens the **SetReceipt** (SessionModal) for that set — because a bracket match is
an FT set of 2–5 games, and "the replay" of a set is its per-game `▶ REPLAY` rows (`SetReceipt.svelte:455`),
which already work. Not the set page, not a new route: the SessionModal is one tap from anywhere and keeps the
bracket under it. `on_stream` cards additionally keep their stream affordance. Until C11: **nothing** on the
card (LIVE-TAB-SPEC §7.11: never a `▶ TAPE` whose availability is unknown). The TO console gets the same chip
(it consumes the same taxonomy, DESIGN-SYSTEM.md:44).

### 5c. `nopack` — tape ready on the server, no asset pack on this device

**Fact:** packs are ROM-derived, never server-hosted (HANDOFF §5); the resolver returns `packUrl: ''` and the
embed shows "Asset pack not on this device yet…" (`source.ts:12-15, 95-99`; `ReplayEmbed.svelte:251-255, 830`).
Tris: host/lobby nodes that own the game will derive/serve packs (HANDOFF §5) — **UNKNOWN** whether the agent
builds packs today (`agent/src/reader.rs` is the tape reader; no pack builder found in `agent/`).

**Decision — copy and next action:**
- Head: `Tape's in. Art isn't.`
- Sub: `Replays draw with the game's own art, packed from a copy of MvC2. This browser has no pack for
  <stage> · <the two teams>.`
- Action A (agent connected, `agent.status`): `Pack it with Retro Receipts ›` → tray action (C12, **UNKNOWN**
  contract). Action B (no agent / phone): `Watch on a PC with MvC2 and Retro Receipts` (text, no button) +
  `THE TAPE ›` + `⧉ Copy link` — the record is still one tap away.
- The row keeps `▶ REPLAY` (the tape exists; the device is the limit); the honest state lives in the panel.
  Rejected: a `📦 NO PACK` row state — it would flag the tape for a per-device condition and go stale the
  moment a pack lands.

### 5d. `archived` → Request replay → what the user sees

**Fact:** `POST /rr/tape/request` → `{ok, state:'pending'}`; the pull is an async, idempotent, per-user
rate-limited R2 → hot job; the bus publishes `{type:'tape', key, state:'ready'}` when it lands (HANDOFF §2-3).
There is **no queue position** in the contract and no notification system in the PWA beyond local toasts
(`[cid]/+page.svelte:546-561`; **UNKNOWN**: no push/toast store in `lib/stores`).

**Decision:**
1. On click the chip turns `⏳ TAPE INCOMING` (today, `ReplayAffordance.svelte:216`) and the panel shows
   `Tape incoming.` / `Pulled from the archives — usually under a minute.` (today's copy minus "check back":
   the user does not have to do anything, the panel does).
2. The panel **stays open and listens** to the `tape` bus event for its key → flips to `loading` by itself
   (the feed store already consumes the SSE bus, `matchfeed.svelte.ts:187-189`; one more event type). A collapsed
   row flips `⏳ → ▶` on the same event. No polling.
3. If nothing lands within 3 min, the panel adds `Still pulling — the archive is slow tonight.` and a
   `Try again` that re-probes (`probeServer(key, true)`, `source.ts:117`). No queue number is invented.
4. No notifications: the user asked from a surface that is showing the answer. If Tris wants "tell me when my
   requested tape is hot" across sessions, that is a settings-page toggle + the bus → a store → a toast (Q5).

### 5e. Signed-out viewers

**Fact:** `gated()` turns ready/archived/saved into `signin` when signed out (`source.ts:160-164`); the chip
`🔒 SIGN IN TO WATCH` is a button that starts Steam login (`ReplayAffordance.svelte:194, 210`); the embed has
a `signin` state with `Sign in to watch the tape.` + a gold `Sign in through Steam` button (`ReplayEmbed.svelte:822-824`).

**Confirmed, with two adjustments:**
- Placement stays the row's meta rail (`MatchBanner.svelte:132`). On the phone fold the meta column is 76 px
  (LIVE-TAB-SPEC §8) → the chip reads `🔒 SIGN IN`, full copy on `title`/`aria-label` (the label already strips
  the glyph for AT, `ReplayAffordance.svelte:231`).
- The chip is a login door; it must not ALSO expand the row. Today `click()` stops propagation (`207`) — keep.
  The embed's `signin` state is for deep links (a future `/replay/<key>` route) and share pages; on a list row
  the door is the chip.
- Copy: chip `🔒 SIGN IN TO WATCH`, panel `Sign in to watch the tape.` / `Replays are for players with an
  account.` — unchanged (Tris: "the whole point of the webapp is that users need to sign in to see the replays").

### 5f. Seek is slow forward (`seeking`)

**Fact:** a forward seek decodes the gap on the main thread at ~25 ms/frame (LIVE-TAB-SPEC §7.8); the embed
shows `skipping ahead…`, a two-tone scrub fill (served vs target, `ReplayEmbed.svelte:727-743, 1140-1142`), and
the picture holds the last served frame.

**Confirmed, with three fixes:**
- Readout during `seeking`: `0:42 → 1:12` (served → target) instead of the bare position; the tooltip stays on
  the thumb. No seconds-remaining estimate — the served fraction IS the progress.
- Fullscreen: the `skipping ahead…` pill is inside the HUD and would fade with it (`1309-1318, 1331-1335`) —
  while `st === 'seeking'` the HUD must not fade (`poke()` on each served frame, or exclude `.note` from
  `.hudoff`). A fade that hides the only sign of progress reads as a hang. The overlay layer is in its full
  state during `seeking` (§2.5), so the plates and credits are visible while the viewer waits.
- The `«5 / 5»` buttons are hidden on phones (`1392-1395`) — keep hidden, but make the scrub's drag release
  snap to the nearest KO tick once ticks exist (Phase 4 of the parent spec), because a blind 30 s forward drag
  on a phone is the worst case of this cost.

---

## 6. Accessibility

- The layer is real DOM text (never baked into the canvas in the player), so it is readable by AT: each plate is
  `role="group"` with `aria-label="Player 1: Tris"` / `"Player 2: LurKMan"`; credit lines are plain text inside
  (`Storm, skin NIGHTFALL by Ruby` — the sprite icon carries `alt` = the character name).
- `pointer-events: none` on the layer; `auto` only on the rank-badge, author and watermark links — tap-to-pause
  on the picture (`ReplayEmbed.svelte:622-631`) keeps working through the plates.
- Contrast on the worst case (a white game pixel): `--ink` #eef1f8 on `rgba(0,0,0,.65)`-over-white (#595959)
  = 5.3:1; `--dim` #8a91a8 on it = 2.6:1 → **the record stamp and ratings use `#c9cedd` on the picture**
  (4.5:1 on the same ground), not `--dim`; `--stream` #8b6dff author link on it = 3.6:1 → author links are
  underlined (dotted) so colour is not the only cue, and the text is 700 weight at 12 px (large-text threshold
  not met, so the underline is load-bearing). The watermark (`.5` black, 70 % white → ≈ 3.2:1) is decorative.
- Focus order unchanged (LIVE-TAB-SPEC §6.5) with the plate links inserted after ▶ and before the scrub; in
  fullscreen the plates are before the transport in DOM order.
- Reduced motion: no crossfade between full and minimal (cut); no HUD fade transition (already, `1405-1410`).
- Minimum physical type: 13 px inline; 10.5 px phone landscape; 8 px phone portrait (below floor → minimal-only
  while playing, §2.3).

---

## 7. Copy sheet (house voice — short, arcade, no exclamation marks)

| Where | Copy |
|---|---|
| Credit line (on picture) | `[spr] "NIGHTFALL" by Ruby` · own: `[spr] "NIGHTFALL"` |
| Credit line (studio/profile) | `STORM · "NIGHTFALL" by Ruby` |
| Record stamp | `RANKED · FT3 · G3` / `2026-09-02 21:14` / `CLOCK TOWER` (`Stage 13` until C8) · money: `🪙 MONEY · FT3 · G2` |
| Seats unknown | `stock colors` (title: `Seats unknown for this tape — colors are the game's own`) |
| Profile, wearer | `WEARING` · `own design` |
| Profile, creator | `SKINS` · `N designs` · `worn by M players` · `in K replays` |
| nopack | `Tape's in. Art isn't.` · `Replays draw with the game's own art, packed from a copy of MvC2.` · `Pack it with Retro Receipts ›` · `Watch on a PC with MvC2 and Retro Receipts` |
| Requested | `Tape incoming.` · `Pulled from the archives — usually under a minute.` · `Still pulling — the archive is slow tonight.` · `Try again` |
| Sign-in | `🔒 SIGN IN TO WATCH` (phone: `🔒 SIGN IN`) · `Sign in to watch the tape.` · `Replays are for players with an account.` |
| Seeking | `skipping ahead…` · readout `0:42 → 1:12` |
| Watermark | `RETRO RECEIPTS · nobd.net/app/ranks` |

---

## 8. Design-system amendments (to land with Phase A/B)

1. **The picture may be overlaid** (rev 2): the replay's chrome is a layer in picture coordinates on top of the
   canvas; the canvas pixels stay exact and every gate reads the scene target. Replaces LIVE-TAB-SPEC §1.6's
   "nothing overlays the 640×480 picture" and the `Embed` definition's "chrome above/below" clause.
2. Suffix grammar: add **Credit** = a one-line attribution (thing · name · author link); leaf, owns no
   fetches. One consumer family: `SkinCredit`.
3. Commandment 1 gains a clause: *wherever a team wears a skin someone else made, the maker is credited
   within the same surface or the surface's overlay* (replay, studio, profile; receipts and boards exempt by density).
4. Charter: `--stream` also marks **a creator credit**; `--p1`/`--p2` (`app.css:22-27`, today unused by the
   card system) become the **seat accents** of the replay plates — and nothing else.
5. Sides rule for the replay overlay: **seat-anchored** (P1 left) when seats are known; the winner is marked,
   never re-sorted. An explicit exception to "winner reads right", embed-only.

---

## 9. Contracts this needs (none exist today)

| # | Contract | Lane | Status |
|---|---|---|---|
| C10 | `wside`, `lside`, `reporter` on the ONE `match_result` builder (`app.rs:944-975`) and on `/rr/session` games (`stats.rs:43-45, 384`) | server | **PROPOSED** (HANDOFF §6 already asks) |
| C11 | `session_id` on `BracketMatch` once a bracket match's set is created/reported | server (`tourney.rs`) | **PROPOSED** (HANDOFF §6) |
| C12 | Agent builds the asset pack for a tape from the local install (`Pack it with Retro Receipts ›`) | agent | **UNKNOWN** — no pack builder in `agent/` |
| C13 | `CharSkin` gains `skin_id, name, author_steamid, author_name, source`; equip POST accepts `skin_id, source, author_name`; public read echoes; `author_name` via `disp_name` at read time | server | **PROPOSED** |
| C14 | Share code v2 with optional `author_steamid` | PWA (`skincodes.ts`) | **PROPOSED** (Q3) |
| C15 | Creator counts: `GET /rr/profile` gains `skins: {designs, worn_by, in_replays?}` | server | **PROPOSED** |
| C7 | Tape-frame poster = scene + overlay composite, `GET /rr/poster/<match_key>.png` | render + server | **UNKNOWN** owner (LIVE-TAB-SPEC C7) |
| — | Bus event `{type:'tape', key, state}` consumed by the PWA | PWA | contract exists (HANDOFF §3); client not wired |

---

## 10. Phased plan — each ships alone, each has a gate (no time estimates)

**Phase A — the on-picture layer, today's data.** The `.ovl` layer (§2.3) with plates, record stamp, watermark
at the §2.2 coordinates; seat accents when `meta.p1/p2` exist (else unlabelled + `stock colors`); full/minimal
timing (§2.5); pillars/bands stripped to `#000`; chrome-top shrunk to the meta/actions row; credit slot rendered
empty; `SkinCredit` stubbed; 5f's three fixes; 5e's phone chip; 5c's copy. Gate: (1) `readback()` sha of frame
0 and frame N identical with the layer mounted and unmounted (the canvas is untouched); (2) on 1920×1080,
844×390 and 390×844 the layer's client rect equals the canvas's client rect (identity) and each element's rect
÷ `--k` matches §2.2 within 1 px; (3) no overlay element's rect intersects the §2.1 no-go zones (health bars,
portraits, timer, pods, hyper bars) — asserted from the same table; (4) minimal form within 3.3 s of play,
full form on pause/hover; (5) the LIVE-TAB-SPEC §6.5 keyboard walk with a screen reader announcing both plate groups.

**Phase B — provenance + credit.** C13 + the PWA write path (§4.2) + `loadouts` store `credits` + `SkinCredit`
in the overlay, the rack, the locker, the wearer's profile; own-design rule. Gate: three accounts — A designs and
wears (name only, no by-line); B wears A's skin from a code (`by A`, linked once C14, plain before); C wears a
community skin (plain string) — and stock shows nothing; A renames on Steam → every surface shows the new name
without a redeploy (read-time resolution); with three credited skins the box top sits at y 353 ± 1 at 1×.

**Phase C — seats.** Tape-envelope derivation in the embed; C10 on the server; bus `tape` event wired (5d).
Gate: the skins gate from `REPLAY-META-SKINS-SPEC.md` §3.3 on a LIVE row (frame sha differs from stock only in
each character's palette indices, on the correct side); a requested archived tape flips `⏳ → ▶` with no reload.

**Phase D — reach.** C11 tournament chip → SessionModal; C15 creator stats on profiles; C7 poster = composite
(KO frame, full overlay, layer at 2× per §2.4), share links switch from the fight card to the poster. Gate: a
bracket `done` card opens the right set; the poster's picture region (before the layer) is byte-equal to the
embed's `readback()` of the same frame; creator counts reconcile against `loadouts.json` by a script.

---

## 11. Questions for Tris

- **Q1 Own designs.** When the wearer made the skin: show `[spr] "NIGHTFALL"` (name only — this spec), or nothing?
- **Q2 Then or now.** A replay credits what the wearer wears *now* (the skins rule, `REPLAY-META-SKINS-SPEC.md` §1).
  OK, or snapshot the loadout per match at result time?
- **Q3 Share codes.** Add the creator's SteamID to the code (v2) so pasted skins link their creator? Codes get 17
  chars longer. Without it, code-sourced credit is a plain name.
- **Q4 Handles.** You wrote `@creator`; the app has no handles — credits use the Steam display name via the one
  resolver, no `@`. Confirm.
- **Q5 Notifications.** No cross-session "your tape is hot" alert (5d). Want one (settings toggle + toast)?
- **Q6 Opt-out.** Can a creator hide credit (anonymous designs)? Not designed; default is always credit.
- **Q7 Poster gate.** The poster is a public image on share links while replays are sign-in only. Fine, or
  strip the credits/names from the public still?
- **Q8 `in K replays`.** Definition in §4.4 (replays currently rendering with the creator's skins). OK?
- **Q9 Persistent minimal overlay during play, or full overlay always?** This spec: full for the first 3 s, on
  pause/hover/seek, and the last 3 s; minimal (plates without credits + watermark) while playing, because the
  full form covers ≈ 5.5 % of the picture in each lower corner where cornered characters and super freezes
  live (§2.5). Always-on is one CSS rule away if you prefer the credit never to leave the screen.
