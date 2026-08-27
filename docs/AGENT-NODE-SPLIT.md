# AGENT / NODE SPLIT — the design plan

> Status: **PLANNED** (owner-greenlit planning, 2026-08-27). Build is SEQUENCED — see §6; do not start
> before its gates. Joint product of two expert consultations run against the real code + the live
> cabinet: the **money expert** (money-path surface; findings N1–N9) and the **systems expert**
> (client/system architecture, empirically validated on the Beelink; findings R0–R8). Full reports in
> the session transcript 2026-08-27; every claim below carries their file:line evidence.
> Owner intent: one binary per ROLE — the 2026-08-27 live test's role-bleed bug class (a cabinet
> reporting results as a participant, a player latching the host as opponent, the Host toggle
> clobbering deployed fixes) becomes *code that does not exist in the binary*.

## §0 The one reframe that shapes everything (money expert)

**Non-compilation defends against BUGS, not against the CREDENTIAL.** The cabinet's bearer token is
the same class as any player's, minted from the same open endpoint (`/skinsync/register` — an
unauthenticated mint for an arbitrary SteamID, routes.rs:332-345, by design). No rail/wager client
code exists in the agent today, yet anyone holding a cabinet's token file can bet the rail and offer
wagers *as the cabinet*. Therefore: **the node credential class (§2) ships in the same release train
as the split — the split without it is a false sense of closure.**

## §1 Target shape (systems expert R1, verified boundaries)

```
RetroReceipts-agent/
  Cargo.toml            [workspace] members = ["crates/*", "agent", "noded"]
  crates/rr-mem/        mem.rs VERBATIM (544 lines, zero crate:: refs — measured)
  crates/rr-core/       config.rs, prefs.rs, single_instance.rs, role.rs (new)
  crates/rr-host/       host.rs + build.rs + assets/version.dll   (⚠ include_str! paths + OUT_DIR move)
  crates/rr-game/       lib.rs shim + reader.rs + painter.rs + updater.rs (+ char_sigs)
  agent/                bin rr-agent: main.rs, tray.rs, autostart.rs   (player role, GUI)
  noded/                bin rr-noded: main.rs                          (node role, headless)
```

- `reader.rs` moves **byte-identical** — FROM THE MERGED FILE, never from main's stale copy: its
  whole crate-surface is six paths (`config/host/mem/painter/runtime_dir/updater`) re-exported by
  the `rr-game` shim. ⚠ SEQUENCING (replay lane, 2026-08-27): the 0.3.24 branch carries reader.rs
  399 lines ahead of main — moving main's copy first would force their in-flight commits to merge
  across a rename over a 399-line diff. **Phase 1's move gates on the 0.3.24 branch LANDING ON MAIN
  (merged), not merely on the release shipping.** The replay lane's tape/capture regions stay
  untouched either way.
- `painter.rs` stays beside `reader.rs` (imports eight `pub(crate)` reader items — measured).
- `updater.rs` lives in `rr-game`, NOT rr-core (it calls `reader::agent_status()` — cycle otherwise).
- **Phase 1 changes exactly ONE line of reader.rs**: gate the presence heartbeat on `!HOST_MODE` —
  the only role gate missing (the result + /match/live gates already exist). ⚠ Locate all three
  gates BY CONTENT, not line number — the anchors cited here (3189/2519/3623) are against main's
  copy and have shifted on the 0.3.24 branch. `rr-noded` sets HOST_MODE as its first statement and
  asserts it in the startup log. (Replay lane reviewed this gate: consistent with their on_game_win
  HOST_MODE gate — a cabinet should not appear as a present player any more than it reports results.)
- **Phase 2 (AFTER the 0.3.24 train lands)**: convert the role gates + opponent-detection call sites
  (reader.rs 2519/3189/3623/642/716) to `#[cfg(feature = "player")]` — "not compiled in" becomes
  literally true. Sequencing second avoids racing the replay lane's in-flight file.

**GUI fence (R2, measured):** the tray's deps (`tao/muda/tray-icon/open/notify-rust`) are the sole
source of the entire gtk/glib/dbus/zbus closure. Headless probe build on the bare Bazzite host (no
distrobox, gtk-devel absent): 88 crates vs 315, 3 NEEDED libs vs 12, 343 KB vs 7.5 MB.
⚠ Trap: `updater.rs` toast/notify (updater.rs:374-401) drags dbus back in — hoist behind an injected
notifier (`set_notifier(fn)`); agent installs notify-rust/MessageBox, node installs eprintln
(journald). **Release gate:** `objdump -p rr-noded` NEEDED == exactly `libgcc_s, libc, ld-linux`.
⚠ rr-noded is GUI-less, NOT session-less: the payload harvests the compositor session env to drive
Steam/the game. Unit keeps `After=/PartOf=graphical-session.target`; **never** `loginctl enable-linger`.

## §2 Node credential class (money expert N1 — HIGHEST-VALUE ITEM)

