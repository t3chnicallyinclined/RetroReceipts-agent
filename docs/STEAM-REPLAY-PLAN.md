> ⚠⚠ **PARTLY SUPERSEDED — read `STEAM-GGPO-DETERMINISM.md` §6 first.** Measured live 2026-08-26:
> the draw list is at `blk+0x2f4d0` (counts u8 at `blk+0x324d0`), **not** `blk+0x300D0`; and
> `KCODE_OFF` is GGPO **seat 0's** input word (`G+0x218`), not "the local pad". The §0 object-base
> (0x16C) fix and the CPS quad-scale findings on this page remain valid.

# Steam MvC2 → 2D sprite canvas — ONE ORDERED EXECUTION PLAN

**Synthesized 2026-08-25 from 4 expert reports + the authoritative docs. Where experts disagree, the call is stated with the reason. Execute top to bottom.**

Shorthand used throughout:
```
EXE  = 0x140000000            (DYNAMIC_BASE off — fixed VA, every launch, every machine)
blk  = *(u64*)(EXE+0xAC6EF0)  (match block; 0x33B18 bytes; RELOCATES EVERY MATCH)
arr  = blk + 0x3F24           (fighter array, stride 0x738, 6 slots, EVEN=P1 / ODD=P2)
fc   = blk + 0x3CC8           (= arr − 0x25C, u32, +1/frame @60Hz)
H(i) = blk + 0x44F0 + i*0x738 (= slot(i)+0x5CC — the OBJECT HANDLE, see §1)
SP   = C:/Users/trist/AppData/Local/Temp/claude/c--Users-trist-projects/87af92a3-d210-44d2-94eb-ea46c3fdb39e/scratchpad
```

---

## 1. VERDICT ON THE MEMORY-CLUSTER HYPOTHESIS

**Tris is RIGHT about the assets and WRONG about the code/globals. The hypothesis is CONFIRMED-IN-HALF, and the half that is confirmed is the half that matters for rendering.**

### 1a. What is TRUE (CONFIRMED, live, PID 40912)

A **guest-memory window exists inside the Steam process** where DC/NAOMI absolute addresses map by a *single constant offset*:

```
host = (dc_addr & 0x1FFFFFFF) + D          D = 0x05BE1000 this launch
DC 0x8C000000 → host 0x11BE1000 ; window = 32 MB (NAOMI map, not the DC 16 MB map)
```

Evidence (senior-re-generalist, `SP/dat_cluster.py`, `SP/ram_window_map.py`):
- **11 of 16 pointer fields in the Steam fighter struct step by exactly `0x150000` across the six slots, in the DC DAT load order A,C,E,B,D,F (= slots 0,2,4,1,3,5).** `pl_mem.asm:40-52`'s fixed DAT slot map survived the port intact. Solving each against its DC base yields the **identical D for all six slots, spread = 0x0**.
- Independent cross-check on an unrelated DC constant: an exact 64 KB-granular LIVE run at DC `0x8CE60000..0x8CE80000` = `work.asm:36-39` Texture_Decompress_Buffer, terminating exactly where DM00 Poly begins.
- **ROM asset data is BYTE-IDENTICAL**: live working DAT vs. the pristine source blob match for `0x105722` bytes; first difference is at `Dat_Pal + 2` — i.e. the only runtime mutation in the first 1.3 MB is our own skin painter.
- Corroborated structurally by the sprite-render expert from the *disk* side: `nativeDX11x64/arc/pc/game_50.arc` inflates to an `IBIS` container whose payload at `+0x40` is a **SEGA `AFS` archive, 890 entries, 2048-byte GD-ROM sector alignment**. The Steam build literally ships the original Dreamcast asset archive.

**LAW 3 (add to STEAM-CODE-MAP):** inside a pointer-dense DC run, pointers widen 4→8 bytes so offsets scale ×2:
`steam_off = 0x3c + 2*(dc_off − 0x15c)`.
Two experts derived the full DAT cluster independently and got the *same table*, and it retro-predicts the two already-proven offsets (`DatPal +0x4c` ← DC `0x164`, `cell_ptr +0x2c` ← DC `0x154`). This is the strongest single result of the whole sweep: **hitbox tables, attack data, animation tables and every GFX pack are now addressable arithmetically.**

### 1b. What is FALSE (CONFIRMED negative — do not chase)

- **DC `0x8C000000..0x8C420000` (4.12 MB) reads uniformly `0xCD`** = MSVC clean-land fill = committed, never written. That range holds 1ST_READ.BIN and **every documented DC global**: `player_start 0x8C268340`, `BattleState 0x8C2895F0`, `camera 0x8C26A518`, `RngVal 0x8C16BC2C`, `Charsel_Input 0x8C28C474`, `STG_ID`, SPL jump tables. **They have no Steam address.**
- **Zero SH4 code**: 0 hits for `22 4f e6 2f` and `26 4f f6 6e` across 1703 MB of non-image committed memory. There is no emulator and no SH4 image.
- PowerVR display-list buffers (`0x8CE80000..0x8D000000`) and the char-programming buffers (`0x0CE30000 + k*0x8000`) are `0xCD`. **Clean discriminator: DC buffers that held CODE are dead; DC buffers that held DATA are live.**
- **D is NOT a build constant.** The "globals" holding `0x12001000`/`0x097E0000` in the exe image are x86 `cmp` immediates and packed u16 tables — false positives (`SP/const_table.py`). **Derive D live, never hardcode.**

### 1c. The settle script (run it every launch; it is a two-sided test)

```python
# derive D — prefer +0x8c (FAC_ptr): spread 0x0 across all six slots.
# (+0x7c Dat_FilePointer was ANOMALOUS on slot 5 — do not use it)
DC_DAT = [0x0C420000, 0x0C810000, 0x0C570000, 0x0C960000, 0x0C6C0000, 0x0CAB0000]  # by slot 0..5
D = read_u64(slot(i) + 0x8c) - (DC_DAT[i] + 0x148000)
host = lambda dc: (dc & 0x1FFFFFFF) + D
```
```
PASS  = host(0x8CE60000) reads NON-0xCD  AND  host(0x8C268340) reads 0xCD
```
Both halves are required. One-sided "it read something" is how this hypothesis gets mis-adopted.
Runnable today: `python "$SP/dat_cluster.py" <pid>` (prints `CONSTANT D`), `python "$SP/delta_test.py" <pid> <D>` (the 12-landmark 0xCD block), `python "$SP/ram_window_map.py" <pid> <D>`.

**Consequence for this plan:** the DC RE is a *decoder ring for asset bytes and intra-cluster layout*, not an address book. Every Steam **address** still has to be anchored empirically (LAW 1 / LAW 2). Everything a DC pointer *reaches* is free.

---

## 2. THE CRITICAL PATH

