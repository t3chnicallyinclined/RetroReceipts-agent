# LIVE TAB — spec (2026-09-03)

The Match tab becomes **LIVE**: live money matches, now playing, live results — and a live result opens
inline into a **minimized replay** rendered from the match tape in the browser, with a full-screen option.
Mobile and desktop.

Status: DESIGN, implementable. No Svelte/TS was changed for this spec. Every claim below is either cited
to a file:line in this projects folder, or marked **UNKNOWN**. Mockups: `docs/mockups/live-tab-desktop.html`,
`docs/mockups/live-tab-mobile.html` (static, self-contained; game art = labelled placeholder boxes).

Tris's direction (verbatim intent): *"change the match tab to only a LIVE tab. Remove the big VS — users
don't need to see who they are playing, they know — or a much smaller version so they can see who the
opponent is: alias(es) and win-rate against them. Match becomes LIVE: any live money matches, now playing,
live results. Live results: click one and it expands to show a MINIMIZED REPLAY rendered in place that you
can watch, with a full-screen option. Mobile and desktop friendly."*

Vocabulary (DESIGN-SYSTEM.md + `rr-arcade-terminology`): "the arcade" (never marquee), FT3, THE RAIL
(spectator betting), money matches, SetReceipt = THE TAPE card. Design tokens: `pwa/src/app.css:6-34`.

---

## 0. Source of truth for what exists today

| Thing | Where | What it does today |
|---|---|---|
| The Match route | `pwa/src/routes/match/+page.svelte` | Masthead "MATCH"/ghost "LIVE" (206-215) → ResultCheckBanner (218) → HostBanner (221) → `?mm=` invite funnel (225-276) → `<MyMatch/>` (279) → `<WagerRail/>` + `<Marquee/>` (282-283) → THE RAIL board (287-305) → NOW PLAYING VersusCards + arcade cabinets (308-345) → LIVE RESULTS MatchBanners, mode scopes, pager (348-404) → SessionModal (406-408) |
| The big VS | `pwa/src/lib/components/MyMatch.svelte` | `.vs-hero` 38–56 px gold gradient VS (168, CSS 411-423) + a 90–150 px ghost VS watermark (147, CSS 267-280); two skewed plates (150-161, 179-208); picked-team chips (212-222); matchup intel strip (224-242) |
| Opponent identity data | `MyMatch.svelte` | name: live feed → profile → short id (86); **aliases** from `/rr/profile` (87, `Profile.aliases` `pwa/src/lib/stores/profile.svelte.ts:71`); rating from the feed (91); **H2H** from `/rr/matchup` (67-71 → `mu.h2h` 121-122, rendered 193-197); win chance (120) |
| Live feed store | `pwa/src/lib/stores/matchfeed.svelte.ts` | `results` (cap 20, 20-21) of `MatchResult` (26-55) + `nowPlaying` (57-76); seed `GET /rr/matches/feed?mode=&limit=` (218) then SSE `matches` (187-189). **`MatchResult` does not keep the server's tape handle** — `#toResult` (341-377) drops `d.key` |
| Server result payload | `RetroReceipts-server/server/src/app.rs:944-975` | ONE builder for the `match_result` shape; **`"key": m.key` = "the tape/replay handle → GET /rr/replay?key="** (970); `mode` ∈ ranked/lobby/tourney/money (964); `duration_s` (971) |
| Feed modes | `RetroReceipts-server/server/src/routes.rs:1121-1130` | `?mode=ranked\|lobby\|tourney\|money` — the PWA only exposes three (`FeedMode` `matchfeed.svelte.ts:24`, MODES `match/+page.svelte:155-160`) |
| Replay endpoint today | `RetroReceipts-server/server/src/receipt.rs:100-156` | `GET /rr/replay?key=` = a **downsampled stats projection** (≤1,200 rows, `REPLAY_MAX_GZ` 3 MB). The raw tape (`/rr/gamestate/<id>`) is **admin-only** (`routes.rs:999-1012`) |
| Tape storage/retention | `config.rs:25-27`, `app.rs:1822-1850` | upload cap `GS_MAX_BODY` 8 MB; recordings dir capped 30,000 files / 6 GB, oldest evicted. There is **no "last 100 results" window** in code — that is Tris's product decision (`mvc-live-skins-quarters/docs/WORKSTREAM-CLIENT-REPLAY.md:144-145`) |
| THE RAIL | `pwa/src/lib/components/RailPanel.svelte` (RailMatch 7-21, header 110-113, closed copy 163-164); board `rail.rs:319-332`; summary `rail.rs:48-60` (`open/matched/riding/open_coins/pot_feed = riding/10`) | Bets close at match start (`betting_open = locked && !betting_closed`, `rail.rs:329`) |
| Loadouts (cloud skins) | `pwa/src/lib/stores/loadouts.svelte.ts` (`of` 48, `peek` 77, `prime` 86; int→hex normalize 26-37); server `routes.rs:587-613` | `GET /rr/loadout?steamid=` → `{ok, loadout:[{cid, colors[16]}]}`; `?steamids=a,b` (≤25); absent = stock |
| Dev replay player | `mvc-live-skins-quarters/d3dcap/replay/player.html` | WebGPU boot (94-105), 1280×960 canvas 4:3 (48, CSS 17-18), wall-clock pacing with frame-debt drop (194-227), Space/←/→ (234-239), `?tape=&pack=&start=&count=&auto=1` (85-90, 125) |
| Tape player internals | `d3dcap/replay/tape-player.mjs` | fetch pack manifest → every pack file → tape (95-114); worker `open` (116-121); 16 decoded-ahead + 16 prepared frames (13-14, 170-179, 205-211); `stats()` avg/max worker ms (230-235) |
| Seek cost | `d3dcap/replay/tape-worker.mjs:32-40` | records must be served **in feed order**: a forward seek first decodes the gap (~25 ms/frame); a rewind is meta-only (cheap) |
| Sizes (one real match) | `d3dcap/replay/packs/59613662/` | `tape.json.gz` 3.16 MB (stage 13, roster [8,42,44,50,52], agent 0.3.39, tape v5); pack 22 MB with per-file `sha256` in `manifest.json`; wasm 752 KB. Tape rate 1.8–3.1 MB/min (`RENDER-STATUS-2026-09-03.md:22-23`) |
| Replay meta + skins rule | `mvc-live-skins-quarters/docs/REPLAY-META-SKINS-SPEC.md` | names/aliases/ranks/skins are server-side, resolved at replay time (§1-2); the overlay is HTML chrome, never drawn into the picture, fades during playback (§2); skins = replace the stock bank-0 row per character, each player's OWN loadout on THEIR side (§3); the scene RT already renders at 2× (§4) |
| Delivery decisions | `WORKSTREAM-CLIENT-REPLAY.md:67-86, 135-152` | D0: pack shipped as static assets, cached in IndexedDB keyed by pack version; M-interim: **phones get server-emitted keyed frames over pub/sub** until the wasm emitter runs there; W6 E1 `GET /rr/tape/<id>` (Range, gzip as stored) is the lane-1 contract, not built; E2 PWA route `/replay/<match>` |
| Load-to-first-frame | brief (render lane, 2026-09-03) | ~12 s desktop = tape fetch + wasm open + prime. Not re-measured here |
| OG fight card | `routes.rs:233-240` | `GET /rr/ogimg/<session>.png`, server-rendered, disk-cached per session (1200×630) |

