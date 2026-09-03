//! RRSQ WRITER -- the same container `tape_to_seq.py` (and `pack_sequence.py`) write:
//!   "RRSQ" u32:headLen head(JSON utf-8) <blob pool>
//!   head = { frames: [per-frame head], source, first, count, note }
//!   per-frame head = { frame, sceneRTFile: null, viewport, sceneRT, clears, vb{off,len}, ib{off,len},
//!                      inputLayouts, textures{key: {w,h,fmt,off,len}}, constantBuffers{hash: {off,len}}, draws[] }
//! Pipeline state for every sprite draw is COPIED from a real captured indexed draw (`tape_to_seq.template`:
//! the first `psVariant == 'indexed'` draw of frame_2574.pack) and the pack's constant buffers are interned
//! first, exactly as `cb_recs = {h: intern(b) ...}` does. Pool payloads are deduped by sha256 (`intern`).
use crate::sprites::{Draw, Frame, Texture};
use crate::util::{sha256, u32le, OrderedMap, Res};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub struct Template {
    pub viewport: Value, pub scene_rt: Value, pub input_layouts: Value,
    /// the template draw dict (all its keys; i/firstIndex/indexCount/stride/voff/tex are overwritten per draw)
    pub draw: Map<String, Value>,
    pub draw_i: i64, pub vs_variant: String, pub ps_variant: String,
    /// the pack's constant buffers in manifest order
    pub cbs: Vec<(String, Vec<u8>)>,
}

/// `tape_to_seq.load_pack_rrpk` + `template(path)`.
pub fn load_template(pack: &[u8]) -> Res<Template> {
    if pack.len() < 8 || &pack[..4] != b"RRPK" { return Err("template: not an RRPK pack".into()); }
    let n = u32le(pack, 4) as usize;
    let man: Value = serde_json::from_slice(&pack[8..8 + n]).map_err(|e| format!("template manifest: {e}"))?;
    let body = &pack[8 + n..];
    let draws = man.get("draws").and_then(|x| x.as_array()).ok_or("template: no draws")?;
    let d = draws.iter().find(|x| x.get("psVariant").and_then(|v| v.as_str()) == Some("indexed"))
        .ok_or("template has no indexed draw to copy state from")?;
    let mut cbs = Vec::new();
    if let Some(m) = man.get("constantBuffers").and_then(|x| x.as_object()) {
        for (h, r) in m {
            let off = r.get("off").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
            let len = r.get("len").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
            cbs.push((h.clone(), body[off.min(body.len())..(off + len).min(body.len())].to_vec()));
        }
    }
    Ok(Template {
        viewport: man.get("viewport").cloned().unwrap_or(Value::Null),
        scene_rt: man.get("sceneRT").cloned().unwrap_or(Value::Null),
        input_layouts: man.get("inputLayouts").cloned().unwrap_or(Value::Null),
        draw: d.as_object().cloned().unwrap_or_default(),
        draw_i: d.get("i").and_then(|x| x.as_i64()).unwrap_or(-1),
        vs_variant: d.get("vsVariant").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        ps_variant: d.get("psVariant").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        cbs,
    })
}

pub struct SeqWriter {
    pool: Vec<u8>,
    index: HashMap<[u8; 32], (usize, usize)>,
    cb_recs: Map<String, Value>,
    heads: Vec<Value>,
    /// per emitter texture (by position in `Emitter.textures`): its pool record
    tex_recs: Vec<Value>,
    source: String,
}

impl SeqWriter {
    /// `cb_recs = {h: intern(b) for h, b in tcbs.items()}`
    pub fn new(tpl: &Template, source: &str) -> SeqWriter {
        let mut w = SeqWriter { pool: Vec::new(), index: HashMap::new(), cb_recs: Map::new(), heads: Vec::new(), tex_recs: Vec::new(), source: source.to_string() };
        for (h, b) in &tpl.cbs { let r = w.intern(b); w.cb_recs.insert(h.clone(), r); }
        w
    }

