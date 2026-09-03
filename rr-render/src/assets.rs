//! ASSETS -- the PL rips `tape_to_seq.Atlas` consumes, byte for byte the same files:
//!   PLxx_idx.png   (R channel = palette index 0..15, 255 = transparent)      -> `idx`
//!   PLxx_asm.json  (`parts` {sel: {x,y,w,h}}, `assemblies` {sid: [{part,dx,dy,..}]})  -> `parts`, `asm`
//!   PLxx_lut.json  (`banks` [[r,g,b,a] x 16] x N, `bodyBank`)                -> `banks`, `body_bank`
//!   dasm_PLDAT/Output/PLxx_DAT/*GFX_DATA_01.BIN (raw GFX2: per-record FLAGS word -> palette row + flip bits,
//!       through `rip_gfx2_assembly.read_cells`)                             -> `rows`, `flags`
//!   dasm_PLDAT/Output/PLxx_DAT/*GFX_DATA_00.BIN (GFX1 header [lw][lh][sw][sh] in 8 px units)  -> `dims`
//! No I/O here: the caller supplies the bytes (`AtlasFiles`). ROM-derived; never committed.
use crate::tape::Pal256;
use crate::util::{sha8, u16le, u32le, Res};
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Copy, Debug)]
pub struct Rect { pub x: u32, pub y: u32, pub w: u32, pub h: u32 }

/// One `_asm.json` assembly record: `dx`/`dy` are the CUMULATIVE pen (rip_gfx2_assembly.py writes
/// `"dx": r["dx"], "dy": r["dy"]  # CUMULATIVE pen (absolute in cell space)`).
#[derive(Clone, Copy, Debug)]
pub struct AsmRec { pub part: u32, pub dx: i64, pub dy: i64 }

/// The bytes of the five files. `gfx1`/`gfx2` are optional exactly as the Python's `glob(...)` may be empty.
pub struct AtlasFiles { pub idx_png: Vec<u8>, pub asm_json: Vec<u8>, pub lut_json: Vec<u8>, pub gfx1: Option<Vec<u8>>, pub gfx2: Option<Vec<u8>> }

/// A row-major 8-bit bitmap (numpy 2-D uint8 array semantics).
#[derive(Clone, Debug)]
pub struct Bitmap { pub w: usize, pub h: usize, pub data: Vec<u8> }

impl Bitmap {
    /// numpy `a[::-1]`
    pub fn flip_v(&self) -> Bitmap {
        let mut d = Vec::with_capacity(self.data.len());
        for r in (0..self.h).rev() { d.extend_from_slice(&self.data[r * self.w..(r + 1) * self.w]); }
        Bitmap { w: self.w, h: self.h, data: d }
    }
    /// numpy `a[:, ::-1]`
    pub fn flip_h(&self) -> Bitmap {
        let mut d = Vec::with_capacity(self.data.len());
        for r in 0..self.h { d.extend(self.data[r * self.w..(r + 1) * self.w].iter().rev()); }
        Bitmap { w: self.w, h: self.h, data: d }
    }
    /// numpy `a[:rows, :cols]` (clamped like numpy slicing).
    pub fn crop_tl(&self, rows: usize, cols: usize) -> Bitmap {
        let h = rows.min(self.h); let w = cols.min(self.w);
        let mut d = Vec::with_capacity(w * h);
        for r in 0..h { d.extend_from_slice(&self.data[r * self.w..r * self.w + w]); }
        Bitmap { w, h, data: d }
    }
    pub fn sha8(&self) -> String { sha8(&self.data) }
}

/// A raw GFX2 record as `rip_gfx2_assembly.read_cells` returns it: `dx`/`dy` = the running pen, `flags` @+4, `sel` @+6.
#[derive(Clone, Copy, Debug)]
pub struct RawRec { pub dx: i64, pub dy: i64, pub ddx: i16, pub ddy: i16, pub flags: u16, pub sel: u16 }

