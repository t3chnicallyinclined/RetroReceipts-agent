// settings.rs — 🎛 THE COIN DOOR, Tracker edition (design: "Three Doors" mock A + C's switches +
// B's status bar; owner-picked 2026-08-27). A competitive-tracker panel: you LAND on your record
// (OVERVIEW — hero + tier progress + stat tiles + form pips), settings are one tab away.
//
// ARCHITECTURE (unchanged): its OWN SHORT-LIVED PROCESS (`rr-agent --settings`, spawned by the
// tray; tao and winit never share an event loop). Talks to the running agent via prefs.json + the
// prefs_reload flag — THE DOOR FOLLOWS THE OPERATOR: it only writes prefs, never starts/stops
// anything. Skins stay OPT-IN forever; the crash-risk copy is honest.
//
// LIGHTWEIGHT BY DESIGN (owner directive): zero deps beyond eframe (switches, progress bars and
// pips are hand-painted primitives), no image decoding (the avatar is a tier-colored plate, not a
// download), two small JSON GETs on one background thread, and repaints only while loading or
// toasting — an idle window schedules nothing.
//
// DESIGN SYSTEM: THE ARENA token sheet, byte-for-byte from pwa/src/app.css :root (dark). If a
// color is not in app.css it does not belong here (exception: RK_PLATE — the system's own badge
// palette, ported from pwa/src/lib/ranks.ts).
use eframe::egui::{self, Color32, FontFamily, FontId, Rect, RichText, Rounding, Vec2};

use std::sync::{Arc, Mutex};

use crate::{config, prefs};

const BG: Color32 = Color32::from_rgb(0x0a, 0x0c, 0x12); //     --bg
const CARD: Color32 = Color32::from_rgb(0x16, 0x1a, 0x28); //   --card
const PANEL2: Color32 = Color32::from_rgb(0x19, 0x1d, 0x2b); // --panel-2 (widget fills)
const LINE: Color32 = Color32::from_rgb(0x27, 0x2d, 0x3e); //   --line
const INK: Color32 = Color32::from_rgb(0xee, 0xf1, 0xf8); //    --ink
const DIM: Color32 = Color32::from_rgb(0x8a, 0x91, 0xa8); //    --dim
const FAINT: Color32 = Color32::from_rgb(0x5a, 0x61, 0x78); //  --faint
const GOLD: Color32 = Color32::from_rgb(0xff, 0xb0, 0x20); //   --gold
const GOLD_INK: Color32 = Color32::from_rgb(0x24, 0x17, 0x00); // --gold-ink
const GOOD: Color32 = Color32::from_rgb(0x35, 0xd0, 0x7f); //   --good
const LOSS: Color32 = Color32::from_rgb(0xff, 0x6b, 0x6b); //   --loss
const MOLTEN: Color32 = Color32::from_rgb(0xff, 0x5c, 0x2c); // --molten (urgency: the crash warning)
const BOARD: Color32 = Color32::from_rgb(0x0d, 0x10, 0x17); //  --board (tab strip / status bar)

fn semi(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("semibold".into()))
}
fn mono(size: f32) -> FontId {
    FontId::new(size, FontFamily::Monospace)
}

fn setup(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert("plex".into(), egui::FontData::from_static(include_bytes!("../assets/fonts/IBMPlexSans-Regular.ttf")));
    fonts.font_data.insert("plex-sb".into(), egui::FontData::from_static(include_bytes!("../assets/fonts/IBMPlexSans-SemiBold.ttf")));
    fonts.font_data.insert("plex-mono".into(), egui::FontData::from_static(include_bytes!("../assets/fonts/IBMPlexMono-Regular.ttf")));
    fonts.families.get_mut(&FontFamily::Proportional).unwrap().insert(0, "plex".into());
    fonts.families.get_mut(&FontFamily::Monospace).unwrap().insert(0, "plex-mono".into());
    fonts.families.insert(FontFamily::Name("semibold".into()), vec!["plex-sb".into()]);
    ctx.set_fonts(fonts);

    let mut v = egui::Visuals::dark();
    v.panel_fill = BG;
    v.override_text_color = Some(INK);
    v.selection.bg_fill = GOLD;
    v.selection.stroke = egui::Stroke::new(1.0, GOLD_INK);
    v.widgets.inactive.bg_fill = PANEL2;
    v.widgets.inactive.weak_bg_fill = PANEL2;
    v.widgets.hovered.bg_fill = LINE;
    v.widgets.hovered.weak_bg_fill = LINE;
    v.widgets.active.bg_fill = GOLD;
    v.widgets.active.fg_stroke = egui::Stroke::new(1.0, GOLD_INK);
    v.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, LINE);
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.rounding = Rounding::same(10.0);
    }
    let mut style = (*ctx.style()).clone();
    style.visuals = v;
    style.spacing.item_spacing = Vec2::new(8.0, 7.0);
    style.spacing.button_padding = Vec2::new(13.0, 6.0);
    ctx.set_style(style);
}

