# NOBD ARCADE lobby-injector

An in-process **proxy `version.dll`** for **Marvel vs Capcom Fighting Collection**
(Steam appid **2634890**) running under **Proton**. It makes the game **create and
host a Custom Match lobby on demand, with no menu input**, by calling the game's
own "start host session" entry point from an injected helper thread.

This is the code-exec realization of `docs/ARCADE-CREATE-RE.md` (option **c1**). The
create primitive is the menu handler's own (`FUN_140066f00` case 1):
```
matchId = FUN_14006cf10(*(u64*)(base+0xbd3ca0));   // game allocates the slot id
if (FUN_14026b270(manager, matchId, 0) == 0)       // not already present
    FUN_14026a880(manager, matchId, 2, 0, 0);      // POST create, mode = 2
```
→ the game's worker then runs the whole real `CreateLobby → SetLobbyData →
SetLobbyType/Joinable → host handshake`, producing exactly the lobby the rest of the
stack already consumes.

**Design = capture-and-replay (validated live).** `mode` is the constant `2`, but the
id-allocator `FUN_14006cf10` **returns 0 from the top-menu state** (the real menu only
gets a valid id deeper in its FSM), so we cannot synthesize `matchId` purely
statically. Instead, an **inline JMP-trampoline hook** on `FUN_14026a880` observes the
**real `(matchId, mode)` the game passes on ONE manual create**, caches+persists them,
and the `create` trigger **replays** `FUN_14026a880(manager, matchId, mode, 0, 0)`
with those exact values. (The earlier int3+VEH capture did not fire under Proton —
Wine's breakpoint-exception delivery is unreliable — so the hook is now a plain
self-restoring `JMP` patch, which is pure code-exec and fires reliably.)

The appid has **no VAC** (confirmed), so in-process execution is acceptable —
same risk class as a trainer (stability only, no ban surface).

> ⚠️ This talks to the **local game process**. It supersedes the OVH
> `arcade_host.py` external-`CreateLobby` path *for the create step* — that path is a
> proven dead end because the local game never adopts a lobby another process made
> (`ARCADE-HOST-AUTOMATION.md` §2). Here the game itself creates the lobby.

---

## 1. Which DLL we proxy, and why

The game **ships no `steam_api64.dll`** (Steamworks is statically linked / lazy — it
is not in the game dir and not in the EXE import table), so the obvious Steam-DLL
proxy is **not available**. The EXE's real import table (verified from the shipped
binary) pulls these candidates:

| Candidate | Imported symbol used | Verdict |
|---|---|---|
| `steam_api64.dll` | — | **N/A** — not shipped, not imported |
| `dxgi.dll` / `d3d11.dll` | graphics | **NO** — DXVK owns these under Proton; proxying fights DXVK |
| `winmm.dll` | `waveInGetNumDevs` | ok, but ~larger surface + hot timer path elsewhere |
| `dinput8.dll` | `DirectInput8Create` | ok, but a forward glitch **breaks controller input** (bad for a fighting game) |
| **`version.dll`** | `GetFileVersionInfoA` | ✅ **CHOSEN** |

**`version.dll` is the pick:** it is **statically imported** (so it's loaded at
process init, before the game's own startup — our `DllMain` runs early), it has a
tiny, ABI-stable export set, there is **no DXVK conflict**, and its single used
function is a **low-stakes version query** — a forwarding hiccup can't break input or
audio timing the way a `dinput8`/`winmm` proxy could.

The proxy is **100% transparent**: all 16 real `version.dll` exports are
**forwarded** to `versionorig.dll` (a byte copy of the real Proton `version.dll`).
The proxy adds zero behavior to `version.dll` itself; its only job is to get our
`DllMain` executed in the game process. (Export forwarding verified in the built DLL
— `objdump -p version.dll` shows all 16 `Forwarder RVA -- versionorig.*`.)

---

## 2. Files

| File | Purpose |
|---|---|
| `dllmain.c` | the payload: helper thread, int3+VEH capture hook, file-poll trigger loop, defensive guards |
| `arcade_offsets.h` | **all** RE constants (offsets, entry points) — the only file to edit on a game update |
| `version_proxy.def` | export-forwarder table (16 exports → `versionorig.*`) |
| `gen_def.py` | regenerates `version_proxy.def` from a real `version.dll` (if Proton changes the set) |
| `build.sh` | mingw-w64 cross-build + self-verify of the forwarders |
| `setup_proxy.sh` | Linux installer: drops the proxy + `versionorig.dll` into the game dir |
| `version.dll` | **prebuilt, verified** artifact (rebuild anytime with `build.sh`) |

---

## 3. Build

Toolchain: **mingw-w64** (`x86_64-w64-mingw32-gcc`). It was **not** installed on the
Bazzite box or in the `tauri` distrobox; it **is** now installed in the **`tauri44`**
distrobox (Fedora 44). The one install line, if you ever need it again:

```bash
distrobox enter tauri44 -- sudo dnf install -y mingw64-gcc mingw64-binutils
```

Build (already verified to compile clean with gcc 16.1.1 and emit all 16 forwarders):

```bash
distrobox enter tauri44 -- bash -lc 'cd /path/to/injector && ./build.sh'
```

`build.sh` links `dllmain.c` + `version_proxy.def` into `version.dll`, then
self-verifies with `objdump` that the exports are real forwarders (falls back to a
`dlltool` forwarder build if a given binutils won't emit them from the `.def` — the
current toolchain does emit them directly, so the fallback is not used). A prebuilt
`version.dll` is already included.

---

## 4. Install into the game (ONE command — no launch option, no capture)

On the Bazzite box:

```bash
cd /path/to/injector
./setup_proxy.sh install
```

This single step:
1. copies the prefix's real `version.dll` → `<gamedir>/versionorig.dll` (the forward target),
2. drops our proxy → `<gamedir>/version.dll`,
3. sets the DLL override **directly in the game's Proton prefix registry**
   (`HKCU\Software\Wine\DllOverrides` → `version = native,builtin` in `user.reg`),
   so Wine loads our native game-dir `version.dll` **with no Steam launch flag**.

`<gamedir>` = `~/.local/share/Steam/steamapps/common/MARVEL vs. CAPCOM Fighting Collection/`

> The game must **not be running** during install (Wine rewrites `user.reg` on
> prefix unload). Steam itself can stay open. `setup_proxy.sh` refuses if it sees
> the game process.

**Alternative override methods** (the installer uses the first):
- `user.reg` edit (default, most reliable — no runnable wine needed).
- `WINEPREFIX="$PFX" "<Proton>/files/bin/wine" reg add "HKCU\Software\Wine\DllOverrides" /v version /d native,builtin /f`
- Steam Launch Option (fallback if you'd rather not touch the prefix):
  `WINEDLLOVERRIDES="version=n,b" %command%`

Undo anytime: `./setup_proxy.sh uninstall` (restores DLLs + removes the override).

That completes DLL install + override. One **one-time capture** remains (§5).

---

## 5. One-time capture (do ONE manual create)

> ⚠️ **KNOWN GAP (live-confirmed):** `FUN_14026a880` is the **ranked/casual**
> matchmaking create — a manual **Custom Match** "Create Lobby" does **not** call it,
> so the §5 capture hook never fires for Custom Match. The Custom Match create-initiator
> is a *sibling* menu FSM (three-screen flow: Online → Custom Match → Create-Lobby
> screen). **Find it first with the §5.1 CreateLobby diagnostic**, then wire `create` to
> the real initiator. §5 below is retained for the ranked/casual path and once the
> correct initiator is known.

The `create` trigger replays the real `(matchId, mode)` the game itself used, so the
injector must observe it once. The EXE `.text` is **packed** and, critically, patching
`FUN_14026a880` **during the startup window crashes launch even over a valid decrypted
prologue** (anti-tamper / startup corruption). The old int3 build proved a **late**
`.text` patch (issued at the menu, seconds after launch) is safe. So the injector
**never arms automatically** — arming is **manual and late**, triggered by a command
you issue at the online menu, and still gated on the decrypted `0x48` prologue.

Two capture mechanisms (try `capture` first; `capture_hw` is the no-code-touch fallback):

1. Launch MvC2 from Steam — it starts normally (nothing patched). Go to the online /
   custom-match menu (this decrypts `.text` and inits netplay). Watch the decrypt state:
   ```bash
   GD="<gamedir>"; cat "$GD/nobd_arcade.ready"    # {"manager":true,"hooked":false,...}
   tail "$GD/nobd_arcade.log"                      # first byte flips garbage -> 0x48
   ```
2. Once decrypted (log shows `0x48 (DECRYPTED -- safe to arm)`), **arm the capture**:
   ```bash
   printf 'capture' > "$GD/nobd_arcade.cmd"        # PRIMARY: JMP detour (late = safe)
   # if that crashes/wedges the game, restart and instead use the fallback:
   # printf 'capture_hw' > "$GD/nobd_arcade.cmd"   # FALLBACK: hardware BP (no code patched)
   ```
   `.ready` now shows `"hooked":true` (or `"hw_armed":true`).
3. **Create a Custom Match once, by hand.** The hook fires, records `(matchId, mode)`,
   and the game creates the lobby normally.
   ```bash
   cat "$GD/nobd_arcade_capture.txt"   # matchId=<d> mode=2 manager=0x...
   cat "$GD/nobd_arcade.ready"         # "have_capture":true
   ```
4. Leave that lobby (so the gate clears) — now `create` replay will make fresh ones.

The captured values **persist to `nobd_arcade_capture.txt`** and are reloaded on future
launches, so the manual create is genuinely one-time per machine (re-do it — `capture`
then a manual create — if a game update changes the ids). Arming is one-shot and
self-disarms after it fires; re-issue `capture`/`capture_hw` to observe again.

---

## 5.1 Finding the Custom Match create path (CreateLobby vtable diagnostic)

Since a Custom Match create doesn't go through `FUN_14026a880`, use `probe_cl` to find
the routine it *does* use. It hooks **`ISteamMatchmaking::CreateLobby`** — every lobby
creation (ranked, casual, Custom Match) funnels through the matchmaking vtable slot
`+0x68`, and hooking a **vtable pointer is a pure data swap (no code patched → no
anti-tamper risk)**. When CreateLobby fires it logs its args (`eLobbyType`,
`cMaxMembers`) **and a stack walk** of in-module return addresses (`base+offset`, i.e.
Ghidra addresses) — which reveals the worker that calls CreateLobby and, higher up, the
Custom-Match menu FSM initiator (the sibling of `FUN_140066f00`).

```bash
GD="<gamedir>"
# 1. launch, go to the online menu (Steam up, .text decrypted)
printf 'probe_cl' > "$GD/nobd_arcade.cmd"          # install the vtable hook
cat "$GD/nobd_arcade.result"                        # {"ok":true,"cmd":"createlobby_hook_installed"}
# 2. do the manual THREE-SCREEN Custom Match create:
#    Online -> Custom Match -> Create-Lobby screen -> Create
grep -A40 'CreateLobby FIRED' "$GD/nobd_arcade.log" # args + [CL] stack walk
```

The log lines to harvest:
- `[CL] *** CreateLobby FIRED *** ... eLobbyType=N cMaxMembers=M` — the Custom Match
  lobby type + size.
- `[CL] matchmaking vtable=... CreateLobby slot=... orig=... (base+0x…)` — confirms the
  slot.
- `[CL] frame[i] = base+0x…` and `[CL] sp+0x… -> base+0x…` — the **call chain**.
  Cross-reference these `base+offset` addresses in Ghidra: the nearest is the worker
  that calls CreateLobby; a higher one shaped like a state-machine (`switch` on a state
  DWORD, a `case` that allocates a slot then posts a create) is the **Custom-Match
  create-initiator** — capture its address, its post-function, and the mode constant.

Feed those back and `create` gets wired to call the real initiator (the analog of the
`FUN_14026a880` replay, but for the Custom Match path). `unprobe_cl` removes the hook.

**Live result (2026-08-19):** `probe_cl` confirmed `CreateLobby(eLobbyType=2,
cMaxMembers=2)` fires on the manual Custom Match create — but the **entire** stack was
the **worker thread** (`FUN_14026dd20` = the worker loop that drains a session-request
array and calls CreateLobby). The menu **producer** had already returned, so it is
invisible to the CreateLobby stack. ⟹ the create is **producer/worker**: the menu
writes a request into the array at `netplayObj+0x178` and signals the worker; the worker
consumes it → CreateLobby → coordinator `FUN_14013af30` hosts. `FUN_14026a880` is the
*ranked* producer (writes `manager+0x60` slots); the Custom Match producer is a sibling
that writes `+0x178`. That is what `probe_req` (§5.2) captures.

---

## 5.2 Capturing the Custom Match request (session-array snapshotter)

Ghidra pinned the CM path to the **`FUN_140393190` notify family** (not the ranked
`mgr+0x60` / `FUN_14038efe0` one): the producer fills a request **slot at `mgr+0x328`**
(stride `0x20`, 16 slots) then `FUN_140393190(session0+0x7c0, idx, mgr+0x328+idx*0x20,
1, 0)`; the worker `FUN_14026dd20` drains `session0+0x178` (a **pointer array**, count
`@session0+0x978`). So `probe_req` watches all of it: `mgr+0x60` (ranked, for the diff),
**`mgr+0x328` CM request slots**, **`session0+0x7c0` notify queue**, and the
`session0+0x178` pointer array — **following each new pointer** to dump the request
object. It also arms the CreateLobby hook + dumps everything at the exact create moment,
and samples fast (~25 ms) while active.

> ⚠️ **Use build ≥ 445764** for the mgr+0x328 / session0+0x7c0 windows — run
> `./setup_proxy.sh install` again after pulling this build so the game loads it.

```bash
GD="<gamedir>"
# at the online menu (Steam up, .text decrypted):
printf 'probe_req' > "$GD/nobd_arcade.cmd"     # baseline dump + snapshotter on
# 1) do a manual CUSTOM MATCH create   -> note the new s0+0x178[n] ptr + its req* dump
# 2) leave, then do a manual RANKED create -> note its mgr+0x8c/0x90 writes
printf 'unprobe_req' > "$GD/nobd_arcade.cmd"
grep '\[req\]' "$GD/nobd_arcade.log"
```

Read the log (the key CM lines):
- `[req] mgr(cm-slot)+0xNNN: old -> new` — **the CM request slot fields** the producer
  wrote at `mgr+0x328+idx*0x20` (type / flags / mode / member count / params). **This is
  the struct to replicate.**
- `[req] s0q(notify)+0xNNN: old -> new` — the notify-queue post
  (`session0+0x7c0[idx]`: `+0x28=req`, `+0x30/+0x31=flags`) confirming the wake + which
  `idx`/`req` were used.
- `[req] s0+0x978 count = N` and `[req] s0+0x178[nn]: 0 -> 0xPTR` + `  req*…` — the
  resulting session added to the worker's list.
- Diff against the **ranked** create, whose writes land inline at `mgr+0x8c/0x90/0x84/
  0x88` — isolates what's Custom-Match-specific.
- `[req] === SNAPSHOT AT CreateLobby …` + `CL/mgr(cm-slot)…` / `CL/s0q(notify)…` — the
  slots + queue at the instant the worker consumed the request.

**Replicate plan** (next build, once the slot fields are captured). Now concrete, per the
notify-family RE:
```
idx  = a free CM slot index (0..15)
slot = mgr + 0x328 + idx*0x20
// fill slot with the captured CM fields (type / mode / member count / params)
FUN_140393190(session0 + 0x7c0, idx, slot, 1, 0);   // = base+0x393190, the CM wake
```
i.e. mirror `FUN_14026ba90`'s tail. The worker `FUN_14026dd20` then drains it →
CreateLobby → host → `read_my_lobby` reads `coord+0x340`. Offsets are pre-recorded in
`arcade_offsets.h` (`OFF_NOTIFY_POST`, `CM_SLOTS_OFF`, `CM_NOTIFY_QUEUE_OFF`, …). **Cleaner
fallback:** call the **CM producer directly** — decompiling `FUN_14034a5a0`/`bd40`/`f1a0`
(the 0x34xxxx frames on the CM CreateLobby stack that call `FUN_140393190`) will name it
and its type/mode constant, so `create` just calls that with a resolvable `this`.

---

## 5.3 Finding the CM-create handler (arm-primitive call intercept)

Replaying the arm with captured numbers is fragile — `p3` is a live heap object, not a
constant. The robust `create` calls the handler that *builds* `p3`, so the decisive
capture is the **return address** of the arm call. `probe_arm` detours the arm primitive
**`FUN_14026ba90`** (base+0x26ba90) — armed late, gated on decrypt, self-restoring +
re-armed each tick, chaining to the original so the game runs normally — and logs each
call with its caller's return address. It also keeps the CreateLobby hook as the
ground-truth backstop.

```bash
GD="<gamedir>"
# at the online menu (Steam up, .text decrypted):
printf 'probe_arm' > "$GD/nobd_arcade.cmd"
# do a manual CUSTOM MATCH create
grep -E '\[arm\]|CreateLobby FIRED' "$GD/nobd_arcade.log"
printf 'unprobe_arm' > "$GD/nobd_arcade.cmd"
```

Each call logs: `[arm] FUN_14026ba90 mgr=… idx=… p3=… p4=… ret=… (ret=base+0x…)`.
- `idx` = the message-type index (ranked uses 7 in the case-3 path; CM's differs).
- `p4` = the **callback fn pointer** (a `base+0x…` you can name in Ghidra).
- **`ret=base+0x…`** = the **CM-create handler** that armed the request — decompile it to
  define `create`. Correlate with the `CreateLobby FIRED` line to confirm this arm led to
  the create.

If **no `[arm]` line** appears for the CM create (i.e. it bypasses `FUN_14026ba90` and
posts straight through the notify primitive), run `probe_notify` instead and look for the
`[notify]` line whose `ret`/`idx` matches the CM create (it is high-frequency, so expect
many lines and filter by `ret`).

Once the handler is known, `create` calls it directly (with a resolvable `this`/args) —
the clean, non-fragile replicate.

**Live result (build 448639):** `CreateLobby FIRED (eLobbyType=2, cMaxMembers=2)` but the
`[arm]` line did **not** — so **CM does not post via `FUN_14026ba90`**. The 9-frame
CreateLobby backtrace is the worker chain; `FUN_14034bd40` (the 0x2078 CM session ctor,
sets `+0xb0=2`) and `FUN_140349c70` (the state machine that drives it to CreateLobby) are
the CM internals — but the ctor doesn't self-link into the worker's `+0x178` scan, so the
real `create` is the **menu handler** that constructs + links + kicks it. That handler is
found by §5.4.

---

## 5.4 Finding the menu Create handler (CM-constructor intercept)

`probe_ctor` detours the CM session constructor **`FUN_14034bd40`** (base+0x34bd40) and
logs its **caller's return address** = the menu handler that builds the session, plus the
**thread id** it runs on. That handler is the producer to decompile for `create`; the tid
says whether `create` can call from the helper thread or must marshal onto a game thread.

```bash
GD="<gamedir>"
# at the online menu (Steam up, .text decrypted):
printf 'probe_ctor' > "$GD/nobd_arcade.cmd"
# do a manual CUSTOM MATCH create
grep -E '\[ctor\]|CreateLobby FIRED' "$GD/nobd_arcade.log"
printf 'unprobe_ctor' > "$GD/nobd_arcade.cmd"
```

Line: `[ctor] FUN_14034bd40 this/rcx=… rdx=… r8=… r9=… ret=… (ret=base+0x…) tid=…`.
- **`ret=base+0x…`** = the **menu Create handler** — decompile it: it allocates/constructs
  the session (this call), links it into `session0+0x178`, and kicks `FUN_140349c70`. That
  defines `create` (call this handler with a resolvable `this`/args).
- `tid` = the thread it ran on (vs. `nobd_arcade.log`'s helper tid) — tells us whether
  `create` calls directly or marshals.
- Correlate with `CreateLobby FIRED` to confirm this construction led to the create.

**Live result:** `[ctor]` did **not** fire (CreateLobby still fired) — so the CM object is
**built early (on entering the menu) and persists**; clicking Create only advances its
state machine. That transition is what §5.5 watches.

---

## 5.5 Watching the CM state machine (in-process, reads only)

The CM object persists; `FUN_14034cad0` (its vtable slot 6) ticks each frame and, via
`FUN_140349c70(obj+0x160)`, fires the Steam create **only when `*(u32*)(obj+0x170) == 6`**
(plus a timer `obj+0x788` / counter `obj+0x790`). So `create` is a **state transition on
the existing object**, not a call. `watch_cm` resolves the object by its vtable
(`base+0x964ba0`) — scanning the 4 session slots `manager+0x250..+0x268`, falling back to
the `+0x178` pointer arrays — then polls its fields every ~5 ms and logs only changes.
Because it is pure reads from in-process memory, it is **zero-risk** (no hooks, no writes).

```bash
GD="<gamedir>"
# at the online menu (CM object exists):
printf 'watch_cm' > "$GD/nobd_arcade.cmd"        # logs obj+vtable, then baseline fields
# navigate to the Create-Lobby screen (watch logs the resting state)
# click Create  -> watch logs the transition sequence; probe_cl logs the fire
grep -E '\[cm\]|CreateLobby FIRED' "$GD/nobd_arcade.log"
printf 'unwatch_cm' > "$GD/nobd_arcade.cmd"
```

Watched fields (each `[cm] t=<ms> off=0x… <label> old -> new`): `type`(obj+0xb0),
`STATE`(obj+0x170) and the `obj+0x168..0x17c` region, flags(obj+0x174..0x177),
`steamSMptr`(obj+0x180), `timer`(obj+0x788), `counter`(obj+0x790). The **transition
sequence** into `STATE==6` — and especially whether `steamSMptr` gets populated *before*
state 6 — tells you exactly what `create` must write.

**Live result:** on the Create-Lobby screen the CM object rests at `state=1, type=2,
steamSMptr(obj+0x180)=set, timer=0, counter=0`. A manual Create takes `state 1→3` and
CreateLobby fires the **same ms** (the per-tick `steamSM->vtable[0xa]` call at the top of
`FUN_140349c70`, not the state-6 branch), then `state 3→2`. But `FUN_140349c70`'s
**state-6 branch is a clean pokeable retry** to the *same* create primitive
`FUN_14015b150(*(obj+0x180), obj+0x188)` (a lock-protected type-0x304 enqueue on the game
tick). Since `steamSMptr` is already populated at rest, the create's prerequisite exists.

## 5.6 The replicate — `create_poke`

`create_poke` resolves the CM object and writes, in order, `counter(obj+0x790)=0`,
`timer(obj+0x788)=1`, `state(obj+0x170)=6` — so the game's own next tick runs the state-6
branch → `FUN_14015b150` → CreateLobby, **on the game thread** (pure memory writes from us
= zero cross-thread risk). It keeps `probe_cl` active and then reports the resulting lobby.

```bash
GD="<gamedir>"
# on the Create-Lobby screen (steamSMptr populated):
printf 'create_poke' > "$GD/nobd_arcade.cmd"
cat "$GD/nobd_arcade.result"                      # {"ok":true,"lobby_id":"…","companion":"…"}
grep -E '\[cm\]|CreateLobby FIRED' "$GD/nobd_arcade.log"
```
Expect `[cm] CREATE_POKE …`, then `CreateLobby FIRED`, then a real `lobby_id` in the
result (confirming a lobby actually stood up, not just the Steam call). If the poke races
the object's own state writes, use `call_create` (calls `FUN_14015b150` directly). Read
the live lobby anytime with `read_lobby` (→ id + owner + join link).

---

## 5.7 Menu-driving prep: `menu_snap` (find screen-state + field offsets)

Poking live session state proved fragile (`create_poke` raced the object's own state
writes; `call_create` then hit a null `steamSMptr`). The robust path is to **drive the
game's own menus** via its internal input register (kcode-style, in-process memory — not a
virtual controller). That needs three reads found empirically: the **screen-state global**,
the **create-screen field offsets** (FT / size / passcode), and ideally the **menu input
bitmask**. `menu_snap` captures the raw material.

Each `menu_snap <label>` appends to `nobd_arcade.snap`, sampling each region **5× over
~100 ms** and flagging per-dword stability (so the offline diff drops within-screen
flicker). Regions:
- **A** = `.data` state globals, `base+0x2eb0000` (64 KB) — around `DAT_142ebccb8` etc.;
  expected home of the screen-state global.
- **B** = the **CM object** (resolved by vtable, full `0x2078`) — expected home of the
  create-screen fields near `type`(obj+0xb0).
- **C** = `base+0xac6000` (8 KB) — the in-match kcode/input area (best-effort for the menu
  input bitmask; see note below).

Line format (easy to diff offline): `<A|B|C> +0x<off> <hexdword> <.|~>` (`~` = flickered).

```bash
GD="<gamedir>"
# one session, Tris walks the screens:
for s in main online custommatch createscreen; do
  printf "menu_snap $s" > "$GD/nobd_arcade.cmd"; sleep 1; done
