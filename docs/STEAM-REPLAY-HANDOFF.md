> ⚠⚠ **PARTLY SUPERSEDED — read `STEAM-GGPO-DETERMINISM.md` §6 first.** Measured live 2026-08-26:
> the draw list is at `blk+0x2f4d0` (counts u8 at `blk+0x324d0`), **not** `blk+0x300D0`; and
> `KCODE_OFF` is GGPO **seat 0's** input word (`G+0x218`), not "the local pad". The §0 object-base
> (0x16C) fix and the CPS quad-scale findings on this page remain valid.

# Steam MvC2 → 2D sprite replay — HANDOFF (2026-08-25)

> ⚠ **SUPERSEDED IN PART by `STEAM-REPLAY-PLAN.md` (expert sweep, 2026-08-25).** Two corrections to
> this doc, both from live measurement:
> 1. **"+0x6f0/+0x6f4 are NOT usable render coords" is WRONG.** They are the engine's own screen
>    coords and are correct AS VALUES — but they are INVALID AS A GATE: DC `loc_8c03093c` early-returns
>    before writing them when the draw gate is 0, so an undrawn slot keeps a **stale** position forever
>    (slot 0 held one constant for all 1801 frames). My "only one fighter in the box" evidence was
>    counting stale slots. Write them straight to the wire; gate on the DRAW LIST instead.
> 2. **`+0x004` must NOT be used as a visibility gate** — it is *anti-correlated* with being the point
>    character (act==1 in 1711/1801 frames for a fighter PARKED at the bench spot, vs 41/1801 for the
>    only moving one). Every coordinate-derived visibility test (park test, 640x480 box test) is banned
>    with it; the engine's draw list at `blk+0x300D0` is the authority.
>

Read with: `RetroReceipts-agent/docs/STEAM-CODE-MAP.md`, `STEAM-RE-NOTES.md` (this doc fills their
TBDs and corrects them), memory `rr-tape-v2-spec`, and
`RetroReceipts-server/docs/STEAM-INFERENCE-GOLDMINE.md` (@e0613b7).

## THE GOAL (Tris's spec, verbatim intent)
Follow the POINT characters' x/y; derive which animation is playing from the animation field;
pre-compute/bake each animation; play the sprites. Nothing more exotic than that.

## ✅ NEW STEAM OFFSETS PROVEN THIS SESSION (fighter struct, stride 0x738)
Array = `*(exe+0xAC6EF0) + 0x3F24`, slot(i) = array + i*0x738, interleaved P1C1,P2C1,P1C2,…

| Field | Offset | How proven |
|---|---|---|
| **sprite_id** | `+0x1c` (u16) | 90/90 frames equal the DEREFERENCED animation cell's own Sprite field. Fills CODE-MAP §4 TBD. Mask `&0x7FFF`. |
| **anim_timer** | `+0x1a` (u8) | sawtooth, reloads from the cell's Duration byte. Same TBD. |
| **cell_ptr** | `+0x2c` (u64) | steps exactly +0x14 per cell; the 20-byte DC cell format is INTACT on Steam (Dur@+2, Sprite u16@+4). |
| **active flag** | `+0x004` (u8) | 1 = logical point char, 0 = bench. ⚠ a BENCHED point still reads 1 while parked. |
| **frame counter** | `array − 0x25c` (u32) | +1 per game frame, verified exactly +60 in 1.00 s. |
| bench park spot | world_x ≈ ±1386.7 | benched partners sit there; the reliable "not fighting" test. |
| ground line | screen_y = 434 | grounded fighters read 434 (emulator ground 433.4). `screen_y = 434 − world_y`. |

Steam anim block = DC anim block − 0x128 (DC 0x140 → Steam 0x18). Group/id bytes are NOT at the
mirrored spot (+0x30/+0x31 stayed 0 through dash/jump/crouch) — **sprite_id alone is the render key**.

## ⚠ CORRECTIONS OWED TO THE EXISTING DOCS
- `STEAM-RE-NOTES.md` still lists health `+0xb44`, red `+0xb48`, combo_recv `+0x902`, hitstun `+0x909`.
  These are NEXT-SLOT reads (subtract 0x738): correct = `+0x40c`, `+0x410`, `+0x1ca`, `+0x1d1` —
  already right in `STEAM-CODE-MAP.md` §4. RE-NOTES was never updated.