pub fn run() {
    let opts = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([408.0, 668.0])
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

// ── The Marvel Ladder — ported VERBATIM from pwa/src/lib/ranks.ts (mirrors elo.rs rank_tier).
// DESIGN-SYSTEM "Badges" rule: derive tier from rating+games client-side; never trust a server
// rank string. games < 5 = placement gate ("Civilian").
const RANK_TIERS: &[(&str, i64, i64)] = &[
    ("Iron", 840, 920), ("Bronze", 920, 980), ("Silver", 980, 1050), ("Gold", 1050, 1120),
    ("Vibranium", 1120, 1200), ("Adamantium", 1200, 1300), ("Herald", 1300, 1400),
    ("Infinity", 1400, 1500), ("Galactus", 1500, i64::MAX),
];
const RANK_MIN_GAMES: i64 = 5;

/// RK_PLATE (light, dark) — the webapp's badge plate palette, byte-for-byte.
fn plate(tier: &str) -> (Color32, Color32) {
    let (l, d) = match tier {
        "Iron" => (0xa7adb8, 0x63697a),
        "Bronze" => (0xd59a5f, 0x8a5527),
        "Silver" => (0xcdd7e4, 0x93a1b6),
        "Gold" => (0xf2c74a, 0xc98f0e),
        "Vibranium" => (0xb98cff, 0x6428cf),
        "Adamantium" => (0x9fd4ef, 0x48789e),
        "Herald" => (0xffb35c, 0x2c2456),
        "Infinity" => (0xffe9b0, 0x241b33),
        "Galactus" => (0xff7ae0, 0x7a5cff),
        _ => (0x6b7488, 0x2a3140), // Civilian
    };
    let c = |v: u32| Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8);
    (c(l), c(d))
}

fn rank_of(rating: i64, games: i64) -> &'static str {
    if games < RANK_MIN_GAMES {
        return "Civilian";
    }
    RANK_TIERS.iter().find(|(_, _, hi)| rating < *hi).map(|(n, _, _)| *n).unwrap_or("Galactus")
}

/// (fill 0..=1, label) for the tier-progress bar under the hero.
fn tier_progress(tier: &str, rating: i64, games: i64) -> (f32, String) {
    if tier == "Civilian" {
        let left = (RANK_MIN_GAMES - games).max(0);
        return ((games as f32 / RANK_MIN_GAMES as f32).clamp(0.0, 1.0), format!("PLAY {left} MORE RANKED TO PLACE"));
    }
    if tier == "Galactus" {
        return (1.0, "APEX — TOP OF THE LADDER".into());
    }
    let idx = RANK_TIERS.iter().position(|(n, _, _)| *n == tier).unwrap_or(0);
    let (_, lo, hi) = RANK_TIERS[idx];
    let next = RANK_TIERS.get(idx + 1).map(|(n, _, _)| *n).unwrap_or("Galactus");
    let fill = ((rating - lo) as f32 / (hi - lo) as f32).clamp(0.0, 1.0);
    (fill, format!("{} PTS TO {}", (hi - rating).max(0), next.to_uppercase()))
}

struct Door {
    tab: usize, // 0 = OVERVIEW, 1 = SETTINGS
    skins: bool,
    paused: bool,
    autostart: bool,
    beta: bool,
    host_mode: bool,
    steamid: String,
    token: String,
    saved: Option<std::time::Instant>,
    // both fetched on ONE background thread at launch; the UI never blocks (loading → repaint tick).
    profile: Arc<Mutex<Option<serde_json::Value>>>,
    agent: Arc<Mutex<Option<serde_json::Value>>>,
    lobby_public: Option<bool>,
}