# on the create screen, change one setting at a time:
printf 'menu_snap ft1'  > "$GD/nobd_arcade.cmd"   # (toggle FT, then)  menu_snap ft2
printf 'menu_snap size4'> "$GD/nobd_arcade.cmd"   # (change size, then) menu_snap size8
printf 'menu_snap pass' > "$GD/nobd_arcade.cmd"   # (set a passcode)
# pull nobd_arcade.snap and diff labels offline
```
Diffing gives: the **screen-state global** (region A dword that is stable within a screen
and differs across screens), and each **field offset** (the dword that changes only when
that setting changes — mostly region B).

> **Menu input global:** I could not pin it statically — the shipped `.exe` `.text` is
> packed (encrypted on disk), so Ghidra-on-the-file can't see the menu-input read; the
> known `exe+0xac6ef0` is the *in-match* kcode pointer. Region C snapshots around it as a
> best guess; if the diff doesn't surface a menu-input register there, point me at a
> candidate address (or the Ghidra decompile of the menu-input read) and I'll add a region.

---

## 5.8 The real trigger — `watch_sm` / `poke_sm` (steamSM wrapper)

`create_poke` and `call_create` both missed: poking the CM object's downstream state
raced its own writes, and posting the type-0x304 message (`FUN_14015b150`) on a clean
object did **not** fire CreateLobby. The manual create fires via the per-tick
`steamSM->vtable[0xa]()` (wrapper vtable +0x50), which only calls CreateLobby when the
**wrapper's own state** says "create requested" — the field the Create button sets. So the
trigger lives in the **steamSM wrapper** (`steamSM = *(cm_obj+0x180)`), not the CM object.

`watch_sm` resolves `steamSM`, logs its vtable, dumps a `0x800`-byte baseline, then polls
every ~5 ms and logs only changed dwords. Pure reads → zero risk. `probe_cl` stays active
so you see the exact tick CreateLobby fires relative to the wrapper changes.

```bash
GD="<gamedir>"
# on the Create-Lobby screen:
printf 'watch_sm' > "$GD/nobd_arcade.cmd"        # logs steamSM+vtable, then baseline
# click Create manually
grep -E '\[sm\]|CreateLobby FIRED' "$GD/nobd_arcade.log"
printf 'unwatch_sm' > "$GD/nobd_arcade.cmd"
```

The wrapper dword(s) that change **right as `CreateLobby FIRED`** = the trigger field.
Then test hands-free on a fresh Create-Lobby screen:
```bash
printf 'poke_sm <off> <val>' > "$GD/nobd_arcade.cmd"   # e.g. poke_sm 1c 1
grep -E '\[sm\]|CreateLobby FIRED' "$GD/nobd_arcade.log"
```
This is the **actual button target**, so poking it should behave like the button (unlike
`create_poke`, which hit the downstream/managed state). Once confirmed, `create` = resolve
steamSM + write that field.

---

## 5.9 Menu navigation — the `scan` family (CE-style value-delta scanner)

OS-level input works: **`ydotool`** (uinput via `ydotoold`) keystrokes reach the game
under Proton/Wayland. So the auto-host drives the game's **own menus** — but must *read*
which item/screen is highlighted before each select (navigate verified, not blind). The
cursor/screen vars aren't in the `menu_snap` regions, so we pin them with a
value-delta scanner and the injected input:

- `scan_new [max]` — snapshot `{addr,val}` for every u32 in `[1, max)` (default `0x10000`)
  across committed **private RW** regions. Reports the candidate count (`capped`/`faulted`
  flags too). **Excludes 0** to keep the first pass bounded — so make the target var
  **non-zero** at scan time (move the cursor to item ≥ 1 first), or pass a tight `max`
  (e.g. `scan_new 100` = values 1..255, ideal for cursor/screen indices).
- `scan_delta <±hex>` — keep only candidates where `new == old + delta` (signed hex:
  `1` after a Down, `-1` after an Up), update to `new`, drop the rest. Reports survivors
  (up to 40) as `0x<addr> = <val>`.
- `scan_same` / `scan_changed` — keep unchanged / changed (for screen-id hunting across
  transitions).
- `scan_read <hexaddr>` — read a u32 at an absolute address (to verify a found var tracks
  live across navigation).

Reads are direct (fast) under the crash-guard, so a freed region can't crash us (it
reports `faulted`, redo `scan_new`). The candidate table is in-process (VirtualAlloc, up
to ~12M entries with fallback); `scan_new` resets it.

**Cursor-pinning workflow** (you drive `ydotool` between calls):
```bash
GD="<gamedir>"
printf 'scan_new 100' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"   # candidates
# ydotool key Down  → then:
printf 'scan_delta 1'  > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"
# ydotool key Down  → scan_delta 1 ; ydotool key Up → scan_delta -1  ...
# survivors converge to the cursor index; confirm it tracks live:
printf 'scan_read 0x<addr>' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"
```
Screen-id: `scan_new`, change screens, `scan_changed` (and `scan_same` to filter churn) →
the dword that changes only on screen transitions. Once cursor + screen vars are pinned,
the auto-host loop is: read state → `ydotool` to the target item → verify → repeat →
CreateLobby → `read_lobby`.

---

## 5.10 Definitive screen/item readout — `find_u32` / `find_u64`

The UI is a reflection-based class framework: each screen class has a NAME at a fixed
address (`uUiMainMenu`=0x1408e8e30, `uUiNetMenu`=0x1408e9b66, `uUiCustomMatch`=0x1408e5c38,
`uUiCreateLobby`=0x1408e55e0, `uUiMatchSelect`=0x1408e92a0, `uUiSelMode`=0x1408ed5c8). If
each **live** screen object stores its class-name pointer, searching memory for that
pointer finds the active screen object — a distinctive 64-bit value (unlike the tiny
cursor index that collided with millions). The cursor index is then a field at a fixed
offset inside that object.

`find_u32`/`find_u64` scan **all committed readable regions** (heap **and** image/.data),
reporting each hit's addr, the next dword, and whether it's inside the game module
(`img:true` = image/descriptor, `img:false` = a live heap object). Reads are direct under
the crash-guard (a freed region reports `faulted`).

```bash
GD="<gamedir>"
# on the main menu:
printf 'find_u64 0x1408e8e30' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"
#  -> expect image hits (descriptor/registration, img:true, ignore) + a HEAP hit
#     (img:false) = the live uUiMainMenu object.
# (or find_u32 0x408e8e30 and confirm next=0x00000001 to verify the full pointer.)
```

**Live result:** `find_u64 0x1408e8e30` returned 3 **heap** hits (the live `uUiMainMenu`
objects) + 1 image descriptor — so live screen objects DO carry the class-name pointer,
and per-screen `find_u64` is a definitive current-screen readout.

Then pin the cursor field with **`dump`** (fast window read, one call):
```bash
GD="<gamedir>"
printf 'dump 0x<obj-0x40> 128' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result" > /tmp/a.json
# ydotool key Down x3, then:
printf 'dump 0x<obj-0x40> 128' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result" > /tmp/b.json
# diff a.json vs b.json -> the dword that moved by +3 = the cursor-index field
```
`dump` returns `{base, n, dw:["00000001", …], unreadable}` — index `i` is offset `i*4`
from `base`, faulting pages are `--------`. Repeat around each of the name-pointer heap
hits to find the real one. Once pinned: `object = find_u64(screenname)`, `cursor = dump(
object) + cursor_offset` = live "which screen + which item". If the cursor lives in a
sub-widget, the dump shows the sub-object pointer to follow — same tool. `object +
cursor_offset` = current item — verified select every time.

> If the name pointer isn't stored in the object (only a vtable), `find_u64` returns only
> image hits — then pivot to finding the class **vtable** pointer instead (same tool: find
> the vtable address, which every instance's first qword points to). Tell me the vtable
> addresses if it comes to that.

---

## 5.11 Menu RE via in-process backtrace — `probe_bt`

External gdb is unreliable here: its **hardware** breakpoint on menu code never fires
because Wine/Proton's DR-register `#DB` delivery is broken (the same reason the injector's
own capture uses JMP detours, not int3/HW-BP). But **JMP detours DO fire under Wine**
(`probe_cl` proved it). So we do the menu capture in-process.

