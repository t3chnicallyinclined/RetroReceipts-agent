# RETRO RECEIPTS — THE ARENA CARD SYSTEM

The design system of record for the PWA (migrated into THIS repo 2026-08-24 — the old
`metasync-rewrite/docs/DESIGN-SYSTEM.md` + `UI-REDESIGN-SPEC.md` are historical). Built from the
full component audit + three-lens design review; mockups: the "Arena Card System" artifact.

## The charter — one meaning per color (checkable)

| Token | Means | Never |
|---|---|---|
| `--good` #35d07f | wins, positive deltas, PERSON presence, open cabinets | anything else green — #4ade80/#3ddc84 are retired |
| `--gold` #ffb020 | winner emphasis, money, verified/trust seals, the VS mark | links, hovers, decoration |
| `--live` #ff3d68 | a MATCH on air: broadcast dot + LIVE pill | losses. LOSSES ARE NEVER RED. |
| `--molten` #ff5c2c | violence flair (OCV/PERFECT/COMEBACK), challenge urgency | generic warnings (those are copy, not color) |
| `--stream` #8b6dff | skins/worn, spectate, tournament streams, **replay availability** (`▶ TAPE`, the expanded-row edge) — a replay is not on air, so `--live` stays reserved for a match on air — and **a creator credit** (the `by <name>` in a `SkinCredit`, REPLAY-OVERLAY-SPEC §8.4) | — |
| `--p1` #ff6a3d / `--p2` #3fb1ff | the **seat accents** of the replay overlay's plates (the 2 px side bar when P1/P2 are known, REPLAY-OVERLAY-SPEC §8.4) | anything else — never a team colour, never an outcome |
| losses | hollow chip + `--dim` ink (two-channel: fill + hue) | red, anywhere, including "you lost" pills and form pips |

Tier identity colors (`.rk-*`, `RK_PLATE`/`RK_TEXT` in `lib/ranks.ts` + `app.css`) are RANK colors,
not outcome colors — they are exempt and defined ONCE globally (no local copies; two were removed).

`winrateColor()` is a data-viz heat ramp, not an outcome color — permitted on percentage readouts only.

## The suffix grammar (law)

