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
use crate::util::{sha8, BlobStore, IbSegs, OrderedMap, VbSegs};
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
    /// `--no-palrow-resolve` (diagnostic A/B): read palrow block `f` for fighter `f` unconditionally, i.e. the
    /// pre-2026-09-04 behaviour. `resolve_palrow_slots` is otherwise free to prove that order wrong.
    pub no_palrow_resolve: bool,
    /// `--legacy-torn-guard` (diagnostic A/B): restore the ABSOLUTE torn test (`n < 2`), i.e. the pre-2026-09-04
    /// behaviour that drew a 24 -> 2 -> 24 truncated capture. See the guard in `emit_row`.
    pub legacy_torn_guard: bool,
    /// `--no-world`, `--no-preamble`
    pub no_world: bool, pub no_preamble: bool,
    /// CLOUD SKINS (2026-09-03, docs/REPLAY-META-SKINS-SPEC.md s3): per fighter slot, 16 colours (0xRRGGBB) that replace
    /// the BASE costume row (row 0) of that slot's palette before the LUT is built. Rows the game modifies at runtime
    /// (hit flash, glow, super darken) stay the game's own, so effects remain exact. Resolved per slot by the caller
    /// (web.rs: each player's own loadout on their side, matched by character id). None = stock.
    pub skins: [Option<[u32; 16]>; 6],
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
    /// the interned pipeline-state map (shared by every draw that selected it) and its content fingerprint --
    /// `state_fp` is what the feed keys its state table on, so no draw re-walks the map
    pub state: std::rc::Rc<Map<String, Value>>, pub state_fp: u64,
    pub vscb: Option<[Option<String>; 4]>, pub pscb: Option<[Option<String>; 4]>,
    pub cat: u8, pub key: Option<f64>, pub sub: (i64, i64, i64), pub inherit_cull: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Frame { pub frame: i64, pub verts: VbSegs, pub idxs: IbSegs, pub draws: Vec<Draw> }

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
    pub verts: VbSegs, pub idxs: IbSegs, pub draws: Vec<Draw>,
    /// shared geometry blobs (the static stage deck), first-seen order -- see `util::BlobStore`
    pub blobs: BlobStore,
    pub textures: OrderedMap<Texture>,
    /// constant buffers by hash (sha8 / pack hash) -> bytes, first-seen order
    pub cb_recs: OrderedMap<Vec<u8>>,
    pub stats: Stats,
    pub sub_seq: i64,
    pub last_cull: Option<i64>,
}

/// A queued sprite (the Python `items` tuple + its `extra` dict).
struct Item<'a> {
    #[allow(dead_code)] layer: i64, at: Option<&'a Atlas>, sid: u16, tsx: f64, tsy: f64, mir: bool, kind: &'static str, cos: i64,
    bit15: bool, angle: u16, hot: (i16, i16), walk: i64, depth: Option<f32>, pslot: i64, pframe: u32,
}

/// FNV-1a over everything that makes an `ObjRec` a DIFFERENT object to draw: its texture identity,
/// its render state, its colour, every vertex of every polygon group, AND its bounding sphere.
/// Floats are hashed by their bit pattern, so this is exact equality rather than a tolerance.
///
/// `centre`/`radius` are in here even though they are not rasterisation inputs: they feed
/// `sort_key_record` (`world.rs`), i.e. the TRANSLUCENT DRAW ORDER. Two records identical in every
/// other field but with different bounding spheres would otherwise merge and inherit the wrong sort
/// key -- changing blended output without changing a single vertex. Measured on 1,506 real objects
/// (722 capture + 784 seed) that collision occurs zero times, but zero-so-far is not never, and
/// mixing two more fields in costs nothing. Used to give the live feed a session-stable object
/// index (`aobj_index`).
fn aobj_hash(recs: &[crate::tape::ObjRec]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |b: &[u8]| { for &x in b { h ^= x as u64; h = h.wrapping_mul(0x100_0000_01b3); } };
    for r in recs {
        mix(&r.tcw.to_le_bytes()); mix(r.key.as_bytes());
        mix(&r.pcw.to_le_bytes()); mix(&r.isp.to_le_bytes());
        mix(&r.tsp.to_le_bytes()); mix(&r.texnum.to_le_bytes());
        for c in r.colour { mix(&c.to_bits().to_le_bytes()); }
        for (flags, vs) in &r.groups {
            mix(&flags.to_le_bytes());
            for v in vs { for f in v { mix(&f.to_bits().to_le_bytes()); } }
        }
        // the sort-order inputs -- see the note above
        match &r.centre { Some(c) => { mix(&[1u8]); for f in c { mix(&f.to_bits().to_le_bytes()); } } None => mix(&[0u8]) }
        match &r.radius { Some(v) => { mix(&[1u8]); mix(&v.to_bits().to_le_bytes()); } None => mix(&[0u8]) }
    }
    h
}

