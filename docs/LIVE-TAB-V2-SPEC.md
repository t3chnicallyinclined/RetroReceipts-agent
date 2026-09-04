# LIVE TAB v2 — THE THEATRE (beta spec, 2026-09-03)

LIVE becomes **a room with a picture in it**: the latest match is already playing when the page opens, you can
pick a different one, you can share it, and you can say something about a *moment* in it.

**Four features. That is the beta.**

1. **Theatre-first LIVE page** — the latest match playing as the opening act.
2. **BROWSE MATCHES** — a popup over the theatre to pick another match; picking one swaps the picture, no route change.
3. **SHARE** — one control: copy link, plus the OS share sheet where the browser has one.
4. **Anchored comments** — a comment takes the current timestamp, marks the timeline, and anyone can click to jump there.

Everything else is in §7 DEFERRED, one line each, with no design work behind it.

Status: **DESIGN, implementable.** No Svelte/TS/Rust was changed. Every claim is cited to a `file:line` in this
projects folder or marked **UNKNOWN**. Extends `docs/LIVE-TAB-SPEC.md` (supersedes its §2 IA and §6.2 row
behaviour) and `docs/REPLAY-OVERLAY-SPEC.md` rev 3 / `docs/REPLAY-OVERLAY-TEMPLATE.md` (the overlay is
unchanged except one template line, §2.6). Mockups: `docs/mockups/live-v2-desktop.html`,
`docs/mockups/live-v2-mobile.html`.

Tris's direction (verbatim intent): *"the first thing people see is the latest match PLAYING; and a BROWSE
MATCHES popup; and a SHARE LINK"* · *"a comment can be tied to a moment in the match, so other users can click
to see what they are speaking about and go right to that spot"* · *"it can be simple, just a couple staple
features… this is a beta… let's trim it up."*

Vocabulary: `docs/DESIGN-SYSTEM.md`, `rr-arcade-terminology`. Tokens: `pwa/src/app.css:6-33`.

---

## 0. What is REAL today

Several things the older specs list as PROPOSED are **already built on the server** and merely unconsumed by
the PWA. The beta spends that first — most of §1–§3 is a client change.

| Thing | Where | State |
|---|---|---|
| The LIVE route | `pwa/src/routes/match/+page.svelte` | Masthead (374) → ResultCheckBanner (385) → HostBanner (387) → `?mm=` funnel (390) → `<MyMatch/>` (442) → **LATEST TAPE hero** (446-472) → LIVE MONEY (477) → NOW PLAYING (512) → LIVE RESULTS + in-place expansion (572-633) → SessionModal (661) |
| A hero already exists and already autoplays | `match/+page.svelte:291-368` | `pickHero` = the newest row whose `availability()` is `ready`/`saved`; autoplay on desktop, `autoload={false}` on phones/Save-Data (314-319); **never yanks a picture being watched** (320, 331, 345) |
| The picture is a true re-render | `pwa/src/lib/replay/engine.ts:99-140` | WebGPU + a wasm emitter in a Worker. `displayPlan()` (128-140): backing = `4·floor(cssW·dpr/4)` × ¾; internal `res` = smallest of {2,4,6} with `res·640 ≥ 2·backingW` (cap 6). The picture follows its displayed size and is never stretched |
| …but the inline picture is capped at 640 px | `ReplayEmbed.svelte:1278-1279, 1301-1312` | `.emb { max-width: calc(640px + 2px) }` is a hard-coded literal. §1.3 needs it to be a prop |
| Below 720 px the transport sheds controls | `ReplayEmbed.svelte:1736-1758` | `.btn.sm` (±5 s) and `.spd` (speed) are `display:none`. Anything a phone needs must not live in that row |
| Art needs a one-time ownership tick, no account | `pwa/src/lib/replay/pack.ts:72-168`; panel `ReplayEmbed.svelte:1227-1237` | `localStorage['rr.owns.v1']` + `X-RR-Owns-Game: 1` on every pack request. Files cached in `rr-pack-v1` keyed `url+sha256` (`pack.ts:198-200`), so the second replay of a shared roster is near-instant |
| Watching needs no account | `pwa/src/lib/replay/source.ts:6-8, 184-191` | `gated()` is deliberately an identity function |
| Transport + keyboard | `ReplayEmbed.svelte:1116-1152, 747-794` | Space · ←/→ (1 frame paused / 5 s playing / 1 s Shift) · Home/End · F · O (overlay cycle) · Esc; a forward seek past what the worker served enters `seeking` with an honest `served → target` readout (1138-1143) |
| **Result rows already carry seats and replay state** | `RetroReceipts-server/server/src/app.rs:1029-1066` | the ONE `match_result` builder emits `wside`, `lside`, `p1`, `p2` (1057-1060) **and** `replay: {state, tape_url?, bytes?, frames?}` (1062, builder 1072-1085). **The PWA store reads neither** — `MatchResult` (`matchfeed.svelte.ts:28-64`) has no `replay` field |
| The feed | `routes.rs:1181-1191` → `app.rs:970-988` | `GET /rr/matches/feed?mode=&limit=` — limit clamps to **100**, newest-first, optional `mode` ∈ ranked/lobby/tourney/money. No offset, no cursor, no text search. The client keeps only 20 (`matchfeed.svelte.ts:20`) |
| **The tape says what it contains** | `rr-render/src/feed.rs:66-77` | `info_json()` → `{frames, tape_ver, agent, stage_id, world, …}`. `world` = `world_enabled()` = `world_assets.is_some()` (`sprites.rs:134`), true only when the tape carries `anodes` (`sprites.rs:127`; absent on older tapes, `tape.rs:150-165`). **`grep -n "\.info" ReplayEmbed.svelte` → no hits** — it is typed (`engine.ts:73`) and never read. §2.6 |
| The overlay is template-driven | `pwa/static/replay/overlay/default.json`, `lib/replay/overlay.ts:43-58` | a new stamp line is a JSON edit, not code (`REPLAY-OVERLAY-TEMPLATE.md` §3-4) |
| Share primitives | `share.ts:7-12`; `ogimg.rs`; `routes.rs:246-268, 2329-2338` | `shortSetLink()` → `nobd.net/s/<tail>`; `GET /rr/ogimg/<session>.png` = a 1200×630 fight card, disk-cached; `/s/<tail>` serves scrapers an OG page and 302s humans to `/app/r/set/<id>` **with the query string preserved** (263). Tags: `og:title/description/image/url` + `twitter:card=summary_large_image`. **No `og:video`, no `twitter:player`** |
| **`navigator.share` is used nowhere** | grep over `pwa/src` | zero matches. Six copy-link sites, three different confirm timings, and only `WagerRail.svelte:98-101` has a clipboard-failure fallback |
| The bus | `bus.rs:76-87, 132-157`; `rt.svelte.ts:14-113`; `app.rs:1087-1089` | `bus.publish(channel, delta)` → `XADD <channel>:log MAXLEN ~500` + 48 h expiry, then `PUBLISH`. The PWA consumes `matches`, `leaderboard`, `tourney_index`. The register, verbatim: *"no new key, no new cardinality; a per-tape channel is refused by the register"* — the precedent for anything new attached to a match is **a new `type` on `matches`** (as `{type:'tape'}` was) |
| Auth | `auth.svelte.ts:31-34, 52-65, 125-151` | `auth.authed` / `auth.steamid` / `auth.headers()`; `auth.login(returnTo)` is a full-page nav; `auth.post()` is the one write path (handles 401 → logout) |
| Reporting, and the threshold pattern to copy | `ReportModal.svelte:15-22`; `routes.rs:2194-2241`; `app.rs:1586-1606` | `POST /rr/report`, six reasons, one per pair per 24 h, **and the report must follow a real recorded match between them**. `FLAG_MIN = 3` **distinct** reporters over 30 days raises a flag. Admin queue at `GET /rr/reports` → `admin/+page.svelte:192-231` |
| Rate limiting to copy | `config.rs:82-84` + `rail.rs:120-129, 157-159` | THE RAIL derives its per-minute count by **scanning the durable store** (`RAIL_MAX_BETS_PER_MIN = 6`) — no new state — and answers 429 in house voice |
| Text sanitisers | `util.rs:19-34`; `tourney.rs:914-921` | `clean(s,max)` drops control chars and `<`/`>` — **including newlines**. `clean_ml` keeps `\n`/`\t` and is the one to use for a comment body |
| Identity atoms | `PlayerPlate.svelte:22-58`; `ranks.ts:38-42` | densities `tag` 20 / `plate` 28 / `hero` 56; flag before name; **tier derived client-side from rating + games, never a server string** |
| **Nothing social exists** | grep `comment\|chat\|like\|favourite` over both repos | none. `MatchLog` has no free-text field. Comments are greenfield |

