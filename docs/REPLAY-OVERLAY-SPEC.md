# REPLAY OVERLAY + CREATOR CREDIT — spec (2026-09-03)

The replay's chrome becomes a broadcast overlay: P1 on the left, P2 on the right (the game's own HUD sides),
the match record in the top band, RETRO RECEIPTS at the bottom — and **credit for every custom skin on screen
that someone else made**. Same overlay inline, in fullscreen, on phones, and (later) baked into a poster still.

Status: DESIGN. No Svelte/TS/Rust was changed for this spec. Every claim is cited to a file:line in this
projects folder or marked **UNKNOWN**. Mockup: `docs/mockups/replay-overlay.html` (self-contained; game art =
labelled placeholder boxes; Google Fonts only). Parent spec: `docs/LIVE-TAB-SPEC.md` (§7 ReplayEmbed).

Tris's direction (verbatim intent): *"give credit for skins used/selected if they are by a creator — need to
give credit. This can all be in the overlay, like an OBS overlay, with the user's name on their side and proper
placement for the other metadata like skin attribution."* Earlier: metadata = names, rank badge linking to
`nobd.net/app/ranks`, date/time, stage, and a `RETRO RECEIPTS · nobd.net/app/ranks` watermark; each player's
own cloud skin shows on their side.

Hard rules (unchanged): the 640×480 picture is the game's own pixels and is **never covered while playing** —
chrome lives in bands/pillars, or in a HUD that fades within 2.5 s (`ReplayEmbed.svelte:22-27, 615-620`). Only
the game's real art is drawn (`feedback-render-only-game-assets`). House voice, short copy, tokens from
`pwa/src/app.css:6-34`. Mobile + desktop. Accessible.

---

## 0. What exists today (source of truth)

| Thing | Where | Today |
|---|---|---|
| The embed | `pwa/src/lib/components/ReplayEmbed.svelte` | chrome-top = plate A · score/mode/FT/game/date/stage/duration · plate B (`771-782`); picture capped at 640 px inline (`934-947`); transport under it (`842`); watermark `RETRO RECEIPTS · nobd.net/app/ranks · date` under the transport (`849`, CSS `1213-1237`); fullscreen = 3-column grid `a pic b`, plates in the pillars, transport as a 56 px fading HUD over the bottom of the picture on a 60 % scrim (`1247-1335`); portrait = rows `a / pic / b` (`1337-1372`); HUD fade 2.5 s (`615-620`) |
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
| Watermark | `ReplayEmbed.svelte:849` | inline: under the transport; fullscreen: bottom of the **right** pillar (`1320-1327`); portrait: bottom band (`1368-1372`) |
| Poster | `ReplayEmbed.svelte:74-75, 788-792`; `ReplaySheet.svelte:58` | the OG fight card `GET /rr/ogimg/<session>.png` (server SVG→PNG via resvg + `chars-png` portraits, `ogimg.rs:17, 264-269`); no tape-frame poster exists (LIVE-TAB-SPEC C7) |
| Availability states | `lib/replay/source.ts:20-27, 157-187`; `ReplayAffordance.svelte:187-204`; `ReplayEmbed.svelte:58, 808-834` | `ready · pending · archived · requested · expired · none · unsupported · signin` + `nopack` (embed-only) |
| Archive contract | `mvc-live-skins-quarters/docs/HANDOFF-LANE1-TAPE-ARCHIVE.md` §2-3, §6 | `GET /rr/tape?key=`, `POST /rr/tape/request` → `pending`, bus event `{type:'tape', key, state:'ready'}`; §6 asks lane 1 for `side`+`reporter` on results/session games and a set reference on `BracketMatch` |
| Tournament rows | `lib/tourney.ts:42-60` (`BracketMatch`: no `session_id`/`match_key`); card `routes/tournament/[id]/+page.svelte:228-238` | no replay affordance anywhere in tournaments |

---

## 1. Decisions (one line each)

