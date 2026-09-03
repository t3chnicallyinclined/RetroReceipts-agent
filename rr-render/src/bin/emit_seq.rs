//! emit_seq -- native driver: tape -> RRSQ of the SPRITE draws, the same container tape_to_seq.py writes, so
//! `tools/seq_diff.py` can gate Rust against the Python oracle draw by draw.
//!
//!   emit_seq <tape.json.gz> [--start N] [--count N] [-o out.seq]
//!            [--atlas DIR] [--dasm DIR] [--template frame_2574.pack] [--camera camera_block.json]
//!            [--bank N] [--pal-lag N] [--flip-facing] [--swap-teams] [--forward-records] [--no-vflip] [--legacy-order]
//!
//! Mirrors `python tape_to_seq.py <tape> --start N --count N --no-world -o out.seq`.
use rr_render::assets::{Atlas, AtlasFiles};
use rr_render::camera::CameraModel;
use rr_render::seq::{load_template, SeqWriter};
use rr_render::sprites::{EmitOpts, Emitter};
use rr_render::tape::Tape;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const DEF_ATLAS: &str = r"C:\Users\trist\projects\maplecast-flycast\web\test-atlas\chars";
const DEF_DASM: &str = r"C:\Users\trist\projects\maplecast-flycast\dasm_PLDAT\Output";
const DEF_REPLAY: &str = r"C:\Users\trist\projects\mvc-live-skins-quarters\d3dcap\replay";

fn find_glob(dir: &Path, suffix: &str) -> Option<PathBuf> {
    let mut hits: Vec<PathBuf> = std::fs::read_dir(dir).ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.ends_with(suffix)).unwrap_or(false))
        .collect();
    hits.sort();
    hits.into_iter().next()
}

