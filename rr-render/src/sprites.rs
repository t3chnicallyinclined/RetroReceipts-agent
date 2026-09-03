//! FRAME EMITTER -- the body of `for r in rows:` in `tape_to_seq.main()`: preamble -> world lists 5/6/12/13 ->
//! SPRITES -> world 7/8/9 -> HUD 11 -> `order_draws`. The sprite pass (this file) is ported verbatim from the
//! sprite loop of main() (the gated rules also live in `v3gate.emit_frame`); the world passes live in `world.rs`.
//!
//! Constants: `SX, SY = 192.0, 112.0` (native half-extents), `TAPE_X, TAPE_Y = 3/5, 7/15` (640x480 -> 384x224),
//! `STRIDE = 40`, `Z0, ZSTEP` (the no-camera depth ramp), `LAYERZ` (bank13 loc_8c1355dc; the paint-order key).
use crate::assets::Atlas;
use crate::camera::{scene_p, sprite_vertex_z, CameraModel};
use crate::state::WorldTemplate;
use crate::tape::{Node, Page, Pal256, Tape};
use crate::util::{sha8, OrderedMap};
use crate::world::{self, WorldAssets, WorldState};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

pub const SX: f64 = 192.0;
pub const SY: f64 = 112.0;
pub const TAPE_X: f64 = 3.0 / 5.0;
pub const TAPE_Y: f64 = 7.0 / 15.0;
pub const STRIDE: usize = 40;
pub const Z0: f64 = 0.98150;
pub const ZSTEP: f64 = 1.79e-7;
/// DC LayerZ table (bank13 loc_8c1355dc): lower index nearer for 0..7; 8..11 nearest (flagged, not measured).
pub const LAYERZ: [i64; 16] = [15, 17, 19, 21, 23, 25, 27, 29, 10, 11, 12, 13, 30, 31, 32, 33];

/// The tape_to_seq.py command-line switches that change the law. Defaults = the gated path.
#[derive(Clone, Debug, Default)]
pub struct EmitOpts {
    /// `--bank N`: absolute palette bank override (skips palrows / the v3 palette locate).
    pub bank: Option<i64>,
    /// `--pal-lag N`: read the palrows of frame-N..frame (first hit wins).
    pub pal_lag: u32,
    /// `--flip-facing`, `--swap-teams`, `--forward-records`, `--no-vflip`, `--legacy-order` (diagnostics).
    pub flip_facing: bool, pub swap_teams: bool, pub forward_records: bool, pub no_vflip: bool, pub legacy_order: bool,
    /// `--no-world`, `--no-preamble`
    pub no_world: bool, pub no_preamble: bool,
}

/// A texture page as the seq carries it: fmt 61 = R8 index tile (w x h bytes), fmt 28 = RGBA.
pub type Texture = Page;

/// One draw before/after `order_draws`. `key`/`sub`/`cat`/`inherit_cull` are the Python `_key`/`_sub`/`_cat`/
/// `_inherit_cull`; `state` is the dict the draw was built from (sprite template / world template selection /
/// preamble draw); `vscb`/`pscb` override the state's vscbHash/pscbHash when set (world draws).
#[derive(Clone, Debug)]
pub struct Draw {
    pub first_index: u32, pub index_count: u32, pub stride: u32, pub voff: u32,
    pub tex: [Option<String>; 2],
    pub state: Map<String, Value>,
    pub vscb: Option<[Option<String>; 4]>, pub pscb: Option<[Option<String>; 4]>,
    pub cat: u8, pub key: Option<f64>, pub sub: (i64, i64, i64), pub inherit_cull: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Frame { pub frame: i64, pub verts: Vec<u8>, pub idxs: Vec<u32>, pub draws: Vec<Draw> }

#[derive(Default, Debug)]
pub struct Stats {
    pub missing: BTreeMap<String, u64>, pub held: BTreeMap<String, u64>, pub rotated_general: BTreeMap<u16, u64>,
    pub order: BTreeMap<String, u64>, pub drawn_total: u64,
    pub world_missing: BTreeMap<String, u64>, pub world_state: BTreeMap<String, u64>, pub world_state_total: BTreeMap<String, u64>,
    pub bg_stats: BTreeMap<String, u64>,
}

/// Per-frame buffers plus the cross-frame tables the passes append to (`textures`, `cb_recs`), the submission
/// sequence counter (`next_sub`) and the ring cull state (`last_cull`).
pub struct FrameCtx {
    pub verts: Vec<u8>, pub idxs: Vec<u32>, pub draws: Vec<Draw>,
    pub textures: OrderedMap<Texture>,
    /// constant buffers by hash (sha8 / pack hash) -> bytes, first-seen order
    pub cb_recs: OrderedMap<Vec<u8>>,
    pub stats: Stats,
    pub sub_seq: i64,
    pub last_cull: Option<i64>,
}

/// A queued sprite (the Python `items` tuple + its `extra` dict).
struct Item<'a> {
    layer: i64, at: Option<&'a Atlas>, sid: u16, tsx: f64, tsy: f64, mir: bool, kind: &'static str, cos: i64,
    bit15: bool, angle: u16, hot: (i16, i16), walk: i64, depth: Option<f32>, pslot: i64, pframe: u32,
}

