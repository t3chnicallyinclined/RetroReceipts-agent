// runner.rs -- the receipt runner's memory as a `MemSource`, and the emitter that turns it into a v5 tape.
// GATE 2 (docs/RECEIPT-RUNNER-GATE2.md, WORKSTREAM-RECEIPT-RUNNER.md s4 step 2, RECEIPT-RUNNER-RENDER.md s2.1 option B).
//
// `rr_runner.exe --harvest-dump` (mvc-live-skins-quarters/d3dcap/receipt/runner) writes, per tick k:
//   blk_tKKK.bin     the GGPO state block (0x33B18 B) after tick k              -> rows, nodes, anodes, palrows, bg gates
//   gs_tKKK.bin      the game_state page (0x1000 B @ 0x140ac6d40)               -> seat words G+0x218, seat map, localPlayerNum
//   exe_tKKK.bin     the exe page 0x142edf300..0x700                            -> DAT_142edf628 (entity / set-score pointer)
//   dcram_tKKK.dlt   the 4 KiB DC-RAM pages that changed since tick k-1         -> palettes *(H+0x1B8), objects *(node+0xA0)
//   t000 = the state the runner holds after loading the anchor, before the first tick.
// The view composes those into ONE address space at the game's own addresses (Delta = 0: the runner maps every region at
// the anchor's live address, RECEIPT-RUNNER-GATE1.md s1 step 1), so every pointer the harvest follows resolves exactly as
// it did in the live process. Reads outside the held regions return None, like a failed ReadProcessMemory.
//
// RE METHOD (locked, docs/RE-METHOD.md): 1. Port the SH4 annotations to the Steam binary by function matching. 2. Seed
// with unique constants, then propagate along the call graph. 3. Translate globals through the block map before comparing
// reference sets. 4. Tag CONFIRMED versus INFERRED, and store the pairs as edges in the knowledge graph. This file adds no
// offset: it addresses memory with harvest.rs's table and the run's meta.json (dump_live.py / anchor_to_run.py).
use std::path::{Path, PathBuf};
use crate::harvest::*;

const EXE_HDR_LEN: usize = 0x400;   // game_build_id reads the PE header (0x400 B at the image base)

pub struct RunnerView {
    pub exe_base: usize, pub blk_addr: usize, pub blk_len: usize, pub dcram_addr: usize, pub dc_base: u64,
    pub gs_addr: usize, pub exe_page_addr: usize, pub ctx_addr: usize,
    exe_hdr: Vec<u8>, blk: Vec<u8>, gs: Vec<u8>, exe_page: Vec<u8>, dcram: Vec<u8>,
    pre_dir: PathBuf, ticks_dir: PathBuf,
    pub tick: usize, pub delta_pages: usize, pub delta_bytes: usize,
}

fn hexu(v: &serde_json::Value, key: &str) -> Result<usize, String> {
    let s = v.get(key).and_then(|x| x.as_str()).ok_or_else(|| format!("meta.json lacks {key}"))?;
    let t = s.trim_start_matches("0x");
    usize::from_str_radix(t, 16).map_err(|e| format!("meta.json {key}={s}: {e}"))
}

fn read_file(p: &Path) -> Result<Vec<u8>, String> { std::fs::read(p).map_err(|e| format!("{}: {e}", p.display())) }