### Ordering call — the two things the prompt asks about

| Question | Verdict | Why |
|---|---|---|
| **sprite_id ↔ atlas numbering** | ✅ **ALREADY ANSWERED — NOT a work item.** Demote to a 60-second offline regression. | Three independent confirmations: (a) Steam ships the DC `AFS` archive verbatim, so GFX1/GFX2/cell/palette bytes are the same bytes the atlases were ripped from; (b) live capture: 100% of observed sids on slots 0/2/3 are real DC cells for that char, with a **33-cell exact consecutive sub-anim chain** for Magneto; (c) memory `rr-tape-v2-spec` already recorded the gate as PASSED (Magneto 184/184, Storm 15/15, Sentinel 55/55). Handoff NEXT STEP #1 is **closed**. |
| **draw gate** | 🔴 **BLOCKING #1. It is the only reason the current pipeline is wrong.** | The converter's slot picker selects the pair the engine actually rendered in **0 of 727 checkable frames** — it picks slot 4 (Colossus, *pinned*, zero position changes in 1801 frames) and slot 5 (*uninitialised*, reads (0,0)). Correct pair is (2,3). And it still produces a smooth, full-length, plausible-looking replay. That is the false-win shape. |

**One more thing outranks both:** the recorder must be rewritten *first*, because every live test below needs a bigger, coherent read than the current one can give — and the current one only avoids tearing **by accident** (§4).

---

### S0 — PRE-FLIGHT (offline, no game, ~5 min)

**S0.1 Disk.** Every expert independently hit `OSError errno 28` / `IOException: not enough space`.
```
df -h /c
```
**Status right now: 16 GB free — blocker CLEARED** (it was 0 bytes during the expert sweep; that is what killed `hl3.log`'s Ghidra run and truncated three probe scripts). **Gate: ≥ 5 GB before any capture, ≥ 8 GB before any Ghidra headless run.** If it regresses, the largest reclaimables are `SP/cam.bin` (134 MB) and the stale 1.55 GB `side_log.jsonl` in the 2026-08-21 session scratchpad `de59dfa0-…`.

**S0.2 Make the tooling permanent.** Everything below lives in a *reclaimable session scratchpad*. A gate that can evaporate is not a gate.
```bash
mkdir -p C:/Users/trist/projects/maplecast-flycast/tools/verify-harness
cp "$SP"/vh_{gate,audit,slots,pair,screen,err,anim,atlas,rec,cam}.py \
   C:/Users/trist/projects/maplecast-flycast/tools/verify-harness/
mkdir -p C:/Users/trist/projects/maplecast-flycast/tools/steam-recorder
cp "$SP"/{mvcmem.py,record_v3.py,v4_to_gstarec.py,gsta_serve.py,phase_burst.py,tear_test.py,tick_cost.py,drawlist3.py,probe4.py,probe5.py,gfx2.py,sid_spotcheck.py,check_sid_atlas.py} \
   C:/Users/trist/projects/maplecast-flycast/tools/steam-recorder/
```

**S0.3 Re-run the numbering regression (offline, on `real.v3`, ~60 s).**
```bash
python C:/Users/trist/projects/maplecast-flycast/tools/verify-harness/vh_anim.py \
       "$SP/real.v3" C:/Users/trist/projects/mvc2-skin-studio/web/anim
```
**PASS = ≥99% of observed sids are real DC cells for that char_id.** Baseline measured: slots 0/2/3 = 100%, slot 4 = 98.2% (5 runs outside the table — look once, do not block on it).
⚠ **`vh_atlas.py` coverage is NOT a mapping test and must never be cited as one.** `atlas/chars/PL*.json` are dense `0..N-1` (PL2A = 1174 ids 0..1173, verified this session), so *any* in-range id passes; it caught 0 missing pairs even for the wrong-character pipeline. It only detects out-of-range ids.

**S0.4 Fix two known-broken tools before they mislead anyone.**
- `SP/sid_spotcheck.py:148` has `ffff = (c[6]==0xFF and c[7]==0xFF)` — **this gate will falsely FAIL on Steam.** Two experts independently measured Steam anim cells reading `00 00` at `+6/+7` (Magneto: `00 00 0a 00 74 00 00 00 …`). Memory `rr-tape-v2-spec:42` calls `0xFF,0xFF` "the strongest discriminator" — **that is wrong for Steam.** Delete the check.
- `SP/analyze_gstarec.py` reads slots at `p[25+i*57]`; the writer places them at `p[29+i*57]` (`'GSTA'` magic occupies `p[0:4]`; `sprite-client.mjs` uses `B=4` then `+25`). **Every (act,cid,hp) triple it ever printed was misaligned garbage.** Fix to `29`.

---

### S1 — RECORDER v4: ONE COHERENT WHOLE-BLOCK READ PER FRAME (BLOCKING #0)

Write `tools/steam-recorder/record_v4.py`, magic `V4BLOCK01`. This is the recipe in §4; the short version:

- Poll `fc` at ~1 kHz with a **4-byte** RPM (2.5 µs).
- On change: **busy-wait to `t_edge + 1.0 ms`**, then **ONE** `ReadProcessMemory` of the **entire match block** `[blk, blk + 0x33B18)` = 212,248 bytes.
- Take the frame number from **buffer offset `0x3CC8`** — never from a separate call.
- Emit exactly one row per distinct fc, **never drop a row**, emit a `GAP` marker if fc jumps.

Why the *whole block* and not the 11,628-byte slot span: the draw list (`+0x300D0`), the camera (`+0x6914`), the object pool (`+0x6DD8`) and battle-globals (`+0x32500`) all live outside the slot span, and reading them in a second call **re-creates flycast's S-vs-S−1 pairing bug** — the exact defect that shipped garbled foreign tiles for a whole session (`docs/HANDOFF-CHARFLIP-2026-07-09.md:80-82,127`). A single RPM is measured at 3.4 µs for 11 KB vs 2.5 µs for 4 bytes: **the syscall is the cost, the size is free.** One buffer, one fc, structurally impossible to mis-pair.

**Gate S1:** instrument the recorder to re-read the block at `edge+3 ms` and byte-compare the slot span on every frame → **0 differences over 3600 frames**. Non-zero ⇒ raise the settle delay to 2 ms and re-run `tear_test.py`.

**Gate S1b (closes the one INFERRED hole):** with Tris **actively moving** (walk/dash/jump continuously — *not* parked):
```
python tools/steam-recorder/phase_burst.py 20
```
**PASS = the `kinematics (pos/vel/hp)` line prints n≈1200 with p99 < 0.5 ms, `extra bursts (>0.5ms gap) per frame` mean 0.00, and 0 frames still being written >1.0 ms after the tick.**
This is the measurement that licenses "no STARTRENDER latch needed on Steam". The previous run measured it only for the ~57 offsets that moved; pos/vel/hp were **never written** because both point chars were parked at ±1386.7 with the timer frozen at 99. FAIL ⇒ a genuine second write pass exists and Steam *does* need a latch equivalent.

---

### S2 — CONFIRM THE DRAW LIST + THE CAMERA IDENTITY, LIVE (BLOCKING #1) ⏱ needs Tris in a real fight

This is the single highest-value 90 seconds in the plan. It answers *who to draw*, *in what order*, **and** *where* — all from one read.

**Run:** `python tools/steam-recorder/drawlist3.py` frame-synced inside the S1 recorder loop, during a real 3v3 with both point characters visibly on screen, including ≥2 tag-ins, ≥1 assist call, ≥1 super, ≥1 KO, ≥1 corner-to-corner walk.

**What to read, per frame, out of the one block buffer:**
```
counts[L]        = buf[0x330D0 + L]                        (L = 0..15, u8)      ← INFERRED
handle(L,i)      = u64 @ buf[0x300D0 + L*0x300 + i*8]      (96 entries/layer)   ← CONFIRMED
handle → slot    : (h - blk - 0x44F0) % 0x738 == 0 , quotient in 0..5
handle → pool k  : (h - blk - 0x6DD8) % 0x280 == 0 , k in 0..255
eyeX/eyeY/eyeZ   = f32 @ buf[0x6914 / 0x6918 / 0x691C]
freshness test   : |sx - (320 + wx - eyeX)| < 0.5   with sx = f32 @ slot+0x6F0
```

**PASS:** every frame, the union of the buckets contains **exactly** the characters visibly on screen (both point chars, plus a called assist while it is on screen, and **not** the benched partners); the freshness identity closes to <0.5 px for every slot that appears in a bucket, on every frame, while the camera pans and while the fighters separate past the 400 px snap threshold; `eyeZ` stays 812.3571.

**⚠ OPEN CONFLICT C3 — the count array collides with battle-globals. Resolve here.**
The 16-layer inference puts the table at `0x300D0 .. 0x330D0`, but **battle-globals is CONFIRMED at `blk+0x32500`** (timer `+0x40`, meter `+0x5A/+0x7C` read live) — which lands inside "layer 12"'s bucket. Both cannot be per-frame draw buckets. Live evidence only ever showed buckets at layers **0, 1, 2 and 4**. Resolution procedure:
1. Read `buf[0x330D0:0x330E0]` during the fight. If it is 16 small values (0..0x60) that change every frame → counts confirmed, and the effective layer count must be < 13.
2. If not: scan `blk+0x2D000..0x33B18` for a 16-byte run whose bytes are all ≤0x60 and change every frame.
3. **Either way, do not depend on it.** Ship the belt-and-braces gate:
```
DRAWN(i)  ==  H(i) appears in ANY bucket   AND   freshness identity holds this frame
```
Draw-list membership gives gate + layer + sort order; the freshness identity kills any stale handle left over from a previous frame. This is immune to C3 entirely.

**⚠ OPEN CONFLICT C4 — the camera address sits inside slot 5's span.** `blk+0x6914` = `slot5 + 0x5D8`, and slot 5 was a **real fighter** (Cap America, cid 0x0B) in the capture that produced the camera numbers. Yet the values are unmistakable (`eyeZ 812.3571` ≈ DC's recomputed 812.29; `eyeX = wx − sx + 320` **bit-identical** on an independent object). **Do not gate the plan on resolving this.** Two escapes, in order:
- **Primary (camera-free):** compute `(sx − wx)` for every slot; the drawn slots form a tight cluster (measured: ≤1 px agreement across 727 frames, correctly selecting (2,3)). That *is* the freshness test whenever ≥2 fighters are drawn. `vh_gate.py::camera_cluster` already implements it.
- **Secondary:** the stored eye triple, re-verified each match with the `wx − sx + 320` identity, needed only for the 1-drawn-fighter case.
- Settle C4 separately: log whether `H(5)` ever appears in the draw list or in the six-handle table at `blk+0x32500..0x32528`. If it never does, the fighter set is `{blk+0x37EC, slots 0..4}` and `+0x6914` is genuinely the camera struct.