`probe_bt <hexoffset> [maxframes]` detours `base+<offset>` (arm-late, decrypt-gated,
self-restoring + re-armed — the proven plumbing) and, on each call, logs the args and a
**full in-module backtrace** (`RtlCaptureStackBackTrace`, default 24 frames, filtered to
`base+0x…`), then chains to the original. It is **re-pointable**: issue `probe_bt` with a
new offset and it rebuilds the detour at the new target (the stub bakes the target
address, so re-pointing resets it cleanly).

The reliable "entered online" anchor is `FUN_14012f3a0` (`base+0x12f3a0`) — it sets the
coord global `DAT_142eb36a0` (so `.ready`'s `coord` flips true), i.e. it runs when you
select "Online play". Its backtrace reveals the menu-confirm→dispatch chain that read the
cursor:

```bash
GD="<gamedir>"
printf 'probe_bt 0x12f3a0 24' > "$GD/nobd_arcade.cmd"    # arm at the main menu
# ydotool: navigate to "Online play" and confirm
grep '\[bt\]' "$GD/nobd_arcade.log"                       # args + base+0x.. frames
printf 'unprobe_bt' > "$GD/nobd_arcade.cmd"
```

Cross-ref each `[bt] frame[i] = base+0x…` in Ghidra: the frames above the anchor are the
menu-confirm handler and its dispatcher — one of them reads the cursor index. Re-point
`probe_bt` at those to trace further up, until you find the function that reads the
selection. That's the definitive per-item select signal. (Same tool works for any
function — screen-open handlers, item-select callbacks, etc.)