- `Token` gains `#[serde(default)] class: String` ("" = player; "node"). `auth_steamid` — which every
  player/money route already calls — returns **None** for node-class tokens: one change point, no
  allowlist to forget. New sibling `auth_node_steamid` used by exactly `host_report`,
  `arcade_host_heartbeat`, `host_unregister`.
- **Enrolment is an operator act**: node tokens are minted via an admin-gated endpoint
  (`admin_ok`), NEVER via the open `/skinsync/register` mint. (That open mint is a whole-system
  identity question, flagged, out of scope here — N1 is designed as if it never changes.)
- **Migration (no outage):** additive field → out-of-band node tokens on live cabinets → dual-accept
  window (`auth_node_steamid(...).or_else(auth_steamid)` on the two host routes) → the deny-flip is
  its own small, staged, money-reviewed diff.
- Bonus this buys for free: the "referee doesn't fight" result guard re-anchors on the durable
  credential instead of the 45s liveness window (money expert §6.4 — a dead-lobby cabinet currently
  drops out of the guard 45s after its last heartbeat).

## §3 The referee's future (the ONE expert conflict, resolved)

- **Money expert Stage A:** move the REPORT leg to Rust now (durable outbox + idempotent retry
  against the server's `already:true`); keep the Python memory reads verbatim (port-proven rule).
  Driver: referee.py's retry **gives up silently after 5 tries and marks the set done**
  (referee.py:160-170 + :256-260) — a routine 60s server deploy converts a settle into a 30-min
  refund. The decision/report/arming logic is exactly what Rust unit tests can lock
  (crash-retry suite in the shape of `rail_settle_crash_retry_delivers_full_rake`).
- **Systems expert R3:** the Python reads are a SECOND independent RE implementation of the same
  offsets on a money path (find_pid/base_of/seat_scan re-implement rr-mem/reader) — absorb the READS
  into rr-noded by REUSING the proven Rust readers; never chase launch_game/lobby-cycling into Rust.
- **Resolution (both endorsed halves of the same destination, sequenced):**
  - **Stage A (with the split):** report leg + arming gate + freshness gate + durable outbox in
    rr-noded Rust. Pure new logic, fully testable, zero RE risk, kills the settle-loss mode.
  - **Stage B (after the live seat-map validation produces a recorded corpus):** absorb the memory
    reads by calling the SHARED, live-validated rr-mem/rr-game paths — this is *deduplication onto
    the proven implementation*, not a re-derivation, so it satisfies the port-proven rule while
    killing the duplicate-RE defect. referee.py retires.
  - rr-noded owns the *units* (materialize + reconcile, ensure-units semantics ported verbatim:
    cmp → cp → daemon-reload → RESTART); **systemd owns the processes** — one supervisor, not two.

## §4 Identity, coexistence, runtime (systems R4/R6 + money N8)

- **rr-noded never calls `/rr/heartbeat`** — a cabinet is not a player-presence row. This also
  protects the rail integrity report's shared-IP correlation from a silently merged IP set (money
  N8). Node heartbeats stay on `/arcade/host/heartbeat`, gain `client:"node"` + a stable `node_id`
  (seeded from /etc/machine-id) so a cabinet that switches Steam accounts keeps pool identity.
  Server adds `LATEST_NODE_VER`; `/skinsync/agent` fleet compare excludes node rows.
- **Role-aware `runtime_dir()`** (node → `.../retro-receipts/node/`) makes state dirs, auth.json,
  and the single-instance locks split for free. Windows mutex gets a role suffix.
- **Two-OS-user coexistence defect (found, unhit):** Steam is single-instance per OS user; two roles
  concurrently = two users; cross-uid `process_vm_readv` fails (kernel rule; cross-uid case NOT
  live-measured — flagged) while `find_game_pid` scans all of /proc and open_read still "succeeds" →
  eternal silent read-failure. Fix = uid-aware candidate RANKING (prefer same-euid), explicitly a
  NEW FILTER under the port-proven rule: live-validate before ship, never a hard exclusion.
- **Headless control surface:** `rr-noded pause|resume|skins on|off|status` subcommands backed by a
  state file (the PAUSED tray checkbox has exactly one writer today: tray.rs:403), plus a `paused`
  field in the heartbeat REPLY so a TO can pause a node remotely.

## §5 Update pipeline + observability (systems R0/R5 + money N5/N7)

- **Beta channel is the build gate (R0/G10):** `prefs.channel` + `agent-beta{,-linux}.json` +
  `node-beta-linux.json`; the Beelink pins to beta permanently — it IS the staging cabinet. The
  first rr-noded release must not be simultaneously the first node binary, the first two-process
  box, and the first /result-gating change, delivered blind.
