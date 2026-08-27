// settings.rs — 🎛 THE COIN DOOR: the agent's native settings window (design spec: "Coin Door",
// owner-approved 2026-08-27; crate decision: egui/eframe — most popular pure-Rust GUI for panel-class
// apps, in-house precedent in the finger-gap tester).
//
// ARCHITECTURE: this runs as its OWN SHORT-LIVED PROCESS (`rr-agent --settings`, spawned by the tray)
// — never a window inside the resident agent. The tray runs on tao; eframe brings winit; two event
// loops don't share a process. The resident agent pays nothing while the door is closed, and a
// GPU/driver hiccup here can't take down the reader.
//
// CONTRACT WITH THE RUNNING AGENT — files, not IPC (the injector-protocol idiom):
//   write prefs.json (prefs::save_*)  →  touch runtime_dir()/prefs_reload  →  the agent's watcher
//   thread applies within ~3s. THE DOOR FOLLOWS THE OPERATOR AND ONLY WRITES PREFS: it never starts,
//   stops, or restarts anything (hosting is shown read-only and controlled from the tray/node).
//
// Skins stay OPT-IN here forever: the checkbox is never pre-checked by any default path, and the
// sub-copy states the crash risk honestly (painting writes live game memory).
use eframe::egui::{self, Color32, RichText};

use crate::{config, prefs};

const GOLD: Color32 = Color32::from_rgb(0xdf, 0xb2, 0x54);
const INK: Color32 = Color32::from_rgb(0xe8, 0xe2, 0xd4);
const DIM: Color32 = Color32::from_rgb(0x8d, 0x84, 0x74);
const WARN: Color32 = Color32::from_rgb(0xd9, 0xa3, 0x7a);
const PANEL: Color32 = Color32::from_rgb(0x16, 0x13, 0x0f);

pub fn run() {
    let opts = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([400.0, 560.0])
            .with_resizable(false)
            .with_title("Retro Receipts · Coin Door"),
        ..Default::default()
    };
    let _ = eframe::run_native(
        "rr-coin-door",
        opts,
        Box::new(|cc| {
            let mut visuals = egui::Visuals::dark();
            visuals.panel_fill = PANEL;
            visuals.override_text_color = Some(INK);
            visuals.selection.bg_fill = GOLD;
            visuals.widgets.active.bg_fill = GOLD;
            visuals.widgets.hovered.bg_fill = Color32::from_rgb(0x3a, 0x33, 0x2a);
            cc.egui_ctx.set_visuals(visuals);
            Ok(Box::new(Door::load()))
        }),
    );
}

struct Door {
    skins: bool,
    paused: bool,
    autostart: bool,
    beta: bool,
    host_mode: bool,
    steamid: String,
    saved: Option<std::time::Instant>,
}

impl Door {
    fn load() -> Self {
        Door {
            skins: prefs::load_apply_skins(),
            paused: prefs::load_paused(),
            autostart: crate::autostart::is_enabled(),
            beta: prefs::load_channel() == "beta",
            host_mode: prefs::load_host_mode(),
            steamid: read_steamid(),
            saved: None,
        }
    }

    /// Persist every pref + signal the running agent. Idempotent; called on any change.
    fn save(&mut self) {
        prefs::save_apply_skins(self.skins);
        prefs::save_paused(self.paused);
        prefs::save_channel(if self.beta { "beta" } else { "stable" });
        if self.autostart != crate::autostart::is_enabled() {
            if self.autostart {
                let _ = crate::autostart::enable();
            } else {
                let _ = crate::autostart::disable();
            }
        }
        // the reload flag: the agent's watcher applies prefs within ~3s of this touch
        let _ = std::fs::write(crate::runtime_dir().join("prefs_reload"), b"1");
        self.saved = Some(std::time::Instant::now());
    }
}

