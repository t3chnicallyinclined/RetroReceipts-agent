//! emit_seq -- native driver: tape -> RRSQ (preamble + world + sprites + HUD, the full frame), the same container
//! tape_to_seq.py writes, so `tools/seq_diff.py` can gate Rust against the Python oracle draw by draw.
//!
//!   emit_seq <tape.json.gz> [--start N] [--count N] [-o out.seq]
//!            [--atlas DIR] [--dasm DIR] [--stage-dir DIR] [--tcw-pages DIR] [--template PACK] [--camera JSON]
//!            [--no-world] [--no-preamble] [--no-camera] [--camera-gate]
//!            [--bank N] [--pal-lag N] [--flip-facing] [--swap-teams] [--forward-records] [--no-vflip] [--legacy-order]
//!
//! Mirrors `python tape_to_seq.py <tape> --start N --count N [--no-world] [--no-preamble] -o out.seq`.
use rr_render::assets::{Atlas, AtlasFiles};
use rr_render::camera::{closed_form_gate, CameraModel};
use rr_render::seq::{load_template, SeqWriter, Template};
use rr_render::sprites::{EmitOpts, Emitter};
use rr_render::state::WorldTemplate;
use rr_render::tape::{Page, Tape};
use rr_render::world::{StageRip, WorldAssets};
use std::collections::HashMap;
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

