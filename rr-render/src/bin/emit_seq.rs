//! emit_seq -- native driver: tape -> RRSQ (preamble + world + sprites + HUD, the full frame), the same container
//! tape_to_seq.py writes, so `tools/seq_diff.py` can gate Rust against the Python oracle draw by draw.
//!
//!   emit_seq <tape.json.gz> [--start N] [--count N] [-o out.seq]
//!            [--pack DIR | --atlas DIR --dasm DIR --stage-dir DIR --tcw-pages DIR --camera JSON]
//!            [--template PACK] [--no-world] [--no-preamble] [--no-camera] [--camera-gate] [--feed-bench]
//!            [--bank N] [--pal-lag N] [--flip-facing] [--swap-teams] [--forward-records] [--no-vflip] [--legacy-order]
//!
//! Mirrors `python tape_to_seq.py <tape> --start N --count N [--no-world] [--no-preamble] -o out.seq`.
//! The assets are read into an in-memory `AssetPack` (the same map the browser hands the wasm module) either from
//! a `tools/pack_assets.py` output directory (`--pack`) or straight from the source rips (defaults).
use rr_render::camera::closed_form_gate;
use rr_render::feed::FrameFeed;
use rr_render::pack::AssetPack;
use rr_render::seq::{load_template, SeqWriter, Template};
use rr_render::sprites::{EmitOpts, Emitter};
use rr_render::state::WorldTemplate;
use rr_render::tape::Tape;
use std::path::{Path, PathBuf};

const DEF_ATLAS: &str = r"C:\Users\trist\projects\maplecast-flycast\web\test-atlas\chars";
const DEF_DASM: &str = r"C:\Users\trist\projects\maplecast-flycast\dasm_PLDAT\Output";
const DEF_STAGES: &str = r"C:\Users\trist\projects\maplecast-flycast\atlas\stages";
const DEF_REPLAY: &str = r"C:\Users\trist\projects\mvc-live-skins-quarters\d3dcap\replay";

fn find_glob(dir: &Path, suffix: &str) -> Option<PathBuf> {
    let mut hits: Vec<PathBuf> = std::fs::read_dir(dir).ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.ends_with(suffix)).unwrap_or(false))
        .collect();
    hits.sort();
    hits.into_iter().next()
}

fn add_file(pack: &mut AssetPack, name: &str, path: &Path) -> bool {
    match std::fs::read(path) { Ok(b) => { pack.insert(name, b); true } Err(_) => false }
}

/// A pack directory written by tools/pack_assets.py: every file under it, keyed by its relative path.
fn pack_from_dir(dir: &Path) -> AssetPack {
    let mut pack = AssetPack::new();
    fn walk(pack: &mut AssetPack, root: &Path, dir: &Path) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { walk(pack, root, &p); }
            else if let Ok(rel) = p.strip_prefix(root) { add_file(pack, &rel.to_string_lossy(), &p); }
        }
    }
    walk(&mut pack, dir, dir);
    pack
}

