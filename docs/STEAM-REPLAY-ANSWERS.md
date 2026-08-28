> ⚠⚠ **PARTLY SUPERSEDED — read `STEAM-GGPO-DETERMINISM.md` §6 first.** Measured live 2026-08-26:
> the draw list is at `blk+0x2f4d0` (counts u8 at `blk+0x324d0`), **not** `blk+0x300D0`; and
> `KCODE_OFF` is GGPO **seat 0's** input word (`G+0x218`), not "the local pad". The §0 object-base
> (0x16C) fix and the CPS quad-scale findings on this page remain valid.

# ANSWER SHEET — Steam MvC2 live-array / position / draw-gate / wire

**Legend:** `[V]` = I re-read the cited lines myself this session. `[R]` = cited by a sub-search, not re-read by me. `[C]` = computed by me (float decode / offset arithmetic).

---

## Q1 — LIVE FIGHTER ARRAY

### ANSWER

**The premise is wrong, and this is the single most important correction on this sheet.** `*(exe+0xAC6EF0)+0x3F24` is not the broken locator — it is the **sole shipping locator**, marked *do NOT change* in the offsets table of every build. The comment at `sync.rs:1352-1361` that says "never the fixed anchor, which on this relocating build points at stale savestate copies (the between-match 'random Ryu' source)" refers to **`anchor_array()` = `flycast_reservation_base + 0x10b33fc8`** — a completely different locator, named two lines above. `[V]`

The production-faithful way to locate the live array is a **scene-gated pointer follow**, in this exact ladder:

1. **Scene gate.** `scene = *(i32*)(*(exe+0xacd3a0) + 0x8)`, guarded `gs > 0x10000`, default `-1`. `fighting = (scene == 5)`. `[R]`
2. **If `fighting` → `pointer_follow_fast`**: read `u64 @ exe+0xac6ef0`; reject `blk == 0`; `arr = blk + 0x3f24`; reject `arr < 0x10000 || arr > 0x7fff_ffff_ffff`; `array_valid(arr)`. **No sleep, no scan.** Rationale in-source: *"scene==5 … already GUARANTEES we're in a live fight, so the game's own match-block pointer necessarily points at the current (rendered) block — never a frozen savestate."* `[V]`
3. **Else, if in a match context but off the fight frame** (KO / win-pose / results / loading) **→ `pointer_follow_array`**: same chain **plus a motion gate** — snapshot `6 × 0x40 B @ slot+0x61c` ++ `6 × 0x40 B @ slot+0x100`, sleep **70 ms**, re-snapshot; empty or byte-identical → `None`. *"between matches the pointer still holds the LAST match's now-FROZEN block."* `[V]`
4. **Else do not look at all.** `ram_base` stays 0 and the UI correctly reports no gamestate. `[R]`

**Candidate fingerprint — use the newer, address-agnostic `array_valid`:** ≥5 of 6 slots have **both** a non-null DatPal `@cl+0x4c` **and** `char_id <= 0x3A @cl+0x554`; **and** no slot reads `(u32 @cl+0x40c) & 0xffff > 144`. `[V]`

**Liveness thresholds (three separate gates, all shipping):**
- pointer-follow motion gate: **70 ms**, byte-identical ⇒ reject `[V]`
- reader-loop frozen detector `game_liveness_hash`: FNV-1a over `slot+0x100 … +0x1C0` (0xC0 B) for all 6 slots; **3 consecutive identical cycles (~1.2 s)** ⇒ surface no game **and zero `ram_base`** so the next cycle re-follows `[R]`
- capture-thread freeze guard: `same_ct > 240` (~0.7 s identical hp+px) stops the tape; `last_new > 2500 ms` = frame counter froze `[R]`

**"No live array right now" is represented as `ram_base == 0` / `game == None`, never as a best-effort read.** Three drop paths: never look outside a fight; re-validate the cached base every cycle and zero it on failure; and `read_fighters` returns `None` (zeroing the base) if **any** slot's health > 144 — the observed stale-copy values were 235 / 11200 / 62807. `[R]`

