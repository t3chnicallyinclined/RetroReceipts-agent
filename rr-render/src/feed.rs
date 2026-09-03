//! FRAME FEED -- open(tape bytes, asset pack) -> frame(i) -> a binary FrameRecord the browser turns straight into
//! the `{head, slice}` shape `replay.mjs` / `resources.mjs` already consume. No JSON per draw; textures, constant
//! buffers and pipeline states are TABLES referenced by id and sent once (first use), so a page uploads every
//! texture exactly once for the whole tape.
//!
//! FrameRecord v1 (little-endian):
//!   "RRFR" u32 ver=1  i64 frame_clock
//!   u32 n_states   { u32 id, u32 len, json bytes }        pipeline state dict (the draw's template/world/preamble
//!                                                          state minus the per-draw keys), first use only
//!   u32 n_textures { u32 id, u32 w, u32 h, u32 fmt, u32 len, bytes }   first use only
//!   u32 n_cbs      { u32 id, u32 len, bytes }              constant buffers by content hash, first use only
//!   u32 vb_len bytes   u32 ib_len bytes
//!   u32 n_draws    { u32 state, u32 firstIndex, u32 indexCount, u32 stride, u32 voff,
//!                    i32 tex0, i32 tex1, i32 vscb[4], i32 pscb[4] }     (-1 = none)      60 B per draw
//! The JS side keys textures "T<id>" and constant buffers "C<id>" (ids are stable for the feed's lifetime).
use crate::pack::AssetPack;
use crate::seq::Template;
use crate::sprites::{Draw, EmitOpts, Emitter};
use crate::state::WorldTemplate;
use crate::tape::Tape;
use crate::util::Res;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub const FRAME_RECORD_VERSION: u32 = 1;
const PER_DRAW_KEYS: [&str; 8] = ["i", "firstIndex", "indexCount", "stride", "voff", "tex", "vscbHash", "pscbHash"];

pub struct FrameFeed {
    em: Emitter,
    tpl: Template,
    state_ids: HashMap<String, u32>,
    state_fp: HashMap<u64, u32>,
    tex_sent: usize,
    cb_ids: HashMap<String, u32>,
    template_cbs: HashMap<String, Vec<u8>>,
    pub log: Vec<String>,
}

impl FrameFeed {
    /// `python tape_to_seq.py <tape>` with the assets of `pack` (the whole tape; the caller picks frames).
    pub fn open(tape_bytes: &[u8], pack: &AssetPack, opts: EmitOpts) -> Res<FrameFeed> {
        let tape = Tape::decode(tape_bytes)?;
        let mut log = Vec::new();
        for need in ["drawn[6]", "sid[6]", "sx[6]", "sy[6]", "facing[6]"] {
            if !tape.has_col(need) { return Err(format!("this tape has no {need} column -- it predates tape v2")); }
        }
        let atlases = pack.atlases(&tape.p1_team, &tape.p2_team);
        log.push(format!("atlases {:?}", { let mut k: Vec<u8> = atlases.keys().copied().collect(); k.sort(); k }));
        let camera = pack.camera();
        if camera.is_none() { log.push("no camera_block.json in the pack: sprite depth keys use the Z0 ramp, world pass off".into()); }
        let world_on = !tape.anodes.is_empty() && !opts.no_world && camera.is_some();
        let world_assets = if world_on { Some(pack.world_assets(tape.stage_id, &mut log)) } else { None };
        let tpl = Template::frozen();
        let wt = WorldTemplate::frozen();
        let template_cbs: HashMap<String, Vec<u8>> = tpl.cbs.iter().cloned().collect();
        let em = Emitter::new(tape, atlases, camera, tpl.draw.clone(), wt, world_assets, opts);
        Ok(FrameFeed { em, tpl, state_ids: HashMap::new(), state_fp: HashMap::new(), tex_sent: 0, cb_ids: HashMap::new(), template_cbs, log })
    }