pub struct Emitter {
    pub tape: Tape,
    pub atlases: HashMap<u8, Atlas>,
    pub camera: Option<CameraModel>,
    /// the world template + assets (Python `wt`); assets None = no world pass (no anodes / --no-world / no camera)
    pub wt: WorldTemplate,
    world_assets: Option<WorldAssets>,
    world_state: Option<WorldState>,
    sprite_state: crate::state::StateRc,
    pub opts: EmitOpts,
    p1: Vec<u8>, p2: Vec<u8>,
    nodes: BTreeMap<u32, Vec<Node>>,
    last_nodes: Option<Vec<Node>>,
    bank_slot: HashMap<u32, u8>,
    unknown_slots: Vec<u8>,
    /// FIGHTER SLOT -> PALROW BLOCK INDEX (see `resolve_palrow_slots`). Identity on every tape whose blocks are
    /// already in fighter order; a permutation where the tape proves otherwise.
    pub palrow_slot: [usize; 6],
    /// One human-readable line about the above, for the emitter/feed log (None = plain identity, nothing to say).
    pub palrow_note: Option<String>,
    /// PRISTINE per-clock node counts, snapshotted before the torn guard is ever allowed to substitute into
    /// `self.nodes`. The guard reads only this, so its verdict is a pure function of the tape.
    node_counts: HashMap<u32, usize>,

    /// CONTENT HASH -> index into `tape.aobjs`, for the LIVE feed only.
    ///
    /// `ANode.obj` is a CHUNK-LOCAL index: the agent interns objects per `GsCapture` in first-seen
    /// order (`agent/src/harvest.rs:1281-1290`) and the window path builds a fresh capture per flush,
    /// so every pushed chunk restarts its index space at 0 with a few dozen entries. Looking those up
    /// in the SESSION's table (784 entries from the seed tape) drew other recordings' geometry:
    /// measured against MvC2's own draw list, 97.28% precision with 300/300 frames below 100% and
    /// 79,543 spurious world vertices in a 300-frame burst. Merging by CONTENT makes an index mean the
    /// same bytes for the life of the session, which is what the lookup in `world.rs` assumes.
    aobj_index: HashMap<u64, u16>,
    pub textures: OrderedMap<Texture>,
    pub cb_recs: OrderedMap<Vec<u8>>,
    pub blobs: BlobStore,
    pub stats: Stats,
    prof_rows: u64,
}

fn floor_mul(v: f64, k: f64) -> f64 { v.floor() * k }

/// Torn draw-list guard (see `emit_row`): a row must hold less than 1/TORN_FACTOR of the size its neighbours
/// agree on, and recovery must arrive within TORN_SCAN rows (the engine's own GGPO rollback horizon).
const TORN_FACTOR: usize = 2;
const TORN_SCAN: usize = 8;