---

### S3 — CONVERTER v5: DRAW-LIST GATE + THE ENGINE'S OWN SCREEN COORDS

Replace `v4_to_gstarec.py` with `steam_to_gsta.py`. Three changes, in order of impact:

**S3.1 — RETRACT the handoff's "`+0x6f0/+0x6f4` FAILED" and use them.**
> **Two independent experts overturn the handoff on live measurement. The handoff loses.** The disqualifying observation ("only ONE fighter inside a 640×480 box") is refuted by the capture itself: **533 frames have 2 slots in-box, 26 have 3, 1072 have 1, 170 have 0** — the single-slot frames are exactly the frames where the other side is genuinely parked or tagged out. The symptom was **staleness, not a wrong field**: DC `bank03 loc_8c03093c` (lines 1281-1291: `mov.w #0x12c,r0; mov.b @(r0,r14),r3; tst r3,r3; … bra loc_8c030a9c`) **early-returns before writing screen_x/y when the gate is 0**, so an undrawn slot keeps a stale screen position *forever*. Positive proof they are right: slot 2's `sy+wy` has a mode at **433.63**, matching the disasm-exact DC constant **433.394** (`240 + (eyeY+98.394) − world_y` at the eyeY clamp floor of 95); and `eyeX = wx − sx + 320` reproduces the stored eyeX bit-identically.
>
> **Rule: `+0x6f0/+0x6f4` are VALID AS A VALUE, INVALID AS A GATE.** (A non-rendered slot does not read zero — slot 0 held the single constant `sx−wx = 1234.61` for all 1801 frames.)

So: **write the engine's own `+0x6f0/+0x6f4` straight to wire `+16/+20`.** No camera port on the critical path. The bank02 camera algorithm stays in the repo as a *fallback and cross-check only* — because the naïve version currently in `v4_to_gstarec.py:49,63` ("camera = midpoint", "`screen_y = 434 − world_y`") mis-places fighters by a **median 147.1 px in X and 82.2 px in Y** (p95 254/279, max 290/475) on a 640×480 canvas, and hard-pins a Y the engine actually moves through a 247 px range.

**S3.2 — Replace the slot picker with the draw list.** Delete every coordinate-derived visibility test. Ban list: `abs(wx) < 1300`, the ±1386.7 park test, any 640×480 box test, and **`+0x004` as a gate** — measured act==1 in **1711/1801 frames for a fighter pinned at the park spot**, versus 41/1801 for the only moving P1-side slot. It is anti-correlated with being the point character. Park/box tests survive only as **tripwires** (and even then: 1 of 1454 rendered samples legitimately stands within 5 px of the park constant, in a corner).