**⚠ Tape quality varies by the recording client.** Tris's measurement: of the newest 40 tapes, 26 are agent
0.3.31 (fighters only — no stage, no HUD) and 14 are 0.3.50 (full). This spec designs for it (§2.6); it does
not re-measure it.

---

## 1. THE THEATRE

### 1.1 Layout

```
LIVE  (route /match — href unchanged, so every share link keeps working)
├─ Masthead LIVE · ghost ON AIR · ●LIVE pill                     (unchanged)
├─ [ResultCheckBanner] [HostBanner] [?mm= invite]                (unchanged — action-required only)
├─ YOUR MATCH one-liner              ← only while you are in a match          §1.4
│
├─ ▓▓▓ THE THEATRE ▓▓▓
│    ├─ marquee   ★ MATCH OF THE DAY · Duc over JFRESH — comeback · +22   ⌕ BROWSE MATCHES   §1.6
│    ├─ the picture (4:3 — the game's own pixels + the .ovl overlay layer)
│    ├─ transport  ▶ ━━●━━━━ 0:42 / 1:58 · 1× · ◱ · ⛶     (+ comment ticks on the bar, §4.3)
│    ├─ record row RANKED · FT3 · G3 · 2026-09-02 21:14 · CLOCK TOWER · 1:58 · ◍   THE TAPE ›
│    └─ actions    ⧉ Copy link   ↗ Share                                       §3
│
├─ 💬 COMMENTS      ← desktop: the right column beside the picture; ≤1139: below   §4
├─ 🪙 LIVE MONEY    (self-hides — unchanged)
├─ 🟢 NOW PLAYING   (VersusCards + THE ARCADE strip — unchanged)
└─ 🔴 LIVE RESULTS  rows now SWAP THE THEATRE; header gains `Browse all ›`         §1.5
```

The three existing sections keep their order and their internals. They simply move under the picture: money
first (its clock is the shortest — bets close at match start, `rail.rs:329`), then games in progress, then
results.

### 1.2 What plays

`pickTheatre()` replaces `pickHero` (`match/+page.svelte:329-357`) — same shape, one priority list:

