// harvest.rs -- THE TAPE HARVEST as a library module (GATE 2: docs/RECEIPT-RUNNER-GATE2.md, RECEIPT-RUNNER-RENDER.md s2.1 B).
//
// Every byte of the tape (rows = GS_SCHEMA, `nodes`, `anodes`/`aobjs`, `palrows`, `objs`/`calib`, the envelope) is
// produced by the functions in this file, which read game memory ONLY through `read_at` -> `MemSource::read_mem`.
// The live agent implements MemSource with `mem::Proc` (ReadProcessMemory); the receipt runner implements it with a
// view over the runner's per-tick images (runner.rs). Same functions, same encoders, same bytes: that is what makes
// `runner_tape_gate.py` a comparison of the GAME, not of two harvests.
//
// This file is the 0.3.48 reader.rs harvest MOVED VERBATIM (offset table, struct reads, draw-list walk, world-node
// walk, palette rows, interning, the record builder). The only edits: `pub` visibility, `h: &mem::Proc` -> `h: &dyn
// MemSource`, and three blocks that were inline in the capture loop (match-start envelope, palette rows, the per-frame
// insertion) became functions so the loop and the runner emitter call the same code. Nothing about what is read or how
// it is encoded changed -- the agent's tape bytes for a live match are identical (memory: feedback-port-proven-code-asis).
//
// RE METHOD (locked, docs/RE-METHOD.md): 1. Port the SH4 annotations to the Steam binary by function matching. 2. Seed
// with unique constants, then propagate along the call graph. 3. Translate globals through the block map before comparing
// reference sets. 4. Tag CONFIRMED versus INFERRED, and store the pairs as edges in the knowledge graph. Every offset below
// is CONFIRMED in the cited doc/Ghidra function; none is derived here.
use std::collections::HashMap;
use crate::mem;

/// The one seam: a byte source addressed by the game's own virtual addresses. `None` = unreadable (a failed RPM).
pub trait MemSource {
    fn read_mem(&self, addr: usize, len: usize) -> Option<Vec<u8>>;
}
impl MemSource for mem::Proc {
    fn read_mem(&self, addr: usize, len: usize) -> Option<Vec<u8>> { self.read(addr, len) }
}

// ══ MvC2 Steam offsets — the ONE table (RPM read-only). The REVERSED Steam-build layout ═══════════════
// The Steam MvC2 build's runtime struct differs from Demul: 6 fighter slots at STRIDE 0x738, order
// P1C1,P2C1,P1C2,P2C2,P1C3,P2C3 (even slot = P1, odd = P2 → side is the slot-index parity). Each slot
// starts with a cluster of ~16 working-buffer pointers; per-fighter fields are relative to that slot start
// `cl` = base + slot*STRIDE. The array BASE is VOLATILE per match (located by pointer-follow
// — see reader.rs pointer_follow_array). Battle-globals + meter are relative to the array base `ram`;
// kcode / localPlayerNum / the match-block pointer are relative to the game module (exe) base.
// ⚠ CONFIRMED-CORRECT — do NOT change: STRIDE 0x738, OFF_HEALTH 0x40c, OFF_REDHP 0x410, OFF_CHARID 0x554,
//    OFF_COMBO 0x1ca, OFF_INPUT 0x4fc, and the MATCH_PTR/MATCH_ARR pointer chain.

// ── (1) per-fighter slot offsets (relative to cl = base + slot*STRIDE) ──
pub const STRIDE: usize = 0x738;          // fighter-slot stride; even slot = P1, odd = P2
pub const OFF_COLOR:  usize = 0x6;        // palette/button-colour index
pub const OFF_DATPAL: usize = 0x4c;       // → this fighter's 16-colour ARGB4444 palette pointer (working-buffer range)
// Effect-safe paint window: skin ONLY the 6 base button-color groups [0, 0x600) in the DatPal block; PRESERVE
// [0x600, …) — the shared Status-Effects block + Extras (grenade/armor/lightning). 6 groups × 0x100 = 0x600.
pub const PAL_BASE_REGION: usize = 0x600;
pub const OFF_COMBO:  usize = 0x1ca;      // combo this fighter is DEALING (confirmed correct)
pub const OFF_HITSTUN: usize = 0x1d1;     // hitstun flag (u8): 0xFF = in hitstun/real hit, 0 = neutral-or-blocking.
                                      // ⚠ WAS 0x909 (= 0x1d1 + STRIDE) → read the NEXT slot's flag (same >stride
                                      // bug class as the old health 0xb44→0x40c). Fixed 2026-08-15 (RE-confirmed).
pub const OFF_HEALTH: usize = 0x40c;      // health (u32, full=144). ⚠ WAS 0xb44 (> stride → read the NEXT slot's health
                                      // = every win logged as a loss); 0x40c is the same-struct field. Confirmed
                                      // live: re-scoring a full set gives 6W-1L vs the user's ground-truth 8-2.
pub const OFF_REDHP:  usize = 0x410;      // recoverable (red) health (u16) = health+4. ⚠ WAS 0xb48 (old >stride bug).
pub const OFF_ASSIST: usize = 0x4e9;      // assist type: alpha=0 beta=1 gamma=2 (confirmed live 2026-08-11; DC +0x4C9 does NOT map)
pub const OFF_INPUT:  usize = 0x4fc;      // per-fighter input register (CPS2-decoded pad state for that side)
pub const OFF_CHARID: usize = 0x554;      // CPS2 unit id (char_id)
// ⚠⚠⚠ ROOT CAUSE OF THE ">STRIDE" BUG CLASS — FOUND + PROVEN 2026-08-25 (replay lane; ported VERBATIM
// from mvc-live-skins-quarters @5927e9e). `cl = base + slot*STRIDE` is **0x16C bytes INSIDE the
// object**. The TRUE object base is
//     H_i = base + slot*STRIDE - OBJ_BACK          (= *(exe+0xAC6EF0) + 0x3DB8 + i*STRIDE)
// Since STRIDE - OBJ_BACK = 0x5CC, **every cl-relative offset >= 0x5CC reads the NEXT character**.
// That is the same bug previously patched one field at a time (health 0xb44→0x40c, hitstun
// 0x909→0x1d1) without finding the cause. Fields BELOW 0x5CC are unaffected and stay exactly as they
// are — DatPal/health/red/char_id/combo/hitstun/assist/input/color all keep working (the skin painter
// and W/L reader were never wrong).
// PROOF (live, all six pairs, slots 0..4): `cl_i + off == H_{i+1} + true_off` is the SAME ADDRESS,
// and every recorded value was byte-identical to the NEXT character's field. Engine self-check:
// {u64 @ blk+0x32500 + 8k} == {H_i} 6/6. Camera identity closes to 0.000px on H-relative reads.
// Full cited spec: docs/STEAM-REPLAY-ANSWERS.md.
pub const OBJ_BACK:   usize = 0x16c;      // cl is this far INSIDE the object; H = cl - OBJ_BACK
pub const H_POS_X:    usize = 0x50;       // world X (f32)  — replaces the broken cl+0x61c (next char)
pub const H_POS_Y:    usize = 0x54;       // world Y (f32)  — replaces cl+0x620. +Y is UP, ground == 0.0
pub const H_XVEL:     usize = 0x78;       // x velocity (f32) — replaces cl+0x644
pub const H_YVEL:     usize = 0x7c;       // y velocity (f32) — replaces cl+0x648
pub const H_FACING:   usize = 0x154;      // facing (u8) 0/1 — replaces cl+0x720
pub const H_DRAWN:    usize = 0x170;      // DC +0x12C draw gate: non-zero = the engine rendered this
                                      //   object THIS frame (bank03 loc_8c03093c early-returns on 0)
pub const H_ANIM_TMR: usize = 0x186;      // anim cell duration countdown (u8) — replay interpolation aid
pub const H_SPRITE_ID: usize = 0x188;     // THE render key (u16) — shipped RAW (bit15 = xform flag, consumer masks)
// 0.3.25 render columns — the engine's OWN screen output, so a renderer never reconstructs. All four
// live in the existing 0x200 `o` window, so they cost NO extra read. Confirmed live 2026-08-27
// (replay-kit/probe_render_cols.py): engine sx/sy == px−eyeX+320 / ground−py to 0.0 px on every drawn
// frame, and STAYS correct on round-transition/edge-clamp frames where the reconstruction diverges.
pub const H_SCREEN_X:  usize = 0x124;     // engine screen X (f32) — DC +0xE0 x_pos_screenspace (matrix+perspective output)
pub const H_SCREEN_Y:  usize = 0x128;     // engine screen Y (f32) — DC +0xE4 y_pos_screenspace
pub const H_SCALE_X:   usize = 0x130;     // per-object magnifier X (f32) — CpsXScale×sprite_scale; rests at 5/3
pub const H_SCALE_Y:   usize = 0x134;     // per-object magnifier Y (f32) — CpsYScale×sprite_scale; rests at 15/7
// 0.3.28 palette/effect columns (both live in the existing 0x200 `o` window — no extra read):
pub const H_SUPERGLOW: usize = 0x5c;      // char_pal_effect (u8) — DC +0x40, δ0x1C. Super-freeze body brighten / palette tint.
pub const H_HITFLASH:  usize = 0x172;     // hit/hurt-flash palette-effect word (u16) — DC char+0x12E, δ0x44.
// Camera globals live in the BLOCK the fighter array hangs off: blk = *(exe+0xAC6EF0), and the array
// base = blk + 0x3f24 (so H_0 = blk + 0x3DB8 = base − 0x16C, the same identity as OBJ_BACK — the two
// constants cross-check each other: 0x3f24 − 0x16C = 0x3DB8).
pub const BLK_BACK:    usize = 0x3f24;    // array base − BLK_BACK = blk
pub const CAM_EYE_OFF: usize = 0x6914;    // blk-relative: f32 eyeX, +4 = eyeY (blk+0x6918)
pub const CAM_WIN:     usize = 0x88;      // one read covers eyeX..ground
pub const CAM_GROUND_REL: usize = 0x6998 - 0x6914; // ground f32 (usually 433.4000244) within that window
pub const CAMX_OFF:     usize = 0x6908;    // 0.3.39: camera state u32 (0 = fight camera, 1 = scripted keyframes)
pub const CAMX_WIN:     usize = 0x94;      //   ..0x699C: look-at @+0x54, fov @+0x6C, y-off @+0x80, roll u16 @+0x84
pub const DECK_COL_OFF: usize = 0x6CA8;    // 0.3.39: 3 f32 -- the stage deck (POL model 0) vertex-colour multiplier
pub const BLACKOUT_OFF: usize = 0x3D50;    // 0.3.39: u8 (G+0x98) -- != 0 skips the deck draw (FUN_140620960)
// 0.3.45: the FRAME BACKGROUND inputs (docs/FRAME-BACKGROUND-GHIDRA.md, Ghidra FUN_1406101b0 == SH4 loc_8c02dc4c).
// One 0x40-B read at blk+0x6CB4: mode u32 @+0, three packed 0x00RRGGBB words @+4/+8/+0xC (stage constants,
// FUN_140620200 / re-asserted per frame by FUN_140620420), fade word @+0x30 (blk+0x6CE4, FUN_140619970: != 0 =
// white/black strobe frame), fade colour @+0x3C (blk+0x6CF0). Plus the gate bytes the rule tests: G+0..2 (fight
// = 2,1,2), G+0x2E (bit 0), and the entity list's +6 / +0x96 (DAT_142edf628 = *(exe+0x2edf628); +0x96 is the
// super-blackout source that FUN_14061f030 copies into G+0x98 every frame). The renderer applies the rule offline.
// 0.3.47 BATTLE-FRAME ANCHOR (docs/DETERMINISM-CONTRACT.md s1.1b, docs/RECEIPT-PLAYER-G.md): a blk-only anchor at
// character select cannot be driven through the shell into a match (Track H falsification). The receipt is
// therefore taken at the FIRST BATTLE FRAME and carries everything the tick reads outside blk: the game_state
// page (exe+0xAC6D40, 4 KB: frame fn, pads, seat map, picks, gates), the exe page 0x142edf300..0x700 (blk/G
// pointers, bank POL pointers, DAT_142edf628 = blk+0x324E0, stage models, HUD state), the ctx texture-slot table
// (ctx+0x1e0030..0x1e31CC) and ctx+8 (the DC-RAM base). PL images come from the arc (AFS 209+cid) on the replay host.
pub const GS_PAGE_OFF:   usize = 0xAC6D40;    // exe-relative game_state page
pub const GS_PAGE_LEN:   usize = 0x1000;
pub const EXE_PAGE_OFF:  usize = 0x2EDF300;   // exe-relative 0x142edf300
pub const EXE_PAGE_LEN:  usize = 0x400;
pub const CTX_PTR_OFF:   usize = 0x2EF0AB0;   // exe-relative DAT_142ef0ab0 -> ctx
pub const CTX_SLOT_OFF:  usize = 0x1E0030;    // ctx-relative texture-slot table
pub const CTX_SLOT_LEN:  usize = 0x319C;
pub const BG_OFF:       usize = 0x6CB4;    // blk-relative window start
pub const BG_WIN:       usize = 0x40;      // ..0x6CF4
pub const ENTITY_PTR_OFF: usize = 0x2edf628;   // exe-relative: DAT_142edf628 (u64 pointer to the entity list)
// REMOVED: OFF_ACTION 0x76c and OFF_COMBO_RECV 0x902. Both are >0x5CC, i.e. the NEXT character's
// fields (0x76c → char i+1's +0x600 region; 0x902 → char i+1's combo-dealt). There is no known
// correct Steam analogue for either; do NOT re-add one without a live proof.