### CITATIONS
- `mvc-live-skins-quarters/src-tauri/src/sync.rs:79-80` — `MATCH_PTR_OFF 0xac6ef0` / `MATCH_ARR_ADD 0x3f24`, both annotated `⚠ do NOT change` `[V]`
- `…/sync.rs:96` `ARRAY_OFF = 0x10b3_3fc8`; `:1632-1637` the anchor_array doc-comment `[V]`
- `…/sync.rs:1352-1361` — the "fixed anchor" comment in full context `[V]`
- `…/sync.rs:1617-1630` — quarters' `array_valid` (**uses `is_wb`**) `[V]`
- `RetroReceipts-agent/agent/src/reader.rs:1604-1620` — address-agnostic `array_valid` `[V]`
- `…/reader.rs:1773-1799` (`pointer_follow_array` + 70 ms gate), `:1801-1814` (`pointer_follow_fast`) `[V]`
- `…/reader.rs:1687-1689` — *"find_array … was REMOVED in the pointer-only refactor (gs-102). The scene-gated pointer-follow … is now the SOLE array locator"* `[R]`
- `…/reader.rs:2573-2591`, `:3006-3022` (liveness hash + 3-cycle drop), `:1702-1706` (health>144 ⇒ reject base), `:2966-2979` (scene gate) `[R]`

### CONFLICTS
1. **"`*(exe+0xAC6EF0)+0x3F24` is WRONG" (question premise) vs. the shipped code.** The code wins, unambiguously: the pointer chain carries a do-not-change annotation and is the only locator left after gs-102 removed `find_array`. The prose the premise came from names `anchor_array` as its subject. `[V]`
2. **`array_valid` — quarters (`is_wb` band `0x10000000..0x14200000`) vs. reader.rs (non-null + char_id).** **reader.rs wins**: it is the later correction and it fixes a real cross-platform defect — the WB band is a Windows-only assumption that rejects the real array under Proton/Wine where the working buffer roams a lower per-launch range. `[V]`
3. **"random Ryu" root cause.** One source attributes it to stale savestate copies; the shipped fix attributes it to the point fighter's `+0x554` transiently reading 0 (=Ryu) **even on the live copy**, fixed by identifying fighters via DatPal→DAT-bank rank pairing (banks at fixed 0x150000 stride). **The shipped fix wins** — it's code that shipped against the symptom. Both causes are real and independent; do not "fix" one by changing the locator. `[R: mvc-live-skins/src-tauri/src/sync.rs:3584-3591, :3749-3777]`
4. **Frame-counter liveness.** `STEAM-REPLAY-PLAN.md §4-11` records `fc` advancing 60/s with `scene==5`, `in_match==1`, timer frozen, both chars parked ⇒ *"'the pointer resolves and the counter advances' is NOT proof you are in a fight."* **This beats any fc-only liveness test** (it is a measurement against an inference). The shipped composite (scene + array_valid + hash-freeze + `gs_match_load`) is unaffected. `[R]`

### WHAT IT MEANS FOR THE PORT
- **Do not build a new locator.** Copy `reader.rs:1773-1814` verbatim: the two-variant scene-gated pointer follow.
- **Copy `array_valid` from `reader.rs:1613-1620`, not from `sync.rs:1622-1630`.** Deleting `is_wb`/`WB_LO`/`WB_HI` is the single change that makes one code path work on Windows and Proton.
- Keep all three drop paths wired to `ram_base = 0`. Absence of a live array must be `None`, never a stale best-effort.
- Add the `gs_match_load` spawn gate (`sync.rs:1295-1298`) as the "actually simulating" test on top of `scene==5`, per §4-11.

---

## Q2 — POSITION / AXIS

### ANSWER

**`slot+0x61c` = world X (f32), `slot+0x620` = world Y (f32). Units are 640×480 screen pixels at the nominal camera. X origin = stage centre, +X = P2 side. Y origin = the ground, +Y = UP. Ground is world_y = 0.0 exactly.** The mapping is:

```
zoom ≡ 1.0                       ; world units ARE screen px ; NO X rescale
screen_x = 320 + (world_x − eyeX)
screen_y = 240 + ((eyeY + 98.394) − world_y)     eyeY clamped [95, 900] → ground = 433.394
eyeX/eyeY/eyeZ = f32 @ blk+0x6914 / +0x6918 / +0x691C
```