1. **Sides are the game's sides.** When seats are known, P1's plate is LEFT and P2's is RIGHT — the same sides as the health bars in the picture. This is the one surface where the app's "winner reads right" habit yields: the eye follows the health bar to the name. Sides never re-sort; the winner is marked in gold (commandment 9).
2. **Unknown seats = the row's order, unlabelled.** No `P1`/`P2` tags, no guess. The picture plays stock and the meta rail says `stock colors` (§5a).
3. **Credit is a line, not a badge.** `STORM · "NIGHTFALL" by <creator>` under the wearer's team sprites, one line per credited skin, at most three (three characters). Stock = nothing. Own-made = the name without a by-line (§3.4; Q1).
4. **The creator's name is a link** to their profile when we hold a SteamID; a plain string when we hold only a name (share codes, the community library). Never an `@` — the app has no handles; names come from the one resolver (`app.rs:954-956`, DESIGN-SYSTEM.md:59, 77).
5. **One overlay, four frames.** Inline card, fullscreen landscape (pillars), fullscreen portrait (letterbox bands), and the poster still. Zones shed from the edges inward (commandment 8); nothing ever lands on the picture except the fading transport.
6. **Provenance rides the loadout.** `GET /rr/loadout` gains `skin_id, name, author_steamid, author_name, source` per character (§4). The tape stays identity-free (`REPLAY-META-SKINS-SPEC.md` §1).
7. **Derive seats before asking.** The tape envelope already names the reporter's side; the embed reads it after the fetch so skins paint on old tapes too. The server echo (`wside`/`lside`) is still requested — it is what the row and the plates need *before* the tape loads (§5a).
8. **Tournaments open the set, not a game.** A bracket match is an FT set; its card gets the affordance only once the server ties it to a `session_id`, and tapping opens THE TAPE where per-game `▶ REPLAY` already lives (§5b).

---

## 2. The overlay — anatomy

```
                      ┌──────────── TOP BAND ────────────────────────────────┐
                      │  RANKED · FT3 · GAME 3     2 – 1     2026-09-02 21:14 · Clock Tower · 1:58  │
 ┌─ LEFT PILLAR ──┐   ├──────────────────────────────────────────────────────┤   ┌─ RIGHT PILLAR ─┐
 │ [av] Tris      │   │                                                      │   │      LurKMan [av] │
 │ ◆ VIBRANIUM 1147│  │                                                      │   │ 1180 ADAMANTIUM ◆ │
 │ [spr][spr][spr] │  │              640 × 480 — the game's own pixels       │   │ [spr][spr][spr]   │
 │ STORM · "NIGHTFALL"│                                                      │   │ CABLE · "DUSK"    │
 │   by Ruby        │  │                                                      │   │   by Ruby         │
 │ SENTINEL · "GOLDEN"│                                                     │   │                   │
 └─────────────────┘  ├──────────────────────────────────────────────────────┤   └───────────────────┘
                      │  ▶  «5  ━━━━━━●━━━━━━━━━━━  5»  0:42 / 1:58  1×  ⛶    │  ← transport (fades in fullscreen)
                      └──────────────────────────────────────────────────────┘
                              RETRO RECEIPTS · nobd.net/app/ranks                ← BOTTOM BAND
```

### 2.1 Zones and their contents