fn load_atlas(atlas_dir: &Path, dasm_dir: &Path, cid: u8) -> Option<Atlas> {
    let name = format!("PL{:02X}", cid);
    // Atlas.__init__ opens _idx.png, _asm.json, _lut.json; FileNotFoundError -> None
    let idx_png = std::fs::read(atlas_dir.join(format!("{name}_idx.png"))).ok()?;
    let asm_json = std::fs::read(atlas_dir.join(format!("{name}_asm.json"))).ok()?;
    let lut_json = std::fs::read(atlas_dir.join(format!("{name}_lut.json"))).ok()?;
    let ddir = dasm_dir.join(format!("{name}_DAT"));
    let gfx2 = find_glob(&ddir, "GFX_DATA_01.BIN").and_then(|p| std::fs::read(p).ok());
    let gfx1 = find_glob(&ddir, "GFX_DATA_00.BIN").and_then(|p| std::fs::read(p).ok());
    match Atlas::from_files(cid, &AtlasFiles { idx_png, asm_json, lut_json, gfx1, gfx2 }) {
        Ok(a) => Some(a),
        Err(e) => { eprintln!("  {name}: {e}"); None }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() { eprintln!("usage: emit_seq <tape.json.gz> [--start N] [--count N] [-o out.seq] [--atlas DIR] [--dasm DIR] [--template PACK] [--camera JSON] [--no-camera] [--bank N] [--pal-lag N] [--flip-facing] [--swap-teams] [--forward-records] [--no-vflip] [--legacy-order]"); std::process::exit(2); }
    let mut tape_path = String::new();
    let (mut start, mut count) = (0usize, 300usize);
    let mut out: Option<String> = None;
    let mut atlas_dir = PathBuf::from(DEF_ATLAS);
    let mut dasm_dir = PathBuf::from(DEF_DASM);
    let mut template = PathBuf::from(DEF_REPLAY).join("frame_2574.pack");
    let mut camera: Option<PathBuf> = Some(PathBuf::from(DEF_REPLAY).join("camera_block.json"));
    let mut opts = EmitOpts::default();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        let next = |i: &mut usize| -> String { *i += 1; args.get(*i).cloned().unwrap_or_default() };
        match a.as_str() {
            "--start" => start = next(&mut i).parse().unwrap_or(0),
            "--count" => count = next(&mut i).parse().unwrap_or(300),
            "-o" | "--out" => out = Some(next(&mut i)),
            "--atlas" => atlas_dir = PathBuf::from(next(&mut i)),
            "--dasm" => dasm_dir = PathBuf::from(next(&mut i)),
            "--template" => template = PathBuf::from(next(&mut i)),
            "--camera" => camera = Some(PathBuf::from(next(&mut i))),
            "--no-camera" => camera = None,
            "--bank" => opts.bank = next(&mut i).parse().ok(),
            "--pal-lag" => opts.pal_lag = next(&mut i).parse().unwrap_or(0),
            "--flip-facing" => opts.flip_facing = true,
            "--swap-teams" => opts.swap_teams = true,
            "--forward-records" => opts.forward_records = true,
            "--no-vflip" => opts.no_vflip = true,
            "--legacy-order" => opts.legacy_order = true,
            _ if a.starts_with("--") => { eprintln!("unknown option {a}"); std::process::exit(2); }
            _ => tape_path = a.clone(),
        }
        i += 1;
    }
    let raw = match std::fs::read(&tape_path) { Ok(b) => b, Err(e) => { eprintln!("{tape_path}: {e}"); std::process::exit(1); } };
    let tape = match Tape::decode(&raw) { Ok(t) => t, Err(e) => { eprintln!("{e}"); std::process::exit(1); } };
    if !tape.nodes.is_empty() {
        println!("  TAPE v{}: {} frames of ordered nodes, {} palettes, stride {}", if tape.nodes_stride >= 50 { 4 } else { 3 }, tape.nodes.len(), tape.pals.len(), tape.nodes_stride);
    }
    if !tape.palrows.is_empty() { println!("  TAPE v5 palrows: {} frames of 6x8 engine-resolved palette rows", tape.palrows.len()); }
    if !tape.anodes.is_empty() { println!("  TAPE v5: {} frames of world-space nodes, {} objects (decoded; world pass = W2)", tape.anodes.len(), tape.aobjs.len()); }
    for need in ["drawn[6]", "sid[6]", "sx[6]", "sy[6]", "facing[6]"] {
        if !tape.has_col(need) { eprintln!("this tape has no {need} column -- it predates tape v2 and cannot drive the emitter."); std::process::exit(1); }
    }
    let end = (start + count).min(tape.frames.len());
    if start >= end { eprintln!("no rows in that range (tape has {})", tape.frames.len()); std::process::exit(1); }
    let base = Path::new(&tape_path).file_name().and_then(|n| n.to_str()).unwrap_or("tape").to_string();
    println!("tape {}: {} frames, using {} from {}", base, tape.frames.len(), end - start, start);
    let (p1, p2) = if opts.swap_teams { (&tape.p2_team, &tape.p1_team) } else { (&tape.p1_team, &tape.p2_team) };
    println!("  P1 {:?}   P2 {:?}", p1.iter().map(|c| format!("PL{:02X}", c)).collect::<Vec<_>>(), p2.iter().map(|c| format!("PL{:02X}", c)).collect::<Vec<_>>());

    let mut atlases: HashMap<u8, Atlas> = HashMap::new();
    for &cid in tape.p1_team.iter().chain(tape.p2_team.iter()) {
        if atlases.contains_key(&cid) { continue; }
        if let Some(a) = load_atlas(&atlas_dir, &dasm_dir, cid) { atlases.insert(cid, a); }
    }
    let cam = camera.and_then(|p| std::fs::read(&p).ok()).and_then(|b| CameraModel::from_json(&b).map_err(|e| eprintln!("  {e}")).ok());
    let tpl_bytes = match std::fs::read(&template) { Ok(b) => b, Err(e) => { eprintln!("{}: {e}", template.display()); std::process::exit(1); } };
    let tpl = match load_template(&tpl_bytes) { Ok(t) => t, Err(e) => { eprintln!("{e}"); std::process::exit(1); } };
    println!("  state copied from {} draw {} ({}/{})", template.file_name().and_then(|n| n.to_str()).unwrap_or(""), tpl.draw_i, tpl.vs_variant, tpl.ps_variant);

    let mut em = Emitter::new(&tape, &atlases, cam.as_ref(), opts);
    let mut w = SeqWriter::new(&tpl, &base);
    for row in start..end {
        if let Some(fr) = em.emit_row(row) { w.push_frame(&tpl, &em.textures, &fr); }
    }
    let out_path = out.unwrap_or_else(|| base.replace(".json.gz", "").replace(".json", "") + ".seq");
    let nframes = w.frames();
    let bytes = match w.finish() { Ok(b) => b, Err(e) => { eprintln!("{e}"); std::process::exit(1); } };
    if let Err(e) = std::fs::write(&out_path, &bytes) { eprintln!("{out_path}: {e}"); std::process::exit(1); }

    if !em.stats.held.is_empty() { println!("  rows HELD from the previous frame (no/torn node data in the tape): {:?}", em.stats.held); }
    if !em.stats.rotated_general.is_empty() {
        println!("  general-rotation parts (disassembly formula): {:?}", em.stats.rotated_general.iter().map(|(k, v)| (format!("0x{:04X}", k), *v)).collect::<Vec<_>>());
    }
    println!("\n{} frames, {} draws ({:.1}/frame), {} distinct textures", nframes, em.stats.drawn_total, em.stats.drawn_total as f64 / nframes.max(1) as f64, em.textures.len());
    if !em.stats.order.is_empty() { println!("  draw order (FUN_140842e30 flush): {:?}", em.stats.order); }
    if !em.stats.missing.is_empty() {
        println!("  {} draws skipped -- no assembly record:", em.stats.missing.values().sum::<u64>());
        let mut v: Vec<_> = em.stats.missing.iter().collect();
        v.sort_by(|a, b| b.1.cmp(a.1));
        for (k, n) in v.iter().take(8) { println!("     {:<24} x{}", k, n); }
    }
    println!("\nwrote {}  ({:.1} MB)", out_path, bytes.len() as f64 / 1048576.0);
}
