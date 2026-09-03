//! RRSQ WRITER -- the same container `tape_to_seq.py` (and `pack_sequence.py`) write:
//!   "RRSQ" u32:headLen head(JSON utf-8) <blob pool>
//!   head = { frames: [per-frame head], source, first, count, note }
//!   per-frame head = { frame, sceneRTFile: null, viewport, sceneRT, clears, vb{off,len}, ib{off,len},
//!                      inputLayouts, textures{key: {w,h,fmt,off,len}}, constantBuffers{hash: {off,len}}, draws[] }
//! Sprite draws copy the state of a real captured indexed draw (`tape_to_seq.template`): FROZEN in
//! `src/frozen/template_2574.json` from `frame_2574.pack` (sha256
//! 0b22d966e3880c40814d1fe1075243c589bd95c4ffbd293e89315c8b47ae38b1, draw i=548), or loaded from a pack given at
//! run time. The pack's constant buffers are interned first (`cb_recs = {h: intern(b) ...}`); pool payloads are
//! deduped by sha256 (`intern`).
use crate::sprites::{Draw, Frame, Texture};
use crate::util::{sha256, u32le, OrderedMap, Res};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub const FROZEN_TEMPLATE_2574: &str = include_str!("frozen/template_2574.json");

pub struct Template {
    pub source: String, pub pack_sha256: String,
    pub viewport: Value, pub scene_rt: Value, pub input_layouts: Value,
    /// the template draw dict (all its keys; i/firstIndex/indexCount/stride/voff/tex are overwritten per draw)
    pub draw: Map<String, Value>,
    pub draw_i: i64, pub vs_variant: String, pub ps_variant: String,
    /// the pack's constant buffers in manifest order
    pub cbs: Vec<(String, Vec<u8>)>,
}

fn hex(s: &str) -> Vec<u8> { (0..s.len() / 2).map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap_or(0)).collect() }

impl Template {
    /// The frozen `frame_2574.pack` template.
    pub fn frozen() -> Template {
        let v: Value = serde_json::from_str(FROZEN_TEMPLATE_2574).expect("frozen template_2574.json");
        let d = v.get("draw").and_then(|x| x.as_object()).cloned().unwrap_or_default();
        let cbs = v.get("cbs").and_then(|x| x.as_object()).map(|m| m.iter().map(|(h, b)| (h.clone(), hex(b.as_str().unwrap_or("")))).collect()).unwrap_or_default();
        Template {
            source: v.get("pack").and_then(|x| x.as_str()).unwrap_or("frame_2574.pack").to_string(),
            pack_sha256: v.get("pack_sha256").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            viewport: v.get("viewport").cloned().unwrap_or(Value::Null), scene_rt: v.get("sceneRT").cloned().unwrap_or(Value::Null),
            input_layouts: v.get("inputLayouts").cloned().unwrap_or(Value::Null),
            draw_i: d.get("i").and_then(|x| x.as_i64()).unwrap_or(-1),
            vs_variant: d.get("vsVariant").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            ps_variant: d.get("psVariant").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            draw: d, cbs,
        }
    }
}

/// `tape_to_seq.load_pack_rrpk` + `template(path)` from a pack's bytes.
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
        source: "pack".into(), pack_sha256: String::new(),
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
    /// hash -> {off,len}: the template's CBs first, then every emitter CB in first-seen order
    cb_recs: Map<String, Value>,
    cb_interned: usize,
    heads: Vec<Value>,
    tex_recs: Vec<Value>,
    source: String,
    input_layouts: Value,
}

impl SeqWriter {
    /// `cb_recs = {h: intern(b) for h, b in tcbs.items()}`; `world_layouts` = `wt.inputLayouts` (merged over the
    /// template's, `{**man['inputLayouts'], **wt.inputLayouts}`).
    pub fn new(tpl: &Template, world_layouts: Option<&Value>, source: &str) -> SeqWriter {
        let mut il = tpl.input_layouts.as_object().cloned().unwrap_or_default();
        if let Some(w) = world_layouts.and_then(|x| x.as_object()) { for (k, v) in w { il.insert(k.clone(), v.clone()); } }
        let mut w = SeqWriter { pool: Vec::new(), index: HashMap::new(), cb_recs: Map::new(), cb_interned: 0, heads: Vec::new(),
                                tex_recs: Vec::new(), source: source.to_string(), input_layouts: Value::Object(il) };
        for (h, b) in &tpl.cbs { let r = w.intern(b); w.cb_recs.insert(h.clone(), r); }
        w
    }

    fn intern(&mut self, b: &[u8]) -> Value {
        let h = sha256(b);
        let (off, len) = match self.index.get(&h) {
            Some(&r) => r,
            None => { let r = (self.pool.len(), b.len()); self.index.insert(h, r); self.pool.extend_from_slice(b); r }
        };
        json!({"off": off, "len": len})
    }

    /// Intern this frame's NEW textures and constant buffers (first-seen order), then vb and ib; append the head.
    pub fn push_frame(&mut self, tpl: &Template, textures: &OrderedMap<Texture>, cb_recs: &OrderedMap<Vec<u8>>, fr: &Frame) {
        while self.tex_recs.len() < textures.len() {
            let i = self.tex_recs.len();
            let t = &textures.vals[i];
            let mut rec = json!({"w": t.w, "h": t.h, "fmt": t.fmt});
            let r = self.intern(&t.data);
            rec["off"] = r["off"].clone(); rec["len"] = r["len"].clone();
            self.tex_recs.push(rec);
        }
        while self.cb_interned < cb_recs.len() {
            let i = self.cb_interned;
            let (h, b) = (&cb_recs.keys[i], &cb_recs.vals[i]);
            if !self.cb_recs.contains_key(h) { let r = self.intern(b); self.cb_recs.insert(h.clone(), r); }   // setdefault
            self.cb_interned += 1;
        }
        let vb = self.intern(&fr.verts);
        let mut ib = Vec::with_capacity(fr.idxs.len() * 4);
        for i in &fr.idxs { ib.extend_from_slice(&i.to_le_bytes()); }
        let ib = self.intern(&ib);
        let mut used: OrderedMap<()> = OrderedMap::new();
        let mut draws = Vec::with_capacity(fr.draws.len());
        for (i, d) in fr.draws.iter().enumerate() {
            draws.push(draw_json(i, d));
            for k in d.tex.iter().flatten() { used.insert_new(k, ()); }
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
        head.insert("inputLayouts".into(), self.input_layouts.clone());
        head.insert("textures".into(), Value::Object(tex));
        head.insert("constantBuffers".into(), Value::Object(self.cb_recs.clone()));
        head.insert("draws".into(), Value::Array(draws));
        self.heads.push(Value::Object(head));
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

/// `d = dict(state); d.update({'i', 'firstIndex', 'indexCount', 'stride', 'voff', 'tex' [, 'vscbHash', 'pscbHash']})`
fn draw_json(i: usize, d: &Draw) -> Value {
    let mut m = d.state.clone();
    m.insert("i".into(), json!(i));
    m.insert("firstIndex".into(), json!(d.first_index));
    m.insert("indexCount".into(), json!(d.index_count));
    m.insert("stride".into(), json!(d.stride));
    m.insert("voff".into(), json!(d.voff));
    m.insert("tex".into(), json!([d.tex[0], d.tex[1]]));
    if let Some(v) = &d.vscb { m.insert("vscbHash".into(), json!(v)); }
    if let Some(p) = &d.pscb { m.insert("pscbHash".into(), json!(p)); }
    Value::Object(m)
}
