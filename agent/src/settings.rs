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
//
// LOOK: egui has no CSS — the modern feel comes from three levers set in setup(): the BRAND FONTS
// (IBM Plex Sans/Mono + Barlow Condensed, embedded, OFL-licensed — the receipts' own typography),
// card-framed sections with soft rounding, and a consistent spacing rhythm. Change the look there.
use eframe::egui::{self, Color32, FontFamily, FontId, RichText, Rounding, Vec2};

use std::sync::{Arc, Mutex};

use crate::{config, prefs};

const GOLD: Color32 = Color32::from_rgb(0xdf, 0xb2, 0x54);
const GOLD_DEEP: Color32 = Color32::from_rgb(0xc9, 0x8f, 0x0e);
const INK: Color32 = Color32::from_rgb(0xec, 0xe6, 0xd8);
const DIM: Color32 = Color32::from_rgb(0x9a, 0x91, 0x80);
const FAINT: Color32 = Color32::from_rgb(0x6d, 0x65, 0x54);
const WARN: Color32 = Color32::from_rgb(0xd9, 0xa3, 0x7a);
const GOOD: Color32 = Color32::from_rgb(0x6f, 0xbf, 0x8f);
const PANEL: Color32 = Color32::from_rgb(0x12, 0x0f, 0x0c); // window ground
const CARD: Color32 = Color32::from_rgb(0x1c, 0x18, 0x12); // section cards
const CARD_LINE: Color32 = Color32::from_rgb(0x2e, 0x28, 0x1e);

fn display(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("display".into()))
}
fn semibold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("semibold".into()))
}

fn setup(ctx: &egui::Context) {
    // ── brand fonts (embedded; OFL) ──
    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert("plex".into(), egui::FontData::from_static(include_bytes!("../assets/fonts/IBMPlexSans-Regular.ttf")));
    fonts.font_data.insert("plex-sb".into(), egui::FontData::from_static(include_bytes!("../assets/fonts/IBMPlexSans-SemiBold.ttf")));
    fonts.font_data.insert("plex-mono".into(), egui::FontData::from_static(include_bytes!("../assets/fonts/IBMPlexMono-Regular.ttf")));
    fonts.font_data.insert("barlow".into(), egui::FontData::from_static(include_bytes!("../assets/fonts/BarlowCondensed-SemiBold.ttf")));
    fonts.families.get_mut(&FontFamily::Proportional).unwrap().insert(0, "plex".into());
    fonts.families.get_mut(&FontFamily::Monospace).unwrap().insert(0, "plex-mono".into());
    fonts.families.insert(FontFamily::Name("display".into()), vec!["barlow".into()]);
    fonts.families.insert(FontFamily::Name("semibold".into()), vec!["plex-sb".into()]);
    ctx.set_fonts(fonts);

    // ── visuals: dark ground, gold accent, soft rounding everywhere ──
    let mut v = egui::Visuals::dark();
    v.panel_fill = PANEL;
    v.override_text_color = Some(INK);
    v.selection.bg_fill = GOLD;
    v.selection.stroke = egui::Stroke::new(1.0, PANEL);
    v.widgets.inactive.bg_fill = Color32::from_rgb(0x26, 0x21, 0x19);
    v.widgets.inactive.weak_bg_fill = Color32::from_rgb(0x26, 0x21, 0x19);
    v.widgets.hovered.bg_fill = Color32::from_rgb(0x35, 0x2e, 0x22);
    v.widgets.hovered.weak_bg_fill = Color32::from_rgb(0x35, 0x2e, 0x22);
    v.widgets.active.bg_fill = GOLD_DEEP;
    v.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, CARD_LINE);
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.rounding = Rounding::same(8.0);
    }
    let mut style = (*ctx.style()).clone();
    style.visuals = v;
    style.spacing.item_spacing = Vec2::new(8.0, 7.0);
    style.spacing.button_padding = Vec2::new(13.0, 6.0);
    style.spacing.icon_width = 19.0;
    style.spacing.icon_width_inner = 11.0;
    ctx.set_style(style);
}