impl RunnerView {
    /// `pre` = the run's pre directory (meta.json, dcram.bin, exe_image.bin, ctx.bin); `ticks` = the runner's --out dir.
    pub fn open(pre: &Path, ticks: &Path) -> Result<Self, String> {
        let meta: serde_json::Value = serde_json::from_slice(&read_file(&pre.join("meta.json"))?).map_err(|e| format!("meta.json: {e}"))?;
        let exe_base = hexu(&meta, "exe_base")?;
        let (blk_addr, blk_len) = (hexu(&meta, "blk")?, hexu(&meta, "blk_size")?);
        let (dcram_addr, dcram_len) = (hexu(&meta, "dcram")?, hexu(&meta, "dcram_size")?);
        let ctx_addr = hexu(&meta, "ctx")?;
        let dc_base = hexu(&meta, "dc_base")? as u64;
        // the runner's summary.json names the two page addresses it dumped; default to the harvest table's
        let (mut gs_addr, mut exe_page_addr) = (exe_base + GS_PAGE_OFF, exe_base + EXE_PAGE_OFF);
        if let Ok(sb) = std::fs::read(ticks.join("summary.json")) {
            if let Ok(sv) = serde_json::from_slice::<serde_json::Value>(&sb) {
                if let Ok(a) = hexu(&sv, "gs_addr") { gs_addr = a; }
                if let Ok(a) = hexu(&sv, "exe_page_addr") { exe_page_addr = a; }
                if sv.get("harvest_dump").and_then(|x| x.as_bool()) != Some(true) {
                    return Err("the runner output was not produced with --harvest-dump (summary.json harvest_dump != true)".into());
                }
            }
        }
        let mut exe_hdr = vec![0u8; EXE_HDR_LEN];
        {
            use std::io::Read;
            let mut f = std::fs::File::open(pre.join("exe_image.bin")).map_err(|e| format!("exe_image.bin: {e}"))?;
            f.read_exact(&mut exe_hdr).map_err(|e| format!("exe_image.bin header: {e}"))?;
        }
        let dcram = read_file(&pre.join("dcram.bin"))?;
        if dcram.len() != dcram_len { return Err(format!("dcram.bin is {} B, meta says {}", dcram.len(), dcram_len)); }
        let mut v = RunnerView { exe_base, blk_addr, blk_len, dcram_addr, dc_base, gs_addr, exe_page_addr, ctx_addr,
                                 exe_hdr, blk: Vec::new(), gs: Vec::new(), exe_page: Vec::new(), dcram,
                                 pre_dir: pre.to_path_buf(), ticks_dir: ticks.to_path_buf(), tick: 0, delta_pages: 0, delta_bytes: 0 };
        v.load_tick(0)?;
        Ok(v)
    }
    fn load_tick(&mut self, k: usize) -> Result<(), String> {
        let f = |n: &str| self.ticks_dir.join(format!("{n}_t{k:03}.bin"));
        self.blk = read_file(&f("blk"))?;
        if self.blk.len() != self.blk_len { return Err(format!("blk_t{k:03}.bin is {} B, expected {}", self.blk.len(), self.blk_len)); }
        self.gs = read_file(&f("gs"))?;
        self.exe_page = read_file(&f("exe"))?;
        if k > 0 {
            let d = read_file(&self.ticks_dir.join(format!("dcram_t{k:03}.dlt")))?;
            let mut o = 0usize;
            while o + 8 <= d.len() {
                let off = le32(&d, o) as usize; let len = le32(&d, o + 4) as usize; o += 8;
                if o + len > d.len() || off + len > self.dcram.len() { return Err(format!("dcram_t{k:03}.dlt: bad record @{o}")); }
                self.dcram[off..off + len].copy_from_slice(&d[o..o + len]);
                o += len; self.delta_pages += 1; self.delta_bytes += len;
            }
        }
        self.tick = k;
        Ok(())
    }
    /// Advance to the next tick's images (blk/gs/exe page replaced, DC-RAM delta applied in order).
    pub fn advance(&mut self) -> Result<usize, String> { let k = self.tick + 1; self.load_tick(k)?; Ok(k) }
    /// The ctx texture-slot table from the run's ctx.bin (the anchor's fourth region; not read per frame).
    pub fn ctx_slots(&self) -> Option<Vec<u8>> {
        let ctx = std::fs::read(self.pre_dir.join("ctx.bin")).ok()?;
        ctx.get(CTX_SLOT_OFF..CTX_SLOT_OFF + CTX_SLOT_LEN).map(|s| s.to_vec())
    }
    pub fn blk_bytes(&self) -> &[u8] { &self.blk }
    pub fn gs_bytes(&self) -> &[u8] { &self.gs }
    pub fn exe_page_bytes(&self) -> &[u8] { &self.exe_page }
}

impl MemSource for RunnerView {
    fn read_mem(&self, addr: usize, len: usize) -> Option<Vec<u8>> {
        let regions: [(usize, &[u8]); 5] = [(self.blk_addr, &self.blk), (self.gs_addr, &self.gs), (self.exe_page_addr, &self.exe_page),
                                            (self.dcram_addr, &self.dcram), (self.exe_base, &self.exe_hdr)];
        for (base, buf) in regions {
            if addr >= base && addr.checked_add(len)? <= base + buf.len() { return Some(buf[addr - base..addr - base + len].to_vec()); }
        }
        None
    }
}

#[derive(Default, Debug)]
pub struct EmitStats { pub ticks: usize, pub frames: usize, pub rejected_rows: Vec<u32>, pub nodes: usize, pub anodes: usize, pub aobjs: usize,
                       pub palrows: usize, pub calib_frames: usize, pub delta_pages: usize, pub delta_bytes: usize, pub clock_first: u32, pub clock_last: u32 }