1. the URL's pick — `?m=<match_key>` (a share link, or a row picked in BROWSE);
2. **match of the day** — the highest-scoring replayable match from today, when there is one (§1.6);
3. the **latest tape** — newest feed row whose `availability()` is `ready`/`saved` (today's rule, unchanged);
4. the newest result, unplayable — poster + the honest state copy;
5. nothing at all.

**Live games are not a picture.** They cannot be re-rendered in the browser today —
`join_link`/`spectate_url` are Steam/host links (`matchfeed.svelte.ts:76`), not frames, and
`mvc-live-match-spectate` is a TO-DO. So while `nowPlaying` is non-empty the marquee carries one quiet chip,
`● 2 GAMES ON NOW ›`, that **scrolls to the NOW PLAYING section**. It does not pretend to be a broadcast.
When the live render exists, that chip becomes a tab and the slot's content changes with no re-layout.

**Never yank a picture being watched** — today's rule verbatim (`match/+page.svelte:331, 345`). A newer tape
landing mid-watch shows one line in the marquee: `A newer match landed · play it ›`.

### 1.3 Sizing

The wrap is `max-width: 1140px` with 18 px padding → **1104 px usable**.

| Width | Picture | Around it |
|---|---|---|
| ≥ 1140 | **700 × 525** in the left column | comments 384 px in the right column, 20 px gap (700 + 20 + 384 = 1104) |
| 1000–1139 | picture = column width (≈ 620–700) | comments drop below, full width |
| 721–999 | picture = wrap width, max 760 | comments below |
| ≤ 720 (TabBar shows, `TabBar.svelte:297`) | picture = viewport − 24 (390 → 366 × 275) | comments below, inline, composer sticky at the block's foot |
| fullscreen | unchanged (`ReplayEmbed.svelte:887-899`) | plain `#000` pillars |

**Why 700, not "as wide as possible."** `displayPlan()` already picks `res = 4` (2560×1920 internal) at dpr 1
and `res = 6` at dpr 2 for a 700 px box — the quality ladder exists. The binding constraint is the comment
column: 384 px is the narrowest that holds a 20 px avatar + name + rank + a 280-character body without
becoming a ransom note. 700 px also keeps the overlay's 12 px name at ≈13 px physical, the type floor
(`REPLAY-OVERLAY-SPEC` §2.3).

**Required change:** add a `maxPicture = 640` prop to `ReplayEmbed` that sets a `--pic-max` custom property,
replacing the two hard-coded 640s (`ReplayEmbed.svelte:1278-1279, 1301-1312`). The theatre passes 700;
every other consumer keeps 640 and behaves identically.

### 1.4 YOUR MATCH

Unchanged component (`MyMatch.svelte`). One placement rule: **above the theatre only when you are in a match**
(`MyMatch.svelte:38`); the idle / no-agent / signed-out states move below it. A replay is never more urgent
than the game you are in the middle of; an idle strip is never more urgent than the picture.

### 1.5 LIVE RESULTS after the theatre

Rows stay `MatchBanner` + `ReplayAffordance` (commandment 5). Tapping a row now:

| Row state | Tap |
|---|---|
| `ready` / `saved` | **swaps the theatre**, scrolls it into view (`block:'start'`), sets `?m=<match_key>` via `history.replaceState`, plays under the existing autoplay rule |
| `pending` / `archived` / `none` | opens `SessionModal` (THE TAPE), as today — there is no picture to swap in |

The in-place expansion panel and its duplicate actions row are **deleted**
(`match/+page.svelte:551-569, 598-617`). Reason: with a theatre on the page, expanding in place means two
pictures and a permanent question about which one is "the" picture. `replaceState`, not `pushState`, because
the theatre's content is a view state — ten row taps must not cost ten back presses.

### 1.6 MATCH OF THE DAY

A thin editorial layer on the resolver already described — no new data, no new component, no new store.

**The rule, in one paragraph.** Over today's rows (viewer-local day) that are `replay.state === 'ready'`,
score each: `comeback` +40, `ocv` +35, `perfect` +25, `combo ≥ 40` +30 (or `≥ 25` +15), rating swing
`|elo| ≥ 20` +25 (or `≥ 12` +12), **both** players rated ≥ 1200 +20, `mode === 'money'` +15, `verified` +10.
Ties go to the newer match. Everything in that list is already on the feed row — `combo`, `ocv`, `perfect`,
`comeback`, `elo`, `winner_rating`/`loser_rating`, `mode`, `verified`, `replay.state`
(`app.rs:1042-1064`; mirrored in `MatchResult`, `matchfeed.svelte.ts:28-64`). The weights say something a
player would agree with out loud: *a comeback beats an OCV beats a flawless game; a big swing between two
good players beats a big swing between two new ones; a huge combo counts; money counts a little; a fact we
cannot vouch for counts for nothing (never against it)*.

It runs on **one** un-scoped `GET /rr/matches/feed?limit=100` at load — `mode` is optional
(`routes.rs:1188`, `app.rs:983`), so a single request covers all four modes. No new endpoint, no per-row work.

**Limited tapes.** The shout-out is the shop window, so a fighters-only tape is a poor pick — but `world` is
only knowable **after** the tape opens (`rr-render/src/feed.rs:74`), so the picker cannot see it today.
Honest position: `world === false` becomes a **−30 preference** the moment optional contract **C16** lands
(§6), and never a hard bar — on a day where 26 of 40 tapes are fighters-only, barring them would empty the
pick. Until C16 the crown can land on a limited tape, and the theatre's own `◍ FIGHTERS ONLY` chip (§2.2)
tells the truth about it. That is the whole mitigation, and it is already built.

**A quiet day.** The badge is earned, not decorative. It appears only when there are **≥ 6 replayable
matches today and the top score is ≥ 60**. Below that, naming a winner is a claim about a competition that
did not happen. So there are exactly three marquee labels, and each is literally true:

| Condition | Marquee | Sub-line |
|---|---|---|
| ≥ 6 replayable today **and** top score ≥ 60 | `★ MATCH OF THE DAY` | the shout-out |
| something replayable today, but not enough to crown | `▶ TODAY` | the same shout-out, no superlative |
| nothing replayable today | `▶ LATEST TAPE` — today's behaviour, unchanged | `Duc vs JFRESH · RANKED · 12m ago` |

**It is the default pick, not a badge on the latest match.** The page's job is that the first thing a
visitor sees is the most watchable match; "newest" was only ever a proxy for that. So the priority list in
§1.2 becomes: `?m=` → **match of the day** → latest tape → newest unplayable → nothing. The two existing
guards are untouched and still win: a share link's `?m=` beats the pick, and a picture being watched is
never yanked (`match/+page.svelte:331, 345`). When the pick *is* the newest match, nothing special happens —
it is simply both.

**The shout-out** replaces the marquee's existing sub-line, so the theatre gains **no extra row**. Record
voice, mono, `--dim`, at most three reasons in score order, players named with the winner's name in gold:

```
★ MATCH OF THE DAY
Duc over JFRESH — comeback · 48-hit combo · +22 rating
```

Reason strings: `comeback` (`title="won from 3–1 down or worse"` — the flag is a character-count comeback,
not rounds, `app.rs:1051`), `one-character victory`, `flawless game`, `<n>-hit combo`, `+<n> rating`,
`money match`. Never a superlative, never an adjective we cannot source from a field.

**Share.** It does **not** go in the OG image: the fight card is disk-cached per session and becomes
immutable once verified (`ogimg.rs:244-256`), so a badge baked into it goes stale tomorrow and cannot be
corrected. It *does* go in the share **text**, which is composed client-side at share time — so
`navigator.share({ text })` (§5) reads `Match of the day: Duc over JFRESH — comeback, 48-hit combo.` No new
artefact, no new server work.

**Manual override: wait, and do not reuse the announcement.** `POST /rr/admin/announce` takes
`{text ≤ 280, level, ttl_ms}` and nothing else (`routes.rs:1408-1435`) — no match key, no link — and clients
dismiss announcements locally and permanently (`localStorage['rr_seen_announcements']`,
`announce.svelte.ts:16`), which is the opposite of what a pin needs. It can *say* "watch Duc vs JFRESH", and
that is a genuine shout-out worth using on day one; it cannot *pin*. A real pin is a small admin contract
later, and it should wait until the automatic rule has been watched for a while — if the rule picks well,
the override is never needed, and building it first would hide that.

---

## 2. Honest states

### 2.1 When there is nothing to play

The theatre is never an empty box, and never *only* a picture — copy-link, share and comments all work without
a tape, which is why the page stays useful.

| State | Picture area | Copy (existing strings, kept verbatim) | Still works |
|---|---|---|---|
| `pending` | poster, dimmed 40 % | `Tape not in yet.` / `The agent uploads it after the set — check back in a minute.` (`ReplayEmbed.svelte:1207`) | comments · share · THE TAPE › |
| `archived` | poster | `In the archives.` / `This tape is in cold storage — request it and it's pulled back within a minute.` (1209) + `📼 Request replay` (needs an account, `source.ts:163`) | as above |
| `none` | `--board` ground + mode chip | `No tape for this one.` / `Neither player's agent recorded it.` (1219) | as above |
| no WebGPU | poster + ⛔ | `This browser can't play tapes yet.` / `Needs WebGPU — Chrome, Edge, or Safari 26+.` (1217) | **everything except playback** — the reason the actions live in the chrome, not on the picture |
| art not acknowledged | poster + the ownership panel | unchanged (1227-1237) | comments · share |
| `nopack` | poster | unchanged (`Tape's in. Art isn't.`, 1239-1241) | as above |
| `closed` (phone / Save-Data) | poster + `▶ Watch the tape` | unchanged (1188-1189) | as above |
| zero results | `--board` ground | `No tapes yet — the next finished set lands here.` | BROWSE (empty) · LIVE MONEY · NOW PLAYING |

Comments on a match with no tape are **flat only** — there is no timeline to point at, so the composer opens
with no anchor chip rather than offering a lie (§4.1).

### 2.2 The limited-replay marker

26 of the newest 40 tapes draw the fighters with no stage and no health bars. That must be marked, quietly and
truthfully, and a HUD must never be faked.

The signal already exists and is already free: after the tape opens, **`info.world === false`** means the tape
carries no world nodes ⇒ no stage deck and no HUD (`rr-render/src/feed.rs:74`; `sprites.rs:127, 134`), and
`info.agent` names the recorder. Separately, `GET /rr/packs/manifest` answers **`stage_id: null`** when the
claim comes from an agent below `STAGE_MIN_VER = (0,3,36)` (`routes.rs:2683`; `app.rs:2076-2083, 2191-2216`).
The PWA reads neither today (`grep -n "\.info" ReplayEmbed.svelte` → nothing); wiring `p.info` into a `$state`
at ready is a handful of lines.

**The marker, in two places:**

- **Record row chip**, `--faint`, never a warning colour: `◍ FIGHTERS ONLY` with
  `title="This tape was recorded by an older Retro Receipts (0.3.31). It has the fighters, but no stage and no health bars."`
  — or `◍ NO STAGE` with `title="The recorder didn't report a stage we can trust, so the fight plays on a plain ground."`
- **One overlay stamp line**, `FIGHTERS ONLY`, gated `when: "!world"`. This is an `elements[]` edit in
  `static/replay/overlay/default.json` plus one binding (`world?: boolean` on `OverlayMeta`,
  `lib/replay/overlay.ts:43-58`) — **no renderer code** — following the exact precedent of `stock colors`
  (`REPLAY-OVERLAY-SPEC` §5a.3).

Both, because the chip explains and the stamp travels: a shared screenshot with no stamp looks like a
rendering bug; with the stamp it reads as a fact about the recording. Never draw a stand-in health bar, timer
or stage (`feedback-render-only-game-assets`), never hide the replay, never apologise for it.

**Browse rows show no marker** until the server carries it on a row (§6 C16) — LIVE-TAB-SPEC §7.11's rule
holds: never show a state whose truth we do not have.

---

## 3. BROWSE MATCHES

A popup over the theatre. **Not a route** — the theatre stays mounted behind it, so picking a row is a content
swap.

**Opening / dismissing.** `⌕ BROWSE MATCHES` in the marquee (primary), `Browse all ›` in the LIVE RESULTS
header, or the key `B`. Out: `Esc`, the ✕, a backdrop click, or the phone back gesture. `pushState` on open and
`history.back()` on close (the pattern `SessionModal.svelte:93-102` already uses), body scroll locked, focus
trapped, focus returned to the opener. Desktop: a centred dialog `min(1040px, 92vw) × min(78vh, 760px)`.
Phone: a bottom sheet at `88dvh` with a drag handle, so the picture stays visible above it — you are choosing
what to replace it with.

**The row.** The same `MatchBanner` family as LIVE RESULTS, one density down (`PlayerPlate density="tag"`,
20 px avatars, 40 px sprites) so ten rows fit without scrolling.

```
[W] [spr][spr][spr] Duc 1188 ◆    VS    JFRESH 1147 ◆ [spr][spr][spr] [L]
                                             RANKED · 1:58 · 12m ago · ▶ REPLAY
```

| Field | Source — all already on the payload |
|---|---|
| W/L two-channel chips | `winner` / `loser` (`app.rs:1036-1037`) |
| names | `winner_name` / `loser_name` — the `disp_name` resolver only (1040-1041) |
| teams as sprites wearing skins | `winner_team` / `loser_team` (1044-1045) + `loadouts.peek()`; the list primes once (`match/+page.svelte:189-195`) |
| ratings + rank badges | `winner_rating` / `loser_rating` (1042-1043); tier derived client-side (`ranks.ts:38-42`) — never `winner_rank` |
| mode · when · duration | `mode` (1046) · `ts` (1064) · `duration_s` (1054) |
| **replay availability** | `replay.state` (1062) — a **client change only**: add `replay?` to `MatchResult` (`matchfeed.svelte.ts:28-64`) and let `source.ts:194-200` stop inferring when the row carries it |
| seats | `p1` / `p2` (1059-1060) — same client change; skins then paint on the correct side with no probe |

**No set score on a row.** A `match_result` is one GAME (`app.rs:1053`); the set score lives on `/rr/session`.
Inventing one would be a fabricated number. The set is one tap away via `THE TAPE ›` once the row is in the
theatre.

**Filters and paging.** The four existing scopes only — ⚔ Ranked · 🎮 Lobby · 🏆 Tournament · 🪙 Money
(`match/+page.svelte:159-164`), served by `?mode=` (`routes.rs:1186-1189`). Plus one free client-side toggle,
`☑ Replayable only`, on `replay.state`. **No search, no new pager.** BROWSE fetches
`GET /rr/matches/feed?mode=&limit=100` once per scope and shows it 10 at a time with the existing pager
pattern; the last page reads `That's the newest 100.` The feed has no offset (`app.rs:981-986`) and there is no
player-search endpoint (`?q=` exists only for `/rr/cities`, `routes.rs:696`) — both are §7 DEFERRED.

**Keyboard / a11y.** `role="dialog" aria-modal="true"`, labelled `Browse matches`. `↑`/`↓` move the row cursor,
`Enter` picks, `Tab` cycles scopes → toggle → list → pager, `Esc` closes. Rows are `<button>`s ≥ 56 px on
touch; each row's accessible name is `Duc beat JFRESH, ranked, 12 minutes ago, replay ready`.

**Picking a row** closes the popup → sets the theatre → `history.replaceState` with `?m=<match_key>` → scrolls
the theatre to `block:'start'` → the embed loads under the normal rules. No route change, no page remount.

---

## 4. ANCHORED COMMENTS

The distinctive feature, and the reason to build any of this. Timestamped comments that become jump links are
a YouTube staple; the difference here is that the timestamp is native — the player already knows the exact
frame, so the anchor is exact rather than parsed out of text.

### 4.1 Leaving one

**Anchored is the default; flat is the lesser case.** The composer opens pre-anchored to the current playhead
and shows a chip: `@ 0:42 ✕`. Tapping `✕` drops the anchor and the comment posts flat. If the picture has never
played (`closed`, `unavailable`, no WebGPU), the composer opens flat with no chip — there is no timeline to
point at.

The anchor is stored as a **frame** (exact) and displayed as `m:ss` using the player's own `mmss`
(`ReplayEmbed.svelte:220-223`). Opening the composer while playing does not pause; **posting does** — you have
said your piece about this moment and the conversation now wants your attention.

### 4.2 Who can comment, and the sign-in moment

Watching stays open to everyone (`source.ts:6-8`). Commenting needs an account — the natural, non-annoying
prompt. The composer renders as a real input **for everyone**; signed out, focusing it swaps its body in place
for one line and one button — no modal, no interstitial:

> `Sign in with Steam to comment.` `[ Sign in through Steam ]`

The button is the existing Steam markup (`match/+page.svelte:404-411`) calling
`auth.login('/match?m=<key>')`, a full-page nav (`auth.svelte.ts:57-65`) that returns you to the same match.

A commenter renders through `PlayerPlate density="tag"` (20 px avatar, flag before name, bare mono rating) plus
`RankBadge` — the same identity atom as everywhere (commandment 6). **A commenter who fought in that match**
gets a gold `FOUGHT THIS` chip after the name, derived client-side from
`author_steamid === winner || === loser`. Gold is charter-correct: it is a verified fact, not decoration. The
name itself stays `--ink` — gold names are reserved for the winner of a match, and two gold signals in one row
is the ambiguity the charter exists to prevent.

### 4.3 The timeline marker, and keeping it readable

**Ticks live on the scrub bar's own track, never on the 640×480 picture.** The bar grows 6 → 10 px when the
match has anchored comments, so the ticks have somewhere to live, in `--stream` (§5.3).

- **Clustering.** A 640-wide picture gives a ~600 px bar; a two-minute match is ~7,200 frames, so one pixel is
  twelve frames and a busy match will collide. Ticks closer than **4 px** merge into one taller tick carrying a
  count (`3`). At 366 px on a phone the same rule bites harder and that is correct — the phone shows clusters,
  not confetti.
- **Peek (desktop).** Hovering a tick shows a tooltip **above** the transport — outside the 4:3 box, reusing
  the scrub tip's positioning (`ReplayEmbed.svelte:1135`) — with the author's name and the first 60
  characters. A cluster's tooltip lists up to three, then `+2 more`.
- **Peek (touch).** No hover exists, so a tick is a 44 px target that **seeks and scrolls the list to that
  comment** instead of showing a tooltip. One tap, one outcome.
- **Jumping from the list.** A comment's `@ 0:42` chip seeks there **and pauses** — you clicked to look at
  something. Reduced motion: no smooth scroll.
- **Ordering.** Newest-first by default, with a `by time in match ▾` toggle that re-sorts anchored comments by
  anchor and files flat ones under a `General` divider. On a fresh match recency *is* the conversation; on an
  old one, timeline order reads better. Remembered in `localStorage['rr.wall.sort.v1']`.

**Live.** A comment delta rides the **existing public `matches` channel** as a new `type`, exactly as
`{type:'tape'}` does — the register's rule is *"no new key, no new cardinality"* (`app.rs:1087-1089`). The list
subscribes through the store that already owns `matches` (`matchfeed.svelte.ts:197`). A delta for the match on
screen inserts at the top with a 300 ms `--stream` edge flash (reduced motion: none); if the reader has
scrolled, nothing jumps — a `▾ 2 new` pill appears and scrolls on tap. Viewers are **not** synchronised: each
has their own playhead. This is a replay, not a stream.

### 4.4 Layout

| Width | Comments |
|---|---|
| ≥ 1140 | the right column, 384 px, top-aligned with the picture, own scroll, composer pinned at its top |
| ≤ 1139 incl. phones | below the theatre, inline, composer **sticky at the foot of the block** |

Not a sheet on phone: a sheet covers the 366×275 picture — the thing being discussed — and hides the timeline
ticks, so "jump to 0:42" would need it dismissed first. Below keeps the picture in view while reading (picture
+ composer + two comments fit one viewport), and `position: sticky` buys the stable input a sheet was for.

### 4.5 Safety — the four mechanisms that now carry the whole model

⚠ **Rewritten 2026-09-04.** With the play-gate removed (Q4), these are no longer "defence-in-depth behind a
strong front door" — they ARE the door. Each is one mechanism, each costs a good actor nothing, and none of
them depends on a moderator being on duty. All four ship in P5 and all four are gated in §8.

This ships to a small, opinionated scene, commenting on matches they lost, sometimes with money on them —
and, per Q6, the money matches are not exempt.

**1 · A real Steam identity, and no anonymity.** ⚠ **AMENDED 2026-09-04 (Tris, Q4): there is NO play-gate.**
This section previously required one recorded match before you could post, and argued from that requirement
that the beta needed no karma, no account-age heuristics and no wordlist. **That argument is withdrawn**, and
nothing here should be read as still resting on it: a spectator who has never played can comment.

What remains is that a comment is never anonymous. Posting needs a signed-in Steam account (§4.2), and every
comment carries that account's name, rank and rating (§4.6: `Posts as <name> · <RANK>. This is on their
record.`). That is weaker than the play-gate it replaces — a Steam account is cheap next to a real match
against a real opponent — so it does **not** carry this design on its own.

**The safety model therefore rests on five mechanisms, and all five are load-bearing rather than
defence-in-depth.** They are: (1) this signed-in identity; (2) the rate limits and same-match cooldown of item
4; (3) participant `Hide` with the visible footer count, item 2; (4) auto-hide at three distinct reporters,
item 3; (5) the admin queue as the backstop. Each must ship in P5 and each is gated in §8. Note especially
that comments are **open on money matches** (Q6, answered) — the one place a dispute is most likely to turn
nasty — so items 2–4 are doing real work there, not sitting in reserve.

**2 · Both players can hide a comment on their own match, and hiding is never silent.** Either fighter can
`⋯ → Hide` any comment on a match they played; it disappears for everyone except its author, who sees it
marked `hidden by the players`. The obvious abuse is a loser censoring criticism, so the counterweight is
visibility, not permission: the list footer always reads `2 comments hidden by the players`. Suppression that
everyone can count is self-limiting; suppression nobody can see is not. **Hiding is per-comment, not a lock and
not a per-player default** — a blanket "no comments on my matches" makes the feature unreliable (half the
results silently have no wall) and hands the most-criticised players an opt-out, which is the opposite of a
record. Whether a per-match lock is worth adding is Q5.

**3 · Report auto-hides at a small threshold; the queue is a backstop, not a dependency.** Reuse the shipped
pattern (`POST /rr/report`, `routes.rs:2194-2241`): **three distinct reporters** auto-hide a comment pending
review, mirroring `FLAG_MIN = 3` over a 30-day window (`app.rs:1586-1606`). Three distinct Steam accounts is
expensive to fake; one angry person can hide nothing. The author is told once —
`Your comment was hidden after multiple reports.` — and that notice is not suppressible, because the person
being suppressed is the one person who must know. Reports land in the queue the admin panel already renders
(`admin/+page.svelte:192-231`); **nothing in this design breaks if nobody reads it for a week.**

**4 · Rate limits and a same-match cooldown, derived not stored.** Copy `velocity_exceeded`
(`rail.rs:120-129`), which counts by scanning the durable store and adds no new state: **1 comment per 10 s,
20 per hour, 100 per day per account, and 30 s between comments on the same match.** The same-match cooldown is
the one aimed at this scene specifically — it makes a pile-on cost real time. In-voice 429:
`easy — one comment every ten seconds`. A human-initiated write already lands on the generous per-IP bucket
(`routes.rs:270-289`), so nothing changes there.

**Also, cheaply:** **plain text only** — 280 characters (`clean_ml`, not `clean`, because `clean` strips
newlines, `util.rs:26-33`), and **URLs render as text and are never clickable**. Link rendering is the whole
spam economy, and on a platform with money matches a clickable link in a comment is a scam vector. No markdown,
no images, no editing (delete-and-repost is the honest primitive on a public record). Self-delete is always
available on your own comment.

### 4.6 Copy

The copy's job is to make it plain that a comment carries a name and a rank and is attached to a real person's
record.

| Where | Copy |
|---|---|
| composer placeholder (anchored) | `Say something about 0:42…` |
| composer placeholder (flat) | `Say something about this match…` |
| under the composer, always | `Posts as <name> · <RANK>. This is on their record.` |
| signed out | `Sign in with Steam to comment.` |
| empty, signed in | `No one's said anything yet. Tap the tape at the moment you mean.` |
| empty, signed out | `No one's said anything yet.` |
| no tape | `No tape for this one — comments here are about the match, not a moment.` |
| hide confirmation (player) | `Hide this comment? It stays visible to whoever wrote it, and the count shows on your match.` |
| after hiding | `Hidden. Your match shows that a comment was hidden.` |
| footer, when any hidden | `2 comments hidden by the players` |
| report confirmation | `Report this comment? Three separate reports hide it while it's reviewed.` |
| to the author, auto-hidden | `Your comment was hidden after multiple reports.` |
| rate limited | `easy — one comment every ten seconds` |
| same-match cooldown | `give it a minute — one comment a match at a time` |

---

## 5. SHARE

**One control, two things.**

- **`⧉ Copy link`** — the primary. `shortSetLink(sessionId)` (`share.ts:7-12`) → `nobd.net/s/<tail>`, plus
  `?m=<match_key>` so the recipient lands on the game that is in the theatre (the query survives the 302,
  `routes.rs:263`). Confirmation flips to `Copied` for 1800 ms. **Fix the swallowed failure**: five of the six
  existing copy sites silently do nothing when the clipboard is blocked (`match/+page.svelte:262-264`,
  `SessionModal.svelte:33-35`, …) — on failure, reveal a selectable `<input readonly>` with the URL, the
  behaviour `WagerRail.svelte:98-101` already has. Settle every site on 1800 ms (today: 1600 in three places).
- **`↗ Share`** — rendered **only when `navigator.share` exists**, calling
  `navigator.share({ title, text, url })`. On a phone this one control reaches every installed app — Discord,
  X, Facebook, Instagram, TikTok, Messages — through the OS sheet. It is used **nowhere in the PWA today**
  (grep: zero matches), and adding it is the highest-value share change available.

**No per-network buttons.** Two of the five networks Tris named (TikTok, Instagram) cannot be reached by a link
at all — they take video uploads, not URLs — so a row of five identical-looking buttons would lie about two of
them. The OS sheet reaches all five honestly; the desktop fallback is the link, which is exactly what gets
pasted into a Discord anyway.

**One line of copy under the control** carries what the link does:

> `Paste it anywhere — Discord, X and Facebook unfurl the fight card.`

That is true and checkable: the server serves scraper user-agents an OG page with a 1200×630
`og:image` = the fight card and `twitter:card=summary_large_image` (`routes.rs:252-254, 2329-2338`;
`ogimg.rs:268`), and `facebookexternalhit`, `discord` and `twitter` are all in the UA list.

**The share text** is composed client-side, so it can carry the day's shout-out where the cached OG image
cannot: `Match of the day: Duc over JFRESH — comeback, 48-hit combo.` (§1.6). The copied URL is unchanged.

**Where the control lives:** the theatre's actions row (§1.1), the LIVE RESULTS row's meta rail is unchanged,
and `SessionModal` / the share pages keep their existing copy-link buttons — this beta only adds the OS sheet
and the clipboard fallback to the shared helper, so every surface gains both.

---

## 6. Contracts

The beta needs **one** new server contract (comments). Everything else is client work against payloads the
server already sends.

| # | Contract | Lane | Status |
|---|---|---|---|
| **C19** | Comments. `GET /rr/comments?key=&limit=&before=` · `POST /rr/comment {key, frame?, text}` · `DELETE /rr/comment/{id}` (author only) · `POST /rr/comment/{id}/hide {hidden}` (**participants only**) · `POST /rr/report {kind:'comment', id, reason}`. Record: `{id, key, session_id, frame|null, author_steamid, text, ts, hidden_by?}`. `clean_ml(text, 280)`; **no played-here gate** (Q4, answered — any signed-in account may post); the rate limits and same-match cooldown of §4.5, derived by scanning the store as `rail.rs:120-129` does; auto-hide at 3 distinct reporters | server | **PROPOSED** |
| **C20** | Bus: `{type:'comment', key, session_id, id, frame, author, name, text, ts}` on the **existing `matches` channel** — never a new channel (`app.rs:1087-1089`) | server | **PROPOSED** |
| **C16** | *(only if the browse-row marker is wanted)* `replay` gains `world: bool` + `agent: string` (`app.rs:1072-1085`). The server already keeps `TapeEntry.ver` and probes the envelope at ingest (`app.rs:2059-2074`); it needs one more probed field. **Not needed for the theatre marker** — that reads `info.world` client-side | server | **OPTIONAL** |

**Client-only changes, no server work at all:** `MatchResult` gains `replay` / `p1` / `p2` from what the server
already sends (`app.rs:1057-1062`); `source.ts` stops probing when the row carries state; `ReplayEmbed` reads
`p.info` into `$state` (`engine.ts:73`); `.emb`'s 640 px cap becomes `maxPicture`; `navigator.share` and the
clipboard fallback are added to the share helper.

**Design-system amendments** (to land with the phases that need them):

1. **Commandment 5 amended.** A MatchBanner in a list with a theatre above it **swaps the theatre** rather than
   expanding; the receipt link (`THE TAPE ›`) lives in the theatre's record row. The row stays the single tap
   target. Receipts and profile lists keep the `ReplaySheet` route.
2. **Suffix grammar: `Theatre`** — a slot holding one Embed plus its marquee, record and actions chrome; at
   most one per route; owns no fetches beyond its resolver. It is not a Card and not an Embed — the Embed lives
   inside it.
3. **Charter: `--stream` also marks viewer engagement with a replay** — a comment tick, a comment count. It
   already means skins-worn, spectate, replay availability and creator credit. **No new token.** `--gold` stays
   winner / money / trust (so `FOUGHT THIS` is correctly gold); `--live` stays a match on air.
4. **The picture is never a control surface for chrome.** The `.ovl` layer (identity, credits, record,
   watermark, the `FIGHTERS ONLY` stamp) is the only thing that may sit on the 640×480 layer; comments, share
   and copy live in the chrome below it.

---

## 7. DEFERRED — listed so the shape is visible, not designed

- Likes and favourites (public signal vs private shelf).
- MOST LIKED / MOST PLAYED / MOST COMMENTED feeds, and the play definition that would make them honest.
- Notifications for comments and likes (the bell, aggregation, the settings toggles).
- Clip in/out points on the transport and `?c=<in>-<out>` clip links.
- Video encoding (client-side webm and/or a server-side mp4 job) and `og:video` / `twitter:player`.
- Per-network share flows (X / Facebook web intents, a Discord-specific hint).
- Reactions beyond a single control; comment threads and replies; mentions.
- Person-level blocking.
- A per-match comment lock, and a comment policy specific to money matches.
- Renaming the paid `Save this tape` → `KEEP THIS TAPE` (two meanings of "save" in one player is a defect).
- BROWSE beyond the newest 100: a feed cursor (`?before=`) and a player-search endpoint.
- A live game actually playing in the theatre (`mvc-live-match-spectate`).

---

## 8. Phased plan — each phase ships alone, each has a gate (no time estimates)

**P0 — spend what the server already sends.** `MatchResult` gains `replay` / `p1` / `p2`; `source.ts` trusts
the row; `ReplayEmbed` reads `p.info` into `$state`; `.emb` gets `maxPicture`.
*Gate:* on a prod build a LIVE row shows `▶ REPLAY` with **zero** `GET /rr/tape?key=` probes in the network
panel; `window.__rrHero.res` is 4 at dpr 1 / 6 at dpr 2 for a 700 px picture; the hook exposes a non-null
`info` carrying `world` and `agent`; `readback()` sha of frame 0 is unchanged.

**P1 — the theatre.** IA reorder; marquee with the `● N GAMES ON NOW ›` chip; picture at 700 / full-width;
record row; actions row; LIVE RESULTS rows swap the theatre; the in-place panel deleted; `?m=` +
`replaceState`; every §2.1 state.
*Gate:* the state walk on a live build — signed out / idle / in-match / host node / no WebGPU / no tape /
`nopack` / phone `closed` / zero results — with a clean console; no horizontal scroll at 390, 744, 1024, 1440;
the `?mm=` funnel still lands on the accept button; `readback()` sha unchanged from P0 (the theatre changed
chrome, not pixels).

**P1b — MATCH OF THE DAY.** The scorer over one un-scoped `limit=100` fetch; the three marquee labels; the
shout-out sub-line; the pick slotted at priority 2; the share text.
*Gate:* the scorer is **pure and reproducible** — the same 100 rows in gives the same `match_key` out, twice,
and a hand-computed score for the day's top three agrees with the implementation to the point; on a seeded
day of 5 replayable matches the badge is **absent**, the marquee reads `▶ TODAY` and the sub-line contains no
superlative; with zero replayable rows the behaviour is byte-for-byte today's `▶ LATEST TAPE` path; a `?m=`
share link and a picture already playing both beat the pick (no yank); the OG image for the picked session is
**unchanged** — the badge exists only in DOM chrome and in `navigator.share({text})`.

**P2 — the limited-replay marker.** `info.world` / `stage_id` → the record-row chip; the `world` binding and
the `FIGHTERS ONLY` stamp in `default.json`.
*Gate:* a 0.3.31 tape shows the marker in **both** the chip and an exported still, and a 0.3.50 tape shows
neither; the smoke's `--overlay` placement asserts still pass at k 1 / 2 / 0.81 / 0.61; `readback()` is
byte-identical with the stamp on and off — the layer is chrome, never pixels.

**P3 — BROWSE MATCHES.** The popup/sheet; the four existing scopes; `Replayable only`; 10-per-page over the
100-row fetch; keyboard; `pushState` close; row → theatre swap.
*Gate:* the keyboard walk (`B` `↑↓` `Enter` `Esc`) with a screen reader announcing the dialog, the row count
and each row's outcome; picking a row swaps the theatre with **no** navigation (no new document entry in
`performance.getEntries()`); the phone back gesture closes the sheet; the last page shows
`That's the newest 100.`

