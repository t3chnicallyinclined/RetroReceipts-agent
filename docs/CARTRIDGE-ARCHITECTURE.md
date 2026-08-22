# Cartridge Architecture — Multi-Game Agent Platform

**Status:** DRAFT for review (author: Claude session w/ Tris, 2026-08-22)
**Reviewers wanted:** tray/runtime owner (projects-ae session), server owner, projects-11 (game-modes)
**Context:** Research basis is the 2026-08-22 six-agent expansion scouting report (see memory/artifact); per-game verdicts and repo citations live there. This doc is the *how*, not the *which*.

---

## 1. Vision

Turn the RR tray agent from "the MvC2 reader" into a **console that accepts cartridges**: one shared runtime (process attach, memory read, event pipeline, server reporting, self-update) that hosts many small per-game integrations. A cartridge is, for most games, **pure data** — a manifest describing where game state lives and how to derive match events from it. Third-party developers add game support by contributing a cartridge, not by touching the runtime.

The same event contract also unifies the server side: leaderboard-delta polling, the headless lobby watcher, and any future replay-API ingester are just **server-side feeders** emitting the same events. The agent is the highest-fidelity feeder among several, not a special case.

### Principles

1. **Feeders emit events; sinks never see offsets.** The event vocabulary is the only coupling point.
2. **Cartridges are data, not code.** No dynamic native plugin loading, ever (we have been burned by the DLL-plant class before). Games that genuinely need logic get a first-party Rust driver in-tree.
3. **Read-only, full stop.** The agent observes game memory; it never writes it. The only writer today is the legacy MvC2 skins painter, which is a **deprecation candidate** (owner call 2026-08-22: skins were an MvC2-era feature, not part of the tracker product). Its downlink is skins-only — `handle_cmd_event` ignores every command type but `"skin"`, and `Proc::open_rw` has exactly one caller (`painter.rs`) — so dropping skins makes the agent strictly one-directional: events up, nothing down. Design for that end state; do not add a second writer.
4. **Client events are claims.** Anything money touches requires a server-side corroboration source (Steam leaderboard reconcile, lobby co-occurrence). Trust is per-game and earned.
5. **Abstract only what we've met.** Exactly two integration shapes are confirmed in the wild: (a) native build + static pointer chains, (b) emulated core + guest-RAM base hunt + fixed offsets. Build for those two; let a third real game bend the design later.
6. **Proven RE ports verbatim.** The MvC2 reader's logic is not re-expressed in the spec language; it becomes the first native driver, unchanged.

---

## 2. Target architecture

### 2.1 Agent workspace (public repo, `agent/` becomes a Cargo workspace)

| Crate | Contents | Source today |
|---|---|---|
| `rr-core` | `Proc` open/read/regions, `exe_base`, process discovery **parameterized by name list**, pointer-chain resolver with **u32 + u64 deref modes**, AOB scanner, region-fingerprint scanner | `src/mem.rs` (544 ln, already game-agnostic) + new scanners |
| `rr-events` | Event types + versioned envelope. Shared dependency of agent AND server (server pulls it from this public repo) | new |
| `rr-cartridge` | GameSpec (TOML) parser, locator strategies, field reader, edge-rule engine, `DeclarativeDriver` | new |
| `rr-driver-mvc2` | Today's game logic moved verbatim: offsets, pointer-follow through rollback copies, side calibration, char-sig scan, lobby/opponent extraction | carved out of `src/reader.rs` (3,102 ln) |
| `rr-agent` (bin) | Tray, updater, autostart, host-node, auth, transport, event pipeline; hosts N drivers | remainder of `reader.rs` + `tray.rs`, `updater.rs`, … |

### 2.2 The driver trait (the "feeder" contract)

```rust
trait GameDriver {
    fn game_id(&self) -> &str;
    fn matches(&self, proc_name: &str) -> bool;      // from spec [process] lists
    fn attach(&self, proc: &Proc) -> Result<Session>; // run locator, validate
    fn poll(&self, s: &mut Session) -> Vec<Event>;    // read fields, run edge rules
}
```

Two implementations: `DeclarativeDriver(GameSpec)` and hand-written (`rr-driver-mvc2`). The agent's supervisor loop watches for known process names, attaches the matching driver, and reuses the existing self-heal/watchdog machinery per session.