// ── 0.3.27: the engine's per-frame DRAW LIST → every drawn OBJECT-POOL node (projectiles, assist shots,
// capes, hit-sparks, super/beam effects) in the engine's OWN layer order. A pool node is a PREFIX of the
// fighter struct (loc_8c03093c renders both with identical code), so it reads through the SAME H-offsets.
// handle = u64 @ blk+DRAWLIST_OFF + L*DRAWLIST_LAYER + i*8 for i<count[L]; count[L] = u8 @ blk+DRAWLIST_COUNTS+L.
// 16 layers, z-order = layer index (no z scalar). Fighters appear here too (excluded — already in `frames`).
// Confirmed live (mvc2-dc-steam-block-map + replay-kit/verify.py pool): stride 0x280 pool, base ≈ blk+0x6dd8;
// the draw list already points at every node so no pool scan is needed.
pub const DRAWLIST_OFF:          usize = 0x2f4d0;   // blk-relative: layer L's handle array
pub const DRAWLIST_COUNTS:       usize = 0x324d0;   // blk-relative: u8 count per layer
pub const DRAWLIST_LAYER:        usize = 0x300;     // stride between layers in the handle table
pub const N_LAYERS:              usize = 16;
pub const DRAWLIST_MAX_PER_LAYER: usize = 0x60;     // engine cap per layer
pub const OBJS_CAP_PER_FRAME:    usize = 64;        // active pool is a handful; cap for tape-size safety
pub const CALIB_MAX_FRAMES:      usize = 16;        // 0.3.29: self-describing blob keeps this many effect-frames
pub const CALIB_PREFIX_LEN:      usize = 0x1c0;     // 0.3.29: raw node prefix H+0x00..0x1C0 dumped for offline offset-derivation
pub const H_CATEGORY:            usize = 0x03;      // node category → render-list/blend class (NOT the texture bank)
// 0.3.29 — effect-node offsets CORRECTED from live fxprobe.py (Storm proj + triple super, 2 runs). ROOT CAUSE of
// the three wrong offsets: the render cluster maps DC→Steam at a CONFIRMED +0x44 delta (5 anchors: screen
// 0xE0→0x124, screen_y 0xE4→0x128, drawgate 0x12C→0x170, sid 0x144→0x188, hitflash 0x12E→0x172). The old
// H_GFX1_PTR=0x1a8 was δ0x4C = DC+0x164 = Dat_Pal (a PALETTE handle) — precisely why it never resolved (0/23742).
pub const H_OBJ_OWNER:           usize = 0x28;
// ── 0.3.40 PALETTE STAGING ROWS — docs/PALETTE-SOURCE-GHIDRA.md (Ghidra-CONFIRMED, gate 494/518) ──
// The palette a draw binds is NOT the fighter's DatPal: it is the bank the sheet registration gave the
// part (slot base 0x10+8*slot + rec.flags>>4), whose colours the engine STAGES at blk+0x1040+bank*0x38
// (FUN_1406146d0 = loc_8c035162) and uploads per frame (FUN_140613390). `pal` (read_pal(H+0x1B8)) is
// DatPal+0 = costume 0 row 0 — wrong for every non-default colour, and why a same-character mirror
// rendered both fighters alike.
pub const PAL_STAGE_OFF:    usize = 0x13C0;  // blk + 0x1040 + 0x10*0x38: slot 0 row 0
pub const PAL_STAGE_STRIDE: usize = 0x38;    // one line
pub const PAL_STAGE_FLAG:   usize = 0x08;    // u32: 1 raw pending / 2 dim pending / 0 uploaded
pub const PAL_STAGE_COLS:   usize = 0x18;    // 16 x u16 ARGB4444
pub const PAL_STAGE_LEN:    usize = 6 * 8 * PAL_STAGE_STRIDE;   // 0x540: all six slots in one read      // u64 == owning fighter's H-base (blk+0x3DB8+i*0x738). CONFIRMED
                                                //   live 48/52 & 40/40 (misses = ownerless super-flash → 0xFF).
                                                //   Replaces the failing H+0x9c/0xc4 owner scan.
// ⚠ 0.3.38 CORRECTION (Ghidra, the Steam sprite submit FUN_1406129f0): the GFX1 part table is
// dereferenced at node+0x1A8 (`*(node+0x1a8) + sel*4`) and the GFX2 cell table at node+0x1B0
// (`*(node+0x1b0) + (sid&0x7fff)*4`). The words at +0x1A0/+0x1A4 shipped as gfx1/gfx2 since 0.3.29
// are NOT bank handles: on the first v5 tape a single fighter shows dozens of distinct "gfx1"
// values (0x1515, 0x381504, 0x380d0c, ...) across frames -- they are animation-state words. That
// is why "resolve an ownerless object by its bank" could never work on those tapes.
pub const H_GFX1:                usize = 0x1a8;     // Dat_GFX1 table pointer (Steam FUN_1406129f0 reads *(node+0x1a8))
pub const H_GFX2:                usize = 0x1b0;     // Dat_GFX2 cell table pointer (Steam FUN_1406129f0 reads *(node+0x1b0))
pub const H_OWNER_OFF_NONE: u32 = 0;
// 0.3.32 FULL EFFECT WIRE — all read from the SAME 0x1C0 harvest_objs buffer (no extra per-node read).
// ⭐ TAPE v3. Both CONFIRMED in STEAM's own disassembly (senior-re-generalist, Ghidra), then
// re-checked against a 300-frame state capture.
//   H_SORT  = the intra-layer draw sort key. FUN_14061e560 @0x14061E61F/@0x14061E66F compares
//             `byte ptr [reg+0x4D]` with JLE/JG -- SIGNED -- and swaps on strict >, so the sort is
//             ASCENDING and STABLE. DC calls it node+0x31; the delta here is +0x1C, the SAME segment
//             that maps DC +0x40 -> H_SUPERGLOW 0x5C. It is NOT the +0x44 segment.
//             ⚠ Reading the DC offset directly gives 0 on every node -- a convincing false negative.
//   H_DATPAL = the node's live 16-colour ARGB4444 palette pointer. This is OFF_DATPAL (0x4C) seen
//             from the H base: the legacy fighter reads use the 0x3F24 array, and 0x3F24-0x3DB8 =
//             0x16C, so 0x4C + 0x16C = 0x1B8. Verified on the capture: +0x1B8 is pointer-sized on
//             4080/4080 nodes with exactly 4 distinct values (the four on-screen characters), while
//             +0x4C holds only 8 small values (0xF801, 0x1, 0x801, ...) whose byte 1 is the sort key.
//             ⚠ Without the 0x16C correction these two fields appear to OVERLAP, and the sort key
//             looks like a byte inside a pointer.
pub const H_SORT:       usize = 0x4d;
pub const H_DATPAL:     usize = 0x1b8;
pub const H_DEPTH:      usize = 0x12c;   // DC node+0xE8 (screen Z / 1-W numerator), +0x44 -> Steam 0x12C. f32.
// ── TAPE v4 (2026-09-02) ──
// ⭐ H_ANGLE = the sprite's ROTATION ANGLE, a plain u16 with 0x10000 = 360 deg (DC node+0x104, +0x44).
// SH4 bank03 loc_8c03481c: gated by `!= 0` (NOT a bit-15 flag), facing negates it, every quad
// corner rotates rigidly about the HOTSPOT after placement. Every rotated node captured so far is
// exactly 0x8000 (a point reflection through the origin pixel); the renderer needs the value, not a
// flag, so it can apply the general case when the data shows one. Without it the super frames
// render at 88.8% (v3gate falsification, 30/30 frames at 100.000% with it).
pub const H_ANGLE:      usize = 0x148;
// H_HOTSPOT = the rotation pivot, two s16 (DC node+0x134/+0x136, +0x44): P = floor(sx) + scale*hot.
pub const H_HOTSPOT:    usize = 0x178;
                                     //   render-composite z-order (RENDER-ACCURACY-PROGRAM.md, sh4-re). Re-confirm at build.
// is_effect value-test (fxprobe.py, CONFIRMED-live mechanism): B=*(u32)(blk+0x6CE8); a node is an
// effect iff some word in H+0x180..0x1BC masked &0x1FFFFFFF lands in [B, B+0x10000). Per the 0.3.29
// note this primarily catches 3D-class (cat 5-13) effects; sprite-class (cat 1-4, e.g. Inferno) usually
// read 0 (Steam handle is not a 0x0CED ptr) -- gfx1/effect_key still carry the discriminator.
pub const GFX_B_OFF:    usize = 0x6ce8;  // blk-rel: B = *(u32)(blk+this)             (fxprobe.py / spec §3)
pub const FX_BANK_WIN:  usize = 0x10000; // [B, B+win)                                 (fxprobe.py)
pub const H_FX_SCAN_LO: usize = 0x180;   // node gfx-key scan window start
pub const H_FX_SCAN_HI: usize = 0x1bc;   // last u32 wholly inside the 0x1C0 buffer (0x1bc+4=0x1c0)
// DROPPED 0.3.29: H_GFX1_PTR=0x1a8 (=Dat_Pal) and the blk+0x6CE8 / [0x0CED0000] value-test — that model dir keys
// ONLY 3D-class effects (cat 5-13, NaomiLib); none were captured. Sprite-class (cat 1-4) render via GFX2+sid.

// ── (2) battle-globals + meter (relative to the array base `ram`) ──
// The DC BattleState struct transfers BYTE-FAITHFUL to array+0x2e5dc (MET_BARS/FILL are that base +0x5a/+0x7c;
// Ghidra-confirmed) → GROUND-TRUTH win/round state, no health inference.
pub const MET_BARS:       usize = 0x2e636;  // P1 meter bars 0-5; P2 = +1 (adjacent, per DC layout)
pub const MET_FILL:       usize = 0x2e658;  // P1 meter fine fill (u16) — confirmed +1 per Magneto LP
pub const OFF_PHASE:      usize = 0x2e5dc;  // u8: <5 = active fight, 5 = KO, 6 = win-pose, 9 = results
pub const OFF_BG_INMATCH: usize = 0x2e610;  // u8: 1 while a real match runs (the game's own gate)
pub const OFF_ROUND:      usize = 0x2e617;  // u8: game index within the set
pub const OFF_WINRESULT:  usize = 0x2e61a;  // u8: 0x00 = P1(even) won, 0x01 = P2(odd) won, 0xFF = draw. LATCHED at KO.
pub const OFF_BG_TIMER:   usize = 0x2e61c;  // u8: 99->0 round timer

// ── (3) exe-relative globals (relative to the game module base; default 0x140000000) + the anchor ──
pub const MATCH_PTR_OFF:   usize = 0xac6ef0;    // exe global → pointer to the CURRENT match block. ⚠ do NOT change
pub const MATCH_ARR_ADD:   usize = 0x3f24;      // fighter_array = *(exe+MATCH_PTR_OFF) + this. ⚠ pointer chain — do NOT change
// ⚠ CORRECTION (measured live 2026-08-26, docs/STEAM-GGPO-DETERMINISM.md): this is NOT "flycast
// kcode[0] (the LOCAL pad)". MvC Fighting Collection ships verbatim GGPO rollback, and this address is
// G+0x218 — GGPO SEAT 0's post-synchronisation input word. Which seat is LOCAL comes from SEATMAP_OFF,
// which we never read before 0.3.24 — that omission is the root cause of the documented side-swap.
// The input chain, measured:  G+0x218 (RAW) → bit table @0x140A4F780 → blk+0x3C66+i*0x14 → cl+0x4fc.
// p1_in/p2_in ship cl+0x4fc: TWO STAGES DOWNSTREAM and lossy. seat_in[] ships the raw word instead.
pub const KCODE_OFF:       usize = 0xac6f58;    // == SEATIN_OFF (name kept: existing call sites)
pub const SEATIN_OFF:      usize = 0xac6f58;    // G+0x218: RAW input word, seat k at +k*4 (u32, 24-bit mask)
pub const SEATMAP_OFF:     usize = 0xac6f98;    // G+0x258: GGPO player k → seat index (i32, -1 = unmapped)
// ── 0.3.26: GGPO's CONFIRMED input ring — the finalized post-rollback inputs dojo's replay plays
// pure-forward. G+0x218 above is the PREDICTED latch (smeared remote input under rollback); THESE are
// the ground truth. Chain (RE'd + confirmed live, docs/STEAM-GGPO-INPUTQUEUE.md): session = *(u64*)
// (exe+0x2E10B98) → Sync = session+0x9F0 → queues = *(u64*)(sync+0x190); queue[k]+40 = _inputs[128]
// (GameInput {i32 frame; i32 size; u8 bits[]}, stride 28), keyed frame%128. Confirmed watermark =
// min over queues of _last_added_frame (queue+24), floored by Sync::_last_confirmed_frame (sync+0x184).
pub const GGPO_SESSION_OFF: usize = 0x2e10b98;  // *(u64*)(exe+this) = the ggpo session (Peer2PeerBackend)
pub const GGPO_SYNC_OFF:    usize = 0x9f0;
pub const SYNC_QUEUES_OFF:  usize = 0x190;
pub const SYNC_LASTCONF_OFF:usize = 0x184;
pub const SYNC_NPLAYERS_OFF:usize = 0x174;
pub const IQ_STRIDE:        usize = 0xe44;
pub const IQ_INPUTS_OFF:    usize = 40;
pub const IQ_LASTADD_OFF:   usize = 24;
pub const GI_STRIDE:        usize = 28;
pub const GI_RING:          usize = 128;
pub const ROLLBACK_OFF:    usize = 0xac74ac;    // G+0x76C: load_game_state count; >0 = GGPO rewound mid-capture
pub const ARENA_PTR_OFF:   usize = 0xac6d40;    // exe global → the single 256 MiB arena that blk is carved from
// ── the GGPO save/restore region: blk[0..BLK_SIM_LEN) IS the complete deterministic sim state ──
// The engine registers exactly ONE region and its size field (exe+0xac6ef8) reads 0x33B18 live. Because
// GGPO rewinds constantly during every online match, anything sim-relevant living outside that region
// would desync peers within MAX_PREDICTION_FRAMES — so the region is complete by Capcom's own shipping
// netcode, not by our inference. A copy of it + the per-frame inputs re-simulates the match exactly.
pub const BLK_SIM_LEN:     usize = 0x33b18;     // 211,736 B
pub const BLK_MODE_OFF:    usize = 0x3cb8;      // blk+0x3CB8 byte[2]: 1 = CHARACTER SELECT, 2 = IN BATTLE
// ⚠ 0x6D3C read 0 in EVERY capture of 2026-09-02 (training AND an online match). The stage id is
// blk+0x6D04 (u32): 0x0B in training mode (the Training Stage), tested by Steam's own render
// dispatcher FUN_140620960 (`*(blk+0x6d04) != 8` picks the per-stage pass), and it sits right before
// the per-layer depth-base table at blk+0x6D08 (the DC LayerZ table 15,17,19,...). Read as u8.
pub const STG_OFF:         usize = 0x6d04;      // blk+0x6D04: STG_ID — RNG-picked stage; the tape ships only
                                            //   this number, the renderer pulls stage art from the Collection arc
pub const BLK_FRAME_OFF:   usize = 0x3cc8;      // blk+0x3CC8: the sim frame counter (used as a torn-read guard)
pub const BLK_H0_OFF:      usize = 0x3db8;      // blk+0x3DB8 = fighter slot 0. ⚠ NOT MATCH_ARR_ADD (0x3f24),
                                            //   which is 0x16C INSIDE the object — 0x3f24 − 0x16c = 0x3db8.
pub const H_CID:           usize = 0x6c0;       // slot CID — ALSO where the char-select cursor writes
pub const LOCALPLAYER_OFF: usize = 0xac7230;    // localPlayerNum: 0 = P1, 1 = P2 (flycast's own side global, next to kcode;
                                            //   differential-capture confirmed: 0 in a live P1 match, 1 across 3 P2 matches)
pub const GSTATE_PTR_OFF:  usize = 0xacd3a0;    // exe global → pointer to game_state (scene id @ +0x8, locked picks @ +PICKS_OFF)
pub const PICKS_OFF:       usize = 0x758;       // char-select LOCKED picks (stride-4 char_ids) at game_state+this
pub const SESSION_PTR_OFF: usize = 0xacd3a8;    // exe global → pointer to the online SESSION object (hosted-lobby state).
                                            //   Adjacent to game_state (0xacd3a0); read only by the hosted-lobby path.