**P4 — SHARE.** `navigator.share` behind a feature check; `?m=` on the copied link; the clipboard fallback and
1800 ms unified across the shared helper.
*Gate:* on a real Android phone and a real iPhone, `↗ Share` opens the OS sheet and Discord receives the link;
pasting that link in Discord unfurls the fight card; on desktop the button is absent and copy works; with
clipboard permission denied the URL is still selectable; `curl -A "discordbot" https://nobd.net/s/<tail>`
returns the `og:image` (`routes.rs:258-261`).

**P5 — ANCHORED COMMENTS.** C19 + C20; the list at both widths; the anchored composer and the `✕` to go flat;
ticks, clustering, peek, click-to-jump; the sign-in prompt; newest-first + timeline toggle; the four safety
mechanisms and the §4.6 copy.
*Gate:*
1. two browsers on the same match — a comment in one appears in the other within 2 s with no reload, and does
   not jump a scrolled list (the `▾ n new` pill appears instead);
2. a comment anchored at 0:42 places a tick within 1 px of 42 s on the bar; clicking it seeks to **that exact
   frame** and pauses; on a 366 px phone bar, four comments within 3 s render as one cluster tick reading `4`;
3. a signed-out visitor reads everything and gets the in-place prompt on focus; **an account with ZERO recorded
   matches CAN post** (Q4, answered — there is no play-gate) and is still subject to every rate limit in item 4;
