//! WORLD PASS (System A) -- `tape_to_seq.main`'s closures `emit_stage` / `emit_world`, `complete_prop`, the frame
//! PREAMBLE block, `sort_key_record`, ported verbatim. Assets (`WorldAssets`) are bytes the caller decoded: the
//! arc stage rip `STGxx.json` (+ its `STGxx_tNN.png` textures), the host-decoded stage pages
//! `tcw_pages/stage_XX/`, and the capture-derived TCW library `tcw_pages/index.json` (+ PNGs). No I/O here.
//!
//! f32 exactness: `sort_key_record` = numpy float32 `W @ V @ P` then `v @ M` (BLAS). Measured on 6,404 keys of the
//! stage-13 clip: the 4x4 products are reproduced by sequential FMA accumulation (6404/6404 full matrices) and the
//! row-vector product by the even/odd lane order `(a0*b0 + a2*b2) + (a1*b1 + a3*b3)` (6404/6404; the naive
//! left-to-right order misses 5).
use crate::bg;
use crate::camera::{scene_p, scene_v, CameraModel};
use crate::sprites::{Draw, FrameCtx, STRIDE};
use crate::state::{predict, WorldTemplate};
use crate::tape::{ANode, ObjRec, Page, Tape};
use crate::util::sha8;
use serde_json::{Map, Value};
use std::collections::HashMap;

/// One vertex of an arc mesh triangle (`STGxx.json` `tris[][]`: pos, uv, optional col).
#[derive(Clone, Debug)]
pub struct StageVtx { pub pos: [f64; 3], pub uv: [f64; 2], pub col: Option<[i64; 4]> }

#[derive(Clone, Debug)]
pub struct StageMesh {
    pub model: i64, pub placed: bool, pub tex_index: i64, pub is_opaque: bool,
    pub tris: Vec<[StageVtx; 3]>,
    pub center: Option<[f64; 3]>, pub radius: Option<f64>,
    pub base_params: Option<i64>, pub tex_instr: Option<i64>, pub tsp: Option<i64>,
    pub color: Option<[f64; 3]>, pub alpha: Option<f64>,
}

pub struct StageRip {
    pub stage_id: i64,
    pub meshes: Vec<StageMesh>,
    pub texture_files: Vec<String>,
    /// `STGxx_tNN.png` decoded RGBA per texture index (the caller fills what exists; the WRONG rip_stage decode,
    /// used only when no host-decoded page exists -- exactly the Python fallback)
    pub tex_pages: Vec<Option<Page>>,
}

impl StageRip {
    /// `json.load(open(STAGE_DIR/STGxx.json))`
    pub fn from_json(bytes: &[u8]) -> Result<StageRip, String> {
        let v: Value = serde_json::from_slice(bytes).map_err(|e| format!("stage json: {e}"))?;
        let f3 = |x: &Value| x.as_array().map(|a| [a.get(0).and_then(|y| y.as_f64()).unwrap_or(0.0), a.get(1).and_then(|y| y.as_f64()).unwrap_or(0.0), a.get(2).and_then(|y| y.as_f64()).unwrap_or(0.0)]);
        let mut meshes = Vec::new();
        for m in v.get("meshes").and_then(|x| x.as_array()).map(|a| a.iter()).into_iter().flatten() {
            let mut tris = Vec::new();
            for t in m.get("tris").and_then(|x| x.as_array()).map(|a| a.iter()).into_iter().flatten() {
                let ta = match t.as_array() { Some(a) if a.len() == 3 => a, _ => continue };
                let vx = |x: &Value| StageVtx {
                    pos: x.get("pos").and_then(f3).unwrap_or([0.0; 3]),
                    uv: x.get("uv").and_then(|u| u.as_array()).map(|a| [a.get(0).and_then(|y| y.as_f64()).unwrap_or(0.0), a.get(1).and_then(|y| y.as_f64()).unwrap_or(0.0)]).unwrap_or([0.0; 2]),
                    col: x.get("col").and_then(|c| c.as_array()).map(|a| [a.get(0).and_then(|y| y.as_i64()).unwrap_or(0), a.get(1).and_then(|y| y.as_i64()).unwrap_or(0), a.get(2).and_then(|y| y.as_i64()).unwrap_or(0), a.get(3).and_then(|y| y.as_i64()).unwrap_or(0)]),
                };
                tris.push([vx(&ta[0]), vx(&ta[1]), vx(&ta[2])]);
            }
            meshes.push(StageMesh {
                model: m.get("model").and_then(|x| x.as_i64()).unwrap_or(0),
                placed: m.get("placed").and_then(|x| x.as_bool()).unwrap_or(true),
                tex_index: m.get("texIndex").and_then(|x| x.as_i64()).unwrap_or(255),
                is_opaque: m.get("isOpaque").and_then(|x| x.as_bool()).unwrap_or(true),
                tris,
                center: m.get("center").and_then(f3), radius: m.get("radius").and_then(|x| x.as_f64()),
                base_params: m.get("baseParams").and_then(|x| x.as_i64()), tex_instr: m.get("texInstr").and_then(|x| x.as_i64()),
                tsp: m.get("tsp").and_then(|x| x.as_i64()),
                color: m.get("color").and_then(f3), alpha: m.get("alpha").and_then(|x| x.as_f64()),
            });
        }
        let texture_files: Vec<String> = v.get("textures").and_then(|x| x.as_array())
            .map(|a| a.iter().map(|t| t.get("file").and_then(|f| f.as_str()).unwrap_or("").to_string()).collect()).unwrap_or_default();
        let n = texture_files.len();
        Ok(StageRip { stage_id: v.get("stageId").and_then(|x| x.as_i64()).unwrap_or(0), meshes, texture_files, tex_pages: vec![None; n] })
    }
}