pub struct Emitter<'a> {
    tape: &'a Tape,
    atlases: &'a HashMap<u8, Atlas>,
    camera: Option<&'a CameraModel>,
    /// the world template + assets (Python `wt`); None = no world pass (no anodes / --no-world / no camera)
    world: Option<(&'a WorldTemplate, &'a WorldAssets)>,
    world_state: Option<WorldState>,
    sprite_state: Map<String, Value>,
    pub opts: EmitOpts,
    p1: Vec<u8>, p2: Vec<u8>,
    nodes: BTreeMap<u32, Vec<Node>>,
    last_nodes: Option<Vec<Node>>,
    bank_slot: HashMap<u32, u8>,
    unknown_slots: Vec<u8>,
    pub textures: OrderedMap<Texture>,
    pub cb_recs: OrderedMap<Vec<u8>>,
    pub stats: Stats,
}

fn floor_mul(v: f64, k: f64) -> f64 { v.floor() * k }

impl<'a> Emitter<'a> {
    /// `sprite_state` = the template draw dict (`tape_to_seq.template()`); `world` = (WorldTemplate, assets) when
    /// the tape carries anodes, a camera model exists and --no-world is off (the Python `wt` condition).
    pub fn new(tape: &'a Tape, atlases: &'a HashMap<u8, Atlas>, camera: Option<&'a CameraModel>, sprite_state: Map<String, Value>,
               world: Option<(&'a WorldTemplate, &'a WorldAssets)>, opts: EmitOpts) -> Emitter<'a> {
        let (mut p1, mut p2) = (tape.p1_team.clone(), tape.p2_team.clone());
        if opts.swap_teams { std::mem::swap(&mut p1, &mut p2); }
        let mut bank_slot = HashMap::new();
        for rows in tape.nodes.values() {
            for n in rows { if n.kind == 0 && n.gfx1 != 0 { bank_slot.insert(n.gfx1, n.slot); } }
        }
        let known: std::collections::HashSet<u8> = bank_slot.values().copied().collect();
        let unknown_slots: Vec<u8> = (0u8..6).filter(|s| !known.contains(s)).collect();
        let world = if !tape.anodes.is_empty() && !opts.no_world && camera.is_some() { world } else { None };
        let world_state = world.map(|(_, a)| WorldState::new(a, tape));
        Emitter { tape, atlases, camera, world, world_state, sprite_state, opts, p1, p2, nodes: tape.nodes.clone(), last_nodes: None,
                  bank_slot, unknown_slots, textures: OrderedMap::new(), cb_recs: OrderedMap::new(), stats: Stats::default() }
    }

    pub fn world_enabled(&self) -> bool { self.world.is_some() }
    pub fn prop_stats(&self) -> BTreeMap<i64, (usize, usize)> { self.world_state.as_ref().map(|w| w.prop_stats.clone()).unwrap_or_default() }

    fn team_cid(&self, slot: u8) -> Option<u8> {
        let team = if slot % 2 == 0 { &self.p1 } else { &self.p2 };
        team.get((slot / 2) as usize).copied()
    }

    /// One tape row -> one frame. Mirrors the body of `for r in rows:` in main().
    pub fn emit_row(&mut self, row: usize) -> Option<Frame> {
        let r = self.tape.frames.get(row)?.clone();
        let tape = self.tape;
        let fr_clock = tape.num(&r, "frame").unwrap_or(0.0) as i64;
        let frc = fr_clock as u32;
        let mut ctx = FrameCtx { verts: Vec::new(), idxs: Vec::new(), draws: Vec::new(),
                                 textures: std::mem::take(&mut self.textures), cb_recs: std::mem::take(&mut self.cb_recs),
                                 stats: std::mem::take(&mut self.stats), sub_seq: 0, last_cull: None };

        // ── FRAME PREAMBLE (three clear quads)
        if let Some((wt, _)) = self.world {
            if !self.opts.no_preamble { world::emit_preamble(&mut ctx, wt, tape, &r); }
        }

        // ── the ordered items (bodies AND objects)
        let mut items: Vec<Item<'a>> = Vec::new();
        let have_nodes = !self.nodes.is_empty();
        if have_nodes {
            let cur_len = self.nodes.get(&frc).map(|c| c.len());
            let torn = match (cur_len, &self.last_nodes) { (Some(n), Some(l)) => n < 2 && l.len() >= 3, _ => false };
            if cur_len.is_none() || torn {
                let k = if cur_len.is_none() { "no nodes".to_string() } else { format!("torn ({} node)", cur_len.unwrap()) };
                *ctx.stats.held.entry(k).or_insert(0) += 1;
                if let Some(l) = &self.last_nodes { self.nodes.insert(frc, l.clone()); }
            } else {
                self.last_nodes = self.nodes.get(&frc).cloned();
            }
            let mut ordered: Vec<(usize, Node)> = self.nodes.get(&frc).map(|v| v.iter().cloned().enumerate().collect()).unwrap_or_default();
            ordered.sort_by(|a, b| {
                let ka = (-LAYERZ[(a.1.layer & 15) as usize], -(a.0 as i64));
                let kb = (-LAYERZ[(b.1.layer & 15) as usize], -(b.0 as i64));
                ka.cmp(&kb)
            });
            for (si, nd) in ordered {
                let mut owner = nd.owner;
                let cid = if nd.kind == 0 {
                    self.team_cid(nd.slot)
                } else {
                    if owner > 5 {
                        let b = nd.gfx1;
                        if nd.oslot >= 0 { owner = nd.oslot as u8; }
                        else if let Some(&s) = self.bank_slot.get(&b) { owner = s; }
                        else if self.unknown_slots.len() == 1 { owner = self.unknown_slots[0]; }
                    }
                    if owner > 5 {
                        *ctx.stats.missing.entry(format!("object with owner {} (unowned, gfx1 {:08X} unmatched)", nd.owner, nd.gfx1)).or_insert(0) += 1;
                        continue;
                    }
                    self.team_cid(owner)
                };
                let cid = match cid { Some(c) => c, None => { *ctx.stats.missing.entry("no atlas".into()).or_insert(0) += 1; continue; } };
                let mir = nd.face != 0;   // mirror = the node's facing ONLY; sid bit 15 = record FORMAT
                items.push(Item {
                    layer: 0, at: self.atlases.get(&cid), sid: nd.sid & 0x7FFF, tsx: nd.fsx as f64, tsy: nd.fsy as f64, mir,
                    kind: if nd.kind == 0 { "body" } else { "obj" }, cos: nd.pal as i64,
                    bit15: nd.sid & 0x8000 != 0, angle: nd.angle, hot: (nd.hotx, nd.hoty), walk: si as i64,
                    depth: Some(nd.depth), pslot: if nd.kind == 0 { nd.slot as i64 } else { owner as i64 }, pframe: frc,
                });
            }
        } else {
            // v2 tapes: the six fighter columns; the pre-decoded local `objs` list form is not ported
            let drawn = tape.arr(&r, "drawn[6]").unwrap_or_default();
            let sid = tape.arr(&r, "sid[6]").unwrap_or_default();
            let sx = tape.arr(&r, "sx[6]").unwrap_or_default();
            let sy = tape.arr(&r, "sy[6]").unwrap_or_default();
            let facing = tape.arr(&r, "facing[6]").unwrap_or_default();
            let layer = tape.arr(&r, "layer[6]");
            for slot in 0..6usize {
                if drawn.get(slot).copied().unwrap_or(0.0) == 0.0 { continue; }
                let lay = layer.as_ref().and_then(|l| l.get(slot).copied()).unwrap_or(8.0) as i64;
                let sid_raw = sid.get(slot).copied().unwrap_or(0.0) as i64;
                let cid = match self.team_cid(slot as u8) { Some(c) => c, None => continue };
                items.push(Item {
                    layer: lay, at: self.atlases.get(&cid), sid: (sid_raw & 0x7FFF) as u16,
                    tsx: sx.get(slot).copied().unwrap_or(0.0), tsy: sy.get(slot).copied().unwrap_or(0.0),
                    mir: facing.get(slot).copied().unwrap_or(0.0) != 0.0, kind: "body",
                    cos: tape.costume.get(slot).copied().unwrap_or(0), bit15: sid_raw & 0x8000 != 0, angle: 0, hot: (0, 0),
                    walk: 0, depth: None, pslot: -1, pframe: frc,
                });
            }
            items.sort_by_key(|it| (it.layer, if it.kind == "body" { 0 } else { 1 }));
        }

        // slot 3 during the sprite walk = the world camera P
        let ps: Option<[[f32; 4]; 4]> = self.camera.and_then(|cm| {
            let (ex, ey) = (tape.num(&r, "eyeX").unwrap_or(0.0), tape.num(&r, "eyeY").unwrap_or(0.0));
            cm.scene_block((ex, ey), "list6").map(|b| scene_p(&b))
        });

        // ── stage + world lists 5/6/12/13: behind the sprites
        if let (Some((wt, assets)), Some(cm)) = (self.world, self.camera) {
            let ws = self.world_state.as_mut().unwrap();
            world::emit_world(&mut ctx, wt, cm, assets, ws, tape, &r, frc, &[5, 6, 12, 13]);
        }
        // ── the sprites
        self.emit_sprites(&mut ctx, items, ps);
        // ── effects/shadows/markers after the sprites, the HUD last
        if let (Some((wt, assets)), Some(cm)) = (self.world, self.camera) {
            let ws = self.world_state.as_mut().unwrap();
            world::emit_world(&mut ctx, wt, cm, assets, ws, tape, &r, frc, &[7, 8, 9]);
            world::emit_world(&mut ctx, wt, cm, assets, ws, tape, &r, frc, &[11]);
        }
        order_draws(&mut ctx.draws, self.opts.legacy_order, &mut ctx.stats.order);
        world::fold_world_stats(&mut ctx);
        ctx.stats.drawn_total += ctx.draws.len() as u64;
        let fr = Frame { frame: fr_clock, verts: ctx.verts, idxs: ctx.idxs, draws: ctx.draws };
        self.textures = ctx.textures; self.cb_recs = ctx.cb_recs; self.stats = ctx.stats;
        Some(fr)
    }

    /// The sprite quad loop of main() (`for lay, at, sid, tsx, tsy, mir, kind, cos, extra in items:`).
    fn emit_sprites(&self, ctx: &mut FrameCtx, items: Vec<Item<'a>>, ps: Option<[[f32; 4]; 4]>) {
        let tape = self.tape;
        let v3pals = &tape.pals;
        let have_nodes = !self.nodes.is_empty();
        for it in items {
            let at = match it.at { Some(a) => a, None => { *ctx.stats.missing.entry("no atlas".into()).or_insert(0) += 1; continue; } };
            let recs = match at.asm.get(&(it.sid as u32)) { Some(r) if !r.is_empty() => r, _ => {
                *ctx.stats.missing.entry(format!("{} {} sel {}", at.name, it.kind, it.sid)).or_insert(0) += 1; continue; } };
            let ox = floor_mul(it.tsx, TAPE_X);
            let oy = floor_mul(it.tsy, TAPE_Y);
            let mir = if self.opts.flip_facing { !it.mir } else { it.mir };

            let mut prow = None;
            if !tape.palrows.is_empty() && self.opts.bank.is_none() && (0..6).contains(&it.pslot) {
                let pf = it.pframe as i64;
                let mut lag = self.opts.pal_lag as i64;
                while lag >= 0 {
                    if let Some(p) = tape.palrows.get(&((pf - lag) as u32)) { prow = Some(p); break; }
                    lag -= 1;
                }
            }
            let zero: Pal256 = [[0u8; 4]; 256];
            let (base_pal, blk_base): (Pal256, Option<i64>) = if let Some(p) = prow {
                let ps_ = (it.pslot * 8) as usize;
                let pi = p.idx[ps_] as usize;
                let bp = if pi < v3pals.len() { v3pals[pi] } else {
                    match v3pals.get(it.cos as usize) { Some(x) => *x, None => { *ctx.stats.missing.entry("pal index out of range".into()).or_insert(0) += 1; zero } } };
                (bp, None)
            } else if have_nodes && self.opts.bank.is_none() && it.cos >= 0 && (it.cos as usize) < v3pals.len() {
                let bp = v3pals[it.cos as usize];
                let mut blk = None;
                for (bi, bk) in at.banks.iter().enumerate() {
                    let all = (0..16).all(|i| bk.get(i).map(|c| *c == bp[i]).unwrap_or(false));
                    if all { blk = Some((bi - bi % 8) as i64); break; }
                }
                (bp, blk)
            } else {
                (at.palette(self.opts.bank, it.cos), None)
            };
            let mut pal_cache: HashMap<u8, Pal256> = HashMap::new();
            let pal_for_row = |row: u8, pal_cache: &mut HashMap<u8, Pal256>| -> Pal256 {
                if let Some(p) = prow {
                    if row == 0 { return base_pal; }
                    let pi = p.idx[(it.pslot * 8) as usize + (row & 7) as usize] as usize;
                    return if pi < v3pals.len() { v3pals[pi] } else { base_pal };
                }
                match blk_base {
                    Some(b) if row != 0 && b + (row as i64) < at.banks.len() as i64 => {
                        *pal_cache.entry(row).or_insert_with(|| at.palette(Some(b + row as i64), 0))
                    }
                    _ => base_pal,
                }
            };

            let order: Vec<usize> = if self.opts.forward_records { (0..recs.len()).collect() } else { (0..recs.len()).rev().collect() };
            for ri in order {
                let rec = recs[ri];
                let pid = rec.part;
                if !at.parts.contains_key(&pid) { continue; }
                let pal = pal_for_row(at.row_of(it.sid as u32, ri), &mut pal_cache);
                let palbytes: Vec<u8> = pal.iter().flat_map(|c| c.iter().copied()).collect();
                let palkey = format!("{}_pal_{}", at.name, sha8(&palbytes));
                if !ctx.textures.contains(&palkey) { ctx.textures.insert_new(&palkey, Texture { w: 256, h: 1, fmt: 28, data: palbytes }); }
                let fl = at.flag_of(it.sid as u32, ri);
                let (hf, vf) = (fl & 0x8000 != 0, fl & 0x4000 != 0);
                let (mut bmp, pw, ph) = match at.part_bitmap(pid, !self.opts.no_vflip, it.bit15) { Some(x) => x, None => continue };
                let (pw, ph) = (pw as i64, ph as i64);
                let (sw, sh, lw, lh) = at.dims.get(&pid).copied().unwrap_or((0, 0, 0, 0));
                let lw_px = if 0 < lw && lw <= sw { lw as i64 * 8 } else { pw };
                let lh_px = if 0 < lh && lh <= sh { lh as i64 * 8 } else { ph };
                if vf { bmp = bmp.flip_v(); }
                if hf { bmp = bmp.flip_h(); }
                let rot180 = it.angle == 0x8000 && it.hot == (0, 0);
                let rot_gen = it.angle != 0 && !rot180;
                if rot180 { bmp = bmp.flip_v().flip_h(); }
                let key = format!("{}_p{}_{}", at.name, pid, bmp.sha8());
                if !ctx.textures.contains(&key) { ctx.textures.insert_new(&key, Texture { w: pw as u32, h: ph as u32, fmt: 61, data: bmp.data.clone() }); }

                let (left, top): (f64, f64);
                if it.bit15 {
                    left = if mir { ox + rec.dx as f64 - pw as f64 } else { ox - rec.dx as f64 };
                    top = oy + rec.dy as f64;
                } else {
                    let mir_x = mir != hf;
                    let x0 = if mir { ox + rec.dx as f64 - lw_px as f64 } else { ox - rec.dx as f64 };
                    left = if mir_x { x0 + (lw_px - pw) as f64 } else { x0 };
                    top = oy + rec.dy as f64 + (if vf { lh_px - ph } else { 0 }) as f64;
                }
                let (left, top) = if rot180 { (2.0 * ox - left - pw as f64, 2.0 * oy - top - ph as f64) } else { (left, top) };
                let mut corners = [(left, top), (left, top + ph as f64), (left + pw as f64, top), (left + pw as f64, top + ph as f64)];
                if rot_gen {
                    let sgn = if mir { -1.0f64 } else { 1.0 };
                    let (hx, hy) = (it.hot.0 as f64, it.hot.1 as f64);
                    let px_ = it.tsx.floor() + sgn * hx / TAPE_X;
                    let py_ = it.tsy.floor() + hy / TAPE_Y;
                    let a = it.angle as i32;
                    let th = (((if mir { -a } else { a }) & 0xFFFF) as f64) * (2.0 * std::f64::consts::PI / 65536.0);
                    let (c, sn) = (th.cos(), th.sin());
                    for k in 0..4 {
                        let (cx, cy) = corners[k];
                        let x = cx / TAPE_X - px_;
                        let y = cy / TAPE_Y - py_;
                        corners[k] = ((px_ + x * c + y * sn) * TAPE_X, (py_ - x * sn + y * c) * TAPE_Y);
                    }
                    *ctx.stats.rotated_general.entry(it.angle).or_insert(0) += 1;
                }
                let mut dkey: Option<f64> = None;
                let z: f32 = match (it.depth, ps, self.opts.legacy_order) {
                    (Some(depth), Some(p), false) => {
                        let d = depth + 0.001f32 * (ri as f32);
                        dkey = Some(d as f64);
                        sprite_vertex_z(d, &p)
                    }
                    _ => (Z0 - ctx.draws.len() as f64 * ZSTEP) as f32,
                };
                let (u0, u1) = if mir { (1.0f32, 0.0f32) } else { (0.0, 1.0) };
                let first = (ctx.verts.len() / STRIDE) as u32;
                let us = [u0, u0, u1, u1];
                let vs = [0.0f32, 1.0, 0.0, 1.0];
                for k in 0..4 {
                    let (cx, cy) = corners[k];
                    let px = (cx / SX - 1.0) as f32;
                    let py = (1.0 - cy / SY) as f32;
                    ctx.verts.extend_from_slice(&px.to_le_bytes()); ctx.verts.extend_from_slice(&py.to_le_bytes());
                    ctx.verts.extend_from_slice(&z.to_le_bytes()); ctx.verts.extend_from_slice(&0.0f32.to_le_bytes());
                    ctx.verts.extend_from_slice(&0.0f32.to_le_bytes()); ctx.verts.extend_from_slice(&0.0f32.to_le_bytes());
                    ctx.verts.extend_from_slice(&[255, 255, 255, 255]);
                    ctx.verts.extend_from_slice(&[0, 0, 0, 0]);
                    ctx.verts.extend_from_slice(&us[k].to_le_bytes()); ctx.verts.extend_from_slice(&vs[k].to_le_bytes());
                }
                let fi = ctx.idxs.len() as u32;
                ctx.idxs.extend_from_slice(&[first, first + 1, first + 2, first + 2, first + 1, first + 3]);
                ctx.draws.push(Draw { first_index: fi, index_count: 6, stride: STRIDE as u32, voff: 0, tex: [Some(key), Some(palkey)],
                                      state: self.sprite_state.clone(), vscb: None, pscb: None,
                                      cat: 3, key: dkey, sub: (0, it.walk, ri as i64), inherit_cull: false });
            }
        }
    }
}