    /// `intern(b)` -> {off, len}, storing the bytes once (sha256 keyed).
    fn intern(&mut self, b: &[u8]) -> Value {
        let h = sha256(b);
        let (off, len) = match self.index.get(&h) {
            Some(&r) => r,
            None => { let r = (self.pool.len(), b.len()); self.index.insert(h, r); self.pool.extend_from_slice(b); r }
        };
        json!({"off": off, "len": len})
    }

    /// Intern this frame's NEW textures (first-seen order, as the Python interns them while emitting), then
    /// vb and ib, and append the frame head.
    pub fn push_frame(&mut self, tpl: &Template, textures: &OrderedMap<Texture>, fr: &Frame) {
        while self.tex_recs.len() < textures.len() {
            let i = self.tex_recs.len();
            let t = &textures.vals[i];
            let mut rec = json!({"w": t.w, "h": t.h, "fmt": t.fmt});
            let r = self.intern(&t.data);
            rec["off"] = r["off"].clone(); rec["len"] = r["len"].clone();
            self.tex_recs.push(rec);
        }
        let vb = self.intern(&fr.verts);
        let mut ib = Vec::with_capacity(fr.idxs.len() * 4);
        for i in &fr.idxs { ib.extend_from_slice(&i.to_le_bytes()); }
        let ib = self.intern(&ib);
        let mut used: OrderedMap<()> = OrderedMap::new();
        let mut draws = Vec::with_capacity(fr.draws.len());
        for (i, d) in fr.draws.iter().enumerate() {
            draws.push(self.draw_json(tpl, i, d));
            for k in &d.tex { used.insert_new(k, ()); }
        }
        let mut tex = Map::new();
        for k in &used.keys {
            if let Some(p) = textures.position(k) { tex.insert(k.clone(), self.tex_recs[p].clone()); }
        }
        let mut head = Map::new();
        head.insert("frame".into(), json!(fr.frame));
        head.insert("sceneRTFile".into(), Value::Null);
        head.insert("viewport".into(), tpl.viewport.clone());
        head.insert("sceneRT".into(), tpl.scene_rt.clone());
        head.insert("clears".into(), json!([{"kind": "ClearRenderTargetView", "colour": [0, 0, 0, 0]}]));
        head.insert("vb".into(), vb);
        head.insert("ib".into(), ib);
        head.insert("inputLayouts".into(), tpl.input_layouts.clone());
        head.insert("textures".into(), Value::Object(tex));
        head.insert("constantBuffers".into(), Value::Object(self.cb_recs.clone()));
        head.insert("draws".into(), Value::Array(draws));
        self.heads.push(Value::Object(head));
    }

    /// `d = dict(tdraw); d.update({'i', 'firstIndex', 'indexCount', 'stride', 'voff', 'tex'})`
    fn draw_json(&self, tpl: &Template, i: usize, d: &Draw) -> Value {
        let mut m = tpl.draw.clone();
        m.insert("i".into(), json!(i));
        m.insert("firstIndex".into(), json!(d.first_index));
        m.insert("indexCount".into(), json!(d.index_count));
        m.insert("stride".into(), json!(d.stride));
        m.insert("voff".into(), json!(d.voff));
        m.insert("tex".into(), json!([d.tex[0], d.tex[1]]));
        Value::Object(m)
    }

    pub fn frames(&self) -> usize { self.heads.len() }

    /// The file bytes: "RRSQ" u32 len(head) head pool.
    pub fn finish(self) -> Res<Vec<u8>> {
        let first = self.heads.first().and_then(|h| h.get("frame").cloned()).unwrap_or(json!(0));
        let manifest = json!({
            "frames": self.heads, "source": self.source, "first": first, "count": self.heads.len(),
            "note": "SYNTHESISED from tape state by rr-render emit_seq (port of tape_to_seq.py) -- not a capture",
        });
        let hb = serde_json::to_vec(&manifest).map_err(|e| format!("manifest: {e}"))?;
        let mut out = Vec::with_capacity(8 + hb.len() + self.pool.len());
        out.extend_from_slice(b"RRSQ");
        out.extend_from_slice(&(hb.len() as u32).to_le_bytes());
        out.extend_from_slice(&hb);
        out.extend_from_slice(&self.pool);
        Ok(out)
    }
}