/// Everything the world pass reads besides the tape (decoded by the driver; see the module doc).
pub struct WorldAssets {
    pub stage_rip: Option<StageRip>,
    /// host-decoded stage pages (`tcw_pages/stage_XX/index.json` order): (key, page)
    pub stage_preload: Vec<(String, Page)>,
    /// the TCW library `tcw_pages/index.json`: key -> decoded page (only entries whose file exists)
    pub lib_pages: HashMap<String, Page>,
}

/// Per-model arc meshes in first-seen order (Python `arc_models` dict).
pub struct ArcModels { pub order: Vec<i64>, pub by_model: HashMap<i64, Vec<usize>> }

impl ArcModels {
    pub fn build(rip: &StageRip) -> ArcModels {
        let mut a = ArcModels { order: Vec::new(), by_model: HashMap::new() };
        for (i, m) in rip.meshes.iter().enumerate() {
            if m.model != 0 && !m.tris.is_empty() {
                a.by_model.entry(m.model).or_insert_with(|| { a.order.push(m.model); Vec::new() }).push(i);
            }
        }
        a
    }
}

/// Python `round(x, 2)` (correctly rounded, ties-to-even on the exact binary value) as a set key; `-0.0 == 0.0`.
fn round2_key(x: f64) -> String {
    let s = format!("{:.2}", x);
    if s == "-0.00" { "0.00".to_string() } else { s }
}