4. a 281st character is refused client and server side; the 11th comment in 100 s and the 2nd on the same match
   within 30 s both return the in-voice 429;
5. a participant's `Hide` removes it for a third browser, the footer count appears, and the author still sees
   it marked `hidden by the players`;
6. three distinct reporting accounts auto-hide a comment and the author is told once; the admin queue shows it;
   **the same test passes with the queue never opened**.

---

## 9. Open questions for Tris

- **Q1** Autoplay in the theatre stays on for desktop, non-reduced-motion (today's rule). With the theatre now
  first on the page, confirm — it is the difference between "a page about matches" and "a match".
- **Q2** While games are in progress the marquee shows `● 2 GAMES ON NOW ›`, which only **scrolls** to NOW
  PLAYING (a live game cannot be a picture yet). Keep that chip, or leave the marquee clean until live
  spectating actually renders?
- **Q3** BROWSE is the newest 100 with the existing scopes and no search. Enough for beta?
- **Q4 — ANSWERED 2026-09-04: NO play-gate.** Any signed-in account may comment; a spectator who has never
  played is not blocked. This reverses the recommendation above, so §4.5 has been rewritten: the five
  mechanisms listed there now carry the whole safety model rather than backing up a gate.
- **Q5** Player-hide is per-comment, and there is deliberately **no** per-match lock and **no** per-player
  "never allow comments on my matches" (a blanket opt-out hands the most-criticised players a mute button and
  makes the feature unreliable). Hiding is visible via the footer count. Comfortable with that, or do you want
  a per-match lock the two players can pull?
- **Q6 — ANSWERED 2026-09-04: comments are OPEN on money matches**, on the same terms as every other match.
  No special-casing and no waiting for the wager to settle.
- **Q7 — ANSWERED 2026-09-04: three distinct reporters**, mirroring the existing `FLAG_MIN`.
- **Q8 — ANSWERED 2026-09-04: unchanged.** Crown only at **≥ 6 replayable matches and a score ≥ 60**; below
  that the theatre opens on the best match and calls it `▶ TODAY`, with no superlative.
- **Q9 — ANSWERED 2026-09-04: keep the money-match +15.**
