// Tray shell — the agent's only UI. No window: a tray icon + a native context menu, pumped by a tao event
// loop. Production menu:
//   • "Retro Receipts Agent · v{VERSION}"  (disabled header)
//   • "🎮 {status}"                  (disabled; reader::status_line(), refreshed on the 1s timer)
//   • "Signed in as {name}"          (disabled; reader::signed_in_name(), "Steam not detected" when none)
//   • "🎛 HOST MODE — …"            (disabled; blank unless HOST_MODE — "don't play on this machine" banner)
//   • ── separator ──
//   • "Open Retro Receipts"                — opens the web app (config::WEB_APP) in the default browser
//   • "Apply my skins" (✓)          — checkable, PERSISTED pref; gates the painter (painter::SKINS_ENABLED)
//   • "Pause reporting" (✓)          — checkable, session-only; gates the reader's reports (reader::PAUSED)
//   • "Host lobbies (this machine)" (✓) — checkable, PERSISTED; LINUX-ONLY (greyed on Windows); shells out to
//                                     the arcade_hostd.sh daemon (host.rs) to register/unregister this host
//   • ── separator ──
//   • "Check for updates"            — runs updater::check_for_update on a thread; result reflected in the text
//   • "Open logs folder"            — opens runtime_dir() in Explorer
//   • "Start with Windows" (✓)       — checkable; toggles the HKCU Run-key autostart (autostart.rs)
//   • ── separator ──
//   • "Quit"                         — exits the event loop cleanly (process ends)
//
// Integration pattern (canonical for tao + tray-icon on Windows): route tray + menu events through the event
// loop's own user-event channel via set_event_handler → EventLoopProxy, and build the TrayIcon on
// StartCause::Init (some platforms require the tray to be created after the loop is running).
//
// NOTE on the "Check for updates" text update: muda's MenuItem is Rc<RefCell<…>>-backed (NOT Send), so the item
// handle can't cross into the worker thread. The check runs on a background thread and posts its result string
// back through the EventLoopProxy (UserEvent::UpdateResult); the loop — on the main thread, which owns the item —
// applies set_text. This is the proxy path the task allowed, and here it's also the only sound one.

use crate::{autostart, config, host, painter, prefs, reader, updater};
use muda::{CheckMenuItem, Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder, TrayIconEvent};

/// Events funneled into the tao loop from the tray + menu global handlers.
enum UserEvent {
    Menu(MenuEvent),
    #[allow(dead_code)] // tray-click handling is a later concern; kept wired so the channel exists now.
    Tray(TrayIconEvent),
    /// The finished "Check for updates" result string, posted back from the worker thread so the main thread
    /// (which owns the Rc-backed menu item) can set its text.
    UpdateResult(String),
}