/// `rip_gfx2_assembly.read_cells(gfx2)` verbatim: `{ cell_index: [records] }` for every valid cell
/// (`cnt == 0 or cnt > 64 or overflow` -> skipped), cumulative pen `px += dx; py -= dy`.
pub fn read_cells(gfx2: &[u8]) -> (BTreeMap<u32, Vec<RawRec>>, u32) {
    let mut cells = BTreeMap::new();
    if gfx2.len() < 4 { return (cells, 0); }
    let n = u32le(gfx2, 0) >> 2;
    let mut tbl = Vec::with_capacity(n as usize);
    for i in 0..n as usize {
        if i * 4 + 4 > gfx2.len() { break; }   // struct.error in Python
        tbl.push(u32le(gfx2, i * 4) as usize);
    }
    for (idx, &off) in tbl.iter().enumerate() {
        if off + 2 > gfx2.len() { continue; }
        let cnt = u16le(gfx2, off) as usize;
        if cnt == 0 || cnt > 64 || off + 2 + cnt * 8 > gfx2.len() { continue; }
        let mut recs = Vec::with_capacity(cnt);
        let mut p = off + 2;
        let (mut px, mut py) = (0i64, 0i64);
        for _ in 0..cnt {
            let dx = i16::from_le_bytes([gfx2[p], gfx2[p + 1]]);
            let dy = i16::from_le_bytes([gfx2[p + 2], gfx2[p + 3]]);
            let flags = u16le(gfx2, p + 4);
            let sel = u16le(gfx2, p + 6);
            p += 8;
            px += dx as i64;
            py -= dy as i64;
            recs.push(RawRec { dx: px, dy: py, ddx: dx, ddy: dy, flags, sel });
        }
        cells.insert(idx as u32, recs);
    }
    (cells, n)
}

pub struct Atlas {
    pub name: String,
    pub idx: Bitmap,
    pub parts: HashMap<u32, Rect>,
    pub asm: HashMap<u32, Vec<AsmRec>>,
    pub banks: Vec<Vec<[u8; 4]>>,
    pub body_bank: i64,
    /// per cell: `((flags >> 4) & 7)` per record
    pub rows: HashMap<u32, Vec<u8>>,
    /// per cell: the raw FLAGS word per record (0x8000 hflip, 0x4000 vflip)
    pub flags: HashMap<u32, Vec<u16>>,
    /// per part selector: (sw, sh, lw, lh) in 8 px units from the GFX1 header [lw][lh][sw][sh]
    pub dims: HashMap<u32, (u8, u8, u8, u8)>,
}

fn decode_png_channel0(png_bytes: &[u8]) -> Res<Bitmap> {
    let mut dec = png::Decoder::new(png_bytes);
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| format!("png: {e}"))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| format!("png frame: {e}"))?;
    let ch = info.color_type.samples();
    let (w, h) = (info.width as usize, info.height as usize);
    let line = info.line_size;
    let mut data = Vec::with_capacity(w * h);
    for y in 0..h {
        let row = &buf[y * line..y * line + w * ch];
        for x in 0..w { data.push(row[x * ch]); }
    }
    Ok(Bitmap { w, h, data })
}

impl Atlas {
    /// `Atlas.__init__(base, cid)`.
    pub fn from_files(cid: u8, f: &AtlasFiles) -> Res<Atlas> {
        let name = format!("PL{:02X}", cid);
        let idx = decode_png_channel0(&f.idx_png)?;
        let a: serde_json::Value = serde_json::from_slice(&f.asm_json).map_err(|e| format!("{name}_asm.json: {e}"))?;
        let mut parts = HashMap::new();
        if let Some(p) = a.get("parts").and_then(|x| x.as_object()) {
            for (k, v) in p {
                if let Ok(sel) = k.parse::<u32>() {
                    let g = |n: &str| v.get(n).and_then(|x| x.as_i64()).unwrap_or(0) as u32;
                    parts.insert(sel, Rect { x: g("x"), y: g("y"), w: g("w"), h: g("h") });
                }
            }
        }
        let mut asm = HashMap::new();
        if let Some(p) = a.get("assemblies").and_then(|x| x.as_object()) {
            for (k, v) in p {
                if let (Ok(sid), Some(list)) = (k.parse::<u32>(), v.as_array()) {
                    let recs = list.iter().map(|r| AsmRec {
                        part: r.get("part").and_then(|x| x.as_i64()).unwrap_or(0) as u32,
                        dx: r.get("dx").and_then(|x| x.as_i64()).unwrap_or(0),
                        dy: r.get("dy").and_then(|x| x.as_i64()).unwrap_or(0),
                    }).collect();
                    asm.insert(sid, recs);
                }
            }
        }
        let lut: serde_json::Value = serde_json::from_slice(&f.lut_json).map_err(|e| format!("{name}_lut.json: {e}"))?;
        let mut banks = Vec::new();
        if let Some(b) = lut.get("banks").and_then(|x| x.as_array()) {
            for bank in b {
                let cols: Vec<[u8; 4]> = bank.as_array().map(|a| a.iter().map(|c| {
                    let c = c.as_array().cloned().unwrap_or_default();
                    let g = |i: usize| c.get(i).and_then(|x| x.as_i64()).unwrap_or(0) as u8;
                    [g(0), g(1), g(2), g(3)]
                }).collect()).unwrap_or_default();
                banks.push(cols);
            }
        }
        let body_bank = lut.get("bodyBank").and_then(|x| x.as_i64()).unwrap_or(0);
        // PER-RECORD PALETTE ROW + FLAGS from the raw GFX2 (Atlas.__init__: `RIP.read_cells(...)[0]`)
        let (mut rows, mut flags) = (HashMap::new(), HashMap::new());
        if let Some(g2) = &f.gfx2 {
            let (cells, _) = read_cells(g2);
            for (sel, recs) in cells {
                rows.insert(sel, recs.iter().map(|r| ((r.flags >> 4) & 7) as u8).collect());
                flags.insert(sel, recs.iter().map(|r| r.flags).collect());
            }
        }
        // GFX1 LOGICAL DIMS (Atlas.__init__): header [lw][lh][sw][sh]
        let mut dims = HashMap::new();
        if let Some(b) = &f.gfx1 {
            if b.len() >= 4 {
                let n = (u32le(b, 0) >> 2) as usize;
                for sel in 0..n {
                    if sel * 4 + 4 > b.len() { break; }
                    let o = u32le(b, sel * 4) as usize;
                    if o + 4 <= b.len() {
                        let (lw, lh, sw, sh) = (b[o], b[o + 1], b[o + 2], b[o + 3]);
                        dims.insert(sel as u32, (sw, sh, lw, lh));
                    }
                }
            }
        }
        Ok(Atlas { name, idx, parts, asm, banks, body_bank, rows, flags, dims })
    }

