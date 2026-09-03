//! TAPE DECODER -- the agent's gz+base64 JSON envelope -> typed frames.
//!
//! Record layouts mirror the agent's encoder in `RetroReceipts-agent/agent/src/reader.rs` `spool_gamestate`
//! (line 2474): rows = the `frames` json! array (lines 2503-2512, column names = `GS_SCHEMA` line 1226),
//! `nodes_raw` (the TAPE v3/v4/0.3.38 node record, `NODES_STRIDE = 54` line 1978, struct `ObjNode` line 1365),
//! `pals_raw` (32 B ARGB4444 per palette), `palrows_raw` (0.3.40, 148 B per frame), `anodes_raw` (`ANode`
//! line 1419, `ANODES_STRIDE = 100`), `aobjs_raw` ([u16 n][n x (u32 len, bytes)]).
//! The reader side is ported from `tape_to_seq.py main()` (the v3/v4 node + palette decode block, the palrows
//! block, the schema/column map) and `tape_to_seq.decode_anodes` / `nl_groups`.
//! Every stride is read from the envelope (`nodes_stride`, `anodes_stride`, `palrows_stride`) so 44/50/54 and
//! 96/100 all decode, exactly as the Python does.
use crate::util::{f32le, gz_b64, i16le, i32le, u16le, u32le, u64le, Res};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

/// 256-entry RGBA palette as tape_to_seq builds it (np.zeros((256, 4), uint8) with 16 entries filled).
pub type Pal256 = [[u8; 4]; 256];

/// One System-B draw-list node (reader.rs `ObjNode`, serialised at `nodes_raw`; Python: the
/// `struct.unpack_from('<BBBbBBBBHHHBBBBHHHfffII', ...)` block of `tape_to_seq.main`).
#[derive(Clone, Debug, Default)]
pub struct Node {
    pub kind: u8, pub slot: u8, pub cat: u8, pub sort: i8, pub layer: u8, pub face: u8, pub owner: u8, pub drawn: u8,
    pub sid: u16, pub pal: u16, pub flash: u16, pub glow: u8, pub is_effect: u8, pub blend: u8, pub atimer: u8,
    pub zx_raw: u16, pub zy_raw: u16, pub effect_key: u16,
    pub fsx: f32, pub fsy: f32, pub depth: f32, pub gfx1: u32, pub gfx2: u32,
    // v4 tail (stride >= 50)
    pub angle: u16, pub hotx: i16, pub hoty: i16,
    // 0.3.38 tail (stride >= 54)
    pub owner_off: u32,
    /// Python `oslot`: (owner_off - 0x3DB8) // 0x738 when owner_off >= 0x3DB8 and divisible, and 0..5; else -1.
    pub oslot: i8,
}

impl Node {
    /// Python `zx=v[15] / 4096.0`.
    pub fn zx(&self) -> f64 { self.zx_raw as f64 / 4096.0 }
}

/// TAPE v5 `palrows` record: 48 x u16 index into `pals` (slot*8+row) + 48 x u8 flag.
#[derive(Clone, Debug)]
pub struct PalRows { pub idx: [u16; 48], pub flg: [u8; 48] }

/// System-A world node (reader.rs `ANode`; Python `decode_anodes` row dict).
#[derive(Clone, Debug)]
pub struct ANode {
    pub list: u8, pub flags: u32, pub matrix: [f32; 16], pub colour: [f32; 3], pub obj: u16, pub model: u64,
    /// 0.3.39 (stride 100): node+0x90 alpha multiplier; 1.0 on older tapes.
    pub alpha: f32,
}

/// One record of an interned polygon-list object (Python `decode_anodes` rec dict).
#[derive(Clone, Debug)]
pub struct ObjRec {
    pub tcw: u32, pub key: String, pub pcw: u32, pub isp: u32, pub tsp: u32, pub texnum: i32,
    pub colour: [f32; 4],
    /// (group flags, TRIANGLE LIST of (x y z nx ny nz u v)) per polygon group -- `nl_groups`.
    pub groups: Vec<(u32, Vec<[f32; 8]>)>,
    pub centre: Option<[f32; 3]>, pub radius: Option<f32>,
}

impl ObjRec {
    /// Python `verts = [v for _f, vs in groups for v in vs]`.
    pub fn verts(&self) -> Vec<[f32; 8]> { self.groups.iter().flat_map(|(_, vs)| vs.iter().copied()).collect() }
}