/// PALROW BLOCK -> FIGHTER SLOT.
///
/// The engine stages each fighter's eight 16-colour rows at `blk+0x13C0 + k*0x1C0 + row*0x38` (bank
/// `0x10 + 8k + row`, FUN_1406146d0) and the agent ships those 48 rows verbatim (`harvest::read_palrows`,
/// `PAL_STAGE_OFF = blk + 0x1040 + 0x10*0x38`). This emitter used to assume `k == fighter slot`. That holds on
/// every kept gate tape, and it FAILS on prod tape `76561198029172402_..._59618234` (agent 0.3.50, stage 8),
/// where each P1 fighter's block sits at the ODD index and each P2 fighter's at the EVEN one -- so every
/// fighter drew in the other side's colours ("the skins look inverted"). It is the BLOCKS that moved, not the
/// roster: fighter slot 5 submits sprite_id 795, which does not exist in PL38's cell table (max 729), yet
/// block 5 holds PL38's costume-5 bank; and fighter slot 1's sprite_ids resolve in only 265/1143 of PL34's
/// cells, yet block 1 holds PL34's costume-5 bank. Whether the engine's registration order or the agent's
/// slot base is what varies is an open RE question (`FUN_1406146d0`); until the tape carries the per-fighter
/// bank base outright, the renderer reads it off the colours.
///
/// The resolution invents nothing: block `b` belongs to fighter `f` iff ROW 0 of block `b` is byte-equal to one
/// of `atlas(cid_f).banks` -- the character's OWN palette table out of `PLxx_lut.json`. A same-character mirror
/// ties, and the tie breaks on `bank == costume[f] * 8`, which is exactly the rule `Atlas::palette(None, cos)`
/// already encodes. A block matching no bank at all is a wildcard.
///
/// IDENTITY WINS. The permutation is used only when identity is NOT a consistent assignment and exactly one
/// complete assignment is -- so no tape that renders correctly today can move a pixel.
fn resolve_palrow_slots(tape: &Tape, atlases: &HashMap<u8, Atlas>, p1: &[u8], p2: &[u8]) -> ([usize; 6], Option<String>) {
    let ident = [0usize, 1, 2, 3, 4, 5];
    if tape.palrows.is_empty() || tape.pals.is_empty() { return (ident, None); }
    let cid_of = |f: usize| -> Option<u8> { (if f % 2 == 0 { p1 } else { p2 }).get(f / 2).copied() };

    // row 0 of each block, as the modal palette index over every palrows record in the tape
    let mut base_idx = [None; 6];
    for b in 0..6 {
        let mut n: HashMap<u16, u32> = HashMap::new();
        for pr in tape.palrows.values() { *n.entry(pr.idx[b * 8]).or_insert(0) += 1; }
        base_idx[b] = n.into_iter().max_by_key(|&(i, c)| (c, std::cmp::Reverse(i))).map(|(i, _)| i);
    }

    // candidates per block, at two strengths. CHARACTER level: the fighters whose ROM table contains those 16
    // colours at all (None = the colours are in no fighter's table -- a wildcard, e.g. a dimmed row). COSTUME
    // level: of those, the ones whose `costume[f] * 8` is the very bank that matched (breaks a mirror tie).
    let mut chr_cand: [Option<Vec<usize>>; 6] = Default::default();
    let mut cand: [Option<Vec<usize>>; 6] = Default::default();
    for b in 0..6 {
        let Some(pi) = base_idx[b] else { continue };
        let Some(want) = tape.pals.get(pi as usize) else { continue };
        let mut hits: Vec<(usize, usize)> = Vec::new();   // (fighter, bank)
        for f in 0..6 {
            let Some(at) = cid_of(f).and_then(|c| atlases.get(&c)) else { continue };
            if let Some(bi) = at.banks.iter().position(|bk| (0..16).all(|i| bk.get(i).map(|c| *c == want[i]).unwrap_or(false))) {
                hits.push((f, bi));
            }
        }
        if hits.is_empty() { continue; }                                   // wildcard
        chr_cand[b] = Some(hits.iter().map(|&(f, _)| f).collect());
        let cos8: Vec<usize> = hits.iter().filter(|&&(f, bi)| tape.costume.get(f).map(|c| *c * 8 == bi as i64).unwrap_or(false))
                                   .map(|&(f, _)| f).collect();
        cand[b] = Some(if cos8.is_empty() { hits.iter().map(|&(f, _)| f).collect() } else { cos8 });
    }

    // TRIGGER ON CHARACTER IDENTITY ONLY. A block whose colours belong to a DIFFERENT character than the fighter
    // sitting at its index cannot be explained by a mis-recorded `costume`; a bank-number disagreement can, and
    // `costume` is agent-recorded too. So a costume-only disagreement is left alone -- it changes no pixel that
    // renders correctly today, and it keeps every mirror match on the existing behaviour.
    let chr_ok = |perm: &[usize; 6]| (0..6).all(|b| chr_cand[b].as_ref().map(|c| c.contains(&perm[b])).unwrap_or(true));
    if chr_ok(&ident) { return (ident, None); }

    // A fighter is provably wearing another character's colours. Solve the assignment, mirrors broken on costume.
    let ok = |perm: &[usize; 6]| (0..6).all(|b| cand[b].as_ref().map(|c| c.contains(&perm[b])).unwrap_or(true));
    let mut found: Option<[usize; 6]> = None;
    let mut n_found = 0usize;
    let mut perm = ident;
    permute(&mut perm, 0, &mut |p| { if ok(p) { n_found += 1; if found.is_none() { found = Some(*p); } } });
    match (n_found, found) {
        (1, Some(p)) => {
            // p maps BLOCK -> FIGHTER; the emitter indexes FIGHTER -> BLOCK
            let mut inv = [0usize; 6];
            for b in 0..6 { inv[p[b]] = b; }
            let note = format!("palrows: the staged palette blocks are NOT in fighter-slot order -- fighter slot -> block {:?} \
                                (resolved by exact ROM-bank match on PLxx_lut.json; identity was contradicted)", inv);
            (inv, Some(note))
        }
        (0, _) => (ident, Some("palrows: a fighter's staged block holds ANOTHER character's palette and no consistent re-assignment \
                                exists -- keeping fighter-slot order (that fighter's colours are wrong)".into())),
        _ => (ident, Some(format!("palrows: identity is contradicted but {n_found} assignments fit -- keeping fighter-slot order"))),
    }
}

