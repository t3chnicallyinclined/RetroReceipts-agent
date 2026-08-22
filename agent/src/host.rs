// "Host lobbies (this machine)" — turns this box into an arcade/tournament HOST node.
//
// LINUX-ONLY. The whole host runtime (mint/cache a token, create + rotate lobbies via ydotool, heartbeat,
// self-heal) lives in an EXTERNAL shell daemon — `arcade_hostd.sh`, materialized by `host_enable()` to
// `$HOME/.local/share/retro-receipts/arcade-host/` — managed as a systemd --user service. This module does
// NOT reimplement any of that: it only SHELLS OUT to that script.
//
//   • ENABLE : `bash <dir>/arcade_hostd.sh register`   → enables + starts the --user service.
//   • DISABLE: `bash <dir>/arcade_hostd.sh unregister` → unregisters from the pool + disables the service.
//   • STATUS : `bash <dir>/arcade_hostd.sh status`     → prints enabled/active (+ lobby json); parsed loosely.
//
// where <dir> = $HOME/.local/share/retro-receipts/arcade-host (see `host_dir()` — the single source of truth
// for the path, kept in one place so a future relocation is a one-line change).
//
// The scripts + the injector proxy are BUNDLED INTO this binary (see `mod bundled`) and materialized on
// demand: `host_enable()` writes them to disk (refreshing on every agent upgrade via a version marker),
// deploys the injector, and only then starts the service — so a fresh install needs no separate packaging
// step. If a precondition can't be met (Proton prefix not built / game running / no injector in this
// build), `host_enable()` returns that reason and does NOT claim success. On Windows every entry point is a
// no-op returning "Linux only (Windows soon)" — auto-hosting isn't supported there yet.
//
// register/unregister can be slow (systemctl + ydotool), so they run on a spawned thread — the same pattern
// the reader uses for its heartbeat POST — and never block the tray's event-loop thread. `status` is a quick
// one-shot and is called synchronously at startup (like autostart::is_enabled()).

use std::sync::atomic::AtomicBool;

/// Whether this machine is currently a host. Set at startup from `host_status()` (the live service is
/// authoritative) and toggled by the tray. When true the tray shows the "don't play on this machine" banner.
pub static HOST_MODE: AtomicBool = AtomicBool::new(false);

/// A loosely-parsed snapshot of the host daemon's state, for the tray's startup reconciliation.
#[allow(dead_code)] // some fields are used only for logging / future UI; kept for a complete picture.
pub struct HostStatus {
    /// Auto-hosting is possible on this OS at all (Linux only for now).
    pub supported: bool,
    /// The `arcade_hostd.sh` script is present at $HOME (its packaging is a separate task).
    pub installed: bool,
    /// The service is reported enabled/active by `status`.
    pub active: bool,
    /// The raw (trimmed) status text or the error, for logging.
    pub detail: String,
}

/// The canonical install dir the installer bundles the host scripts into. Single source of truth for the
/// path — change it here if packaging moves. `$HOME/.local/share/retro-receipts/arcade-host`.
#[cfg(target_os = "linux")]
fn host_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .map(|h| std::path::PathBuf::from(h).join(".local/share/retro-receipts/arcade-host"))
}

/// Full path to the host daemon script inside `host_dir()`.
#[cfg(target_os = "linux")]
fn script_path() -> Option<std::path::PathBuf> {
    host_dir().map(|d| d.join("arcade_hostd.sh"))
}

/// The injector staging dir the agent materializes `setup_proxy.sh` + `version.dll` into (mirrors
/// `host_dir()`). `$HOME/.local/share/retro-receipts/injector`. `arcade_hostd.sh ensure_injector` reads
/// from here (`INJ_DIR`).
#[cfg(target_os = "linux")]
fn inj_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .map(|h| std::path::PathBuf::from(h).join(".local/share/retro-receipts/injector"))
}

/// The systemd `--user` unit dir. `$HOME/.config/systemd/user`.
#[cfg(target_os = "linux")]
fn systemd_user_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .map(|h| std::path::PathBuf::from(h).join(".config/systemd/user"))
}