/// Typed view of the columns the renderer consumes (`GS_SCHEMA`, reader.rs line 1226; 0.3.39/0.3.45 appended
/// fields at lines 1338/1342). Every field is Option: older schemas lack the later columns.
#[derive(Clone, Debug, Default)]
pub struct RowView {
    pub frame: i64,
    pub eye_x: Option<f64>, pub eye_y: Option<f64>, pub ground: Option<f64>, pub zoom: Option<f64>,
    pub drawn: Option<Vec<f64>>, pub sid: Option<Vec<f64>>, pub sx: Option<Vec<f64>>, pub sy: Option<Vec<f64>>,
    pub facing: Option<Vec<f64>>, pub layer: Option<Vec<f64>>,
    pub timer: Option<f64>, pub round_no: Option<f64>,
    // 0.3.39
    pub cam_state: Option<f64>, pub look: Option<Vec<f64>>, pub fov: Option<f64>, pub yoff: Option<f64>,
    pub roll: Option<f64>, pub deck: Option<Vec<f64>>, pub blackout: Option<f64>,
    // 0.3.45
    pub bg_mode: Option<f64>, pub bg_col: Option<Vec<f64>>, pub fade_mode: Option<f64>, pub fade_col: Option<f64>,
    pub bg_gate: Option<Vec<f64>>,
}

pub struct Tape {
    pub ver: String, pub tape_ver: i64, pub nodes_stride: usize, pub anodes_stride: usize, pub palrows_stride: usize,
    pub stage_id: Option<i64>,
    pub p1_team: Vec<u8>, pub p2_team: Vec<u8>,
    /// `tape.get('costume') or [0]*6`
    pub costume: Vec<i64>,
    pub schema: Vec<String>,
    cols: HashMap<String, usize>,
    /// The raw rows, one JSON array per frame (positional by `schema`).
    pub frames: Vec<Value>,
    /// frame clock -> ordered nodes (TAPE v3+). Empty when the tape predates v3.
    pub nodes: BTreeMap<u32, Vec<Node>>,
    pub pals: Vec<Pal256>,
    pub palrows: HashMap<u32, PalRows>,
    pub anodes: HashMap<u32, Vec<ANode>>,
    pub aobjs: Vec<Vec<ObjRec>>,
}

fn as_u8_vec(v: Option<&Value>) -> Vec<u8> {
    v.and_then(|x| x.as_array()).map(|a| a.iter().map(|x| x.as_i64().unwrap_or(0) as u8).collect()).unwrap_or_default()
}