Six independent constants confirm the Steam and DC coordinate systems are **identical**, not scaled:

| constant | DC (disasm) | Steam (live memory) |
|---|---|---|
| stage bounds | `0x44a00000`/`0xc4a00000` = ±1280.0 `[V][C]` | `arr+0x2A7C/0x2A80` = ∓1280.0 ✅CONFIRMED `[V]` |
| camera clamp hi | `0x449acccd` = 1238.4 `[V][C]` | `arr+0x2A84` = 1238.4 ✅ `[V]` |
| camera clamp lo | `0xc23a6668` = −46.6 `[V][C]` | `arr+0x2A78` = −46.6 ✅ `[V]` |
| nominal camZ | `0x444b16de` = 812.3573 `[R]` | live eyeZ = **812.3571** `[V]` |
| ground screen line | 240 + 193.39 = 433.39 (derived from live M2) `[R]` | `arr+0x2A74` = **433.4** ✅CONFIRMED `[V]` |
| spawn \|x\| | `0x43555555` = 213.3333 `[R][C]` | *"points still at ~±213"* `[V]` |

DC additionally proves the Y semantics at the ROM level: the round-init writes spawn `{±213.3333, 0.0, …}` into `char+0x34/+0x38/+0x3C` and latches `char+0x41C = char+0x38`; the air integrator does `y_pos += y_vel; y_vel += gravity;` then `if (y_pos <= char[0x41C]) { y_pos = char[0x41C]; stance=0; zero vels }`. Height above ground = `y_pos − 0x41C`, and 0x41C is 0.0. `[R]`

**Your two anomalous readings are both slot-attribution / staleness, not unit problems:**

- **`+0x6f0/+0x6f4 = (0,0)` on a visible character** ⇒ you were reading a slot that has **never been drawn** since the block was allocated. `STEAM-REPLAY-PLAN.md:73` records exactly this: the converter's slot picker chose *"slot 4 (Colossus, pinned, zero position changes in 1801 frames) and slot 5 (uninitialised, reads (0,0))"* when the correct pair was (2,3). A slot that *has* been drawn and then benched holds a **frozen non-zero** value instead (slot 0 held `sx−wx = 1234.61` for all 1801 frames). `[V]`
- **airborne = 0 / grounded = 299** is the documented relationship **inverted**, which is what the interleave produces if you assume contiguous per-team slots. Slot order is `P1C1,P2C1,P1C2,P2C2,P1C3,P2C3` — **even = P1, odd = P2** (`sync.rs:41`). `[V]` Arithmetic check: `433.4 − 299 = 134.4` ⇒ the "grounded" reading places that character near the **top** of the frame, i.e. a super-jump apex; `433.4 − 0 = 433.4` ⇒ the "airborne" reading is **exactly the ground line**. `[C]` The labels are swapped, or the 0 came from a never-drawn slot.

**The correct world→screen mapping for the sprite canvas: do not map.** The engine deposits its own post-transform screen anchor at `slot+0x6f0/+0x6f4` and the shipping canvas consumes that directly — `sx = W/(screenW||640)`, `sy = H/(screenH||480)`, `exx = sl.screen_x`, `eyy = sl.screen_y`, `spriteScale = 1.0` (*"baked offsets are already screen-space"*). `[R]` The formula above is a **fallback + freshness test only**; the naive re-derivation (camera = midpoint) mis-placed fighters by a median 147.1 px in X / 82.2 px in Y. `[R]`

`+0x6f0/+0x6f4` is **foot-anchored**: the DC field it mirrors (`+0xE0/+0xE4`) is *"that same MVC2 foot point, so passing exx=live screen_x places the figure foot-on"*; measured standing pose `sid126` spans screen-Y 328…439 with the foot at **433**. `[R]` Y grows **downward** in screen space (the flip lives in M1[5] = −240). `[R]`