---

## 5.12 The host path — `host_via_join` (+ `nav_online`)

External `CreateLobby` failed "could not join session" because it skipped the online-
session setup. The join flow does that setup for free: `steam://joinlobby/2634890/<id>/
<owner>` makes the game construct the manager/netplay/coord for the join target, then call
`SteamMatchmaking::JoinLobby`. So **`host_via_join`** vtable-hooks `JoinLobby` (matchmaking
`+0x70`, same singleton as `probe_cl`'s `+0x68`) and, on the first call, instead invokes the
game's own **`CreateLobby(eLobbyType=2, cMaxMembers=2)`** and returns *its* `SteamAPICall_t`
— so the already-primed callback handlers process the created lobby and stand us up **as
host**. It auto-disarms after firing (a later real join isn't hijacked), and keeps
`probe_cl` armed so `[CL] *** CreateLobby FIRED ***` double-confirms it went through the
real Steam vtable.

It is **fully instrumented** so a partial first shot shows exactly where it stalls:
```
[hijack] JoinLobby(0x<id>) INTERCEPTED
[hijack] -> CreateLobby(eLobbyType=2, cMaxMembers=2) returned SteamAPICall_t=0x<handle>
[CL] *** CreateLobby FIRED *** ...           (probe_cl backstop + backtrace)
[hijack] t=+<ms> coord=0x.. lobby_id=0x.. owner=0x.. in_session=<0|1> state=<n>   (8s poll, on change)
[hijack] === post-create poll done (8s). Final read_lobby + heartbeat: ===
[lobby] id=.. owner=.. in_lobby=.. ...        (+ result file + .ready)
```
Reading the trace: CreateLobby fired but `lobby_id` stays 0 ⇒ callback/session-wire missing;
`lobby_id` appears but `in_session` stays 0 ⇒ metadata/mode gap (add `SetLobbyData` next).

```bash
GD="<gamedir>"
printf 'host_via_join' > "$GD/nobd_arcade.cmd"                       # arm at the main menu
# send steam://joinlobby/2634890/<id>/<owner> to the running game (or use nav_online below)
grep -E '\[hijack\]|CreateLobby FIRED' "$GD/nobd_arcade.log"
cat "$GD/nobd_arcade.result"                                         # final read_lobby
```

**`nav_online <hexLobbyID>`** removes even the external URL: it arms a hook on the main-
thread per-frame consumer `FUN_140054100` and, on the next frame, writes the pending-join
fields into `coord = *(base+0x2eb36a0)` (`+0x290`=id, memset `+0x298` 400 B, `+0x410`=id,
`+0x420`=1, `+0x428`=0) — exactly what the `GameLobbyJoinRequested` handler does. The game
then validates, navigates online, and calls `JoinLobby(id)`. Writing on the main thread is
required (the frame loop consumes it); the hook is the vehicle. It retries until `coord` is
non-null.

**Fully in-process auto-host (zero external input):**
```bash
printf 'host_via_join' > "$GD/nobd_arcade.cmd"
printf 'nav_online 0x109775242789250690' > "$GD/nobd_arcade.cmd"   # any real lobby-type id
# game navigates online -> JoinLobby -> hijack -> CreateLobby(2,2) -> hosted
cat "$GD/nobd_arcade.result"                                        # owned lobby + join link
```

---

## 5.13 Closing the session-wire (host_via_join stage 2)

**Live result:** `host_via_join` fired end-to-end (`[hijack] INTERCEPTED` → `[CL]
CreateLobby FIRED (2,2)` → SteamAPICall_t) but the game never ENTERED the created lobby
(`coord+0x340`/`in_session` stayed 0). Root cause: the game's Search-Lobby join flow
registered a **CCallResult expecting `LobbyEnter_t` (id 504)**; CreateLobby returns
**`LobbyCreated_t` (id 513)** — type mismatch, so the created lobby is never wired into the
session. The box owns an orphan Steam lobby it never entered.

Key fact (game team): **CreateLobby auto-joins the creator at the Steam level** — the box
IS already a member of its created lobby; only the GAME's session bookkeeping is missing.
So the cleanest fix is a **chain: CreateLobby → self-join the created lobby via the game's
NORMAL join path** (self-join == host since we own it), which runs all the game's own
session setup correctly.

The synchronous form ("return the *join* handle, not the *create* handle") needs the
created lobby id **inside** the hijack — i.e. `GetAPICallResult(LobbyCreated_t)` off the
CreateLobby `SteamAPICall_t`, which needs **ISteamUtils** (and `GetSteamID` needs
**ISteamUser**). This build ships the enablers + a self-join test:

1. **`dump_singleton`** — resolve the Steam interface singleton and dump its pointer table
   (`matchmaking=+0x20`), each with its vtable `base+0x…`:
   ```bash
   printf 'dump_singleton 48' > "$GD/nobd_arcade.cmd"; grep '\[si\]' "$GD/nobd_arcade.log"
   ```
   Cross-ref the vtbl offsets in Ghidra to identify **ISteamUtils** (+ its `GetAPICallResult`
   vtable slot) and **ISteamUser** (+ `GetSteamID`). Send me those offsets/slots and I wire
   the synchronous chain (capture created id → return `JoinLobby(createdId)` handle so the
   game's CCallResult gets a real `LobbyEnter_t`).
2. **`selfjoin <hexLobbyID>`** — the route-(2a) test you can run *now* if you capture the
   created id (from the trace or GetAPICallResult): calls the **real** JoinLobby(createdId)
   (hook bypassed) and runs the 8s progression poll. If self-joining our own lobby wires the
   session (in_session→1, owner==us), that's the fix.
3. **`wire_lobby <hexLobbyID> [hexOwnerID]`** — the route-(b) fallback: directly writes the
   created lobby id + owner + `owner_flag=1`/`in_lobby=1` into the coordinator, then
   `read_lobby`. Fastest to try; if the game's session/render honor it, done.

The hijack now logs the CreateLobby `SteamAPICall_t` prominently (`[hijack] created-call
handle=0x…`) so you can pair it with `GetAPICallResult` once ISteamUtils is known. **Success
bar:** `read_lobby` shows `owner_flag=1`, `owner==our SteamID`, `lobby==createdId`,
`in_session=1` — and the box is NOT joined to the target lobby.

### Confirmed interface layout + the capture chain

`dump_singleton` confirmed the CSteamAPIContext layout: `ISteamUser = *(singleton+0x08)`,
`ISteamUtils = *(singleton+0x18)`, `ISteamMatchmaking = *(singleton+0x20)` (resolved at
runtime — never hardcode the singleton address). The vtable **slot indices** for
`ISteamUtils::GetAPICallResult` / `IsAPICallCompleted` and `ISteamUser::GetSteamID` are
version-specific and **must come from Ghidra** (a wrong slot crashes the game), so they are
**runtime-set** and default to unset (the chain is inert until then):

```bash
GD="<gamedir>"
# after a Ghidra pass gives the slot indices, e.g. GetAPICallResult=9, GetSteamID=2:
printf 'set_slots 9 2 8' > "$GD/nobd_arcade.cmd"        # <GetAPICallResult> <GetSteamID> [IsAPICallCompleted]
printf 'getsteamid' > "$GD/nobd_arcade.cmd"; sleep 0.2; cat "$GD/nobd_arcade.result"   # marshaled -> main thread; expect buf_form==our id, "thread":"main"
# host_via_join, send a join, then:
printf 'capture_created' > "$GD/nobd_arcade.cmd"; sleep 0.2; cat "$GD/nobd_arcade.result"   # {createdId, owner, "thread":"main"}
# then close the wire:
printf 'selfjoin 0x<createdId>'                 > "$GD/nobd_arcade.cmd"          # route (2a)
#   or: wire_lobby 0x<createdId> 0x<owner>                                        # route (b)
cat "$GD/nobd_arcade.result"                                                     # read_lobby -> owner_flag=1?
```

`capture_created` reads the **packed 12-byte `LobbyCreated_t`** (`eResult`@0,
`m_ulSteamIDLobby`@**4**) off the hijack's `SteamAPICall_t`, checks `eResult==k_EResultOK`,
and pairs it with `GetSteamID`. All Steam vtable calls are bounds-checked (slot within the
vtable's readable range) and crash-guarded. `getsteamid` alone is a safe way to sanity-check
the `GetSteamID` slot before trusting the riskier `GetAPICallResult` one.

> **`GetSteamID` ABI = struct-return-by-pointer.** Win x64 returns the `CSteamID` via a
> hidden buffer: `void GetSteamID(CSteamID* pRet /*RCX*/, ISteamUser* this /*RDX*/)`, not in
> RAX. `getsteamid` reports **both** `buf_form` (correct — hidden buffer) and `rax_form`
> (legacy) so you can confirm which matches the real id; `capture_created` uses `buf_form`.
> (`GetAPICallResult`/`IsAPICallCompleted` are normal — args in registers, bool in RAX.)

> **Steam calls run on the game MAIN THREAD** (the Proton steamclient bridge is
> main/callback-thread bound; an off-thread call returns 0). So `getsteamid`/`capture_created`
> **marshal** onto the main thread via the `FUN_140054100` hook and re-write the result there.
> **But a Steam vtable call from inside that hook re-enters the steamclient callback context
> and CRASHES** (a memory-write task like `nav_online` is fine; a Steam-call task is not).
> So those two are **deprioritized** — use the memory route (`find_lobbyids`/`capture_mem`)
> for the created lobby id, and get the owner id from `read_lobby`'s `owner` field (already
> works). Every marshaled task now runs under a **main-thread crash-guard**: any fault is
> caught, written as an error result, and the hook disarmed — **the game is never killed**
> by a failed/experimental call.

### Created-lobby-id capture — Option A: the `LobbyCreated_t` callback (safe)

The memory routes were dead ends (`find_lobbyids` reads a static 48-entry table;
`capture_mem`/`coord+0x340` only ever hold the join *target*). The correct capture is the
**`LobbyCreated_t` (id 513)** callback: when CreateLobby completes, Steam dispatches it
inside the game's normal `SteamAPI_RunCallbacks` — **Steam's own thread, no injected
re-entrancy** (this is why a Steam *call* from our hook crashes but Steam *calling us* is
safe). We register a listener with `SteamAPI_RegisterCallback` (`*(base+0x8db8a8)`, the same
mechanism the game uses for id-333); our `Run(pParam)` reads `LobbyCreated_t`
(`VALVE_CALLBACK_PACK_LARGE` / `pack(8)`, sizeof 16: `eResult@0`, pad,
`m_ulSteamIDLobby`**@8**) and stashes the id. (Live-validated: the id is at offset 8, not
the packed-4 the ManualDispatch path uses.)

`host_via_join` auto-registers the listener. Flow:
```bash
GD="<gamedir>"
printf 'host_via_join' > "$GD/nobd_arcade.cmd"     # arms hijack + registers LobbyCreated listener
# send steam://joinlobby/2634890/<id>/<owner>  (or nav_online)
grep -E '\[hijack\]|\[lc\]|CreateLobby FIRED' "$GD/nobd_arcade.log"   # [lc] LobbyCreated_t lobby=0x...
printf 'read_created' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"   # {createdId}
```
The `[lc]` line + `read_created` give the **createdId** (Steam-truthful, matched to our
create). Then `selfjoin 0x<createdId>` (self-join our own lobby → real `LobbyEnter_t` → host)
or `wire_lobby 0x<createdId> 0x<ourOwnerId>`. The owner id comes from `read_lobby`'s `owner`.

Every marshaled Steam interaction (the registration itself) runs under the main-thread
crash-guard, so even a bad register can't kill the game.

### The session wire — route A (`wire_a`)

A standalone `selfjoin(createdId)` can never host: it joins at the Steam level but the game
wires a lobby into its session only through **its own join call's CCallResult** (which
processes `LobbyEnter_t`). Our injected JoinLobby has no game-side CCallResult, so the
LobbyEnter is unhandled and `coord` stays on the resolved target. **Route A** fixes this by
transforming the result the game's own CCallResult receives:

- The hijack returns `hCreate` (the CreateLobby `SteamAPICall_t`) to the game's join
  CCallResult (as now).
- `wire_a` hooks **`ISteamUtils::GetAPICallResult`** (the `set_slots` GetAPICallResult
  index). When the game fetches the result for `hCreate`, the thunk fetches the real
  `LobbyCreated_t` to learn `createdId`, then **overwrites the caller's buffer with a
  synthetic `LobbyEnter_t{ m_ulSteamIDLobby=createdId, m_rgfChatPermissions=0xFFFFFFFF,
  m_bLocked=0, m_EChatRoomEnterResponse=1 }`** and returns success. The game's CCallResult
  then wires **our** created lobby → hosts. It runs on Steam's own dispatch thread (no
  re-entrancy), and only calls the same `GetAPICallResult` the game was already calling.

```bash
GD="<gamedir>"
printf 'set_slots 13 2 11' > "$GD/nobd_arcade.cmd"    # GetAPICallResult idx=13 (from Ghidra)
printf 'host_via_join'     > "$GD/nobd_arcade.cmd"    # auto-arms wire_a + the LobbyCreated listener
# send the join, then:
grep -E '\[hijack\]|\[lc\]|\[wireA\]' "$GD/nobd_arcade.log"
printf 'read_lobby' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"   # owner_flag=1? in_session=1?
```

**Route A (vtable) did NOT fire under Proton** (`[wireA]` never logged): the game fetches
call results via the **flat** steam_api64 export, not the ISteamUtils vtable. Kept as a
diagnostic. Route A' below hooks the flat export instead — the corrected, proven approach.

### The session wire — route A' (`wire_a2`, PRIMARY)

**Host election is by Steam lobby ownership, every frame, on BOTH paths** (decrypted-dump
RE): `FUN_14013af30` does `GetLobbyOwner(lobby)==local user ⇒ record[+5]=1 ⇒ coord+0x3c0
(host)=1` — no create-vs-join branch. So if the game just *enters* the lobby we created
(and own), the per-frame commit makes us host. No OwnerId spoof needed.

Route A' delivers that entry: JMP-detour the **flat** `SteamAPI_ISteamUtils_GetAPICallResult`
in steam_api64.dll (a clean, non-anti-tamper'd module — `GetModuleHandleW` +
`GetProcAddress`). When the game's join CCallResult fetches the result for `hCreate`, the
detour substitutes a synthetic `LobbyEnter_t{ m_ulSteamIDLobby=createdId,
m_rgfChatPermissions=0xFFFFFFFF, m_bLocked=0, m_EChatRoomEnterResponse=1 }` (pack(8),
clamped to `cubCallback`), sets `*pbFailed=false`, returns true, one-shot. Non-matching
calls pass through to the real vtable impl (`self->vtable[slot]`) — so nothing else breaks,
and no trampoline is needed. Routing is by `hSteamAPICall`, so no 513→504 rewrite is needed.

```bash
GD="<gamedir>"
printf 'set_slots 13 2 11' > "$GD/nobd_arcade.cmd"    # GetAPICallResult idx=13 (for pass-through)
printf 'host_via_join'     > "$GD/nobd_arcade.cmd"    # auto-arms A' + hijack + LobbyCreated listener
# send steam://joinlobby/2634890/<id>/<owner>
grep -E '\[hijack\]|\[lc\]|\[wireA2\]' "$GD/nobd_arcade.log"
printf 'read_lobby' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"
```

The 3 live-confirms appear in the `[hijack] t=+…` progression: **`HOST(+0x3c0)` flips to 1**,
`lobby_id==createdId` + `in_session`, and `myrec(+0x13fb0)` populates.

**Route A' (flat ISteamUtils) did NOT fire under Proton** — the game fetches results via
**ManualDispatch**, not the flat interface export. Route A3 below hooks the one Proton uses.

### The session wire — route A3 (`wire_a3`, PROTON PRIMARY)

Proton pumps callbacks via ManualDispatch, so the CCallResult result-fetch is
`SteamAPI_ManualDispatch_GetAPICallResult(HSteamPipe, SteamAPICall_t hSteamAPICall, void*
pCallback, int cub, int iCbExpected, bool* pbFailed)` — note `hSteamAPICall` is the **2nd**
arg. Route A3 JMP-detours that export and, when it's called for `hCreate`, substitutes the
synthetic `LobbyEnter_t{ lobby=createdId, perms=0xFFFFFFFF, locked=0, response=1 }` (pack(8),
clamped to `cub`), `*pbFailed=false`, returns true — one-shot. **Pass-through** (all other
calls) is done by **unpatch → call original → repatch**: ManualDispatch pumps on a single
thread, so there's no concurrent execution of the patched bytes and thus no need for a
trampoline/length-disassembler. It also logs `Init`/`RunFrame`/`GetNextCallback` presence to
confirm ManualDispatch is the active path.

```bash
GD="<gamedir>"
printf 'host_via_join' > "$GD/nobd_arcade.cmd"    # auto-arms A3 (+ A' if set_slots) + hijack + listener
# send steam://joinlobby/2634890/<id>/<owner>
grep -E '\[hijack\]|\[lc\]|\[wireA3\]' "$GD/nobd_arcade.log"
printf 'read_lobby' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"
```

`[wireA3] SUBSTITUTED LobbyEnter_t…` then `HOST(+0x3c0)=1` / `lobby_id==createdId` /
`in_session` = the box hosts on the first attempt. If the export name differs, `[wireA3]`
logs the `GetAPICallResult` export candidates.

**None of the GetAPICallResult hooks (A/A'/A3) fired** — the game receives the join result
via an internal path. The RE agent pinned the game's actual delegate; route "deleg" below
hooks it directly.

### THE session wire — the join-result delegate (`wire_deleg`, DEFINITIVE)

The game's join CCallResult delegate is at `base+0x1389e0` (its `m_Func`, bound for this
specific join, `m_iCallback=504`=LobbyEnter — fires only for us, no handle check). Called
`(rcx=coord, rdx=pParam[LobbyEnter_t], r8b=bIOFailure)`, its **only** effects are two writes:
`coord+0x19771=bIOFailure`, and if `pParam+0x10`(m_EChatRoomEnterResponse)`==1` then
`coord+0x19774=1`(success) else `=2`(=our "could not join"). It reads **only** `pParam+0x10`
— **not** the lobby id; the game then enters whatever is in `coord+0x340`.

So `wire_deleg` JMP-detours it and **fully replaces** it (a normal C function entered via
JMP, returns via the caller's retaddr — no trampoline since the delegate's whole behavior is
the two writes):
```
coord+0x19771 = 0            ; bIOFailure = false
coord+0x19774 = 1            ; join status = SUCCESS
coord+0x340   = createdId    ; *** THE CRUX: enter OUR created lobby, not the target ***
return                       ; skip the original delegate
```
`createdId` comes from the `[lc]` LobbyCreated listener. Setting `coord+0x340=createdId` is
the crux — otherwise `+0x340` holds the join *target* and we'd wire someone else's lobby as a
member. With it, `GetLobbyOwner(createdId)==us` → per-frame `FUN_14013af30` sets
`coord+0x3c0=1` = **HOST**.

```bash
GD="<gamedir>"
printf 'host_via_join' > "$GD/nobd_arcade.cmd"    # auto-arms the delegate + hijack + [lc] listener
# send steam://joinlobby/2634890/<id>/<owner>
grep -E '\[hijack\]|\[lc\]|\[deleg\]' "$GD/nobd_arcade.log"
printf 'read_lobby' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"
```
Success bar: `[lc] wired coord+0x340=createdId`, then `HOST(+0x3c0)=1` /
`lobby_id==createdId` / `in_session`, `read_lobby` owner_flag=1, box hosts on the FIRST
attempt. If the session doesn't fully complete, the belt+suspenders is `SetLobbyData`
(OwnerId + Slot*/BinaryData) on `createdId` so the OwnerId parser doesn't reject it — but
host is `GetLobbyOwner`-gated, so try without first.

#### Timing-race fix — who writes `coord+0x340` (ordering-safe)

**Live result:** the delegate FIRED and did its two status writes, but `read_lobby` showed
the box wired to the *join target*, not our created lobby. Trace:
`[deleg] FIRED coord=0x26366400 bIOFailure=1 createdId=0x0 → coord+0x340=0x18600007121225c`
**then** `[lc] LobbyCreated_t eResult=1 lobby=0x1860000712240a4`. Root cause: **the delegate
fires BEFORE the `[lc]` listener in the same `RunCallbacks` pass**, so `createdId` was still
`0` inside the delegate. The old delegate then fell back to reading `pParam` — but under
`bIOFailure=1` `pParam` is the failed *join target*, so it wrote the wrong lobby to
`+0x340` → `GetLobbyOwner(target)` = the other account → **not host**.

The fix **moves the `coord+0x340` write out of the delegate and into the `[lc]` listener**,
which is the one place that has the truthful `createdId`, and makes the two order-independent:

- **`delegate_detour`** now writes **only** the two status bytes (`+0x19771=0`,
  `+0x19774=1`), **stashes `coord`(rcx) to a global** (`g_deleg_coord`) so `[lc]` knows which
  coordinator to wire, and **drops the `pParam` fallback entirely** (it is the join target,
  never our lobby). It writes `+0x340` only if `createdId` is *already* captured (the
  `[lc]`-fired-first ordering).
- **`cb_lc_run` (`[lc]`)** — after capturing `createdId` — writes `*(coord+0x340)=createdId`
  and `+0x19774=1`, using the stashed `g_deleg_coord` (falling back to `*(base+0x2eb36a0)`).
- **Per-frame re-assert** in `hijack_poll_tick`: while we have `createdId` but the machine is
  not yet ACTIVE (`gate==0`) and `+0x340` has drifted off `createdId`, it re-writes
  `+0x340=createdId` (+ status). Stops once `in_session`, so it never fights live state.

Whichever of `[deleg]`/`[lc]` runs first, `coord+0x340` ends up = `createdId`. New success
line: **`[lc] wired coord+0x340=createdId 0x… (coord=0x…)`** (or the delegate's own write if
`[lc]` beat it), then `HOST(+0x3c0)=1`.

#### The last caveat — stamp the host lobby-data (`[lcdata]`, `SetLobbyData`)

**Live result (timing fix in):** `coord+0x340` is now correctly `createdId`, but the game
**cleared it back to 0 and aborted** — `[hijack] re-assert coord+0x340=createdId (was 0x0)`,
final `owner_flag=0 in_session=0 myrec(+0x13fb0)=0x0`. Root cause (a205 RE): the join
processor `sub_14013b880 → FUN_1401391e0` parses `createdId`'s lobby-data keys
(`OwnerId` / `SlotPublicMax` / `SlotPublicOpen` / `SlotPrivateMax` / `SlotPrivateOpen` /
`SearchKeyNum` / `SearchKey_%d` / `BinarySize` / `BinaryData`). We create the lobby but never
`SetLobbyData` on it, so those keys are **empty** → `FUN_1401391e0` returns 0 (reject) →
`sub_14013b880` aborts before enumerating members (`myrec=0x0`) → host-election has nothing to
commit → `+0x3c0=0`. This is the predicted OwnerId parse-reject.

The fix stamps those keys on the created lobby **in the `[lc]` listener, right after
`LobbyCreated_t` and before the game's op-pump reads `createdId`** (so `GetLobbyData` sees them
immediately — `SetLobbyData` is a synchronous local-cache write):