- Steam **walking writes POSITION directly; velocity stays 0**. Detect walk from Δworld_x vs the
  per-character walk table (anotak stats), never from vel.

## ❌ WHAT I GOT WRONG (do not repeat)
1. **`+0x6f0`/`+0x6f4` are NOT usable render coords.** They pass a shared-camera test (screen_x−world_x
   identical across fighters, 0.5px spread over 746 frames; varies 402px) BUT live sampling shows only
   ONE slot ever inside a 640×480 box while two fighters are visibly on screen. Do not build on them
   without decompiling their writer.
2. **Don't infer visibility from coordinates.** Benched partners can have screen_x inside the canvas
   (Cable parked at 608), so a box test draws benched characters and drops real ones.
3. **Never drop frames in conversion.** I emitted 1341 of 1801 frames (dropping ones where the filter
   found nobody) — the timeline jumps and everything appears to bounce. Emit EVERY frame.
4. **`DAT_142edf628`** (CODE-MAP "New Steam landmarks") did NOT match its documented shape when walked
   live (stride 0x18, type@+1, ptr@+0x20): types scattered, no pointer matched a slot base. Re-verify.
5. **The two 6×u16 tables at `0x142edf250` / `0x142edf25c`** (built by `FUN_14060b550`, the documented
   "6-slot render setup") stay static `[0..5]` during play — init-only, NOT a per-frame draw list.
6. The on-disk exe is NOT packed (I wrongly claimed it was). Zero xrefs to `exe+0xac6ef0` are explained
   by base-register addressing off `game_state`, not packing.

## WHAT WORKS RIGHT NOW (proven, keep)
- **Frame-synced capture**: poll the frame counter; on tick read all 6 slots; re-read the counter and
  discard torn samples. 1801 samples / 30 s with ZERO discards.
- **Pure-GSTA playback (no emulator)**: recorded wire → file streamer → existing `sprite-client.mjs`.
  Live: `gsta_serve.py` on :8207 behind nginx `/replay-gsta-ws`; viewer
  `play.nobd.net/replay-canvas/replay.html?ws=wss://play.nobd.net/replay-gsta-ws`.
- **Rendering from WORLD coords** with one fighter per side (alive, |world_x|<1300, prefer active flag),
  camera at their midpoint: every frame emitted, both fighters on the ground line at correct
  separation. Closest to the stated spec; continue here.

## SCRIPTS (session scratchpad — recreate from this doc if reclaimed)
`record_v3.py` (frame-synced recorder, V3SYNC02), `v4_to_gstarec.py` (world-coord → GSTA wire),
`gsta_serve.py` + `gsta_record.py` (on prod /opt/maplecast/), `dump_module.py` (runtime image dump),
`pose_hunt.py`/`pose_scan*.py`/`pose_confirm.py` (the hunt method that found sprite_id),
`xref_scan.py` + `find_proj.py` + `disas.py` (capstone) for static work.

## NEXT STEPS (recommended order)
1. **Verify the sprite_id → atlas mapping FIRST.** The baked atlases are keyed by DC sprite_id. Confirm
   Steam's sprite_id indexes the SAME assembly numbering (spot-check Magneto idle 106–108). If it
   differs, every animation renders wrong regardless of positioning.
2. **Get the real draw gate** (DC `+0x12C` analogue) by decompiling the per-fighter render/update
   function. Ghidra project of the RUNTIME DUMP: `C:\Users\trist\ghidra_projects\dumpproj` (raw binary,
   base 0x140000000, addresses match live memory); `FUN_14060b550` decompiles cleanly there. Their own
   project `C:\g\ghidraproj` (mvc.exe) holds the named functions from prior work.
3. **HUD from documented globals**: battle-globals `array+0x2e5dc` — timer `+0x40`, meter `+0x5A`/`+0x7C`,
   combo `+0x80/82`, in_match `+0x34` (CODE-MAP §1; some flagged SUSPECT — re-verify).
4. **Assists/projectiles** need the object pool (goldmine item 4) — separate channel, later.