/// Every permutation of `a[k..]`, in place (6! = 720 for the fighter slots).
fn permute(a: &mut [usize; 6], k: usize, f: &mut impl FnMut(&[usize; 6])) {
    if k == 6 { f(a); return; }
    for i in k..6 { a.swap(k, i); permute(a, k + 1, f); a.swap(k, i); }
}


/// The Python `items` tuple before the atlas lookup (cid, sid, tsx, tsy, mir, kind, cos, bit15, angle, hot, walk, depth, pslot, layer).
type PreItem = (u8, u16, f64, f64, bool, &'static str, i64, bool, u16, (i16, i16), i64, Option<f32>, i64, i64);

impl Emitter {
    /// `sprite_state` = the template draw dict (`tape_to_seq.template()`); `world_assets` = Some when the tape
    /// carries anodes, a camera model exists and --no-world is off (the Python `wt` condition). The emitter OWNS
    /// its inputs so it can live inside a wasm module (no lifetimes across the JS boundary).
    pub fn new(tape: Tape, atlases: HashMap<u8, Atlas>, camera: Option<CameraModel>, sprite_state: Map<String, Value>,
               wt: WorldTemplate, world_assets: Option<WorldAssets>, opts: EmitOpts) -> Emitter {
        let (mut p1, mut p2) = (tape.p1_team.clone(), tape.p2_team.clone());
        if opts.swap_teams { std::mem::swap(&mut p1, &mut p2); }
        let mut bank_slot = HashMap::new();
        for rows in tape.nodes.values() {
            for n in rows { if n.kind == 0 && n.gfx1 != 0 { bank_slot.insert(n.gfx1, n.slot); } }
        }
        let known: std::collections::HashSet<u8> = bank_slot.values().copied().collect();
        let unknown_slots: Vec<u8> = (0u8..6).filter(|s| !known.contains(s)).collect();
        let world_assets = if !tape.anodes.is_empty() && !opts.no_world && camera.is_some() { world_assets } else { None };
        let world_state = world_assets.as_ref().map(|a| WorldState::new(a, &tape));
        let nodes = tape.nodes.clone();
        let node_counts: HashMap<u32, usize> = tape.nodes.iter().map(|(k, v)| (*k, v.len())).collect();
        let sprite_state = { let m = sprite_state; let fp = crate::util::state_fp(&m); (std::rc::Rc::new(m), fp) };
        let (palrow_slot, palrow_note) = if opts.no_palrow_resolve { ([0, 1, 2, 3, 4, 5], None) }
                                          else { resolve_palrow_slots(&tape, &atlases, &p1, &p2) };
        Emitter { tape, atlases, camera, wt, world_assets, world_state, sprite_state, opts, p1, p2, nodes, last_nodes: None,
                  bank_slot, unknown_slots, palrow_slot, palrow_note, node_counts,
                  aobj_index: HashMap::new(),
                  textures: OrderedMap::new(), cb_recs: OrderedMap::new(), blobs: BlobStore::default(), stats: Stats::default(), prof_rows: 0 }
    }

    // ---- LIVE FEED (added 2026-09-04, SUPERGUN). STRICTLY ADDITIVE: nothing above or below this
    // method changes, and no existing path calls it. `open` + `emit_row` behave exactly as before.
    //
    // Appends one already-decoded row and its per-clock side tables, repeating exactly the bookkeeping
    // `new()` does for them: `bank_slot` is fed from the row nodes, `node_counts` gets the PRISTINE count
    // (the torn guard reads only that, so its verdict stays a pure function of what was pushed), and both
    // `tape.nodes` and the emitter own `nodes` copy are kept in step.
    //
    // Deliberately NOT recomputed per push, because they are whole-tape properties that `new()` derives
    // once and a live feed cannot improve on incrementally: `unknown_slots`, `palrow_slot`/`palrow_note`
    // and `world_state`. A live session therefore inherits them from the tape it was opened with, which
    // is why the live path is opened on a representative seed tape rather than an empty one.
    pub fn push_live_row(&mut self, row: Value, clock: u32, nodes: Option<Vec<Node>>,
                         anodes: Option<Vec<crate::tape::ANode>>, palrows: Option<crate::tape::PalRows>,
                         aobjs: Option<&[Vec<crate::tape::ObjRec>]>) -> usize {
        if let Some(ns) = nodes {
            for n in &ns { if n.kind == 0 && n.gfx1 != 0 { self.bank_slot.insert(n.gfx1, n.slot); } }
            self.node_counts.insert(clock, ns.len());
            self.tape.nodes.insert(clock, ns.clone());
            self.nodes.insert(clock, ns);
        }
        // MERGE the pushed chunk's object table into the session's BY CONTENT, then rewrite this
        // chunk's node indices into the session namespace. Without this the indices below are
        // chunk-local and address the seed tape's objects instead -- see `aobj_index`.
        let remap: Option<Vec<u16>> = aobjs.map(|chunk| {
            if self.aobj_index.is_empty() && !self.tape.aobjs.is_empty() {
                // Seed the index from whatever `open` already loaded, so a chunk object that is
                // byte-identical to a seed object reuses the seed's slot instead of growing the table.
                for (i, o) in self.tape.aobjs.iter().enumerate() {
                    if i > u16::MAX as usize { break; }
                    self.aobj_index.entry(aobj_hash(o)).or_insert(i as u16);
                }
            }
            chunk.iter().map(|o| {
                let h = aobj_hash(o);
                if let Some(&i) = self.aobj_index.get(&h) { return i; }
                // 0xFFFF is the tape's own no-object sentinel, and `world.rs` bounds-checks against
                // `tape.aobjs.len()`, so a saturated table degrades to SKIPPING the node rather than
                // aliasing it onto an unrelated object.
                if self.tape.aobjs.len() >= u16::MAX as usize { return u16::MAX; }
                let i = self.tape.aobjs.len() as u16;
                self.tape.aobjs.push(o.clone());
                self.aobj_index.insert(h, i);
                i
            }).collect()
        });
        if let Some(mut a) = anodes {
            if let Some(map) = &remap {
                for nd in a.iter_mut() {
                    nd.obj = map.get(nd.obj as usize).copied().unwrap_or(u16::MAX);
                }
            }
            self.tape.anodes.insert(clock, a);
        }
        if let Some(pr) = palrows { self.tape.palrows.insert(clock, pr); }
        self.tape.frames.push(row);
        self.tape.frames.len() - 1
    }

    pub fn world_enabled(&self) -> bool { self.world_assets.is_some() }
    pub fn prop_stats(&self) -> BTreeMap<i64, (usize, usize)> { self.world_state.as_ref().map(|w| w.prop_stats.clone()).unwrap_or_default() }

    fn team_cid(&self, slot: u8) -> Option<u8> {
        let team = if slot % 2 == 0 { &self.p1 } else { &self.p2 };
        team.get((slot / 2) as usize).copied()
    }

    /// One tape row -> one frame. Mirrors the body of `for r in rows:` in main().
    pub fn emit_row(&mut self, row: usize) -> Option<Frame> {
        use crate::util::prof;
        let mut tick = prof::now();
        let r = self.tape.frames.get(row)?.clone();
        let fr_clock = self.tape.num(&r, "frame").unwrap_or(0.0) as i64;
        let frc = fr_clock as u32;
        let mut ctx = FrameCtx { verts: VbSegs::default(), idxs: IbSegs::default(), draws: Vec::new(),
                                 blobs: std::mem::take(&mut self.blobs),
                                 textures: std::mem::take(&mut self.textures), cb_recs: std::mem::take(&mut self.cb_recs),
                                 stats: std::mem::take(&mut self.stats), sub_seq: 0, last_cull: None };

        // ── FRAME PREAMBLE (three clear quads)
        if self.world_assets.is_some() && !self.opts.no_preamble { world::emit_preamble(&mut ctx, &self.wt, &self.tape, &r); }
        prof::lap("preamble", &mut tick);

        // ── the ordered items (bodies AND objects)
        let have_nodes = !self.nodes.is_empty();
        let mut pre: Vec<PreItem> = Vec::new();
        if have_nodes {
            let cur_len = self.nodes.get(&frc).map(|c| c.len());
            // TORN DRAW-LIST GUARD. The agent walks the engine's draw list while the game may be rebuilding it, so a
            // row can carry a truncated PREFIX of the real list. Such a row must be held, not drawn.
            //
            // The original test was ABSOLUTE -- `n < 2` -- which catches only a total collapse. On prod tape
            // ..._59618234 row 851 the list goes 24 -> 2 -> 24 and was drawn: every effect and one fighter vanish for
            // exactly one frame and come back. That is a visible pop and it reads as "shaky".
            //
            // The test is now RELATIVE, and additive: a row is torn if the old rule says so, OR if it holds less than
            // 1/TORN_FACTOR of what BOTH of its neighbours agree on. RECOVERY is the discriminator -- no engine event
            // removes draws and restores them inside one 1/60 s frame, whereas a legitimate shrink (a super's effects
            // ending, a KO) PERSISTS into the next row and so is never held. The forward scan steps over a run of
            // consecutive torn rows to find that recovery, bounded by TORN_SCAN.
            //
            // TORN_FACTOR = 2 is a stated MARGIN, not a fit: the row must hold less than half of the agreed size.
            // TORN_SCAN = 8 is the engine's own rollback horizon (GGPO MAX_PREDICTION_FRAMES); a collapse that has not
            // recovered by then is not a single-poll capture artefact and is left alone.
            // Counts come from `node_counts`, a snapshot of the PRISTINE tape taken in `new()`, so the decision cannot
            // see an earlier row's substitution -- unlike `self.nodes`, which this guard mutates. The verdict for a row
            // therefore depends only on the tape, never on the order rows were requested (seeking is now safe here).
            // `--legacy-torn-guard` / `{"legacy_torn_guard":true}` restores the absolute test exactly.
            let torn = match (cur_len, &self.last_nodes) {
                (Some(n), Some(l)) => {
                    n < 2 && l.len() >= 3 || !self.opts.legacy_torn_guard && {
                        let prev = l.len();
                        let mut nxt = None;
                        for k in 1..=TORN_SCAN {
                            let Some(r2) = self.tape.frames.get(row + k) else { break };
                            let c2 = self.tape.num(r2, "frame").unwrap_or(0.0) as u32;
                            if let Some(&m) = self.node_counts.get(&c2) {
                                if m * TORN_FACTOR >= prev { nxt = Some(m); break; }
                            }
                        }
                        nxt.map(|m| n * TORN_FACTOR < prev.min(m)).unwrap_or(false)
                    }
                }
                _ => false,
            };
            if cur_len.is_none() || torn {
                let k = match cur_len {
                    None => "no nodes".to_string(),
                    Some(n) if n < 2 && self.last_nodes.as_ref().map(|l| l.len() >= 3).unwrap_or(false) => format!("torn ({} node)", n),
                    Some(n) => format!("torn ({} of {} nodes)", n, self.last_nodes.as_ref().map(|l| l.len()).unwrap_or(0)),
                };
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
                pre.push((cid, nd.sid & 0x7FFF, nd.fsx as f64, nd.fsy as f64, mir, if nd.kind == 0 { "body" } else { "obj" }, nd.pal as i64,
                          nd.sid & 0x8000 != 0, nd.angle, (nd.hotx, nd.hoty), si as i64, Some(nd.depth),
                          if nd.kind == 0 { nd.slot as i64 } else { owner as i64 }, 0));
            }
        } else {
            // v2 tapes: the six fighter columns; the pre-decoded local `objs` list form is not ported
            let tape = &self.tape;
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
                pre.push((cid, (sid_raw & 0x7FFF) as u16, sx.get(slot).copied().unwrap_or(0.0), sy.get(slot).copied().unwrap_or(0.0),
                          facing.get(slot).copied().unwrap_or(0.0) != 0.0, "body", tape.costume.get(slot).copied().unwrap_or(0),
                          sid_raw & 0x8000 != 0, 0, (0, 0), 0, None, -1, lay));
            }
            pre.sort_by_key(|it| (it.13, if it.5 == "body" { 0 } else { 1 }));
        }
        let items: Vec<Item> = pre.into_iter().map(|(cid, sid, tsx, tsy, mir, kind, cos, bit15, angle, hot, walk, depth, pslot, layer)| Item {
            layer, at: self.atlases.get(&cid), sid, tsx, tsy, mir, kind, cos, bit15, angle, hot, walk, depth, pslot, pframe: frc,
        }).collect();

        // slot 3 during the sprite walk = the world camera P
        let ps: Option<[[f32; 4]; 4]> = self.camera.as_ref().and_then(|cm| {
            let (ex, ey) = (self.tape.num(&r, "eyeX").unwrap_or(0.0), self.tape.num(&r, "eyeY").unwrap_or(0.0));
            cm.scene_block((ex, ey), "list6").map(|b| scene_p(&b))
        });

        // ── stage + world lists 5/6/12/13: behind the sprites
        prof::lap("items", &mut tick);
        if let (Some(assets), Some(cm), Some(ws)) = (&self.world_assets, &self.camera, self.world_state.as_mut()) {
            world::emit_world(&mut ctx, &self.wt, cm, assets, ws, &self.tape, &r, frc, &[5, 6, 12, 13]);
        }
        prof::lap("world 5/6/12/13", &mut tick);
        // ── the sprites
        emit_sprites(&self.tape, &self.opts, &self.sprite_state, have_nodes, &mut ctx, items, ps, &self.palrow_slot);
        prof::lap("sprites", &mut tick);
        // ── effects/shadows/markers after the sprites, the HUD last
        if let (Some(assets), Some(cm), Some(ws)) = (&self.world_assets, &self.camera, self.world_state.as_mut()) {
            world::emit_world(&mut ctx, &self.wt, cm, assets, ws, &self.tape, &r, frc, &[7, 8, 9]);
            world::emit_world(&mut ctx, &self.wt, cm, assets, ws, &self.tape, &r, frc, &[11]);
        }
        prof::lap("world 7/8/9/11", &mut tick);
        order_draws(&mut ctx.draws, self.opts.legacy_order, &mut ctx.stats.order);
        prof::lap("order", &mut tick);
        self.prof_rows += 1;
        if prof::on() && self.prof_rows % 60 == 0 { eprintln!("[prof] {} rows: {}", self.prof_rows, prof::report(self.prof_rows)); }
        world::fold_world_stats(&mut ctx);
        prof::lap("row:fold", &mut tick);
        ctx.stats.drawn_total += ctx.draws.len() as u64;
        let fr = Frame { frame: fr_clock, verts: ctx.verts, idxs: ctx.idxs, draws: ctx.draws };
        self.textures = ctx.textures; self.cb_recs = ctx.cb_recs; self.blobs = ctx.blobs; self.stats = ctx.stats;
        Some(fr)
    }
}