**S3.3 — Emit EVERY frame.** Delete the `if not live: continue` drop path (`v4_to_gstarec.py:45-46`); emit a row with zero drawn slots instead. Reproduced calibration: `real2.gstarec` 1341/1786 = 75.08% FAIL, `real.gstarec` 1631/1789 = 91.17% FAIL, `real4`/`training_v2` 100% PASS.

**Wire mapping (`maplecast_gamestate.cpp::serialize`, WIRE_SIZE 376 + 4-byte `'GSTA'` magic = 380 on the wire; char block at payload+25+i*57, file offset +29+i*57):**

| wire | field | Steam source |
|---|---|---|
| `+21` (global) | frame_counter u32 | `blk+0x3CC8`, **relative to the first frame** |
| `+0` | active | **draw-list membership**, not `+0x004` |
| `+1` | char_id | `slot+0x554` **read as u8** |
| `+2` | facing | `slot+0x720` |
| `+3/+4` | health / red | `slot+0x40c` / `+0x410` (144 = full) |
| `+7` | palette | `slot+0x006` |
| `+8/+12` | world x/y f32 | `slot+0x61c/+0x620` |
| `+16/+20` | **screen x/y f32** | **`slot+0x6f0/+0x6f4`** (engine's own) |
| `+24/+28` | vel f32 | `slot+0x644/+0x648` ⚠ walking writes POSITION, vel stays 0 |
| `+32` | sprite_id u16 | `slot+0x1c` — write **RAW**, the client masks `&0x7FFF` |
| `+36` | anim_timer | `slot+0x1a` |
| `+38/+42` | scaleX/scaleY f32 | `slot+0x6fc` = 1.6667, `slot+0x700` = 2.1428 — **anisotropic, never uniform** |
| `+49` | draw_layer | the bucket index `L` from the draw list (`0xFF` = not drawn) |

**Sentinel/mask rule (settles a contradiction):** across all 59 anim JSONs the **only** no-draw sentinel raw value is `0xFFFF` (186 occurrences); raw `0x8000` appears 171× and masks to **sid 0, which is a legitimate body pose**. `mvc2-skin-studio`'s "Colossus 61/62, the miss = sid 0" was a miss against the *cell oracle*, not the atlas. **Body skip rule: `if ((sid & 0x7FFF) === 0x7FFF) skip`. Never skip sid 0 on the body path.** (`sprite-client.mjs`'s `o.sid === 0` skip applies to satellite objects only.)

---

### S4 — RUN THE GATE, THEN LOOK AT PIXELS

```bash
python C:/Users/trist/projects/maplecast-flycast/tools/verify-harness/vh_gate.py \
  --v3 baseline_2p.v4 --rec baseline_2p.gstarec \
  --atlas C:/Users/trist/projects/maplecast-flycast/atlas/chars \
  --anim  C:/Users/trist/projects/mvc2-skin-studio/web/anim
```
Exit 0 = signed off. Full gate definitions in §5. **Current baseline on `real.v3` is FAIL** (I1 0/727, I2 1761/3602, P1 median 147.1/82.2 px) — that is the number to beat.

Then the **pixel test** (§5, gate P1′) — the only non-tautological proof, because a converter that emits the engine's own coords will score 0.0 px against the engine's own coords by construction.

---

### S5 — PLAY IT BACK (no new rendering work required)

**Do NOT bake anything.** The whole-sprite atlases already exist and are complete: **61 characters** in `C:/Users/trist/projects/maplecast-flycast/atlas/chars/PLxx.json`, each dense `0..N-1` (PL2C 1101 sprites, PL2A 1174, PL17 681, PL34 392, PL0B 952, PL32 581 — all verified dense this session), every entry `facing: 0`, and `sprite-client.mjs::loadChar` + `buildDrawList` consume exactly that format with `assemblyMode = false`. Atlas name is an identity map: `PL${cid.toString(16).toUpperCase().padStart(2,'0')}`.

> **Contradiction resolved:** the sprite-render expert's "PRE-BAKE per tape from `_asm.json`", the per-part `0x4000` flip ambiguity, and the `buildEmitterDrawList` anchor-floor regression **all belong to the EMITTER path** (`web/test-atlas/chars/PLxx_asm.json`, `assemblyMode = true`). The replay canvas does not use that path. **All three are OFF the critical path.** Record them in the repo as known issues (the flip ambiguity is real — `buildEmitterDrawList` mirrors the rect while `pwa/scripts/build-char-anim.py::composite_cell` mirrors pixels only, and they cannot both be right — but its median blast radius is 0.04% of body pixels and it cannot affect a whole-sprite render).

**One check before playback:** the prod viewer at `play.nobd.net/replay-canvas/replay.html` is deployed-only (no source in this repo). Confirm it sets `charBase` to the **whole-sprite** atlas dir and leaves `assemblyMode = false`. If it is on the emitter path, switch it — that is a one-line change and it makes the three parked issues moot.

Chain (already live): `record_v4.py` → `steam_to_gsta.py` → `gsta_serve.py :8207` → nginx `/replay-gsta-ws` → `replay.html?ws=wss://play.nobd.net/replay-gsta-ws`.
⚠ `gsta_serve.py:102-104` collapses a negative Δfc into a zero-length step (duplicate frame). Add `skip any record whose fc <= last emitted fc` before netplay tapes exist.

---

### S6 — AFTER THE RENDER IS CORRECT (do not do these first)

| | Work | Note |
|---|---|---|
| S6.1 | **Object pool → projectiles + called assists** | 256 nodes, stride `0x280`, handles at `blk+0x6DD8 + k*0x280`; owner backlink at `H+0x28`; world x/y at `H+0x50/+0x54`. The draw list stores the **same handle type** for fighters and pool objects, so one renderer loop consumes both. This is the missing OBJS channel, available with two reads. Remaining unknown: the node's own sprite_id — start the diff at `H+0x124` and `H+0x170`. |
| S6.2 | Confirm `anim_id/anim_group` at `slot+0x34/+0x35` | Retracts the handoff's "group/id are NOT at the mirrored spot": the `−0x128` mirror breaks at DC `0x154` because that 4-byte pointer became 8 bytes, so DC `0x158/0x159` land at `+0x34/+0x35`, and `+0x30..0x33` is the always-zero high dword of `cell_ptr`. Live: Cable `+0x34=0x22/+0x35=0x0D`; Storm `0x02/0x18`. **Not blocking — sprite_id alone is the render key.** |
| S6.3 | Hitboxes + attack data (now free) | `slot+0x5c` pattern table, `+0x64` hitbox data, `+0x6c` attack data, **`+0xf4` = a LIVE cursor into the pattern table**. Decode with the DC format. Biggest single unlock after rendering. |
| S6.4 | Ghidra headless (only after ≥8 GB free) | `C:/g/ghidra_12.1.2_PUBLIC/support/analyzeHeadless.bat C:/Users/trist/ghidra_projects dumpproj -process mvc_dump.bin -noanalysis -scriptPath C:/Users/trist/ghidra_scripts -postScript find_sid_cluster.py`. Hunt (a) a function writing two adjacent f32 at `[reg+0x124]/[reg+0x128]` behind an early-return byte test (= `loc_8c03093c`), (b) a function using `0x300` as a scale with `0x60` as a bound (= `loc_8c04515e`). **The script MUST iterate defined Functions only and require the scalar to be a memory-operand displacement** — `C:/Users/trist/ghidra_projects/probe.txt` is NOISE (ran against `C:/g/mvc.exe`, not the dump; its "0x738/0x6f0/0x40c hits" are byte fragments of large displacements like `LEA ECX,[RAX + -0x738750e3]`; the four functions `MvcRender.java` decompiled are `halt_unimplemented` stubs). |
| S6.5 | Doc corrections (so nobody re-derives this) | See §6 tail. |