### 2.3 Event vocabulary (v1)

```
session_started { game_id, pid }          opponent_seen { steamid64, name? }
match_started   { mode, players[], chars[], side }
round_ended     { winner }                match_ended   { result, set_score }
state_tick      { fields{} }              // optional, rate-limited, live features only
session_ended   { reason }
```

Envelope: `{ game_id, spec_version, agent_version, event, ts, seq }`. Schema changes are versioned; the server gates by `(agent_version, spec_version)`.

### 2.4 GameSpec sketch (the template a contributor writes)

```toml
[game]     id = "ggxxacpr"  appid = 348550  ptr_width = 32
[process]  windows = ["GGXXACPR_Win.exe"]  proton = ["GGXXACPR_Win.exe"]

[locate]   strategy = "exe_chain"     # "region_fingerprint" | "aob" (+ ordered fallbacks)

[fields]
in_match  = { addr = "exe+0x7101F4", type = "u8" }
p1        = { addr = "*(exe+0x6D1378)" }
p1_health = { addr = "p1+0x1E", type = "u16" }
p1_char   = { addr = "p1+0x00", type = "u16", enum = "chars" }

[events]
match_started = { on = "rising_edge(in_match)" }
round_ended   = { on = "falling_edge_to(p1_health, 0)", winner = "p2" }

[report]   tick_ms = 250   state_tick = false
[trust]    tier = "stats"  # "stats" | "certified" (server-enforced; see §5)
```

Expressiveness target: static chains, one indirection level, integer/float/byte fields, edge predicates (rising/falling/increment/latch), simple derived values (side from a global, char names from enum tables). **If a game needs more, it's a native driver** — do not grow a programming language inside TOML.

Covers immediately (offsets already public, per the scouting report): GGXX AC+R, KOF 2002 UM; after the CPS2 base hunt: the five MVCFC classics, VSav/HSF2 (CFC1) via `region_fingerprint` + community arcade offsets; KOF '97 GM via the same strategy on the NeoGeo core.

### 2.5 Server (private repo, `skinsync`)

- **`game_id` becomes a first-class dimension** in models/stats/elo/matchlog. Existing MvC2 rows migrate with an implicit `game_id = "mvc2"`.
- **Generic ingest:** `POST /ingest/v1/event` accepting the envelope; existing `/skinsync/*` MvC2 endpoints stay as a compat shim until the fleet upgrades.
- **Per-game validation policy:** plausibility rules (event ordering, rate limits, health ranges) driven by a server-side copy of the cartridge registry.
- **Corroboration framework** (generalizing `reconcile.rs`): per game, an optional list of server-side truth sources — Steam leaderboard deltas, details-blob counters, lobby co-occurrence. Feeds the trust tiers.
- **Server-side feeders emit the same events:** the board-delta poller produces `match_ended`-class evidence (anonymous W/L + probable pairing) tagged `source = "board_delta"` vs the agent's `source = "agent"`. One MatchLog, provenance-labeled.
- **PWA:** game switcher, per-game boards/profiles; the existing scoped-boards pattern (`?scope=`) extends naturally to `game_id`.

---

## 3. Workstreams

Ownership notes reflect the current session split (agent/tray runtime + money + server = peer sessions; PWA + app deploys = this session). Final assignment TBD with peers — nothing here is claimed unilaterally.

**WS1 — Core extraction.** Promote `mem.rs` → `rr-core`; parameterize `find_game_pid`; add u32 chain mode, AOB scanner, region-fingerprint scanner (generalize the MvC2 512MB-reservation technique). Scope reduction if skins are dropped (see §1.3): `open_rw`/`write` leave `rr-core` entirely, along with `painter.rs`, the SSE command downlink (`start_cmd_subscribe`/`cmd_sse_once`/`handle_cmd_event`), `fetch_loadout`, and the tray skins toggle — `rr-core` becomes a read-only surface. Pointer-follow through rollback savestate copies **stays** (needed for reads). Exit: MvC2 agent runs unchanged on `rr-core`.

**WS2 — Event model.** Define `rr-events`; refactor `reader.rs` so the MvC2 loop emits events into an internal channel consumed by the existing report path. **Behavior-neutral** — byte-identical server traffic, verified against a live session. Exit: parity confirmed on Windows + Bazzite.

