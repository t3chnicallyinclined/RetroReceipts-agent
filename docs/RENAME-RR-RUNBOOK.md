# Internal Rename Runbook — `skinsync` / `metasync` → `rr-server` / `rr-agent`

Consolidate every legacy internal name (from the skins era → MetaSync → Retro Receipts) onto the
`rr-*` convention, matching the `RetroReceipts-agent` / `RetroReceipts-server` repos. **Zero downtime,
no client breakage, no user logout.** User-facing wording is already "Retro Receipts / RR" — this
runbook is the *internal* pass (crate/binary/unit/paths/API-prefix/state identifiers).

Ledger account prefixes (`mescrow:` / `wentry:` / `wpayout:` / `treasury`) are **NOT renamed** — they
are abstract keys, not brand, and renaming them would fork the live TigerBeetle ledger history.

## Blast radius (measured 2026-08-22)
- Server `/skinsync/` API prefix: **156** across 9 files (routes.rs = 102 route strings).
- PWA + tray calling `/skinsync/`: **144** across 44 files.
- `metasync` / `MetaSync`: **63** across 24 files (crate, autostart, updater, mutex, state/storage keys).
- `legacy/` (archived Tauri app) occurrences are **excluded** — frozen; renaming is pointless churn.

## Name map (old → new)
**Server** — crate/pkg `skinsync`→`rr-server` · binary `skinsync`→`rr-server` · dir
`RetroReceipts-server/skinsync/`→`server/` · systemd `skinsync.service`→`rr-server.service` ·
`/opt/skinsync`→`/opt/rr-server` · `/opt/skinsync-src`→`/opt/rr-server-src` · API `/skinsync/*`→`/rr/*` ·
nginx `location /skinsync/`→ also `/rr/`.
**Agent/tray** — crate/binary `metasync-agent`→`rr-agent` · state dir `%LOCALAPPDATA%\MetaSync`→
`\RetroReceipts` (+ Linux XDG) · mutex `Global\MetaSyncAgentSingleton`→`…RetroReceipts…` · autostart
key `MetaSyncAgent`→`RetroReceiptsAgent` · Win AUMID `MetaSync`→`RetroReceipts` · `metasync-agent.desktop`→
`rr-agent.desktop` · host token `.metasync_host_token`→`.rr_host_token` · release asset
`metasync-agent.exe`→`rr-agent.exe` · manifest `agent-latest.json` (keep name; only the asset URL/name
inside changes).
**PWA** — call sites `/skinsync/`→`/rr/` · localStorage `metasync_*`→`rr_*` (migrate) · SW cache
`metasync-api`→`rr-api` · deploy `/var/www/metasync-app`→`/var/www/rr-app`.

## Stages (safe order — each independently reversible)

### Stage 1 — Server backward-compat prefix (no client impact) ← **me**
- routes.rs `handle()`: after `path` is derived, rewrite `/rr/<x>` → `/skinsync/<x>` before routing, so
  ALL 102 arms + the rate-limiter resolve both prefixes. 2 lines, no arm churn.
- nginx: add `location ^~ /rr/ { proxy_pass http://127.0.0.1:7250; … }` mirroring `/skinsync/`.
- Deploy + verify both prefixes resolve. Clients still on `/skinsync/*` — nothing breaks.

### Stage 2 — Client migration to `/rr/*` + new state (with migration) ← me (PWA) / peer (tray)
- **PWA (me):** sweep call sites `/skinsync/`→`/rr/`; migrate localStorage (read `metasync_*` as
  fallback, write `rr_*`); SW cache → `rr-api` (autoUpdate re-caches). Ship via the gated pipeline.
- **Tray (peer):** flip reader/config base `/skinsync/`→`/rr/`; migrate state dir (move old→new on first
  run when new absent); rename mutex / autostart key / AUMID / `.desktop` **with migration** (remove old
  autostart entry, add new); migrate `.metasync_host_token`. **Binary rename `metasync-agent`→`rr-agent`
  must be coordinated with the self-update chain** (release asset name + `agent-latest.json` asset URL +
  updater self-replace target + install-script `pgrep/pkill`) — get any one wrong and the fleet's
  auto-update bricks. Ship as one new tray release.

### Stage 3 — Server internal rename (Tier A; no client impact) ← **me**
- Cargo.toml pkg/bin `skinsync`→`rr-server`; `git mv skinsync/ server/`; fix intra-repo path refs.
- VPS one-time migration: build new binary; write `rr-server.service` (ExecStart `/opt/rr-server/rr-server`);
  move `/opt/skinsync`→`/opt/rr-server`, `/opt/skinsync-src`→`/opt/rr-server-src`; `systemctl stop+disable
  skinsync` → `enable+start rr-server`; verify health; keep old unit as `.bak`. Update deploy scripts.