// ── Tier-3 set-score (the game's OWN per-set WINS tally — the HUD "WINS" counter). exe-relative global →
// POINTER to the set-score block: sc = *(exe+SET_SCORE_PTR_OFF). The tally increments on ANY game win — KO OR
// TIMEOUT — resetting per set, so a game-over always bumps exactly one side by +1. Read-only + ADDITIVE: the
// SERVER derives/auto-confirms the winner from the delta (covers timeouts the health-KO judge can't). Live-
// validated 2026-08-16 (lobby RE). Side mapping is the SAME as everywhere: localPlayerNum 0→P1, 1→P2.
pub const SET_SCORE_PTR_OFF: usize = 0x2edf628; // exe global → pointer to the set-score block (sc = *(exe+this))
pub const SET_P1_WINS_OFF:   usize = 0xbc;      // sc+this (u8) = P1 set-wins tally
pub const SET_P2_WINS_OFF:   usize = 0xbd;      // sc+this (u8) = P2 set-wins tally
pub const ARRAY_OFF:       usize = 0x10b3_3fc8; // anchor: fighter array = flycast_reservation_base + this (gs-70)

// ── (3b) hosted-lobby opponent detection (session-relative + MemberInfo-record-relative) ──
// In a HOSTED lobby the opponent's SteamID is NOT stored with the ranked pairing geometry; it lives in a heap
// MemberInfo record whose layout is fixed relative to OUR id. These locate it (see find_opponent_lobby).
// ⚠ HEURISTIC deltas — live-validated 2026-08-16 against a single lobby layout; harden as more lobbies are seen.
pub const LOBBY_HOSTED_OFF:  usize = 0xd0320;   // session+this (u32) == 1 → we are HOSTING a versus lobby
pub const LOBBY_NETSESS_OFF: usize = 0x1b8;     // session+this (i32) >= 0 → a net session is live
pub const LOBBY_OPP_GAP:     usize = 0x148;     // opp SteamID addr = (addr holding OUR id) + this  (rec+0x3c → rec+0x184)
pub const LOBBY_OPP_NAME:    usize = 0x184;     // opp persona addr  = (addr holding OUR id) + this  (= opp id addr + 0x3c)

// ── (4) limits / ranges ──
pub const HP_FULL: u16 = 144;             // full health
pub const MAX_CID: u8 = 0x3A;             // Servbot = highest CPS2 unit id (58)

pub fn u16le(b: &[u8], o: usize) -> u16 { (b[o] as u16) | ((b[o + 1] as u16) << 8) }
pub fn le32(b: &[u8], o: usize) -> u32 { u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) }
pub fn lef32(b: &[u8], o: usize) -> f32 { f32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) }
pub fn fnv1a64(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    h
}

// ── 0.3.43 PER-TICK BLOCK SNAPSHOT ─────────────────────────────────────────────────────────────
// The capture thread issued 500-800 small RPM reads per frame (fighters, draw-list nodes, world nodes) =
// 30-48k syscalls/s = ~90% of a core in a match (measured 2026-09-03). One 211,736-B read of the whole
// GGPO block per tick is ~100 us and is COHERENT (one instant, not 800 instants); every read_at that
// falls inside the block is then served from the copy. Out-of-block reads (objects in the DC-RAM image,
// GGPO inputs, exe globals) still go to the process. Installed right before the per-frame read, cleared
// at the top of every poll so the clock and the rollback spin-reads always see live memory.
thread_local! { static BLK_SNAP: std::cell::RefCell<Option<(usize, Vec<u8>)>> = std::cell::RefCell::new(None); }
pub unsafe fn snap_install(h: &dyn MemSource, blk: usize) {
    let buf = read_at_raw(h, blk, BLK_SIM_LEN);
    BLK_SNAP.with(|c| *c.borrow_mut() = buf.filter(|b| b.len() >= BLK_SIM_LEN).map(|b| (blk, b)));
}
pub fn snap_clear() { BLK_SNAP.with(|c| *c.borrow_mut() = None); }
pub unsafe fn read_at(h: &dyn MemSource, addr: usize, len: usize) -> Option<Vec<u8>> {
    let hit = BLK_SNAP.with(|c| {
        let g = c.borrow();
        match g.as_ref() {
            Some((b, buf)) if addr >= *b && addr + len <= *b + buf.len() => Some(buf[addr - *b..addr - *b + len].to_vec()),
            _ => None,
        }
    });
    if hit.is_some() { return hit; }
    read_at_raw(h, addr, len)
}
pub unsafe fn read_at_raw(h: &dyn MemSource, addr: usize, len: usize) -> Option<Vec<u8>> {
    h.read_mem(addr, len)
}

pub unsafe fn rpm_u8(h: &dyn MemSource, a: usize) -> Option<u8> { read_at(h, a, 1).filter(|b| b.len() >= 1).map(|b| b[0]) }
pub unsafe fn rpm_u16(h: &dyn MemSource, a: usize) -> Option<u16> { read_at(h, a, 2).filter(|b| b.len() >= 2).map(|b| b[0] as u16 | ((b[1] as u16) << 8)) }
pub unsafe fn rpm_u32(h: &dyn MemSource, a: usize) -> Option<u32> { read_at(h, a, 4).filter(|b| b.len() >= 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])) }

pub unsafe fn read_set_score(h: &dyn MemSource, exe_base: usize) -> Option<(u8, u8)> {
    if exe_base == 0 { return None; }
    let b = read_at(h, exe_base + SET_SCORE_PTR_OFF, 8).filter(|b| b.len() >= 8)?;
    let sc = u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]) as usize;
    if sc <= 0x10000 { return None; }   // reject a null / obviously-invalid pointer
    let p1 = rpm_u8(h, sc + SET_P1_WINS_OFF)?;
    let p2 = rpm_u8(h, sc + SET_P2_WINS_OFF)?;
    Some((p1, p2))
}

pub const GS_CAP: usize = 20_000;                       // max unique frames buffered per game (~5.5 min @60fps)
pub const GS_SCHEMA: &str = "[frame,p1_in,p2_in,kcode,hp[6],px[6],py[6],p1_meter,p2_meter,meter_fill,combo_dealt[6],combo_recv[6],vx[6],vy[6],red_hp[6],facing[6],hitstun[6],drawn[6],sid[6],atimer[6],eyeX,eyeY,ground,seat_in[2],sx[6],sy[6],zx[6],zy[6],flash[6],glow[6],layer[6],timer,p2_meter_fill,round_no,zoom,cam_state,look[3],fov,yoff,roll,deck[3],blackout,bg_mode,bg_col[3],fade_mode,fade_col,bg_gate[6]]";   // 0.3.45: +frame background inputs (blk+0x6CB4..0x6CF4, gate bytes)   // 0.3.39: +camera state/look-at/fov/y-off/roll (blk+0x6908..0x698C), deck colour (0x6CA8), blackout gate (0x3D50)   // 0.3.37: +zoom (blk+0x691C, the render camera z = scene CB focal)

#[derive(Clone)]
pub struct GsRow {
    pub frame: u32, pub p1_in: u16, pub p2_in: u16,
    pub kcode: u32,   // ★ the LOCAL pad (flycast kcode[0] @ exe+KCODE_OFF) — correlate vs p1_in/p2_in offline to find
                  //   which team is the reporter's (mirror-proof, skin-independent) → objective W/L attribution.
    pub hp: [u16; 6], pub px: [f32; 6], pub py: [f32; 6],
    pub m1: u8, pub m2: u8, pub mfill: u16, pub cd: [u16; 6], pub cr: [u16; 6],
    // additional per-slot match state
    pub vx: [f32; 6], pub vy: [f32; 6], pub rhp: [u16; 6], pub face: [u8; 6], pub hitstun: [u8; 6], pub act: [u8; 6],
    // replay columns (0.3.23): raw sprite ids + anim countdown per slot, camera globals + ground line
    pub sid: [u16; 6], pub atimer: [u8; 6], pub eye_x: f32, pub eye_y: f32, pub ground: f32,
    pub zoom: f32,         // 0.3.37: blk+0x691C -- the render camera's z (812.357 in every capture so far; the scene CB's focal)
    // 0.3.39 (docs/WORLD-CAMERA-GHIDRA.md + STAGE-DRAW-GHIDRA.md, all Ghidra-CONFIRMED): the world
    // camera is a closed form of eye (0x6914..), look-at (0x695C..), fov (0x6974), y-offset (0x6988),
    // roll u16 (0x698C); in state 0 (blk+0x6908 == 0) look-at == (eye.x, eye.y, 0), fov 43, roll 0 --
    // shipped so a SCRIPTED camera (state 1) can be rendered exactly. Deck colour blk+0x6CA8..0x6CB0
    // = the POL model-0 vertex-colour multiplier; blackout blk+0x3D50 != 0 skips the deck draw.
    pub cam_state: u32, pub look: [f32; 3], pub fov: f32, pub yoff: f32, pub roll: u16, pub deck: [f32; 3], pub blackout: u8,
    // 0.3.45 (APPENDED): frame background inputs. bg_mode = blk+0x6CB4; bg_col = blk+0x6CB8/BC/C0 raw words;
    // fade_mode = blk+0x6CE4; fade_col = blk+0x6CF0; bg_gate = [G+0, G+1, G+2, G+0x2E, entity+6, entity+0x96]
    // (0xFF in the entity bytes = pointer read failed).
    pub bg_mode: u32, pub bg_col: [u32; 3], pub fade_mode: u32, pub fade_col: u32, pub bg_gate: [u8; 6],
    // 0.3.24: the AUTHORITATIVE inputs — the raw pad words at G+0x218+seat*4, UPSTREAM of the 12-entry
    // translation table. This is the column a re-simulator feeds back into the real engine; p1_in/p2_in
    // are the downstream decoded values and are kept only for compatibility with existing consumers.
    pub seat_in: [u32; 2],
    // 0.3.25: the engine's OWN screen coords (H+0x124/0x128) + per-object scale (H+0x130/0x134),
    // per slot. Screen coords remove reconstruction error and stay correct where world+camera
    // reconstruction breaks (round transitions, screen-edge clamps); scale sizes super-freeze/juggle.
    // Appended AFTER seat_in so every existing column index is unchanged.
    pub sx: [f32; 6], pub sy: [f32; 6], pub zx: [f32; 6], pub zy: [f32; 6],
    // 0.3.28: palette-effect columns + per-fighter draw layer + round timer.
    pub flash: [u16; 6],   // H+0x172 hit/hurt-flash word (idle ~0x10/0x18; 0x01..0x0A = flash variants)
    pub glow:  [u8; 6],    // H+0x5C char_pal_effect — super-freeze brighten / palette tint
    pub layer: [u8; 6],    // draw-list layer index per fighter (0..15), from the object walk; 0xFF = not on the list
    pub timer: u8,         // round timer 0..99 (blk battle-state +BG_TIMER)
    // 0.3.29 — APPENDED (positional consumers of every column above are unaffected):
    pub p2_mfill: u16,     // P2 meter fine-fill (MET_FILL+2). mfill above is P1 → fixes the single-shared-meter_fill gap.
    pub round_no: u8,      // game index within the set (blk battle-state +OFF_ROUND)
}
// 0.3.27: one drawn OBJECT-POOL node (effect/projectile/cape/super) captured from the draw list. Read
// through the fighter H-offsets (node = fighter-struct prefix). Fighters are excluded (they are in `frames`).
// owner = the fighter slot 0..5 that owns this node, or 0xFF if none (global super / stage effect).
#[derive(Clone)]
pub struct ObjNode { pub sid: u16, pub sx: i16, pub sy: i16, pub zx: u16, pub face: u8, pub cat: u8, pub owner: u8, pub layer: u8,
                 // 0.3.29: the effect graphics-bank handles the renderer resolves the atlas from. Sprite-class
                 // (cat 1-4) render like a body via the (GFX2, sel=sid) part-assembly, so BOTH the bank handle
                 // and sid are needed — sid alone is ambiguous (effect sids overlap the body sid space).
                 pub gfx1: u32,   // Dat_GFX1 handle (H+0x1A0) — clusters by effect type
                 pub gfx2: u32,   // Dat_GFX2 handle (H+0x1A4) — the part-assembly bank
                 // 0.3.32 FULL EFFECT WIRE (append-only):
                 pub is_effect: u8,   // blk+0x6CE8 value-test (3D-class); feeds computeObjectBlend
                 pub blend: u8,       // sprite-gpu blend NIBBLE {0x00 opaque, 0x45 alpha, 0x11 additive}
                 pub drawn: u8,       // H+0x170 (draw gate) — 1 for every emitted node; honors future relax
                 pub atimer: u8,      // H+0x186 anim-cell countdown
                 pub zy: u16,         // scaleY x4096 (H+0x134)
                 // ── TAPE v3 (append-only; the 32 B objs_enc wire above is untouched) ──
                 // ⭐ THE ORDERING FIX. v2 SKIPPED fighters here, so the one thing the engine
                 // actually has -- a single ordered list with fighters and objects interleaved --
                 // was split into two and could not be put back. On a layer tie the fighter
                 // registers FIRST, so a same-layer object lands on top of its own body: measured,
                 // 4,722 objects share their owner's layer exactly, and 43% of nodes carry the
                 // "draw behind" sort value. That is a cape drawing through a character.
                 pub kind: u8,        // 0 = fighter slot, 1 = pool object
                 pub slot: u8,        // fighter slot 0..5, or 0xFF for a pool object
                 pub sort: i8,        // H+0x4D, SIGNED -- the engine's own intra-layer key
                 pub pal: [u8; 32],   // the node's live 16-colour ARGB4444 palette, interned at serialise time
                 pub flash: u16,      // H+0x172 hit/hurt flash word -- was fighters-only in v2
                 pub glow: u8,        // H+0x5C  char_pal_effect  -- was fighters-only in v2
                 // ⚠ FULL PRECISION. objs_enc rounds screen coords to i16 and that is not good
                 // enough: the captured origins carry a constant sub-pixel camera offset (x .80,
                 // y .067) and native is 0.6x of this space, so rounding shifts sampling by up to a
                 // native pixel. The fighter columns were always f32; the object rows were not.
                 pub fsx: f32, pub fsy: f32,
                 pub effect_key: u16, // low-16 of the in-bank gfx word (else gfx1&0xffff)
                 pub depth: f32,      // H+0x12C (DC node+0xE8) byte-exact z
                 // ── TAPE v4 (append-only; the 44 B v3 layout is the prefix of the 50 B v4 record) ──
                 pub angle: u16,      // H+0x148 rotation angle, 0x10000 = 360 deg (0 = axis-aligned)
                 pub hotx: i16, pub hoty: i16, // H+0x178/+0x17A rotation pivot (hotspot), s16 each
                 // ── 0.3.38 (append-only): the RAW owner link, so an object spawned by another object can be
                 // chained to its fighter offline (owner slot|0xFF alone loses 13% of pool objects)
                 pub owner_off: u32 } // blk-relative offset of *(H+0x28), or 0