    pub fn frame_count(&self) -> usize { self.em.tape.frames.len() }
    pub fn tape(&self) -> &Tape { &self.em.tape }

    /// One-time session info for the player: what `loadSequence`'s meta + the first head carried.
    pub fn info_json(&self) -> String {
        let t = &self.em.tape;
        let mut il = self.tpl.input_layouts.as_object().cloned().unwrap_or_default();
        if self.em.world_enabled() { if let Some(w) = self.em.wt.input_layouts.as_object() { for (k, v) in w { il.insert(k.clone(), v.clone()); } } }
        let first_clock = t.frames.first().and_then(|r| t.num(r, "frame")).unwrap_or(0.0) as i64;
        json!({
            "version": FRAME_RECORD_VERSION, "frames": t.frames.len(), "first_clock": first_clock,
            "tape_ver": t.tape_ver, "agent": t.ver, "stage_id": t.stage_id, "p1_team": t.p1_team, "p2_team": t.p2_team,
            "world": self.em.world_enabled(), "viewport": self.tpl.viewport, "sceneRT": self.tpl.scene_rt,
            "inputLayouts": Value::Object(il), "log": self.log,
        }).to_string()
    }

    fn state_id(&mut self, d: &Draw, new_states: &mut Vec<(u32, String)>) -> u32 {
        // (2026-09-03 perf) fingerprint the state map WITHOUT cloning/serialising it: ~500 draws/frame were each
        // cloned + JSON-encoded just to look up an id (~10 ms/frame). Only an unseen fingerprint pays for the JSON.
        use std::hash::{Hash, Hasher};
        fn hv(v: &Value, h: &mut std::collections::hash_map::DefaultHasher) {
            match v {
                Value::Null => 0u8.hash(h),
                Value::Bool(b) => { 1u8.hash(h); b.hash(h) }
                Value::Number(n) => { 2u8.hash(h); if let Some(i) = n.as_i64() { i.hash(h) } else { n.as_f64().unwrap_or(0.0).to_bits().hash(h) } }
                Value::String(s) => { 3u8.hash(h); s.hash(h) }
                Value::Array(a) => { 4u8.hash(h); a.len().hash(h); for x in a { hv(x, h) } }
                Value::Object(m) => { 5u8.hash(h); m.len().hash(h); for (k, x) in m { k.hash(h); hv(x, h) } }
            }
        }
        let mut h = std::collections::hash_map::DefaultHasher::new();
        for (k, v) in &d.state { if PER_DRAW_KEYS.contains(&k.as_str()) { continue; } k.hash(&mut h); hv(v, &mut h); }
        let fp = h.finish();
        if let Some(&id) = self.state_fp.get(&fp) { return id; }
        let mut m: Map<String, Value> = d.state.clone();
        for k in PER_DRAW_KEYS { m.remove(k); }
        let js = Value::Object(m).to_string();
        let id = match self.state_ids.get(&js) { Some(&id) => id, None => {
            let id = self.state_ids.len() as u32;
            self.state_ids.insert(js.clone(), id);
            new_states.push((id, js));
            id
        } };
        self.state_fp.insert(fp, id);
        id
    }

    fn cb_id(&mut self, hash: Option<&str>, new_cbs: &mut Vec<(u32, Vec<u8>)>) -> i32 {
        let h = match hash { Some(h) if !h.is_empty() && h != "00000000" => h.to_string(), _ => return -1 };
        if let Some(&id) = self.cb_ids.get(&h) { return id as i32; }
        let bytes = match self.em.cb_recs.get(&h).cloned().or_else(|| self.template_cbs.get(&h).cloned()) { Some(b) => b, None => return -1 };
        let id = self.cb_ids.len() as u32;
        self.cb_ids.insert(h, id);
        new_cbs.push((id, bytes));
        id as i32
    }