    /// `Atlas.row_of(sel, ri)`
    pub fn row_of(&self, sel: u32, ri: usize) -> u8 {
        match self.rows.get(&sel) { Some(r) if ri < r.len() => r[ri], _ => 0 }
    }

    /// `Atlas.flag_of(sel, ri)`
    pub fn flag_of(&self, sel: u32, ri: usize) -> u16 {
        match self.flags.get(&sel) { Some(r) if ri < r.len() => r[ri], _ => 0 }
    }

    /// `Atlas.part_bitmap(pid, vflip, logical)` -> (bitmap, pw, ph). EVERY PART IS STORED UPSIDE DOWN
    /// (verified against scene_5630); a scale-walker record (`logical`) samples the top-left logical
    /// sub-rect of the storage block (GFX1 header) and is placed by that size.
    /// The returned `pw, ph` are the values the Python reports (cw, ch), and the bitmap is what numpy
    /// slicing actually yields (clamped) -- identical whenever the rect covers the logical box.
    pub fn part_bitmap(&self, pid: u32, vflip: bool, logical: bool) -> Option<(Bitmap, u32, u32)> {
        let p = *self.parts.get(&pid)?;
        // a = idx[y:y+h, x:x+w] (numpy clamps)
        let y0 = (p.y as usize).min(self.idx.h); let y1 = ((p.y + p.h) as usize).min(self.idx.h);
        let x0 = (p.x as usize).min(self.idx.w); let x1 = ((p.x + p.w) as usize).min(self.idx.w);
        let (aw, ah) = (x1 - x0, y1 - y0);
        let mut data = Vec::with_capacity(aw * ah);
        for y in y0..y1 { data.extend_from_slice(&self.idx.data[y * self.idx.w + x0..y * self.idx.w + x1]); }
        let a = Bitmap { w: aw, h: ah, data };
        if logical {
            if let Some(&(sw, sh, lw, lh)) = self.dims.get(&pid) {
                let cw = if 0 < lw && lw <= sw { lw as u32 * 8 } else { p.w };
                let ch = if 0 < lh && lh <= sh { lh as u32 * 8 } else { p.h };
                if (cw, ch) != (p.w, p.h) {
                    let b = a.flip_v().crop_tl(ch as usize, cw as usize);   // top-left in DC (top-down) orientation
                    return Some((if vflip { b } else { b.flip_v() }, cw, ch));
                }
            }
        }
        Some((if vflip { a.flip_v() } else { a }, p.w, p.h))
    }

    /// `Atlas.palette(bank, costume)`: bank None -> 8*costume; `banks[bank % len(banks)]` into a 256x4 array.
    pub fn palette(&self, bank: Option<i64>, costume: i64) -> Pal256 {
        let bank = bank.unwrap_or(8 * costume);
        let mut pal: Pal256 = [[0u8; 4]; 256];
        if self.banks.is_empty() { return pal; }
        let b = &self.banks[bank.rem_euclid(self.banks.len() as i64) as usize];
        for (i, c) in b.iter().take(256).enumerate() { pal[i] = *c; }
        pal
    }
}