// ── TAPE v5: the SYSTEM-A (world-space) class ────────────────────────────────────────────────
// Everything the bodies needed is in `nodes` (System B, 100% against Steam). Shadows, 1P/2P
// markers, super glows, hail chunks, the HUD and the stage props are drawn by the game's OTHER
// render system: singly-linked lists at blk+0x2EDE8 + L*8 (next = node+0x10), walked by Steam's
// FUN_140620740 (models) / FUN_140620cd0 (textured quads), gate node+0x170.
//   node+0xA8 = a column-major 4x4; its row-major 3x4 transpose IS the CBWorld Steam binds for the
//               node's draws (254/307 world-space draws byte-exact on a Hail Storm capture).
//   node+0xA0 = a DC Tile-Accelerator polygon-list object (kept by the recompile) that lives OUTSIDE
//               the state block: header 0x18, then records of a 0x50 header (PCW, ISP, TSP, TCW --
//               the TCW is the texture's DC VRAM address = its stable identity) with the payload
//               size at +0x4C, and 32-byte vertices (x y z nx ny nz u v). Those vertices equal the
//               vertices in Steam's vertex buffer for the draw, checked live.
//   node+0x94.. = colour (3 f32), node+0xF0 = flags (blend/billboard), node+0xE8 = 3D model ptr.
// Per frame we ship every drawn node's matrix/colour/flags/list (96 B) and INTERN the object bytes
// by content hash (a hail chunk's quad is the same 200 B every frame) -- see anodes_enc/aobjs_enc.
#[derive(Clone)]
pub struct ANode { pub list: u8, pub flags: u32, pub matrix: [u8; 64], pub colour: [f32; 3], pub model: u64, pub obj: u16,
             pub alpha: f32 }   // 0.3.39: node+0x90 = the ALPHA MULTIPLIER Steam applies on flag-bit-5 nodes
                            // (FUN_140849c30/be0(obj, node+0x90); < 1.0 forces normal blending via
                            // ctx+0x1f8274 = 0x45) -- the 4/824 blend misses of the render-state gate
pub const ANODES_STRIDE: usize = 100;   // 0.3.39: 96 B v5 record + f32 alpha (node+0x90), APPENDED
pub const ALIST_HEADS: usize = 0x2EDE8;
pub const A_NEXT: usize = 0x10; const A_COLOUR: usize = 0x94; const A_OBJ: usize = 0xA0;
pub const A_ALPHA: usize = 0x90;   // 0.3.39: f32 alpha multiplier (docs/TSP-RENDER-STATE-GHIDRA.md)
pub const A_MATRIX: usize = 0xA8; const A_MODEL: usize = 0xE8; const A_FLAGS: usize = 0xF0; const A_DRAWN: usize = 0x170;
// 0.3.41: objects are interned ONCE per match, so the caps cost nothing per frame; 4 KB / 8 records cut every
// stage prop with more than ~6 meshes (stage 16: models of 9..18 meshes shipped 5..7) = "part of the background
// is missing". A full prop is ~20-40 KB; effects objects are far smaller.
pub const AOBJ_MAX_BYTES: usize = 0x20000;   // 128 KB per object (was 4096)
pub const AOBJ_MAX_RECS: usize = 128;        // (was 8)
pub const ANODES_CAP_PER_FRAME: usize = 96;

pub struct ANodeRaw { pub list: u8, pub flags: u32, pub matrix: [u8; 64], pub colour: [f32; 3], pub model: u64, pub obj: Vec<u8>, pub alpha: f32 }