---

## 1. Decisions (one line each)

1. **The tab is LIVE.** Nav label `Match` → `Live` (`pwa/src/lib/nav.ts:177-185`); **href stays `/match`** so every share link (`nobd.net/app/match?mm=<id>`, `match/+page.svelte:103-152`) and the `?mm=` funnel keep working. Masthead title `LIVE`, ghost `ON AIR`, accent `--live`, the LIVE pill kept (`match/+page.svelte:206-215`).
2. **The big VS goes.** Both the `.vs-hero` and the ghost VS watermark in MyMatch (168, 147). Precedent: UI-REDESIGN-SPEC adjudication 3 — "a second big VS is the exact redundancy we're deleting" (`mvc-live-skins-quarters/docs/UI-REDESIGN-SPEC.md:29`). What replaces it is one 44 px **YOUR MATCH strip**: you (tag density) · set score · **OpponentPlate** (alias, a.k.a., rank, H2H win-rate) · state pill. Same data, one row.
3. **Section order = Tris's sentence:** LIVE MONEY (self-hides when nothing is locked, exactly like today's rail board `match/+page.svelte:287`) → NOW PLAYING → LIVE RESULTS. Money leads because its clock is the shortest (bets close at match start).
4. **Live Results rows stay MatchBanners** (commandment 5, `docs/DESIGN-SYSTEM.md:50`). A row gains a replay affordance in its meta rail; tapping the row **expands it in place** (no route change, no modal) into the **ReplayEmbed**. THE TAPE (SessionModal/receipt) remains one tap away inside the expanded panel — commandment 5's "links to its receipt" is satisfied through the panel, not the row itself (amendment §13).
5. **One embed, three sources.** `ReplayEmbed` renders the game's own pixels via WebGPU from (a) a tape + pack in a Web Worker (desktop, the proven path), (b) a server-emitted keyed-frame stream (phones, per M-interim), (c) nothing — the availability states. The card chrome and the transport are identical across sources.
6. **The picture is sacred.** Nothing overlays the 640×480 picture while it plays; chrome lives above/below (inline) or in the pillarbox bands / a fade-out HUD (fullscreen). Only the game's real textures/geometry are drawn (`feedback-render-only-game-assets`).
7. **No invented numbers on money cards.** Pot, riding, matched and pot-feed are read straight from `rail.rs` fields; if a field is absent the line is omitted, never zero-filled.
8. **Retention UX follows the product decision, not the code.** UI states for tape uploaded / not yet / gone (older than the last-100 window) / saved (paid) are designed now; the server window itself is a lane-1 contract (§11).

---

## 2. Information architecture

```
LIVE  (route /match — nav label "Live")
├─ Masthead: LIVE · ghost ON AIR · pill ●LIVE · "Money on the line, games in progress, results as they land — and the tape of every one."
├─ [ResultCheckBanner]  [HostBanner self]  [?mm= invite]           ← unchanged, in this order (match/+page.svelte:218-276)
├─ YOUR MATCH strip (signed-in only; replaces MyMatch's scoreboard)  §3
├─ LIVE MONEY                                                         §5
│    ├─ your wager (WagerRail, only while it has state)
│    ├─ locked money matches — one MoneyCard per row of /rr/rail/board (+ RailPanel)
│    └─ 🪙 the arcade — collapsed disclosure: "N quarters up in the arcade ▸" → Marquee list
├─ NOW PLAYING                                                        §4
│    ├─ VersusCards (unchanged component) — yours first (`mine`)
│    └─ THE ARCADE — watch a live cabinet (unchanged strip, match/+page.svelte:332-344)
└─ LIVE RESULTS                                                       §6
     ├─ scopes: ⚔ Ranked · 🎮 Lobby · 🏆 Tournament · 🪙 Money   (money added — server already filters it, routes.rs:1132)
     ├─ ResultRow = MatchBanner + replay affordance  → expands to ReplayEmbed
     └─ pager (5/page, 4 pages — match/+page.svelte:168-176)
```

What moves where:

| Today (`match/+page.svelte`) | LIVE |
|---|---|
| `<MyMatch/>` (279): plates + big VS + team chips + intel strip | **YOUR MATCH strip** (§3). Team chips and the intel strip (win chance, best team, kryptonite) leave this tab — they are already on the profile/matchup surfaces (`MyMatch.svelte:224-242` data = `/rr/matchup`). Only H2H survives, folded into the OpponentPlate |
| `<WagerRail/>` (282) | first block of LIVE MONEY, only when `wager.mine` has a live state (WagerRail already self-collapses, `WagerRail.svelte:47-49`) |
| `<Marquee/>` (283) — the arcade's open challenges | collapsed disclosure at the bottom of LIVE MONEY. It is browse, not live; it stays reachable in one tap. **Open question for Tris** (§14 Q1) |
| THE RAIL board (287-305) | LIVE MONEY's cards (same markup family, `.rmatch` + `RailPanel`) |
| NOW PLAYING (308-345) | unchanged |
| LIVE RESULTS (348-404) | rows gain the replay affordance + inline expansion; `🪙 Money` scope added |
| SessionModal (406-408) | kept; opened from the expanded panel's "THE TAPE ›" and from NOW PLAYING cards as today |

---

## 3. YOUR MATCH strip + OpponentPlate (the small VS)