| Zone | Contents (in priority order — later items shed first) | Source |
|---|---|---|
| **Left pillar / P1** | PlayerPlate (avatar, flag, name — gold if winner, tier, rating, rank badge → `/ranks`) · team sprites wearing the owner's loadout · **skin credits** (≤3 lines) | `PlayerPlate density="plate"` (`PlayerPlate.svelte:13-17, 79-85`); credits from the loadout (§4) |
| **Right pillar / P2** | mirror of the left, right-aligned | `align="right"` |
| **Top band** | set score (or W/L when no score) · mode chip · `FTn · GAME n` · date/time (viewer-local, `YYYY-MM-DD HH:MM`) · stage name · duration | `ReplayEmbed.svelte:147-161, 713-721` (today's `.mid` + `.mrail`); stage name needs C8 (`Stage 13` until then) |
| **Bottom band** | watermark `RETRO RECEIPTS · nobd.net/app/ranks` (link) · `SAVED` pill when paid-saved | `ReplayEmbed.svelte:849`; LIVE-TAB-SPEC §7.11 |
| **Transport** | ▶ · «5 · scrub · 5» · readout · speed · ⛶ | `ReplayEmbed.svelte:723-753` |

The **timer** in the brief = the playback readout `0:42 / 1:58`, not a second copy of the game's round timer,
which is already in the picture (the HUD is game pixels, `mvc-hud-list0b-live-re`). Duplicating it would be
an approximated HUD element — forbidden.

### 2.2 Where each zone lives per frame

| Frame | Top band | Pillars (P1 / P2) | Bottom band | Transport |
|---|---|---|---|---|
| **Inline card** (desktop, ≤ 640 px picture) | the 56 px chrome-top: plate · score+meta · plate — the pillars' contents fold INTO the top band because there is no side room; credits sit under each plate's sprites as a second row (chrome-top grows to ≈ 84 px when any credit exists) | — (folded up) | under the transport, 22 px | 44 px row under the picture |
| **Fullscreen landscape 16:9** (1920×1080: picture 2× = 1280×960 → pillars 320 px, bands 60 px) | the 60 px letterbox band above the picture, centered | true pillars: plate top-aligned at 24 px from the top, sprites 48 px, credits below | the 60 px band below the picture, centered | fading HUD over the bottom 56 px of the picture (today, `1292-1304`) |
| **Fullscreen landscape, no vertical band** (e.g. 1280×960 exact, or a fit scale) | folds into the pillars: score + meta stack at the top of the pillars, P1's side carries mode/FT/game, P2's side carries date/stage/duration | as above, pushed down under the meta stack | bottom of the RIGHT pillar (today, `1320-1327`) | fading HUD |
| **Phone landscape** (844×390: picture fit to height = 520×390 → pillars 162 px) | folds into the pillars (score only, 18 px, at the top of the LEFT pillar; date/stage on `title`) | plate at **tag density** (20 px avatar, `PlayerPlate.svelte:63-66`) + rank badge; sprites 32 px; credits as sprite-icon + 2 lines (§3.3) | watermark at the bottom of the RIGHT pillar, 8 px | fading HUD, 48 px targets |
| **Phone portrait** (390×844: picture 390×292) | the top letterbox band: plates side by side (P1 left, P2 right) with the score between; credits row under them | — (folded into the bands) | under the transport | static in the bottom band (never fades — there is no picture under it, `1357-1367`) |
| **Poster still** (1200×630, §2.4) | 75 px band above | pillars 280 px | 75 px band below | none |

Rule that makes this checkable: **the canvas's client rect intersects no chrome element while `st === 'playing'`**
— except the transport, and only while `hud === true` (≤ 2.5 s after the last poke, `615-620`). This is a smoke-test
assertion, not a hope (`window.__rrEmbed` already exposes state, `645-674`).

### 2.3 Inline vs fullscreen (why they differ)

Inline, the card is inside a list — a bigger picture beats a visible pillar, and Tris capped the inline picture
at 1× so an expanded row "stays a card, not a screen" (`ReplayEmbed.svelte:934-935`). So inline has **no
pillars**: the same plate + sprites + credits stack lives in the chrome-top's two outer columns. Fullscreen
has room on the sides, so the stack moves out to where a broadcast puts it. Same components, same order, one
CSS grid remap (today's `display: contents` trick, `1266-1280`).

### 2.4 The poster still (share links)

The same overlay baked around one tape frame, 1200×630 (the OG size, `ogimg.rs:268`): picture 640×480 at 1×
centered → 280 px pillars, 75 px bands. Pillars = plate + sprites + credits; top band = score + meta; bottom
band = watermark. Rendered **server-side, later**: the fight-card pipeline (SVG → resvg → PNG with `chars-png`
portraits, `ogimg.rs:55-70, 264-269`) already draws the identity half; the **picture half needs a headless
tape-frame render that does not exist server-side** (LIVE-TAB-SPEC C7 — **UNKNOWN** owner; the render lane
has the WebGPU path only in browsers). Until then the poster stays the OG fight card (`ReplayEmbed.svelte:74-75`).

Which frame: the KO frame of the last character (from `/rr/session` stats `deaths` when present,
`SetReceipt.svelte:42, 234-242`), else frame N−60. Never frame 0 (a versus screen is not a fight).

Credit on the poster is not optional: it is the only place a creator's name reaches a Discord embed. Text
size floor 18 px at 1200 wide so it survives the scrapers' downscale.

---

## 3. Creator credit — the rules

### 3.1 The line

```
STORM · "NIGHTFALL" by Ruby
└char┘   └skin name┘   └author: link to /u/<author_steamid> when known, plain text when not┘
```

- Character: `charTag` (`lib/chars.ts`), mono, `--dim`. Skin name: quoted, `--ink`, weight 700. `by <name>`:
  `--stream` (the skins/worn hue, DESIGN-SYSTEM.md:15) — a link when `author_steamid` is present.
- Mono record voice throughout (commandment 7: ids/counts/credits are record language). 9.5 px in pillars,
  9 px inline, 8.5 px on phone pillars.
- Truncation order when the pillar is narrow: drop the quotes → drop the character (the sprite icon says it) →
  ellipsis the skin name at 14 chars → never drop the author. The author is the point.

### 3.2 When a line appears

| Skin on the character | Overlay line | Reason |
|---|---|---|
| stock (no loadout entry) | nothing | Tris: "stock = nothing shown" |
| custom, `author_steamid === wearer` | `STORM · "NIGHTFALL"` (no by-line) | the plate above is the credit; the name is the way into the rack (Q1) |
| custom, `author_steamid` present, ≠ wearer | `STORM · "NIGHTFALL" by <Ruby>` (linked) | the credit |
| custom, only `author_name` (share code / community) | `STORM · "NIGHTFALL" by Ruby` (plain) | we hold a name, not an identity — credit it, don't fake a link |
| custom, no name and no author (legacy loadout, DyeStation not saved) | nothing | nothing truthful to say; the skin still paints |
| loadout unknown (seats unknown, §5a) | nothing; meta rail says `stock colors` | the picture is stock — a credit for a skin not on screen would be a lie |

### 3.3 Three custom skins on one side

Three lines, in slot order (point → second → anchor, the same order as the sprites above them). Pillar height
budget at 1080p: plate 44 + sprites 48 + 3 × 14 = 134 px of 960 — trivial. Phone landscape pillar (162 px
wide): each credit becomes `[16 px sprite] "NIGHTFALL"` / `by Ruby` (two lines, 8.5 px) → 3 skins = 6 lines ≈
70 px + plate 24 + sprites 32 ≈ 130 px of 390. Fits with room; the mockup shows it. Inline card: the credits
row wraps under the plate at 9 px, three lines max — chrome-top grows to ≈ 84 px.

If both players wear three credited skins, that is six lines total and still no overlap: each side owns its
pillar. The only collision case is portrait phone (one band for both): credits become ONE row per side, comma-
joined skin names with authors, and the character is dropped (the sprites are right above).

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

`SkinCredit.svelte` = ONE component for the line, consumed by the embed, the rack, the locker, the profile.
Suffix: none of Banner/Card/Row/Plate/Tile/Receipt/Embed fits a one-line attribution; proposed amendment
(§8): **Credit** = a one-line attribution (thing · name · author link), leaf, owns no fetches.

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
3. **Until either lands:** the picture plays **stock**; the chrome plates keep the owners' skins on their 48 px
   sprites (that is what the arena shows everywhere, commandment 1), and the meta rail carries one mono word-pair
   `stock colors` (title: "Seats unknown for this tape — colors are the game's own"). No credit lines (§3.2).
   No "skins pending" banner: a note about missing chrome is noise on top of a picture that is correct either way.
4. Plates vs picture disagreeing is tolerated **only** in this state and is why the `stock colors` marker exists;
   it is not a design choice, it is a truthful status.

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
  `.hudoff`). A fade that hides the only sign of progress reads as a hang.
- The `«5 / 5»` buttons are hidden on phones (`1392-1395`) — keep hidden, but make the scrub's drag release
  snap to the nearest KO tick once ticks exist (Phase 4 of the parent spec), because a blind 30 s forward drag
  on a phone is the worst case of this cost.

---

## 6. Accessibility

- Pillars are `role="group"` with `aria-label="Player 1: Tris"` / `"Player 2: LurKMan"`; credit lines are plain
  text inside them (`STORM, skin NIGHTFALL by Ruby` reads fine).
- The author link has `aria-label="Ruby's profile"`; plain-string authors are not links and are not announced as such.
- Contrast: credits in pillars on `#000` use `--dim` #8a91a8 (≥ 4.5:1) for the character and `--ink` for the name;
  the `--stream` author on `#000` is 5.9:1. Inline on `--panel`, the same tokens pass (existing chrome uses them).
- Watermark stays `--faint` at 9 px: decorative, `aria-hidden` except the link (`title="The Marvel ladder"`).
- Focus order unchanged (LIVE-TAB-SPEC §6.5) with author links inserted after each plate; in fullscreen the
  pillars are before the transport in DOM order so a screen-reader user hears who is fighting before the controls.
- Reduced motion: no HUD fade transition (already, `1405-1410`); credits never animate in.
- Phone landscape text floor 8.5 px mono — below the app's usual floor; acceptable only in the pillar and only
  because every line is also on the wearer's profile at full size.

---

## 7. Copy sheet (house voice — short, arcade, no exclamation marks)

| Where | Copy |
|---|---|
| Credit line | `STORM · "NIGHTFALL" by Ruby` · own: `STORM · "NIGHTFALL"` |
| Portrait phone credits | `NIGHTFALL by Ruby · DUSK by Ruby` |
| Seats unknown | `stock colors` (title: `Seats unknown for this tape — colors are the game's own`) |
| Profile, wearer | `WEARING` · `own design` |
| Profile, creator | `SKINS` · `N designs` · `worn by M players` · `in K replays` |
| nopack | `Tape's in. Art isn't.` · `Replays draw with the game's own art, packed from a copy of MvC2.` · `Pack it with Retro Receipts ›` · `Watch on a PC with MvC2 and Retro Receipts` |
| Requested | `Tape incoming.` · `Pulled from the archives — usually under a minute.` · `Still pulling — the archive is slow tonight.` · `Try again` |
| Sign-in | `🔒 SIGN IN TO WATCH` (phone: `🔒 SIGN IN`) · `Sign in to watch the tape.` · `Replays are for players with an account.` |
| Seeking | `skipping ahead…` · readout `0:42 → 1:12` |
| Watermark | `RETRO RECEIPTS · nobd.net/app/ranks` |

---

## 8. Design-system amendments (to land with Phase B)

1. Suffix grammar: add **Credit** = a one-line attribution (thing · name · author link); leaf, owns no
   fetches. One consumer family: `SkinCredit`.
2. Commandment 1 gains a clause: *wherever a team wears a skin someone else made, the maker is credited
   within the same surface or the surface's overlay* (replay, studio, profile; receipts and boards exempt by density).
3. Charter: `--stream` also marks **a creator credit** (it is already "skins/worn").
4. Sides rule for the replay overlay: **seat-anchored** (P1 left) when seats are known; the winner is marked,
   never re-sorted. This is an explicit exception to "winner reads right" and applies to the embed only.

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
| C7 | Tape-frame poster with the overlay baked, `GET /rr/poster/<match_key>.png` | render + server | **UNKNOWN** owner (LIVE-TAB-SPEC C7) |
| — | Bus event `{type:'tape', key, state}` consumed by the PWA | PWA | contract exists (HANDOFF §3); client not wired |

---

## 10. Phased plan — each ships alone, each has a gate (no time estimates)

**Phase A — the overlay, today's data.** Seat-anchored sides when `meta.p1/p2` exist (else row order, unlabelled +
`stock colors`); the zone map in §2.2 for inline / landscape / no-band landscape / phone landscape / portrait;
credit slot rendered empty; `SkinCredit` component stubbed; watermark placement; 5f's three fixes; 5e's phone
chip; 5c's copy. Gate: on three viewports (1920×1080, 844×390, 390×844) the smoke test asserts the canvas rect
intersects no chrome while `playing` (transport excepted while `hud`), HUD fades ≤ 2.5 s, and the keyboard walk
of LIVE-TAB-SPEC §6.5 still passes with a screen reader announcing both pillar groups.