/// `complete_prop(recs, arc_models, cache, oi)`: a list-5 object whose first record is an arc model's first mesh
/// (>= 90% vertex identity at 2 decimals) gets the model's remaining meshes appended as records.
pub fn complete_prop(recs: &[ObjRec], rip: &StageRip, arc: &ArcModels, cache: &mut HashMap<u16, Option<Vec<ObjRec>>>, oi: u16,
                     stats: &mut std::collections::BTreeMap<i64, (usize, usize)>) -> Option<Vec<ObjRec>> {
    if let Some(c) = cache.get(&oi) { return c.clone(); }
    let mut out: Option<Vec<ObjRec>> = None;
    let v0verts = recs.first().map(|r| r.verts()).unwrap_or_default();
    if !v0verts.is_empty() && !arc.order.is_empty() {
        let v0: std::collections::HashSet<(String, String, String)> = v0verts.iter()
            .map(|v| (round2_key(v[0] as f64), round2_key(v[1] as f64), round2_key(v[2] as f64))).collect();
        for &mi in &arc.order {
            let idxs = &arc.by_model[&mi];
            let m0 = &rip.meshes[idxs[0]];
            let s0: std::collections::HashSet<(String, String, String)> = m0.tris.iter().flat_map(|t| t.iter())
                .map(|v| (round2_key(v.pos[0]), round2_key(v.pos[1]), round2_key(v.pos[2]))).collect();
            if v0.is_empty() || s0.is_empty() || (v0.intersection(&s0).count() as f64) / (v0.len() as f64) < 0.9 { continue; }
            if idxs.len() > recs.len() {
                let r0 = &recs[0];
                let mut extra = Vec::new();
                for &k in &idxs[recs.len()..] {
                    let m = &rip.meshes[k];
                    let verts: Vec<[f32; 8]> = m.tris.iter().flat_map(|t| t.iter())
                        .map(|v| [v.pos[0] as f32, v.pos[1] as f32, v.pos[2] as f32, 0.0, 0.0, 0.0, v.uv[0] as f32, v.uv[1] as f32]).collect();
                    if verts.is_empty() { continue; }
                    let col = m.color.unwrap_or([1.0, 1.0, 1.0]);
                    let (ctr, rad) = match m.center {
                        Some(c) => (c, m.radius),
                        None => {
                            // vertex centroid + max distance, in f64 exactly as the Python (pos are the JSON floats)
                            let pts: Vec<[f64; 3]> = m.tris.iter().flat_map(|t| t.iter()).map(|v| v.pos).collect();
                            let n = pts.len() as f64;
                            let mut s = [0.0f64; 3];
                            for p in &pts { for k in 0..3 { s[k] += p[k]; } }
                            let c = [s[0] / n, s[1] / n, s[2] / n];
                            let r = pts.iter().map(|p| ((p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2) + (p[2] - c[2]).powi(2)).powf(0.5)).fold(f64::MIN, f64::max);
                            (c, Some(r))
                        }
                    };
                    let ti = m.tex_index;
                    extra.push(ObjRec {
                        tcw: (0xC10 + ti) as u32, key: format!("{:08X}", 0xC10 + ti),
                        pcw: m.base_params.map(|x| x as u32).unwrap_or(r0.pcw), isp: m.tex_instr.map(|x| x as u32).unwrap_or(r0.isp),
                        tsp: m.tsp.map(|x| x as u32).unwrap_or(r0.tsp), texnum: ti as i32,
                        colour: [m.alpha.unwrap_or(1.0) as f32, col[0] as f32, col[1] as f32, col[2] as f32],
                        groups: vec![(0x8, verts)], centre: Some(ctr), radius: rad.map(|r| r as f64),
                    });
                }
                let mut o = recs.to_vec();
                o.extend(extra);
                out = Some(o);
                stats.insert(mi, (recs.len(), idxs.len()));
            }
            break;
        }
    }
    cache.insert(oi, out.clone());
    out
}

