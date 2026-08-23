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