impl Door {
    fn load() -> Self {
        let (steamid, token) = read_auth();
        let profile: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));
        let agent: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));
        if !steamid.is_empty() {
            let (sid, tok, pslot, aslot) = (steamid.clone(), token.clone(), profile.clone(), agent.clone());
            std::thread::spawn(move || {
                let get = |url: String| -> Option<serde_json::Value> {
                    let req = ureq::get(&url).timeout(std::time::Duration::from_secs(6));
                    let req = if tok.is_empty() { req } else { req.set("Authorization", &format!("Bearer {}", tok)) };
                    req.call().ok()?.into_json().ok()
                };
                if let Some(v) = get(format!("{}/profile?steamid={}", config::SERVER_BASE, sid)) {
                    *pslot.lock().unwrap() = Some(v);
                }
                if let Some(v) = get(format!("{}/agent", config::SERVER_BASE)) {
                    *aslot.lock().unwrap() = Some(v);
                }
            });
        }
        Door {
            tab: 0,
            skins: prefs::load_apply_skins(),
            paused: prefs::load_paused(),
            autostart: crate::autostart::is_enabled(),
            beta: prefs::load_channel() == "beta",
            host_mode: prefs::load_host_mode(),
            steamid,
            token,
            saved: None,
            profile,
            agent,
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

fn vi(v: &serde_json::Value, path: &[&str]) -> i64 {
    let mut cur = v;
    for p in path {
        cur = cur.get(p).unwrap_or(&serde_json::Value::Null);
    }
    cur.as_i64().unwrap_or(0)
}
fn vs<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// Last-N ranked results, NEWEST FIRST, from profile.recent (`won` is server-derived per row).
fn recent_wins(pv: &serde_json::Value, n: usize) -> Vec<bool> {
    pv.get("recent")
        .and_then(|r| r.as_array())
        .map(|rows| rows.iter().take(n).filter_map(|r| r.get("won").and_then(|x| x.as_bool())).collect())
        .unwrap_or_default()
}

/// Hand-painted toggle switch (mock C): pill + knob, GOLD when on. Zero deps.
fn switch(ui: &mut egui::Ui, on: &mut bool) -> bool {
    let size = Vec2::new(34.0, 19.0);
    let (rect, mut resp) = ui.allocate_exact_size(size, egui::Sense::click());
    if resp.clicked() {
        *on = !*on;
        resp.mark_changed();
    }
    let t = ui.ctx().animate_bool(resp.id, *on);
    let (fill, stroke, knob) = if *on { (GOLD, GOLD, GOLD_INK) } else { (PANEL2, LINE, FAINT) };
    let p = ui.painter();
    p.rect(rect, Rounding::same(999.0), fill, egui::Stroke::new(1.0, stroke));
    let r = rect.height() / 2.0 - 3.0;
    let x = egui::lerp((rect.left() + r + 3.0)..=(rect.right() - r - 3.0), t);
    p.circle_filled(egui::pos2(x, rect.center().y), r, knob);
    resp.changed()
}

/// A settings row: title (+ optional sub-copy) on the left, a switch on the right.
fn switch_row(ui: &mut egui::Ui, on: &mut bool, title: &str, sub: Option<(&str, Color32)>) -> bool {
    let mut changed = false;
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.set_width(ui.available_width() - 46.0);
            ui.label(RichText::new(title).font(semi(13.0)));
            if let Some((s, c)) = sub {
                ui.label(RichText::new(s).color(c).size(10.5));
            }
        });
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            changed = switch(ui, on);
        });
    });
    changed
}

/// One overview stat tile: big numeral + mono micro-label.
fn tile(ui: &mut egui::Ui, w: f32, value: &str, vcolor: Color32, label: &str) {
    egui::Frame::none()
        .fill(CARD)
        .stroke(egui::Stroke::new(1.0, LINE))
        .rounding(Rounding::same(12.0))
        .inner_margin(egui::Margin::symmetric(11.0, 9.0))
        .show(ui, |ui| {
            ui.set_width(w);
            ui.label(RichText::new(value).color(vcolor).font(semi(20.0)));
            ui.label(RichText::new(label).color(FAINT).font(mono(8.5)));
        });
}