---

## 3. OFFSET TABLE

`slot(i) = blk + 0x3F24 + i*0x738`. **Every offset ≥ 0x738 is a next-slot read — subtract 0x738.**

### Per-fighter — CONFIRMED

| Field | Offset | Type | Note / evidence |
|---|---|---|---|
| active (logical) | `+0x004` | u8 | ⛔ **BANNED as a visibility gate** — reads 1 for parked benched chars |
| **pal bank** | `+0x006` | u16 | `16*(char_pair+1) + 8*side`; live `0x10,0x18,0x20,0x28,0x30,0x38` |
| **side** | `+0x008` | u8 | 0 = P1/even, 1 = P2/odd |
| anim_timer | `+0x01a` | u8 | sawtooth, reloads from the cell's Duration |
| **sprite_id** | `+0x01c` | u16 | mask `&0x7FFF`; 90/90 = the dereferenced cell's own Sprite field |
| cell_ptr | `+0x02c` | u64 | +0x14/cell; 20-byte DC cell format intact (Dur@+2, Sprite u16@+4) |
| Dat_GFX1 | `+0x03c` | u64 | DAT+0x20 for all six |
| Dat_GFX2 | `+0x044` | u64 | per-character |
| **DatPal** | `+0x04c` | u64 | already used by the skin painter |
| animations | `+0x054` | u64 | DAT+0x130000 |
| hitbox_pattern_table | `+0x05c` | u64 | DAT+0x13C000 |
| hitbox_data | `+0x064` | u64 | DAT+0x13D000 |
| attack_data | `+0x06c` | u64 | DAT+0x13E000 |
| Sprite_Extras | `+0x074` | u64 | per-character |
| Dat_FilePointer | `+0x07c` | u64 | ⚠ anomalous on slot 5 |
| (DC 0x180) | `+0x084` | u64 | |
| **FAC_ptr** | `+0x08c` | u64 | DAT+0x148000 — **use this one to derive D** (spread 0x0) |
| hitbox cursor (live) | `+0x0f4` | u64 | moves per frame inside the pattern table |
| combo_dealt | `+0x1ca` | u8 | (`0x902` was next-slot) |
| hitstun | `+0x1d1` | u8 | 0xFF = real hit, 0 = neutral/block |
| health | `+0x40c` | u32 | 144 = full (`0xb44` was next-slot) |
| red health | `+0x410` | u32 | |
| static slot descriptor | `+0x414` | u64 | → `EXE+0x2eed3b0 + i*0xF0` |
| assist type | `+0x4e9` | u8 | |
| input | `+0x4fc` | u16 | R=0x400 L=0x800 D=0x1000 U=0x2000 LP=0x200 LK=0x40 HP=0x100 HK=0x20 A1=0x80 A2=0x10 |
| **char_id** | `+0x554` | **u8** | ⚠ a u16 read returns `cid \| 0x100` (300/279/298 = garbage). Fix `sync.rs`. |
| **object handle H** | `+0x5cc` | — | `H = slot+0x5CC`. **The engine never stores a slot base.** A process-wide scan for slot bases returned **0 hits**; the same scan for H returned battle-globals, EnemyPointers and the draw list. `world_x` is `H+0x50` for fighters *and* pool nodes. |
| EnemyPointer | `+0x5dc` | u64 | = `H+0x10`, 0 when none |
| world x / y | `+0x61c` / `+0x620` | f32 | = `H+0x50/+0x54`. **Already in screen px** (DC raw × 5/3): Δ-histogram is dominated by exact multiples of 5/3 |
| vel x / y | `+0x644` / `+0x648` | f32 | ⚠ walking writes POSITION; vel stays 0 |
| **screen x / y** | `+0x6f0` / `+0x6f4` | f32 | = `H+0x124/+0x128`, DC `+0xE0/+0xE4`. **VALID AS VALUE, INVALID AS GATE** |
| projected depth | `+0x6f8` | f32 | 106.236 for Magneto |
| **scaleX / scaleY** | `+0x6fc` / `+0x700` | f32 | **1.6667 (5/3) / 2.1428 (15/7) — anisotropic** |
| facing | `+0x720` | u8 | = `H+0x154`, the DC `+0x110` analogue under the uniform `+0x44` H-delta |

### Per-fighter — TO-HUNT (all optional; the draw list supersedes them)

| Field | Signature | Verification |
|---|---|---|
| draw-gate byte | predicted `slot+0x730..0x737` (the `H+0x44` delta computes to `slot+0x73C`, four bytes past the stride, so the delta must break in DC `0x110..0x12C`) | ≥600 fight frames; `score(off) = mean((slot[off]!=0) == drawn)`; **PASS = exactly one offset scores 1.000 across all 6 slots and all frames, including tag-in/tag-out and KO.** No hit ⇒ the port dropped the per-object gate and the draw list is the only gate. |
| draw layer | candidate `slot+0x618` (= `H+0x4C`, one dword below world_x, matching DC layer `+0x24` vs x `+0x34`). Live: 1 for slots 0/1/3/5, 2 for slots 2/4 | PASS = the stored value equals the bucket index `L` for every drawn object, every frame |
| sortkey | a byte in `slot+0x604..0x617` (= `H+0x38..H+0x4B`) | PASS = non-decreasing along every bucket on every frame (the DC `+0x31` insertion-sort invariant, `bank04 loc_8c04515e`) |
| pool node sprite_id | start at `H+0x124` / `H+0x170` | PASS = feeding it through `cell = GFX2 + *(u32)(GFX2 + (sid&0x7FFF)*4)` yields count 1..40 with sels in the owner's range, every frame |

### Block-relative