- Resolve `matchmaking = *(SteamInternal_ContextInit(&PTR_140a34d90)+0x20)` (the same iface the
  hijack's CreateLobby used) via the main-thread raw resolver, then call **`SetLobbyData`
  (matchmaking vtable **+0x108**)** for each key:
  `OwnerId`=`%016llX` of our SteamID, `SlotPublicMax`=`2`, `SlotPublicOpen`=`1`,
  `SlotPrivateMax`=`0`, `SlotPrivateOpen`=`0`, `SearchKeyNum`=`0`, `BinarySize`=`128`,
  `BinaryData`=128 zero bytes.
- `OwnerId` = **`GetLobbyOwner(createdId)`** (matchmaking vtable **+0x118**, returns us since we
  own it) when it yields an individual SteamID, else the box id `76561198654690714`.
- The `[lc]` listener runs on the **main thread inside Steam's own dispatch** — the safe context
  for a Steam *call* (unlike our per-frame hook, which re-enters steamclient and crashes). The
  calls are additionally wrapped in a **dedicated crash-guard** (`g_lc_jmp` / `[GUARD-LC]`),
  since `cb_lc_run` is not covered by `on_mt_call`'s setjmp — so a bad slot/ABI can never kill
  the game.

New log lines: `[lcdata] GetLobbyOwner(createdId)=0x… -> OwnerId=0x…` then
`[lcdata] SetLobbyData lobby=0x… OwnerId=… ok=1 slots=1111 searchnum=1 binsz=1 bindata=…`.
**Full success bar now:** `[lcdata] SetLobbyData … ok=1` → `[lc] wired coord+0x340=createdId`
→ `[hijack] … HOST(+0x3c0)=1 lobby_id==createdId in_session=1 myrec≠0`, and `read_lobby`
`owner_flag=1`. If `BinaryData` zeros are rejected (empty via the C-string API — `SetLobbyData`
stores up to the first null), the fallback is to capture a real-create 128-byte blob and stamp
that instead (the `[lcdata]` line reports each key's `SetLobbyData` return so a reject is
visible). If the keys land but the game still aborts, the parser wants them set *before*
`LobbyCreated` returns to the game — marshal the stamp one op-pump earlier.

### The session wire — route B (`wire_b`, PRIMARY)

Route B uses the game's OWN wiring, which is proven to work (the user's manual retry entered
the session fine). After `[lc]` gives `createdId`, we **re-drive a fresh join to our own
lobby** through the game's id-333 `GameLobbyJoinRequested` handler `FUN_14012f8f0`, called on
the **main thread** with `{ m_steamIDLobby=createdId, m_steamIDFriend=ourId }`. The game then
runs a fully-wired join (real `LobbyEnter_t` via its own CCallResult) to a lobby we already
own+auto-joined → the session stands up → **hosts**. This literally automates the user's
retry, targeting `createdId` instead of the (unreachable) target. The hijack has auto-disarmed
by then, so the re-driven `JoinLobby(createdId)` runs for real (not re-hijacked). It fires
~1.5 s after the create (once the failed first join has settled) and runs under the
main-thread crash-guard.