/// Walk lists 5..=13 and collect every drawn node with a polygon-list object (or a model).
// 0.3.44: per-thread object cache keyed by pointer. An object's first 0x68 bytes (0x18 header + the first
// record header) identify it; when they match the cached copy the cached bytes are reused, so a frame costs
// ONE read per world node instead of 1 + 2 x records (stage props: 9..18 records each). Interned bytes are
// unchanged; only the number of syscalls drops (measured: the gamestate thread at ~32% of a core).
thread_local! { static AOBJ_CACHE: std::cell::RefCell<HashMap<usize, (Vec<u8>, Vec<u8>)>> = std::cell::RefCell::new(HashMap::new()); }
pub unsafe fn harvest_anodes(h: &dyn MemSource, blk: usize, out: &mut Vec<ANodeRaw>) {
    let heads = match read_at(h, blk + ALIST_HEADS, 16 * 8) { Some(b) if b.len() >= 128 => b, _ => return };
    for l in 5usize..=13 {
        let mut p = u64::from_le_bytes(heads[l * 8..l * 8 + 8].try_into().unwrap()) as usize;
        let mut n = 0;
        while p != 0 && n < 200 {
            let nd = match read_at(h, p, 0x180) { Some(b) if b.len() >= 0x180 => b, _ => break };
            let obj = le64(&nd, A_OBJ) as usize;
            let model = le64(&nd, A_MODEL);
            if nd[A_DRAWN] != 0 && (obj != 0 || model != 0) && out.len() < ANODES_CAP_PER_FRAME {
                let mut matrix = [0u8; 64]; matrix.copy_from_slice(&nd[A_MATRIX..A_MATRIX + 64]);
                let colour = [lef32(&nd, A_COLOUR), lef32(&nd, A_COLOUR + 4), lef32(&nd, A_COLOUR + 8)];
                let alpha = lef32(&nd, A_ALPHA);   // 0.3.39
                // the object's records: 0x18 header, then (0x50 header + payload) while the PCW is negative
                let mut ob: Vec<u8> = Vec::new();
                let mut cached = false;
                if obj != 0 {
                    // 0.3.50: the 0.3.44 cache keyed on the first 0x68 B (header + first record header) and so shipped
                    // STALE vertices for animated props (their headers never change) -- found by the receipt runner's
                    // Gate 2 (docs/RECEIPT-RUNNER-GATE2.md, class A). Now the cached object is re-read WHOLE in one call
                    // and reused only when byte-identical: still one syscall per node, and exact by construction.
                    let hit = AOBJ_CACHE.with(|c| c.borrow().get(&obj).map(|(_, bytes)| bytes.len()));
                    if let Some(n) = hit {
                        if let Some(cur) = read_at(h, obj, n).filter(|b| b.len() == n) {
                            AOBJ_CACHE.with(|c| { if let Some((_, bytes)) = c.borrow().get(&obj) { if *bytes == cur { cached = true; } } });
                            if cached { ob = cur; }
                        }
                    }
                    if !cached { if let Some(hd) = read_at(h, obj, 0x18) { ob.extend_from_slice(&hd); } }
                }
                if obj != 0 && !cached {
                    let mut q = obj + 0x18;
                    let mut k = 0;
                    while k < AOBJ_MAX_RECS && ob.len() < AOBJ_MAX_BYTES {
                        let rh = match read_at(h, q, 0x50) { Some(b) if b.len() >= 0x50 => b, _ => break };
                        let pcw = le32(&rh, 0) as i32;
                        if pcw >= 0 { break; }
                        let size = le32(&rh, 0x4C) as usize;
                        if size > AOBJ_MAX_BYTES { break; }
                        ob.extend_from_slice(&rh);
                        if size > 0 { if let Some(pl) = read_at(h, q + 0x50, size) { ob.extend_from_slice(&pl); } else { break; } }
                        q += 0x50 + size;
                        k += 1;
                    }
                }
                if obj != 0 && !cached && ob.len() >= 0x68 {
                    let sig = ob[..0x68].to_vec();   // kept for the cache's shape; the reuse test is the whole object (0.3.50)
                    AOBJ_CACHE.with(|c| { let mut m = c.borrow_mut(); if m.len() > 4096 { m.clear(); } m.insert(obj, (sig, ob.clone())); });
                }
                out.push(ANodeRaw { list: l as u8, flags: le32(&nd, A_FLAGS), matrix, colour, model, obj: ob, alpha });
            }
            n += 1;
            p = le64(&nd, A_NEXT) as usize;
        }
    }
}
pub fn le64(b: &[u8], o: usize) -> u64 { u64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

pub struct GsCapture {
    pub frames: std::collections::BTreeMap<u32, GsRow>, // frame_counter -> row (last-write-wins, sorted)
    pub frame_addr: usize,                              // located guest frame counter (0 = synthetic index)
    pub synthetic: bool,                                // true when no counter found → monotonic per-frame index
    pub assist: [u8; 6],                                // assist type per slot (alpha=0/beta=1/gamma=2) — fixed per match
    pub costume: [u8; 6],                               // 0.3.28: costume/color id per slot (H+0x6C1) — fixed per match
    pub team_ids: [u8; 6],                              // 0.3.48: char id per slot (H+H_CID) at match start — the roster for LOCAL tapes
    pub local_pn: u8,                                   // ★ raw localPlayerNum (exe+LOCALPLAYER_OFF) at match start — the
                                                    //   game's own local netplay index (0/1), UN-overridden by any app
                                                    //   layer. Candidate side signal; validated offline vs the frame KO.
    pub set_start: Option<(u8, u8)>,                    // ★ Tier-3: the game's own per-set WINS tally (P1,P2) snapshotted at
                                                    //   THIS game's START. Paired with set_end (read at win-report) so the
                                                    //   server auto-confirms the winner from the +1 delta (KO AND timeout).
    pub last_update: Option<std::time::Instant>,        // for the recency guard in the snapshot
    // ── 0.3.24 re-simulation payload ──
    pub seat_map: [i32; 4],                             // G+0x258+k*4: GGPO player k → seat index (-1 = unmapped)
    pub rollbacks: u32,                                 // G+0x76C at match end; >0 = GGPO rewound during capture
    pub build_id: String,                               // the game build the tape was recorded against
    pub stage_id: u8,                                   // blk+0x6D3C — the stage number; art rendered from the Collection arc
    pub anchor: Option<Vec<u8>>,                        // gzip(blk[0..BLK_SIM_LEN)) taken at CHARACTER SELECT
    pub anchor_blk: u64,                                // the blk address it was captured at, and
    pub anchor_arena: u64,                              // *(exe+ARENA_PTR_OFF), the 256 MiB arena — the two
    pub anchor_frame: u32,                              // deltas needed to relocate it; blk+0x3CC8 at capture
    pub anchor_hash: u64,                               // FNV-1a of the RAW region — identity + dedup key
    // 0.3.47: the battle-frame receipt anchor: gzip of [blk 0x33B18][game_state page 0x1000][exe page 0x400][ctx slots 0x319C]
    pub battle_anchor: Option<Vec<u8>>, pub battle_anchor_blk: u64, pub battle_anchor_frame: u32, pub battle_anchor_ctx: u64, pub battle_anchor_dcram: u64,
    pub select_in: Vec<(u32, u32, u32)>,                // (frame, seat0, seat1) from the anchor frame to the
                                                    //   first battle frame — WITHOUT these the anchor and
                                                    //   the match frames do not compose (see the capture)
    pub start_sim_frame: u32,                           // blk+0x3CC8 at match start, from the SAME counter as
                                                    //   anchor_frame — an anchor at or after it belongs to
                                                    //   an EARLIER match and must not ship with this tape
    // 0.3.26: GGPO CONFIRMED inputs per frame [seat0, seat1] from the ring — the ground-truth stream a
    //   pure-forward (.flyr) replay consumes. Distinct from seat_in (the predicted G+0x218 latch).
    pub confirmed_in: std::collections::BTreeMap<u32, [u32; 2]>,
    // 0.3.27: per-frame drawn object-pool nodes (effects/projectiles/supers), from the engine draw list.
    pub objs: std::collections::BTreeMap<u32, Vec<ObjNode>>,
    // 0.3.29 self-describing calibration: first CALIB_MAX_FRAMES effect-frames, each node's raw prefix
    //   H+0x00..0x1C0 (cat = prefix[H_CATEGORY]) → derive gfx/scale/owner OFFLINE from any uploaded match.
    pub calib: Vec<(u32, Vec<Vec<u8>>)>,
    pub battle_blk: u64,        // 0.3.29: blk at battle start → fighter_bases = blk+0x3DB8+i*0x738 (offline owner ground-truth)
    pub tie_ggpo_frame: i32,    // 0.3.29: GGPO Sync::_last_confirmed_frame read at battle start (pairs with start_sim_frame)
    // ── TAPE v5: System-A world-space nodes per frame + the interned polygon-list objects ──
    pub anodes: std::collections::BTreeMap<u32, Vec<ANode>>,
    pub palrows: Vec<(u32, [[u8; 32]; 48], [u8; 48])>,   // 0.3.40: per frame the 48 (slot*8+row) staged palette rows + flags
    pub aobjs: Vec<Vec<u8>>,
    pub aobj_idx: HashMap<u64, u16>,
}
impl Default for GsCapture {
    fn default() -> Self { GsCapture { frames: std::collections::BTreeMap::new(), frame_addr: 0, synthetic: false, assist: [0; 6], costume: [0; 6], local_pn: 255, set_start: None, last_update: None,
                                       seat_map: [-1; 4], rollbacks: 0, build_id: String::new(), stage_id: 0, anchor: None, anchor_blk: 0, anchor_arena: 0, anchor_frame: 0, anchor_hash: 0, team_ids: [0; 6],
                                       battle_anchor: None, battle_anchor_blk: 0, battle_anchor_frame: 0, battle_anchor_ctx: 0, battle_anchor_dcram: 0,
                                       select_in: Vec::new(), start_sim_frame: 0, confirmed_in: std::collections::BTreeMap::new(), objs: std::collections::BTreeMap::new(),
                                       calib: Vec::new(), battle_blk: 0, tie_ggpo_frame: -1,
                                       anodes: std::collections::BTreeMap::new(), palrows: Vec::new(), aobjs: Vec::new(), aobj_idx: HashMap::new() } }
}

// A snapshot of the current/just-ended game's frames, taken by on_game_win at KO time.
pub struct GsSnapshot { pub frames: Vec<GsRow>, pub frame_addr: usize, pub synthetic: bool, pub assist: [u8; 6], pub costume: [u8; 6], pub local_pn: u8, pub set_start: Option<(u8, u8)>,
                    // 0.3.24: everything a server needs to RE-SIMULATE this game in the real engine
                    pub seat_map: [i32; 4], pub rollbacks: u32, pub build_id: String, pub stage_id: u8,
                    pub anchor: Option<Vec<u8>>, pub anchor_blk: u64, pub anchor_arena: u64, pub anchor_frame: u32,
                    pub anchor_hash: u64, pub select_in: Vec<(u32, u32, u32)>, pub start_sim_frame: u32,
                    pub battle_anchor: Option<Vec<u8>>, pub battle_anchor_blk: u64, pub battle_anchor_frame: u32, pub battle_anchor_ctx: u64, pub battle_anchor_dcram: u64,
                    pub confirmed_in: std::collections::BTreeMap<u32, [u32; 2]>,
                    pub objs: std::collections::BTreeMap<u32, Vec<ObjNode>>,
                    pub calib: Vec<(u32, Vec<Vec<u8>>)>, pub battle_blk: u64, pub tie_ggpo_frame: i32,
                    pub anodes: std::collections::BTreeMap<u32, Vec<ANode>>, pub aobjs: Vec<Vec<u8>>,
                    pub palrows: Vec<(u32, [[u8; 32]; 48], [u8; 48])> }

pub unsafe fn read_gs_row(h: &dyn MemSource, base: usize, frame: u32, exe_base: usize) -> Option<GsRow> {
    let mut s: Vec<Vec<u8>> = Vec::with_capacity(6);
    for i in 0..6 {
        let buf = read_at(h, base + i * STRIDE, 0xB50)?;   // 0xB50 (was 0xB48) to include red_health @ +0xb48
        if buf.len() < 0xB50 { return None; }
        s.push(buf);
    }
    // ⚠ TRUE OBJECT BASE (see OBJ_BACK): the `s` window starts 0x16C INSIDE the object, so kinematics
    // and render state live BEFORE it. Read a second, small window at H_i for those — additive, so
    // every already-correct field above keeps its exact address and behaviour.
    let mut o: Vec<Vec<u8>> = Vec::with_capacity(6);
    for i in 0..6 {
        let hbase = (base + i * STRIDE).checked_sub(OBJ_BACK)?;
        let buf = read_at(h, hbase, 0x200)?;               // covers +0x50 .. +0x188 (sprite_id)
        if buf.len() < 0x200 { return None; }
        o.push(buf);
    }
    let hp = |i: usize| -> u16 { let v = le32(&s[i], OFF_HEALTH) & 0xffff; if v > 999 { 999 } else { v as u16 } };
    let rhp = |i: usize| -> u16 { let v = u16le(&s[i], OFF_REDHP); if v > 999 { 999 } else { v } };
    let hp_arr = [hp(0), hp(1), hp(2), hp(3), hp(4), hp(5)];
    // STRONG negative gate (matches read_fighters): any real fighter health > 144 means this is a
    // stale/half-written savestate COPY — drop the frame so garbage (hp=235) never enters a recording.
    if hp_arr.iter().any(|&v| v > HP_FULL) { return None; }
    // camera globals — one read covers eyeX/eyeY/ground; (0,0,0) = camera unknown this frame (the
    // consumer falls back / treats it as no-gate rather than failing the whole frame)
    let cam: (f32, f32, f32, f32) = match base.checked_sub(BLK_BACK)
        .and_then(|blk| read_at(h, blk + CAM_EYE_OFF, CAM_WIN)) {
        Some(c) if c.len() >= CAM_WIN => (lef32(&c, 0), lef32(&c, 4), lef32(&c, CAM_GROUND_REL), lef32(&c, 8)),   // +8 = zoom (blk+0x691C)
        _ => (0.0, 0.0, 0.0, 0.0),
    };
    // 0.3.39: camera state window blk+0x6908..0x699C (state u32 @0, look-at @0x54, fov @0x6C,
    // y-offset @0x80, roll u16 @0x84), deck colour blk+0x6CA8 (3 f32), blackout gate blk+0x3D50 (u8)
    let camx: (u32, [f32; 3], f32, f32, u16, [f32; 3], u8) = match base.checked_sub(BLK_BACK) {
        Some(blk) => {
            let w = read_at(h, blk + CAMX_OFF, CAMX_WIN);
            let d = read_at(h, blk + DECK_COL_OFF, 12);
            let g = unsafe { rpm_u8(h, blk + BLACKOUT_OFF) }.unwrap_or(0);
            match (w, d) {
                (Some(w), Some(d)) if w.len() >= CAMX_WIN && d.len() >= 12 => (
                    le32(&w, 0), [lef32(&w, 0x54), lef32(&w, 0x58), lef32(&w, 0x5C)], lef32(&w, 0x6C), lef32(&w, 0x80),
                    u16::from_le_bytes([w[0x84], w[0x85]]), [lef32(&d, 0), lef32(&d, 4), lef32(&d, 8)], g),
                _ => (0, [0.0; 3], 0.0, 0.0, 0, [1.0, 1.0, 1.0], 0),
            }
        }
        None => (0, [0.0; 3], 0.0, 0.0, 0, [1.0, 1.0, 1.0], 0),
    };
    // 0.3.45: background window + gate bytes (docs/FRAME-BACKGROUND-GHIDRA.md)
    let bgw: (u32, [u32; 3], u32, u32) = match base.checked_sub(BLK_BACK).and_then(|blk| unsafe { read_at(h, blk + BG_OFF, BG_WIN) }) {
        Some(w) if w.len() >= BG_WIN => (le32(&w, 0), [le32(&w, 4), le32(&w, 8), le32(&w, 0xC)], le32(&w, 0x30), le32(&w, 0x3C)),
        _ => (0, [0; 3], 0, 0),
    };
    let bg_gate: [u8; 6] = {
        let mut g = [0xFFu8; 6];
        if let Some(blk) = base.checked_sub(BLK_BACK) {
            if let Some(b) = unsafe { read_at(h, blk + 0x3CB8, 0x30) } { if b.len() >= 0x2F { g[0] = b[0]; g[1] = b[1]; g[2] = b[2]; g[3] = b[0x2E]; } }
        }
        if exe_base != 0 {
            if let Some(p) = unsafe { read_at(h, exe_base + ENTITY_PTR_OFF, 8) }.filter(|b| b.len() >= 8) {
                let ent = u64::from_le_bytes([p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]]) as usize;
                if ent > 0x10000 {
                    if let Some(e6) = unsafe { rpm_u8(h, ent + 6) } { g[4] = e6; }
                    if let Some(e96) = unsafe { rpm_u8(h, ent + 0x96) } { g[5] = e96; }
                }
            }
        }
        g
    };
    Some(GsRow {
        frame,
        p1_in: u16le(&s[0], OFF_INPUT), p2_in: u16le(&s[1], OFF_INPUT),
        kcode: if exe_base != 0 { rpm_u32(h, exe_base + KCODE_OFF).unwrap_or(0) } else { 0 },
        hp: hp_arr,
        px: [lef32(&o[0], H_POS_X), lef32(&o[1], H_POS_X), lef32(&o[2], H_POS_X), lef32(&o[3], H_POS_X), lef32(&o[4], H_POS_X), lef32(&o[5], H_POS_X)],
        py: [lef32(&o[0], H_POS_Y), lef32(&o[1], H_POS_Y), lef32(&o[2], H_POS_Y), lef32(&o[3], H_POS_Y), lef32(&o[4], H_POS_Y), lef32(&o[5], H_POS_Y)],
        m1: rpm_u8(h, base + MET_BARS).unwrap_or(0),
        m2: rpm_u8(h, base + MET_BARS + 1).unwrap_or(0),
        mfill: rpm_u16(h, base + MET_FILL).unwrap_or(0),
        cd: [u16le(&s[0], OFF_COMBO), u16le(&s[1], OFF_COMBO), u16le(&s[2], OFF_COMBO), u16le(&s[3], OFF_COMBO), u16le(&s[4], OFF_COMBO), u16le(&s[5], OFF_COMBO)],
        // cr: REMOVED — OFF_COMBO_RECV 0x902 read the NEXT character's combo-dealt. Kept as zeros so the
        //     positional tape schema is unchanged; combo RECEIVED is the opponent's `cd`.
        cr: [0; 6],
        vx: [lef32(&o[0], H_XVEL), lef32(&o[1], H_XVEL), lef32(&o[2], H_XVEL), lef32(&o[3], H_XVEL), lef32(&o[4], H_XVEL), lef32(&o[5], H_XVEL)],
        vy: [lef32(&o[0], H_YVEL), lef32(&o[1], H_YVEL), lef32(&o[2], H_YVEL), lef32(&o[3], H_YVEL), lef32(&o[4], H_YVEL), lef32(&o[5], H_YVEL)],
        rhp: [rhp(0), rhp(1), rhp(2), rhp(3), rhp(4), rhp(5)],
        face: [o[0][H_FACING], o[1][H_FACING], o[2][H_FACING], o[3][H_FACING], o[4][H_FACING], o[5][H_FACING]],
        hitstun: [s[0][OFF_HITSTUN], s[1][OFF_HITSTUN], s[2][OFF_HITSTUN], s[3][OFF_HITSTUN], s[4][OFF_HITSTUN], s[5][OFF_HITSTUN]],
        // act: REPURPOSED. OFF_ACTION 0x76c read the NEXT character. The slot now carries the
        // engine's own DRAW GATE (H+0x170, DC +0x12C): non-zero = the engine rendered this object
        // THIS frame — which is the field a replay actually needs (point chars + a called assist,
        // benched partners excluded). Same width, same position, so the tape schema is unchanged.
        act: [o[0][H_DRAWN], o[1][H_DRAWN], o[2][H_DRAWN], o[3][H_DRAWN], o[4][H_DRAWN], o[5][H_DRAWN]],
        sid: [u16le(&o[0], H_SPRITE_ID), u16le(&o[1], H_SPRITE_ID), u16le(&o[2], H_SPRITE_ID), u16le(&o[3], H_SPRITE_ID), u16le(&o[4], H_SPRITE_ID), u16le(&o[5], H_SPRITE_ID)],
        atimer: [o[0][H_ANIM_TMR], o[1][H_ANIM_TMR], o[2][H_ANIM_TMR], o[3][H_ANIM_TMR], o[4][H_ANIM_TMR], o[5][H_ANIM_TMR]],
        eye_x: cam.0, eye_y: cam.1, ground: cam.2,
        zoom: cam.3,
        cam_state: camx.0, look: camx.1, fov: camx.2, yoff: camx.3, roll: camx.4, deck: camx.5, blackout: camx.6,
        bg_mode: bgw.0, bg_col: bgw.1, fade_mode: bgw.2, fade_col: bgw.3, bg_gate,   // 0.3.45 -- appended
        // 0.3.24: both seats' RAW input words in ONE read (they are adjacent u32s at G+0x218).
        seat_in: match if exe_base != 0 { read_at(h, exe_base + SEATIN_OFF, 8) } else { None } {
            Some(b) if b.len() >= 8 => [le32(&b, 0), le32(&b, 4)],
            _ => [0, 0],
        },
        // 0.3.25 — engine screen coords + per-object scale, from the same `o` window (no extra read).
        sx: [lef32(&o[0], H_SCREEN_X), lef32(&o[1], H_SCREEN_X), lef32(&o[2], H_SCREEN_X), lef32(&o[3], H_SCREEN_X), lef32(&o[4], H_SCREEN_X), lef32(&o[5], H_SCREEN_X)],
        sy: [lef32(&o[0], H_SCREEN_Y), lef32(&o[1], H_SCREEN_Y), lef32(&o[2], H_SCREEN_Y), lef32(&o[3], H_SCREEN_Y), lef32(&o[4], H_SCREEN_Y), lef32(&o[5], H_SCREEN_Y)],
        zx: [lef32(&o[0], H_SCALE_X), lef32(&o[1], H_SCALE_X), lef32(&o[2], H_SCALE_X), lef32(&o[3], H_SCALE_X), lef32(&o[4], H_SCALE_X), lef32(&o[5], H_SCALE_X)],
        zy: [lef32(&o[0], H_SCALE_Y), lef32(&o[1], H_SCALE_Y), lef32(&o[2], H_SCALE_Y), lef32(&o[3], H_SCALE_Y), lef32(&o[4], H_SCALE_Y), lef32(&o[5], H_SCALE_Y)],
        // 0.3.28 — palette-effect words (from the existing `o` window) + timer; layer filled after the draw-list walk.
        flash: [u16le(&o[0], H_HITFLASH), u16le(&o[1], H_HITFLASH), u16le(&o[2], H_HITFLASH), u16le(&o[3], H_HITFLASH), u16le(&o[4], H_HITFLASH), u16le(&o[5], H_HITFLASH)],
        glow:  [o[0][H_SUPERGLOW], o[1][H_SUPERGLOW], o[2][H_SUPERGLOW], o[3][H_SUPERGLOW], o[4][H_SUPERGLOW], o[5][H_SUPERGLOW]],
        layer: [0xFF; 6],
        timer: rpm_u8(h, base + OFF_BG_TIMER).unwrap_or(0),
        // 0.3.29: P2 meter fine-fill (the second u16 of the 4-byte MET_FILL window) + the set game index.
        p2_mfill: rpm_u16(h, base + MET_FILL + 2).unwrap_or(0),
        round_no: rpm_u8(h, base + OFF_ROUND).unwrap_or(0),
    })
}

// 0.3.27: walk the engine's DRAW LIST and collect the object-pool nodes (effects/projectiles/supers) drawn
// THIS frame, in the engine's own layer order. Fighters are skipped (they are captured in `frames`). A pool
// node reads through the SAME H-offsets as a fighter (node = fighter-struct prefix). Read-only RPM. `base`
// is the fighter-array base (blk + BLK_BACK), so blk = base − BLK_BACK.
// ⭐ v3 PALETTE: record the RESOLVED palette, not the rule that picks it. `costume c -> row block
// 8*c` is confirmed, but the SUB-ROW (0..7) within the block is a documented gap -- a captured PL32
// body needs sub-row 2 while every record in its assembly carries FLAGS 0x0000, and the spec marks
// node+0x12d/+0x12e "NO -- GAP". Shipping the 32 bytes the engine is actually pointing at removes
// the need to reproduce a rule we have not derived. Interned, because a match has a handful of
// distinct palettes and thousands of nodes.
pub unsafe fn read_pal(h: &dyn MemSource, ptr: u32) -> [u8; 32] {
    let mut pal = [0u8; 32];
    if ptr != 0 {
        if let Some(v) = read_at(h, ptr as usize, 32) {
            if v.len() >= 32 { pal.copy_from_slice(&v[..32]); }
        }
    }
    pal
}

pub const NODES_STRIDE: usize = 54;   // v4 record (50 B) + u32 owner_off (0.3.38); consumers read `nodes_stride`