**WS3 — Declarative engine.** `rr-cartridge` parser + locators + edge rules + `DeclarativeDriver`. Pilot cartridge: **+R** (published MIT offsets, depth-1 chains — validates the template, not the RE). Second pilot: **KOF 2002 UM** (validates fixed-base x64 + a scan-session workflow). Exit: a +R match auto-tracked end-to-end into a dev server.

**WS4 — Server multi-game ingest.** `game_id` migration, `/ingest/v1/event`, compat shim, per-game validators, trust-tier enforcement in the wager path (`wager.rs` accepts certified game_ids only). Owner: server session. Exit: two game_ids live concurrently without cross-contamination.

**WS5 — Server-side feeders.** Board-delta poller (all three Capcom collections + Garou TOTAL WINS + SSVSP), details-blob decode experiment, points-symmetry experiment, lobby-watcher integration (shares the greenlit spectate bot). Exit: per-player W/L ledgers for board-enabled games with zero agents installed.

**WS6 — Cartridge Studio** (the dev app — see §4). Exit criteria per milestone below.

**WS7 — SDK & community.** `cartridges/` directory + contribution guide + trust policy doc + golden-trace CI + signed cartridge-pack distribution over the existing minisign update channel (new game support ships **without a binary release**). Exit: an external contributor lands a cartridge via PR, green CI, no maintainer hand-holding.

**WS8 — Rollout.** Author the cartridges in scouting-report order: MVCFC 5-pack (one CPS2 base hunt amortized ×5), VSav/HSF2, KOF '98 UMFE, KOF '97 GM; CvS2 native driver when justified. Each needs the small supplemental RE the report flags (win counters, active-title detection in collections).

---

## 4. Cartridge Studio (`rr-studio` + `rr-cart` CLI)

The developer companion app: attach to any running game, find the data, author the cartridge, prove it works. One Rust codebase, three faces: **egui GUI** (precedent: `tools/finger-gap-tester`), **headless CLI** (`rr-cart`) for scripting/CI, and an **MCP server mode** so an LLM can drive it. Depends only on `rr-core` + `rr-cartridge`; never ships inside the user agent.

### 4.1 Core features

- **Process picker** — enumerate candidates (Win + Proton), attach read-only.
- **Value scanner** — Cheat-Engine-style narrowing: search exact/changed/unchanged/decreased across snapshots ("search 144 → take a hit → search decreased").
- **Chain solver** — given a found address, walk pointers back to stable exe-relative chains; re-verify across game restarts to kill false positives. Automates what we did by hand for MvC2 over weeks.
- **Fingerprint builder** — for emulated cores: capture a guest-RAM content signature, generate a `region_fingerprint` locator, verify across reboots.
- **Stride detector** — find repeating struct layouts (how we found the 0x738 fighter stride) and label per-slot fields once.
- **Live watch** — bind candidate fields, play, watch values stream with edge annotations.
- **Event-rule builder** — record a session, mark moments ("round ended HERE"), studio proposes edge rules that reproduce the marks.
- **Trace recorder / golden tests** — timed memory traces exported as fixtures; `rr-cart test` replays them and asserts the cartridge's event stream. This is the CI story for contributions.
- **Spec lint + probe** — validate a GameSpec offline; `rr-cart probe` runs it against a live game and prints every field + fired events.

### 4.2 LLM integration (the RE copilot)

The studio's MCP server exposes the primitives as tools:

```
list_processes / attach
scan { mode: exact|changed|unchanged|inc|dec, value?, width }
read { addr, len }         snapshot / diff_snapshots
chain_candidates { addr }  watch { fields[], duration }
propose_spec / write_spec { toml }
run_probe { spec }         record_trace / test_trace
```

Three copilot workflows this enables:

1. **Guided discovery.** The developer (or Tris) tells Claude "find P2 health in this game"; the model directs the scan-narrow-verify loop through tool calls, interprets candidate clusters, hypothesizes struct layouts, and emits a draft GameSpec. This is literally the loop we already run manually in RE sessions — productized. (Precedent: we already drive Ghidra through MCP.)
2. **Prior-art import.** Feed the model a community artifact — a peon2 lua, GearLoader's `offsets.h`, a Cheat Engine table — and it translates addresses/structures into a GameSpec draft, flags license posture (facts vs copyrightable code), and cites the source in the spec header.
3. **Trace annotation.** Given a recorded trace plus "the match ended around 02:14", the model proposes and validates the edge rules against the trace before a human ever replays the game.