Banner = full-width strip about ONE finished event · Card = self-contained block about a live/standing
thing · Row = aligned list entry · Plate = identity unit (skew signature) · Tile = one stat ·
Receipt = certified paper · Strip/Rail = scrolling CONTAINERS of cards, never cards themselves ·
**Embed** = a rendered media element (the game's OWN pixels) with transport chrome; never a Card, never
carries actions beyond transport (added with the LIVE tab, `docs/LIVE-TAB-SPEC.md` §13; one consumer: `ReplayEmbed`).
**The picture may be overlaid** (REPLAY-OVERLAY-SPEC rev 2 §8.1, 2026-09-03): an Embed's chrome is a DOM layer in
picture coordinates (640×480, scaled with the picture) on top of the canvas; the canvas pixels stay exact and every
gate reads the scene target. This replaces "chrome above/below" and LIVE-TAB-SPEC §1.6's "nothing overlays the picture".
**Credit** = a one-line attribution (thing · name · author link); leaf, owns no fetches (REPLAY-OVERLAY-SPEC §8.2;
one consumer family: `SkinCredit`).
A new component takes one of these suffixes or amends this doc first.

## The taxonomy + adoption status

| Type | Component | Status |
|---|---|---|
| PlayerPlate | `lib/components/PlayerPlate.svelte` — densities tag 20 / plate 28 / hero 56 (+68px team sprites); flag-before-name; bare mono rating; client-derived tier; skinned team sprites | SHIPPED — adopted: profile hero, MatchBanner, VersusCard. Remaining hand-rolled clusters migrate opportunistically |
| MatchBanner | `lib/components/MatchBanner.svelte` — frozen zones [chip][team][plate] VS [plate][team][chip][meta]; 48px skinned sprites; two-channel chips; gold VS; mode/flair/seal/delta/duration/time meta; whole banner opens its set; grid-area mobile fold | SHIPPED — adopted: profile recents, Live Results. Receipt game rows stay bespoke BY DESIGN (2026-08-25: the tape's stats layer — momentum sparklines, owned combos, first-blood markers — outgrew what a banner density could host; visually aligned via the shared vocabulary) |
| VersusCard | `lib/components/VersusCard.svelte` — live pairing; silhouettes → picks pop in → set score center-stage; red broadcast LIVE; spectate on stream | SHIPPED — adopted: Now Playing. MyMatch keeps its intel-strip layout (charter-compliant) |
| BoardRow | `Board.svelte`/`BoardRow.svelte` + `PodiumPlate.svelte` = hero density (squads ON the podium at 44/56px + challenge affordance) | SHIPPED |
| Receipt | `SetReceipt` (THE TAPE) / `SessionReceipt` / `MatchReceipt` on `ReceiptPaper`; money direction = gold-vs-dim | SHIPPED (MoneyH2H's green/red fork deleted) |
| StakeCard | grammar live in Marquee (real avatars + flags, FT3, gold terms) / ChallengeStrip (molten urgency) / WagerRail (FT3 + cabinet presence: challenger_here/acceptor_here drive "Join" → "You're in — share the link" → "waiting for X at the cabinet") | RESOLVED 2026-08-25: no single component BY DESIGN — the three surfaces are different moments (browse / urgency / owner lifecycle) with deliberate per-context voice; the drift-prone parts (FT default, gold charter, stake vocabulary) are already unified. Re-open only if a FOURTH stake surface appears |
| CabinetCard | `HOST_STATUS_META` + `hostStatus()` + `pingClass()` in `lib/stores/hosts.svelte.ts` = the shared status vocabulary + ping thresholds (HostCard + HostBanner + TO console consume all three) | RESOLVED 2026-08-25: Card and Banner stay SEPARATE by the suffix grammar's own law (Card = browse object w/ seats+rules+CTA; Banner = live status strip) — merging them conflates two jobs. All shared LOGIC hoisted; the duplicated pill/dot CSS is scoped-style idiom, not drift |
| StatTile | `StatTile.svelte`, accents from the charter | SHIPPED |
| BracketMatch | `bracketChip()` in `lib/tourney.ts` = the ONE state taxonomy (public page + TO console consume it) | RESOLVED 2026-08-25: no shared card — public page renders a read-only card, the console an admin form; the taxonomy WAS the drift surface and it's consolidated. Re-open if a third bracket renderer appears |
| Masthead | `lib/components/Masthead.svelte` | SHIPPED — all 10 inline copies migrated 2026-08-25 |
| OpponentPlate | `lib/components/OpponentPlate.svelte` — Plate; wraps PlayerPlate + the a.k.a. line + the H2H line (win-rate via `winrateColor()`); leaf, owns no fetches | SHIPPED 2026-09-03 with the LIVE tab (the YOUR MATCH strip in `MyMatch.svelte`; the 38–56 px hero VS + ghost VS retired) |
| MoneyCard | the `.mc` family on `/match` (LIVE MONEY) — header `🪙 MONEY MATCH · FTn` + `POT 🪙 N`, PlayerPlate tags, `RailPanel` inside unchanged; every number is a `rail.rs` field, absent = omitted | SHIPPED 2026-09-03 (markup lives in `routes/match/+page.svelte`; promote to a component if a second surface appears) |
| ReplayEmbed | `lib/components/ReplayEmbed.svelte` — Embed; the match tape re-rendered by the proven tape engine (Web Worker + wasm emitter + WebGPU, `static/replay/engine/` verbatim from `d3dcap/replay`); the OBS-style overlay is a `.ovl` DOM layer ON the picture in 640×480 units scaled with it (plates P1 left / P2 right in the lower thirds, credits above them, record stamp under the timer, watermark bottom-centre — REPLAY-OVERLAY-SPEC rev 2 §2.2); full/minimal timing; transport below inline, fading HUD in fullscreen; pillars/bands plain #000 | SHIPPED 2026-09-03; overlay rev 2 built 2026-09-03 (Phase A: credit slot empty until C13) |
| SkinCredit | `lib/components/SkinCredit.svelte` — Credit; `STORM · "NIGHTFALL" by Ruby` (line / icon / short forms); own design = name only; author with a SteamID = dotted-underlined link, name-only author = plain text; stock = the caller renders nothing | SHIPPED 2026-09-03 (the replay overlay consumes it; the rack, the locker and the profile follow in Phase B) |

## The commandments (all checkable)

1. Teams are ALWAYS sprites wearing the owner's custom skins (loadouts store; list surfaces `prime()`,
   leaf components `peek()` — leaves never fetch). Character names as text only inside mono record blocks.
   Wherever a team wears a skin someone else made, the maker is credited within the same surface or the
   surface's overlay (replay, studio, profile; receipts and boards exempt by density — REPLAY-OVERLAY-SPEC §8.3).
2. W/L is always the two-channel chip. Nothing else encodes outcome.
3. Gold only per the charter. 4. Accents only per the charter.
5. Every finished match anywhere is a MatchBanner and links to its receipt. A MatchBanner may expand in
   place (Live Results → ReplayEmbed); the receipt link then lives in the expanded panel's actions row
   (`THE TAPE ›`). The row remains the single tap target.
6. Identity renders through PlayerPlate; names resolve from SSOT fields at render time — never cached strings.
7. Two text voices: mono = record language (ids, counts, timestamps, deltas, stakes); heavy condensed
   italic = scores, marks, and titles (VS, W/L, set scores, mastheads) — NEVER player names.
   Names are standard modern text (weight 700, no italic, no forced caps, 13–18px by density):
   real names run long and the arena voice made them unreadable (calmed 2026-08-25 at Tris's call).
8. Density never changes structure — zones scale or shed from the edges inward.
9. Sides are stable; the winner is marked (gold name + chip), never re-sorted. The replay overlay is
   **seat-anchored** (P1 left, P2 right — the game's own sides) when seats are known; an explicit, embed-only
   exception to "winner reads right" (REPLAY-OVERLAY-SPEC §8.5).
10. The suffix grammar is law.

The gold VS mark appears at MatchBanner size (14 px) and VersusCard size (26 px) only; the 38–56 px hero
VS was retired with MyMatch's scoreboard (LIVE tab, 2026-09-03).

## Sprite ladder

48px in rows · 68px on cards · 96px+ hero. The characters and their skins get seen.

## SSOT rules that guard this system (from the platform-wide sweep)

- One resolver for display names (server `disp_name`); reported names are forensic only.
- SSE deltas update the SAME store the fetch seeds; snapshots are consumed WHOLE (the now_playing lesson).
- `apiGet` for GETs (dedup + invalidation); raw fetch only for mutations.
- Live endpoints never serve stale-as-live from the SW (60s ceiling rule in vite.config.ts).