pub unsafe fn harvest_objs(h: &dyn MemSource, base: usize, out: &mut Vec<ObjNode>, flayers: &mut [u8; 6],
                       mut calib: Option<&mut Vec<Vec<u8>>>) {
    let blk = match base.checked_sub(BLK_BACK) { Some(b) => b, None => return };
    let mut fighters = [0usize; 6];
    for i in 0..6 { fighters[i] = blk + BLK_H0_OFF + i * STRIDE; }   // fighter node addrs (= draw-list handles AND owner targets)
    let u64_at = |a: usize| read_at(h, a, 8).filter(|b| b.len() >= 8)
        .map(|b| u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]) as usize);
    let rd_u64 = |buf: &[u8], o: usize| -> u64 {
        u64::from_le_bytes([buf[o], buf[o+1], buf[o+2], buf[o+3], buf[o+4], buf[o+5], buf[o+6], buf[o+7]]) };
    // 0.3.32: effect-bank base for the per-node is_effect value-test (fxprobe.py). One read per frame.
    let fx_b: u32 = read_at(h, blk + GFX_B_OFF, 4).filter(|b| b.len() >= 4).map(|b| le32(&b, 0)).unwrap_or(0);
    for l in 0..N_LAYERS {
        let count = (rpm_u8(h, blk + DRAWLIST_COUNTS + l).unwrap_or(0) as usize).min(DRAWLIST_MAX_PER_LAYER);
        for i in 0..count {
            let handle = match u64_at(blk + DRAWLIST_OFF + l * DRAWLIST_LAYER + i * 8) { Some(v) if v > 0x10000 => v, _ => continue };
            // ⭐ v3: a fighter is a node in this list like any other. v2 recorded its layer and
            // `continue`d, which is exactly where the interleaving was lost. Emit it in place; the
            // index it lands at IS its paint order.
            let fslot = fighters.iter().position(|&f| f == handle);
            if let Some(slot) = fslot { flayers[slot] = l as u8; }
            // 0.3.29: read CALIB_PREFIX_LEN (0x1C0) — covers owner (0x28), gfx1/gfx2 (0x1A0/0x1A4) AND the raw
            // calibration prefix H+0x00..0x1C0 in ONE read (was 0x1b0).
            let buf = match read_at(h, handle, CALIB_PREFIX_LEN).filter(|b| b.len() >= CALIB_PREFIX_LEN) { Some(b) => b, None => continue };
            // ⚠ node+0x170 is checked TWICE by the engine -- once at registration (FUN_14061e560
            // @0x14061E590) and again in the walker (FUN_140620F10). A node can be registered and
            // then hidden before the walk, so honouring only the first would emit PHANTOMS. We read
            // after both, which is the conservative side.
            if buf[H_DRAWN] == 0 { continue; }                                // not actually rendered this frame
            let sid = u16le(&buf, H_SPRITE_ID);
            if sid == 0 && fslot.is_none() { continue; }                      // inactive pool node
            // 0.3.29 owner (CONFIRMED live fxprobe): u64 @ H+0x28 == the owning fighter's H-base; 0xFF = ownerless global.
            let ow = rd_u64(&buf, H_OBJ_OWNER) as usize;
            let owner = fighters.iter().position(|&f| f == ow).map(|p| p as u8).unwrap_or(0xFF);
            // 0.3.32 is_effect + effect_key: scan H+0x180..0x1BC for a word landing in [B, B+0x10000).
            let mut is_effect: u8 = 0;
            let mut effect_key: u16 = (le32(&buf, H_GFX1) & 0xffff) as u16;   // fallback discriminator
            if fx_b != 0 {
                let mut o = H_FX_SCAN_LO;
                while o <= H_FX_SCAN_HI {
                    let w = le32(&buf, o) & 0x1FFF_FFFF;
                    if w >= fx_b && w < fx_b.wrapping_add(FX_BANK_WIN as u32) {
                        is_effect = 1;
                        effect_key = (w & 0xffff) as u16;   // DC-style dir key low-16 for _resolveFxSprite
                        break;
                    }
                    o += 4;
                }
            }
            // 0.3.32 per-object blend (port of maplecast computeObjectBlend) -> the sprite-gpu NIBBLE the
            // tape-adapter/sprite-gpu consume directly (0x11 additive / 0x45 alpha / 0x00 opaque).
            let list_type: u8 = if is_effect != 0 { 2 }
                else { match buf[H_CATEGORY] { 0x05|0x06|0x0B|0x0C|0x0D|0x01 => 0, _ => 1 } };
            let blend: u8 = match list_type { 2 => 0x11, 1 => 0x45, _ => 0x00 };
            out.push(ObjNode {
                sid,
                sx: lef32(&buf, H_SCREEN_X).round().clamp(-32768.0, 32767.0) as i16,
                sy: lef32(&buf, H_SCREEN_Y).round().clamp(-32768.0, 32767.0) as i16,
                zx: (lef32(&buf, H_SCALE_X).clamp(0.0, 15.999) * 4096.0) as u16,   // scale ×4096 (decode ÷4096, NOT ÷16)
                face: buf[H_FACING], cat: buf[H_CATEGORY], owner, layer: l as u8,
                gfx1: le32(&buf, H_GFX1),                                     // Dat_GFX1 handle (H+0x1A0)
                gfx2: le32(&buf, H_GFX2),                                     // Dat_GFX2 handle (H+0x1A4)
                // 0.3.32 FULL EFFECT WIRE:
                is_effect, blend, drawn: buf[H_DRAWN], atimer: buf[H_ANIM_TMR],
                zy: (lef32(&buf, H_SCALE_Y).clamp(0.0, 15.999) * 4096.0) as u16,
                effect_key,
                depth: lef32(&buf, H_DEPTH),
                // ── v3 ──
                kind: if fslot.is_some() { 0 } else { 1 },
                slot: fslot.map(|s| s as u8).unwrap_or(0xFF),
                sort: buf[H_SORT] as i8,
                pal: read_pal(h, le32(&buf, H_DATPAL)),
                flash: u16le(&buf, H_HITFLASH),
                glow: buf[H_SUPERGLOW],
                fsx: lef32(&buf, H_SCREEN_X), fsy: lef32(&buf, H_SCREEN_Y),
                // ── v4 ──
                angle: u16le(&buf, H_ANGLE),
                hotx: u16le(&buf, H_HOTSPOT) as i16, hoty: u16le(&buf, H_HOTSPOT + 2) as i16,
                owner_off: if ow >= blk && ow < blk + 0x33B18 { (ow - blk) as u32 } else { H_OWNER_OFF_NONE },
            });
            // 0.3.29 calibration: keep this drawn node's raw prefix (cat = prefix[H_CATEGORY]) for offline derivation.
            if let Some(cal) = calib.as_mut() { cal.push(buf[..CALIB_PREFIX_LEN].to_vec()); }
            if out.len() >= OBJS_CAP_PER_FRAME { return; }
        }
    }
}

// 0.3.24: pin the GAME BUILD a tape was recorded against. Re-simulation is deterministic for the
// IDENTICAL build ONLY, and Steam auto-updates — Fightcade hit exactly this and solved it by gating
// each replay on a version number. We take the loaded module's PE TimeDateStamp + SizeOfImage: they
// move together on any rebuild, and reading them costs one 1 KB read of the in-memory header.
pub unsafe fn game_build_id(h: &dyn MemSource, exe_base: usize) -> String {
    if exe_base == 0 { return String::new(); }
    let hdr = match read_at(h, exe_base, 0x400).filter(|b| b.len() >= 0x400) { Some(b) => b, None => return String::new() };
    if hdr[0] != b'M' || hdr[1] != b'Z' { return String::new(); }
    let e_lfanew = le32(&hdr, 0x3c) as usize;
    if e_lfanew < 0x40 || e_lfanew + 0x60 > hdr.len() { return String::new(); }
    if &hdr[e_lfanew..e_lfanew + 4] != b"PE\0\0" { return String::new(); }
    let stamp = le32(&hdr, e_lfanew + 8);               // IMAGE_FILE_HEADER.TimeDateStamp (sig 4 + machine 2 + nsec 2)
    let size_of_image = le32(&hdr, e_lfanew + 24 + 56); // IMAGE_OPTIONAL_HEADER64.SizeOfImage (+0x38)
    format!("pe{stamp:08x}-{size_of_image:x}")
}

// gzip (flate2 is already a dependency) → base64 (std-only, no crate). Used only off the reader hot path.
pub fn gzip_bytes(data: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    let _ = e.write_all(data);
    e.finish().unwrap_or_default()
}
pub fn b64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 0x3f) as usize] as char);
        out.push(T[((n >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 0x3f) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 0x3f) as usize] as char } else { '=' });
    }
    out
}

// Tier-3: an Option set-score → a top-level JSON value. Some((p1,p2)) → [p1,p2] (2-int array); None → null.
// Explicit (not the tuple-through-json! path) so the shape is unambiguous and absent-safe by construction.
pub fn set_score_json(v: Option<(u8, u8)>) -> serde_json::Value {
    match v { Some((a, b)) => serde_json::json!([a, b]), None => serde_json::Value::Null }
}