Guardrails: MCP mode is attach-read-only by default; memory *writes* require an explicit `--allow-poke` flag (occasionally needed in RE, never in cartridge authoring); the studio refuses to attach to processes protected by known anticheats — this is a tool for the retro catalog, and we keep it that way deliberately.

### 4.3 Why this is strategic, not tooling gold-plating

Every game in WS8 needs the same three discoveries (base, fields, edges). The scouting report showed the per-game cost is dominated by exactly the manual loop the studio automates — and the community contribution model (§WS7) only works if outsiders have a tool that makes a cartridge in an afternoon instead of a Ghidra apprenticeship. The studio *is* the growth mechanism for game coverage.

---

## 5. Trust & certification

| Tier | Grants | Requirements |
|---|---|---|
| `stats` | Match tracking, profiles, ratings | Cartridge merged via PR review + golden traces |
| `certified` | Money matches (wager.rs accepts events) | First-party review of the driver/spec **and** at least one server-side corroboration source configured (board reconcile, lobby co-occurrence) |

Events carry `source` provenance; MatchLog rows record it; disputes replay the evidence. Board-delta-only records are always advisory (never settle money).

---

## 6. Roadmap

Milestones gate on exit criteria, not dates. Order respects dependencies; WS5 can run parallel to everything (server-only).

- **M0 — Foundations.** WS1 + WS2 done; MvC2 parity proven on both platforms. *Exit: fleet agent release built from the workspace with zero behavior change.*
- **M1 — First cartridge.** WS3 pilot: +R tracked end-to-end (stats tier) in a dev environment. *Exit: a real +R match produces a correct MatchLog row.*
- **M2 — Multi-game server.** WS4 live + WS5 board-delta feeder for MVCFC/Garou/SSVSP; PWA game switcher (this session's lane). *Exit: a second game visible in the PWA, backed by both feeder types.*
- **M3 — Studio alpha.** WS6 scanner + chain solver + spec export + MCP mode. *Exit: the KOF 2002 UM cartridge is authored **using the studio** — dogfooding is the acceptance test.*
- **M4 — Community SDK.** WS7 published. *Exit: first external cartridge PR merged green.*
- **M5 — Fleet expansion.** WS8: MVCFC 5-pack + CFC1 live; ≥3 games at `certified`. *Exit: money matches run in a second game.*

### Non-goals (decided, not open)

**Skins / cosmetics are not part of the multi-game roadmap.** No new game gets a skins feature — not at M1, not at M5, not ever as a cartridge capability. The MvC2 painter is legacy from the product's skin-suite era and is itself a deprecation candidate (§1.3); it is the exception being retired, not the pattern being extended.

This is stated as a non-goal because the opposite case is easy to make and will be made: palette and skin tooling *is* publicly documented for several roadmap targets (Vampire Savior palette data in the CPS2 maps, MBAACC palette editors, and ACPR_IM already shares palettes between +R players online). Availability is not the constraint. The constraints are that RR is a tracker — ranks, receipts, H2H, money matches — and that a read-only agent is a materially better product: a simpler promise to users ("we only read your game, we never write to it"), a simpler contract for community cartridges, and no possibility of our writes being read as tampering by any publisher. Adding a writer back for one game forfeits all three for every game.

If cosmetics ever return as a product idea, they come back as a **separate first-party application** with its own threat model — never as a capability the cartridge runtime grants.

---

## 7. Open questions (for reviewers)

1. Simultaneous multi-game: one process attached at a time, or concurrent sessions (two games running)? Supervisor implications.
2. `state_tick` budgets per game — who caps the rate, spec or agent policy?
3. Cartridge-pack versioning vs agent-version compatibility matrix — how does the server express "spec v3 requires agent ≥0.4.1"?
4. Where do enum tables (char rosters) live — in-spec or shared data files?
5. Collections: is active-title detection a locator concern (per-title fingerprints) or a session concern (one attach, title as a field)?
6. Server event retention for `state_tick` (if ever enabled) — bus-only, never stored?