/// `tape_to_seq.order_draws`: categories 0/1 (Z-write) in submission order, then category 3 by (-key, submission).
/// Keyless cat-3 draws take the previous keyed draw's key. Bit-13 draws inherit the previous draw's `raster`.
pub fn order_draws(draws: &mut Vec<Draw>, legacy: bool, stats: &mut BTreeMap<String, u64>) {
    if legacy { for d in draws.iter_mut() { d.inherit_cull = false; } return; }
    let all = std::mem::take(draws);
    let mut phase1: Vec<Draw> = all.iter().filter(|d| d.cat == 0 || d.cat == 1).cloned().collect();
    phase1.sort_by(|a, b| (a.cat, a.sub).cmp(&(b.cat, b.sub)));
    let mut phase3: Vec<Draw> = all.into_iter().filter(|d| !(d.cat == 0 || d.cat == 1)).collect();
    phase3.sort_by(|a, b| a.sub.cmp(&b.sub));
    let mut last = 0.0f64;
    for d in phase3.iter_mut() {
        if d.key.is_none() {
            d.key = Some(last);
            *stats.entry("cat3 draw without a key (kept in submission slot)".into()).or_insert(0) += 1;
        }
        last = d.key.unwrap();
    }
    phase3.sort_by(|a, b| {
        let ka = -a.key.unwrap(); let kb = -b.key.unwrap();
        ka.partial_cmp(&kb).unwrap_or(std::cmp::Ordering::Equal).then(a.sub.cmp(&b.sub))
    });
    let mut out = phase1;
    out.extend(phase3);
    for i in 0..out.len() {
        if out[i].inherit_cull && i > 0 {
            if let Some(rs) = out[i - 1].state.get("raster").cloned() { out[i].state.insert("raster".into(), rs); }
        }
        out[i].inherit_cull = false;
        *stats.entry(format!("cat {}", out[i].cat)).or_insert(0) += 1;
    }
    *draws = out;
}