/// The tape RECORD (the .json.gz the agent spools and uploads), built from a GsSnapshot. This is the inline body of
/// `spool_gamestate` up to the gzip, moved verbatim (GATE 2, docs/RECEIPT-RUNNER-GATE2.md): the live agent and the
/// receipt-runner emitter (runner.rs) call this ONE function, so a runner tape is the same bytes for the same state.
pub struct BuiltRecord { pub gz: Vec<u8>, pub frame_count: usize, pub anchor_dropped: Option<(u32, u32)> }
pub fn build_gamestate_record(match_key: &str, reporter: &str, side: u8, p1_team: &[u8], p2_team: &[u8],
                              winner: &str, loser: &str, gs: &GsSnapshot, session_id: &str, match_index: u32,
                              set_end: Option<(u8, u8)>, ts: u64) -> BuiltRecord {
    let id = format!("{}_{}", match_key, reporter);
    // ── tape continuity, stated rather than assumed ──
    // The capture polls a frame counter from a thread; a slow poll drops that frame's input, and on
    // re-simulation the previous input persists instead (the engine's own store is NOPed), which
    // diverges silently. GS_CAP also stops accepting NEW frames once hit, truncating the tail. So
    // say so in the record: span vs count is the check a consumer can actually gate on.
    let (f_first, f_last) = (gs.frames.first().map(|r| r.frame).unwrap_or(0),
                             gs.frames.last().map(|r| r.frame).unwrap_or(0));
    let frame_span = f_last.saturating_sub(f_first).saturating_add(1);
    let frame_gaps = frame_span.saturating_sub(gs.frames.len() as u32);
    let truncated = gs.frames.len() >= GS_CAP;
    // An anchor stamped at or after this match's first sim frame was captured for an EARLIER match.
    // Two games can run back to back with no character select between them, and the anchor is
    // deliberately kept across a match start — so this is the check that keeps that from shipping.
    let anchor_ok = gs.anchor.is_some() && gs.start_sim_frame != 0 && gs.anchor_frame < gs.start_sim_frame;
    let anchor_dropped = if gs.anchor.is_some() && !anchor_ok { Some((gs.anchor_frame, gs.start_sim_frame)) } else { None };
    let anchor = if anchor_ok { gs.anchor.as_ref() } else { None };
    let frames: Vec<serde_json::Value> = gs.frames.iter().map(|r| serde_json::json!([
        r.frame, r.p1_in, r.p2_in, r.kcode, r.hp, r.px, r.py, r.m1, r.m2, r.mfill, r.cd, r.cr,
        r.vx, r.vy, r.rhp, r.face, r.hitstun, r.act,
        r.sid, r.atimer, r.eye_x, r.eye_y, r.ground, r.seat_in,
        r.sx, r.sy, r.zx, r.zy,
        r.flash, r.glow, r.layer, r.timer,
        r.p2_mfill, r.round_no,  // 0.3.29 — appended
        r.zoom,                  // 0.3.37 — appended
        r.cam_state, r.look, r.fov, r.yoff, r.roll, r.deck, r.blackout,  // 0.3.39 — appended
        r.bg_mode, r.bg_col, r.fade_mode, r.fade_col, r.bg_gate          // 0.3.45 — appended
    ])).collect();
    // the complete artifact that lands on disk (server writes the gunzip-able bytes verbatim)
    let assist_p1 = [gs.assist[0], gs.assist[2], gs.assist[4]];
    let assist_p2 = [gs.assist[1], gs.assist[3], gs.assist[5]];
    // Tier-3: the game's own per-set WINS tally — set_start (this game's start) + set_end (win-report). Each is
    // an Option<(u8,u8)> that serializes as [p1,p2] or null (a failed read → null), so old tapes / failed reads
    // are absent-safe. The server derives/auto-confirms the winner from the +1 delta (works for KO AND timeout).
    let set_start = gs.set_start;
    // Computed OUTSIDE the json! macro on purpose: it expands recursively per token, and the
    // envelope is long enough that inline expressions push it past the default recursion limit.
    let anchor_b64 = anchor.map(|g| b64_encode(g));
    let anchor_gz_len = anchor.map(|g| g.len()).unwrap_or(0);
    let select_raw: Vec<u8> = gs.select_in.iter()
        .flat_map(|(f, a, b)| [f.to_le_bytes(), a.to_le_bytes(), b.to_le_bytes()])
        .flatten().collect();
    let select_b64 = b64_encode(&gzip_bytes(&select_raw));
    // 0.3.26: the CONFIRMED (post-rollback) input stream from the GGPO ring — the exact stream a
    // pure-forward .flyr replay consumes (proven bit-exact vs the Steam sim). Same encoding as select_in.
    let confirmed_raw: Vec<u8> = gs.confirmed_in.iter()
        .flat_map(|(f, ab)| [f.to_le_bytes(), ab[0].to_le_bytes(), ab[1].to_le_bytes()])
        .flatten().collect();
    let confirmed_b64 = b64_encode(&gzip_bytes(&confirmed_raw));
    // 0.3.29: per-frame drawn object-pool (effects). Flat: for each frame with objects,
    //   [u32 frame][u16 count][count × 20B {u16 sid, i16 sx, i16 sy, u16 zx(×4096), u8 face, u8 cat, u8 owner,
    //   u8 layer, u32 gfx1(H+0x1A0 Dat_GFX1 handle), u32 gfx2(H+0x1A4 Dat_GFX2 handle)}].
    let objs_raw: Vec<u8> = {
        let mut b = Vec::new();
        for (f, all) in &gs.objs {
            // ⚠ BACK-COMPAT: v3 harvest now emits FIGHTERS into this list too, but objs_enc has
            // always been "pool objects only" at a fixed 32 B stride, and existing consumers parse
            // it positionally. Filter them back out so this wire stays byte-identical; the v3
            // nodes_enc below is where the interleaved list lives.
            let nodes: Vec<&ObjNode> = all.iter().filter(|n| n.kind != 0).collect();
            let n = nodes.len().min(0xffff);
            b.extend_from_slice(&f.to_le_bytes());
            b.extend_from_slice(&(n as u16).to_le_bytes());
            for nd in nodes.iter().take(n) {
                b.extend_from_slice(&nd.sid.to_le_bytes());
                b.extend_from_slice(&nd.sx.to_le_bytes());
                b.extend_from_slice(&nd.sy.to_le_bytes());
                b.extend_from_slice(&nd.zx.to_le_bytes());
                b.push(nd.face); b.push(nd.cat); b.push(nd.owner); b.push(nd.layer);
                b.extend_from_slice(&nd.gfx1.to_le_bytes());   // 0.3.29: Dat_GFX1 handle (H+0x1A0)
                b.extend_from_slice(&nd.gfx2.to_le_bytes());   // 0.3.29: Dat_GFX2 handle (H+0x1A4)
                // 0.3.32 FULL EFFECT WIRE (append-only, 12 B):
                b.push(nd.is_effect); b.push(nd.blend); b.push(nd.drawn); b.push(nd.atimer);
                b.extend_from_slice(&nd.zy.to_le_bytes());
                b.extend_from_slice(&nd.effect_key.to_le_bytes());
                b.extend_from_slice(&nd.depth.to_le_bytes());
            }
        }
        b
    };
    let objs_b64 = b64_encode(&gzip_bytes(&objs_raw));
    // ⭐ TAPE v3 — ONE ORDERED LIST. Same frames, but fighters and pool objects interleaved in the
    // engine's own draw order, so the consumer paints by INDEX and needs no sort key, no layer
    // direction rule and no registration model. Everything that made ordering hard is a hazard of
    // RECONSTRUCTING the order; recording it removes all of them at once:
    //   * registration order is fighters -> list 3 -> 4 -> 1 -> 2 (NOT 1,2,3,4), and the sort is
    //     stable, so tie order IS draw order for ~86% of nodes;
    //   * the writer that SETS the sort key was never located, so the key can be read but not
    //     predicted -- a derive-client-side design would need it, this does not.
    // objs_enc above is left byte-identical for existing consumers.
    //   [u32 frame][u16 count][count x 44B {u8 kind, u8 slot, u8 cat, i8 sort, u8 layer, u8 face,
    //    u8 owner, u8 drawn, u16 sid, u16 pal, u16 flash, u8 glow, u8 is_effect, u8 blend,
    //    u8 atimer, u16 zx, u16 zy, u16 effect_key, f32 fsx, f32 fsy, f32 depth,
    //    u32 gfx1, u32 gfx2}]
    let mut pal_tab: Vec<[u8; 32]> = Vec::new();
    let nodes_raw: Vec<u8> = {
        let mut b = Vec::new();
        for (f, nodes) in &gs.objs {
            let n = nodes.len().min(0xffff);
            b.extend_from_slice(&f.to_le_bytes());
            b.extend_from_slice(&(n as u16).to_le_bytes());
            for nd in nodes.iter().take(n) {
                b.push(nd.kind); b.push(nd.slot); b.push(nd.cat); b.push(nd.sort as u8);
                b.push(nd.layer); b.push(nd.face); b.push(nd.owner); b.push(nd.drawn);
                b.extend_from_slice(&nd.sid.to_le_bytes());
                let pi = match pal_tab.iter().position(|p| *p == nd.pal) {
                    Some(i) => i as u16,
                    None if pal_tab.len() < 0xFFFE => { pal_tab.push(nd.pal); (pal_tab.len() - 1) as u16 }
                    None => 0xFFFF,
                };
                b.extend_from_slice(&pi.to_le_bytes());
                b.extend_from_slice(&nd.flash.to_le_bytes());
                b.push(nd.glow); b.push(nd.is_effect); b.push(nd.blend); b.push(nd.atimer);
                b.extend_from_slice(&nd.zx.to_le_bytes());
                b.extend_from_slice(&nd.zy.to_le_bytes());
                b.extend_from_slice(&nd.effect_key.to_le_bytes());
                b.extend_from_slice(&nd.fsx.to_le_bytes());
                b.extend_from_slice(&nd.fsy.to_le_bytes());
                b.extend_from_slice(&nd.depth.to_le_bytes());
                b.extend_from_slice(&nd.gfx1.to_le_bytes());
                b.extend_from_slice(&nd.gfx2.to_le_bytes());
                // v4 tail (6 B): consumers read `nodes_stride` and must accept 44 (v3) and 50 (v4).
                b.extend_from_slice(&nd.angle.to_le_bytes());
                b.extend_from_slice(&nd.hotx.to_le_bytes());
                b.extend_from_slice(&nd.hoty.to_le_bytes());
                b.extend_from_slice(&nd.owner_off.to_le_bytes());   // 0.3.38 tail (4 B): stride 54
            }
        }
        b
    };
    let nodes_b64 = b64_encode(&gzip_bytes(&nodes_raw));
    // TAPE v5: per-frame System-A nodes (96 B each) + the interned polygon-list objects they index.
    let anodes_raw: Vec<u8> = {
        let mut b = Vec::new();
        for (f, list) in &gs.anodes {
            let n = list.len().min(0xffff);
            b.extend_from_slice(&f.to_le_bytes());
            b.extend_from_slice(&(n as u16).to_le_bytes());
            for a in list.iter().take(n) {
                b.push(a.list); b.push(0); b.push(0); b.push(0);
                b.extend_from_slice(&a.flags.to_le_bytes());
                b.extend_from_slice(&a.matrix);
                for c in &a.colour { b.extend_from_slice(&c.to_le_bytes()); }
                b.extend_from_slice(&a.obj.to_le_bytes());
                b.extend_from_slice(&0u16.to_le_bytes());
                b.extend_from_slice(&a.model.to_le_bytes());
                b.extend_from_slice(&a.alpha.to_le_bytes());   // 0.3.39 tail (4 B): stride 100
            }
        }
        b
    };
    let anodes_b64 = b64_encode(&gzip_bytes(&anodes_raw));
    let aobjs_raw: Vec<u8> = {
        let mut b = Vec::new();
        b.extend_from_slice(&(gs.aobjs.len().min(0xffff) as u16).to_le_bytes());
        for o in gs.aobjs.iter().take(0xffff) { b.extend_from_slice(&(o.len() as u32).to_le_bytes()); b.extend_from_slice(o); }
        b
    };
    let aobjs_b64 = b64_encode(&gzip_bytes(&aobjs_raw));
    // 0.3.40 `palrows`: [u32 frame][48 x u16 pal index (slot*8+row)][48 x u8 flag] = 148 B/frame, interned
    // through the SAME `pal_tab` so `pals` stays one table (built BEFORE pals_raw on purpose).
    let palrows_raw: Vec<u8> = {
        let mut b = Vec::new();
        for (f, rows, flags) in &gs.palrows {
            b.extend_from_slice(&f.to_le_bytes());
            for r in rows.iter() {
                let pi = match pal_tab.iter().position(|p| p == r) {
                    Some(i) => i as u16,
                    None if pal_tab.len() < 0xFFFE => { pal_tab.push(*r); (pal_tab.len() - 1) as u16 }
                    None => 0xFFFF,
                };
                b.extend_from_slice(&pi.to_le_bytes());
            }
            b.extend_from_slice(flags);
        }
        b
    };
    let palrows_b64 = b64_encode(&gzip_bytes(&palrows_raw));
    // the palette table the nodes' `pal` indexes into: 32 B of ARGB4444 each, in first-seen order.
    let pals_raw: Vec<u8> = pal_tab.iter().flat_map(|p| p.iter().copied()).collect();
    let pals_b64 = b64_encode(&gzip_bytes(&pals_raw));
    // 0.3.29 CALIBRATION BLOB (self-describing): first CALIB_MAX_FRAMES effect-frames, each drawn node's raw
    //   prefix H+0x00..0x1C0 (cat = prefix[0x03]). Lets gfx/scale/owner be re-derived OFFLINE from any uploaded
    //   match — no live session — and survive a build shifting an offset. Format:
    //   [u32 frame][u16 node_count][node_count × 448B prefix].
    let calib_raw: Vec<u8> = {
        let mut b = Vec::new();
        for (f, nodes) in &gs.calib {
            let n = nodes.len().min(0xffff);
            b.extend_from_slice(&f.to_le_bytes());
            b.extend_from_slice(&(n as u16).to_le_bytes());
            for pfx in nodes.iter().take(n) { b.extend_from_slice(pfx); }
        }
        b
    };
    let calib_b64 = b64_encode(&gzip_bytes(&calib_raw));
    // 0.3.29 fighter_bases: the six absolute node addrs at battle start (blk+0x3DB8+i*0x738) → the offline
    //   owner ground-truth the calibration blob is diffed against. battle_blk==0 means it wasn't captured.
    let fighter_bases: Vec<u64> = (0..6).map(|i| gs.battle_blk.wrapping_add((BLK_H0_OFF + i * STRIDE) as u64)).collect();
    let anchor_hash_hex = format!("{:016x}", gs.anchor_hash);
    let record = serde_json::json!({
        "id": id, "match_key": match_key, "reporter": reporter, "side": side,
        "local_pn": gs.local_pn,   // raw localPlayerNum (0/1/255=unknown) — candidate side signal for offline validation
        "session_id": session_id, "match_index": match_index,   // gs-96: the ranked set this game belongs to
        "ver": env!("CARGO_PKG_VERSION"),   // gs-98: app build that recorded this (fixed vs pre-fix)
        "p1_team": p1_team, "p2_team": p2_team, "winner": winner, "loser": loser,
        "assist": gs.assist, "assist_p1": assist_p1, "assist_p2": assist_p2,
        "costume": gs.costume,   // 0.3.28: costume/color id per slot (H+0x6C1), static per match

        "set_start": set_score_json(set_start), "set_end": set_score_json(set_end),   // Tier-3 set-score (KO+timeout); [p1,p2] or null
        "ts": ts, "schema": GS_SCHEMA,
        "frame_counter_addr": gs.frame_addr as u64, "synthetic_frames": gs.synthetic,
        // ── 0.3.24 RE-SIMULATION ENVELOPE ── the tape stops DESCRIBING the match and starts REPRODUCING it.
        // seat_map says which GGPO player is which seat (the side-swap fixed at its root); rollbacks > 0 means
        // GGPO rewound mid-capture; build_id pins the game build (determinism holds for the IDENTICAL build
        // only); anchor is gzip+base64 of blk[0..0x33B18) taken at CHARACTER SELECT — restore it, relocate its
        // pointers by (new_blk − anchor_blk) / (new_arena − anchor_arena), then feed seat_in[] frame by frame.
        "seat_map": gs.seat_map, "rollbacks": gs.rollbacks, "build_id": gs.build_id, "stage_id": gs.stage_id,
        "battle_anchor": gs.battle_anchor.as_ref().map(|g| b64_encode(g)).unwrap_or_default(),
        "battle_anchor_blk": gs.battle_anchor_blk, "battle_anchor_frame": gs.battle_anchor_frame,
        "battle_anchor_ctx": gs.battle_anchor_ctx, "battle_anchor_dcram": gs.battle_anchor_dcram,
        "battle_anchor_enc": "0.3.47 -- gzip+base64 of [blk 0x33B18 B][game_state page 0x1000 B @exe+0xAC6D40][exe page 0x400 B @exe+0x2EDF300][ctx texture-slot table 0x319C B @ctx+0x1E0030], all read at ONE clock edge at the first battle frame; carry list = docs/DETERMINISM-CONTRACT.md s1.1b. Relocate blk pointers by (blk_new - battle_anchor_blk), DC-RAM pointers by (dcram_new - battle_anchor_dcram).",
        "anchor": anchor_b64, "anchor_gz_len": anchor_gz_len,
        "anchor_sim_len": BLK_SIM_LEN as u64, "anchor_enc": "gzip+base64",
        "anchor_blk": gs.anchor_blk, "anchor_arena": gs.anchor_arena, "anchor_frame": gs.anchor_frame,
        "anchor_hash": anchor_hash_hex,
        // The bridge between the anchor and the battle frames: (frame, seat0, seat1) for every
        // character-select frame. A re-simulator restores the anchor, feeds these, and arrives at
        // the first battle frame with the right teams picked — then feeds seat_in from `frames`.
        // gzip+base64 for the same reason as the anchor: it is 12 B/frame raw and compresses hard.
        "select_in": select_b64, "select_in_frames": gs.select_in.len(),
        "select_in_enc": "gzip+base64 of (u32 frame, u32 seat0, u32 seat1) triples",
        // 0.3.26: GGPO CONFIRMED per-frame inputs from the InputQueue ring — the pure-forward .flyr
        // replay stream (post-rollback ground truth). seat_in in `frames` is the PREDICTED latch; this
        // is what a deterministic re-sim actually consumes. See docs/CONFIRMED-TAPE-AND-FLYR-REPLAY.md.
        "confirmed_in": confirmed_b64, "confirmed_in_frames": gs.confirmed_in.len(),
        "confirmed_in_enc": "gzip+base64 of (u32 frame, u32 seat0_confirmed, u32 seat1_confirmed) triples",
        // 0.3.27: per-frame OBJECT POOL — projectiles/assist-shots/capes/hit-sparks/supers, from the engine
        // draw list, in layer order (z = layer). owner = fighter slot 0..5 or 0xFF. The renderer draws these
        // via onOBJS (own-origin anchor) — no reconstruction. Fighters are NOT here (they are in `frames`).
        "objs": objs_b64, "objs_frames": gs.objs.len(),
        // ⭐ TAPE v3: the engine's own draw list, fighters and pool objects interleaved, IN ORDER.
        // The consumer paints by index -- no sort key to apply, no layer direction to choose, no
        // registration model to reproduce. `pals` is the palette table `pal` indexes into.
        "nodes": nodes_b64, "nodes_frames": gs.objs.len(), "pals": pals_b64, "pals_n": pal_tab.len(),
        "palrows": palrows_b64, "palrows_frames": gs.palrows.len(), "palrows_stride": 148, "palrows_ver": 1,
        "palrows_enc": "0.3.40 -- gzip+base64 of per-frame [u32 frame][48 x u16 index into `pals` (slot*8+row: the engine-resolved 16-colour rows staged at blk+0x13C0+slot*0x1C0+row*0x38+0x18, FUN_1406146d0)][48 x u8 flag (line +8: 1 raw pending, 2 dim pending, 0 uploaded)]. Per-part row = rec.flags>>4. Supersedes `pal` (DatPal+0 = costume 0 row 0). docs/PALETTE-SOURCE-GHIDRA.md",
        "nodes_stride": NODES_STRIDE,
        "nodes_ver": 4,
        // ⭐ TAPE v5: the world-space class (shadows, markers, glows, hail, HUD, stage props).
        "tape_ver": 5,
        "anodes": anodes_b64, "anodes_frames": gs.anodes.len(), "anodes_stride": ANODES_STRIDE,
        "aobjs": aobjs_b64, "aobjs_n": gs.aobjs.len(),
        "anodes_enc": "TAPE v5 -- gzip+base64 of per-frame [u32 frame, u16 count, count x 96 B {u8 list(5..13), u8 pad[3], u32 flags(node+0xF0), f32[16] matrix(node+0xA8, column-major 4x4; row-major 3x4 transpose == Steam CBWorld), f32[3] colour(node+0x94), u16 obj(index into aobjs; 0xFFFF = none), u16 pad, u64 model(node+0xE8 pointer, 0 = quad), f32 alpha(node+0x90, 0.3.39, stride 100)}]. List order = the engine's; lists are drawn after the sprite walk.",
        "aobjs_enc": "gzip+base64 of [u16 count, count x (u32 len, bytes)] -- each object = the node's DC TA polygon list read at node+0xA0: 0x18 header, then records {0x50 header: u32 PCW, ISP, TSP, TCW(texture VRAM address = stable texture id), ..., i32 payload_size @+0x4C; payload: 2 lead dwords then 32-B vertices f32 x y z nx ny nz u v}. Interned by content hash across the tape.",
        "nodes_enc": "TAPE v4 -- gzip+base64 of per-frame [u32 frame, u16 count, count x `nodes_stride` B (44 = v3 prefix, +6 B v4 tail: u16 angle(H+0x148, 0x10000=360deg), i16 hotx(H+0x178), i16 hoty(H+0x17A)) {u8 kind(0=fighter,1=pool), u8 slot(0..5 or 0xFF), u8 cat(H+0x03), i8 sort(H+0x4D SIGNED -- the engine's intra-layer key), u8 layer(H+0x38), u8 face(H+0x154), u8 owner(slot|0xFF), u8 drawn(H+0x170), u16 sid(H+0x188 RAW, bit15=xform), u16 pal(index into `pals`; 0xFFFF=none), u16 flash(H+0x172), u8 glow(H+0x5C), u8 is_effect, u8 blend(0x11 add/0x45 alpha/0x00 opaque), u8 atimer(H+0x186), u16 zx(scaleX x4096, H+0x130), u16 zy(scaleY x4096, H+0x134), u16 effect_key, f32 fsx(H+0x124), f32 fsy(H+0x128), f32 depth(H+0x12C), u32 gfx1(H+0x1A0), u32 gfx2(H+0x1A4)}]. ORDER IS THE PAYLOAD: index = paint order, back to front, exactly as FUN_140620F10 walks it (layer 0..15 ascending, then array index 0..count-1).",
        "pals_enc": "gzip+base64 of pals_n x 32 B ARGB4444 (16 colours), first-seen order. Read from the node's live palette pointer at H+0x1B8 -- NOT reconstructed from costume, because the sub-row within a costume's 8-row block is still an open gap (node+0x12d/+0x12e).",
        "objs_enc": "gzip+base64 of per-frame [u32 frame, u16 count, count x 32B {u16 sid, i16 sx, i16 sy, u16 zx(scaleX x4096; /4096), u8 face, u8 cat(render/blend class), u8 owner(slot|0xFF), u8 layer, u32 gfx1(H+0x1A0), u32 gfx2(H+0x1A4), u8 is_effect(blk+0x6CE8 value-test; 3D-class), u8 blend(sprite-gpu nibble 0x11 add/0x45 alpha/0x00 opaque, computeObjectBlend), u8 drawn(H+0x170!=0), u8 atimer(H+0x186), u16 zy(scaleY x4096, H+0x134), u16 effect_key(in-bank gfx low16 else gfx1&0xffff), f32 depth(H+0x12C=DC node+0xE8)}]",
        // 0.3.29 self-describing calibration blob (raw effect-node prefixes) + offline owner ground-truth + the
        // GGPO<->sim clock tie-point. See docs/OWNED-RENDER-BUILD-SPEC.md "0.3.29 CAPTURE DELTA".
        "calib": calib_b64, "calib_frames": gs.calib.len(),
        "calib_enc": "gzip+base64 of per-frame [u32 frame, u16 node_count, node_count x 448B raw node prefix H+0x00..0x1C0 (cat=prefix[0x03])]",
        "fighter_bases": fighter_bases, "battle_blk": gs.battle_blk,
        "ggpo_sim_tie": { "sim_frame": gs.start_sim_frame, "ggpo_frame": gs.tie_ggpo_frame },
        "start_sim_frame": gs.start_sim_frame,
        // continuity: frame_gaps > 0 means input frames are MISSING and a re-simulation will diverge;
        // truncated means GS_CAP stopped accepting new frames and the tail of the match is absent.
        "frame_first": f_first, "frame_last": f_last, "frame_span": frame_span,
        "frame_gaps": frame_gaps, "truncated": truncated,
        "frame_count": frames.len(), "frames": frames,
    });
    let gz = gzip_bytes(&serde_json::to_vec(&record).unwrap_or_default());
    BuiltRecord { gz, frame_count: frames.len(), anchor_dropped }
}