impl Tape {
    /// `raw = open(tape).read(); if gzip: decompress; tape = json.loads(raw)` + the decode blocks of main().
    pub fn decode(raw: &[u8]) -> Res<Tape> {
        let body;
        let raw = if raw.len() >= 2 && raw[0] == 0x1F && raw[1] == 0x8B { body = crate::util::gunzip(raw)?; &body[..] } else { raw };
        let v: Value = serde_json::from_slice(raw).map_err(|e| format!("tape json: {e}"))?;
        let o = v.as_object().ok_or("tape: not an object")?;
        let schema_s = o.get("schema").and_then(|x| x.as_str()).ok_or("tape: no schema")?;
        // cols = [s.strip() for s in schema.strip('[]').split(',')]; C = {name: i}; plus bare-name aliases
        let schema: Vec<String> = schema_s.trim_matches(|c| c == '[' || c == ']').split(',').map(|s| s.trim().to_string()).collect();
        let mut cols: HashMap<String, usize> = HashMap::new();
        for (i, n) in schema.iter().enumerate() { cols.insert(n.clone(), i); }
        for (i, n) in schema.iter().enumerate() {
            if n.ends_with(']') { if let Some(p) = n.find('[') { cols.entry(n[..p].to_string()).or_insert(i); } }
        }
        let frames = o.get("frames").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        let nodes_stride = o.get("nodes_stride").and_then(|x| x.as_u64()).unwrap_or(44) as usize;
        let anodes_stride = o.get("anodes_stride").and_then(|x| x.as_u64()).unwrap_or(96) as usize;
        let palrows_stride = o.get("palrows_stride").and_then(|x| x.as_u64()).unwrap_or(148) as usize;
        let costume = o.get("costume").and_then(|x| x.as_array())
            .map(|a| a.iter().map(|x| x.as_i64().unwrap_or(0)).collect::<Vec<_>>())
            .filter(|a| !a.is_empty()).unwrap_or_else(|| vec![0; 6]);
        let mut t = Tape {
            ver: o.get("ver").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            tape_ver: o.get("tape_ver").and_then(|x| x.as_i64()).unwrap_or(0),
            nodes_stride, anodes_stride, palrows_stride,
            stage_id: o.get("stage_id").and_then(|x| x.as_i64()),
            p1_team: as_u8_vec(o.get("p1_team")), p2_team: as_u8_vec(o.get("p2_team")), costume,
            schema, cols, frames,
            nodes: BTreeMap::new(), pals: Vec::new(), palrows: HashMap::new(), anodes: HashMap::new(), aobjs: Vec::new(),
        };
        if let Some(s) = o.get("nodes").and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
            t.nodes = decode_nodes(&gz_b64(s)?, nodes_stride);
            if let Some(p) = o.get("pals").and_then(|x| x.as_str()) { t.pals = decode_pals(&gz_b64(p)?); }
            if let Some(p) = o.get("palrows").and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
                t.palrows = decode_palrows(&gz_b64(p)?, palrows_stride);
            }
        }
        if let Some(s) = o.get("anodes").and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
            t.anodes = decode_anodes(&gz_b64(s)?, anodes_stride);
            if let Some(p) = o.get("aobjs").and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
                t.aobjs = decode_aobjs(&gz_b64(p)?);
            }
        }
        Ok(t)
    }

    pub fn col(&self, name: &str) -> Option<usize> { self.cols.get(name).copied() }
    pub fn has_col(&self, name: &str) -> bool { self.cols.contains_key(name) }
    pub fn cell<'a>(&self, row: &'a Value, name: &str) -> Option<&'a Value> { row.as_array()?.get(self.col(name)?) }
    pub fn num(&self, row: &Value, name: &str) -> Option<f64> { self.cell(row, name)?.as_f64() }
    pub fn arr(&self, row: &Value, name: &str) -> Option<Vec<f64>> {
        self.cell(row, name)?.as_array().map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect())
    }

    /// Typed view of row `i` (fields absent from this tape's schema are None).
    pub fn row(&self, i: usize) -> Option<RowView> {
        let r = self.frames.get(i)?;
        Some(RowView {
            frame: self.num(r, "frame").unwrap_or(0.0) as i64,
            eye_x: self.num(r, "eyeX"), eye_y: self.num(r, "eyeY"), ground: self.num(r, "ground"), zoom: self.num(r, "zoom"),
            drawn: self.arr(r, "drawn[6]"), sid: self.arr(r, "sid[6]"), sx: self.arr(r, "sx[6]"), sy: self.arr(r, "sy[6]"),
            facing: self.arr(r, "facing[6]"), layer: self.arr(r, "layer[6]"),
            timer: self.num(r, "timer"), round_no: self.num(r, "round_no"),
            cam_state: self.num(r, "cam_state"), look: self.arr(r, "look"), fov: self.num(r, "fov"), yoff: self.num(r, "yoff"),
            roll: self.num(r, "roll"), deck: self.arr(r, "deck"), blackout: self.num(r, "blackout"),
            bg_mode: self.num(r, "bg_mode"), bg_col: self.arr(r, "bg_col"), fade_mode: self.num(r, "fade_mode"),
            fade_col: self.num(r, "fade_col"), bg_gate: self.arr(r, "bg_gate"),
        })
    }
}

/// tape_to_seq.main: the `while off + 6 <= len(nb)` node loop. `[u32 frame][u16 count][count x stride]`.
pub fn decode_nodes(nb: &[u8], stride: usize) -> BTreeMap<u32, Vec<Node>> {
    let mut out = BTreeMap::new();
    let mut off = 0usize;
    while off + 6 <= nb.len() {
        let fr = u32le(nb, off);
        let n = u16le(nb, off + 4) as usize;
        off += 6;
        let mut rows = Vec::with_capacity(n);
        for _ in 0..n {
            if off + stride.max(44) > nb.len() { break; }   // struct.error in Python; a truncated tail
            let b = nb;
            let (angle, hotx, hoty) = if stride >= 50 { (u16le(b, off + 44), i16le(b, off + 46), i16le(b, off + 48)) } else { (0, 0, 0) };
            let owner_off = if stride >= 54 { u32le(b, off + 50) } else { 0 };
            let oslot: i64 = if owner_off >= 0x3DB8 && (owner_off - 0x3DB8) % 0x738 == 0 { ((owner_off - 0x3DB8) / 0x738) as i64 } else { -1 };
            rows.push(Node {
                kind: b[off], slot: b[off + 1], cat: b[off + 2], sort: b[off + 3] as i8, layer: b[off + 4], face: b[off + 5],
                owner: b[off + 6], drawn: b[off + 7], sid: u16le(b, off + 8), pal: u16le(b, off + 10), flash: u16le(b, off + 12),
                glow: b[off + 14], is_effect: b[off + 15], blend: b[off + 16], atimer: b[off + 17],
                zx_raw: u16le(b, off + 18), zy_raw: u16le(b, off + 20), effect_key: u16le(b, off + 22),
                fsx: f32le(b, off + 24), fsy: f32le(b, off + 28), depth: f32le(b, off + 32),
                gfx1: u32le(b, off + 36), gfx2: u32le(b, off + 40),
                angle, hotx, hoty, owner_off,
                oslot: if (0..6).contains(&oslot) { oslot as i8 } else { -1 },
            });
            off += stride;
        }
        out.insert(fr, rows);
    }
    out
}