/// The sprite quad loop of main() (`for lay, at, sid, tsx, tsy, mir, kind, cos, extra in items:`).
fn emit_sprites(tape: &Tape, opts: &EmitOpts, sprite_state: &crate::state::StateRc, have_nodes: bool, ctx: &mut FrameCtx, items: Vec<Item>, ps: Option<[[f32; 4]; 4]>,
                prslot: &[usize; 6]) {
    {
        let v3pals = &tape.pals;
        for it in items {
            let at = match it.at { Some(a) => a, None => { *ctx.stats.missing.entry("no atlas".into()).or_insert(0) += 1; continue; } };
            let recs = match at.asm.get(&(it.sid as u32)) { Some(r) if !r.is_empty() => r, _ => {
                *ctx.stats.missing.entry(format!("{} {} sel {}", at.name, it.kind, it.sid)).or_insert(0) += 1; continue; } };
            let ox = floor_mul(it.tsx, TAPE_X);
            let oy = floor_mul(it.tsy, TAPE_Y);
            let mir = if opts.flip_facing { !it.mir } else { it.mir };

            let mut prow = None;
            if !tape.palrows.is_empty() && opts.bank.is_none() && (0..6).contains(&it.pslot) {
                let pf = it.pframe as i64;
                let mut lag = opts.pal_lag as i64;
                while lag >= 0 {
                    if let Some(p) = tape.palrows.get(&((pf - lag) as u32)) { prow = Some(p); break; }
                    lag -= 1;
                }
            }
            let zero: Pal256 = [[0u8; 4]; 256];
            // fighter slot -> palrow BLOCK (identity unless the tape proves otherwise; `resolve_palrow_slots`)
            let pblk = if (0..6).contains(&it.pslot) { prslot[it.pslot as usize] } else { it.pslot.max(0) as usize };
            let (base_pal, blk_base): (Pal256, Option<i64>) = if let Some(p) = prow {
                let ps_ = pblk * 8;
                let pi = p.idx[ps_] as usize;
                let bp = if pi < v3pals.len() { v3pals[pi] } else {
                    match v3pals.get(it.cos as usize) { Some(x) => *x, None => { *ctx.stats.missing.entry("pal index out of range".into()).or_insert(0) += 1; zero } } };
                (bp, None)
            } else if have_nodes && opts.bank.is_none() && it.cos >= 0 && (it.cos as usize) < v3pals.len() {
                let bp = v3pals[it.cos as usize];
                let mut blk = None;
                for (bi, bk) in at.banks.iter().enumerate() {
                    let all = (0..16).all(|i| bk.get(i).map(|c| *c == bp[i]).unwrap_or(false));
                    if all { blk = Some((bi - bi % 8) as i64); break; }
                }
                (bp, blk)
            } else {
                (at.palette(opts.bank, it.cos), None)
            };
            // cloud skin: replace the 16 base colours of this slot's row 0 (alpha kept: index 0 stays transparent)
            let base_pal: Pal256 = match (0..6).contains(&it.pslot).then(|| opts.skins[it.pslot as usize]).flatten() {
                Some(sk) => { let mut p = base_pal; for i in 0..16 { let c = sk[i]; p[i] = [((c >> 16) & 255) as u8, ((c >> 8) & 255) as u8, (c & 255) as u8, p[i][3]]; } p }
                None => base_pal,
            };
            let mut pal_cache: HashMap<u8, Pal256> = HashMap::new();
            let pal_for_row = |row: u8, pal_cache: &mut HashMap<u8, Pal256>| -> Pal256 {
                if let Some(p) = prow {
                    if row == 0 { return base_pal; }
                    let pi = p.idx[pblk * 8 + (row & 7) as usize] as usize;
                    return if pi < v3pals.len() { v3pals[pi] } else { base_pal };
                }
                match blk_base {
                    Some(b) if row != 0 && b + (row as i64) < at.banks.len() as i64 => {
                        *pal_cache.entry(row).or_insert_with(|| at.palette(Some(b + row as i64), 0))
                    }
                    _ => base_pal,
                }
            };

            let order: Vec<usize> = if opts.forward_records { (0..recs.len()).collect() } else { (0..recs.len()).rev().collect() };
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
                let (mut bmp, pw, ph) = match at.part_bitmap(pid, !opts.no_vflip, it.bit15) { Some(x) => x, None => continue };
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
                let z: f32 = match (it.depth, ps, opts.legacy_order) {
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
                                      state: sprite_state.0.clone(), state_fp: sprite_state.1, vscb: None, pscb: None,
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
    // (2026-09-03 perf) partition by MOVE: the old filter+cloned deep-copied every cat 0/1 draw (state map + strings)
    let (mut phase1, mut phase3): (Vec<Draw>, Vec<Draw>) = all.into_iter().partition(|d| d.cat == 0 || d.cat == 1);
    phase1.sort_by(|a, b| (a.cat, a.sub).cmp(&(b.cat, b.sub)));
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
            if let Some(rs) = out[i - 1].state.get("raster").cloned() {
                std::rc::Rc::make_mut(&mut out[i].state).insert("raster".into(), rs);
                out[i].state_fp = crate::util::state_fp(&out[i].state);
            }
        }
        out[i].inherit_cull = false;
        *stats.entry(format!("cat {}", out[i].cat)).or_insert(0) += 1;
    }
    *draws = out;
}