    /// Emit row `i` of the tape as a FrameRecord. Rows are meant to be requested in order (held-row semantics of
    /// the Python are sequential); any order works, only the "held" fallback differs.
    pub fn frame(&mut self, i: usize) -> Option<Vec<u8>> {
        let fr = self.em.emit_row(i)?;
        let mut new_states = Vec::new();
        let mut new_cbs = Vec::new();
        let mut draws: Vec<[i32; 15]> = Vec::with_capacity(fr.draws.len());
        for d in &fr.draws {
            let st = self.state_id(d, &mut new_states) as i32;
            let tex = |k: &Option<String>, em: &Emitter| -> i32 { k.as_ref().and_then(|k| em.textures.position(k)).map(|p| p as i32).unwrap_or(-1) };
            let (t0, t1) = (tex(&d.tex[0], &self.em), tex(&d.tex[1], &self.em));
            let hashes = |v: &Option<[Option<String>; 4]>, key: &str, d: &Draw| -> [Option<String>; 4] {
                if let Some(a) = v { return a.clone(); }
                let mut o: [Option<String>; 4] = Default::default();
                if let Some(arr) = d.state.get(key).and_then(|x| x.as_array()) {
                    for k in 0..4 { o[k] = arr.get(k).and_then(|x| x.as_str()).map(|s| s.to_string()); }
                }
                o
            };
            let vs = hashes(&d.vscb, "vscbHash", d);
            let ps = hashes(&d.pscb, "pscbHash", d);
            let mut rec = [0i32; 15];
            rec[0] = st; rec[1] = d.first_index as i32; rec[2] = d.index_count as i32; rec[3] = d.stride as i32; rec[4] = d.voff as i32;
            rec[5] = t0; rec[6] = t1;
            for k in 0..4 { rec[7 + k] = self.cb_id(vs[k].as_deref(), &mut new_cbs); }
            for k in 0..4 { rec[11 + k] = self.cb_id(ps[k].as_deref(), &mut new_cbs); }
            draws.push(rec);
        }
        let mut out = Vec::with_capacity(fr.verts.len() + fr.idxs.len() * 4 + draws.len() * 60 + 4096);
        out.extend_from_slice(b"RRFR");
        out.extend_from_slice(&FRAME_RECORD_VERSION.to_le_bytes());
        out.extend_from_slice(&fr.frame.to_le_bytes());
        out.extend_from_slice(&(new_states.len() as u32).to_le_bytes());
        for (id, js) in &new_states { out.extend_from_slice(&id.to_le_bytes()); out.extend_from_slice(&(js.len() as u32).to_le_bytes()); out.extend_from_slice(js.as_bytes()); }
        let ntex = self.em.textures.len() - self.tex_sent;
        out.extend_from_slice(&(ntex as u32).to_le_bytes());
        for p in self.tex_sent..self.em.textures.len() {
            let t = &self.em.textures.vals[p];
            for v in [p as u32, t.w, t.h, t.fmt, t.data.len() as u32] { out.extend_from_slice(&v.to_le_bytes()); }
            out.extend_from_slice(&t.data);
        }
        self.tex_sent = self.em.textures.len();
        out.extend_from_slice(&(new_cbs.len() as u32).to_le_bytes());
        for (id, b) in &new_cbs { out.extend_from_slice(&id.to_le_bytes()); out.extend_from_slice(&(b.len() as u32).to_le_bytes()); out.extend_from_slice(b); }
        out.extend_from_slice(&(fr.verts.len() as u32).to_le_bytes()); out.extend_from_slice(&fr.verts);
        out.extend_from_slice(&((fr.idxs.len() * 4) as u32).to_le_bytes());
        for i in &fr.idxs { out.extend_from_slice(&i.to_le_bytes()); }
        out.extend_from_slice(&(draws.len() as u32).to_le_bytes());
        for rec in &draws { for v in rec { out.extend_from_slice(&v.to_le_bytes()); } }
        Some(out)
    }

    pub fn stats(&self) -> &crate::sprites::Stats { &self.em.stats }
}
