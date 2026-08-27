// Central constants for the Retro Receipts tray agent (rr-agent). Kept in one place so the endpoints/version
// match the shipped app and the separate web app.

/// Base of the rr-server REST API (leaderboard, presence, results, defaults, …). The server accepts BOTH the
/// new `/rr` prefix and the legacy `/skinsync` one during the rename drain, so old builds keep working.
pub const SERVER_BASE: &str = "https://nobd.net/rr";

/// Signed self-update manifest (minisign). The tray agent's OWN manifest (flat form: {version,url,signature}),
/// SEPARATE from the Tauri app's nested latest.json — its `url` must point at an rr-agent binary, never the
/// Tauri installer. PER-PLATFORM: a Linux binary + .sig can't be served from the Windows manifest, so each OS
/// points at its own manifest (whose `url` is the matching-platform agent binary on the GitHub release). The
/// manifest FILENAMES (agent-latest{,-linux}.json) are unchanged — only the path prefix moved to /rr.
#[cfg(windows)]
pub const UPDATE_MANIFEST: &str = "https://nobd.net/rr/update/agent-latest.json";
#[cfg(not(windows))]
pub const UPDATE_MANIFEST: &str = "https://nobd.net/rr/update/agent-latest-linux.json";

/// 🎛 Channel-aware manifest (Coin Door / split-plan R0): "beta" swaps agent-latest → agent-beta.
/// An absent beta manifest 404s and the updater treats it as no-update — fail-safe to stable-silence.
pub fn update_manifest() -> String {
    if crate::prefs::load_channel() == "beta" {
        UPDATE_MANIFEST.replace("agent-latest", "agent-beta")
    } else {
        UPDATE_MANIFEST.to_string()
    }
}

/// The web app the tray "Open Retro Receipts" item launches in the default browser (the replacement for the
/// old in-app webview).
pub const WEB_APP: &str = "https://nobd.net/app";

/// This crate's version (from Cargo.toml) — reported to the updater and shown in the tray status line.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Registry value name under HKCU\...\Run for the autostart entry. Renamed from the pre-rename "MetaSyncAgent";
/// autostart::enable() deletes the old value name if present (migration, so no duplicate Run entry).
pub const AUTOSTART_KEY: &str = "RetroReceiptsAgent";

/// The pre-rename autostart value name — deleted on enable() so a renamed build leaves no stale Run entry.
pub const AUTOSTART_KEY_LEGACY: &str = "MetaSyncAgent";

/// The agent's REAL on-disk path — use this instead of `std::env::current_exe()` for anything that has to
/// survive the install directory moving.
///
/// ⚠ WHY THIS EXISTS (0.3.8 Windows self-update failure, found live 2026-08-23):
/// `current_exe()` returns the path the process was LAUNCHED from, and Windows does not update that string
/// when a parent directory is renamed underneath a running process. 0.3.8's state-dir migration renamed
/// `%LOCALAPPDATA%\MetaSync` → `\RetroReceipts` while the agent was running, so from then on every 0.3.8
/// Windows agent had a `current_exe()` pointing at a directory that no longer existed. Consequences:
///   • self-update died with "io error: The system cannot find the path specified. (os error 3)" — it was
///     trying to swap a binary at a path that was gone, so those installs could never update again;
///   • the autostart Run entry got that dead path written into it, so the agent would not have come back
///     after a reboot.
/// Linux was unaffected: the systemd relaunch path re-resolves the unit's ExecStart itself.
///
/// Resolution order: trust `current_exe()` when it still exists; otherwise look for the same filename in the
/// canonical install directory; otherwise hand back `current_exe()` so the caller reports a real error rather
/// than silently doing the wrong thing.
pub fn live_exe_path() -> std::io::Result<std::path::PathBuf> {
    let cur = std::env::current_exe()?;
    if cur.exists() {
        return Ok(cur);
    }
    #[cfg(windows)]
    if let (Some(name), Some(local)) = (cur.file_name(), std::env::var_os("LOCALAPPDATA")) {
        let cand = std::path::Path::new(&local).join("RetroReceipts").join("agent").join(name);
        if cand.exists() {
            return Ok(cand);
        }
    }
    Ok(cur)
}
