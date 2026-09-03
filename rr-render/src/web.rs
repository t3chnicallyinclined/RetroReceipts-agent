//! wasm-bindgen surface (feature `web`): the JS host fetches the tape and the asset pack and hands the bytes in;
//! the module returns FrameRecords (see `feed.rs`). No I/O, no threads.
//!
//! Build:  cargo build --lib --release --target wasm32-unknown-unknown --features web
//!         wasm-bindgen --target web --out-dir <replay>/wasm target/wasm32-unknown-unknown/release/rr_render.wasm
use crate::feed::FrameFeed;
use crate::pack::AssetPack;
use crate::sprites::EmitOpts;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WebFeed { inner: FrameFeed }

#[wasm_bindgen]
impl WebFeed {
    /// `pack_index_json` = `[{"name": "chars/PL2A_idx.png", "off": 0, "len": 123}, ...]` into `pack_blob`;
    /// `opts_json` = a subset of EmitOpts fields ({"no_world": bool, "no_preamble": bool, "pal_lag": n, "bank": n}).
    #[wasm_bindgen(constructor)]
    pub fn new(tape: &[u8], pack_index_json: &str, pack_blob: &[u8], opts_json: &str) -> Result<WebFeed, JsValue> {
        console_error_panic_hook::set_once();
        let idx: serde_json::Value = serde_json::from_str(pack_index_json).map_err(|e| JsValue::from_str(&format!("pack index: {e}")))?;
        let mut pack = AssetPack::new();
        for e in idx.as_array().cloned().unwrap_or_default() {
            let (name, off, len) = (e.get("name").and_then(|x| x.as_str()).unwrap_or(""), e.get("off").and_then(|x| x.as_u64()).unwrap_or(0) as usize, e.get("len").and_then(|x| x.as_u64()).unwrap_or(0) as usize);
            if name.is_empty() || off + len > pack_blob.len() { continue; }
            pack.insert(name, pack_blob[off..off + len].to_vec());
        }
        let o: serde_json::Value = serde_json::from_str(if opts_json.is_empty() { "{}" } else { opts_json }).unwrap_or(serde_json::Value::Null);
        let opts = EmitOpts {
            no_world: o.get("no_world").and_then(|x| x.as_bool()).unwrap_or(false),
            no_preamble: o.get("no_preamble").and_then(|x| x.as_bool()).unwrap_or(false),
            pal_lag: o.get("pal_lag").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
            bank: o.get("bank").and_then(|x| x.as_i64()),
            skins: [None; 6],   // resolved below once the tape's teams are known
            ..Default::default()
        };
        // opts.skins = {"p1": [{cid, colors:[16 x 0xRRGGBB]}], "p2": [...]} -- each player's OWN loadout on their side.
        // Slots 0/2/4 are P1's team in order, 1/3/5 P2's; a skin applies only where the slot's character id matches.
        let skins_json = o.get("skins").cloned();
        let mut inner = FrameFeed::open(tape, &pack, opts).map_err(|e| JsValue::from_str(&e))?;
        if let Some(sj) = skins_json {
            let t = inner.tape();
            let (p1, p2) = (t.p1_team.clone(), t.p2_team.clone());
            let mut skins: [Option<[u32; 16]>; 6] = [None; 6];
            for (side, team) in [("p1", &p1), ("p2", &p2)] {
                if let Some(list) = sj.get(side).and_then(|x| x.as_array()) {
                    for e in list {
                        let cid = e.get("cid").and_then(|x| x.as_u64()).unwrap_or(999) as u8;
                        let cols: Vec<u32> = e.get("colors").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|c| c.as_u64().map(|v| v as u32)).collect()).unwrap_or_default();
                        if cols.len() != 16 { continue; }
                        let mut arr = [0u32; 16]; arr.copy_from_slice(&cols);
                        for (k, c) in team.iter().enumerate() {
                            if *c == cid && k < 3 { let slot = if side == "p1" { k * 2 } else { k * 2 + 1 }; skins[slot] = Some(arr); }
                        }
                    }
                }
            }
            inner.set_skins(skins);
        }
        Ok(WebFeed { inner })
    }

    pub fn info(&self) -> String { self.inner.info_json() }
    pub fn frame_count(&self) -> usize { self.inner.frame_count() }
    /// The FrameRecord of tape row `i` (empty when out of range).
    pub fn frame(&mut self, i: usize) -> Vec<u8> { self.inner.frame(i).unwrap_or_default() }
}
