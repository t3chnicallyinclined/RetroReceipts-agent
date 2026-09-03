//! rr-render -- the Retro Receipts tape decoder and sprite emitter, ported VERBATIM from the gated Python
//! oracle `mvc-live-skins-quarters/d3dcap/replay/tape_to_seq.py` (+ `v3gate.py` rules, `rip_gfx2_assembly.py
//! read_cells`). Python is the oracle; every function here cites the Python function it ports. No new rules.
//!
//! Layout (WORKSTREAM-CLIENT-REPLAY.review-render.md §1.2):
//!   tape    -- the gz+base64 JSON envelope -> typed frames (rows / nodes / pals / palrows / anodes / aobjs)
//!   assets  -- the PL rips `tape_to_seq.Atlas` consumes (PLxx_idx.png, _asm.json, _lut.json, GFX_DATA_00/01.BIN)
//!   camera  -- `scene_block` / `scene_VP` / `sprite_vertex_z` (fitted camera_block.json model, f32 like numpy)
//!   state   -- tsp_state codes/predict + the frozen WorldTemplate (capgate/frame_4445.pack constants)
//!   bg      -- bg_rule (frame background colour)
//!   world   -- emit_stage / emit_world / complete_prop / preamble / sort_key_record (System A)
//!   sprites -- the frame emitter + the sprite pass of `tape_to_seq.main` (LAYERZ order, owner resolve, placement law, flips,
//!              rotation, palette row per record, per-record depth, order_draws)
//!   pack    -- the in-memory asset pack (relative path -> bytes) and its loaders (atlases, stage, pages, camera)
//!   feed    -- FrameFeed: open(tape, pack) -> frame(i) -> binary FrameRecord (the browser feed)
//!   web     -- wasm-bindgen exports of the feed (feature `web`)
//!   seq     -- the RRSQ writer (same container tape_to_seq.py / pack_sequence.py write)
//!
//! The core has no std::fs and no threads: callers hand it bytes. `src/bin/emit_seq.rs` is the native driver.
pub mod util;
pub mod tape;
pub mod assets;
pub mod camera;
pub mod state;
pub mod bg;
pub mod world;
pub mod sprites;
pub mod seq;
pub mod pack;
pub mod feed;
#[cfg(feature = "web")]
pub mod web;