/// The signed-in SteamID from auth.json. Path logic duplicated from reader::rr_state_dir on purpose —
/// reader.rs is the replay lane's in-flight file (split plan: dedup into rr-core at phase 1).
fn read_steamid() -> String {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share")));
    let Some(base) = base else { return String::new() };
    #[cfg(windows)]
    let p = base.join("RetroReceipts").join("auth.json");
    #[cfg(not(windows))]
    let p = base.join("retro-receipts").join("auth.json");
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("steamid").and_then(|x| x.as_str()).map(String::from))
        .unwrap_or_default()
}

fn section(ui: &mut egui::Ui, label: &str) {
    ui.add_space(10.0);
    ui.separator();
    ui.add_space(4.0);
    ui.label(RichText::new(label).color(DIM).size(9.5).monospace());
    ui.add_space(2.0);
}

fn sub(ui: &mut egui::Ui, text: &str, color: Color32) {
    ui.indent("sub", |ui| {
        ui.label(RichText::new(text).color(color).size(11.0));
    });
}

impl eframe::App for Door {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.label(RichText::new("AGENT SETTINGS").color(INK).size(19.0).strong());
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(RichText::new(format!("v{}", config::VERSION)).color(DIM).size(10.0).monospace());
                });
            });

            // ── signed in ──
            section(ui, "SIGNED IN");
            if self.steamid.is_empty() {
                ui.label(RichText::new("Not signed in — open the web app and sign in with Steam.").color(DIM).size(12.0));
            } else {
                ui.label(RichText::new(&self.steamid).color(INK).size(12.0).monospace());
            }

            // ── gameplay ──
            section(ui, "GAMEPLAY");
            let mut changed = false;
            changed |= ui.checkbox(&mut self.skins, RichText::new("Show custom skins in game").size(13.0)).changed();
            sub(ui, "Off by default. Skin painting writes live game memory and can crash the game \
                     on some setups — turn it on only if you want it. Also controls receiving other \
                     players' skins.", WARN);
            ui.add_space(4.0);
            changed |= ui.checkbox(&mut self.paused, RichText::new("Pause reporting").size(13.0)).changed();
            sub(ui, "Stops sending matches, presence and results until you unpause. Your games won't \
                     count while paused.", DIM);

            // ── system ──
            section(ui, "SYSTEM");
            changed |= ui.checkbox(&mut self.autostart, RichText::new("Start with the system").size(13.0)).changed();
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.label(RichText::new("Update channel").size(13.0));
                changed |= ui.selectable_value(&mut self.beta, false, "STABLE").changed();
                changed |= ui.selectable_value(&mut self.beta, true, "BETA").changed();
            });
            sub(ui, "Updates install themselves within the hour.", DIM);

            // ── hosting (read-only: the door follows the operator, it never leads) ──
            section(ui, "HOSTING");
            ui.label(
                RichText::new(if self.host_mode { "Host node: ON" } else { "Host node: off" })
                    .color(if self.host_mode { GOLD } else { INK })
                    .size(13.0),
            );
            sub(ui, "Hosting turns this machine into a referee cabinet — it stops playing and starts \
                     judging. Toggle it from the tray; while hosting, the settings above are ignored.", DIM);

            if changed {
                self.save();
            }

            // ── footer ──
            ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                ui.add_space(6.0);
                ui.horizontal(|ui| {
                    if ui.small_button("Send a bug report").clicked() {
                        // reap the child (zombie lesson 2026-08-27): spawn + wait on a throwaway thread
                        if let Ok(exe) = std::env::current_exe() {
                            if let Ok(mut c) = std::process::Command::new(exe).arg("--bugreport").spawn() {
                                std::thread::spawn(move || { let _ = c.wait(); });
                            }
                        }
                    }
                    if ui.small_button("Open logs").clicked() {
                        let _ = open::that(crate::runtime_dir());
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.small_button("nobd.net/app ↗").clicked() {
                            let _ = open::that(config::WEB_APP);
                        }
                    });
                });
                if let Some(t) = self.saved {
                    if t.elapsed().as_secs() < 3 {
                        ui.label(RichText::new("saved — the agent applies it within seconds").color(Color32::from_rgb(0x6f, 0xbf, 0x8f)).size(10.5));
                        ctx.request_repaint_after(std::time::Duration::from_millis(500));
                    }
                }
            });
        });
    }
}