/// Draw the Retro Receipts mark — a torn receipt (perforated edges, dark print + barcode) — as an in-code
/// RGBA tray icon on a transparent ground, so the agent needs no external asset file.
///
/// FULL-BLEED by design: the paper spans the entire canvas and the tear teeth are cut OUT of the top and
/// bottom edges, rather than the mark being stamped inside padding. The previous art was a fixed 14×18
/// glyph at offset (9,6) on a 32×32 canvas — 44% of the width — which Windows then scaled down to the
/// tray's 16px, leaving a receipt roughly 7px wide that read as a tiny thing inside an invisible box.
///
/// Every feature is proportional to N so the mark fills the canvas at whatever size it is rendered, and
/// the print is deliberately coarse: at 16px thin bars merge into a dark mass and fine barcode stripes
/// blur into a grey band, so there are exactly three print elements over a chunky barcode.
fn icon_rgba(n: usize) -> Vec<u8> {
    let gold = [255u8, 176, 32, 255]; // #ffb020
    let ink = [10u8, 12, 18, 255]; // #0a0c12 (dark print)
    let clear = [0u8, 0, 0, 0];
    let mut rgba = vec![0u8; n * n * 4]; // transparent ground — the receipt IS the icon (no tile)

    let nf = n as f32;
    let scale = |f: f32| -> usize { ((nf * f).round() as usize).min(n) };
    let mut rect = |rgba: &mut [u8], x0: usize, y0: usize, x1: usize, y1: usize, c: [u8; 4]| {
        for y in y0..y1.min(n) {
            for x in x0..x1.min(n) {
                let i = (y * n + x) * 4;
                rgba[i..i + 4].copy_from_slice(&c);
            }
        }
    };

    // gold paper, edge to edge
    rect(&mut rgba, 0, 0, n, n, gold);

    // tear the top and bottom: alternating notches punched back out to transparent
    let tooth = (n / 16).max(1);
    for x in 0..n {
        if (x / tooth) % 2 == 0 {
            rect(&mut rgba, x, 0, x + 1, tooth, clear);
        } else {
            rect(&mut rgba, x, n - tooth, x + 1, n, clear);
        }
    }

    // ink print in explicit proportional bands (not an accumulator) so spacing holds at any n
    let pad = scale(0.09).max(1); // inset for PRINT only — the paper itself still bleeds to the edge
    let band = |rgba: &mut [u8],
                a: f32,
                b: f32,
                right: f32,
                rect: &mut dyn FnMut(&mut [u8], usize, usize, usize, usize, [u8; 4])| {
        let (y0, mut y1) = (scale(a), scale(b));
        if y1 <= y0 {
            y1 = y0 + 1;
        }
        let x1 = if right >= 1.0 { n - pad } else { scale(right) };
        rect(rgba, pad, y0, x1, y1, ink);
    };
    band(&mut rgba, 0.10, 0.28, 1.0, &mut rect); // header block — the boldest mass, reads first at 16px
    band(&mut rgba, 0.35, 0.44, 1.0, &mut rect); // itemized line
    band(&mut rgba, 0.50, 0.59, 0.62, &mut rect); // second line, short: a receipt's ragged right edge

    // barcode — the signature element; few, thick stripes so it stays stripes when scaled to 16px
    let (bc_top, bc_bot) = (scale(0.66), scale(0.88));
    let stripe = (n / 10).max(1);
    let widths = [1usize, 1, 2, 1, 1, 2, 1];
    let (mut x, mut i) = (pad, 0usize);
    while x < n - pad {
        let w = widths[i % widths.len()] * stripe;
        if i % 2 == 0 {
            rect(&mut rgba, x, bc_top, (x + w).min(n - pad), bc_bot, ink);
        }
        x += w;
        i += 1;
    }
    rgba
}

fn build_icon() -> Option<Icon> {
    const N: u32 = 32;
    Icon::from_rgba(icon_rgba(N as usize), N, N).ok()
}

#[cfg(test)]
mod icon_tests {
    use super::icon_rgba;

    /// The mark must FILL its canvas. This is a real regression guard, not a formality: the art it
    /// replaced was a fixed 14×18 glyph stamped at (9,6) on a 32×32 canvas, so it covered 44% of the
    /// width and rendered as a small receipt inside an invisible box once Windows scaled it to 16px.
    /// Checked at several n because every feature is proportional and rounding could strand an edge.
    #[test]
    fn icon_is_full_bleed_at_every_size() {
        for n in [16usize, 20, 24, 32, 64] {
            let px = icon_rgba(n);
            let opaque = |x: usize, y: usize| px[(y * n + x) * 4 + 3] != 0;
            let cols = (0..n).filter(|&x| (0..n).any(|y| opaque(x, y))).count();
            let rows = (0..n).filter(|&y| (0..n).any(|x| opaque(x, y))).count();
            assert_eq!(cols, n, "n={n}: {cols}/{n} columns painted — mark is inset horizontally");
            assert_eq!(rows, n, "n={n}: {rows}/{n} rows painted — mark is inset vertically");
        }
    }