| Field | Offset | Status |
|---|---|---|
| **frame counter** | `blk+0x3CC8` (= `arr−0x25C`) | ✅ CONFIRMED. ⚠ inside the savestate region (see §4 rollback) |
| 7th character object | `blk+0x37EC`, handle `blk+0x3DB8` | ✅ CONFIRMED — one stride *before* slot 0; referenced by battle-globals and three EnemyPointers. **Code that assumes "exactly 6 characters at arr + i*0x738" will miss it.** |
| **draw-list pointer table** | `blk+0x300D0 + L*0x300 + i*8` (= `arr+0x2C1AC`), 96 entries/layer | ✅ CONFIRMED live at layers 0,1,2,4 (delta exactly 0x300). Exact DC analogue of `0x8C287DE0 + L*0x180 + i*4`, pointers widened 4→8 |
| per-layer counts | `blk+0x330D0` (= `arr+0x2F1AC`), 16 bytes | ⚠ **INFERRED and CONFLICTED** — collides with battle-globals at `blk+0x32500`. See S2/C3 |
| **object pool** | `blk+0x6DD8 + k*0x280`, 256 nodes | ✅ CONFIRMED. owner `H+0x28`; links `H+0x08/+0x10/+0x20`; world x/y `H+0x50/+0x54` |
| camera eyeX/Y/Z | `blk+0x6914/+0x6918/+0x691C` (= `arr+0x29F0/F4/F8`) | ⚠ **values CONFIRMED numerically, location CONFLICTED** (falls inside slot 5's span). Duplicate triples at `+0x6920` and `+0x69B4` = the DC target-vs-smoothed pair. Live `(-959.9998, 95.0000, 812.3571)` |
| ground line const | `arr+0x2A74` = 433.4 | ✅ CONFIRMED |
| stage bounds | `arr+0x2A7C` = −1280.0, `arr+0x2A80` = +1280.0 | ✅ CONFIRMED |
| camera clamps | `arr+0x2A84` 1238.4, `arr+0x2A8C` 193.4, `arr+0x2A78` −46.6 | ✅ CONFIRMED |
| **battle-globals** | `blk+0x32500` (= `arr+0x2E5DC`) | ✅ base+0x00..0x28 = **six character HANDLES**, not scalars (this is the concrete explanation of LAW 1's "base+0 is a POINTER"). timer `+0x40`, meter `+0x5A/+0x7C`, win_result `+0x3E` CONFIRMED; in_match `+0x34`, round `+0x3B` SUSPECT |
| block base / size | `game_state+0x1b0` / `+0x1b8` = `0x33B18` | ✅ |

### Projection (needed only for the fallback path and the freshness test)

```
screen_x = 320 + (world_x − eyeX)
screen_y = 240 + ((eyeY + 98.394) − world_y)      eyeY clamped [95, 900] → ground 433.394
zoom ≡ 1.0 ; world units ARE screen px ; NO X rescale between world and screen
camera X: ±200 dead zone, SNAP to midpoint when separation > 400, clamp ±(bound∓320), eye smoothing /8
camera Y: follows the highest head above 350 else 0, smoothing /4
```
The two independently-derived ground constants (Steam live 434, DC disasm 433.394) agree to 0.6 px — that is why the DC camera transfers verbatim.

---

## 4. FRAME-TO-FRAME MODEL (correct by construction)

**Live-measured on the running process, 1380 frames, 43–57 kHz sampling.**

**THE CENTRAL FACT:** the entire per-frame mutation of the fighter array is **ONE contiguous burst** that begins at the frame-counter increment and is finished within **0.13 ms**. Last write after the fc tick: p50 0.032–0.044 ms, p90 0.076–0.079, p99 0.102–0.120, **max 0.206 ms**. Extra bursts (>0.5 ms gap) per frame: mean 0.00, max 0. Frames still being written >1.0 ms after the tick: **0/1380**. The array is then **frozen for the remaining ~16.5 ms**.

**THE TRAP:** the frame counter is written **FIRST, at the HEAD of the burst** — `arr−0x25c` changes at phase 0.000 ms while `sid/anim_timer/cell_ptr` change at p50 ≈0.030–0.040 ms and a third cluster lands ≈0.078 ms. **The counter means "state is ABOUT TO CHANGE", not "state is ready"** — the exact opposite of what a recorder naturally assumes. Direct A/B: reading the instant fc increments differed from settled truth on **569/600 frames (94.8%)**; reading at edge+0.5 ms differed on **0/600**.

**AND the existing guard is blind to it:** `record_v3.py:34-42` reads fc → reads slots → re-reads fc and discards straddles. That guard **cannot fire during the burst, because fc has already changed.** Its advertised "1801 samples / 0 straddles" is not evidence of coherence — the script is safe only by accident, because `time.sleep(0.002)` decouples edge detection from the read by 1–2 ms. **Tight-polling it for lower latency would silently introduce ~95% torn frames.** Delete the guard rather than keeping it; it advertises a guarantee it cannot provide.

### The recipe

1. **Poll** `u32 @ blk+0x3CC8` at ~1 kHz (4-byte RPM, 2.5 µs). Frame pacing is *not* a metronome from outside — observed tick interval p50 16.646 ms, min 13.509, max 19.443, std 0.912 — so a free-running 60 Hz sampler **will alias**. At >1 kHz you cannot miss a frame (0 skips >1 over 300 ticks).
2. **On change, settle:** busy-wait until `perf_counter() − t_edge ≥ 0.001 s`. Safe window `[edge+0.5 ms, edge+12 ms]`; 1.0 ms recommended (0.206 ms max burst, 13.509 ms min tick).
3. **ONE RPM of the whole block** `[blk, blk+0x33B18)`. **Take the frame number from buffer offset `0x3CC8`.** Never read the counter in a separate call — that is precisely how flycast's S-vs-S−1 pairing bug was born, and a ±1 mispair renders **foreign tiles, not a small error**.
4. **No second stream, ever.** Draw list, camera, pool, battle-globals and HUD all come out of that one buffer. If something must be read outside the block, read it inside the same settled window and then re-read the block's fc and drop the whole row if it advanced.
5. **Frame pairing:** none needed. There is **no Steam analogue of flycast's STARTRENDER latch and none is required** — `sid (+0x1c)`, `anim_timer (+0x1a)` and `cell_ptr (+0x2c)` are written inside the same single burst as everything else (render-key phase p99 0.059–0.091 ms), and no field is written at any later phase. **One settled read per fc IS the latch.** (flycast needed `mc_sidLatch` only because `serverPublish` runs one pipeline stage *after* STARTRENDER.)
6. **Never drop a row.** One row per distinct fc; if `fc − prev_fc > 1`, emit a GAP marker with the missing count and log it. Never filter on "found nobody".
7. **Rollback:** `fc` lives at `blk+0x3CC8`, **inside the 0x33B18 savestate region** that `FUN_140118290` registers — so in netplay it must rewind and the same fc be re-simulated with different state. Invisible offline. Make the recorder **last-write-wins per fc** (buffer rows keyed by fc, flush only once fc has advanced past by ≥ the observed max rollback depth) and dedupe `fc <= last` at serve time.
8. **Playback pacing:** advance virtual time by `Δfc/60`, clamped `[0, 0.1 s]` — **never by recorded arrival times** (replaying arrival jitter replays the stutter). `gsta_serve.py:95-107` already does this. Client-side, velocity is timed on `Δfc × 16.667 ms` accepted only for `Δfc ∈ [1,8]`, EMA-smoothed, extrapolation dt clamped to 33 ms (`sprite-client.mjs:832-845,960-967`).
9. **Hitstop:** on freeze frames the engine holds `sprite_id` and stops advancing `anim_timer`. That must render as a **held pose**, never a dropped or blank frame. `sprite-client.mjs:941-957` already holds the last pose for the same char_id on an unknown sid. Generalized law from flycast: **on freeze frames, "field unchanged" does not mean "field valid."**
10. **Permanent self-test:** 1 frame in 60, do the settled read twice (edge+1 ms and edge+3 ms) and byte-compare the slot span; expose a violation counter. A slower machine must not silently regress the settle delay.
11. **⚠ `fc` ticks while the fight is NOT simulating.** Live right now: `game_state+0x8 = 5`, `in_match = 1`, timer frozen at 99, both point chars parked — and fc advances exactly 60/s while animation cells advance. **"The pointer resolves and the counter advances" is NOT proof you are in a fight.** Gate the *tape* (not the emission) on `scene==5` + `in_match` + **genuine fighter motion**: mark a row `simulating` only when ≥2 slots are off the ±1386.7 park spot with hp>0. Every dynamic hunt must gate on motion.

---

## 5. VERIFICATION GATES

Nothing goes in front of Tris until `vh_gate.py` exits 0 **and** the pixel test passes. Every line is a number; "looks right" is not a result — the current, 100%-wrong pipeline produces 1801/1801 frames, uniform fc-delta 1, two fighters on a ground line and 0 missing atlas sprites.

### Hard gates (any FAIL = do not ship)

| ID | Check | PASS threshold | Baseline on `real.v3` |
|---|---|---|---|
| **T1** | capture timeline | fc-delta set == {1}, coverage 100% | ✅ 1801/1801 |
| **T2** | wire timeline | one row per game frame, payload 380 B | ✅ on `real4`, ❌ 75.08% on `real2` |
| **D1** | **draw-list agreement** *(new)* | the drawn set == the characters visibly on screen, every frame; total across layers == Σ counts | — |
| **D2** | **freshness identity** *(new)* | `\|sx − (320 + wx − eyeX)\| < 0.5 px` for every slot in the draw list, every frame | — |
| **I1** | slot identity | ≥99% agreement with the engine's own answer | ❌ **0/727** |
| **I2** | bench exclusion | **0** drawn slot-samples parked (±1386.7 ±5) or null (0,0) | ❌ 1761/3602 |
| **P1′** | **pixel overlay** *(new, replaces P1)* | see below | — |
| **P2** | ground line | inter-fighter disagreement p95 ≤ 3 px | ✅ 0.58 px |
| **A1** | atlas range | 0 out-of-range (cid,sid) | ✅ 0/255 — *weak, see below* |
| **A2** | anim identity | ≥99% of sids are real DC cells for that char | ✅ 100% / 98.2% |
| **C1** | **coherence self-test** *(new)* | edge+1 ms vs edge+3 ms byte-identical, 0 diffs over 3600 frames | — |
| **O1** | **continuous dereference oracle** *(new)* | `sprite_id == *(u16*)(cell_ptr+4) & 0x7FFF` on **100%** of samples; `anim_timer` is a sawtooth reloading to the cell's Duration at every `cell_ptr` step of +0x14 | — |

**P1′ — the pixel test (the only non-tautological placement proof).** A converter emitting the engine's own screen coords scores 0.0 px against the engine's own screen coords **by construction**; `vh_gate.py` already carries a tautology guard for exactly this. So: add a screenshot hook to the recorder — on N frame-synced samples, grab the MvC2 window immediately after the settled read and save `shot_<fc>.png` beside the row. Overlay a crosshair at each drawn slot's `(sx, sy)` scaled by `(win_w/640, win_h/480)`.
**PASS = for ≥30 frames spanning ≥3 distinct camera positions (one at the camera Y floor, one mid-jump, one against a stage wall), the crosshair lands on the character's anchor within 4 px in both axes for BOTH fighters, and NO crosshair lands on a benched character.**

**A1 is a weak gate and must never be cited as proof of the numbering** — the atlases are dense `0..N-1`, so any in-range id passes.

### Per-offset acceptance protocol (TSAP) — the rule that stops the next unverified guess

Rank the oracle and use the strongest available: **O1 DEREFERENCE** (value equals something read through a pointer the game maintains — this is what proved `sprite_id` 90/90) > **O2 DC-TABLE** (value is a member of, and sequences with, the DC asset table) > **O3 TWO-STATE DIFF** > **O4 PIXEL**.

O3 requires: ≥90 frame-synced samples per state across ≥3 separate entries into each state; ≥1 A→B transition captured at frame granularity; plus a CONTROL transition that changes everything *except* the semantic under test.
**PASS requires ALL of:** (1) 100% agreement — "mostly works" is a FAIL; (2) the field differs between A and B in every one of the ≥3 entries; (3) the field does **not** change across the control; (4) the field moves within ≤2 frames of the state change; (5) **NEGATIVE CONTROL — run the identical acceptance on `off−0x738`, `off+0x738` and the ±4 neighbours. If a wrong offset also passes, the test has no discriminating power and must be redesigned.** Rule 5 is mandatory and non-negotiable: at stride 0x738, slot *i*'s `+0x902` **is** slot *i+1*'s `+0x1ca`, so any test without a cross-slot check passes on both. This whole failure class (`0xb44`, `0x902`, `0x909`, `0x76c`) is undetectable by any single-slot test.

**TSAP staleness clause** (the specific rule that would have prevented this session's failure): accept every field **separately for three entity classes** — (a) the rendered point char, (b) a benched/parked partner, (c) a never-initialised slot — over ≥300 samples covering ≥2 tag-ins and ≥2 tag-outs.
> A field may be a **VISIBILITY GATE** only if its (b) and (c) values are provably **disjoint** from its (a) values.
> A field may be a **VALUE** for rendered entities even if it is stale off-screen.
> Recorded outcome: `+0x6f0/+0x6f4` **FAIL as a gate** (slot 0 held a frozen `sx−wx = 1234.61` for all 1801 frames) but **PASS as a value**. `+0x004` **FAILS as a gate** (act==1 in 1711/1801 parked frames).

### Freeze a real regression corpus

`real.v3` is contaminated: only 2 of 6 slots ever move, one team never tags, one slot is uninitialised. It cannot exercise tag-ins, assists or KOs. Record `baseline_2p.v4` during a real 3v3 with ≥2 tag-ins per side, ≥1 assist, ≥1 super, ≥1 KO, ≥1 corner-to-corner walk. Keep it in `tools/verify-harness/corpus/` and re-run the gate on **every** converter change.

---

## 6. WHAT NOT TO DO

**Carried forward from the handoff (still binding):**
1. ❌ **Never drop frames in conversion.** 1341 of 1801 emitted made the timeline jump and everything bounce. Emit every frame.
2. ❌ **Never infer visibility from coordinates.** Benched partners land inside the canvas (Cable parked at sx 608); a box test draws benched characters and drops real ones.
3. ❌ **`DAT_142edf628`** did not match its documented shape when walked live (stride 0x18, type@+1, ptr@+0x20) — types scattered, no pointer matched a slot base. Re-verify before use.
4. ❌ **The two 6×u16 tables at `0x142edf250`/`0x142edf25c`** (`FUN_14060b550`) stay static `[0..5]` during play. Init-only. **Not** a draw list. The real draw list is `blk+0x300D0`.
5. ❌ The on-disk exe is **not** packed. Zero xrefs to `EXE+0xac6ef0` are explained by base-register addressing off `game_state`.

**Retracted from the handoff (the evidence changed — do NOT act on these any more):**
6. ✅ **`+0x6f0/+0x6f4` ARE the render screen coords.** Handoff item 1 is wrong; the symptom was the draw gate. Leaving it standing sends the next session hunting for coordinates that were already correct.
7. ✅ **`+0x34/+0x35` ARE anim_id/anim_group.** "Group/id are NOT at the mirrored spot (+0x30/+0x31)" was an artifact of the pointer widening.

**New dead ends and traps (from this sweep):**
8. ❌ **Do NOT chase DC global addresses, SH4 hooks, or a DC-RAM-image savestate path.** `0x8C000000..0x8C420000` is 0xCD-fill and there are 0 SH4 prologues in 1703 MB. `player_start`, `BattleState`, `camera`, `RngVal`, `Charsel_Input` have no Steam address. The standing falsification test: `delta_test.py`'s landmark block must print `cd cd cd…` for all 12.
9. ❌ **Do NOT hunt on the `0xFF,0xFF` cell signature.** Steam cells read `00 00` at `+6/+7`. Memory `rr-tape-v2-spec:42` is wrong for Steam and any hunt keyed on it finds nothing.
10. ❌ **Do NOT hardcode `D = 0x05BE1000`.** The apparent exe-image "globals" are `cmp` immediates. Derive it live from `slot+0x8c`, every launch.
11. ❌ **Do NOT use `C:/Users/trist/ghidra_projects/probe.txt`.** It is noise from the wrong binary; its four decompiled functions are `halt_unimplemented` stubs.
12. ❌ **Do NOT use `slot+0x004` (active) as a visibility gate**, and do not use it as a point-char signal either — it is *anti-correlated* with being the point character.
13. ❌ **Do NOT keep the fc-before/fc-after coherence guard.** It cannot fire during the burst and it hid a 95% tearing bug for a whole session.
14. ❌ **Do NOT read the frame counter in a separate call from the payload.** That re-creates the S-vs-S−1 pairing bug.
15. ❌ **Do NOT add a second capture stream at a different instant** (OBJS, HUD, battle-globals). One buffer, one fc.
16. ❌ **Do NOT bake atlases, rip `game_50.arc`, or re-derive a sid remap.** The numbering is confirmed three ways and 61 complete dense whole-sprite atlases already ship in `maplecast-flycast/atlas/chars/`.
17. ❌ **Do NOT apply a uniform sprite scale.** It is anisotropic 1.6667 / 2.1428, stored per fighter at `slot+0x6fc/+0x700`.
18. ❌ **Do NOT skip `sid == 0` on the body path.** The only no-draw sentinel is raw `0xFFFF`.
19. ❌ **Do NOT assume "exactly 6 characters at `arr + i*0x738`."** A seventh character object sits at `blk+0x37EC`, is referenced by battle-globals and by three EnemyPointers — and it is the object that verified the camera identity.
20. ❌ **Do NOT treat "the pointer resolves and the counter advances" as "we are in a fight."** During the entire expert session all six fighters were frozen at the bench-park constants for 150 consecutive frames with zero screen motion while fc ticked at 60 Hz and sprite_ids advanced.
21. ❌ **Do NOT apply any ±1 display shift** unless/until the tape is composited with video and the pairing constant has been measured against ≥20 unambiguous single-frame events with std < 1 frame.
22. ⏸ **Parked, not dead** (emitter path only — off the critical path): the per-part `0x4000` rect-vs-pixel flip disagreement between `sprite-client.mjs::buildEmitterDrawList` and `pwa/scripts/build-char-anim.py::composite_cell`, and the lost anchor floor in `buildEmitterDrawList` (`_buildAssemblyDrawListLegacy` floors `exx/eyy`, which drove the residual from 0.70 px to 0.00 vs flycast truth; the port path does not). Record both; fix only if the prod viewer turns out to run `assemblyMode = true`.

**Doc corrections to land in the same pass (so the next session does not re-derive or re-break this):**
- `RetroReceipts-agent/docs/STEAM-REPLAY-HANDOFF.md` — retract "WHAT I GOT WRONG" items 1 and the `+0x30/+0x31` line; mark NEXT STEP #1 (numbering) **CLOSED**.
- `RetroReceipts-agent/docs/STEAM-CODE-MAP.md` — add **LAW 3**, the object handle `H = slot+0x5CC` and the H-relative field table, the draw list, the object pool, the camera block, the DC guest window + the live-derivation recipe for `D`, and note `char_id +0x554` is a **u8**.
- `RetroReceipts-agent/docs/STEAM-RE-NOTES.md` — its health `+0xb44` / red `+0xb48` / combo `+0x902` / hitstun `+0x909` are all next-slot reads; point it at CODE-MAP §4.
- memory `rr-tape-v2-spec.md` — line 42: Steam cells read `00 00` at `+6/+7`, not `0xFF,0xFF`; line 21: the `+0x6f0/+0x6f4` retraction is itself retracted.
- `sync.rs` / `reader.rs` — fix `OFF_COMBO_RECV 0x902 → 0x1ca` and `OFF_ACTION 0x76c → 0x034` in the same pass; add sid `+0x1c`, anim_timer `+0x1a`, side `+0x008`, pal_bank `+0x006`, screen `+0x6f0/+0x6f4`, scale `+0x6fc/+0x700` — all inside the existing 0xB50 read window, **zero new RPM**.