```bash
GD="<gamedir>"
printf 'host_via_join' > "$GD/nobd_arcade.cmd"    # auto: hijack + LobbyCreated listener + wire_b
# send steam://joinlobby/2634890/<id>/<owner>  (or nav_online)
grep -E '\[hijack\]|\[lc\]|\[wireB\]' "$GD/nobd_arcade.log"
printf 'read_lobby' > "$GD/nobd_arcade.cmd"; cat "$GD/nobd_arcade.result"   # owner_flag=1? in_session=1?
```

The `[wireB] FUN_14012f8f0(coord=…, {lobby=createdId, friend=…})` line marks the re-drive.
If `read_lobby` then shows `owner_flag=1`/`in_session=1`/`lobby==createdId` and the user's
screen enters the lobby, the box hosts on the first attempt. If it no-ops (the id-333 handler
behaves differently from inside online than the raw `nav_online` field write did), the
fallbacks are route A' (JMP-detour the flat/internal `Steam_GetAPICallResult`) or hooking the
CCallResult dispatch directly — but B is the natural, game-native path. `set_ourid` overrides
the friend id if needed.

**Next (once slots confirmed):** I fold this into `host_via_join` so the thunk captures
`createdId` synchronously and returns `JoinLobby(createdId)`'s handle to the game's own join
CCallResult — a genuine `LobbyEnter_t` for our own lobby, the truthful one-shot host.

---

## 5.14 Unpack the decrypted image for Ghidra — `dump_file`

The bytes Ghidra couldn't read on disk are just the anti-tamper's **on-disk encryption**;
at runtime they're decrypted and readable (live prologues at `0x14013a320`/`0x14013b880`
are clean x86-64). Since the injector is in-process, `dump_file` copies the decrypted
region straight to a file for offline analysis — the clean path to a real create-factory
call form instead of a crashy guess.

```bash
GD="<gamedir>"
# dump the decrypted .text (absolute addr = 0x140000000 + rva); ~11MB is fine:
printf 'dump_file 0x140001000 0xB00000 text_dump.bin' > "$GD/nobd_arcade.cmd"
cat "$GD/nobd_arcade.result"        # {written, holes, path}
# then on the box: scp the file and load into Ghidra at the matching base.
```

- Writes **raw binary** (exact bytes, no encoding). Reads page-safe in 1 MB chunks —
  unreadable pages are zero-filled and their offsets logged (`[dumpf] hole +0x…`), so a
  few unmapped holes don't abort the dump; the whole loop is crash-guarded.
- **Path handling:** a bare basename (`text_dump.bin`) lands in the injector/game dir
  (simplest to `scp`); a Linux-abs path (`/tmp/x.bin`) maps to Wine's `Z:\…`; a full
  Windows path is used as-is. Forward slashes are converted. (A bare basename avoids any
  spaces-in-path issues from the game-dir name.)
- Size cap 128 MB; absolute or `base+rva` addresses both fine.

Load the dump into Ghidra at the region's base (`0x140001000` for the example) to read the
decrypted create-factory / CCallResult code, then send me the real signatures and I wire
the create + session-wire from ground truth.

---

## 5.15 The create-poster (`cap26` / `call26`) — SUPERSEDED by §5.16

> **Superseded:** `call26` calls only **STATE 1** of a 5-state, async-gated, framework-driven
> create sequence — it posts the create but the netplay bring-up (states 2–5) never runs, so it
> ends in "communication error". Hand-calling states 2–5 is unreliable (state 2 blocks on an
> async gate across frames). The clean fix is **§5.16 `press_create`** — set the one flag the
> Enter key sets and let the framework run all 5 states itself. `cap26`/`call26` are kept for
> reference (arg capture + state-1 probing).

**The join-hijack is a dead end and is abandoned.** Live-proven: feeding the game a synthetic
`LobbyEnter` (routes A/A'/A3/deleg + `SetLobbyData`) makes it a **joiner of its own lobby** →
"session no longer available", `myrec=0`, `HOST=0`. The join path structurally stands up a
*joiner* netplay session; **hosting needs the *create* path.** The hijack/delegate/wire
commands remain in the binary but nothing arms them at startup — the create-poster path below
is clean and independent.

**The right lever:** call the game's OWN create-action poster directly (the function the Create
button ultimately calls):

```
FUN_14026a880(manager, HOST_MATCH_ID, HOST_MODE, 0, 0)   @ base+0x26a880  (__fastcall)
manager = *(u64*)(base+0x2ebccb8)
```

It posts a create request → the game's **worker thread runs the FULL real create-and-host**
(`CreateLobby → SetLobbyData → SetLobbyJoinable → host handshake FUN_14013af30`) → a **real
HOST netplay session**, exactly what a manual Create produces. This is the create flow, so it
sidesteps the joiner wall entirely. (Distinct from the dead-end low-level `FUN_14015b150`
poke — `26a880` is the higher menu-action poster. `FUN_14026acd0(mgr, 7)` = leave, via
`leave`.)

Two commands (both gate on the decrypted `0x48` prologue):

1. **`cap26`** — JMP-detour `FUN_14026a880`; on the next manual Create it logs the 4 args
   distinctly then tails to the original (self-restoring one-shot):
   `[cap26] FUN_14026a880 rcx=0x…(manager) rdx=0x…(HOST_MATCH_ID) r8=0x…(HOST_MODE) r9=0x…`.
   (Same detour as `capture`; the args are also cached as `matchId`/`mode` in `.ready`.)
2. **`call26 <hexArg1> <hexArg2> [main]`** — call
   `FUN_14026a880(*(base+0x2ebccb8), arg1, arg2, 0, 0)` (RCX=manager, RDX=arg1, R8=arg2,
   R9=0, + one `0` stack arg for the 5th param). Guards `manager!=0` and no active session,
   logs **PRE/POST** `manager`/`coord`/`in_lobby`, then `wait_and_report` (up to ~12 s for a
   fresh `coord+0x340`). Runs on the command thread first, **crash-guarded**; on a fault (or
   with the `main` suffix) it marshals the call to the **game main thread** (the same
   `FUN_140054100` dispatcher the Steam tasks use) and returns immediately (read `read_lobby`
   ~1 s later).

```bash
GD="<gamedir>"
# 1) capture the real args from ONE manual Create (do it at the Custom Match menu):
printf 'cap26' > "$GD/nobd_arcade.cmd"
#    ... click Create once ...  -> grep the args:
grep -a '\[cap26\]' "$GD/nobd_arcade.log" | tail -2      # rdx=HOST_MATCH_ID, r8=HOST_MODE
# 2) replay them hands-free (leave the lobby first if the capture made one):
printf 'call26 <HOST_MATCH_ID_hex> <HOST_MODE_hex>' > "$GD/nobd_arcade.cmd"
cat "$GD/nobd_arcade.result"                             # {lobby, companion}  (or PRE/POST in log)
printf 'read_lobby' > "$GD/nobd_arcade.cmd"; sleep 1; cat "$GD/nobd_arcade.result"
```

**Success bar:** `[call26] PRE … -> FUN_14026a880(…)` → `[call26] POST … in_lobby=1` →
`read_lobby` shows `owner_flag=1` + a joinable `lobby_id`, and **NO** "session no longer
available". *In practice call26 stops at state 1 ("communication error") — use `press_create`
(§5.16) instead.*

