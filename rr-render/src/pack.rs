//! ASSET PACK -- the exact files the emitter reads, as an in-memory map of relative path -> bytes, so the same
//! loader serves the native bin (files from disk) and the browser (files fetched by the JS host and passed in).
//! Layout (`tools/pack_assets.py` writes it, `manifest.json` lists it):
//!   chars/PLxx_idx.png  chars/PLxx_asm.json  chars/PLxx_lut.json  chars/PLxx_GFX_DATA_00.BIN  chars/PLxx_GFX_DATA_01.BIN
//!   stage/STGxx.json  stage/STGxx_tNN.png            (arc rip; the PNGs are the WRONG rip_stage decode = Python fallback)
//!   tcw/stage_XX/index.json + PNGs                   (host-decoded stage pages)
//!   tcw/index.json + PNGs                            (the capture-derived TCW library)
//!   camera_block.json
//! The frozen templates are compiled into the crate (`src/frozen/*.json`). No I/O here.
use crate::assets::{Atlas, AtlasFiles};
use crate::camera::CameraModel;
use crate::tape::Page;
use crate::world::{StageRip, WorldAssets};
use std::collections::HashMap;

#[derive(Default)]
pub struct AssetPack { files: HashMap<String, Vec<u8>> }

/// `np.array(Image.open(fn).convert('RGBA')).tobytes()` (fmt 28) or `np.array(im)[:, :, 0]` (fmt 61).
pub fn png_page(bytes: &[u8], fmt: u32) -> Option<Page> {
    let mut dec = png::Decoder::new(bytes);
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    let ch = info.color_type.samples();
    let (w, h, line) = (info.width as usize, info.height as usize, info.line_size);
    let mut data = Vec::with_capacity(w * h * if fmt == 61 { 1 } else { 4 });
    for y in 0..h {
        let row = &buf[y * line..y * line + w * ch];
        for x in 0..w {
            let px = &row[x * ch..x * ch + ch];
            if fmt == 61 { data.push(px[0]); continue; }
            let rgba = match ch { 1 => [px[0], px[0], px[0], 255], 2 => [px[0], px[0], px[0], px[1]], 3 => [px[0], px[1], px[2], 255], _ => [px[0], px[1], px[2], px[3]] };
            data.extend_from_slice(&rgba);
        }
    }
    Some(Page { w: w as u32, h: h as u32, fmt, data })
}

impl AssetPack {
    pub fn new() -> AssetPack { AssetPack::default() }
    pub fn insert(&mut self, name: &str, bytes: Vec<u8>) { self.files.insert(name.replace('\\', "/"), bytes); }
    pub fn get(&self, name: &str) -> Option<&Vec<u8>> { self.files.get(name) }
    pub fn len(&self) -> usize { self.files.len() }
    pub fn is_empty(&self) -> bool { self.files.is_empty() }
    pub fn names(&self) -> Vec<String> { let mut v: Vec<String> = self.files.keys().cloned().collect(); v.sort(); v }

    /// `Atlas.get(base, cid)`: None when any of the three atlas files is missing (FileNotFoundError semantics).
    pub fn atlas(&self, cid: u8) -> Option<Atlas> {
        let name = format!("PL{:02X}", cid);
        let idx_png = self.get(&format!("chars/{name}_idx.png"))?.clone();
        let asm_json = self.get(&format!("chars/{name}_asm.json"))?.clone();
        let lut_json = self.get(&format!("chars/{name}_lut.json"))?.clone();
        let gfx1 = self.get(&format!("chars/{name}_GFX_DATA_00.BIN")).cloned();
        let gfx2 = self.get(&format!("chars/{name}_GFX_DATA_01.BIN")).cloned();
        Atlas::from_files(cid, &AtlasFiles { idx_png, asm_json, lut_json, gfx1, gfx2 }).ok()
    }

    /// The six roster atlases (union of both teams), keyed by cid.
    pub fn atlases(&self, p1: &[u8], p2: &[u8]) -> HashMap<u8, Atlas> {
        let mut out = HashMap::new();
        for &cid in p1.iter().chain(p2.iter()) {
            if out.contains_key(&cid) { continue; }
            if let Some(a) = self.atlas(cid) { out.insert(cid, a); }
        }
        out
    }

    pub fn camera(&self) -> Option<CameraModel> { CameraModel::from_json(self.get("camera_block.json")?).ok() }

