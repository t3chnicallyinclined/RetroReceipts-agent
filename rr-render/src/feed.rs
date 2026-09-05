//! FRAME FEED -- open(tape bytes, asset pack) -> frame(i) -> a binary FrameRecord the browser turns straight into
//! the `{head, slice}` shape `replay.mjs` / `resources.mjs` already consume. No JSON per draw; textures, constant
//! buffers and pipeline states are TABLES referenced by id and sent once (first use), so a page uploads every
//! texture exactly once for the whole tape.
//!
//! FrameRecord v2 (little-endian):
//!   "RRFR" u32 ver=2  i64 frame_clock
//!   u32 n_states   { u32 id, u32 len, json bytes }        pipeline state dict (the draw's template/world/preamble
//!                                                          state minus the per-draw keys), first use only
//!   u32 n_textures { u32 id, u32 w, u32 h, u32 fmt, u32 len, bytes }   first use only
//!   u32 n_cbs      { u32 id, u32 len, bytes }              constant buffers by content hash, first use only
//!   u32 n_blobs    { u32 id, u32 len, bytes }              SHARED GEOMETRY blobs, first use only
//!   u32 n_vb_segs  { i32 blob, u32 len }                   blob >= 0 = that blob's bytes; -1 = the next `len`
//!   u32 vb_inline_len bytes                                 bytes of the inline stream that follows
//!   u32 n_ib_segs  { i32 blob, u32 len }                   same, index words (len is in BYTES)
//!   u32 ib_inline_len bytes
//!   u32 n_draws    { u32 state, u32 firstIndex, u32 indexCount, u32 stride, u32 voff,
//!                    i32 tex0, i32 tex1, i32 vscb[4], i32 pscb[4] }     (-1 = none)      60 B per draw
//! The JS side keys textures "T<id>" and constant buffers "C<id>" (ids are stable for the feed's lifetime).
//!
//! v2 (2026-09-03) extends the first-use-only idea to GEOMETRY. v1 re-sent the whole vertex and index buffer every
//! frame; ~464 KB of a ~706 KB record was the arc stage DECK, whose bytes depend only on the deck colour. A record
//! now describes each buffer as a list of segments -- inline bytes, or a reference to a blob an earlier record sent
//! -- and the CONCATENATION of the segments is byte-for-byte the buffer v1 sent whole, so every `firstIndex` and
//! `voff` is unchanged and the decoder stays a straight walk. (`util::VbSegs` / `IbSegs` / `BlobStore`.)
use crate::pack::AssetPack;
use crate::seq::Template;
use crate::sprites::{Draw, EmitOpts, Emitter};
use crate::state::WorldTemplate;
use crate::tape::Tape;
use crate::util::Res;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub const FRAME_RECORD_VERSION: u32 = 2;
use crate::util::PER_DRAW_KEYS;