/// Harvest ticks 0..=n of a runner output directory into a v5 tape record -- the live agent's capture loop over the
/// runner's memory: per tick, snapshot the block, read the row, walk the draw list, walk the world lists, read the palette
/// rows, record; then the same record builder (`build_gamestate_record`). Tick 0 = the anchor state (the live tape's first
/// row is the same clock).
pub fn emit_runner_tape(pre: &Path, ticks: &Path, n: usize, match_key: &str, reporter: &str) -> Result<(BuiltRecord, EmitStats), String> {
    let mut view = RunnerView::open(pre, ticks)?;
    let exe_base = view.exe_base;
    let blk = view.blk_addr;
    let base = blk + BLK_BACK;                       // the legacy fighter-array window (reader.rs: base = blk + 0x3F24)
    let mut c = GsCapture::default();
    let mut st = EmitStats::default();
    // match start = the anchor state, exactly what the live capture read at recording START
    let ms = unsafe { read_match_start(&view, base, exe_base) };
    c.begin_match(&ms, blk + BLK_FRAME_OFF, false);
    // 0.3.47 battle-frame receipt anchor, from the runner's own tick-0 regions (+ the ctx slot table from the run)
    if let Some(cts) = view.ctx_slots() {
        let f0 = unsafe { rpm_u32(&view, blk + BLK_FRAME_OFF) }.unwrap_or(0);
        let mut raw = Vec::with_capacity(BLK_SIM_LEN + GS_PAGE_LEN + EXE_PAGE_LEN + CTX_SLOT_LEN);
        raw.extend_from_slice(&view.blk_bytes()[..BLK_SIM_LEN]);
        raw.extend_from_slice(&view.gs_bytes()[..GS_PAGE_LEN.min(view.gs_bytes().len())]);
        raw.extend_from_slice(&view.exe_page_bytes()[..EXE_PAGE_LEN.min(view.exe_page_bytes().len())]);
        raw.extend_from_slice(&cts);
        c.battle_anchor = Some(gzip_bytes(&raw)); c.battle_anchor_blk = blk as u64; c.battle_anchor_frame = f0;
        c.battle_anchor_ctx = view.ctx_addr as u64; c.battle_anchor_dcram = view.dcram_addr as u64;
    }
    let mut k = 0usize;
    loop {
        let frame = unsafe { rpm_u32(&view, blk + BLK_FRAME_OFF) }.ok_or("clock unreadable")?;
        if k == 0 { st.clock_first = frame; }
        st.clock_last = frame;
        unsafe { snap_install(&view, blk); }
        match unsafe { read_gs_row(&view, base, frame, exe_base) } {
            Some(mut row) => {
                let mut objs = Vec::new();
                let mut flayers = [0xFFu8; 6];
                let want_calib = c.calib.len() < CALIB_MAX_FRAMES;
                let mut calib_nodes: Vec<Vec<u8>> = Vec::new();
                unsafe { harvest_objs(&view, base, &mut objs, &mut flayers, if want_calib { Some(&mut calib_nodes) } else { None }); }
                let mut araw: Vec<ANodeRaw> = Vec::new();
                unsafe { harvest_anodes(&view, blk, &mut araw); }
                let prow = unsafe { read_palrows(&view, blk) };
                row.layer = flayers;
                st.nodes += objs.len(); st.anodes += araw.len(); if prow.is_some() { st.palrows += 1; }
                c.record_frame(frame, row, objs, prow, araw, calib_nodes);
                st.frames += 1;
            }
            None => st.rejected_rows.push(frame),
        }
        snap_clear();
        if k >= n { break; }
        k = view.advance()?;
    }
    st.ticks = k; st.aobjs = c.aobjs.len(); st.calib_frames = c.calib.len();
    st.delta_pages = view.delta_pages; st.delta_bytes = view.delta_bytes;
    let snap = c.to_snapshot();
    let p1 = [ms.team_ids[0], ms.team_ids[2], ms.team_ids[4]];
    let p2 = [ms.team_ids[1], ms.team_ids[3], ms.team_ids[5]];
    let side = match ms.local_pn { 1 => 2u8, _ => 1u8 };
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let built = build_gamestate_record(match_key, reporter, side, &p1, &p2, "local", "local", &snap, "", 0, None, ts);
    Ok((built, st))
}