    /// What tape_to_seq.main() opens when `wt` exists: STGxx.json (+ STGxx_tNN.png), tcw_pages/stage_XX, tcw_pages/index.json (+ PNGs).
    pub fn world_assets(&self, stage_id: Option<i64>, log: &mut Vec<String>) -> WorldAssets {
        let mut stage_rip = None;
        let mut stage_preload = Vec::new();
        if let Some(sid) = stage_id {
            if let Some(b) = self.get(&format!("stage/STG{:02X}.json", sid)) {
                match StageRip::from_json(b) {
                    Ok(mut rip) => {
                        log.push(format!("stage {:02X}: {} arc textures available (TCW 0xC10 + index)", sid, rip.texture_files.len()));
                        for (i, f) in rip.texture_files.clone().iter().enumerate() {
                            if let Some(pb) = self.get(&format!("stage/{f}")) { rip.tex_pages[i] = png_page(pb, 28); }
                        }
                        stage_rip = Some(rip);
                    }
                    Err(e) => log.push(format!("stage/STG{:02X}.json: {e}", sid)),
                }
                let sdir = format!("tcw/stage_{:02X}", sid);
                if let Some(b) = self.get(&format!("{sdir}/index.json")) {
                    if let Ok(sj) = serde_json::from_slice::<serde_json::Value>(b) {
                        let pages = sj.get("pages").and_then(|p| p.as_object()).cloned()
                            .unwrap_or_else(|| sj.as_object().map(|o| o.iter().filter(|(k, _)| k.as_str() != "meta").map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default());
                        let mut npre = 0;
                        for (k, v) in pages {
                            let Some(file) = v.get("file").and_then(|f| f.as_str()) else { continue };
                            if let Some(p) = self.get(&format!("{sdir}/{file}")).and_then(|pb| png_page(pb, 28)) { stage_preload.push((k, p)); npre += 1; }
                        }
                        log.push(format!("stage {:02X}: {} host-decoded pages from {}", sid, npre, sdir));
                    }
                }
            } else {
                log.push(format!("stage {}: no arc rip in the pack", sid));
            }
        }
        let mut lib_pages = HashMap::new();
        if let Some(b) = self.get("tcw/index.json") {
            if let Ok(idx) = serde_json::from_slice::<serde_json::Value>(b) {
                for (k, v) in idx.as_object().cloned().unwrap_or_default() {
                    let (w, h, fmt) = (v.get("w").and_then(|x| x.as_u64()).unwrap_or(0), v.get("h").and_then(|x| x.as_u64()).unwrap_or(0), v.get("fmt").and_then(|x| x.as_u64()).unwrap_or(28) as u32);
                    let file = v.get("file").and_then(|f| f.as_str()).map(|s| s.to_string()).unwrap_or_else(|| format!("tcw_{}_{}x{}_f{}.png", k, w, h, fmt));
                    if let Some(pg) = self.get(&format!("tcw/{file}")).and_then(|pb| png_page(pb, fmt)) { lib_pages.insert(k, pg); }
                }
            }
        }
        // The twelve runtime-patched HUD slots (TCW 0xC9A..0xCA5) are per-CHARACTER, not per-bank: the pack
        // ships every roster character's four 0x800-B DAT pages and `world::hud_portrait_pages` picks the two
        // that this tape's slot/assist-type combination patches in. Without this the capture library's pages
        // (a different roster) are used -- the "wrong character's portrait/name" bug.
        let mut portrait_pages = HashMap::new();
        if let Some(b) = self.get("portraits/index.json") {
            if let Ok(idx) = serde_json::from_slice::<serde_json::Value>(b) {
                for (cid, ent) in idx.get("chars").and_then(|c| c.as_object()).cloned().unwrap_or_default() {
                    let Ok(cid) = cid.parse::<u8>() else { continue };
                    for (k, pv) in ent.get("pages").and_then(|p| p.as_array()).cloned().unwrap_or_default().iter().enumerate() {
                        let Some(file) = pv.get("file").and_then(|f| f.as_str()) else { continue };
                        let fmt = pv.get("fmt").and_then(|x| x.as_u64()).unwrap_or(28) as u32;
                        if let Some(pg) = self.get(&format!("portraits/{file}")).and_then(|pb| png_page(pb, fmt)) {
                            portrait_pages.insert((cid, k), pg);
                        }
                    }
                }
            }
            log.push(format!("portraits: {} character DAT pages (HUD TCW 0xC9A..0xCA5)", portrait_pages.len()));
        }
        WorldAssets { stage_rip, stage_preload, lib_pages, portrait_pages }
    }
}