pub struct FrameFeed {
    em: Emitter,
    tpl: Template,
    state_ids: HashMap<String, u32>,
    state_fp: HashMap<u64, u32>,
    tex_sent: usize,
    blobs_sent: usize,
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
        if let Some(n) = &em.palrow_note { log.push(n.clone()); }
        Ok(FrameFeed { em, tpl, state_ids: HashMap::new(), state_fp: HashMap::new(), tex_sent: 0, blobs_sent: 0, cb_ids: HashMap::new(), template_cbs, log })
    }

    pub fn frame_count(&self) -> usize { self.em.tape.frames.len() }
    pub fn tape(&self) -> &Tape { &self.em.tape }
    /// Cloud skins per fighter slot (see EmitOpts.skins). Set before the first frame is requested.
    pub fn set_skins(&mut self, skins: [Option<[u32; 16]>; 6]) { self.em.opts.skins = skins; }

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

    /// LIVE FEED (added 2026-09-04, SUPERGUN). STRICTLY ADDITIVE: `open` and `frame` are untouched and no
    /// existing caller reaches this. Decodes a tape (typically a ONE-ROW tape emitted by the runner harvest
    /// for the frame just ticked) and appends its rows and per-clock side tables to the open session, then
    /// returns `(first_index, count)` so the caller can hand the indices straight to `frame(i)`.
    ///
    /// This exists so a live session pays the genuine per-tape setup -- the palette-block resolver,
    /// `node_counts`, world-state init, atlas selection -- ONCE at `open`, instead of sixty times a second.
    /// The alternative (calling `open` per frame on a one-row tape) re-runs all of it and is the wrong shape
    /// to keep even where it is fast enough.
    pub fn push_tape(&mut self, tape_bytes: &[u8]) -> Res<(usize, usize)> {
        let t = Tape::decode(tape_bytes)?;
        let mut first = None;
        let mut n = 0usize;
        for row in t.frames.iter() {
            let clock = t.num(row, "frame").unwrap_or(0.0) as u32;
            let idx = self.em.push_live_row(
                row.clone(), clock,
                t.nodes.get(&clock).cloned(),
                t.anodes.get(&clock).cloned(),
                t.palrows.get(&clock).cloned(),
            );
            if first.is_none() { first = Some(idx); }
            n += 1;
        }
        Ok((first.unwrap_or(0), n))
    }

    fn state_id(&mut self, d: &Draw, new_states: &mut Vec<(u32, String)>) -> u32 {
        // (2026-09-03 perf) the fingerprint of the state map is computed ONCE where the map is interned
        // (`WorldTemplate::select` / the sprite template / `order_draws`' raster patch) and carried on the Draw:
        // ~500 draws/frame were each hashing a 15-key nested JSON map just to look an id up. Only an unseen
        // fingerprint pays for the JSON.
        let fp = d.state_fp;
        if let Some(&id) = self.state_fp.get(&fp) { return id; }
        let mut m: Map<String, Value> = (*d.state).clone();
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
        use crate::util::prof;
        let fr = self.em.emit_row(i)?;
        let mut tick = prof::now();
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
        prof::lap("feed:draws", &mut tick);
        let mut out = Vec::with_capacity(fr.verts.inline.len() + fr.idxs.inline.len() * 4 + draws.len() * 60 + 4096);
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
        // shared geometry blobs, first use only (ids are the BlobStore's own, stable for the feed's lifetime)
        let nblob = self.em.blobs.len() - self.blobs_sent;
        out.extend_from_slice(&(nblob as u32).to_le_bytes());
        for p in self.blobs_sent..self.em.blobs.len() {
            let b = self.em.blobs.blobs[p].to_bytes();
            out.extend_from_slice(&(p as u32).to_le_bytes());
            out.extend_from_slice(&(b.len() as u32).to_le_bytes());
            out.extend_from_slice(&b);
        }
        self.blobs_sent = self.em.blobs.len();
        out.extend_from_slice(&(fr.verts.segs.len() as u32).to_le_bytes());
        for &(id, n) in &fr.verts.segs { out.extend_from_slice(&id.to_le_bytes()); out.extend_from_slice(&n.to_le_bytes()); }
        out.extend_from_slice(&(fr.verts.inline.len() as u32).to_le_bytes());
        out.extend_from_slice(&fr.verts.inline);
        out.extend_from_slice(&(fr.idxs.segs.len() as u32).to_le_bytes());
        for &(id, n) in &fr.idxs.segs { out.extend_from_slice(&id.to_le_bytes()); out.extend_from_slice(&(n * 4).to_le_bytes()); }
        out.extend_from_slice(&((fr.idxs.inline.len() * 4) as u32).to_le_bytes());
        for i in &fr.idxs.inline { out.extend_from_slice(&i.to_le_bytes()); }
        out.extend_from_slice(&(draws.len() as u32).to_le_bytes());
        for rec in &draws { for v in rec { out.extend_from_slice(&v.to_le_bytes()); } }
        prof::lap("feed:ser", &mut tick);
        Some(out)
    }

    pub fn stats(&self) -> &crate::sprites::Stats { &self.em.stats }
    /// NATIVE RENDERER ACCESS (2026-09-05, SUPERGUN). STRICTLY ADDITIVE: nothing above is touched and
    /// no existing caller reaches these.
    ///
    /// `frame(i)` serialises a FrameRecord so the draw list can cross a process or a socket. A renderer
    /// living in the SAME process crosses nothing, so it takes the draw list directly and skips
    /// serialisation, the first record's whole first-use table dump, and the per-frame geometry copy.
    /// These accessors exist only to make that possible; the wire format is unchanged and still the
    /// only thing the browser ever sees.
    ///
    /// Everything the renderer needs beyond the returned `Frame` hangs off the emitter and is already
    /// public: `textures` (key -> Page), `cb_recs` (hash -> bytes) and `blobs` (shared geometry).
    pub fn emit(&mut self, i: usize) -> Option<crate::sprites::Frame> { self.em.emit_row(i) }
    pub fn emitter(&self) -> &Emitter { &self.em }
    pub fn emitter_mut(&mut self) -> &mut Emitter { &mut self.em }
    /// Viewport, scene render target and input layouts -- the per-session values the wire format sends
    /// once in the session info and an in-process renderer can simply read.
    pub fn template(&self) -> &Template { &self.tpl }
    /// The input layouts a renderer must have, sprite template PLUS world template -- exactly the
    /// merge  sends to the browser. Kept here as ONE implementation because getting it
    /// wrong is silent: the world layouts are missing, every stage draw fails to build a layout, and
    /// the renderer quietly draws the characters into an empty stage.
    pub fn input_layouts_merged(&self) -> Value {
        let mut il = self.tpl.input_layouts.as_object().cloned().unwrap_or_default();
        if self.em.world_enabled() {
            if let Some(w) = self.em.wt.input_layouts.as_object() {
                for (k, v) in w { il.insert(k.clone(), v.clone()); }
            }
        }
        Value::Object(il)
    }
}