/// tape_to_seq.main: `pals` -- 32 B ARGB4444 (u16 LE, A15-12 R11-8 G7-4 B3-0, nibble*17) -> 256x4 RGBA.
pub fn decode_pals(pb: &[u8]) -> Vec<Pal256> {
    let mut out = Vec::with_capacity(pb.len() / 32);
    for i in 0..pb.len() / 32 {
        let mut pal: Pal256 = [[0u8; 4]; 256];
        for j in 0..16 {
            let w = u16le(pb, i * 32 + j * 2);
            pal[j] = [(((w >> 8) & 15) * 17) as u8, (((w >> 4) & 15) * 17) as u8, ((w & 15) * 17) as u8, (((w >> 12) & 15) * 17) as u8];
        }
        out.push(pal);
    }
    out
}

/// tape_to_seq.main: TAPE v5 `palrows` [u32 frame][48 x u16][48 x u8], stride from `palrows_stride`.
pub fn decode_palrows(prb: &[u8], stride: usize) -> HashMap<u32, PalRows> {
    let mut out = HashMap::new();
    let mut off = 0usize;
    while off + stride <= prb.len() {
        let pfr = u32le(prb, off);
        let mut idx = [0u16; 48];
        for k in 0..48 { idx[k] = u16le(prb, off + 4 + k * 2); }
        let mut flg = [0u8; 48];
        flg.copy_from_slice(&prb[off + 100..off + 148]);
        out.insert(pfr, PalRows { idx, flg });
        off += stride;
    }
    out
}

/// tape_to_seq.decode_anodes (node half): [u32 frame][u16 n][n x stride].
pub fn decode_anodes(ab: &[u8], stride: usize) -> HashMap<u32, Vec<ANode>> {
    let mut frames = HashMap::new();
    let mut off = 0usize;
    while off + 6 <= ab.len() {
        let fr = u32le(ab, off);
        let n = u16le(ab, off + 4) as usize;
        off += 6;
        let mut rows = Vec::with_capacity(n);
        for _ in 0..n {
            if off + stride > ab.len() { break; }
            let mut matrix = [0f32; 16];
            for k in 0..16 { matrix[k] = f32le(ab, off + 8 + k * 4); }
            rows.push(ANode {
                list: ab[off], flags: u32le(ab, off + 4), matrix,
                colour: [f32le(ab, off + 72), f32le(ab, off + 76), f32le(ab, off + 80)],
                obj: u16le(ab, off + 84), model: u64le(ab, off + 88),
                alpha: if stride >= 100 { f32le(ab, off + 96) } else { 1.0 },
            });
            off += stride;
        }
        frames.insert(fr, rows);
    }
    frames
}