### CITATIONS
- `RetroReceipts-agent/docs/STEAM-REPLAY-PLAN.md:312-319` — the projection block verbatim, incl. `zoom ≡ 1.0 ; world units ARE screen px ; NO X rescale` `[V]`
- `…PLAN.md:305-308` — eyeX/Y/Z location + live `(-959.9998, 95.0000, 812.3571)`; ground line `arr+0x2A74 = 433.4`; stage bounds; camera clamps `[V]`
- `…PLAN.md:280` (world x/y `+0x61c/+0x620`), `:282` (screen `+0x6f0/+0x6f4` = DC `+0xE0/+0xE4`, **VALID AS VALUE, INVALID AS GATE**), `:405` (retraction: *"`+0x6f0/+0x6f4` ARE the render screen coords"*), `:73`, `:175`, `:384-387` `[V]`
- `maplecast-flycast/marvelous2/build/bank02.asm:34199-34206` — the four camera constants `[V]`
- `mvc-live-skins-quarters/src-tauri/src/sync.rs:58-59` (`OFF_POS_X/Y`), `:41` (stride + even/odd side), `:1290-1299` (`gs_match_load`, `~±213`) `[V]`
- DC ground model: `bank13.asm:6489-6495` (spawn table), `bank04.asm:24443-24475` (integrate/land), `:36580-36583` (`char[0x41C] = char[0x38]`) `[R]`
- Canvas consumption: `maplecast-flycast/web/webgpu/sprite-client.mjs:55, :937-938, :963-973, :1164-1170` `[R]`

### CONFLICTS
1. **`STEAM-REPLAY-PLAN.md:280` "Already in screen px (DC raw × 5/3)" vs. `:317` "world units ARE screen px; NO X rescale".** These are two lines of the same doc contradicting each other. **`:317` wins**, on measurement: six constants (±1280, 1238.4, −46.6, 812.357, 433.4, ±213) are byte-identical across DC and Steam. Note `213.3333 = 128 × 5/3` and `1280 = 768 × 5/3` `[C]` — the 5/3 is baked into the CPS2→640-px conversion on **both** builds, so it is already applied. **A port that multiplies world coords by 5/3 will be off by 67%.**
2. **"airborne = 0 / grounded = 299" (your measurement) vs. the DC ROM model.** The ROM model wins as the *semantics*; your reading wins as a *fact about what those addresses contained*. Reconciliation: slot attribution / never-drawn slot, not units. Neither source is wrong about its own subject.
3. **Re-derive vs. consume the engine's screen pair.** Consume: the DC replica matched the engine-deposited `+0xE0/+0xE4` to **4.3e-5 px over 1000 frames**, while the naive re-derivation on Steam missed by 147 px median. A measurement beats a formula. `[R]`

### WHAT IT MEANS FOR THE PORT
- Feed `screen_x/screen_y` from `slot+0x6f0/+0x6f4` straight into the canvas. Do **not** compute them from `+0x61c/+0x620`, and do **not** apply 5/3 to positions (5/3 belongs only to `scaleX` — see Q4).
- Keep the projection formula for exactly one purpose: the per-frame **freshness test** `|sx − (320 + wx − eyeX)| < 0.5`, which is also your stale-slot detector.
- Never select a slot by coordinate plausibility. Select by draw-list membership (Q3), then read coordinates.
- Treat `(0,0)` and any coordinate failing the freshness identity as "this slot was not drawn this frame", not as a position.

---

## Q3 — ON-SCREEN TEST

### ANSWER

**A slot is being rendered this frame iff its object handle appears in the engine's own per-frame draw list.** Nothing else — no bounding box, no proximity, no health, no coordinate heuristic.

**Steam form:**
```
H(i)          = slot_i + 0x5CC                     ← the engine never stores a slot base
handle(L,i)   = u64 @ blk+0x300D0 + L*0x300 + i*8  (96 entries/layer)   ✅CONFIRMED at layers 0,1,2,4
handle → slot : (h − blk − 0x44F0) % 0x738 == 0 , quotient in 0..5
DRAWN(i)      = H(i) in ANY bucket  AND  |sx − (320 + wx − eyeX)| < 0.5 this frame
draw_layer(i) = the bucket index L  (0xFF = not drawn)
```
The freshness clause is what makes this immune to the per-layer **count** array (`blk+0x330D0`) being *INFERRED and CONFLICTED* — it collides with battle-globals at `blk+0x32500`. `[V]` Arithmetic re-derived: `0x300D0 − 0x3f24 = 0x2C1AC`, `0x44F0 − 0x3f24 = 0x5CC`. `[C]`

