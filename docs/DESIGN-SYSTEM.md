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
| `--stream` #8b6dff | skins/worn, spectate, tournament streams | — |
| losses | hollow chip + `--dim` ink (two-channel: fill + hue) | red, anywhere, including "you lost" pills and form pips |

Tier identity colors (`.rk-*`, `RK_PLATE`/`RK_TEXT` in `lib/ranks.ts` + `app.css`) are RANK colors,
not outcome colors — they are exempt and defined ONCE globally (no local copies; two were removed).

`winrateColor()` is a data-viz heat ramp, not an outcome color — permitted on percentage readouts only.

## The suffix grammar (law)

Banner = full-width strip about ONE finished event · Card = self-contained block about a live/standing
thing · Row = aligned list entry · Plate = identity unit (skew signature) · Tile = one stat ·
Receipt = certified paper · Strip/Rail = scrolling CONTAINERS of cards, never cards themselves.
A new component takes one of these suffixes or amends this doc first.

## The taxonomy + adoption status

| Type | Component | Status |
|---|---|---|
| PlayerPlate | `lib/components/PlayerPlate.svelte` — densities tag 20 / plate 28 / hero 56 (+68px team sprites); flag-before-name; bare mono rating; client-derived tier; skinned team sprites | SHIPPED — adopted: profile hero, MatchBanner, VersusCard. Remaining hand-rolled clusters migrate opportunistically |
| MatchBanner | `lib/components/MatchBanner.svelte` — frozen zones [chip][team][plate] VS [plate][team][chip][meta]; 48px skinned sprites; two-channel chips; gold VS; mode/flair/seal/delta/duration/time meta; whole banner opens its set; grid-area mobile fold | SHIPPED — adopted: profile recents, Live Results. Receipt game rows still bespoke (SetReceipt predates; visually aligned) |
| VersusCard | `lib/components/VersusCard.svelte` — live pairing; silhouettes → picks pop in → set score center-stage; red broadcast LIVE; spectate on stream | SHIPPED — adopted: Now Playing. MyMatch keeps its intel-strip layout (charter-compliant) |
| BoardRow | `Board.svelte`/`BoardRow.svelte` + `PodiumPlate.svelte` = hero density (squads ON the podium at 44/56px + challenge affordance) | SHIPPED |
| Receipt | `SetReceipt` (THE TAPE) / `SessionReceipt` / `MatchReceipt` on `ReceiptPaper`; money direction = gold-vs-dim | SHIPPED (MoneyH2H's green/red fork deleted) |
| StakeCard | grammar live in Marquee (real avatars + flags, FT3, gold terms) / ChallengeStrip (molten urgency) / WagerRail (FT3) | GRAMMAR SHIPPED — single-component consolidation pending |
| CabinetCard | `HOST_STATUS_META` in `lib/stores/hosts.svelte.ts` = the ONE status vocabulary (HostCard + TO console consume it) | VOCAB SHIPPED — HostCard/HostBanner merge pending |
| StatTile | `StatTile.svelte`, accents from the charter | SHIPPED |
| BracketMatch | `bracketChip()` in `lib/tourney.ts` = the ONE state taxonomy (public page + TO console consume it) | TAXONOMY SHIPPED — shared card component pending |
| Masthead | `lib/components/Masthead.svelte` | SHIPPED — adopt on routes as touched (10 inline copies exist) |

## The commandments (all checkable)

1. Teams are ALWAYS sprites wearing the owner's custom skins (loadouts store; list surfaces `prime()`,
   leaf components `peek()` — leaves never fetch). Character names as text only inside mono record blocks.
2. W/L is always the two-channel chip. Nothing else encodes outcome.
3. Gold only per the charter. 4. Accents only per the charter.
5. Every finished match anywhere is a MatchBanner and links to its receipt.
6. Identity renders through PlayerPlate; names resolve from SSOT fields at render time — never cached strings.
7. Two text voices: mono = record language (ids, counts, timestamps, deltas, stakes); heavy condensed
   italic = names and scores.
8. Density never changes structure — zones scale or shed from the edges inward.
9. Sides are stable; the winner is marked (gold name + chip), never re-sorted.
10. The suffix grammar is law.

## Sprite ladder

48px in rows · 68px on cards · 96px+ hero. The characters and their skins get seen.

## SSOT rules that guard this system (from the platform-wide sweep)

- One resolver for display names (server `disp_name`); reported names are forensic only.
- SSE deltas update the SAME store the fetch seeds; snapshots are consumed WHOLE (the now_playing lesson).
- `apiGet` for GETs (dedup + invalidation); raw fetch only for mutations.
- Live endpoints never serve stale-as-live from the SW (60s ceiling rule in vite.config.ts).
