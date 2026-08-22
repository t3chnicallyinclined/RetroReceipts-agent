# Seamless host-node install — design spec (DRAFT)

**Goal:** one install (the agent). When a user flips **"Host this machine,"** the
agent sets up the entire host-node runtime with **zero manual steps** — no running
`install.sh`, no building/placing `version.dll`, no editing the Proton prefix by
hand. Today `host_enable()` *refuses* when the scripts are absent ("host scripts
not installed") and the injector must be built + deployed by hand. This closes
that seam.

Principle: **the agent is the single deliverable and the orchestrator; the
validated bash stays the deployer.** The agent's new job is to *carry* the assets
and *lay them down*, then delegate to the proven scripts. Minimal new Rust; no
rewrite of working automation.

---

## What the host runtime needs on disk (today, all manual)

1. **arcade-host scripts** at `~/.local/share/retro-receipts/arcade-host/`
   (`arcade_host.sh`, `arcade_hostd.sh`, `act_shot.sh`) + the systemd `--user`
   unit at `~/.config/systemd/user/arcade-hostd.service`.
2. **The injector proxy `version.dll`** — built (mingw-w64) and installed into the
   game dir, with the `versionorig.dll` chain + the Proton prefix DLL override
   (`version=native,builtin`). ⚠ **The bash host flow REQUIRES this** —
   `arcade_host.sh` reads the live lobby via `nobd_arcade.cmd`/`.result` (the
   injected dll). No injector ⇒ no host flow.
3. **Preconditions** that can't be manufactured: game installed; Proton prefix
   built (game launched once); game **not running** during the prefix edit.

---

## Design — "agent materializes, bash deploys"

### 1. Embed the assets in the agent binary (compile-time)
- Scripts (text) via `include_str!`: `arcade_host.sh`, `arcade_hostd.sh`,
  `act_shot.sh`, `arcade-hostd.service`.
- Injector proxy (binary) via `include_bytes!`: `agent/assets/version.dll`
  (built by the release pipeline before the agent compiles; gitignored — §5).
- A **bundle version marker** (agent version or content hash) compiled in, so the
  agent can detect + refresh a stale on-disk install after an upgrade.
- All **Linux-gated** (`#[cfg(target_os = "linux")]`); the Windows build doesn't
  embed the Linux runtime (host mode on Windows is still "soon").

### 2. Auto-materialize on `host_enable()` (replaces the refuse-path)
Current: script missing → `Err("host scripts not installed")`. New sequence:
1. ensure `host_dir()` exists.
2. if the on-disk bundle marker ≠ the embedded marker (missing or stale) → write
   all scripts (mode `0o755`), write the systemd unit, update the marker.
   Idempotent; runs on first enable **and** after every agent upgrade.
3. materialize `version.dll` to the injector staging path.
4. delegate to `arcade_hostd.sh register` (as today) — which now also ensures the
   injector is deployed (§3).
5. **stay HONEST** — only report ON when `register` truly succeeded; surface
   precise precondition failures to the tray (never a false ON). This preserves
   the module's current contract.

### 3. Injector auto-deploy (the hard part) — folded into `register`
`arcade_hostd.sh register` gains an `ensure_injector` step that runs the
`setup_proxy.sh` logic against the **materialized** dll:
- locate `GAMEDIR` + `PFX` (reuse `arcade_hostd.sh` `_detect_gd` + the
  `setup_proxy.sh` defaults; probe the common Steam/Bazzite paths).
- preconditions → clear messages, no false success:
  - prefix not built (`user.reg` absent) → "launch MvC2 once so Proton builds its
    prefix, then re-toggle Host."
  - game running → "close MvC2 and retry" (registry edit needs it closed).
- back up the real `version.dll` → `versionorig.dll`, copy the materialized proxy
  into `GAMEDIR`, set the `DllOverrides` `version=native,builtin` in `user.reg`
  (idempotent — skip if already set).

The agent supplies `version.dll` (materialized in §2), so `setup_proxy.sh` no
longer needs `build.sh` output at runtime.

### 4. Toggle OFF — open decision (recommendation: A)
- **A (recommended):** OFF stops/disables the service only; **leaves** the proxy +
  prefix override in place. Harmless (the dll only acts on command) and gives the
  fastest re-enable. Expose full revert as an explicit **"Remove host support"**.
- **B:** OFF also runs `setup_proxy.sh uninstall` (restore original `version.dll` +
  prefix). Cleaner, but slower and needs the game closed.

### 5. Release-pipeline change (peer-owned) — REQUIRED
Before the agent compiles, the pipeline must build + stage the injector for
embedding — the exact analog of the PWA `build-char-anim.py` preregen step the
peer just wired:
- build `host-node/injector` via `build.sh` (mingw-w64 → `version.dll`) on the
  build box (needs the **mingw-w64** toolchain installed there).
- copy `version.dll` → `agent/assets/version.dll` (gitignored) so `include_bytes!`
  finds it.
- **abort the build if the dll is missing** — no silent host-less release.

### 6. Security note
The injector is a `version.dll` DLL-override in the game's Proton prefix
(trainer-class). The appid has **no VAC** (confirmed in `host-node/injector/
README.md`) — acceptable risk class. The agent deploys it **only** in host mode,
on an explicit user toggle.

---

## Net UX
- **Player** (the common case): installs the agent → nothing changes; host mode is
  off by default.
- **Host operator:** installs the agent, launches MvC2 once (Proton builds the
  prefix), flips **"Host this machine"** → the agent lays down scripts + injector +
  prefix override and starts the service. **One install, one toggle.** Any
  precondition that can't be auto-satisfied (game not installed / never launched /
  running) yields a precise, honest message instead of a silent half-setup.

---

## Work breakdown
- **Agent** (Rust — coordinate with the peer, it's their crate): embed assets +
  marker; rewrite `host_enable` to materialize + refresh; add the injector
  materialize step; honest error surfacing; keep the Windows no-op.
- **Bash** (arcade-host): `register` → `ensure_injector` (runs `setup_proxy.sh
  install` against the materialized dll); precondition messages.
- **Pipeline** (peer): build the injector dll + stage to `agent/assets/`
  pre-compile + abort-if-missing gate; add mingw-w64 to the build box.
- `install.sh` stays as a manual/dev fallback (no longer a user requirement).

## Status
IMPLEMENTED + Linux-verified. Landed on `main`: `agent/build.rs` + `agent/src/host.rs`
(materialize/refresh + synchronous injector pre-check), `host-node/arcade-host/
arcade_hostd.sh` (`ensure_injector` + gated `register` + `ensure-injector` subcommand),
the peer's `agent/scripts/build-injector.sh` (mingw build + stage), and `agent/src/
tray.rs` (toasts the precondition reason on failure + the don't-play warning on success).

Two-branch compile-verify PASSED on the Bazzite `tauri44` distrobox: branch A (dll
staged via `build-injector.sh`) builds; branch B (no dll) builds clean (no dead_code /
unexpected-cfg); binary delta ≈ the 512 KB dll → `cfg(injector_bundled)` provably took
and the dll embedded. Peer signed off as reviewer of record for `agent/`.

Remaining to SHIP: version bump + a `--release` cut from this repo + manifest flip
(peer), and a live one-toggle host test — which needs a box that can actually host
(owner decision, since the Beelink is now the play box).