/// Everything the capture reads ONCE at match start (the envelope fields), in the order the 0.3.48 capture loop read them.
pub struct MatchStart { pub assist: [u8; 6], pub costume: [u8; 6], pub team_ids: [u8; 6], pub local_pn: u8, pub set_start: Option<(u8, u8)>,
                        pub seat_map: [i32; 4], pub build_id: String, pub stage_id: u8, pub start_sim_frame: u32, pub battle_blk: u64, pub tie_ggpo_frame: i32 }
pub unsafe fn read_match_start(h: &dyn MemSource, base: usize, exe_base: usize) -> MatchStart {
    let mut assist = [0u8; 6];
    for i in 0..6 { assist[i] = rpm_u8(h, base + i * STRIDE + OFF_ASSIST).unwrap_or(0); }
    // 0.3.28: costume/color id per fighter (H+0x6C1, adjacent to CID) — chosen at select, static per match.
    let mut costume = [0u8; 6];
    for i in 0..6 { costume[i] = (base + i * STRIDE).checked_sub(OBJ_BACK).and_then(|hb| rpm_u8(h, hb + H_CID + 1)).unwrap_or(0); }
    let mut team_ids = [0u8; 6];   // 0.3.48
    for i in 0..6 { team_ids[i] = (base + i * STRIDE).checked_sub(OBJ_BACK).and_then(|hb| rpm_u8(h, hb + H_CID)).unwrap_or(0); }
    // Tier-3: snapshot the game's own per-set WINS tally at THIS game's START (read-only, guarded → None
    // on any failure). Paired with set_end (read at win-report) so the server auto-confirms via the delta.
    let set_start = read_set_score(h, exe_base);
    let local_pn = if exe_base != 0 { rpm_u32(h, exe_base + LOCALPLAYER_OFF).unwrap_or(255) as u8 } else { 255 };
    // ── 0.3.24 ── which GGPO player is which seat (G+0x258+k*4). Never read before 0.3.24; that
    // omission is the root cause of the documented side-swap. Read once, at match start.
    let mut seat_map = [-1i32; 4];
    if exe_base != 0 {
        if let Some(b) = read_at(h, exe_base + SEATMAP_OFF, 16).filter(|b| b.len() >= 16) {
            for k in 0..4 { seat_map[k] = le32(&b, k * 4) as i32; }
        }
    }
    let build_id = game_build_id(h, exe_base);
    // Stage number, blk+0x6D04 (NOT 0x6D3C — that read 0 in every capture; see STG_OFF).
    // ⚠ It is the stage-SELECT CURSOR (FUN_14062a720), which the match loader CONSUMES (caseD_5 @0x14060ed0a,
    // FUN_14060c370 case 1 indexing DAT_140a6aa80/aa30[id]). So it is the resident bank's stage only ONCE A
    // MATCH IS LOADED -- at character select it has already advanced to the NEXT pick while the previous
    // match's bank is still resident. The caller must therefore only reach here in battle; reader.rs's start
    // gate enforces that (mode byte blk+0x3CB8[2] == 2). It is const for the DURATION of a loaded match.
    let stage_id = base.checked_sub(BLK_BACK).and_then(|blk| rpm_u8(h, blk + STG_OFF)).unwrap_or(0);
    // The sim frame this match starts on, read from blk+0x3CC8 — the SAME counter the
    // anchor stamped itself with. Any anchor at or after it was captured before an
    // EARLIER match (two games can run without an intervening character select), and
    // shipping it would hand a server a savestate for the wrong fight.
    let start_sim_frame = base.checked_sub(BLK_BACK).and_then(|blk| rpm_u32(h, blk + BLK_FRAME_OFF)).unwrap_or(0);
    // 0.3.29 ENVELOPE: blk at battle start (→ fighter_bases offline) + the GGPO frontier at the SAME
    // instant (Sync::_last_confirmed_frame). Pairs with start_sim_frame as ggpo_sim_tie so the
    // confirmed_in↔frames clock offset pins exactly. Best-effort: -1 if the GGPO session isn't up.
    let battle_blk = base.checked_sub(BLK_BACK).unwrap_or(0) as u64;
    let tie_ggpo_frame = if exe_base != 0 {
        match read_at(h, exe_base + GGPO_SESSION_OFF, 8).filter(|b| b.len() >= 8) {
            Some(b) => {
                let sess = u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]) as usize;
                if sess > 0x10000 && sess < 0x7fff_ffff_ffff {
                    rpm_u32(h, sess + GGPO_SYNC_OFF + SYNC_LASTCONF_OFF).map(|v| v as i32).unwrap_or(-1)
                } else { -1 }
            }
            None => -1,
        }
    } else { -1 };
    MatchStart { assist, costume, team_ids, local_pn, set_start, seat_map, build_id, stage_id, start_sim_frame, battle_blk, tie_ggpo_frame }
}

/// 0.3.40: the engine-resolved palette rows, one 0x540-B read, same block, same instant (was inline in the capture loop).
pub unsafe fn read_palrows(h: &dyn MemSource, blk: usize) -> Option<([[u8; 32]; 48], [u8; 48])> {
    let pb = read_at(h, blk + PAL_STAGE_OFF, PAL_STAGE_LEN).filter(|b| b.len() >= PAL_STAGE_LEN)?;
    let mut rows = [[0u8; 32]; 48];
    let mut flags = [0u8; 48];
    for i in 0..48 {
        let o = i * PAL_STAGE_STRIDE;
        rows[i].copy_from_slice(&pb[o + PAL_STAGE_COLS..o + PAL_STAGE_COLS + 32]);
        flags[i] = pb[o + PAL_STAGE_FLAG] & 3;
    }
    Some((rows, flags))
}

impl GsCapture {
    /// A game is starting: reset the per-game buffers and take the match-start envelope (the 0.3.48 capture loop's
    /// lock-held block, verbatim). `frame_addr` = the located clock (0 = synthetic).
    pub fn begin_match(&mut self, ms: &MatchStart, frame_addr: usize, synthetic: bool) {
        self.frames.clear();
        self.confirmed_in.clear();   // 0.3.26: this game owns its confirmed-input buffer
        self.objs.clear();           // 0.3.27: and its per-frame object-pool (effects) buffer
        self.calib.clear();          // 0.3.29: and its self-describing effect-node calibration blob
        self.frame_addr = frame_addr;
        self.synthetic = synthetic;
        self.assist = ms.assist;
        self.costume = ms.costume;   // 0.3.28
        self.team_ids = ms.team_ids; // 0.3.48
        self.local_pn = ms.local_pn;
        self.set_start = ms.set_start;
        self.last_update = None;
        self.seat_map = ms.seat_map;
        self.rollbacks = 0;   // baseline captured by the caller as `rb0`; the END read subtracts it
        self.build_id = ms.build_id.clone();
        self.stage_id = ms.stage_id;
        self.start_sim_frame = ms.start_sim_frame;
        self.battle_blk = ms.battle_blk;
        self.tie_ggpo_frame = ms.tie_ggpo_frame;
        // ⚠ self.anchor and self.select_in are deliberately NOT cleared here — both were captured at
        //   the character select that PRECEDED this match and belong to it. The next char-select
        //   visit clears and refills them.
    }
    /// Record one frame's harvest (row + draw list + palette rows + world nodes + calibration prefixes) — the 0.3.48
    /// capture loop's lock-held insertion block, verbatim. LAST-WRITE-WINS: a rollback re-visits an earlier frame →
    /// overwrites it with the confirmed state. Cap at GS_CAP unique frames (still allow updates to existing keys).
    pub fn record_frame(&mut self, frame: u32, row: GsRow, objs: Vec<ObjNode>, prow: Option<([[u8; 32]; 48], [u8; 48])>,
                        mut araw: Vec<ANodeRaw>, calib_nodes: Vec<Vec<u8>>) {
        if self.frames.len() < GS_CAP || self.frames.contains_key(&frame) {
            self.frames.insert(frame, row);
            if !objs.is_empty() && (self.objs.len() < GS_CAP || self.objs.contains_key(&frame)) {
                self.objs.insert(frame, objs);   // 0.3.27: per-frame effects, keyed like frames
            }
            if let Some((rows, flags)) = prow {
                if self.palrows.len() < GS_CAP { self.palrows.push((frame, rows, flags)); }
            }
            if !araw.is_empty() && (self.anodes.len() < GS_CAP || self.anodes.contains_key(&frame)) {
                // intern each object's bytes by content hash; the node keeps the index
                let mut list: Vec<ANode> = Vec::with_capacity(araw.len());
                for r in araw.drain(..) {
                    let oi = if r.obj.is_empty() { 0xFFFF } else {
                        let hsh = fnv1a64(&r.obj);
                        match self.aobj_idx.get(&hsh) {
                            Some(&i) => i,
                            None if self.aobjs.len() < 0xFFFE => { self.aobjs.push(r.obj); let i = (self.aobjs.len() - 1) as u16; self.aobj_idx.insert(hsh, i); i }
                            None => 0xFFFF,
                        }
                    };
                    list.push(ANode { list: r.list, flags: r.flags, matrix: r.matrix, colour: r.colour, model: r.model, obj: oi, alpha: r.alpha });
                }
                self.anodes.insert(frame, list);
            }
            if !calib_nodes.is_empty() && self.calib.len() < CALIB_MAX_FRAMES {
                self.calib.push((frame, calib_nodes));   // 0.3.29: first N effect-frames, raw prefixes
            }
            self.last_update = Some(std::time::Instant::now());
        }
    }

    pub fn to_snapshot(&self) -> GsSnapshot {
        GsSnapshot { frames: self.frames.values().cloned().collect(), frame_addr: self.frame_addr, synthetic: self.synthetic, assist: self.assist, costume: self.costume, local_pn: self.local_pn, set_start: self.set_start,
                          seat_map: self.seat_map, rollbacks: self.rollbacks, build_id: self.build_id.clone(), stage_id: self.stage_id,
                          anchor: self.anchor.clone(), anchor_blk: self.anchor_blk, anchor_arena: self.anchor_arena, anchor_frame: self.anchor_frame,
                          anchor_hash: self.anchor_hash, select_in: self.select_in.clone(),
                          battle_anchor: self.battle_anchor.clone(), battle_anchor_blk: self.battle_anchor_blk, battle_anchor_frame: self.battle_anchor_frame, battle_anchor_ctx: self.battle_anchor_ctx, battle_anchor_dcram: self.battle_anchor_dcram,
                          start_sim_frame: self.start_sim_frame, confirmed_in: self.confirmed_in.clone(), objs: self.objs.clone(),
                          calib: self.calib.clone(), battle_blk: self.battle_blk, tie_ggpo_frame: self.tie_ggpo_frame,
                          anodes: self.anodes.clone(), aobjs: self.aobjs.clone(), palrows: self.palrows.clone() }
    }
}