/// The same pack assembled from the source rips (what tools/pack_assets.py copies).
fn pack_from_sources(tape: &Tape, atlas_dir: &Path, dasm_dir: &Path, stage_dir: &Path, tcw_dir: &Path, camera: Option<&Path>) -> AssetPack {
    let mut pack = AssetPack::new();
    for &cid in tape.p1_team.iter().chain(tape.p2_team.iter()) {
        let name = format!("PL{:02X}", cid);
        for suf in ["_idx.png", "_asm.json", "_lut.json"] { add_file(&mut pack, &format!("chars/{name}{suf}"), &atlas_dir.join(format!("{name}{suf}"))); }
        let ddir = dasm_dir.join(format!("{name}_DAT"));
        for suf in ["GFX_DATA_00.BIN", "GFX_DATA_01.BIN"] {
            if let Some(p) = find_glob(&ddir, suf) { add_file(&mut pack, &format!("chars/{name}_{suf}"), &p); }
        }
    }
    if let Some(sid) = tape.stage_id {
        let sj = stage_dir.join(format!("STG{:02X}.json", sid));
        if add_file(&mut pack, &format!("stage/STG{:02X}.json", sid), &sj) {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(pack.get(&format!("stage/STG{:02X}.json", sid)).unwrap()) {
                for t in v.get("textures").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
                    if let Some(f) = t.get("file").and_then(|x| x.as_str()) { add_file(&mut pack, &format!("stage/{f}"), &stage_dir.join(f)); }
                }
            }
        }
        let sdir = tcw_dir.join(format!("stage_{:02X}", sid));
        if add_file(&mut pack, &format!("tcw/stage_{:02X}/index.json", sid), &sdir.join("index.json")) {
            for e in std::fs::read_dir(&sdir).into_iter().flatten().flatten() {
                let p = e.path();
                if p.extension().map(|x| x == "png").unwrap_or(false) { add_file(&mut pack, &format!("tcw/stage_{:02X}/{}", sid, p.file_name().unwrap().to_string_lossy()), &p); }
            }
        }
    }
    if add_file(&mut pack, "tcw/index.json", &tcw_dir.join("index.json")) {
        if let Ok(idx) = serde_json::from_slice::<serde_json::Value>(pack.get("tcw/index.json").unwrap()) {
            for (k, v) in idx.as_object().cloned().unwrap_or_default() {
                let (w, h, fmt) = (v.get("w").and_then(|x| x.as_u64()).unwrap_or(0), v.get("h").and_then(|x| x.as_u64()).unwrap_or(0), v.get("fmt").and_then(|x| x.as_u64()).unwrap_or(28));
                let file = v.get("file").and_then(|f| f.as_str()).map(|s| s.to_string()).unwrap_or_else(|| format!("tcw_{}_{}x{}_f{}.png", k, w, h, fmt));
                add_file(&mut pack, &format!("tcw/{file}"), &tcw_dir.join(&file));
            }
        }
    }
    if let Some(c) = camera { add_file(&mut pack, "camera_block.json", c); }
    pack
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() { eprintln!("usage: emit_seq <tape.json.gz> [--start N] [--count N] [-o out.seq] [--pack DIR] [--atlas DIR] [--dasm DIR] [--stage-dir DIR] [--tcw-pages DIR] [--template PACK] [--camera JSON] [--no-camera] [--no-world] [--no-preamble] [--camera-gate] [--feed-bench] [--bank N] [--pal-lag N] [--flip-facing] [--swap-teams] [--forward-records] [--no-vflip] [--legacy-order]"); std::process::exit(2); }
    let mut tape_path = String::new();
    let (mut start, mut count) = (0usize, 300usize);
    let mut out: Option<String> = None;
    let mut pack_dir: Option<PathBuf> = None;
    let mut atlas_dir = PathBuf::from(DEF_ATLAS);
    let mut dasm_dir = PathBuf::from(DEF_DASM);
    let mut stage_dir = PathBuf::from(DEF_STAGES);
    let mut tcw_dir = PathBuf::from(DEF_REPLAY).join("tcw_pages");
    let mut template: Option<PathBuf> = None;
    let mut camera: Option<PathBuf> = Some(PathBuf::from(DEF_REPLAY).join("camera_block.json"));
    let (mut camera_gate, mut feed_bench) = (false, false);
    let mut opts = EmitOpts::default();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        let next = |i: &mut usize| -> String { *i += 1; args.get(*i).cloned().unwrap_or_default() };
        match a.as_str() {
            "--start" => start = next(&mut i).parse().unwrap_or(0),
            "--count" => count = next(&mut i).parse().unwrap_or(300),
            "-o" | "--out" => out = Some(next(&mut i)),
            "--pack" => pack_dir = Some(PathBuf::from(next(&mut i))),
            "--atlas" => atlas_dir = PathBuf::from(next(&mut i)),
            "--dasm" => dasm_dir = PathBuf::from(next(&mut i)),
            "--stage-dir" => stage_dir = PathBuf::from(next(&mut i)),
            "--tcw-pages" => tcw_dir = PathBuf::from(next(&mut i)),
            "--template" => template = Some(PathBuf::from(next(&mut i))),
            "--camera" => camera = Some(PathBuf::from(next(&mut i))),
            "--no-camera" => camera = None,
            "--camera-gate" => camera_gate = true,
            "--feed-bench" => feed_bench = true,
            "--no-world" => opts.no_world = true,
            "--no-preamble" => opts.no_preamble = true,
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
    for need in ["drawn[6]", "sid[6]", "sx[6]", "sy[6]", "facing[6]"] {
        if !tape.has_col(need) { eprintln!("this tape has no {need} column -- it predates tape v2 and cannot drive the emitter."); std::process::exit(1); }
    }
    let end = (start + count).min(tape.frames.len());
    if start >= end { eprintln!("no rows in that range (tape has {})", tape.frames.len()); std::process::exit(1); }
    let base = Path::new(&tape_path).file_name().and_then(|n| n.to_str()).unwrap_or("tape").to_string();
    println!("tape {}: {} frames, using {} from {}", base, tape.frames.len(), end - start, start);
    let (p1, p2) = if opts.swap_teams { (&tape.p2_team, &tape.p1_team) } else { (&tape.p1_team, &tape.p2_team) };
    println!("  P1 {:?}   P2 {:?}", p1.iter().map(|c| format!("PL{:02X}", c)).collect::<Vec<_>>(), p2.iter().map(|c| format!("PL{:02X}", c)).collect::<Vec<_>>());

    let pack = match &pack_dir {
        Some(d) => pack_from_dir(d),
        None => pack_from_sources(&tape, &atlas_dir, &dasm_dir, &stage_dir, &tcw_dir, camera.as_deref()),
    };
    println!("  asset pack: {} files{}", pack.len(), pack_dir.as_ref().map(|d| format!(" from {}", d.display())).unwrap_or_default());
    let cam = pack.camera();

    if camera_gate {
        let Some(cm) = cam.as_ref() else { eprintln!("no camera model"); std::process::exit(1); };
        for variant in ["list6", "list7", "hud"] {
            let (mut maxv, mut maxp, mut exv, mut exp, mut zv, mut zp, mut n) = (0f32, 0f32, 0usize, 0usize, 0usize, 0usize, 0usize);
            for row in start..end {
                let r = &tape.frames[row];
                let (ex, ey) = (tape.num(r, "eyeX").unwrap_or(0.0), tape.num(r, "eyeY").unwrap_or(0.0));
                let ez = tape.num(r, "zoom").unwrap_or(812.357);
                let eye = [ex as f32, ey as f32, ez as f32];
                let target = tape.arr(r, "look").filter(|l| l.len() >= 3).map(|l| [l[0] as f32, l[1] as f32, l[2] as f32]).unwrap_or([ex as f32, ey as f32, 0.0]);
                let fov = tape.num(r, "fov").unwrap_or(43.0) as f32;
                let yoff = tape.num(r, "yoff").unwrap_or(-0.41) as f32;
                let roll = tape.num(r, "roll").unwrap_or(0.0) as u16;
                if let Some((v, p)) = closed_form_gate(cm, variant, (ex, ey), eye, target, fov, yoff, roll) {
                    maxv = maxv.max(v.max_abs); maxp = maxp.max(p.max_abs); exv += v.bit_exact; exp += p.bit_exact; zv += v.signed_zero; zp += p.signed_zero; n += 1;
                }
            }
            println!("  camera gate {:<5}: rows {}  V(rows 7..10): max abs err {:.3e}, bit-exact {}/{}, signed-zero-only {}, value-differing {}   P(rows 15..18): max abs err {:.3e}, bit-exact {}/{}, signed-zero-only {}, value-differing {}",
                     variant, n, maxv, exv, n * 16, zv, n * 16 - exv - zv, maxp, exp, n * 16, zp, n * 16 - exp - zp);
        }
        return;
    }

    if feed_bench {
        // the browser path, natively: FrameRecords per row, ms/frame + bytes/frame
        let t0 = std::time::Instant::now();
        let mut feed = match FrameFeed::open(&raw, &pack, opts.clone()) { Ok(f) => f, Err(e) => { eprintln!("{e}"); std::process::exit(1); } };
        let open_ms = t0.elapsed().as_secs_f64() * 1000.0;
        for l in &feed.log { println!("  {l}"); }
        let (mut bytes, mut n) = (0usize, 0usize);
        let t1 = std::time::Instant::now();
        for row in start..end { if let Some(b) = feed.frame(row) { bytes += b.len(); n += 1; } }
        let ms = t1.elapsed().as_secs_f64() * 1000.0;
        println!("  feed: open {:.0} ms; {} FrameRecords, {:.2} ms/frame, {:.0} KB/frame avg (first-use textures/CBs included), {} draws",
                 open_ms, n, ms / n.max(1) as f64, bytes as f64 / n.max(1) as f64 / 1024.0, feed.stats().drawn_total);
        return;
    }

    let tpl: Template = match &template {
        Some(p) => match std::fs::read(p).map_err(|e| e.to_string()).and_then(|b| load_template(&b)) { Ok(t) => t, Err(e) => { eprintln!("{e}"); std::process::exit(1); } },
        None => Template::frozen(),
    };
    println!("  state copied from {} draw {} ({}/{})", tpl.source, tpl.draw_i, tpl.vs_variant, tpl.ps_variant);
    let atlases = pack.atlases(&tape.p1_team, &tape.p2_team);
    let world_on = !tape.anodes.is_empty() && !opts.no_world && cam.is_some();
    let wt = WorldTemplate::frozen();
    let mut log = Vec::new();
    let assets = if world_on { Some(pack.world_assets(tape.stage_id, &mut log)) } else { None };
    for l in &log { println!("  {l}"); }
    if world_on {
        println!("  TAPE v5: {} frames of world-space nodes, {} objects, {} pages in tape, {} in library",
                 tape.anodes.len(), tape.aobjs.len(), assets.as_ref().map(|a| a.stage_preload.len() + tape.pages.len()).unwrap_or(0), assets.as_ref().map(|a| a.lib_pages.len()).unwrap_or(0));
        println!("  world state frozen from {} (sha256 {})", wt.pack, wt.pack_sha256);
    } else if !tape.anodes.is_empty() && !opts.no_world {
        println!("  ⚠ world-space stream present but no camera_block.json -- skipping it");
    }
    let world_layouts = if world_on { Some(wt.input_layouts.clone()) } else { None };
    let mut em = Emitter::new(tape, atlases, cam, tpl.draw.clone(), wt, assets, opts);
    let mut w = SeqWriter::new(&tpl, world_layouts.as_ref(), &base);
    for row in start..end {
        if let Some(fr) = em.emit_row(row) { w.push_frame(&tpl, &em.textures, &em.cb_recs, &em.blobs, &fr); }
    }
    let out_path = out.unwrap_or_else(|| base.replace(".json.gz", "").replace(".json", "") + ".seq");
    let nframes = w.frames();
    let bytes = match w.finish() { Ok(b) => b, Err(e) => { eprintln!("{e}"); std::process::exit(1); } };
    if let Err(e) = std::fs::write(&out_path, &bytes) { eprintln!("{out_path}: {e}"); std::process::exit(1); }

    if !em.stats.held.is_empty() { println!("  rows HELD from the previous frame (no/torn node data in the tape): {:?}", em.stats.held); }
    if !em.stats.rotated_general.is_empty() {
        println!("  general-rotation parts (disassembly formula): {:?}", em.stats.rotated_general.iter().map(|(k, v)| (format!("0x{:04X}", k), *v)).collect::<Vec<_>>());
    }
    let ps = em.prop_stats();
    if !ps.is_empty() { println!("  stage props completed from the arc (tape records -> arc meshes): {:?}", ps); }
    if !em.stats.bg_stats.is_empty() { println!("  frame preamble / background colour (bg_rule, FUN_1406101b0): {:?}", em.stats.bg_stats); }
    println!("\n{} frames, {} draws ({:.1}/frame), {} distinct textures", nframes, em.stats.drawn_total, em.stats.drawn_total as f64 / nframes.max(1) as f64, em.textures.len());
    if !em.stats.world_state_total.is_empty() { println!("  world draws, D3D state from the record header (tsp_state): {:?}", em.stats.world_state_total); }
    if !em.stats.order.is_empty() { println!("  draw order (FUN_140842e30 flush): {:?}", em.stats.order); }
    if !em.stats.missing.is_empty() {
        println!("  {} draws skipped -- no assembly record:", em.stats.missing.values().sum::<u64>());
        let mut v: Vec<_> = em.stats.missing.iter().collect();
        v.sort_by(|a, b| b.1.cmp(a.1));
        for (k, n) in v.iter().take(8) { println!("     {:<24} x{}", k, n); }
    }
    println!("\nwrote {}  ({:.1} MB)", out_path, bytes.len() as f64 / 1048576.0);
}