    /// The print has to survive being scaled down to a 16px tray slot, which means it must actually be
    /// present and reasonably weighted — neither invisible nor a solid dark block.
    #[test]
    fn print_is_legible_weight() {
        let n = 32usize;
        let px = icon_rgba(n);
        let ink = (0..n * n).filter(|i| px[i * 4] < 60 && px[i * 4 + 3] != 0).count();
        let frac = ink as f32 / (n * n) as f32;
        assert!(
            (0.15..0.55).contains(&frac),
            "ink coverage {frac:.2} outside 0.15..0.55 — print is either invisible or a dark blob"
        );
    }
}

/// Handles to the menu items whose IDs we react to / whose state we mutate.
struct MenuHandles {
    // Clickable / checkable item IDs (matched against incoming MenuEvents).
    open_id: MenuId,
    apply_skins_id: MenuId,
    pause_id: MenuId,
    host_id: MenuId,
    updates_id: MenuId,
    logs_id: MenuId,
    autostart_id: MenuId,
    quit_id: MenuId,
    // Item handles whose state/text we mutate at runtime.
    apply_skins_item: CheckMenuItem,
    pause_item: CheckMenuItem,
    host_item: CheckMenuItem,
    autostart_item: CheckMenuItem,
    updates_item: MenuItem,
    // Disabled rows refreshed each second from the reader.
    status_item: MenuItem,
    signed_item: MenuItem,
    // Disabled banner row: shows the "don't play on this machine" warning while HOST_MODE is on, else blank.
    host_indicator: MenuItem,
}

/// "Signed in as {name}" / "Steam not detected" — the identity row text, sourced from the reader.
fn signed_in_text() -> String {
    match reader::signed_in_name() {
        Some(n) => format!("Signed in as {}", n),
        None => "Steam not detected".into(),
    }
}

/// The HOST MODE banner text: a loud "don't play here" warning while hosting is active, else "" (blank row).
/// A host box must NOT be played on (same Steam account can't host AND play), so this stays prominent.
fn host_indicator_text() -> String {
    if host::HOST_MODE.load(Ordering::Relaxed) {
        "🎛 HOST MODE — don't play on this machine".into()
    } else {
        String::new()
    }
}

/// Build the context menu and return it alongside the handles the event loop needs. The status + "signed in"
/// rows are disabled MenuItems whose text the event loop refreshes from the reader on a 1s timer.
fn build_menu() -> (Menu, MenuHandles) {
    let menu = Menu::new();

    let header = MenuItem::new(format!("Retro Receipts Agent · v{}", config::VERSION), false, None);
    let status = MenuItem::new(reader::status_line(), false, None);
    let signed = MenuItem::new(signed_in_text(), false, None);
    // Prominent, disabled banner shown only while this box is a host. Blank (empty row) otherwise; text is
    // (re)set by refresh_dynamic. HOST_MODE was reconciled from the live service in main() before this runs.
    let host_indicator = MenuItem::new(host_indicator_text(), false, None);
    let sep1 = PredefinedMenuItem::separator();

    let open = MenuItem::new("Open Retro Receipts", true, None);
    // Initial check states read the flags main.rs already restored (skins) / the process default (pause).
    let apply_skins = CheckMenuItem::new(
        "Apply my skins",
        true,
        painter::SKINS_ENABLED.load(Ordering::Relaxed),
        None,
    );
    let pause = CheckMenuItem::new("Pause reporting", true, reader::PAUSED.load(Ordering::Relaxed), None);
    // "Host lobbies (this machine)" — makes this box an arcade/tournament host node. LINUX-ONLY: on Windows
    // it's created DISABLED (greyed) with a "Linux only" label, since auto-hosting isn't supported there yet.
    // Initial check state = HOST_MODE, which main() reconciled from the live systemd --user service at startup.
    #[cfg(target_os = "linux")]
    let host_toggle = CheckMenuItem::new(
        "Host lobbies (this machine)",
        true,
        host::HOST_MODE.load(Ordering::Relaxed),
        None,
    );
    #[cfg(not(target_os = "linux"))]
    let host_toggle = CheckMenuItem::new("Host lobbies — Linux only (Windows soon)", false, false, None);
    let sep2 = PredefinedMenuItem::separator();

    let updates = MenuItem::new("Check for updates", true, None);
    let logs = MenuItem::new("Open logs folder", true, None);
    let autostart_item = CheckMenuItem::new("Start with Windows", true, autostart::is_enabled(), None);
    let sep3 = PredefinedMenuItem::separator();

    let quit = MenuItem::new("Quit", true, None);

    // append_items keeps the ordering explicit; ignore the (infallible-in-practice) result. The menu holds an
    // Rc clone of each item, so the un-kept locals (header/separators) stay alive after this fn returns.
    let _ = menu.append_items(&[
        &header,
        &status,
        &signed,
        &host_indicator,
        &sep1,
        &open,
        &apply_skins,
        &pause,
        &host_toggle,
        &sep2,
        &updates,
        &logs,
        &autostart_item,
        &sep3,
        &quit,
    ]);

    let handles = MenuHandles {
        open_id: open.id().clone(),
        apply_skins_id: apply_skins.id().clone(),
        pause_id: pause.id().clone(),
        host_id: host_toggle.id().clone(),
        updates_id: updates.id().clone(),
        logs_id: logs.id().clone(),
        autostart_id: autostart_item.id().clone(),
        quit_id: quit.id().clone(),
        apply_skins_item: apply_skins,
        pause_item: pause,
        host_item: host_toggle,
        autostart_item,
        updates_item: updates,
        status_item: status,
        signed_item: signed,
        host_indicator,
    };
    (menu, handles)
}