### Stage 4 — Drain + drop old (after fleet migrates off `/skinsync/*`) ← me + peer
- Watch access logs for `/skinsync/*`. When ~0 (fleet drained), remove the old prefix from the shim +
  nginx, and drop the old-state fallback reads from clients in a later release.

## Ownership
- **Me:** server (shim, Tier A rename), nginx, PWA (prefix sweep + state migration), deploy scripts.
- **Peer (projects-a5):** tray binary/state/mutex/autostart/`.desktop`/host-token + reader prefix + the
  release pipeline (asset name + manifest + updater self-replace). Stage 2 tray is theirs end-to-end.

## 0.3.8 TRAY RELEASE — checklist (bazzite-linux-expert reviewed the code: GO; conditions are release-ops)

Correctness invariants confirmed by review:
- **migrate-before-lock is load-bearing:** `migrate_legacy_state_dir()` MUST stay above `enforce_single_instance()`
  in main(). On Linux the fs::rename preserves the lock inode across mvc-live-skins→retro-receipts, so old↔new
  share the guard through the one-time hop. Never reorder these.
- **self-replace is name-agnostic** (both OSes) → existing installs keep the metasync-agent(.exe) filename
  running rr-agent code; only fresh installs get the rr-agent name. Fleet handoff safe.
- **Update manifest is served at BOTH `/skinsync/update/` and `/rr/update/`** from the one file at
  /opt/rr-server/update/ (verified 200/200). So the 0.3.7 fleet (polls /skinsync) catches 0.3.8 AND upgraded
  0.3.8 agents (poll /rr) keep updating — no split publish needed.
- **#2c FIXED (fd8327e):** reader state root is runtime_dir() on Linux → auth/gs-cache/result-outbox are
  migrated + reboot-durable on the Beelink (was /tmp, ephemeral).

Release steps (execute when the Beelink is free — needs the distrobox for the dll + Linux build + the canary):
1. [ ] Stage the injector into the bundle: run `agent/scripts/build-injector.sh` at the LATEST injector HEAD in
       the tauri44 distrobox → stages agent/assets/version.dll. ⚠ HEAD = cf10024 + 8fd828e (the CM-obj+0xb0
       header-count poke + default-3 flip) — NOT the earlier 862f44f/ff6baef2, which set cMaxMembers/SlotPublicMax
       but left the lobby header showing 1/2. The dll sha is NON-reproducible (mingw PE timestamp) — do NOT
       sha-pin; verify the invariant instead (16 forwarders → versionorig.*) and that a live create reads back
       `cm_b0=poked` + header 1/3. Confirm the final injector head sha with projects-2b before building.
2. [ ] Build Windows rr-agent.exe (local MSVC) + Linux rr-agent-linux (distrobox), both from HEAD with the dll staged (cfg injector_bundled).
3. [ ] Sign each with `cargo tauri signer sign` (key ~/.mvc-updater/signing.key, empty pw via cmd.exe) → base64 .sig.
4. [ ] `gh release create v0.3.8` on RetroReceipts-agent with EXACTLY: rr-agent.exe, rr-agent.exe.sig,
       rr-agent-linux, rr-agent-linux.sig (Linux asset name MUST be rr-agent-linux — installer + manifest depend on it).
5. [ ] Flip /opt/rr-server/update/agent-latest.json + agent-latest-linux.json → version 0.3.8, url → the v0.3.8
       assets (keep .bak). Both prefixes serve it automatically.
6. [ ] Bump server config LATEST_AGENT_VER 0.3.2→0.3.8 + redeploy rr-server (the /rr/agent update-nag banner).
7. [ ] CANARY the Beelink 0.3.7→0.3.8 once (coordinate projects-2b): confirm relaunch (not the 0.3.6 no-reopen
       bug — 0.3.7 carries the fix), `[migrate] state dir` log, ONE agent.lock holder, mvc-live-skins gone, then it polls /rr.
8. [ ] Ping projects-a5 to flip the PWA DownloadAgent link metasync-agent.exe → rr-agent.exe (lockstep with the release).

## Progress
- [x] Stage 1 server shim + nginx (LIVE)
- [x] Stage 2 PWA (me — LIVE on prod)  ·  (tray is mine now, see 0.3.8 checklist)
- [x] Stage 3 server Tier A rename (LIVE + verified)
- [~] Tray rename: code DONE + reviewed (GO); 0.3.8 release pending (checklist above)
- [ ] Stage 4 drain + drop old (once /skinsync/* traffic ~0)