**DC authority (the routine this mirrors), verified this session:** `loc_8c043f60` walks all six fighter structs — `r4 = 0x8C268340`, `r11 = r4 + 0x21D8` (= 6 × 0x5A4), `r12 = 0x05A4` — loads the byte at `char+0x012C`, and **`tst r2,r2 / bt skip`**: byte == 0 ⇒ slot skipped entirely; non-zero ⇒ pre-render + enqueue. `[V]` The enqueue `loc_8c04515e` then applies four more gates: `(u8)node[0x03] > 4` reject; `node[0x12C] == 0` reject; layer bucket already at 0x60 (96) reject **silently**; else append and insertion-sort ascending by `(s8)node[0x31]`. `[R]` The consumer `loc_8c0308c2` walks `count[0x8C2895E0 + L]` pointers from `0x8C287DE0 + L*0x180`, dispatching on `node+0x03`. `[R]`

**This gate answers the exact question asked**: the walk visits all six slots, so a **called assist** (whose `+0x12C` goes non-zero while it is on screen) is included and a **benched partner** (`+0x12C == 0`) is not.

**Do NOT use Steam `slot+0x004` ("active").** It is banned twice: *"⛔ BANNED as a visibility gate — reads 1 for parked benched chars"* (act==1 in **1711/1801** parked frames vs 41/1801 for the only moving slot), and *"do not use it as a point-char signal either — it is anti-correlated with being the point character."* `[V]`