fn card<R>(ui: &mut egui::Ui, label: &str, body: impl FnOnce(&mut egui::Ui) -> R) -> R {
    let frame = egui::Frame::none()
        .fill(CARD)
        .stroke(egui::Stroke::new(1.0, LINE))
        .rounding(Rounding::same(14.0)) // --r
        .inner_margin(egui::Margin::symmetric(14.0, 12.0));
    let r = frame
        .show(ui, |ui| {
            ui.label(RichText::new(label).color(FAINT).font(mono(9.5)));
            ui.add_space(4.0);
            body(ui)
        })
        .inner;
    ui.add_space(9.0);
    r
}

impl eframe::App for Door {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // ── bottom status bar (mock B): agent · skins · version — always visible, always honest ──
        let agent_snapshot = self.agent.lock().unwrap().clone();
        egui::TopBottomPanel::bottom("status")
            .frame(egui::Frame::none().fill(BOARD).inner_margin(egui::Margin::symmetric(14.0, 6.0)))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    match &agent_snapshot {
                        Some(a) => {
                            let now_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                            let fresh = vi(a, &["last_seen"]) > 0 && now_ms - vi(a, &["last_seen"]) < 120_000;
                            if fresh {
                                ui.label(RichText::new("● AGENT ONLINE").color(GOOD).font(mono(9.0)));
                            } else {
                                ui.label(RichText::new("○ AGENT OFFLINE").color(FAINT).font(mono(9.0)));
                            }
                        }
                        None => {
                            ui.label(RichText::new("○ AGENT …").color(FAINT).font(mono(9.0)));
                        }
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(RichText::new(format!("SKINS {} · v{}", if self.skins { "ON" } else { "OFF" }, config::VERSION)).color(FAINT).font(mono(9.0)));
                        if let Some(a) = &agent_snapshot {
                            if a.get("update_available").and_then(|x| x.as_bool()).unwrap_or(false) {
                                ui.label(RichText::new("UPDATE READY · ").color(GOLD).font(mono(9.0)));
                            }
                        }
                    });
                });
            });

        // ── tab strip ──
        egui::TopBottomPanel::top("tabs")
            .frame(egui::Frame::none().fill(BOARD))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    let w = ui.available_width() / 2.0;
                    for (i, name) in ["OVERVIEW", "SETTINGS"].iter().enumerate() {
                        let on = self.tab == i;
                        let (rect, resp) = ui.allocate_exact_size(Vec2::new(w, 32.0), egui::Sense::click());
                        if resp.clicked() {
                            self.tab = i;
                        }
                        let color = if on { GOLD } else { FAINT };
                        ui.painter().text(rect.center(), egui::Align2::CENTER_CENTER, name, mono(10.0), color);
                        if on {
                            ui.painter().rect_filled(
                                Rect::from_min_max(egui::pos2(rect.left() + 8.0, rect.bottom() - 2.0), egui::pos2(rect.right() - 8.0, rect.bottom())),
                                Rounding::same(2.0),
                                GOLD,
                            );
                        }
                    }
                });
            });

        let profile_snapshot = self.profile.lock().unwrap().clone();
        if self.lobby_public.is_none() {
            if let Some(pv) = &profile_snapshot {
                self.lobby_public = Some(pv.get("lobby").and_then(|l| l.get("public")).and_then(|x| x.as_bool()).unwrap_or(true));
            }
        }

        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(BG).inner_margin(egui::Margin::symmetric(14.0, 12.0)))
            .show(ctx, |ui| {
                if self.tab == 0 {
                    self.overview(ui, &profile_snapshot);
                } else {
                    self.settings_tab(ui);
                }
            });
    }
}

impl Door {
    fn overview(&mut self, ui: &mut egui::Ui, profile: &Option<serde_json::Value>) {
        if self.steamid.is_empty() {
            ui.add_space(18.0);
            ui.label(RichText::new("Not signed in").font(semi(15.0)));
            ui.label(RichText::new("Open the web app and sign in with Steam — your record shows up here.").color(DIM).size(12.0));
            return;
        }
        let Some(pv) = profile else {
            ui.add_space(18.0);
            ui.label(RichText::new("loading your record…").color(FAINT).font(mono(10.5)));
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(400));
            return;
        };

        let (w, l) = (vi(pv, &["wins"]), vi(pv, &["losses"]));
        let games = w + l;
        let rating = vi(pv, &["rating"]);
        let tier = rank_of(rating, games);
        let (pl_light, pl_dark) = plate(tier);