/// The host-node assets bundled into this binary at compile time (Linux only). The scripts are the
/// canonical repo copies (`include_str!`); the injector proxy dll is staged by `build.rs` into `OUT_DIR`
/// — a real dll when the release pipeline built it, an empty placeholder in a dev build (see the
/// `injector_bundled` cfg).
#[cfg(target_os = "linux")]
mod bundled {
    pub const ARCADE_HOST_SH: &str = include_str!("../../host-node/arcade-host/arcade_host.sh");
    pub const ARCADE_HOSTD_SH: &str = include_str!("../../host-node/arcade-host/arcade_hostd.sh");
    pub const ACT_SHOT_SH: &str = include_str!("../../host-node/arcade-host/act_shot.sh");
    pub const HOSTD_SERVICE: &str = include_str!("../../host-node/arcade-host/arcade-hostd.service");
    pub const SETUP_PROXY_SH: &str = include_str!("../../host-node/injector/setup_proxy.sh");
    // Only embed the dll when build.rs actually staged a real one — its sole use (in ensure_materialized)
    // is behind the same cfg, so gating the const keeps a dev build (no dll) warning-clean.
    #[cfg(injector_bundled)]
    pub const VERSION_DLL: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/version.dll"));
    /// Written next to the installed scripts so an agent upgrade re-materializes them. The `+inj` suffix
    /// (present only when a real dll is embedded) makes a dev→release upgrade also refresh the dll.
    #[cfg(injector_bundled)]
    pub const BUNDLE_VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "+inj");
    #[cfg(not(injector_bundled))]
    pub const BUNDLE_VERSION: &str = env!("CARGO_PKG_VERSION");
}

/// Write `body` to `path` and mark it executable (0o755). Parent dir must already exist.
#[cfg(target_os = "linux")]
fn write_exec(path: &std::path::Path, body: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, body).map_err(|e| format!("write {}: {e}", path.display()))?;
    let mut perm = std::fs::metadata(path)
        .map_err(|e| format!("stat {}: {e}", path.display()))?
        .permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(path, perm).map_err(|e| format!("chmod {}: {e}", path.display()))
}

/// Lay the bundled host-node runtime down on disk (idempotent; refreshes on every agent upgrade via the
/// `BUNDLE_VERSION` marker). Writes the arcade-host scripts + the systemd unit + the injector
/// (`setup_proxy.sh`, and `version.dll` when a real one was bundled). The marker is written LAST so a
/// partial materialize is retried next time, not skipped.
#[cfg(target_os = "linux")]
fn ensure_materialized() -> Result<(), String> {
    let hd = host_dir().ok_or_else(|| "no HOME dir".to_string())?;
    let marker = hd.join(".bundle_version");
    if std::fs::read_to_string(&marker)
        .map(|s| s.trim() == bundled::BUNDLE_VERSION)
        .unwrap_or(false)
    {
        return Ok(()); // already current
    }

    // arcade-host scripts
    std::fs::create_dir_all(&hd).map_err(|e| format!("mkdir {}: {e}", hd.display()))?;
    write_exec(&hd.join("arcade_host.sh"), bundled::ARCADE_HOST_SH)?;
    write_exec(&hd.join("arcade_hostd.sh"), bundled::ARCADE_HOSTD_SH)?;
    write_exec(&hd.join("act_shot.sh"), bundled::ACT_SHOT_SH)?;

    // systemd --user unit
    let sd = systemd_user_dir().ok_or_else(|| "no HOME dir".to_string())?;
    std::fs::create_dir_all(&sd).map_err(|e| format!("mkdir {}: {e}", sd.display()))?;
    std::fs::write(sd.join("arcade-hostd.service"), bundled::HOSTD_SERVICE)
        .map_err(|e| format!("write unit: {e}"))?;

    // injector (setup_proxy.sh always; version.dll only when a real one was bundled)
    let inj = inj_dir().ok_or_else(|| "no HOME dir".to_string())?;
    std::fs::create_dir_all(&inj).map_err(|e| format!("mkdir {}: {e}", inj.display()))?;
    write_exec(&inj.join("setup_proxy.sh"), bundled::SETUP_PROXY_SH)?;
    #[cfg(injector_bundled)]
    {
        std::fs::write(inj.join("version.dll"), bundled::VERSION_DLL)
            .map_err(|e| format!("write version.dll: {e}"))?;
    }

    // make systemd see the (possibly new) unit, then stamp the marker last
    let _ = std::process::Command::new("systemctl")
        .args(["--user", "daemon-reload"])
        .status();
    std::fs::write(&marker, bundled::BUNDLE_VERSION).map_err(|e| format!("write marker: {e}"))?;
    Ok(())
}

/// Like `run_hostd` but FAILS (`Err`) on a non-zero exit, returning the combined output. Used for the
/// synchronous injector pre-check so `host_enable` gives the tray an honest pass/fail.
#[cfg(target_os = "linux")]
fn run_hostd_checked(arg: &str) -> Result<String, String> {
    let script = script_path().ok_or_else(|| "no HOME dir".to_string())?;
    let out = std::process::Command::new("bash")
        .arg(&script)
        .arg(arg)
        .output()
        .map_err(|e| format!("failed to run {}: {e}", script.display()))?;
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        s.push('\n');
        s.push_str(&err);
    }
    if out.status.success() {
        Ok(s)
    } else {
        Err(s.trim().to_string())
    }
}