---

## 5.16 THE host path — memory-level Create (`press_create`)

**Why call26 fails (RE):** `FUN_14026a880` is only **state 1** of a 5-state, async-gated,
framework-driven create sequence. The create-menu-action object's `Update()` =
**`FUN_140066f00`** (a 10-state machine, jump table `0x140067234`) drives states 1→5 itself:
state 1 posts the create; states 2–5 do the netplay bring-up — async gate
`FUN_14006cf20()==4`, session activate (`sess->vt[0xb0]`), transport cfg
(`t+0x3f4=0x10000`/`t+0x404=8`), descriptor register `FUN_14034c120`, host-start
`FUN_14026ba90(manager, 7, action, &cb)`, then `obj+0x390=0x14` / `obj+0x394=3`. `call26` runs
state 1 only → "communication error", and hand-calling states 2–5 is unreliable (state 2 blocks
on the async gate across frames + is framework-coupled).

**The clean fix — the Enter key only sets ONE flag.** The input handler (at `0x14006522c`) does
`action+0x1184 = 1`; the framework's per-frame `FUN_140066f00` then runs the FULL state machine
(1→5) — the complete real create + netplay, using the live create-screen config. So we set that
one flag on the live create-action object and the game does everything else.

**`press_create`** does exactly that:

1. **Capture the live object:** JMP-hook `FUN_140066f00` (`base+0x66f00`) via the generic probe;
   on fire (the Update runs = user is on the Create screen) it stashes `this` (rcx) —
   validated as readable with an in-module vtable — to `g_pc_obj`, then self-restores
   (`[press_create] captured create-action obj=0x… vt=base+0x…`). The hook is **disarmed before
   the press** so the framework runs `FUN_140066f00` unimpeded.
2. **Press:** if `*(u32*)(obj+0x1184)==0` (idle, not mid-sequence) → write `=1`. If it's non-zero
   (sequence already running) or the object wasn't captured, it **does not write** and logs why.
3. **Confirm:** logs `obj`, `+0x1184` before/after, then polls ~8 s — snapshotting
   `obj+0x390`/`obj+0x394` (reach `0x14`/`3` at state 4/5) and `coord+0x340` — and finishes with
   `read_lobby`. All memory-only (a `poke32` + reads); the hook and write are crash-guarded.

```bash
GD="<gamedir>"
# user is ON the Create-Lobby screen (object live + config populated), then:
printf 'press_create' > "$GD/nobd_arcade.cmd"
grep -aE '\[press_create\]|\[lobby\]' "$GD/nobd_arcade.log" | tail -30
cat "$GD/nobd_arcade.result"                 # read_lobby JSON (owner_flag / lobby_id / in_lobby)
```

**Success bar:** `[press_create] PRESSED obj+0x1184: 0 -> 1` → `+0x390=0x14 +0x394=0x3` →
`read_lobby` `owner_flag=1` + a joinable `lobby_id`, **NO** "communication error". This is "fire
the Create button at the memory level" — the one flag the keypress sets, then the game's own
framework does the rest (async gate + netplay bring-up included). Precondition: the user must be
on the Create-Lobby screen; if `FUN_140066f00` never ran the command reports
`no_create_action_object`.

---

## 6. Trigger contract (the interface MetaSync uses)

The interface is a **tiny file protocol** in the game directory (a real Linux path —
MetaSync reads/writes these files directly; under Proton the DLL sees the same
directory as its module dir). All files are swappable/plain-text; the DLL is the only
writer of `.result`/`.ready`/`.log`, MetaSync is the only writer of `.cmd`.

| File | Writer | Meaning |
|---|---|---|
| `nobd_arcade.cmd` | MetaSync | one command token: `press_create` \| `create` \| `call26 <a1> <a2>` \| `cap26` \| `leave` \| `capture`. Consumed (deleted) by the injector within ≤250 ms. |
| `nobd_arcade.result` | injector | JSON result of the last command. |
| `nobd_arcade.ready` | injector | heartbeat (~1 Hz): manager/coord/session/capture status + current lobby id. |
| `nobd_arcade_capture.txt` | injector | persisted host params (`matchId`/`mode`), append-only history. |
| `nobd_arcade.log` | injector | lifecycle + debug + every game-call outcome. |

**Commands**
- `create` → **capture-and-replay**: guards (`manager!=0` **and** gate `+0x13fc0 == 0`),
  requires a prior capture, then calls `FUN_14026a880(manager, cachedMatchId,
  cachedMode, 0, 0)` and waits up to ~12 s for a fresh lobby id at `coord+0x340`.
  Returns `no_capture_yet` if no manual create has been observed.
- `leave` → `FUN_14026acd0(manager, 7)` (teardown / lobby recycle).
- **`press_create`** → **THE host path** (§5.16): capture the live create-action object by
  JMP-hooking `FUN_140066f00`, then set `obj+0x1184=1` (the one flag the Enter key sets) so the
  framework's per-frame state machine runs the full create + netplay itself. Memory-only,
  crash-guarded; user must be on the Create-Lobby screen. Polls ~8 s + `read_lobby`.
- **`cap26`** → **create-poster capture** (§5.15, superseded): JMP-detour `FUN_14026a880`; the next
  manual Create logs `[cap26] … rdx=HOST_MATCH_ID r8=HOST_MODE …` then tails to the original.
  Same detour as `capture`, one-shot, gated on decrypt.
- **`call26 <hexArg1> <hexArg2> [main]`** → **THE host path** (§5.15): call
  `FUN_14026a880(*(base+0x2ebccb8), arg1, arg2, 0, 0)` — the game's own create-and-host worker
  path (real HOST session, not a joiner). Guards `manager!=0` + no active session, logs
  PRE/POST `manager`/`coord`/`in_lobby`, waits ~12 s for `coord+0x340`. Command thread first
  (crash-guarded); on fault or with the `main` suffix, marshals to the game main thread.
- `capture` → **arm the JMP capture hook NOW** (issue at the menu; gated on decrypt).
  This is the safe *late* arm — never armed automatically. One-shot. (`cap26` is the same
  detour with clearer 4-arg logging.)
- `capture_hw` → **fallback capture via hardware breakpoint** (DR0). Modifies no code,
  so it can't trip a code-integrity check. Use if `capture` still crashes/wedges.
- `create_static` → **experimental** diagnostic: the pure allocate-then-post path
  (`FUN_14006cf10` → `FUN_14026a880`). Known to yield `matchId=0` from the top menu;
  use to probe whether a deeper menu state gives a valid id.
- `probe_cl` / `unprobe_cl` → install/remove the **CreateLobby vtable-hook diagnostic**
  (see §5.1) — confirms the create path + stack-walks to the worker.
- `probe_req` / `unprobe_req` → start/stop the **session-request-array snapshotter**
  (see §5.2) — captures the exact request struct the Custom Match producer writes.
- `probe_arm` / `unprobe_arm` → intercept the **arm primitive `FUN_14026ba90`** and log
  its args + **return address** = the CM-create handler (see §5.3). The decisive probe.
- `probe_notify` / `unprobe_notify` → intercept the notify primitive `FUN_140393190`
  directly (fallback if CM bypasses `FUN_14026ba90`); high-frequency, expect many lines.
- `probe_ctor` / `unprobe_ctor` → intercept the CM session constructor `FUN_14034bd40`
  (see §5.4). (Did not fire — the object is persistent, not rebuilt on Create.)
- `watch_cm` / `unwatch_cm` → **in-process state-watch** of the persistent CM object
  (reads only, ~5 ms, logs on change) — captures the Create state-machine transition
  sequence (see §5.5). **The current decisive probe.**
- `poke_cm <hex>` → write `<hex>` to the CM state field `obj+0x170`. Manual/explicit.
- **`create_poke`** → the **replicate**: drive the CM object into its state-6 create
  branch (writes counter=0, timer=1, state=6) so the game's own tick fires CreateLobby.
  Pure memory writes; the create runs on the game thread. Reports the resulting lobby.