/// Pull the current status + identity from the reader and paint them onto the disabled rows + the tray tooltip.
/// Also reflects a downloaded-and-waiting update (updater::PENDING_UPDATE) on the "Check for updates" row + the
/// tooltip. `updates_busy_until` is the instant a transient manual-check message ("Checking…" / "Up to date" /
/// a result) stays pinned to the row — while it's in the future we leave that row alone so this 1s refresh
/// doesn't stomp the manual feedback.
fn refresh_dynamic(handles: &MenuHandles, tray: &Option<TrayIcon>, updates_busy_until: Option<Instant>) {
    let line = reader::status_line();
    handles.status_item.set_text(&line);
    handles.signed_item.set_text(signed_in_text());
    handles.host_indicator.set_text(host_indicator_text());

    // A newer version that couldn't auto-apply (MvC2 open) surfaces here: the menu row + tooltip tell the user
    // it's waiting and will install when they close the game. When nothing is pending the row keeps its normal
    // "Check for updates" label.
    let pending = updater::PENDING_UPDATE.lock().ok().and_then(|p| p.clone());
    let show_transient = updates_busy_until.map_or(false, |t| Instant::now() < t);
    if !show_transient {
        match &pending {
            Some(v) => handles
                .updates_item
                .set_text(format!("🔔 Update {v} ready — installs when you close the game")),
            None => handles.updates_item.set_text("Check for updates"),
        }
    }

    let tooltip = match &pending {
        Some(v) => format!("🔔 Update {v} ready — installs when you close MvC2\n{line}"),
        None => line,
    };
    if let Some(t) = tray {
        let _ = t.set_tooltip(Some(&tooltip));
    }
}