        // ── hero: tier-colored plate block + name + badge + rating ──
        ui.horizontal(|ui| {
            let (rect, _) = ui.allocate_exact_size(Vec2::new(44.0, 44.0), egui::Sense::hover());
            ui.painter().rect(rect, Rounding::same(10.0), pl_dark, egui::Stroke::new(1.5, pl_light));
            ui.painter().text(rect.center(), egui::Align2::CENTER_CENTER, tier.chars().next().unwrap_or('C'), semi(20.0), pl_light);
            ui.vertical(|ui| {
                ui.label(RichText::new(vs(pv, "name")).font(semi(15.0)));
                ui.horizontal(|ui| {
                    egui::Frame::none()
                        .fill(pl_dark)
                        .stroke(egui::Stroke::new(1.5, pl_light))
                        .rounding(Rounding::same(8.0))
                        .inner_margin(egui::Margin::symmetric(9.0, 2.0))
                        .show(ui, |ui| {
                            ui.label(RichText::new(tier.to_uppercase()).color(pl_light).font(semi(11.5)));
                        });
                    ui.label(RichText::new(format!("{rating}")).font(semi(16.0)));
                    ui.label(RichText::new(format!("peak {}", vi(pv, &["peak_rating"]))).color(FAINT).font(mono(9.5)));
                });
            });
        });