- `call_create` → fallback replicate: call the create primitive `FUN_14015b150` directly
  (if the state-6 poke races the object's own writes).
- `read_lobby` / `status` → report the current hosted **lobby id + owner** and a ready-made
  `steam://joinlobby/2634890/<lobby>/<owner>` link.
- `menu_snap <label>` → append a stability-flagged dump of the state-globals + CM object +
  input area to `nobd_arcade.snap`, tagged `<label>` (see §5.7).
- `watch_sm` / `unwatch_sm` → **in-process state-watch of the steamSM wrapper**
  (`*(cm_obj+0x180)`, ~0x800 bytes, ~5 ms, log-on-change) — finds the field the Create
  button sets that makes `vtable[0xa]` fire CreateLobby (see §5.8). **The real trigger.**
- `poke_sm <hexoff> <hexval>` → write a u32 to `steamSM+<off>` — hands-free create test.
- `scan_new [max]` / `scan_delta <±hex>` / `scan_same` / `scan_changed` / `scan_read <addr>`
  → **CE-style value-delta scanner** to pin the menu cursor / screen-id vars while driving
  the game with `ydotool` (see §5.9).
- `find_u32 <hexval> [maxhits]` / `find_u64 <hexval> [maxhits]` → **value search** across
  all committed readable memory (heap + image), reporting hit addr + next dword + in-image
  flag. Finds the live UI screen object by its reflection class-name pointer (see §5.10).
- `dump <hexaddr> <ndwords>` → read a window of u32s (default 96, cap 512) in ONE call as a
  compact hex array (faulting pages marked `--------`). Diff two dumps to pin a field
  offset inside an object (see §5.10).
- `dump_file <hexAddr> <hexSize> <path>` → write the **RAW (runtime-decrypted) bytes** of
  `[addr, addr+size)` to `<path>` on the box (binary, page-safe, chunked 1MB, holes
  zero-filled+logged). Dump the decrypted `.text` and load it into Ghidra (see §5.14).
- `probe_bt <hexoffset> [maxframes]` / `unprobe_bt` → **generic in-process backtrace hook**:
  detour `base+<offset>` and log args + a full in-module `RtlCaptureStackBackTrace` on each
  call (`[bt]` lines), then chain. Re-pointable at any function (see §5.11). Works under
  Wine where gdb hardware breakpoints don't.
- **`host_via_join`** / `unhost_via_join` → **hijack `JoinLobby`→`CreateLobby(2,2)`**: the
  steam://joinlobby flow makes the game stand up the whole online session, then we redirect
  its `JoinLobby` into a hosted create so its own callbacks host us. Staged `[hijack]`
  trace + 8s post-create progression poll + final `read_lobby` (see §5.12). **The host path.**
- **`nav_online <hexLobbyID>`** → pure in-process trigger: writes the pending-join fields on
  the game's main thread so it navigates online + calls `JoinLobby` — no external URL
  needed. Pair with `host_via_join` for zero-input auto-host (see §5.12).
- `dump_singleton [nqwords]` → dump the Steam interface-singleton pointer table (each ptr +
  its vtable `base+0x…`) to find ISteamUtils/ISteamUser for `GetAPICallResult`/`GetSteamID`
  (needed to capture the created lobby id + own SteamID) (see §5.13).
- `selfjoin <hexLobbyID>` → drive the game to JOIN its own created lobby via the REAL
  JoinLobby (we own it ⇒ host); the game's normal LobbyEnter path wires the session (§5.13).
- `wire_lobby <hexLobbyID> [hexOwnerID]` → route-(b) direct session write (coord+0x340/0x348
  + owner/in-lobby flags) then `read_lobby` — test if a direct wire hosts us (§5.13).
- `set_slots <GetAPICallResult_idx> <GetSteamID_idx> [IsAPICallCompleted_idx]` → set the
  version-specific Steam vtable slot indices (from Ghidra). Inert until set (§5.13).
- `getsteamid` / `capture_created` → Steam-call captures (marshaled to the main thread,
  crash-guarded). **Deprioritized** — re-entrancy risk; prefer the memory route below.
- **`register_lc`** → register a `LobbyCreated_t` (id 513) listener via
  `SteamAPI_RegisterCallback`; Steam calls it on **its own dispatch** (main thread, inside
  `RunCallbacks`) — we only READ the param, so it's re-entrancy-safe (§5.13). `host_via_join`
  auto-registers it.
- **`read_created`** → report the created lobby id the `LobbyCreated_t` listener captured.
- **`wire_deleg` [`on`|`off`]** → **THE session wire (DEFINITIVE)**: JMP-detour the game's
  own join-result delegate at `base+0x1389e0` and fully replace it — force join success
  (`coord+0x19774=1`, `+0x19771=0`) and **set `coord+0x340=createdId`** so the per-frame
  host-election `GetLobbyOwner(createdId)==us` makes the box HOST. `host_via_join` auto-arms
  it (§5.13). (The GetAPICallResult hooks A/A'/A3 never fired — the result arrives via an
  internal path — so they're superseded by this.)
- `wire_a2`/`wire_a3`/`wire_b` → superseded GetAPICallResult/id-333 approaches; kept as
  diagnostics.
- `set_ourid <id>` → override our SteamID (`m_steamIDFriend` for the re-drive); default is
  the box id `76561198654690714`.
- `wire_a` [`on`|`off`] → route A (ISteamUtils::GetAPICallResult vtable hook) — **never
  fired under Proton** (the game fetches via steam_api's internal C-bridge, not the vtable);
  kept as a diagnostic.
- `find_lobbyids [maxN]` / `capture_mem` → memory-scan routes (dead end here: `find_lobbyids`
  reads a static 48-entry table; `capture_mem` only holds the join target). Kept as tools.

**Result JSON (examples)**
```json
{"ok":true,"cmd":"create","lobby_id":"109775242...","companion":"...","ts":1690000000}
{"ok":false,"cmd":"create","error":"session_already_active","ts":...}
{"ok":false,"cmd":"create","error":"netplay_not_initialized (manager null ...)","ts":...}
{"ok":false,"cmd":"create","error":"no_capture_yet (do ONE manual create ...)","ts":...}
{"ok":false,"cmd":"create","error":"created_no_lobby_id_timeout (...)","ts":...}
```
`lobby_id` = `coord+0x340` (the Steam lobby CSteamID). The arcade account **is** the
host/owner, so MetaSync already knows `owner` = the arcade account's SteamID (also
`companion` = `coord+0x348` is provided for cross-checking).

**Recommended MetaSync client sequence (avoids stale-result races):**
```bash
GD="<gamedir>"
rm -f "$GD/nobd_arcade.result"                       # clear old result
printf 'create' > "$GD/nobd_arcade.cmd.tmp" && mv -f "$GD/nobd_arcade.cmd.tmp" "$GD/nobd_arcade.cmd"
for i in $(seq 1 60); do                             # poll up to ~15s
  [ -f "$GD/nobd_arcade.result" ] && { cat "$GD/nobd_arcade.result"; break; }
  sleep 0.25
done
```
Write the `.cmd` **atomically** (temp + `mv`) so the poller never reads a half-written
file.

---

## 7. How skinsync / the app invokes it

Today `arcade-host/arcade_host.py` exposes `POST /lobby/create` on the OVH box and
calls Steam's flat API directly — which cannot make the *local game* host. To use
this injector instead, point that HTTP contract at the **file protocol** on the box
that runs the game:

```
MetaSync/skinsync ──HTTP──► small local agent on the Bazzite box
                              writes  <gamedir>/nobd_arcade.cmd = "create"
                              reads   <gamedir>/nobd_arcade.result -> {lobby_id, owner}
                            ◄── returns {ok, lobby_id, owner_steamid}
```

The local agent is trivial (the "recommended client sequence" above, wrapped in the
existing `/lobby/create`→`{ok,lobby_id,owner_steamid}` response shape). Keep the
files as the boundary — the DLL and the agent are independently swappable.
`leave` maps to `/lobby/close` (recycle). The one manual bootstrap (§5) must happen
once per machine before `create` will replay.

---

## 8. Safety / behavior notes

- **Every game-pointer deref is `VirtualQuery`-validated** (committed + readable, region
  covers the read) before use — the common failure mode (bad/uninitialized pointers)
  cannot fault us.
- **Capture hook = self-restoring inline `JMP`** (not int3/VEH): a 14-byte
  `jmp [rip+0]` at `FUN_14026a880` → a small RWX stub that preserves `RAX/RCX/RDX/R8/
  R9/R10/R11`, calls a logger with the game's original `RCX/RDX/R8/R9`, restores the
  original bytes (unhook), and jumps back so the real function runs. Pure code-exec, so
  it fires reliably under Proton (unlike the int3+VEH approach, which did not). It is
  one-shot per arm and re-armed by the idle poll loop; disarmed automatically around our
  own replay call so we never hook ourselves.
- **Packed-image safety (critical):** the EXE `.text` is encrypted until runtime AND
  patching it during the startup window crashes launch even over a valid prologue. So
  the injector **never arms automatically** — arming happens **only on an explicit
  `capture`/`capture_hw` command** (issued *late*, at the online menu), and only over a
  decrypted `0x48` prologue (`EXPECTED_PROLOGUE_BYTE`). The startup poll loop merely
  *observes* and logs the decrypt byte; it patches nothing. Every game-call path
  (`create`/`create_static`/`leave`) is likewise gated with `not_decrypted_yet`.
- **Two capture mechanisms:** `capture` = the JMP detour (reliable-firing, but touches
  code — safe when armed late). `capture_hw` = a **hardware breakpoint** (`DR0`/`DR7`
  set on every game thread via `SetThreadContext`; caught as `EXCEPTION_SINGLE_STEP` in
  the VEH, args read from `RCX/RDX/R8/R9`, then one-shot self-clear + `RF`) — it modifies
  **no code**, so it cannot trip a code-integrity check. HW breakpoints are per-thread;
  we set them on all existing game threads at arm time (the create call is on the
  menu/main thread, already present). **Self-heal:** a JMP patch later found missing
  (packer rewrote the region) drops the hooked flag rather than trusting a stale patch.
- **The game call runs under a VEH crash-guard** (`__builtin_setjmp`/`longjmp`): an
  access violation during `FUN_14026a880`/`FUN_14026acd0` is **logged first**, then we
  attempt to recover to the poll loop (best-effort; if Proton doesn't deliver the AV to
  VEH, the pre-call log line still records the attempt). A fault may wedge netplay
  (restart the game).
- **Guards before create:** refuses if `manager==0` (netplay not up), the coordinator
  gate `+0x13fc0 != 0` (a session is already active), or no capture exists yet.
- Run first on the **throwaway/Bazzite box**, confirm a real `lobby_id` appears, before
  any production use.

---

## 9. Remaining unknowns / caveats

1. **matchId replay validity — the open question.** `mode=2` is confirmed. Replaying the
   *same* captured `matchId` for repeated creates is the thing to verify live: a match
   slot id may be single-use, so after `leave` the game may need a fresh id. If replay
   of the cached id stops producing lobbies, the next step is to re-run `FUN_14006cf10`
   at replay time (from the deeper menu state where it returns non-zero) or to increment
   the id. `create` logs `SESSION_EXISTS(matchId)` before posting so we can see this.
   First goal: prove a single replay creates one lobby.
2. **Top-menu allocator returns 0.** `FUN_14006cf10` from the top-menu state yields
   `matchId=0` (a sentinel), which is why the pure-static path was abandoned in favor of
   capture-and-replay. `create_static` is retained to probe deeper menu states.
3. **Room size = the game's own create-menu "Number of Players" field** (proven on the box
   2026-08-23). It is NOT the Steam `CreateLobby(cMaxMembers)` arg and NOT the `SlotPublicMax`
   lobby-data key — rewriting/poking those leaves the lobby header at "1/2" while only the menu field
   flips it to "1/3"+. The live count sits at **`session0+0x170`** (and the producer's request object
   `s0+0x178[00] + 0xb0`), driven by the create-menu field at **position 7, one row below Victory**
   (range 2..5+). Set it either via the menu (ydotool, exactly like FT/language/one-button in
   `arcade_host.sh set_options`) or by poking `session0+0x170` before the Create press. (An earlier
   injector `set_lobby_max`/CreateLobby-arg/`CM-obj+0xb0` approach was tried and REVERTED — it poked a
   sibling object the create doesn't read.) **FT / passcode / side** are likewise the game's own
   menu / `SetLobbyData` fields (config feeders `FUN_14006a280`/`FUN_14006a450`, or the 128-byte
   `BinaryData` match-settings blob).
4. **Crash-guard `longjmp`** abandons the faulting frames; if the game held a lock, that
   lock leaks (possible deadlock). Process survives + logs; restart if create stops working.

---

## 10. Troubleshooting

- **Game won't start after install** → `versionorig.dll` missing, or the prefix override
  didn't take. `./setup_proxy.sh status` (shows DLLs + `prefix override: SET`). Re-run
  `install` with the game closed. Fast revert: `./setup_proxy.sh uninstall`.
- **`nobd_arcade.log` never appears** → the proxy isn't loading. Confirm
  `./setup_proxy.sh status` shows the override SET, and that `version.dll` in the game dir
  is our proxy (`objdump -p version.dll | grep versionorig`). If the prefix edit was
  clobbered (game was running during install), redo with the game closed, or fall back to
  the `WINEDLLOVERRIDES="version=n,b" %command%` launch option.
- **`create` returns `not_decrypted_yet`** → `FUN_14026a880` is still packed; open the
  online/custom-match menu so the game decrypts `.text`. The log shows the first byte;
  it must reach `0x48`. (The injector will not patch or call into encrypted code.)
- **`create` returns `netplay_not_initialized`** → you're not in the online/custom-match
  menu yet. Check `nobd_arcade.ready` for `"manager":true`.
- **`create` returns `no_capture_yet`** → arm first (§5): at the menu issue `capture`
  (or `capture_hw`), then do ONE manual Custom Match create. Watch `.ready` for
  `"hooked"`/`"hw_armed":true` then `"have_capture":true`.
- **Game crashes when you issue `capture`** → the JMP patch tripped a code-integrity
  check even late. Restart the game and use **`capture_hw`** (hardware breakpoint, no
  code modified) instead. If `capture_hw` never fires (Wine may not deliver `DR0`
  `#DB`), the capture path is blocked on this Proton build — report the log.
- **`create` returns `created_no_lobby_id_timeout`** → the replay post ran but no lobby id
  appeared at `coord+0x340`; likely the cached `matchId` is stale/single-use (see §9.1).
  Re-capture (do a fresh manual create) or try `create_static`.
- **`build.sh` says no forwarders** → your binutils won't emit `.def` forwarders; the
  script auto-falls-back to `dlltool`. If both fail, regenerate the `.def` with
  `gen_def.py <real version.dll>` and rebuild.