fn load_atlas(atlas_dir: &Path, dasm_dir: &Path, cid: u8) -> Option<Atlas> {
    let name = format!("PL{:02X}", cid);
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

/// `np.array(Image.open(fn).convert('RGBA')).tobytes()` (fmt 28) or `np.array(im)[:, :, 0]` (fmt 61).
fn load_png_page(path: &Path, fmt: u32) -> Option<Page> {
    let bytes = std::fs::read(path).ok()?;
    let mut dec = png::Decoder::new(&bytes[..]);
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

/// The world assets tape_to_seq.main() opens when `wt` exists: STGxx.json (+ STGxx_tNN.png), tcw_pages/stage_XX,
/// tcw_pages/index.json (+ PNGs).
fn load_world_assets(stage_dir: &Path, tcw_dir: &Path, stage_id: Option<i64>) -> WorldAssets {
    let mut stage_rip = None;
    let mut stage_preload = Vec::new();
    if let Some(sid) = stage_id {
        let sj = stage_dir.join(format!("STG{:02X}.json", sid));
        if let Ok(b) = std::fs::read(&sj) {
            match StageRip::from_json(&b) {
                Ok(mut rip) => {
                    println!("  stage {:02X}: {} arc textures available (TCW 0xC10 + index)", sid, rip.texture_files.len());
                    for (i, f) in rip.texture_files.clone().iter().enumerate() {
                        let p = stage_dir.join(f);
                        if p.exists() { rip.tex_pages[i] = load_png_page(&p, 28); }
                    }
                    stage_rip = Some(rip);
                }
                Err(e) => eprintln!("  {}: {e}", sj.display()),
            }
            let sdir = tcw_dir.join(format!("stage_{:02X}", sid));
            if let Ok(b) = std::fs::read(sdir.join("index.json")) {
                if let Ok(sj) = serde_json::from_slice::<serde_json::Value>(&b) {
                    let pages = sj.get("pages").and_then(|p| p.as_object()).cloned()
                        .unwrap_or_else(|| sj.as_object().map(|o| o.iter().filter(|(k, _)| k.as_str() != "meta").map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default());
                    let mut npre = 0;
                    for (k, v) in pages {
                        let Some(file) = v.get("file").and_then(|f| f.as_str()) else { continue };
                        if let Some(p) = load_png_page(&sdir.join(file), 28) { stage_preload.push((k, p)); npre += 1; }
                    }
                    println!("  stage {:02X}: {} host-decoded pages from {}", sid, npre, sdir.display());
                }
            }
        } else {
            println!("  stage {}: no arc rip found in {}", sid, stage_dir.display());
        }
    }
    let mut lib_pages = HashMap::new();
    if let Ok(b) = std::fs::read(tcw_dir.join("index.json")) {
        if let Ok(idx) = serde_json::from_slice::<serde_json::Value>(&b) {
            for (k, v) in idx.as_object().cloned().unwrap_or_default() {
                let (w, h, fmt) = (v.get("w").and_then(|x| x.as_u64()).unwrap_or(0), v.get("h").and_then(|x| x.as_u64()).unwrap_or(0), v.get("fmt").and_then(|x| x.as_u64()).unwrap_or(28) as u32);
                let file = v.get("file").and_then(|f| f.as_str()).map(|s| s.to_string()).unwrap_or_else(|| format!("tcw_{}_{}x{}_f{}.png", k, w, h, fmt));
                let p = tcw_dir.join(&file);
                if p.exists() { if let Some(pg) = load_png_page(&p, fmt) { lib_pages.insert(k, pg); } }
            }
        }
    }
    WorldAssets { stage_rip, stage_preload, lib_pages }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() { eprintln!("usage: emit_seq <tape.json.gz> [--start N] [--count N] [-o out.seq] [--atlas DIR] [--dasm DIR] [--stage-dir DIR] [--tcw-pages DIR] [--template PACK] [--camera JSON] [--no-camera] [--no-world] [--no-preamble] [--camera-gate] [--bank N] [--pal-lag N] [--flip-facing] [--swap-teams] [--forward-records] [--no-vflip] [--legacy-order]"); std::process::exit(2); }
    let mut tape_path = String::new();
    let (mut start, mut count) = (0usize, 300usize);
    let mut out: Option<String> = None;
    let mut atlas_dir = PathBuf::from(DEF_ATLAS);
    let mut dasm_dir = PathBuf::from(DEF_DASM);
    let mut stage_dir = PathBuf::from(DEF_STAGES);
    let mut tcw_dir = PathBuf::from(DEF_REPLAY).join("tcw_pages");
    let mut template: Option<PathBuf> = None;
    let mut camera: Option<PathBuf> = Some(PathBuf::from(DEF_REPLAY).join("camera_block.json"));
    let mut camera_gate = false;
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
            "--stage-dir" => stage_dir = PathBuf::from(next(&mut i)),
            "--tcw-pages" => tcw_dir = PathBuf::from(next(&mut i)),
            "--template" => template = Some(PathBuf::from(next(&mut i))),
            "--camera" => camera = Some(PathBuf::from(next(&mut i))),
            "--no-camera" => camera = None,
            "--camera-gate" => camera_gate = true,
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

    let cam = camera.and_then(|p| std::fs::read(&p).ok()).and_then(|b| CameraModel::from_json(&b).map_err(|e| eprintln!("  {e}")).ok());

    if camera_gate {
        // closed form vs the fitted block for every row's camera; rows 7..10 (V) and 15..18 (P)
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

    let tpl: Template = match &template {
        Some(p) => match std::fs::read(p).map_err(|e| e.to_string()).and_then(|b| load_template(&b)) { Ok(t) => t, Err(e) => { eprintln!("{e}"); std::process::exit(1); } },
        None => Template::frozen(),
    };
    println!("  state copied from {} draw {} ({}/{})", tpl.source, tpl.draw_i, tpl.vs_variant, tpl.ps_variant);
    let mut atlases: HashMap<u8, Atlas> = HashMap::new();
    for &cid in tape.p1_team.iter().chain(tape.p2_team.iter()) {
        if atlases.contains_key(&cid) { continue; }
        if let Some(a) = load_atlas(&atlas_dir, &dasm_dir, cid) { atlases.insert(cid, a); }
    }
    let world_on = !tape.anodes.is_empty() && !opts.no_world && cam.is_some();
    let wt = WorldTemplate::frozen();
    let assets = if world_on { Some(load_world_assets(&stage_dir, &tcw_dir, tape.stage_id)) } else { None };
    if world_on {
        println!("  TAPE v5: {} frames of world-space nodes, {} objects, {} pages in tape, {} in library",
                 tape.anodes.len(), tape.aobjs.len(), assets.as_ref().map(|a| a.stage_preload.len() + tape.pages.len()).unwrap_or(0), assets.as_ref().map(|a| a.lib_pages.len()).unwrap_or(0));
        println!("  world state frozen from {} (sha256 {})", wt.pack, wt.pack_sha256);
    } else if !tape.anodes.is_empty() && !opts.no_world {
        println!("  ⚠ world-space stream present but no camera_block.json -- skipping it");
    }
    let world = assets.as_ref().map(|a| (&wt, a));
    let mut em = Emitter::new(&tape, &atlases, cam.as_ref(), tpl.draw.clone(), world, opts);
    let mut w = SeqWriter::new(&tpl, if em.world_enabled() { Some(&wt.input_layouts) } else { None }, &base);
    for row in start..end {
        if let Some(fr) = em.emit_row(row) { w.push_frame(&tpl, &em.textures, &em.cb_recs, &fr); }
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