// ── the float32 BLAS emulation (see the module doc) ─────────────────────────────────────────────────────
fn mm4(a: &[[f32; 4]; 4], b: &[[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut o = [[0f32; 4]; 4];
    for i in 0..4 { for j in 0..4 {
        let mut acc = a[i][0] * b[0][j];
        for k in 1..4 { acc = a[i][k].mul_add(b[k][j], acc); }
        o[i][j] = acc;
    } }
    o
}

/// `sort_key_record(centre, radius, W16, V, P, hud)` = FUN_140843320: w of [centre 1] x W x V x P (x W x P for HUD).
pub fn sort_key_record(centre: Option<[f64; 3]>, radius: Option<f64>, w16: &[f32; 16], v: &[[f32; 4]; 4], p: &[[f32; 4]; 4], hud: bool) -> Option<f64> {
    let c = centre?;
    if let Some(r) = radius { if r < 0.0 { return Some(-r); } }
    let mut w = [[0f32; 4]; 4];
    for i in 0..4 { for j in 0..4 { w[i][j] = w16[i * 4 + j]; } }
    let m = if hud { mm4(&w, p) } else { mm4(&mm4(&w, v), p) };
    let a = [c[0] as f32, c[1] as f32, c[2] as f32, 1.0f32];
    let b = [m[0][3], m[1][3], m[2][3], m[3][3]];
    let key = (a[0] * b[0] + a[2] * b[2]) + (a[1] * b[1] + a[3] * b[3]);
    Some(key as f64)
}

/// The per-frame state the world closures share (`tape_pages`, `arc_models`, `prop_cache`, `stage_geo`).
pub struct WorldState {
    pub tape_pages: HashMap<String, Page>,
    pub arc: Option<ArcModels>,
    pub prop_cache: HashMap<u16, Option<Vec<ObjRec>>>,
    pub prop_stats: std::collections::BTreeMap<i64, (usize, usize)>,
    /// deck cache (2026-09-03): keyed by the deck colour bits; the deck's vertex bytes and per-mesh metadata do not
    /// depend on the frame, so they are built once and memcpy'd per frame (was 95% of the frame: 28 of 30 ms).
    pub deck_cache: Option<(u64, DeckCache)>,
}

pub struct DeckGeo { pub first_rel: u32, pub nv: u32, pub tkey: String, pub page: Page, pub opaque: bool, pub centre: [f64; 3], pub radius: Option<f64>, pub hdr: (Option<i64>, Option<i64>, Option<i64>), pub centroid_note: bool }
pub struct DeckCache { pub verts: Vec<u8>, pub geo: Vec<DeckGeo>, pub missing: Vec<(usize, i64)> }

impl WorldState {
    pub fn new(assets: &WorldAssets, tape: &Tape) -> WorldState {
        let mut tape_pages = HashMap::new();
        for (k, p) in &assets.stage_preload { tape_pages.entry(k.clone()).or_insert_with(|| p.clone()); }
        for (k, p) in &tape.pages { tape_pages.insert(k.clone(), p.clone()); }
        WorldState { deck_cache: None, tape_pages, arc: assets.stage_rip.as_ref().map(ArcModels::build), prop_cache: HashMap::new(), prop_stats: Default::default() }
    }
}

fn add_texture(ctx: &mut FrameCtx, tkey: &str, page: &Page) {
    if !ctx.textures.contains(tkey) { ctx.textures.insert_new(tkey, Page { w: page.w, h: page.h, fmt: page.fmt, data: page.data.clone() }); }
}

fn cb_setdefault(ctx: &mut FrameCtx, h: &str, b: &[u8]) {
    if !ctx.cb_recs.contains(h) { ctx.cb_recs.insert_new(h, b.to_vec()); }
}

fn deck_pscb(ctx: &mut FrameCtx, wt: &WorldTemplate, ps_variant: &str, hs: &str) -> [Option<String>; 4] {
    let bufs = wt.pscb.get(ps_variant).cloned().unwrap_or_default();
    let hashes: Vec<Option<String>> = bufs.iter().map(|b| b.as_ref().map(|x| sha8(x))).collect();
    for b in bufs.iter().flatten() { cb_setdefault(ctx, &sha8(b), b); }
    [hashes.first().cloned().flatten(), Some(hs.to_string()), hashes.get(2).cloned().flatten(), None]
}

/// The FRAME PREAMBLE block of main(): three full-screen quads (host clear, FUN_140843eb0 background, depth clear).
pub fn emit_preamble(ctx: &mut FrameCtx, wt: &WorldTemplate, tape: &Tape, r: &Value) {
    if wt.preamble.is_empty() { return; }
    let bg = match bg::from_row(tape, r, tape.stage_id, &mut ctx.stats.bg_stats) {
        Some(c) => c,
        None => { *ctx.stats.bg_stats.entry("no colour (mode outside 0..3 / no table entry) -> black".into()).or_insert(0) += 1; (0, 0, 0) }
    };
    let bcols = bg::vertex_colours(bg);
    let mut q28 = Vec::new();
    for (x, y) in [(-1.0f32, 1.0f32), (1.0, 1.0), (-1.0, -1.0), (1.0, -1.0)] {
        for f in [x, y, 1.0, 0.0] { q28.extend_from_slice(&f.to_le_bytes()); }
        q28.extend_from_slice(&[0u8; 12]);
    }
    let mut q40 = Vec::new();
    for ((x, y), c) in [(-1.0f32, 1.0f32), (-1.0, -1.0), (1.0, 1.0), (1.0, -1.0)].iter().zip(bcols.iter()) {
        for f in [*x, *y, 1.0, 0.0] { q40.extend_from_slice(&f.to_le_bytes()); }
        q40.extend_from_slice(&0.0f32.to_le_bytes()); q40.extend_from_slice(&1.0f32.to_le_bytes());
        q40.extend_from_slice(c); q40.extend_from_slice(&[0u8; 4]);
        q40.extend_from_slice(&0.0f32.to_le_bytes()); q40.extend_from_slice(&0.0f32.to_le_bytes());
    }
    if !ctx.textures.contains("bg_white") {
        ctx.textures.insert_new("bg_white", Page { w: 1, h: 1, fmt: 28, data: vec![255, 255, 255, 255] });
    }
    let voffs = [0u32, q28.len() as u32, (q28.len() + q40.len()) as u32];
    ctx.verts.extend_from_slice(&q28); ctx.verts.extend_from_slice(&q40); ctx.verts.extend_from_slice(&q28);
    let pad = (STRIDE - ctx.verts.len() % STRIDE) % STRIDE;
    ctx.verts.extend(std::iter::repeat(0u8).take(pad));
    for (k, d0) in wt.preamble.iter().enumerate() {
        if let Some(cbs) = wt.preamble_cb.get(k) { for (h, b) in cbs { cb_setdefault(ctx, h, b); } }
        let fi = ctx.idxs.len() as u32;
        ctx.idxs.extend_from_slice(&[0, 1, 2, 2, 1, 3]);
        let stride = d0.get("stride").and_then(|x| x.as_u64()).unwrap_or(28) as u32;
        ctx.draws.push(Draw {
            first_index: fi, index_count: 6, stride, voff: voffs[k],
            tex: [if k >= 1 { Some("bg_white".to_string()) } else { None }, None],
            state: d0.clone(), vscb: None, pscb: None,
            cat: 0, key: None, sub: (-1, k as i64, 0), inherit_cull: false,
        });
    }
}

fn cam_of(tape: &Tape, r: &Value) -> (f64, f64) {
    (tape.num(r, "eyeX").unwrap_or(0.0), tape.num(r, "eyeY").unwrap_or(0.0))
}


/// Build the deck's vertex bytes + per-mesh metadata for one deck colour (the old per-frame loop, arithmetic verbatim).
fn build_deck_cache(ws: &mut WorldState, rip: &StageRip, deck_col: (f64, f64, f64)) -> DeckCache {
    let mut verts: Vec<u8> = Vec::new();
    let mut geo: Vec<DeckGeo> = Vec::new();
    let mut missing: Vec<(usize, i64)> = Vec::new();
    for (mi, mesh) in rip.meshes.iter().enumerate() {
        if mesh.model != 0 || !mesh.placed || mesh.tris.is_empty() { continue; }
        let ti = mesh.tex_index;
        let mut key = format!("{:08X}", 0xC10 + ti);
        let mut page = ws.tape_pages.get(&key).cloned();
        if page.is_none() && ti >= 0 && (ti as usize) < rip.texture_files.len() {
            if let Some(Some(p)) = rip.tex_pages.get(ti as usize) { page = Some(p.clone()); ws.tape_pages.insert(key.clone(), p.clone()); }
        }
        if page.is_none() && ti == 255 {
            key = "FLAT_WHITE".to_string();
            page = Some(ws.tape_pages.entry(key.clone()).or_insert_with(|| Page { w: 1, h: 1, fmt: 28, data: vec![255, 255, 255, 255] }).clone());
        }
        let page = match page { Some(p) => p, None => { missing.push((mi, ti as i64)); continue; } };
        let tkey = format!("world_{}", key);
        let first_rel = (verts.len() / STRIDE) as u32;
        let mut nv = 0u32;
        for tri in &mesh.tris {
            for vtx in tri.iter() {
                let c = vtx.col.unwrap_or([255, 255, 255, 255]);
                let c = [((c[0] as f64 * deck_col.0) as i64).min(255), ((c[1] as f64 * deck_col.1) as i64).min(255), ((c[2] as f64 * deck_col.2) as i64).min(255), c[3]];
                for f in [vtx.pos[0] as f32, vtx.pos[1] as f32, vtx.pos[2] as f32, 0.0] { verts.extend_from_slice(&f.to_le_bytes()); }
                verts.extend_from_slice(&0.0f32.to_le_bytes()); verts.extend_from_slice(&0.0f32.to_le_bytes());
                verts.extend_from_slice(&[c[0] as u8, c[1] as u8, c[2] as u8, c[3] as u8]);
                verts.extend_from_slice(&[0, 0, 0, 0]);
                verts.extend_from_slice(&(vtx.uv[0] as f32).to_le_bytes()); verts.extend_from_slice(&(vtx.uv[1] as f32).to_le_bytes());
                nv += 1;
            }
        }
        let (centre, radius, centroid_note) = match mesh.center {
            Some(c) => (c, mesh.radius, false),
            None => {
                let pts: Vec<[f64; 3]> = mesh.tris.iter().flat_map(|t| t.iter()).map(|v| v.pos).collect();
                let n = pts.len() as f64;
                let mut s = [0.0f64; 3];
                for p in &pts { for k in 0..3 { s[k] += p[k]; } }
                ([s[0] / n, s[1] / n, s[2] / n], None, true)
            }
        };
        geo.push(DeckGeo { first_rel, nv, tkey, page, opaque: mesh.is_opaque, centre, radius, hdr: (mesh.base_params, mesh.tex_instr, mesh.tsp), centroid_note });
    }
    DeckCache { verts, geo, missing }
}

/// `emit_stage(cam, deck_col)`: the arc deck (model 0 at identity) through the world path.
pub fn emit_stage(ctx: &mut FrameCtx, wt: &WorldTemplate, cm: &CameraModel, ws: &mut WorldState, rip: &StageRip, cam: (f64, f64), deck_col: (f64, f64, f64)) {
    struct Geo { fi: u32, nv: u32, tkey: String, opaque: bool, centre: [f64; 3], radius: Option<f64>, hdr: (Option<i64>, Option<i64>, Option<i64>) }
    let ckey = (deck_col.0.to_bits() ^ deck_col.1.to_bits().rotate_left(21) ^ deck_col.2.to_bits().rotate_left(42)) as u64;
    if ws.deck_cache.as_ref().map_or(true, |(k, _)| *k != ckey) {
        ws.deck_cache = Some((ckey, build_deck_cache(ws, rip, deck_col)));
    }
    let cache = &ws.deck_cache.as_ref().unwrap().1;
    for (mi, ti) in &cache.missing { *ctx.stats.world_missing.entry(format!("stage mesh {}: no texture {}", mi, ti)).or_insert(0) += 1; }
    let base = (ctx.verts.len() / STRIDE) as u32;
    ctx.verts.extend_from_slice(&cache.verts);
    let mut stage_geo: Vec<Geo> = Vec::with_capacity(cache.geo.len());
    for g in &cache.geo {
        add_texture(ctx, &g.tkey, &g.page);
        let fi = ctx.idxs.len() as u32;
        ctx.idxs.extend(base + g.first_rel..base + g.first_rel + g.nv);
        if g.centroid_note { *ctx.stats.world_missing.entry("deck mesh: sort centre from the vertex centroid (rip lacks the header sphere)".to_string()).or_insert(0) += 1; }
        stage_geo.push(Geo { fi, nv: g.nv, tkey: g.tkey.clone(), opaque: g.opaque, centre: g.centre, radius: g.radius, hdr: g.hdr });
    }
    let mut ident = Vec::with_capacity(48);
    for f in [1.0f32, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0] { ident.extend_from_slice(&f.to_le_bytes()); }
    let scb = match cm.scene_block(cam, "list6") { Some(b) => b, None => return };
    let (hw, hs) = (sha8(&ident), sha8(&scb));
    cb_setdefault(ctx, &hw, &ident); cb_setdefault(ctx, &hs, &scb);
    let (vd, pd) = (scene_v(&scb), scene_p(&scb));
    let ident16: [f32; 16] = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
    for g in stage_geo {
        let (mut d, ps_variant) = if g.hdr.2.is_some() {
            let mut pred = predict(g.hdr.0.unwrap_or(0) as u32, g.hdr.1.unwrap_or(0) as u32, g.hdr.2.unwrap_or(0) as u32, 0, 2, 1.0);
            pred.cull = None;
            wt.select(&pred, &mut ctx.stats.world_state)
        } else {
            let mut psv = if g.opaque { "opaque".to_string() } else { "texalpha".to_string() };
            if !wt.draw.contains(&psv) { psv = wt.draw.keys.first().cloned().unwrap_or_default(); }
            (wt.draw.get(&psv).cloned().unwrap_or_default(), psv)
        };
        let pscb = deck_pscb(ctx, wt, &ps_variant, &hs);
        let ltype = match g.hdr.0 { Some(h) => (h >> 24) & 7, None => if g.opaque { 0 } else { 2 } };
        let cat = if ltype == 0 { 0 } else if ltype == 1 { 1 } else { 3 };
        let key = if cat == 3 { sort_key_record(Some(g.centre), g.radius, &ident16, &vd, &pd, false) } else { None };
        ctx.sub_seq += 1;
        d.remove("i");
        ctx.draws.push(Draw {
            first_index: g.fi, index_count: g.nv, stride: STRIDE as u32, voff: 0, tex: [Some(g.tkey), None],
            state: d, vscb: Some([Some(hw.clone()), Some(hs.clone()), None, None]), pscb: Some(pscb),
            cat, key, sub: (1, ctx.sub_seq, 0), inherit_cull: false,
        });
    }
}

/// `emit_world(lists)`: this frame's world nodes in `lists`, in list order (+ the deck when lists[0] == 5).
pub fn emit_world(ctx: &mut FrameCtx, wt: &WorldTemplate, cm: &CameraModel, assets: &WorldAssets, ws: &mut WorldState,
                  tape: &Tape, r: &Value, fr_clock: u32, lists: &[u8]) {
    let cam = cam_of(tape, r);
    let mut lists: Vec<u8> = lists.to_vec();
    let blackout = if tape.has_col("blackout") { tape.num(r, "blackout").unwrap_or(0.0) as i64 } else { 0 };
    if lists[0] == 5 {
        let deck_col = match tape.cell(r, "deck") {
            Some(v) if v.is_array() => { let a = tape.arr(r, "deck").unwrap_or_default(); (a.get(0).copied().unwrap_or(0.0), a.get(1).copied().unwrap_or(0.0), a.get(2).copied().unwrap_or(0.0)) }
            _ => (1.0, 1.0, 1.0),
        };
        if blackout == 0 {
            if let Some(rip) = &assets.stage_rip { emit_stage(ctx, wt, cm, ws, rip, cam, deck_col); }
        }
    }
    if tape.has_col("blackout") && blackout != 0 && lists.contains(&5) { lists.retain(|&l| l != 5); }
    let rows_w: Vec<ANode> = tape.anodes.get(&fr_clock).cloned().unwrap_or_default();
    for nd in &rows_w {
        if !lists.contains(&nd.list) || nd.obj as usize >= tape.aobjs.len() {
            if lists.contains(&nd.list) && nd.model != 0 { *ctx.stats.world_missing.entry(format!("3D model node (list {})", nd.list)).or_insert(0) += 1; }
            continue;
        }
        let variant = if nd.list == 11 || nd.list == 13 { "hud" } else if nd.list == 5 || nd.list == 6 || nd.list == 12 { "list6" } else { "list7" };
        let m = &nd.matrix;
        let mut cbw = Vec::with_capacity(48);
        for f in [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]] { cbw.extend_from_slice(&f.to_le_bytes()); }
        let scb = match cm.scene_block(cam, variant) { Some(b) => b, None => continue };
        let (vn, pn) = (scene_v(&scb), scene_p(&scb));
        let rank: i64 = match nd.list { 5 => 2, 6 => 3, 7 => 4, 8 => 5, 9 => 5, 11 => 6, 12 => 7, 13 => 6, _ => 8 };
        let (hw, hs) = (sha8(&cbw), sha8(&scb));
        cb_setdefault(ctx, &hw, &cbw); cb_setdefault(ctx, &hs, &scb);
        let own: Option<Vec<ObjRec>> = if nd.list == 5 {
            match (&assets.stage_rip, &ws.arc) {
                (Some(rip), Some(arc)) => { let mut pc = std::mem::take(&mut ws.prop_cache); let mut ps = std::mem::take(&mut ws.prop_stats);
                    let o = complete_prop(&tape.aobjs[nd.obj as usize], rip, arc, &mut pc, nd.obj, &mut ps); ws.prop_cache = pc; ws.prop_stats = ps; o }
                _ => None,
            }
        } else { None };
        let objrecs: &[ObjRec] = match &own { Some(o) => o, None => &tape.aobjs[nd.obj as usize] };
        for rec in objrecs {
            let key = &rec.key;
            let tkey = format!("world_{}", key);
            // (2026-09-03) look the page up ONLY when the texture is not registered yet: the old code cloned a full
            // 256 KB page per record per frame (~440 records/frame) before add_texture discarded it -- most of the frame.
            let mut page = if ctx.textures.contains(&tkey) { None } else { ws.tape_pages.get(key).cloned() };
            if page.is_none() && !ctx.textures.contains(&tkey) {
                if let Some(p) = assets.lib_pages.get(key) { page = Some(p.clone()); ws.tape_pages.insert(key.clone(), p.clone()); }
            }
            if page.is_none() && !ctx.textures.contains(&tkey) {
                if let Some(rip) = &assets.stage_rip {
                    if key.len() == 8 && key.chars().all(|c| c.is_ascii_alphanumeric()) {
                        if let Ok(v) = i64::from_str_radix(key, 16) {
                            let ti = v - 0xC10;
                            if ti >= 0 && (ti as usize) < rip.texture_files.len() {
                                if let Some(Some(p)) = rip.tex_pages.get(ti as usize) { page = Some(p.clone()); ws.tape_pages.insert(key.clone(), p.clone()); }
                            }
                        }
                    }
                }
            }
            if !ctx.textures.contains(&tkey) {
                let page = match page { Some(p) => p, None => { *ctx.stats.world_missing.entry(format!("no page for {}", key)).or_insert(0) += 1; continue; } };
                add_texture(ctx, &tkey, &page);
            }
            let kind: u32 = if nd.flags & 0x20 != 0 { 3 } else if nd.list == 11 || nd.list == 13 { 0 } else { 2 };
            let col = rec.colour;
            let cmul: (f64, f64, f64) = if nd.flags & 0x400 != 0 { (nd.colour[0] as f64, nd.colour[1] as f64, nd.colour[2] as f64) } else { (1.0, 1.0, 1.0) };
            let amult: f64 = if nd.flags & 0x20 != 0 { (nd.alpha as f64).min(1.0) } else { 1.0 };
            let cl = |x: f64| -> u8 { ((x as i64).max(0)).min(255) as u8 };
            let cbytes = [cl(col[1] as f64 * 255.0 * cmul.0), cl(col[2] as f64 * 255.0 * cmul.1), cl(col[3] as f64 * 255.0 * cmul.2), cl(col[0] as f64 * 255.0 * amult)];
            for (gflags, gverts) in &rec.groups {
                if gverts.is_empty() { continue; }
                let mut pred = predict(rec.pcw, rec.isp, rec.tsp, *gflags, kind, amult);
                if nd.flags & 0x2000 != 0 { pred.cull = ctx.last_cull; }
                else if pred.cull.is_some() { ctx.last_cull = pred.cull; }
                let (mut tdraw_w, ps_variant) = wt.select(&pred, &mut ctx.stats.world_state);
                let ltype = (rec.pcw >> 24) & 7;
                let mut cat: u8 = if ltype == 0 { 0 } else if ltype == 1 { 1 } else { 3 };
                if ltype == 0 && kind == 3 && amult < 1.0 { cat = 3; }
                let skey = if cat == 3 { sort_key_record(rec.centre, rec.radius, m, &vn, &pn, kind == 0) } else { None };
                if cat == 3 && skey.is_none() { *ctx.stats.world_missing.entry("record without a sort centre (synthetic tape)".into()).or_insert(0) += 1; }
                let first = (ctx.verts.len() / STRIDE) as u32;
                for v in gverts {
                    for f in [v[0], v[1], v[2], 0.0] { ctx.verts.extend_from_slice(&f.to_le_bytes()); }
                    ctx.verts.extend_from_slice(&v[3].to_le_bytes()); ctx.verts.extend_from_slice(&v[4].to_le_bytes());
                    ctx.verts.extend_from_slice(&cbytes);
                    ctx.verts.extend_from_slice(&[0, 0, 0, 0]);
                    ctx.verts.extend_from_slice(&v[6].to_le_bytes()); ctx.verts.extend_from_slice(&v[7].to_le_bytes());
                }
                let nv = gverts.len() as u32;
                let fi = ctx.idxs.len() as u32;
                ctx.idxs.extend(first..first + nv);
                let pscb = deck_pscb(ctx, wt, &ps_variant, &hs);
                ctx.sub_seq += 1;
                tdraw_w.remove("i");
                ctx.draws.push(Draw {
                    first_index: fi, index_count: nv, stride: STRIDE as u32, voff: 0, tex: [Some(tkey.clone()), None],
                    state: tdraw_w, vscb: Some([Some(hw.clone()), Some(hs.clone()), None, None]), pscb: Some(pscb),
                    cat, key: skey, sub: (rank, ctx.sub_seq, 0), inherit_cull: nd.flags & 0x2000 != 0,
                });
            }
        }
    }
}

/// Merge `world_missing` into `missing` with the 'world: ' prefix (end of the Python frame loop).
pub fn fold_world_stats(ctx: &mut FrameCtx) {
    let wm = std::mem::take(&mut ctx.stats.world_missing);
    for (k, v) in wm { *ctx.stats.missing.entry(format!("world: {}", k)).or_insert(0) += v; }
    let wsd = std::mem::take(&mut ctx.stats.world_state);
    for (k, v) in wsd { *ctx.stats.world_state_total.entry(k).or_insert(0) += v; }
}

/// Unused-warning guard for the JSON helpers shared with the driver.
pub fn _map_type(_: &Map<String, Value>) {}

#[cfg(test)]
mod tests {
    /// Python round(x, 2) on the exact binary value, ties-to-even: 0.125 -> 0.12, 0.375 -> 0.38, 2.675 -> 2.67
    /// (2.67499999...), 1.005 -> 1.0 (1.00499999...), -0.125 -> -0.12; -0.0 == 0.0.
    #[test]
    fn round2_matches_python() {
        let cases = [(0.125, "0.12"), (0.375, "0.38"), (2.675, "2.67"), (1.005, "1.00"), (-0.125, "-0.12"),
                     (586.94384765625, "586.94"), (0.4898437559604645, "0.49"), (-0.001, "0.00")];
        for (x, want) in cases { assert_eq!(super::round2_key(x), want, "round2_key({x})"); }
    }
}