        // ── tier progress ──
        let (fill, plabel) = tier_progress(tier, rating, games);
        ui.add_space(4.0);
        let (bar, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 5.0), egui::Sense::hover());
        ui.painter().rect_filled(bar, Rounding::same(999.0), PANEL2);
        let mut fr = bar;
        fr.set_width(bar.width() * fill);
        ui.painter().rect_filled(fr, Rounding::same(999.0), GOLD);
        ui.label(RichText::new(plabel).color(FAINT).font(mono(9.0)));
        ui.add_space(8.0);

        // ── stat tiles 2×2 ──
        let pct = if games > 0 { (100 * w) / games } else { 0 };
        let wins_recent = recent_wins(pv, 40);
        let streak = wins_recent
            .first()
            .map(|&first| {
                let n = wins_recent.iter().take_while(|&&x| x == first).count();
                format!("{}{}", if first { "W" } else { "L" }, n)
            })
            .unwrap_or_else(|| "—".into());
        let rail_net = vi(pv, &["rail", "net"]);
        let tw = (ui.available_width() - 8.0) / 2.0 - 24.0;
        ui.horizontal(|ui| {
            tile(ui, tw, &format!("{pct}%"), GOOD, &format!("WIN RATE · {games} RANKED"));
            tile(ui, tw, &streak, INK, &format!("STREAK · BEST {}", vi(pv, &["best_streak"])));
        });
        ui.horizontal(|ui| {
            tile(ui, tw, &format!("{}{} 🪙", if rail_net >= 0 { "+" } else { "" }, rail_net), GOLD,
                 &format!("RAIL NET · {}–{}", vi(pv, &["rail", "wins"]), vi(pv, &["rail", "losses"])));
            tile(ui, tw, &format!("{}", vi(pv, &["verified_wins"])), INK, "VERIFIED WINS");
        });

        // ── form pips: last 10, oldest → newest ──
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            ui.label(RichText::new("FORM").color(FAINT).font(mono(9.0)));
            let mut last10: Vec<bool> = wins_recent.iter().take(10).copied().collect();
            last10.reverse();
            for won in &last10 {
                let (r, _) = ui.allocate_exact_size(Vec2::new(14.0, 14.0), egui::Sense::hover());
                if *won {
                    ui.painter().rect_filled(r, Rounding::same(4.0), GOOD);
                } else {
                    ui.painter().rect(r, Rounding::same(4.0), PANEL2, egui::Stroke::new(1.0, LOSS));
                }
            }
            if last10.is_empty() {
                ui.label(RichText::new("no ranked games yet").color(FAINT).font(mono(9.0)));
            }
        });

        // ── records strip ──
        ui.add_space(8.0);
        ui.separator();
        ui.horizontal(|ui| {
            let rec = |ui: &mut egui::Ui, name: &str, a: i64, b: i64| {
                ui.label(RichText::new(name).color(DIM).font(mono(10.0)));
                ui.label(RichText::new(format!("{a}–{b}")).font(semi(12.0)));
                ui.add_space(8.0);
            };
            rec(ui, "MONEY", vi(pv, &["money", "wins"]), vi(pv, &["money", "losses"]));
            rec(ui, "LOBBY", vi(pv, &["lobby", "wins"]), vi(pv, &["lobby", "losses"]));
            rec(ui, "TOURNEY", vi(pv, &["tourney", "wins"]), vi(pv, &["tourney", "losses"]));
        });
    }

    fn settings_tab(&mut self, ui: &mut egui::Ui) {
        let mut changed = false;
        egui::ScrollArea::vertical().auto_shrink([false, true]).show(ui, |ui| {
            card(ui, "GAMEPLAY", |ui| {
                changed |= switch_row(ui, &mut self.skins, "Show custom skins in game",
                    Some(("Writes live game memory — can crash on some setups. Off by default; also controls receiving skins.", MOLTEN)));
                ui.add_space(5.0);
                changed |= switch_row(ui, &mut self.paused, "Pause reporting",
                    Some(("Nothing counts while paused.", DIM)));
            });
            card(ui, "SYSTEM", |ui| {
                changed |= switch_row(ui, &mut self.autostart, "Start with the system", None);
                ui.add_space(5.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Update channel").font(semi(13.0)));
                    ui.add_space(4.0);
                    changed |= ui.selectable_value(&mut self.beta, false, RichText::new("STABLE").font(mono(10.0))).changed();
                    changed |= ui.selectable_value(&mut self.beta, true, RichText::new("BETA").font(mono(10.0))).changed();
                });
                ui.label(RichText::new("Updates install themselves within the hour.").color(DIM).size(10.5));
            });
            if !self.steamid.is_empty() {
                card(ui, "ACCOUNT", |ui| {
                    match self.lobby_public {
                        None => {
                            ui.label(RichText::new("loading…").color(FAINT).font(mono(10.0)));
                        }
                        Some(mut pubv) => {
                            if switch_row(ui, &mut pubv, "Show my casual lobby record publicly",
                                Some(("On by default. Off hides lobby W–L from other players.", DIM))) {
                                self.lobby_public = Some(pubv);
                                let tok = self.token.clone();
                                std::thread::spawn(move || {
                                    let _ = ureq::post(&format!("{}/lobby_visibility", config::SERVER_BASE))
                                        .timeout(std::time::Duration::from_secs(6))
                                        .set("Authorization", &format!("Bearer {}", tok))
                                        .send_json(serde_json::json!({ "public": pubv }));
                                });
                                self.saved = Some(std::time::Instant::now());
                            }
                        }
                    }
                });
            }
            card(ui, "HOSTING", |ui| {
                ui.label(RichText::new(if self.host_mode { "Host node: ON" } else { "Host node: off" })
                    .color(if self.host_mode { GOLD } else { INK })
                    .font(semi(13.0)));
                ui.label(RichText::new("Hosting turns this machine into a referee cabinet — it stops playing and starts judging. Toggle it from the tray; while hosting, the settings above are ignored.").color(DIM).size(10.5));
            });

            ui.horizontal(|ui| {
                if ui.button(RichText::new("Send a bug report").size(11.0)).clicked() {
                    // reap the child (zombie lesson 2026-08-27)
                    if let Ok(exe) = std::env::current_exe() {
                        if let Ok(mut c) = std::process::Command::new(exe).arg("--bugreport").spawn() {
                            std::thread::spawn(move || {
                                let _ = c.wait();
                            });
                        }
                    }
                }
                if ui.button(RichText::new("Open logs").size(11.0)).clicked() {
                    let _ = open::that(crate::runtime_dir());
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let pill = egui::Button::new(RichText::new("OPEN RETRO RECEIPTS").font(semi(10.5)).color(GOLD_INK))
                        .fill(GOLD)
                        .rounding(Rounding::same(999.0));
                    if ui.add(pill).clicked() {
                        let _ = open::that(config::WEB_APP);
                    }
                });
            });
            if let Some(t) = self.saved {
                if t.elapsed().as_secs() < 3 {
                    ui.label(RichText::new("✓ saved — the agent applies it within seconds").color(GOOD).size(10.0));
                    ui.ctx().request_repaint_after(std::time::Duration::from_millis(500));
                }
            }
        });
        if changed {
            self.save();
        }
    }
}