/// tape_to_seq.decode_anodes (object half): [u16 count][count x (u32 len, bytes)]; each object = 0x18 header
/// then 0x50-B record headers (PCW/ISP/TSP/TCW @0/4/8/0xC, texNum @0x20, vertexColorMode @0x24, alpha @0x2C,
/// RGB @0x30, payload size @0x4C) + a NaomiLib polygon-group payload.
pub fn decode_aobjs(ob: &[u8]) -> Vec<Vec<ObjRec>> {
    let mut objs = Vec::new();
    if ob.len() < 2 { return objs; }
    let n = u16le(ob, 0) as usize;
    let mut o = 2usize;
    for _ in 0..n {
        if o + 4 > ob.len() { break; }
        let ln = u32le(ob, o) as usize;
        let end = (o + 4 + ln).min(ob.len());
        let body = &ob[o + 4..end];
        o += 4 + ln;
        let mut recs = Vec::new();
        let mut q = 0x18usize;
        while q + 0x50 <= body.len() {
            let pcw = i32le(body, q);
            if pcw >= 0 { break; }
            let size = i32le(body, q + 0x4C);
            let hdr = &body[q..q + 0x50];
            let pend = (q + 0x50 + size.max(0) as usize).min(body.len());
            let pay = &body[q + 0x50..pend];
            let groups = nl_groups(pay, i32le(hdr, 0x24) == -3);
            let (pcw_w, isp_w, tsp_w) = (u32le(hdr, 0), u32le(hdr, 4), u32le(hdr, 8));
            let tcw = u32le(hdr, 0x0C);
            // synthetic-tape stash: 'sha_<16 hex>' or 8 alnum chars in hdr[0x10:0x30] (rstrip NULs)
            let mut stash: &[u8] = &hdr[0x10..0x30];
            while let Some((&0, rest)) = stash.split_last() { stash = rest; }
            let ok = stash.is_ascii() && ((stash.starts_with(b"sha_") && stash.len() == 20 && stash[4..].iter().all(|c| c.is_ascii_alphanumeric()))
                                          || (stash.len() == 8 && stash.iter().all(|c| c.is_ascii_alphanumeric())));
            let key = if ok { String::from_utf8_lossy(stash).to_string() } else { format!("{:08X}", tcw) };
            recs.push(ObjRec {
                tcw, key, pcw: pcw_w, isp: isp_w, tsp: tsp_w, texnum: i32le(hdr, 0x20),
                colour: [f32le(hdr, 0x2C), f32le(hdr, 0x30), f32le(hdr, 0x34), f32le(hdr, 0x38)],
                groups,
                centre: if ok { None } else { Some([f32le(hdr, 0x10), f32le(hdr, 0x14), f32le(hdr, 0x18)]) },
                radius: if ok { None } else { Some(f32le(hdr, 0x1C)) },
            });
            q += 0x50 + size.max(0) as usize;
        }
        objs.push(recs);
    }
    objs
}

/// tape_to_seq.nl_groups, verbatim: polygon groups -> (flags, TRIANGLE LIST) with Steam's strip winding
/// (even i: v[i], v[i+1], v[i+2]; odd i: v[i+2], v[i+1], v[i]); triple groups verbatim.
pub fn nl_groups(pay: &[u8], _has_colored: bool) -> Vec<(u32, Vec<[f32; 8]>)> {
    let mut out = Vec::new();
    let n = pay.len();
    let mut sa = 0usize;
    while sa + 8 <= n {
        let flags = u32le(pay, sa);
        let vcount = u32le(pay, sa + 4) as usize;
        if flags == 0 && vcount == 0 { break; }
        let triple = ((flags >> 3) & 1) != 0;
        sa += 8;
        let mut vs: Vec<[f32; 8]> = Vec::new();
        let mut ended = false;
        for _ in 0..vcount * (if triple { 3 } else { 1 }) {
            if sa + 8 > n { ended = true; break; }
            let head = u32le(pay, sa);
            if head == 0 { ended = true; sa += 8; break; }
            let ca: i64;
            if (0x5FF0..=0x5FFF).contains(&(head >> 16)) {
                let voff = i32le(pay, sa + 4) as i64;
                ca = sa as i64 + voff + 8;
                sa += 8;
            } else {
                ca = sa as i64;
                sa += 0x20;
            }
            if ca >= 0 && (ca as usize) + 0x20 <= n {
                let c = ca as usize;
                let mut v = [0f32; 8];
                for k in 0..8 { v[k] = f32le(pay, c + k * 4); }
                vs.push(v);
            } else {
                vs.push([0.0; 8]);
            }
        }
        let mut tris = Vec::new();
        if triple {
            let mut i = 2;
            while i < vs.len() { tris.push(vs[i - 2]); tris.push(vs[i - 1]); tris.push(vs[i]); i += 3; }
        } else {
            for i in 0..vs.len().saturating_sub(2) {
                if i % 2 == 0 { tris.push(vs[i]); tris.push(vs[i + 1]); tris.push(vs[i + 2]); }
                else { tris.push(vs[i + 2]); tris.push(vs[i + 1]); tris.push(vs[i]); }
            }
        }
        out.push((flags, tris));
        if ended { break; }
    }
    out
}