/// Build the event loop, wire tray/menu event routing, and run it. Diverges: returns only when the process
/// exits (Quit → ControlFlow::Exit → tao ends the process).
pub fn run() -> ! {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();

    // Route the two global (thread-static) event streams into our loop via the proxy.
    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |e| {
        let _ = proxy.send_event(UserEvent::Menu(e));
    }));
    let proxy = event_loop.create_proxy();
    TrayIconEvent::set_event_handler(Some(move |e| {
        let _ = proxy.send_event(UserEvent::Tray(e));
    }));
    // A third proxy, cloned into each "Check for updates" worker so it can post its result back to the loop.
    let update_proxy = event_loop.create_proxy();

    // Built on Init and held for the whole run (dropping a TrayIcon removes it from the tray).
    let mut tray: Option<TrayIcon> = None;
    let (menu, handles) = build_menu();
    // Menu is moved into the tray builder on Init; keep it in an Option until then.
    let mut menu = Some(menu);
    // While in the future, a transient manual-check message ("Checking…" / "Up to date" / a result) is pinned
    // to the "Check for updates" row and the 1s refresh leaves that row alone. Captured (mutably) by the loop
    // closure so it persists across ticks; set by the manual-check arm + UpdateResult below.
    let mut updates_busy_until: Option<Instant> = None;

    event_loop.run(move |event, _target, control_flow| {
        // Wake at least once a second so the status + identity rows + tooltip track the reader's live state,
        // even when there are no window/menu events to process.
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_secs(1));

        match event {
            Event::NewEvents(StartCause::Init) => {
                let mut builder = TrayIconBuilder::new()
                    .with_tooltip(format!("RR v{}", config::VERSION));
                if let Some(m) = menu.take() {
                    builder = builder.with_menu(Box::new(m));
                }
                if let Some(icon) = build_icon() {
                    builder = builder.with_icon(icon);
                }
                match builder.build() {
                    Ok(t) => tray = Some(t),
                    Err(e) => {
                        eprintln!("[tray] failed to create tray icon: {e}");
                        // No tray means no UI — nothing to do but exit cleanly.
                        *control_flow = ControlFlow::Exit;
                    }
                }
                refresh_dynamic(&handles, &tray, updates_busy_until);
            }

            // 1s timer tick (from WaitUntil above) — refresh the status + identity rows from the reader.
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                refresh_dynamic(&handles, &tray, updates_busy_until);
            }

            Event::UserEvent(UserEvent::Menu(ev)) => {
                if ev.id == handles.quit_id {
                    // Drop the tray first so the icon disappears immediately, then exit the loop.
                    tray.take();
                    *control_flow = ControlFlow::Exit;
                } else if ev.id == handles.open_id {
                    if let Err(e) = open::that_detached(config::WEB_APP) {
                        eprintln!("[tray] failed to open {}: {e}", config::WEB_APP);
                    }
                } else if ev.id == handles.apply_skins_id {
                    // muda already flipped the check state; mirror it into the painter's gate + persist the pref.
                    let on = handles.apply_skins_item.is_checked();
                    painter::SKINS_ENABLED.store(on, Ordering::Relaxed);
                    prefs::save_apply_skins(on);
                } else if ev.id == handles.pause_id {
                    // Session-only: mirror the check state into the reader's report gate (not persisted).
                    let paused = handles.pause_item.is_checked();
                    reader::PAUSED.store(paused, Ordering::Relaxed);
                } else if ev.id == handles.host_id {
                    // muda already flipped the check state. ON → make this box a host (shell out to the daemon)
                    // + persist; OFF → stop hosting + persist. A REFUSED enable (Windows, or the host scripts
                    // aren't installed) must NOT leave the item showing ON — revert the checkbox so it never
                    // lies about the real host state, same as the autostart toggle below.
                    let want = handles.host_item.is_checked();
                    if want {
                        match host::host_enable() {
                            Ok(()) => {
                                host::HOST_MODE.store(true, Ordering::Relaxed);
                                prefs::save_host_mode(true);
                                // Reinforce the safety-critical rule prominently — a toast is far more
                                // visible than the disabled banner row, and playing on a host box breaks
                                // hosting (same Steam account can't host AND play).
                                updater::toast(
                                    "Hosting enabled",
                                    "This machine is now a host node. Don't play on it while hosting is on.",
                                );
                            }
                            Err(e) => {
                                // Revert the toggle (never lie about the real state) AND tell the user WHY.
                                // host_enable's Err carries the actionable precondition — "launch MvC2 once
                                // so Proton builds its prefix", "close the game", or "injector not bundled".
                                // Without this the toggle just silently flips back off with no explanation.
                                eprintln!("[tray] host enable refused: {e}");
                                updater::toast("Hosting not enabled", &e);
                                handles.host_item.set_checked(false);
                                host::HOST_MODE.store(false, Ordering::Relaxed);
                            }
                        }
                    } else {
                        host::HOST_MODE.store(false, Ordering::Relaxed);
                        prefs::save_host_mode(false);
                        host::host_disable();
                    }
                    // Reflect the HOST MODE banner immediately rather than waiting for the 1s tick.
                    refresh_dynamic(&handles, &tray, updates_busy_until);
                } else if ev.id == handles.updates_id {
                    // Check off-thread, then INSTALL if an update is offered and it's safe (no game running).
                    // Feedback comes back via UpdateResult (the menu item is Rc-backed → can't cross threads).
                    handles.updates_item.set_text("Checking…");
                    // Pin "Checking…" (and then the result) so the 1s refresh doesn't stomp it mid-check; the
                    // manifest fetch can take a few seconds. UpdateResult resets this to a shorter window.
                    updates_busy_until = Some(Instant::now() + Duration::from_secs(20));
                    let p = update_proxy.clone();
                    std::thread::spawn(move || {
                        match updater::check_for_update(config::VERSION) {
                            None => {
                                let _ = p.send_event(UserEvent::UpdateResult(format!(
                                    "Up to date (v{})",
                                    config::VERSION
                                )));
                                updater::notify(
                                    "Retro Receipts",
                                    &format!("You're on the latest version (v{}).", config::VERSION),
                                );
                            }
                            Some(u) if !updater::safe_to_apply() => {
                                // An update is ready but MvC2 is open — never swap mid-session. Raise a
                                // NON-MODAL toast (force=true: the user just asked) + record it as pending so
                                // the tray row/tooltip keep showing it; it auto-applies once the game closes.
                                // NO modal MessageBox here — it must not steal focus from a live match.
                                updater::note_deferred_update(&u.version, true);
                                let _ = p.send_event(UserEvent::UpdateResult(format!(
                                    "🔔 Update {} ready — installs when you close the game",
                                    u.version
                                )));
                            }
                            Some(u) => {
                                let _ = p.send_event(UserEvent::UpdateResult(format!(
                                    "Installing v{}…",
                                    u.version
                                )));
                                updater::notify(
                                    "Retro Receipts Update",
                                    &format!(
                                        "Installing update v{}…\n\nThe agent will restart when it's done.",
                                        u.version
                                    ),
                                );
                                match updater::apply_update(&u) {
                                    // self-replace done → relaunch the new binary (never returns)
                                    Ok(()) => updater::restart(),
                                    Err(e) => {
                                        let _ = p.send_event(UserEvent::UpdateResult(format!(
                                            "Update failed: {e}"
                                        )));
                                        updater::notify(
                                            "Retro Receipts Update",
                                            &format!("Update failed:\n\n{e}"),
                                        );
                                    }
                                }
                            }
                        }
                    });
                } else if ev.id == handles.logs_id {
                    if let Err(e) = open::that(crate::runtime_dir()) {
                        eprintln!("[tray] failed to open logs folder: {e}");
                    }
                } else if ev.id == handles.autostart_id {
                    // muda already toggled the check state for us; reconcile the registry to match, and if the
                    // write fails, revert the checkbox so it never lies about the real autostart state.
                    let want = handles.autostart_item.is_checked();
                    let res = if want {
                        autostart::enable()
                    } else {
                        autostart::disable()
                    };
                    if let Err(e) = res {
                        eprintln!("[tray] autostart toggle failed: {e}");
                        handles.autostart_item.set_checked(!want);
                    } else {
                        // record the explicit choice so the launch path honors it (and stops re-asserting the default).
                        prefs::save_autostart_choice(want);
                    }
                }
            }

            // "Check for updates" finished on its worker thread → reflect the result in the item text.
            Event::UserEvent(UserEvent::UpdateResult(text)) => {
                handles.updates_item.set_text(&text);
                // Keep this transient result visible briefly before the 1s refresh reclaims the row (steady
                // "Check for updates", or a pending-update hint if one is now waiting).
                updates_busy_until = Some(Instant::now() + Duration::from_secs(6));
            }

            Event::UserEvent(UserEvent::Tray(_ev)) => {
                // Left-click could open the web app; right-click already shows the menu natively.
            }

            _ => {}
        }
    })
}