### CITATIONS
- `maplecast-flycast/marvelous2/build/bank04.asm:9436-9486` — `loc_8c043f60`, the six-slot walk and the `+0x12C` gate `[V]`
- `…/bank03.asm:1281-1291` — `loc_8c03093c` re-checks the same byte: `tst r3,r3 / bf loc_8c030950 / bra loc_8c030a9c` `[V]`
- `…/bank04.asm:12166-12255` — `loc_8c04515e` enqueue gates + insertion sort; `:12208-12224` per-frame clear `[R]`
- `…/bank03.asm:1200-1277` — `loc_8c0308c2` consumer, literals `0x0180 / 0x8c287de0 / 0x8c2895e0` `[R]`
- `STEAM-REPLAY-PLAN.md:142-146` — Steam handle/bucket/freshness formulas; `:73` (draw gate = BLOCKING #1); `:252` and `:413` (`+0x004` banned) `[V]`
- Production DC reader: `maplecast-flycast/core/network/maplecast_gamestate.cpp:385-425` (`readAllDrawn`), `:2050-2066` (per-fighter `draw_layer` walk, *"the slot table IS the draw list"*) `[R]`

### CONFLICTS
1. **`tools/re_kb/03_routines.surql:11` says `loc_8c03093c` "skips if != 0". The disassembly says the opposite** — render if `+0x12C != 0`. I read the four instructions myself: `tst` sets T when r3 == 0; `bf` branches to the render body when T == 0. **The disassembly wins.** Any reader written from that KB line has an inverted visibility test. `[V]`
2. **`active` (`char+0x000` / wire `+0`) vs. draw-list membership.** The shipping DC canvas gates on `active`; the ROM gates on `+0x12C`. **On DC both work** (the client comment *"a called assist is a bench char briefly active — so we read all 6 and render every active one"* is validated by live captures showing exactly two char-base nodes in the draw table). **On Steam the analogue of `active` is `+0x004` and it is measured-broken.** The measurement beats the ported convenience: on Steam, membership is mandatory.
3. **Is Steam `+0x004` the DC `+0x12C` visibility gate?** The anim-block mirror (DC `0x144`→Steam `0x1c`, DC `0x142`→`0x1a`, delta −0x128) would map DC `0x12C`→Steam `0x004` `[C]`. **This extrapolation is illegitimate** under `STEAM-CODE-MAP.md` LAW 2 (*"fighter struct is NON-LINEAR … offsets don't share a transform"*), and it is falsified by the 1711/1801 measurement. Note the deltas really are per-sub-block: anim −0x128, kinematics +0x5E8, screen +0x610 `[C]` — so no cross-block extrapolation is valid in either direction (this also means the +0x5E8 argument *against* `+0x6f0` being the screen pair is equally invalid). **The Steam analogue of DC `+0x12C` has no known address.**

### WHAT IT MEANS FOR THE PORT
- Replace the wire's `active` byte with **draw-list membership** at the producer: build `handle→slot` from the one whole-block read, emit `active = 1` and `draw_layer = L` for members, `active = 0` / `draw_layer = 0xFF` for everyone else. `STEAM-REPLAY-PLAN.md:188` already specifies this (`| +0 | active | draw-list membership, not +0x004 |`). `[V]`
- Apply the freshness identity per slot as a second AND-term; drop any member that fails it.
- Delete every read of `slot+0x004`.
- Preserve the DC z-order semantics: sort ascending by `draw_layer`, `0xFF` excluded from the key map, screen_y fallback when no slot reports a layer.

---

## Q4 — WIRE FIELDS

### ANSWER

Wire = `'GSTA'`(4) + 25-byte global header + 6 × 57-byte char blocks + 8-byte input trailer + 1 byte = **376 B**. Char block base = `4 + 25 + slot*57`. Two independent readings of the producer (`maplecast_gamestate.cpp:2142-2215`) and the consumer (`sprite-client.mjs:820-899`) agree byte-for-byte. `[R]`

**Fields the canvas actually reads, with the Steam source for each:**

| wire | field | consumed for | Steam source | status |
|---|---|---|---|---|
| `+0` | active u8 | **the render gate** | **draw-list membership** (Q3) — *not* `+0x004` | ✅ specified `[V]` |
| `+1` | char_id u8 | atlas key `PL{cid:02X}` | `slot+0x554` **read as u8** (u16 returns `cid\|0x100`) | ✅ `sync.rs:57` `[V]` |
| `+2` | facing u8 | sprite flip | `slot+0x720` | ✅ `sync.rs:62` `[V]` |
| `+3/+4` | health / red u8 | HUD only (emitter path) | `slot+0x40c` / `slot+0x410`, full = 144 | ✅ `sync.rs:51-54` `[V]` |
| `+8` | pos_x f32 | zoom derivation (INFO ONLY) | `slot+0x61c` | ✅ `sync.rs:58` `[V]` |
| `+16/+20` | screen_x/y f32 | **the only placement input** | `slot+0x6f0` / `slot+0x6f4` | ✅ `PLAN:282,405` `[V]` |
| `+32` | sprite_id u16 | atlas cell; client masks `&0x7fff`, bit15 = alt world-transform | `slot+0x1c` **raw** | ✅ `PLAN §3` `[R]` |
| `+38/+42` | scaleX/scaleY f32 | per-part scale, **anisotropic** | `slot+0x6fc` (1.6667 = 5/3) / `slot+0x700` (2.1428 = 15/7) | ✅ `PLAN:284` `[V]` |
| `+49` | draw_layer u8 | z-order only (0xFF ⇒ excluded from key map) | the bucket index `L` | ✅ `PLAN:142` `[V]` |
| `+7,+46,+47,+48` | palette, pal12d, pal12e, overlay1a4 | palette row / aura | **UNKNOWN** (`+0x006` on Steam is the *pal bank* `16*(pair+1)+8*side`, not the DC `+0x025` analogue) | ⚠ `PLAN:253` `[V]` |
| hdr `+0` | in_match u8 | gates HUD + atlas preload | `arr+0x2e610` | ✅ `sync.rs:73` `[V]` |
| hdr `+1` | timer u8 | HUD | `arr+0x2e61c` | ✅ `sync.rs:76` `[V]` |
| hdr `+3/+4` | meter level | HUD | `arr+0x2e636` / `+1` | ✅ `sync.rs:70` `[V]` |
| hdr `+9/+11` | meter fill u16 | HUD bar (fill/144) | `arr+0x2e658` | ✅ `sync.rs:71` `[V]` |
| hdr `+21` | frame_counter u32 | **the only velocity clock** (accepts Δ 1..8) | `blk+0x3CC8`, relative to first frame | ✅ `PLAN:187` `[V]` |
| hdr `+5/+7` | p1/p2 combo u16 | HUD | per-slot `slot+0x1ca` — **needs composition** (take the drawn point slot) | ⚠ `sync.rs:47` `[V]` |
| trailer | p1/p2 buttons u16 | debug | `slot0+0x4fc` / `slot1+0x4fc` | ✅ `sync.rs:56` `[V]` |

**On the wire but never read by the canvas** (do not spend RE effort): `stage_id`, `camera_x/y`, `special_move_id`, `assist_type`, `pos_y`, `vel_x/vel_y` (the client re-derives velocity from screen-pos deltas with an EMA), `animation_state`, `anim_timer`, `_pad`, and the LT/RT + `stage_anim_timer` trailer. **Parsed but with zero consumers:** `palette`, `sid_xform`, `pal_color_25`, `render_extra`, `hyper_armor`, `flight_flag`, `stance`, `facing_1d2`. `[R]`

**Minimum load-bearing set (per the render-replica's own comment):** `active, char_id, facing, screen_x, screen_y, sprite_id, scaleX, scaleY, pal12d, pal12e`. `[R]`

### CITATIONS
- `maplecast-flycast/core/network/maplecast_gamestate.cpp:2142-2215` (serialize, `WIRE_SIZE = 25 + 6*57 + 8 + 1 = 376`), `:2225-2229` (deserialize guard `LEGACY_SIZE 367`) `[R]`
- `maplecast-flycast/web/webgpu/sprite-client.mjs:820-899` (the complete read set), `:942-944` (active gate), `:963-973` (placement), `:38` (`_sane` 0.05<v<16 ⇒ else 1.0), `:886-898` (explicitly-unused list), `:1995-2029` (`_heldEmit` bridge) `[R]`
- `mvc-live-skins-quarters/src-tauri/src/sync.rs:41-95` — the single Steam offsets table `[V]`
- `STEAM-REPLAY-PLAN.md:185-191` (wire→Steam mapping), `:253` (pal bank), `:280-285` (per-fighter table) `[V]`

### CONFLICTS
1. **`facing` source.** `GSTA-MAPPING-HANDOFF.md` + `_consolidated/CURRENT-STATE.md` call DC `+0x110` *"a stale COPY"* and name `+0x1D2` authoritative. The shipped client reverses it for rendering: *"the RENDER-authoritative facing is char+0x110 … The body draw flips on sl.facing — do NOT switch it to 0x1d2 (geometry is 0.00px-validated against that field)."* **The client wins** — later correction + a 0.00 px validation. Steam analogue = `slot+0x720`. `[R]`
2. **`OFF_ACTION 0x76c` and `OFF_COMBO_RECV 0x902` exceed `STRIDE 0x738`** — the same >stride bug class that made health `0xb44` read the next slot. `0x902 − 0x738 = 0x1ca` `[C]`, i.e. `combo_recv[i]` is literally `combo_dealt[i+1]`. Both carry in-source `TODO: likely next-slot`. **Neither is on the canvas wire**, so this is a tape-schema defect, not a canvas one — but do not port either offset into a new reader. `[V: sync.rs:63-65]`
3. **`docs/STEAM-RE-NOTES.md` still publishes the pre-fix offsets** (health `+0xb44`, hitstun `+0x909`, red `+0xb48`). **`sync.rs:48-54` wins** — it is the code, and it records the live re-scoring that proved the fix. `[R]`
4. **`OFF_PHASE = 0x2e5dc`** is documented in both readers as *"<5 = active fight, 5 = KO, 6 = win-pose, 9 = results"* `[V]`, but `STEAM-CODE-MAP.md` LAW 1 measured that address reading `28 5c 35 17 00 00 00 00` = a heap pointer, and `PLAN §3` identifies `base+0x00..0x28` as six character **handles**. **The measurement wins: do not gate on `phase`.** Harmless today only because W/L uses health with `win_result` as fallback. Corroborating arithmetic: `0x3f24 + 0x2e5dc = 0x32500` = the battle-globals base, and six shipped constants map onto it exactly (+0x34/+0x3B/+0x3E/+0x40/+0x5A/+0x7C). `[C]`

### WHAT IT MEANS FOR THE PORT
- The Steam feeder must **compose** `active` and `draw_layer` from the draw-list walk, not read them from the struct.
- One read, one frame: poll `fc` at ~1 kHz, busy-wait to **edge + 1.0 ms**, then a single RPM of `[blk, blk+0x33B18)` = 212,248 B, and take the frame number from buffer offset `0x3CC8`. Reading at the instant `fc` increments differed from settled truth on **569/600** frames (94.8%); at edge+0.5 ms, **0/600**. Never a second call, never a second stream. `[R: PLAN §4]`
- Delete `hunt_frame_counter` (`sync.rs:1030-1066`) — the deterministic `arr − 0x25C` (= `blk+0x3CC8`) replaces the ±8 MB brute force. `[C]`
- **Add a length guard on the JS side.** `onGSTA` reads to absolute offset 369 with no bounds check; the dispatcher swallows the `RangeError` (`webgpu-test.html:2744`), so a short packet fails as **silent stale state** with slots `0..k` updated and `k+1..5` frozen. `[R]`
- Free upgrade available: the wire has no `engZ`, so depth always degrades to `draw_layer`→`screen_y`. Steam exposes projected depth at `slot+0x6f8`. `[V: PLAN:283]`
- `scaleX/scaleY` pass through `_sane(v) = (0.05<v<16) ? v : 1.0`, so a missing field degrades safely — but shipping the real 5/3 and 15/7 is required for correct geometry; never apply a uniform scale.

---

## STILL UNKNOWN

| # | Unknown | The single thing that settles it |
|---|---|---|
| 1 | **Steam per-object visibility gate** (the DC `+0x12C` analogue). No known address; `+0x004` is measured-broken. | Sample `slot+0x730..0x737` across ≥300 frames covering ≥2 tag-ins and ≥2 tag-outs. **PASS = exactly one offset scores 1.000 against draw-list membership for all 6 slots on every frame.** No hit ⇒ the port dropped the per-object gate and the draw list is the only gate. `[PLAN §3 "TO-HUNT"]` |
| 2 | **Per-layer draw-list count array.** `blk+0x330D0` is *INFERRED and CONFLICTED* (collides with battle-globals at `blk+0x32500`). | Not needed if you use the freshness identity as the second AND-term. To settle: dump `blk+0x330D0 .. +0x330E0` on a frame with a known 3-entity scene and compare against a bucket scan for non-null handles. |
| 3 | **Your airborne=0 / grounded=299 pair.** Explained as slot attribution or a never-drawn slot, but not proven on your capture. | With the frame-synced whole-block recorder, pick the slot by **draw-list membership**, then log `world_y`, `screen_y`, and `eyeY` for that one slot across a single jump+landing. **PASS = world_y returns to ≈0 at every landing frame and `(eyeY+98.394+240) − world_y` tracks `+0x6f4` to <0.5 px on every drawn frame.** |
| 4 | **Whether a called assist sets its own draw-list membership on Steam** (proven on DC via `+0x12C`). | Log all six handles' bucket membership frame-synced across ≥3 assist calls; the assist's slot must enter a bucket within ≤2 frames of the call and leave when it exits. |
| 5 | **`pal12d` / `pal12e` / `overlay1a4` / `pal_color_25` Steam sources.** `slot+0x006` is the pal **bank**, not the DC `+0x025` analogue. | Diff the six slots' `0x000..0x738` between a normal frame and a frame with an active palette effect (hyper flash / armor), on the same character. |
| 6 | **`camera_x/camera_y` (eyeX/eyeY) location.** Values CONFIRMED numerically at `blk+0x6914/+0x6918`, **location CONFLICTED** — it falls inside slot 5's span, and duplicate triples exist at `+0x6920` and `+0x69B4`. | Move the camera (walk both chars to a corner) and check which triple changes first and which satisfies `|sx − (320 + wx − eyeX)| < 0.5` for every drawn slot. `[PLAN:305]` |
| 7 | **`animation_state` (wire `+34`).** Candidate `slot+0x34/+0x35` is an OPEN CONFLICT — `PLAN §S6.2` retracts the handoff's "group/id are NOT at the mirrored spot". | Not consumed by the canvas; deprioritize. If needed: correlate `+0x34/+0x35` against `sprite_id` transitions over one recorded move. |
| 8 | **`stage_id`.** `sync.rs:1875` hardcodes `stage: 0`; no Steam source anywhere. | Diff `blk` across two matches on known-different stages; the byte that differs consistently is the id. |