/// Run `bash $HOME/arcade_hostd.sh <arg>` and return its combined stdout+stderr. Synchronous; callers that
/// can't block (the tray event loop) invoke this from a spawned thread.
#[cfg(target_os = "linux")]
fn run_hostd(arg: &str) -> Result<String, String> {
    let script = script_path().ok_or_else(|| "no HOME dir".to_string())?;
    let out = std::process::Command::new("bash")
        .arg(&script)
        .arg(arg)
        .output()
        .map_err(|e| format!("failed to run {}: {e}", script.display()))?;
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        s.push('\n');
        s.push_str(&err);
    }
    Ok(s)
}

/// Enable hosting: kick off `arcade_hostd.sh register` on a background thread. Returns synchronously so the
/// tray gets an immediate, HONEST answer:
///   • `Ok(())`  — supported + the script is installed; `register` was spawned.
///   • `Err(msg)` — not Linux, or the script isn't installed (the tray must NOT show ON in this case).
/// The actual service start happens off-thread; failures there are logged (the tray already reflects "on").
pub fn host_enable() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        // 1) lay down / refresh the bundled host-node runtime — no more "scripts not installed".
        ensure_materialized()?;
        // 2) deploy + verify the injector SYNCHRONOUSLY so we only claim ON when hosting can actually
        //    work. On failure this surfaces the real reason (prefix not built / game running / no bundled
        //    dll) as the Err the tray shows — it must NOT flip to ON.
        run_hostd_checked("ensure-injector").map_err(|e| {
            let e = e.trim();
            e.lines().last().unwrap_or(e).to_string()
        })?;
        // 3) enable + start the supervised loop off-thread (systemctl can be slow); the injector is ready.
        std::thread::spawn(move || match run_hostd("register") {
            Ok(out) => eprintln!("[host] register → {}", out.trim()),
            Err(e) => eprintln!("[host] register failed: {e}"),
        });
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("Linux only (Windows soon)".into())
    }
}

/// Disable hosting: best-effort `arcade_hostd.sh unregister` on a background thread. No-op off Linux. The tray
/// always clears HOST_MODE for the OFF path regardless (unregistering a not-installed/never-registered host is
/// harmless), so this returns nothing.
pub fn host_disable() {
    #[cfg(target_os = "linux")]
    {
        // Nothing to unregister if the script was never installed.
        match script_path() {
            Some(p) if p.exists() => {
                std::thread::spawn(move || match run_hostd("unregister") {
                    Ok(out) => eprintln!("[host] unregister → {}", out.trim()),
                    Err(e) => eprintln!("[host] unregister failed: {e}"),
                });
            }
            _ => eprintln!("[host] unregister skipped — host scripts not installed"),
        }
    }
}

/// Query the daemon's state. Linux: returns `installed=false` when the script is absent; otherwise runs
/// `status` and parses it loosely — enabled/active/ok:true means hosting, guarding against systemd's
/// "inactive"/"disabled" (which contain "active"/"abled"). Non-Linux: `supported=false`.
pub fn host_status() -> HostStatus {
    #[cfg(target_os = "linux")]
    {
        let script = match script_path() {
            Some(p) => p,
            None => {
                return HostStatus {
                    supported: true,
                    installed: false,
                    active: false,
                    detail: "no HOME dir".into(),
                }
            }
        };
        if !script.exists() {
            return HostStatus {
                supported: true,
                installed: false,
                active: false,
                detail: "host scripts not installed".into(),
            };
        }
        match run_hostd("status") {
            Ok(out) => {
                // Read hosting state from the systemd line ONLY — `arcade_hostd.sh status` prints
                // "hosting: enabled=<is-enabled> active=<is-active>" then a "lobby: {json}" line. Do NOT
                // infer hosting from that json: its "ok":true only means the status query succeeded and is
                // present even when the service is disabled (a stale/cached lobby .result), which used to
                // FALSELY light up HOST MODE on a box that isn't hosting. `enabled` is the persistent "this
                // box hosts" intent the toggle reflects (survives a momentary service restart/inactive).
                let active = out
                    .lines()
                    .find(|l| l.trim_start().starts_with("hosting:"))
                    .map(|l| l.contains("enabled=enabled"))
                    .unwrap_or(false);
                HostStatus {
                    supported: true,
                    installed: true,
                    active,
                    detail: out.trim().to_string(),
                }
            }
            Err(e) => HostStatus {
                supported: true,
                installed: true,
                active: false,
                detail: e,
            },
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        HostStatus {
            supported: false,
            installed: false,
            active: false,
            detail: "Linux only (Windows soon)".into(),
        }
    }
}