**Phase B — provenance + credit.** C13 + the PWA write path (§4.2) + `loadouts` store `credits` + `SkinCredit`
in the overlay, the rack, the locker, the wearer's profile; own-design rule. Gate: three accounts — A designs and
wears (name only, no by-line); B wears A's skin from a code (`by A`, linked once C14, plain before); C wears a
community skin (plain string) — and stock shows nothing; A renames on Steam → every surface shows the new name
without a redeploy (read-time resolution).

**Phase C — seats.** Tape-envelope derivation in the embed; C10 on the server; bus `tape` event wired (5d).
Gate: the skins gate from `REPLAY-META-SKINS-SPEC.md` §3.3 on a LIVE row (frame sha differs from stock only in
each character's palette indices, on the correct side); a requested archived tape flips `⏳ → ▶` with no reload.

**Phase D — reach.** C11 tournament chip → SessionModal; C15 creator stats on profiles; C7 poster with the overlay
baked (KO frame), share links switch from the fight card to the poster. Gate: a bracket `done` card opens the right
set; the poster's picture region is byte-equal to the embed's `readback()` of the same frame; creator counts
reconcile against `loadouts.json` by a script.

---

## 11. Questions for Tris

- **Q1 Own designs.** When the wearer made the skin: show `STORM · "NIGHTFALL"` (name only — this spec), or nothing?
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