pub fn run() {
    let opts = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([408.0, 728.0])
            .with_resizable(false)
            .with_title("Retro Receipts · Coin Door"),
        ..Default::default()
    };
    let _ = eframe::run_native(
        "rr-coin-door",
        opts,
        Box::new(|cc| {
            setup(&cc.egui_ctx);
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
    token: String,
    saved: Option<std::time::Instant>,
    // fetched off-thread at launch (GET /rr/profile with the agent's own bearer — owner view, so the
    // lobby-visibility pref rides along); None = still loading / offline. The UI never blocks on it.
    profile: Arc<Mutex<Option<serde_json::Value>>>,
    // the ACCOUNT half: server-side lobby-record visibility (None until the profile lands)
    lobby_public: Option<bool>,
}

impl Door {
    fn load() -> Self {
        let (steamid, token) = read_auth();
        let profile: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));
        if !steamid.is_empty() {
            let (sid, tok, slot) = (steamid.clone(), token.clone(), profile.clone());
            std::thread::spawn(move || {
                let url = format!("{}/profile?steamid={}", config::SERVER_BASE, sid);
                let req = ureq::get(&url).timeout(std::time::Duration::from_secs(6));
                let req = if tok.is_empty() { req } else { req.set("Authorization", &format!("Bearer {}", tok)) };
                if let Ok(resp) = req.call() {
                    if let Ok(v) = resp.into_json::<serde_json::Value>() {
                        *slot.lock().unwrap() = Some(v);
                    }
                }
            });
        }
        Door {
            skins: prefs::load_apply_skins(),
            paused: prefs::load_paused(),
            autostart: crate::autostart::is_enabled(),
            beta: prefs::load_channel() == "beta",
            host_mode: prefs::load_host_mode(),
            steamid,
            token,
            saved: None,
            profile,
            lobby_public: None,
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

/// The signed-in (SteamID, bearer) from auth.json. Path logic duplicated from reader::rr_state_dir on
/// purpose — reader.rs is the replay lane's in-flight file (split plan: dedup into rr-core at phase 1).
fn read_auth() -> (String, String) {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share")));
    let Some(base) = base else { return (String::new(), String::new()) };
    #[cfg(windows)]
    let p = base.join("RetroReceipts").join("auth.json");
    #[cfg(not(windows))]
    let p = base.join("retro-receipts").join("auth.json");
    let v = std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
    let get = |k: &str| v.as_ref().and_then(|v| v.get(k)).and_then(|x| x.as_str()).map(String::from).unwrap_or_default();
    (get("steamid"), get("token"))
}

/// stat helpers over the loose profile Value — crude on purpose, like the ask.
fn vi(v: &serde_json::Value, path: &[&str]) -> i64 {
    let mut cur = v;
    for p in path { cur = cur.get(p).unwrap_or(&serde_json::Value::Null); }
    cur.as_i64().unwrap_or(0)
}
fn vs<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// One section card: dark panel, soft corners, hairline stroke, mono eyebrow label.
fn card<R>(ui: &mut egui::Ui, label: &str, body: impl FnOnce(&mut egui::Ui) -> R) -> R {
    let frame = egui::Frame::none()
        .fill(CARD)
        .stroke(egui::Stroke::new(1.0, CARD_LINE))
        .rounding(Rounding::same(12.0))
        .inner_margin(egui::Margin::symmetric(14.0, 12.0));
    let r = frame
        .show(ui, |ui| {
            ui.label(RichText::new(label).color(FAINT).font(FontId::new(9.5, FontFamily::Monospace)));
            ui.add_space(4.0);
            body(ui)
        })
        .inner;
    ui.add_space(9.0);
    r
}

fn sub(ui: &mut egui::Ui, text: &str, color: Color32) {
    ui.horizontal_wrapped(|ui| {
        ui.add_space(27.0); // aligns under the checkbox label, past the icon
        ui.label(RichText::new(text).color(color).size(11.0));
    });
}

impl eframe::App for Door {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(PANEL).inner_margin(egui::Margin::symmetric(16.0, 14.0)))
            .show(ctx, |ui| {
                // ── header: gold kicker, condensed display title, version chip ──
                ui.label(RichText::new("R E T R O   R E C E I P T S").color(GOLD).font(FontId::new(9.5, FontFamily::Monospace)));
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Agent Settings").color(INK).font(display(30.0)));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(RichText::new(format!("v{}", config::VERSION)).color(FAINT).font(FontId::new(10.5, FontFamily::Monospace)));
                    });
                });
                ui.add_space(10.0);

                let mut changed = false;
                let profile_snapshot = self.profile.lock().unwrap().clone();
                // seed the ACCOUNT toggle once from the owner-view profile (lobby.public; absent = default ON)
                if self.lobby_public.is_none() {
                    if let Some(pv) = &profile_snapshot {
                        let pubv = pv.get("lobby").and_then(|l| l.get("public")).and_then(|x| x.as_bool()).unwrap_or(true);
                        self.lobby_public = Some(pubv);
                    }
                }

                egui::ScrollArea::vertical().auto_shrink([false, true]).max_height(ui.available_height() - 58.0).show(ui, |ui| {

                // ── signed in ──
                card(ui, "SIGNED IN", |ui| {
                    if self.steamid.is_empty() {
                        ui.label(RichText::new("Not signed in — open the web app and sign in with Steam.").color(DIM).size(12.5));
                    } else {
                        ui.horizontal(|ui| {
                            ui.label(RichText::new("●").color(GOOD).size(11.0));
                            ui.label(RichText::new(&self.steamid).color(INK).font(FontId::new(12.5, FontFamily::Monospace)));
                        });
                    }
                });

                // ── your record: the profile page's numbers, crude on purpose ──
                if !self.steamid.is_empty() {
                    card(ui, "YOUR RECORD", |ui| {
                        match &profile_snapshot {
                            None => { ui.label(RichText::new("loading…").color(FAINT).size(11.5)); ui.ctx().request_repaint_after(std::time::Duration::from_millis(400)); }
                            Some(pv) if vs(pv, "name").is_empty() && vi(pv, &["wins"]) == 0 && vi(pv, &["losses"]) == 0 => {
                                ui.label(RichText::new("No games on record yet — play a ranked match and this fills in.").color(DIM).size(11.5));
                            }
                            Some(pv) => {
                                let (w, l) = (vi(pv, &["wins"]), vi(pv, &["losses"]));
                                let pct = if w + l > 0 { (100 * w) / (w + l) } else { 0 };
                                ui.horizontal(|ui| {
                                    ui.label(RichText::new(vs(pv, "rank").to_uppercase()).color(GOLD).font(display(24.0)));
                                    ui.label(RichText::new(format!("{}", vi(pv, &["rating"]))).color(INK).font(display(24.0)));
                                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                        ui.label(RichText::new(format!("peak {}", vi(pv, &["peak_rating"]))).color(FAINT).font(FontId::new(10.5, FontFamily::Monospace)));
                                    });
                                });
                                ui.label(RichText::new(format!("{}–{} ranked · {}% wins · best streak {}", w, l, pct, vi(pv, &["best_streak"]))).color(INK).font(semibold(13.0)));
                                ui.add_space(3.0);
                                let money = format!("money {}–{}", vi(pv, &["money", "wins"]), vi(pv, &["money", "losses"]));
                                let rail_net = vi(pv, &["rail", "net"]);
                                let rail = format!("rail {}–{} ({}{}🪙)", vi(pv, &["rail", "wins"]), vi(pv, &["rail", "losses"]), if rail_net >= 0 { "+" } else { "" }, rail_net);
                                let lobby = format!("lobby {}–{}", vi(pv, &["lobby", "wins"]), vi(pv, &["lobby", "losses"]));
                                ui.label(RichText::new(format!("{}  ·  {}  ·  {}", money, rail, lobby)).color(DIM).font(FontId::new(11.5, FontFamily::Monospace)));
                                ui.label(RichText::new(format!("verified wins {} · tournament {}–{}", vi(pv, &["verified_wins"]), vi(pv, &["tourney", "wins"]), vi(pv, &["tourney", "losses"]))).color(FAINT).font(FontId::new(10.5, FontFamily::Monospace)));
                            }
                        }
                    });
                }

                // ── gameplay ──
                card(ui, "GAMEPLAY", |ui| {
                    changed |= ui.checkbox(&mut self.skins, RichText::new("Show custom skins in game").font(semibold(13.5))).changed();
                    sub(ui, "Off by default. Skin painting writes live game memory and can crash the game on some setups — turn it on only if you want it. Also controls receiving other players' skins.", WARN);
                    ui.add_space(6.0);
                    changed |= ui.checkbox(&mut self.paused, RichText::new("Pause reporting").font(semibold(13.5))).changed();
                    sub(ui, "Stops sending matches, presence and results until you unpause. Your games won't count while paused.", DIM);
                });

                // ── system ──
                card(ui, "SYSTEM", |ui| {
                    changed |= ui.checkbox(&mut self.autostart, RichText::new("Start with the system").font(semibold(13.5))).changed();
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("Update channel").font(semibold(13.5)));
                        ui.add_space(4.0);
                        changed |= ui.selectable_value(&mut self.beta, false, RichText::new("STABLE").font(FontId::new(10.5, FontFamily::Monospace))).changed();
                        changed |= ui.selectable_value(&mut self.beta, true, RichText::new("BETA").font(FontId::new(10.5, FontFamily::Monospace))).changed();
                    });
                    ui.horizontal(|ui| {
                        ui.add_space(2.0);
                        ui.label(RichText::new("Updates install themselves within the hour.").color(DIM).size(11.0));
                    });
                });

                // ── account: server-side settings (the webapp settings page's toggles) ──
                if !self.steamid.is_empty() {
                    card(ui, "ACCOUNT", |ui| {
                        match self.lobby_public {
                            None => { ui.label(RichText::new("loading…").color(FAINT).size(11.5)); }
                            Some(mut pubv) => {
                                if ui.checkbox(&mut pubv, RichText::new("Show my casual lobby record publicly").font(semibold(13.5))).changed() {
                                    self.lobby_public = Some(pubv);
                                    // server-side pref — posted immediately with the agent's bearer
                                    let tok = self.token.clone();
                                    std::thread::spawn(move || {
                                        let _ = ureq::post(&format!("{}/lobby_visibility", config::SERVER_BASE))
                                            .timeout(std::time::Duration::from_secs(6))
                                            .set("Authorization", &format!("Bearer {}", tok))
                                            .send_json(serde_json::json!({ "public": pubv }));
                                    });
                                    self.saved = Some(std::time::Instant::now());
                                }
                                sub(ui, "On by default. Off hides your casual-lobby wins and losses from other players' views of your profile.", DIM);
                            }
                        }
                    });
                }

                // ── hosting (read-only: the door follows the operator, it never leads) ──
                card(ui, "HOSTING", |ui| {
                    ui.label(
                        RichText::new(if self.host_mode { "Host node: ON" } else { "Host node: off" })
                            .color(if self.host_mode { GOLD } else { INK })
                            .font(semibold(13.5)),
                    );
                    ui.label(RichText::new("Hosting turns this machine into a referee cabinet — it stops playing and starts judging. Toggle it from the tray; while hosting, the settings above are ignored.").color(DIM).size(11.0));
                });

                }); // ScrollArea

                if changed {
                    self.save();
                }

                // ── footer ──
                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    ui.add_space(2.0);
                    ui.horizontal(|ui| {
                        if ui.button(RichText::new("Send a bug report").size(11.5)).clicked() {
                            // reap the child (zombie lesson 2026-08-27): spawn + wait on a throwaway thread
                            if let Ok(exe) = std::env::current_exe() {
                                if let Ok(mut c) = std::process::Command::new(exe).arg("--bugreport").spawn() {
                                    std::thread::spawn(move || { let _ = c.wait(); });
                                }
                            }
                        }
                        if ui.button(RichText::new("Open logs").size(11.5)).clicked() {
                            let _ = open::that(crate::runtime_dir());
                        }
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.button(RichText::new("nobd.net/app ↗").size(11.5).color(GOLD)).clicked() {
                                let _ = open::that(config::WEB_APP);
                            }
                        });
                    });
                    if let Some(t) = self.saved {
                        if t.elapsed().as_secs() < 3 {
                            ui.label(RichText::new("✓ saved — the agent applies it within seconds").color(GOOD).size(10.5));
                            ctx.request_repaint_after(std::time::Duration::from_millis(500));
                        }
                    }
                });
            });
    }
}