- **rr-agent keeps hourly self-update. rr-noded does NOT self-apply:** downloads + minisign-verifies
  + reports "update ready"; applying is operator-confirmed, staged (staging cabinet first, then
  fleet). Node `safe_to_apply` = assignment empty AND referee not mid-set AND lobby unoccupied — a
  NEW predicate beside (never modifying) the player gate. Runbook owes the money path: node release
  → staging cabinet → ONE REAL REFEREED SET settles end-to-end → promote; after any node update,
  re-verify arming (formality once arming-is-data, N2 — already shipped 2026-08-27).
- Assets 4 → 6 (`+rr-noded-linux{,.sig}`), manifests 2 → 3 (+ beta channel doubles). The
  systemd-aware restart path (updater.rs:197-212) applies to rr-noded unchanged. ⚠ Restart ordering:
  noded stays OUTSIDE the hostd/refereed Requires/PartOf group so a noded self-swap can't bounce the
  referee mid-set.
- **Observability contract (N5)** — HostNode gains (all serde-default): `referee_running/_ver`,
  `referee_armed/_seat_p1`, `assignment_seen`, `set_score/set_done`, `last_report{wid,ts,outcome}`,
  `report_queue_depth`. Money-path driver: a DEAD referee today = `active:-1` = the rail's
  "referee" close-latch never fires = up to 10 minutes of open betting on a live match
  (RAIL_BETTING_MAX_MS backstop). ⚠ Diagnostics go behind `admin_ok` (a new admin fleet read) — NOT
  the open /arcade/hosts (whether a cabinet's settle path is live is intelligence for bet-timers).
  Plus the audit check (house invariant 10): *locked arcade wager + online host + referee not
  running/armed = loud alarm* — the detector for silent disarm and silent give-up.

## §6 Sequencing (the gates, in order)

1. ✅ **Already shipped (2026-08-27, ahead of the split):** N2 arming-is-data (referee.env,
   no-touch contract); N3 fee pays the bound node identity, never the heartbeat owner (payee bugs
   are invisible to Σ=0 auditing — test splits the identities); N4 registered cabinets refused at
   wager offer/accept (their results are policy-ignored → their matches were unwinnable); the
   "referee doesn't fight" result guard; pick_host fighter exclusion; walk-on TTL grace.
2. **Tape-final 0.3.24** ships AND its branch **lands on main** (replay lane; the merge is the
   phase-1 gate, not the release — reader.rs must be moved from the MERGED file). Includes the
   on_game_win HOST_MODE gate, the 3-seat opponent-ID fix, and the host-node payload bundling
   (payload parity with main confirmed 2026-08-27; preserve the referee.env no-touch contract).
3. **Legacy 0.2.6 fleet migration** (held gate, plan in memory rr-legacy-fleet-migration).
4. **R0 beta channel** + staging-cabinet posture.
5. **Split phase 1:** workspace + shim (+1 line reader.rs) · N1 credential class (same train) ·
   §4 identity/runtime-dir/locks · §5 pipeline+observability+audit check · R6 migration (Beelink
   unit swap incl. deleting the autostart double-start; Host-toggle-becomes-installer;
   version-stamped materialize with content-hash backup — the silent clobber is ARMED today:
   marker 04:13 vs hand-fixed script 05:18) · referee Stage A.
6. **Split phase 2:** `#[cfg(feature="player")]` (not-compiled becomes literal) · referee Stage B
   (reads onto the shared core; referee.py retires) · uid-ranking filter (live-validated).

## §7 Invariants to hold forever (write-downs both experts demanded)

- **N9 (ordering):** `arcade_host` is only ever assigned strictly BEFORE a wager reaches `locked`;
  betting only opens ON `locked`; therefore a referee can never hold a bet on the match it judges.
  True today (verified); any future "re-assign a dead cabinet mid-set" feature breaks it silently.
- **Arming is data, never code.** No bundle/materializer/refresh path may ever create or touch
  `referee.env`. Absent = observe = safe.
- **Refresh follows the operator; it never leads.** (2026-08-27, learned twice in one day.) No
  refresh/reconcile/deploy path may ever START a unit the operator stopped — a changed definition on
  an active unit restarts it; on a stopped unit the file lands and the unit stays down. In rr-noded's
  Rust reconciler this is a STATED, CHECKED invariant, not an emergent property of conditions that
  happen to line up. Unit coupling is ONE-WAY only (PartOf, never Requires — empirically verified:
  Requires made touching the referee resurrect hosting).
- **The server guards stay after the split lands** (result guard, offer/accept refusal, pick_host
  exclusion): S defends the new fleet, V defends against old binaries and leaked tokens. Never trade
  one for the other.
- **Fee payee = bound node identity.** Conservation auditing cannot see payee bugs; only
  authorization can.
- Small debts, noted: referee.py token path drift (`.metasync_host_token` vs runbook's
  `.rr_host_token`); hostd's `-1 = leave-as-is` comment is wrong (server stores it — correctly);
  the tray zombie is `open::that_detached` at tray.rs:392 (attribution by elimination — reap on a
  throwaway thread; NEVER SIGCHLD=IGN, Command::output relies on waitpid).