Renders only when signed in AND `mine` (a Now Playing row containing me, `MyMatch.svelte:38`) exists, or — idle — as a single quiet line. Host nodes render nothing (they referee, `MyMatch.svelte:36`).

```
┌ YOUR MATCH ────────────────────────────────────────────────────────────────────────┐
│ [av20] Tris ▸ 1147   │  set  2 – 1  │  [av20] 🇺🇸 LurKMan  a.k.a. Lurk · lurk_mvc  ●IN MATCH │
│                      │  GAME 4      │  ◆ VIBRANIUM 1180 · YOU 3–1 THEM · 75% ▓▓▓░       [THE TAPE ›] │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Height 44 px desktop (two-line right cell at 13/11 px), 64 px on phones (the score stacks between the two plates). No skew, no gold VS; the only italic-heavy voice is the set score (commandment 7).

### 3.1 Fields → source (all existing; nothing new is fetched)

| Field | Component / data | Cite |
|---|---|---|
| You: avatar, name, rating | `PlayerPlate` density `tag` (20 px avatar, flag·name·rating) | `PlayerPlate.svelte:13-17, 60-63`; `auth.me` as in `MyMatch.svelte:85, 90` |
| Set score `2 – 1` + `GAME n` | `mine.wins[me]` / `mine.wins[oppId]` from the feed | `MyMatch.svelte:99-101`; `matchfeed.svelte.ts:66` |
| Opponent alias (display name) | feed name map → profile name → `…last5` | `MyMatch.svelte:84-86`; server resolver `disp_name` (`app.rs:954-956`) |
| Opponent **a.k.a.** (aliases) | `Profile.aliases` from `GET /rr/profile?steamid=` — server returns the durable name history, current name excluded, ≤8 (`stats.rs:454-487`) | `MyMatch.svelte:68, 87` (slices 3; the profile hero shows 5, `routes/u/[steamid]/+page.svelte:96, 242-244`). Strip shows up to 2 inline, the rest on `title` |
| Opponent flag | `oppProfile.cc` via `Flag` | `MyMatch.svelte:183` |
| Rank badge + tier + rating | `RankBadge` (client-derived tier, `rankOf`) + `use:rankTitle` (opens the ladder legend) | `MyMatch.svelte:189-191`; `pwa/src/lib/ranks.ts:38-42`; `pwa/src/lib/stores/rankinfo.svelte.ts:28-61` |
| **H2H record + win-rate** | `mu.h2h.wins/losses` from `GET /rr/matchup?me=&opp=` — counted (ranked) games only | `MyMatch.svelte:69, 121-122`; `stats.rs:591-611`. Win-rate = `w/(w+l)` rounded, colored with `winrateColor()` (`ranks.ts:120-121` — permitted on percentage readouts, DESIGN-SYSTEM.md:21). First meeting → `first meeting` (italic, `--faint`) exactly as `MyMatch.svelte:196` |
| State pill | `●IN MATCH` (`--live`) / `LOOKING FOR OPPONENT` (gold) / `AGENT NOT CONNECTED` (dim) | `MyMatch.svelte:169-175` copy verbatim |
| THE TAPE › | opens `SessionModal` for `mine.session_id` (live polling) | `match/+page.svelte:188-192, 406-408` |

`OpponentPlate.svelte` (new — suffix **Plate** = identity unit, DESIGN-SYSTEM suffix grammar `:22-28`): wraps
`PlayerPlate density="plate" align="right"` and adds the a.k.a. line and the H2H line. Props:
`{ steamid, name, aliases, avatar, cc, rating, games, h2h: {wins, losses} | null, link }`. It owns no fetches
(leaf rule, commandment 1); MyMatch passes what it already resolves.

### 3.2 States

| State | Strip |
|---|---|
| signed out | not rendered (the masthead description + LIVE RESULTS carry the tab; the sign-in door is the top bar) |
| signed in, idle, agent reporting | one 36 px line: `YOUR MATCH · looking for opponent` (gold dot) |
| signed in, idle, no agent | `YOUR MATCH · start Retro Receipts to sync your match` (dim) — copy from `MyMatch.svelte:204` |
| in match, picks not in | opponent plate without teams; pill `●IN MATCH`; score hidden until a game lands (`hasScore`, `MyMatch.svelte:101`) |
| in match, scored | as drawn above |
| host node | nothing (`isHost`, `MyMatch.svelte:36`) |

---

## 4. NOW PLAYING

`VersusCard` unchanged (`pwa/src/lib/components/VersusCard.svelte`): silhouettes → picks → set score, red
broadcast dot, `▶ SPECTATE` on `--stream` when `join_link` exists (60), card opens the live set (73-75; wiring
`match/+page.svelte:314-327`). Your own pair keeps `mine` (gold inset ring). Nothing to redesign; the
YOUR MATCH strip above it is the only place your identity is spelled out, so the card for your own pair does
not repeat the a.k.a./H2H lines.

---

## 5. LIVE MONEY

One **MoneyCard** per row of `GET /rr/rail/board` (`rail.rs:319-332` — every LOCKED wager, newest lock first).
The card is today's `.rmatch` (`match/+page.svelte:290-303`) with the header tightened and the RailPanel kept
verbatim underneath (`RailPanel.svelte` — place / take / cancel, slips, math).

```
┌ 🪙 MONEY MATCH · FT3 ─────────────────────────────── POT 🪙 110 ─┐
│ [plate] Duc            🔴 1 – 0            JFRESH [plate]       │
│ THE RAIL · 2 BETS MATCHED           🪙 100 riding · +10 to the pot │
│ 🔒 Betting closed — the match is on.                             │
└──────────────────────────────────────────────────────────────────┘
```

Rules (no invented numbers):

| Line | Source | When absent |
|---|---|---|
| `POT 🪙 N` | `pot + rail.pot_feed` exactly as today (`match/+page.svelte:298`; `rail.rs:328, 60`) | `pot` is always present on a board row |
| `🔴 cw – aw` vs `BETS OPEN` | `live` / `cw`+`aw` / `betting_open` (`match/+page.svelte:296-297`) | — |
| `THE RAIL · N BETS MATCHED` | `rail.matched` (`RailPanel.svelte:111`) | header reads `THE RAIL` alone |
| `🪙 riding · +feed to the pot` | `rail.riding`, `rail.pot_feed` (`RailPanel.svelte:112`) | omitted; while open with no bets: `no bets yet — be first` |
| pick buttons / slip / open bets | RailPanel, unchanged (`RailPanel.svelte:115-161`) | — |
| closed copy | `🔒 Betting closed — the match is on.` (`RailPanel.svelte:163`) | — |

Accent: card border `color-mix(gold 26%)` + gold wash (today's `.rmatch`), a 3 px `--live` left edge while
`live` (`.rmatch.on`). Names render through `PlayerPlate density="tag"` (`challenger`/`acceptor` are SteamIDs on
the row, so the plates link to profiles). Fighters and the referee see RailPanel's own `rnote` copy
(`RailPanel.svelte:117-119`).

Your wager (WagerRail) sits first when `showState` (`WagerRail.svelte:47-49`); the arcade's open challenges
(Marquee) fold into a disclosure row `🪙 3 quarters up in the arcade ▸` (count = `wager.open.length`,
`Marquee.svelte:13`). Empty LIVE MONEY (no locked wager, no own wager) renders only the disclosure row when
quarters are up, otherwise the whole section is absent.

---

## 6. LIVE RESULTS → the expandable ResultRow

### 6.1 The row (collapsed) = MatchBanner + replay affordance

Zone map unchanged: `[W/L][team A][plate A] VS [plate B][team B][W/L][meta]` (`MatchBanner.svelte:8-12`, grid
120-134, phone fold 258-296). Two additions inside the **meta rail** (104-116):

- **replay affordance** replaces the `›` chevron (114):
  - `▶ TAPE` in `--stream` (spectate/stream hue per the charter, DESIGN-SYSTEM.md:15) when a replay is ready;
  - `⏳` dim when the tape isn't in yet;
  - `—` (nothing) when none/expired — the row still opens the receipt panel.
- `aria-expanded` on the row button; expanded rows get `border-left-color: var(--stream)`.

The whole banner stays the tap target (`onOpen`, 72-80). New optional props: `replay: 'ready'|'pending'|'none'|'expired'|'saved'`, `expanded: boolean`.

### 6.2 What a tap does

| Tap | Result |
|---|---|
| row (any replay state) | toggles the panel under the row; only ONE row is expanded per list (`expandedKey` in the route, keyed by `MatchResult.key`); expanding another collapses the first and stops its player |
| `▶ TAPE` chip | same as row (it is decoration on the button, not a nested control) |
| page change / scope change | collapses (the store clears `results` on a mode switch, `matchfeed.svelte.ts:200-205`) |
| the same row again | collapses; player disposed (worker `close`, GPU buffers released — `tape-worker.mjs:47-50`) |

### 6.3 The panel

```
┌─ expanded ResultRow ───────────────────────────────────────────────────────────┐
│ [MatchBanner row, unchanged, aria-expanded=true, stream-colored edge]           │
│ ┌ ReplayEmbed ───────────────────────────────────────────────────────────────┐ │
│ │ chrome-top: [plate A · skins] 2–1 GAME 3 [plate B · skins]  RANKED · FT3   │ │
│ │             2026-09-02 21:14 · Clock Tower · 1:58                          │ │
│ │ ┌───────────────── 4:3 picture, the game's own pixels ──────────────────┐ │ │
│ │ │                                                                       │ │ │
│ │ └───────────────────────────────────────────────────────────────────────┘ │ │
│ │ chrome-bottom: ▶  ━━━━━━●━━━━━━━━━  0:42 / 1:58   1×  ⛶                   │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ actions: THE TAPE ›  ·  ⧉ Copy link  ·  Save this tape                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **chrome-top** = the tale of the tape: both `PlayerPlate density="plate"` with the 48 px team sprites wearing
  the owners' skins (`loadouts.peek`, primed by the route `match/+page.svelte:181-187`), winner's name gold,
  W/L chips; center = game score inside the set (from `/rr/session` if present, else the game number), mode
  chip, FT, date/time (`ts`), stage name, duration (`duration_s`). Rank badges link to `{base}/ranks`
  (`RankBadge` wrapped in an `<a>`; the badge's own `title` keeps tier · ELO, `RankBadge.svelte:14-18`).
- **actions row**: `THE TAPE ›` opens `SessionModal` for `session_id` (as today); `⧉ Copy link` = `shortSetLink`
  (`pwa/src/lib/share.ts`); `Save this tape` = the paid save (Tris's decision; wiring UNKNOWN, §11).
- On phones the actions row collapses to icons with labels on `title`.

### 6.4 Transitions

- Expand: panel height animates 0 → auto via `grid-template-rows: 0fr → 1fr` (180 ms, `ease-out`); the
  poster is visible on the first frame of the animation (no empty box). Reduced motion: no animation.
- The row scrolls into view (`scrollIntoView({block:'nearest'})`) so the picture is never half off-screen
  after expanding the last row on a page.
- Collapse: reverse; focus returns to the row button.

### 6.5 Keyboard / touch

| Input | Collapsed row | Expanded panel |
|---|---|---|
| Enter / Space | expand | (on the row) collapse |
| Esc | — | collapse; in fullscreen: exit fullscreen first |
| Tab | row → next row | row → play → scrub → speed → fullscreen → THE TAPE → Copy → Save → next row |
| Space (focus inside embed) | — | play / pause |
| ← / → | — | paused: −1 / +1 frame; playing: −5 s / +5 s; Shift: ±1 s |
| Home / End | — | first / last frame |
| F | — | toggle fullscreen |
| tap picture | — | play / pause; in fullscreen also reveals the HUD |
| double-tap picture (touch) | — | fullscreen toggle |
| horizontal drag on the scrub bar | — | scrub (48 px hit height on phones) |
| pinch | — | nothing (never zoom the picture) |

There is no audio in a tape (the capture is draw-list state, `TAPE-V3-SPEC`/`RENDER-STATUS` — no audio
stream exists), so there is **no mute control** and no `M` key.

---

## 7. ReplayEmbed — component contract

`pwa/src/lib/components/ReplayEmbed.svelte`. Suffix **Embed** is new to the grammar (§13): a rendered media
element (the game's own pixels) with chrome; it is not a Card and never carries actions beyond transport.

### 7.1 Props

```ts
type ReplaySource =
  | { kind: 'tape'; tapeUrl: string; packUrl: string; start?: number; count?: number }   // desktop path (worker + wasm)
  | { kind: 'stream'; url: string; frames: number }                                      // phones, M-interim keyed frames
  | { kind: 'none'; reason: 'pending' | 'expired' | 'none' | 'unsupported' };

let {
  source,                 // ReplaySource
  poster,                 // string URL — a still for the closed/loading states (see 7.5)
  meta,                   // ReplayMeta — server-resolved, NEVER read from the tape (REPLAY-META-SKINS-SPEC §1-2)
  skins = null,           // { [steamid]: {cid, colors:number[16]}[] } | null — raw ints for the feed (§3.1 there)
  autoplay = 'auto',      // 'auto' | 'never' — 'auto' = play when ready unless reduced-motion or Save-Data
  size = 'inline',        // 'inline' | 'fullscreen' (controlled by the embed itself; prop = initial)
  onready, onerror, onended, onprogress, onfullscreenchange
}: Props = $props();

interface ReplayMeta {
  a: { steamid; name; aliases?: string[]; avatar?; cc?; rating?; games?; team?: number[] };
  b: { … };
  winner: 'a' | 'b';
  score?: { a: number; b: number };  // game score within the set, when /rr/session carries it
  gameNo?: number; mode: string; ft?: number; ts: number; stageId?: number; durationS?: number;
  sessionId?: string; key: string;    // key = the server's tape handle (app.rs:970)
}
```

`start`/`count` map 1:1 onto the dev player's `?start=&count=` (`player.html:125`) and are for clips
(highlights) — a Live Result plays the whole game (one tape = one game = one `match_result`, `app.rs:970`).

### 7.2 Events

| Event | Payload | When |
|---|---|---|
| `onprogress` | `{ phase: 'pack'|'tape'|'open'|'prime'|'stream', got, total }` | throttled to 4/s; drives the loading bar and the `aria-live` text |
| `onready` | `{ frames, openMs, ttffMs }` | first frame drawn (`ttffMs` = tap → first blit) |
| `onerror` | `{ code: 'webgpu'|'fetch'|'open'|'decode'|'gpu', message }` | any failure; the embed shows the matching state itself |
| `onended` | `{}` | last frame shown and loop off |
| `onfullscreenchange` | `{ fullscreen: boolean }` | after the Fullscreen API resolves / on `fullscreenchange` |

Methods (bindable): `play()`, `pause()`, `seek(frame)`, `step(±1)`, `enterFullscreen()`, `dispose()`.

### 7.3 State machine

```
closed ──tap──▶ checking ──▶ unsupported (no navigator.gpu)          player.html:95
                    │
                    ├─▶ unavailable {pending | expired | none}      source.kind === 'none'
                    │
                    └─▶ loading {pack → tape → open → prime}        tape-player.mjs:95-134
                             │                      └─▶ error {fetch|open|decode|gpu}
                             ▼
                          ready (poster + ▶, or autoplay) ──▶ playing ⇄ paused ──▶ ended (loop off)
                                    │                              │
                                    └──────── seeking (forward gap: "skipping ahead…") ◀┘
```

- `checking` is synchronous (WebGPU feature test) — the panel opens on the poster immediately either way.
- `loading` sub-phases come straight from the player's progress callback (`tape-player.mjs:106, 114`;
  `player.html:115-119`) plus the worker `opened` message (`openMs`) and `prepareAll` (16 frames,
  `tape-player.mjs:213-224`).

### 7.4 Loading state (designing for ~12 s today)

The panel never shows an empty rectangle. Sequence:

1. **0 ms** — poster fills the 4:3 box, dimmed 40%, `LOADING THE TAPE` rail label + a two-segment bar
   (`PACK` · `TAPE`) with byte counts (`4.1 / 22 MB`). If the pack is cache-hot (§7.9) the PACK segment
   is already full and labelled `pack cached`.
2. **open** — bar flips to indeterminate for the wasm open; label `OPENING` (`openMs` is reported, `player.html:129`).
3. **prime** — `PRIMING 9 / 16`.
4. **ready** — poster un-dims; `▶` appears; autoplay starts unless `prefers-reduced-motion: reduce`,
   `navigator.connection.saveData`, or `autoplay='never'`.
5. If loading exceeds **20 s**, add one line under the bar: `Big tape — this can take a moment on first watch.`
   No spinner ever replaces the bar; the numbers are the honesty.

Budget targets (ship gates in §12): TTFF ≤ 4 s with a warm pack, ≤ 12 s cold on desktop; the bar must move at
least every 500 ms or switch to indeterminate.

### 7.5 Poster frame

Order of preference:
1. `meta.posterUrl` — a still from the tape rendered server-side. **UNKNOWN**: no server-side frame renderer
   for tapes exists in this projects folder (the only server-rendered image is the OG fight card,
   `routes.rs:233-240`; W6 E3 mentions a headless render-check of gold frames, `WORKSTREAM-CLIENT-REPLAY.md:152`,
   but not a per-match poster). Lane-1 contract, §11.
2. Interim: the OG fight card `GET /rr/ogimg/<session_id>.png` (1200×630) letterboxed into the 4:3 box on a
   `--board` ground (`app.css:32`) — it is the game's own art (portraits) composed server-side, so it obeys
   the render-only-game-assets rule.
3. Nothing (no session id): the `--board` ground with the mode chip centered. Never a stock screenshot.

The poster is also the `closed` state's preview in the collapsed row? **No** — the collapsed row is the
MatchBanner, unchanged (rows stay 48 px sprites, sprite ladder DESIGN-SYSTEM.md:62-63).

### 7.6 Letterboxing and size

- Native picture 640×480, 4:3 (`player.html:17-18, 48`). Canvas backing store = 1280×960 (the RT already
  renders at 2×, `REPLAY-META-SKINS-SPEC.md` §4); CSS box keeps `aspect-ratio: 4/3`, `image-rendering: pixelated`.
- **Inline** — the box is the panel's full content width: on the 1140 px `.wrap` (`app.css:263-268`) that is
  1104 × 828 px (≈1.73× native). Above 1104 px the picture is capped at 1280 × 960 CSS (2×) and centered on the
  `--board` ground. On phones it is the viewport width minus the 12 px wrap padding (390 → 366 × 275).
- **Fullscreen** — the picture is fitted with integer scale when the screen allows (2× on ≥1280×960 logical,
  else 1× or a non-integer fit only if 1× would leave >25% of the height empty), centered; the remainder is
  pillarboxed (landscape) or letterboxed (portrait) on `#000`.
- Side-by-side docking (results list left, player right) is **Phase 4 optional** (§12); the default at every
  width is inline full-width — a bigger picture beats a visible list.

### 7.7 Fullscreen

- `embed.requestFullscreen()` on the wrapper (canvas + HUD), never on the canvas alone (the HUD must render
  inside the fullscreen element).
- Mobile: after entering fullscreen call `screen.orientation.lock('landscape')` where available (Chrome
  Android); on failure/unsupported show the `Turn your phone` hint for 2 s in portrait.
- **iPhone Safari has no element Fullscreen API** (only `<video>`) — fall back to a pseudo-fullscreen: a
  `position: fixed; inset: 0; height: 100dvh` overlay with the same HUD, `history.pushState` so the back
  gesture/button exits, body scroll locked (the pattern SessionModal already uses, `SessionModal.svelte:93-102`).
- Exit: Esc, ✕ (top-right of the HUD), back, or the ⛶ toggle. The inline panel resumes at the same frame.
- HUD in fullscreen: chrome-top plates sit in the **pillar bands** on 16:9+ screens (a 4:3 picture on a 19.5:9
  phone leaves ~17% width each side — enough for a plate); the transport overlays the bottom 56 px of the
  picture and **fades after 2.5 s idle** (tap/mouse-move reveals). When the screen is 4:3-ish (no bands) the
  plates also live in the fade-out HUD. During playback the picture is otherwise unobstructed.

### 7.8 Scrubbing

- The scrub bar is `<input type="range" min=0 max=frames-1>` styled to the tokens; readout `m:ss / m:ss`
  (frames/60, like `player.html:139`), frame number on `title`.
- Rewind is cheap (meta-only re-serve, `tape-worker.mjs:32-40`); **forward seek decodes the gap at ~25 ms per
  frame on the main thread** — a 30 s jump ≈ 45 s of catch-up today. Therefore, Phase 2 rules:
  - dragging shows the target time on a tooltip; releasing seeks; while the gap is served the state is
    `seeking` with `skipping ahead…` under the bar and the bar's fill advancing to the target;
  - `+5 s` / `−5 s` and `±1 frame` buttons are the encouraged controls; the speed select (60/30/15/6, from
    `player.html:37-44`) is on desktop only.
- Phase 4: keyed frames every 60 (the M-interim/W5 wire, `WORKSTREAM-CLIENT-REPLAY.md:82-83`) make seeks O(1 s);
  the scrub then gets chapter ticks at each KO (from `/rr/session` stats `deaths` — `SetReceipt.svelte:38-44`,
  when present).

### 7.9 Caching and performance budget

| Item | Rule |
|---|---|
| Pack files | cache by **file `sha256`** from `manifest.json` (present per file, `packs/59613662/manifest.json`), Cache API store `rr-pack`, so `chars/PL08_*` fetched for one match serves every later match with Psylocke; evict LRU above 200 MB. (D0 says IndexedDB keyed by pack version, `WORKSTREAM-CLIENT-REPLAY.md:69-72` — the sha key is the finer grain that makes cross-match reuse real; same store either way) |
| Tape | fetch once per open; `Cache-Control` from the server; never through the SW `rr-api-live` 60 s cache (`pwa/vite.config.ts:52-72`) — tapes are immutable, a dedicated `rr-tape` cache with a 50 MB cap |
| wasm | 752 KB, cached by the app-shell precache; `init()` is shared across embeds in a session (one worker per open embed; at most one open embed per list) |
| Memory | 16 decoded records (~0.7 MB each, `tape-player.mjs:207`) + 16 prepared GPU frames + the pack blob copied once into wasm memory (~22 MB) — ≈ 70 MB working set per open embed; `dispose()` on collapse/page-hide |
| Main thread | `draw()` ≤ 8 ms at 60 fps on desktop; the wall-clock pacer drops debt past 4 frames per refresh (`player.html:205-212`) so slow devices skip frames rather than slow the match |
| Worker | avg record ≤ 12 ms (measured via `stats()`, `tape-player.mjs:230-235`); if the rolling average exceeds 16 ms for 2 s, the embed switches the speed select to 30 (half) and shows `playing at half speed` |
| Phones | the tape path is not the plan (M-interim, `WORKSTREAM-CLIENT-REPLAY.md:74-83`): `source.kind = 'stream'` renders keyed frames from the server; buffer ≥ 1 s ahead, re-sync from the last keyframe |
| Visibility | `document.hidden` → pause + release the decode window (mirrors the route's CPU discipline, `match/+page.svelte:29-38`) |

### 7.10 Overlay metadata and skins

- All identity comes from `meta` (server-resolved): names via the display-name resolver, aliases, rating/tier
  (client-derived from rating+games — commandment 6 and `ranks.ts:38-42`), avatar, flag. The tape carries only
  SteamIDs, teams, costumes, `ts` (`REPLAY-META-SKINS-SPEC.md` §1).
- Stage name: the tape/pack has `stage_id` (`manifest.json` → 13); **UNKNOWN** — there is no stage-id → name
  table in the PWA (`pwa/src/lib/chars.ts` maps characters only). Add `pwa/src/lib/stages.ts` from the arc's
  stage table (owner: render lane) before the label ships; until then render `Stage 13`.
- Skins: the embed reads `loadouts.peek(a.steamid)` / `peek(b.steamid)` (primed by the route) and passes the
  **raw int** form to the feed opts (`skins: {sid: [{cid, colors}]}`, `REPLAY-META-SKINS-SPEC.md` §3.1). The
  store keeps hex (`loadouts.svelte.ts:34`); either convert back (`parseInt(h.slice(1),16)`) or add a raw
  accessor to the store — implementation choice, no new fetch. Each player's OWN loadout paints THEIR side;
  absent = stock. The sprites in chrome-top use the same loadout (CharSprite `palette`), so the plates and the
  picture agree.
- Rule restated: chrome above/below inline; in fullscreen, pillar bands + a fading HUD — the 640×480 picture is
  never covered while playing (`REPLAY-META-SKINS-SPEC.md` §2).

### 7.11 Availability states (the `none` source)

| `reason` | Picture area | Copy | Action |
|---|---|---|---|
| `pending` | poster dimmed + ⏳ | `Tape not in yet.` sub: `The agent uploads it after the set — check back in a minute.` | `THE TAPE ›` (receipt) |
| `expired` | `--board` ground + the mode chip | `Tape gone.` sub: `Only the last 100 live results keep a replay.` | `THE TAPE ›`; `Save this tape` disabled with `title="too late for this one"` |
| `none` | same | `No tape for this one.` sub: `Neither player's agent recorded it.` | `THE TAPE ›` |
| `unsupported` (no WebGPU) | poster + ⛔ | `This browser can't play tapes yet.` sub: `Needs WebGPU — Chrome, Edge, or Safari 26+.` | `THE TAPE ›`, `⧉ Copy link` |
| `saved` (paid) | normal playback | a gold `SAVED` pill in chrome-top (gold = money/trust seal per the charter) | — |

Replay availability arrives with the result row (§11 contract). Until it does, the client infers: `key`
present → assume `pending` for 3 min after `ts`, then probe once; no `key` → `none`. Never show `▶ TAPE` on a
row whose availability is unknown.

---

## 8. Responsive rules

| Width | YOUR MATCH | LIVE MONEY | NOW PLAYING | Result row | Expanded panel |
|---|---|---|---|---|---|
| ≥ 1140 (wrap max, `app.css:264`) | one 44 px row | card 100% | VersusCard grid as today | MatchBanner 6-col grid (`MatchBanner.svelte:120-134`) | picture 1104×828; chrome-top 56 px; transport 44 px; actions 36 px |
| 721–1139 | same | same | same | same | picture = wrap width × 3/4 |
| ≤ 720 (TabBar shows, `TabBar.svelte:297`) | 64 px, score between the plates | header wraps, RailPanel picks stack (`RailPanel` already flex) | VersusCard 38 px chips (`VersusCard.svelte:247-259`) | MatchBanner phone fold (`MatchBanner.svelte:258-296`) + `▶ TAPE` in the 76 px meta column | picture 366×275 on a 390 phone; chrome-top 2 rows (plates 28 px avatar); transport 48 px touch targets; actions → icons |
| landscape phone (fullscreen) | — | — | — | — | picture fitted to height; plates in the pillar bands; transport fades |

Never: horizontal page scroll (the wrap uses `overflow-x: clip`, `app.css:119-124`); a second control row in
a section header (UI-REDESIGN hard rule); zooming the picture.

---

## 9. Accessibility

- Result row: `<button aria-expanded aria-controls="replay-<key>">` (MatchBanner already renders a `<button>`
  when `onOpen` exists, `MatchBanner.svelte:72-80`). Expanded panel: `<section id="replay-<key>" role="region"
  aria-label="Replay: A vs B, game 3">`.
- Canvas: `role="img" aria-label="Match replay, frame 2520 of 7100"` updated on pause/seek only (not per frame).
- Load progress: one visually-hidden `aria-live="polite"` node, updated at most every 2 s (`Loading the tape,
  40 percent`), then `Ready` once.
- Focus: expanding moves focus to `▶` (it is the first control and the primary action); collapsing returns focus
  to the row; fullscreen exit returns to ⛶. Focus rings use the app's gold outline (`app.css:210-214` pattern).
- Contrast: chrome text on `--panel` meets 4.5:1 with `--ink`/`--dim` (existing tokens); HUD text over the
  picture in fullscreen sits on a 60% `#000` scrim band, never bare over game pixels.
- Motion: every pulse and the expand animation are inside `@media (prefers-reduced-motion: no-preference)`
  (house pattern, `match/+page.svelte:508-516`); reduced motion also disables autoplay (§7.4).
- Touch targets ≥ 44 px on phones (`RailPanel` picks are 9 px padding + text → verify ≥ 44 in Phase 1).

---

## 10. Copy sheet (house voice — short, arcade, no exclamation marks)

| Where | Copy |
|---|---|
| Masthead | `LIVE` · ghost `ON AIR` · `Money on the line, games in progress, results as they land — and the tape of every one.` |
| YOUR MATCH idle | `looking for opponent` / `start Retro Receipts to sync your match` |
| OpponentPlate | `a.k.a. Lurk · lurk_mvc` · `YOU 3–1 THEM · 75%` · `first meeting` |
| LIVE MONEY | `🪙 MONEY MATCH · FT3` · `POT 🪙 110` · `BETS OPEN` · `🔒 Betting closed — the match is on.` · `🪙 3 quarters up in the arcade ▸` |
| Results affordance | `▶ TAPE` · `⏳` |
| Loading | `LOADING THE TAPE` · `PACK 4.1 / 22 MB` · `pack cached` · `TAPE 1.2 / 3.2 MB` · `OPENING` · `PRIMING 9 / 16` · `Big tape — this can take a moment on first watch.` |
| Transport | `▶` `⏸` · `0:42 / 1:58` · `1×` `½×` `¼×` · `⛶ Full screen` · `skipping ahead…` · `playing at half speed` |
| Fullscreen hint | `Turn your phone` |
| Unavailable | `Tape not in yet.` · `Tape gone.` · `No tape for this one.` · `This browser can't play tapes yet.` |
| Actions | `THE TAPE ›` · `⧉ Copy link` · `Save this tape` · `SAVED` |
| Ended | `▶ Watch again` (loop is off by default in the embed; the dev player's loop toggle stays dev-only) |

---

## 11. Data / server contracts this needs (lane 1 — `RetroReceipts-server`; none exist today)

| # | Contract | Why | Status |
|---|---|---|---|
| C1 | `match_result` payload gains `replay: {state: 'ready'|'pending'|'none'|'expired'|'saved', tape_url?, pack_url?, poster_url?, frames?}` in the ONE builder `app.rs:944-975` (so seed + SSE agree, SSOT V6) | rows need availability without a probe per row | **PROPOSED** |
| C2 | Public tape read: `GET /rr/tape/<key>` (Range, gzip as stored) — the W6 E1 contract (`WORKSTREAM-CLIENT-REPLAY.md:150-151`) | today the raw tape is admin-only (`routes.rs:999-1012`) and `/rr/replay` is a stats projection (`receipt.rs:100-156`) | **NOT BUILT** |
| C3 | Pack hosting: `packs/<key>/manifest.json` + files, immutable, `Cache-Control: immutable`, per-file sha (already in the manifest) | D0 (`WORKSTREAM-CLIENT-REPLAY.md:69-72`) | **UNKNOWN** where it will be served from |
| C4 | Raise `GS_MAX_BODY` 8 MB → 64 MB + the 3 MB guards (`config.rs:25`, `receipt.rs:112`) | every v5 tape is rejected with 413 today (`WORKSTREAM-CLIENT-REPLAY.md:136-141`) — without this there are no replays at all | **BLOCKER** |
| C5 | The 100-result window: results outside the last 100 report `replay.state = 'expired'` unless saved; saved = paid (`WORKSTREAM-CLIENT-REPLAY.md:144-145`) | Tris's product decision; the dir cap today is 30k files / 6 GB (`config.rs:26-27`) | **PRODUCT DECISION, NOT BUILT** |
| C6 | `POST /rr/tape/save` (paid) → `replay.state = 'saved'` | `Save this tape` | **UNKNOWN** (price, wallet flow — money lane) |
| C7 | Poster: `poster_url` per tape (server-rendered still) | §7.5 | **UNKNOWN**; interim = OG fight card |
| C8 | Stage table (`stage_id → name`) shipped to the PWA | §7.10 | **UNKNOWN** source; render lane |
| C9 | Phone stream: keyed frames per match over the SSE gateway / pub-sub (M-interim) | §7.9 phones | **DECIDED, NOT BUILT** (`WORKSTREAM-CLIENT-REPLAY.md:74-83`) |

Client-side store change (mine, PWA): `MatchResult` gains `match_key?: string` (from `d.key`) and
`replay?: ReplayAvail` in `#toResult` (`matchfeed.svelte.ts:341-377`) and in the upgrade-in-place merge
(404-445) — `key` is already taken as the dedupe key (357), hence `match_key`.

---

## 12. Phased plan — each phase ships alone, each has a gate (no time estimates)

**Phase 0 — contracts.** C1, C2, C4 (lane 1); PWA store fields (`match_key`, `replay`). Gate: `curl` a
result row from `/rr/matches/feed` showing `replay.state`, and `curl -r 0-1023 /rr/tape/<key>` returning 206;
one v5 tape accepted (no 413).

**Phase 1 — the LIVE tab (no replay yet).** Nav label; masthead; MyMatch → YOUR MATCH strip + `OpponentPlate`
(big VS + ghost deleted); section order; LIVE MONEY cards (RailPanel unchanged) + arcade disclosure; `🪙 Money`
scope; `▶ TAPE`/`⏳` affordance on rows that only opens the receipt for now. Gate: the state walk on a live
build — signed out / idle no agent / idle agent / in match unscored / scored / host node — with the console
clean; every W/L, gold, live, molten usage checked against the charter table; MatchBanner phone fold intact;
`?mm=` funnel still lands on the accept button.

**Phase 2 — ReplayEmbed, desktop tape path.** Worker + wasm + WebGPU inside the panel; states in §7.3 incl.
`unsupported`/`pending`/`expired`/`none`; poster (interim OG card); inline letterbox; transport; keyboard;
fullscreen on desktop; dispose on collapse. Gate: for the same `tape.json.gz` + pack, `player.readback()`
sha-256 of frame 0 and frame N in the embed equals the dev player's (`player.html:159-163` hook, the L3 gate);
TTFF measured cold and warm and logged on `onready`; the keyboard table in §6.5 walked with a screen reader
announcing region, expanded state, and the two live updates.

**Phase 3 — mobile.** Pseudo-fullscreen on iPhone, Fullscreen API + orientation lock on Android, touch scrub,
HUD fade, pillar-band plates; pack cache by sha (`rr-pack`) and the `rr-tape` cache; skins overlay from
`loadouts`; `source.kind='stream'` adapter once C9 exists (until then phones show `unsupported` copy variant
`Tapes play on desktop for now.`). Gate: iOS Safari 26 + Chrome Android matrix (expand, fullscreen, back
gesture exits, no horizontal scroll, ≥44 px targets); second open of a match sharing a character shows
`pack cached` and skips those bytes (network panel); skins gate — with an empty loadout the frame sha is
unchanged, with a loadout only that character's palette indices differ (`REPLAY-META-SKINS-SPEC.md` §3.3).

**Phase 4 — retention + polish.** C5/C6 UI (expired copy, `Save this tape`, `SAVED` pill), keyed-frame
seeking with KO ticks, optional docked side-by-side on ≥1180 px, poster from C7. Gate: Tris signs the
retention/paid-save decision in writing (price + window) before the button goes live; seek to any point
completes under 1 s on the keyed wire.

---

## 13. Design-system amendments (to land in `docs/DESIGN-SYSTEM.md` with Phase 1)

1. Suffix grammar: add **Embed** = a rendered media element (the game's own pixels) with transport chrome;
   never a Card, never carries actions beyond transport. One consumer: `ReplayEmbed`.
2. Commandment 5 ("every finished match … links to its receipt"): a MatchBanner may expand in place; the
   receipt link then lives in the expanded panel's actions row. The row remains the single tap target.
3. Charter: `--stream` (`#8b6dff`) now also marks **replay availability** (`▶ TAPE`, expanded-row edge) —
   it is the spectate/stream hue already (`DESIGN-SYSTEM.md:15`). `--live` stays reserved for a match on air;
   a replay is not on air.
4. Taxonomy rows: `OpponentPlate` (Plate; wraps PlayerPlate + a.k.a. + H2H), `MoneyCard` (Card; the
   `.rmatch` family, RailPanel inside), `ReplayEmbed` (Embed). VersusCard, MatchBanner, RailPanel unchanged.
5. Big-VS rule: the gold VS mark appears at **MatchBanner size (14 px, `MatchBanner.svelte:184-197`) and
   VersusCard size (26 px, `VersusCard.svelte:223-236`) only**; the 38–56 px hero VS is retired with MyMatch's.

---

## 14. Open questions for Tris

- **Q1** The arcade's open challenges (Marquee): collapsed disclosure under LIVE MONEY (this spec), or its own
  home elsewhere? It is browse, not live, but it has no other surface today.
- **Q2** Paid save: price in 🪙, and does a saved tape also survive the 6 GB disk cap (`config.rs:27`)?
- **Q3** Should Now Playing cards for money matches show the pot inline (they carry `mode: money` and
  `wager: true`, `app.rs:940`) so the two sections don't repeat the same pair? Spec keeps them separate.
- **Q4** Autoplay on expand (desktop, non-reduced-motion): on by default here. Confirm.
- **Q5** Phones before the keyed stream exists: show `Tapes play on desktop for now.` (spec) or hide the
  affordance entirely on phones?
