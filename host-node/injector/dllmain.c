/*
 * NOBD ARCADE lobby-injector -- proxy version.dll for MvC2 (Steam FC, appid
 * 2634890) running under Proton. Makes the game create+host a Custom Match
 * lobby ON DEMAND with no menu input, by calling the game's OWN
 * "start host session" entry (FUN_14026a880) from an injected helper thread.
 *
 * Two jobs:
 *   1. CAPTURE (one-time): an int3 + VEH hook on FUN_14026a880 records the
 *      (matchId=RDX, mode=R8) arguments when a human clicks Create once, and
 *      persists them to a capture file. These are the UNKNOWN host params.
 *   2. TRIGGER (repeated): a file-poll loop watches a command file; on
 *      "create" it guards (manager!=0 && coordinator gate==0), calls
 *      FUN_14026a880(manager, matchId, mode, 0, 0), waits for a fresh lobby id
 *      at coord+0x340, and writes the result to a result file.
 *
 * Defensive throughout: every game-pointer deref is VirtualQuery-validated, and
 * the game call runs under a VEH crash-guard (__builtin_setjmp) so a bad state
 * logs before it can hard-crash. No VAC on this appid => in-process exec is
 * acceptable (stability risk only).
 *
 * The proxy half (version.dll export forwarders) lives in version_proxy.def.
 * This file is 100% payload; it never touches version.dll semantics.
 *
 * Build: mingw-w64 (x86_64-w64-mingw32-gcc). See build.sh.
 */

#include <windows.h>
#include <tlhelp32.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include "arcade_offsets.h"

/* ------------------------------------------------------------------ globals */
static HMODULE   g_self;
static uintptr_t g_base;
static volatile LONG g_running = 1;

static wchar_t g_dir[MAX_PATH];
static wchar_t g_log[MAX_PATH];
static wchar_t g_cmd[MAX_PATH];
static wchar_t g_result[MAX_PATH];
static wchar_t g_capture[MAX_PATH];
static wchar_t g_ready[MAX_PATH];
static wchar_t g_snap[MAX_PATH];

/* capture state (real host params observed from the game's own create call) */
static volatile LONG g_have_capture  = 0;
static volatile LONG g_capture_dirty = 0;   /* hook sets; poll loop persists  */
static volatile LONG g_matchId = 0;         /* cached matchId (RDX) to replay */
static volatile LONG g_mode    = 0;         /* cached mode    (R8)  to replay */
static volatile uint64_t g_last_manager = 0;

/* inline JMP-trampoline hook state (reliable under Proton -- no int3/VEH, no
 * relocation: a self-restoring 14-byte JMP detour that logs RCX/RDX/R8/R9 then
 * restores the original bytes and runs the real function). */
#define JMP_PATCH_LEN 14
static void *g_target = 0;                 /* base + OFF_CREATE                */
static BYTE  g_orig14[JMP_PATCH_LEN];      /* saved original bytes             */
static BYTE  g_have_orig = 0;
static volatile LONG g_hooked = 0;         /* JMP detour armed                 */
static void *g_detour = 0;                 /* RWX detour stub buffer           */
static int   g_seen_byte_init = 0;         /* decryption-watch: log byte flips */
static BYTE  g_last_seen_byte = 0;
/* hardware-breakpoint (DR0) fallback -- modifies NO code (no anti-tamper trip) */
static volatile LONG g_hw_armed = 0;
static volatile LONG g_hw_fired = 0;

/* ISteamMatchmaking::CreateLobby vtable-hook DIAGNOSTIC (finds the real Custom
 * Match create-initiator). Pure vtable pointer swap -- no code patched. */
static void   **g_cl_slot = 0;             /* &matchmaking_vtable[CreateLobby]  */
static void    *g_orig_createlobby = 0;    /* saved original CreateLobby fn ptr */
static volatile LONG g_cl_hooked = 0;
typedef USHORT (WINAPI *rtlcapture_fn)(ULONG, ULONG, PVOID *, PULONG);
static rtlcapture_fn g_RtlCapture = 0;

/* Generic CALL-INTERCEPT probe: a self-restoring JMP detour that logs the args
 * (RCX/RDX/R8/R9) AND the caller's RETURN address ([RSP] on entry), then chains
 * to the original. Used to find the CM create-initiator = the ret address into
 * the handler that arms the request. Armed late on command (like the others). */
typedef struct {
    const char   *name;
    uint64_t      off;                 /* base + off = target                  */
    void         *target;
    void         *callback;            /* C logger (set at arm time)           */
    void         *detour;             /* RWX stub                             */
    BYTE          orig[JMP_PATCH_LEN];
    int           have_orig;
    volatile LONG hooked;
    volatile LONG active;              /* keep re-arming while idle            */
} probe_t;
static probe_t g_arm_probe    = { "arm(FUN_14026ba90)",    OFF_ARM_SLOT,   0,0,0,{0},0,0,0 };
static probe_t g_notify_probe = { "notify(FUN_140393190)", OFF_NOTIFY_POST,0,0,0,{0},0,0,0 };
static probe_t g_ctor_probe   = { "ctor(FUN_14034bd40)",   OFF_CM_CTOR,    0,0,0,{0},0,0,0 };
static probe_t g_bt_probe     = { "bt(custom)",            0,              0,0,0,{0},0,0,0 };
/* press_create: JMP-hook FUN_140066f00 (create-action Update) to capture its `this`
 * (rcx) = the live create-action object we set +0x1184=1 on. */
static probe_t g_pc_probe     = { "pc(FUN_140066f00)",     OFF_CREATE_MENU_UPDATE, 0,0,0,{0},0,0,0 };
static volatile uint64_t g_pc_obj = 0;   /* captured create-action object (rcx)      */
static int     g_bt_maxframes = 24;
/* main-thread task dispatcher: a hook on FUN_140054100 (runs on the game MAIN
 * thread) that executes queued tasks -- Steam vtable calls MUST run here (the
 * steamclient bridge is main/callback-thread bound; off-thread calls return 0). */
static probe_t g_mt_probe     = { "mt(FUN_140054100)",    OFF_FRAME_CONSUMER, 0,0,0,{0},0,0,0 };
static volatile LONG g_nav_pending  = 0;   /* MT task: nav pending-join write   */
static volatile LONG g_mt_getid     = 0;   /* MT task: GetSteamID              */
static volatile LONG g_mt_capture   = 0;   /* MT task: capture_created         */
static volatile LONG g_mt_reglc     = 0;   /* MT task: register LobbyCreated cb */
static volatile LONG g_mt_rejoin    = 0;   /* MT task: route-B re-drive join    */
static volatile LONG g_mt_call26    = 0;   /* MT task: call FUN_14026a880 (create poster) */
static uint64_t      g_call26_mgr   = 0;   /* manager captured for the MT call26 */
static int           g_call26_a1    = 0;   /* arg1 = HOST_MATCH_ID               */
static int           g_call26_a2    = 0;   /* arg2 = HOST_MODE                   */
static uint64_t g_nav_lobby = 0;
/* route B: re-drive the join to OUR created lobby via the id-333 handler */
static volatile LONG g_wireB_enabled = 0;
static volatile LONG g_rejoin_fired  = 0;
static uint64_t g_rejoin_lobby = 0;
static uint64_t g_box_id = BOX_STEAMID_DEFAULT;   /* m_steamIDFriend (overridable) */
/* registered LobbyCreated_t listener (Option A) -- Steam calls our Run() on its
 * OWN dispatch (main thread, inside RunCallbacks); we only READ the param, never
 * call into Steam, so it's re-entrancy-safe. CCallbackBase layout: vtable@0,
 * m_nCallbackFlags@8, m_iCallback@0xc. */
static void *g_lc_vtable[3];
static struct { void *vt; uint8_t flags; int iCallback; } g_lc_obj;
static volatile LONG g_lc_registered = 0;
/* MAIN-thread crash-guard (separate from the helper-thread g_jmp): any fault in a
 * main-thread task is caught, logged, turned into an error result + disarm -- the
 * GAME is never allowed to die from an experimental/failed call. */
static intptr_t g_mt_jmp[8];
static volatile LONG g_mt_in_task = 0;
static DWORD g_mt_tid = 0;

/* session-request-array SNAPSHOTTER. Per the Ghidra RE, session0+0x178 is a
 * POINTER array (count @ session0+0x978); the worker FUN_14026dd20 iterates it.
 * So we (a) diff manager+0x60 (ranked inline slots) for the diff-vs-ranked, (b)
 * watch the session0+0x178 pointer slots + count, and (c) FOLLOW each new pointer
 * and dump the request object it points to -- that object is the CM request
 * struct to replicate. (session0 = *(manager+0x250).) */
#define REQ_MGR_LO   0x40ULL
#define REQ_MGR_HI   0x160ULL
#define REQ_S0_LO    0x160ULL           /* context window around +0x178       */
#define REQ_S0_HI    0x1e0ULL
#define REQ_MGR_N    ((int)((REQ_MGR_HI - REQ_MGR_LO) / 8))
#define REQ_S0_N     ((int)((REQ_S0_HI  - REQ_S0_LO)  / 8))
#define REQ_ARRAY_OFF 0x178ULL          /* session0 -> pointer array           */
#define REQ_COUNT_OFF 0x978ULL          /* session0 -> element count (u32)     */
#define REQ_PTR_SLOTS 32                /* scan this many pointer slots        */
#define REQ_OBJ_DUMP  0x140ULL          /* bytes of each request object to dump*/
/* CM notify family (Ghidra): producer fills mgr+0x328 slot (stride 0x20, x16),
 * then FUN_140393190(session0+0x7c0, idx, mgr+0x328+idx*0x20, 1, 0). Watch both
 * the request slots and the notify queue. */
#define REQ_MGR2_LO  0x320ULL           /* CM request slots @ mgr+0x328         */
#define REQ_MGR2_HI  0x530ULL
#define REQ_S0Q_LO   0x7c0ULL           /* CM notify queue @ session0+0x7c0     */
#define REQ_S0Q_HI   0x940ULL
#define REQ_MGR2_N   ((int)((REQ_MGR2_HI - REQ_MGR2_LO) / 8))
#define REQ_S0Q_N    ((int)((REQ_S0Q_HI  - REQ_S0Q_LO)  / 8))
static volatile LONG g_probe_req = 0;
static uint64_t g_base_mgr[REQ_MGR_N];
static uint64_t g_base_s0[REQ_S0_N];
static uint64_t g_base_ptrs[REQ_PTR_SLOTS];
static uint64_t g_base_mgr2[REQ_MGR2_N];
static uint64_t g_base_s0q[REQ_S0Q_N];
static uint32_t g_base_count = 0;
static int g_have_base_mgr = 0, g_have_base_s0 = 0, g_have_base_ptrs = 0;
static int g_have_base_mgr2 = 0, g_have_base_s0q = 0;
static void probe_req_dump_at_create(void);   /* fwd: called from CreateLobby thunk */

/* crash-guard state */
static intptr_t g_jmp[8];                 /* __builtin_setjmp buffer (>=5)    */
static volatile LONG g_in_game_call = 0;
static DWORD g_helper_tid = 0;

/* game function pointer types (MS x64 ABI == mingw-w64 default) */
typedef void     (*create_fn)(void *manager, int matchId, int mode, int maxA, int maxB);
typedef void     (*leave_fn)(void *manager, int k);
typedef uint32_t (*alloc_id_fn)(void *mgr2);               /* FUN_14006cf10 */
typedef void *   (*exists_fn)(void *manager, uint32_t id, int z); /* FUN_14026b270 */

/* ------------------------------------------------------------ small file I/O */
/* CreateFile can transiently fail under concurrent opens; retry briefly. Share
 * read+write so the worker-thread thunk and helper thread can both append. */
static HANDLE open_retry(const wchar_t *path, DWORD access, DWORD disp)
{
    for (int i = 0; i < 20; i++) {
        HANDLE h = CreateFileW(path, access, FILE_SHARE_READ | FILE_SHARE_WRITE,
                               NULL, disp, FILE_ATTRIBUTE_NORMAL, NULL);
        if (h != INVALID_HANDLE_VALUE) return h;
        if (GetLastError() != ERROR_SHARING_VIOLATION) break;
        Sleep(1);
    }
    return INVALID_HANDLE_VALUE;
}

static void append_bytes(const wchar_t *path, const char *buf, DWORD len)
{
    HANDLE h = open_retry(path, FILE_APPEND_DATA, OPEN_ALWAYS);
    if (h == INVALID_HANDLE_VALUE) return;
    DWORD wr = 0;
    SetFilePointer(h, 0, NULL, FILE_END);
    WriteFile(h, buf, len, &wr, NULL);
    CloseHandle(h);
}

static void write_file(const wchar_t *path, const char *buf, DWORD len)
{
    HANDLE h = open_retry(path, GENERIC_WRITE, CREATE_ALWAYS);
    if (h == INVALID_HANDLE_VALUE) return;
    DWORD wr = 0;
    WriteFile(h, buf, len, &wr, NULL);
    CloseHandle(h);
}

static void logmsg(const char *fmt, ...)
{
    char line[1024];
    SYSTEMTIME st; GetLocalTime(&st);
    int n = snprintf(line, sizeof(line), "%04d-%02d-%02d %02d:%02d:%02d.%03d ",
                      st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute,
                      st.wSecond, st.wMilliseconds);
    if (n < 0 || n >= (int)sizeof(line)) n = 0;
    int avail = (int)sizeof(line) - n - 2;   /* leave room for CRLF */
    va_list ap; va_start(ap, fmt);
    int m = vsnprintf(line + n, avail, fmt, ap);
    va_end(ap);
    if (m < 0) m = 0;
    if (m > avail) m = avail;                /* clamp: vsnprintf may return >avail */
    n += m;
    line[n++] = '\r'; line[n++] = '\n';
    append_bytes(g_log, line, (DWORD)n);
}

/* ------------------------------------------------------- pointer validation */
static int mem_readable(const void *p, SIZE_T n)
{
    if (!p) return 0;
    MEMORY_BASIC_INFORMATION mbi;
    if (VirtualQuery(p, &mbi, sizeof(mbi)) == 0) return 0;
    if (mbi.State != MEM_COMMIT) return 0;
    DWORD pr = mbi.Protect & 0xff;
    if (mbi.Protect & PAGE_GUARD) return 0;
    if (pr == PAGE_NOACCESS) return 0;
    /* region must cover [p, p+n) */
    uintptr_t base = (uintptr_t)mbi.BaseAddress;
    uintptr_t end  = base + mbi.RegionSize;
    uintptr_t want = (uintptr_t)p + n;
    return want <= end;
}

static int rd_u64(uintptr_t addr, uint64_t *out)
{
    if (!mem_readable((const void *)addr, 8)) return 0;
    *out = *(volatile uint64_t *)addr;
    return 1;
}
static int rd_u32(uintptr_t addr, uint32_t *out)
{
    if (!mem_readable((const void *)addr, 4)) return 0;
    *out = *(volatile uint32_t *)addr;
    return 1;
}
static int rd_u8(uintptr_t addr, uint8_t *out)
{
    if (!mem_readable((const void *)addr, 1)) return 0;
    *out = *(volatile uint8_t *)addr;
    return 1;
}

/* manager = *(base+OFF_MANAGER) ; 0 if unreadable/uninitialized */
static uint64_t get_manager(void)
{
    uint64_t m = 0;
    if (!rd_u64(g_base + OFF_MANAGER, &m)) return 0;
    return m;
}

/* coord = *(*(manager+SESS0)+COORD) ; 0 on any bad hop */
static uint64_t get_coord(uint64_t manager)
{
    uint64_t s0 = 0, c = 0;
    if (!manager) return 0;
    if (!rd_u64((uintptr_t)manager + SESS0_OFF, &s0) || !s0) return 0;
    if (!rd_u64((uintptr_t)s0 + COORD_OFF, &c) || !c) return 0;
    return c;
}

/* gate: 1 = a session is already active (don't create). Returns -1 if unknown. */
static int session_active(uint64_t coord)
{
    uint64_t gate = 0;
    if (!coord) return -1;
    if (!rd_u64((uintptr_t)coord + COORD_GATE, &gate)) return -1;
    return gate != 0;
}

/* -------------------------------------------------- inline JMP-detour hook */
/* on_capture_call: invoked from the detour stub with the game's ORIGINAL
 * register args intact (MS x64 ABI: RCX/RDX/R8/R9). Caches matchId/mode, flags
 * the poll loop to persist, and UNHOOKS (self-restoring one-shot). Must be a
 * plain ms_abi function (mingw-w64 default on Windows == MS x64 ABI). */
static void unhook_create(void);
static void on_capture_call(void *rcx, uint32_t rdx, uint32_t r8, uint64_t r9)
{
    g_matchId = (LONG)rdx;
    g_mode    = (LONG)r8;
    g_last_manager = (uint64_t)rcx;
    g_have_capture = 1;
    g_capture_dirty = 1;      /* poll loop persists (no file I/O beyond the log below) */
    /* cap26: log the 4 args distinctly so a single manual Create reveals HOST_MATCH_ID
     * (rdx) + HOST_MODE (r8) to replay via `call26`. (Same game-thread-detour logging
     * that createlobby_thunk already does safely.) */
    logmsg("[cap26] FUN_14026a880 rcx=0x%llx(manager) rdx=0x%x(HOST_MATCH_ID) "
           "r8=0x%x(HOST_MODE) r9=0x%llx (tid=%lu)",
           (unsigned long long)(uintptr_t)rcx, (unsigned)rdx, (unsigned)r8,
           (unsigned long long)r9, (unsigned long)GetCurrentThreadId());
    unhook_create();          /* restore original bytes so the jmp-back runs it */
}

/* Build the RWX detour stub once. Layout (56 bytes):
 *   push rax/rcx/rdx/r8/r9/r10/r11 ; sub rsp,0x20 ; mov rax,&on_capture_call ;
 *   call rax ; add rsp,0x20 ; pop (reverse) ; jmp [rip+0] ; <qword target> */
static int build_detour(void)
{
    if (g_detour) return 1;
    BYTE *b = (BYTE *)VirtualAlloc(NULL, 128, MEM_COMMIT | MEM_RESERVE,
                                   PAGE_EXECUTE_READWRITE);
    if (!b) { logmsg("[hook] VirtualAlloc detour FAILED"); return 0; }
    static const BYTE tmpl[] = {
        0x50,                               /* push rax                 */
        0x51,                               /* push rcx                 */
        0x52,                               /* push rdx                 */
        0x41,0x50,                          /* push r8                  */
        0x41,0x51,                          /* push r9                  */
        0x41,0x52,                          /* push r10                 */
        0x41,0x53,                          /* push r11                 */
        0x48,0x83,0xEC,0x20,                /* sub rsp,0x20             */
        0x48,0xB8,0,0,0,0,0,0,0,0,          /* mov rax, imm64 (logger)  @17 */
        0xFF,0xD0,                          /* call rax                 */
        0x48,0x83,0xC4,0x20,                /* add rsp,0x20             */
        0x41,0x5B,                          /* pop r11                  */
        0x41,0x5A,                          /* pop r10                  */
        0x41,0x59,                          /* pop r9                   */
        0x41,0x58,                          /* pop r8                   */
        0x5A,                               /* pop rdx                  */
        0x59,                               /* pop rcx                  */
        0x58,                               /* pop rax                  */
        0xFF,0x25,0,0,0,0,                  /* jmp [rip+0]              @42 */
        0,0,0,0,0,0,0,0                     /* qword target             @48 */
    };
    memcpy(b, tmpl, sizeof(tmpl));
    void *logger = (void *)&on_capture_call;
    memcpy(b + 17, &logger, 8);
    memcpy(b + 48, &g_target, 8);           /* jmp-back destination = target */
    FlushInstructionCache(GetCurrentProcess(), b, sizeof(tmpl));
    g_detour = b;
    return 1;
}

/* read the current first byte of the target (validated). -1 if unreadable. */
static int target_first_byte(void)
{
    if (!g_target || !mem_readable(g_target, 1)) return -1;
    return *(volatile BYTE *)g_target;
}

/* Is FUN_14026a880 DECRYPTED yet? The packer leaves encrypted garbage there until
 * runtime; the real prologue starts EXPECTED_PROLOGUE_BYTE (0x48, REX.W). We must
 * never patch until this holds. Logs the observed byte whenever it changes so the
 * flip garbage->0x48 is visible in the log. */
static int prologue_decrypted(void)
{
    int b = target_first_byte();
    if (b < 0) return 0;
    if (!g_seen_byte_init || (BYTE)b != g_last_seen_byte) {
        logmsg("[hook] FUN_14026a880 first byte = 0x%02x (%s)", b,
               (BYTE)b == EXPECTED_PROLOGUE_BYTE ? "DECRYPTED -- safe to arm"
                                                 : "not decrypted yet -- deferring");
        g_last_seen_byte = (BYTE)b;
        g_seen_byte_init = 1;
    }
    return (BYTE)b == EXPECTED_PROLOGUE_BYTE;
}

/* Is .text decrypted enough to CALL our game functions? If our hook is armed we
 * know it is (we only arm once decrypted); otherwise probe the prologue byte.
 * (When hooked, target[0] is our 0xFF patch, so we must not probe it directly.) */
static int text_decrypted(void)
{
    return g_hooked ? 1 : prologue_decrypted();
}

static void install_jmp_hook(void)
{
    if (!g_target) return;
    /* HARD GATE: never patch encrypted/undecrypted code (crashes the packer). */
    if (!prologue_decrypted()) return;
    if (InterlockedCompareExchange(&g_hooked, 1, 0) != 0) return;  /* already */
    if (!build_detour()) { g_hooked = 0; return; }
    /* save original bytes once, and ONLY the decrypted prologue */
    if (!g_have_orig) {
        if (!mem_readable(g_target, JMP_PATCH_LEN)) {
            logmsg("[hook] target not readable at %p -- not arming", g_target);
            g_hooked = 0; return;
        }
        memcpy(g_orig14, g_target, JMP_PATCH_LEN);
        if (g_orig14[0] != EXPECTED_PROLOGUE_BYTE) {   /* re-check after copy */
            logmsg("[hook] refusing to arm: first byte 0x%02x != 0x%02x",
                   g_orig14[0], EXPECTED_PROLOGUE_BYTE);
            g_hooked = 0; return;
        }
        g_have_orig = 1;
        logmsg("[hook] saved DECRYPTED prologue %p: %02x %02x %02x %02x %02x %02x ...",
               g_target, g_orig14[0], g_orig14[1], g_orig14[2],
               g_orig14[3], g_orig14[4], g_orig14[5]);
    }
    /* patch: FF 25 00000000 <qword detour>  (jmp [rip+0]) */
    BYTE patch[JMP_PATCH_LEN] = { 0xFF, 0x25, 0,0,0,0 };
    memcpy(patch + 6, &g_detour, 8);
    DWORD oldp;
    if (!VirtualProtect(g_target, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) {
        logmsg("[hook] VirtualProtect(arm) FAILED"); g_hooked = 0; return;
    }
    memcpy(g_target, patch, JMP_PATCH_LEN);
    VirtualProtect(g_target, JMP_PATCH_LEN, oldp, &oldp);
    FlushInstructionCache(GetCurrentProcess(), g_target, JMP_PATCH_LEN);
    logmsg("[hook] JMP detour armed at %p -> %p (do a manual create to capture)",
           g_target, g_detour);
}

static void unhook_create(void)
{
    if (InterlockedCompareExchange(&g_hooked, 0, 1) != 1) return;  /* not hooked */
    if (!g_have_orig || !g_target) return;
    DWORD oldp;
    if (!VirtualProtect(g_target, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) return;
    memcpy(g_target, g_orig14, JMP_PATCH_LEN);
    VirtualProtect(g_target, JMP_PATCH_LEN, oldp, &oldp);
    FlushInstructionCache(GetCurrentProcess(), g_target, JMP_PATCH_LEN);
}

/* ------------------------------------ hardware-breakpoint (DR0) fallback --- */
/* Sets/clears an execute breakpoint at g_target via DR0/DR7 on one thread. */
static void set_dr_on_thread(HANDLE th, int enable)
{
    CONTEXT c; memset(&c, 0, sizeof(c));
    c.ContextFlags = CONTEXT_DEBUG_REGISTERS;
    if (!GetThreadContext(th, &c)) return;
    if (enable) {
        c.Dr0  = (DWORD64)(uintptr_t)g_target;
        c.Dr7 &= ~((DWORD64)0xF << 16);   /* RW0=00 (execute) + LEN0=00        */
        c.Dr7 |=  (DWORD64)1;             /* L0 = 1 (local enable DR0)         */
    } else {
        c.Dr0  = 0;
        c.Dr7 &= ~(DWORD64)1;
    }
    c.ContextFlags = CONTEXT_DEBUG_REGISTERS;
    SetThreadContext(th, &c);
}

/* Apply the DR change to every thread in THIS process except our helper. */
static void hw_for_all_threads(int enable)
{
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snap == INVALID_HANDLE_VALUE) return;
    THREADENTRY32 te; te.dwSize = sizeof(te);
    DWORD pid = GetCurrentProcessId(), self = GetCurrentThreadId(), cnt = 0;
    if (Thread32First(snap, &te)) {
        do {
            if (te.th32OwnerProcessID != pid || te.th32ThreadID == self) continue;
            HANDLE th = OpenThread(THREAD_GET_CONTEXT | THREAD_SET_CONTEXT |
                                   THREAD_SUSPEND_RESUME, FALSE, te.th32ThreadID);
            if (th) {
                SuspendThread(th);
                set_dr_on_thread(th, enable);
                ResumeThread(th);
                CloseHandle(th);
                cnt++;
            }
        } while (Thread32Next(snap, &te));
    }
    CloseHandle(snap);
    logmsg("[hw] %s DR0 on %lu game threads", enable ? "set" : "cleared",
           (unsigned long)cnt);
}

static void arm_hw_bp(void)
{
    if (!g_target) return;
    g_hw_fired = 0;
    hw_for_all_threads(1);
    g_hw_armed = 1;
    logmsg("[hw] hardware exec BP armed at DR0=%p (no code modified)", g_target);
}

static void disarm_hw_bp(void)
{
    if (InterlockedExchange(&g_hw_armed, 0) == 0) return;   /* was not armed */
    hw_for_all_threads(0);
    logmsg("[hw] hardware BP disarmed");
}

/* ------------------- ISteamMatchmaking::CreateLobby vtable diagnostic ------- */
typedef void *   (*iface_accessor_fn)(void *arg);
typedef uint64_t (*createlobby_fn)(void *thisptr, int eLobbyType, int cMaxMembers);

/* SizeOfImage of the main module (from its in-memory PE headers). */
static uint64_t module_size(void)
{
    BYTE *b = (BYTE *)g_base;
    if (!mem_readable(b + 0x3c, 4)) return 0;
    DWORD e = *(DWORD *)(b + 0x3c);
    if (!mem_readable(b + e + 4 + 20 + 56, 4)) return 0;
    return *(DWORD *)(b + e + 4 + 20 + 56);   /* opt-hdr off 56 = SizeOfImage */
}

/* Log every return address on the current stack that lands inside the game
 * module (== a Ghidra address base+offset). Reveals the CreateLobby call chain:
 * the immediate worker caller AND, higher, the Custom-Match menu FSM initiator. */
static void stack_walk_log(void)
{
    uint64_t modsz = module_size();
    uintptr_t lo = g_base, hi = g_base + (modsz ? modsz : 0x4000000);

    /* (1) clean ordered frames via RtlCaptureStackBackTrace, if available */
    if (g_RtlCapture) {
        void *frames[62];
        USHORT n = g_RtlCapture(1, 62, frames, NULL);
        logmsg("[CL] --- RtlCaptureStackBackTrace (%u frames; in-module only) ---", n);
        for (USHORT i = 0; i < n; i++) {
            uintptr_t a = (uintptr_t)frames[i];
            if (a >= lo && a < hi)
                logmsg("[CL]   frame[%u] = base+0x%llx", i, (unsigned long long)(a - lo));
        }
    }

    /* (2) raw stack scan (robust: catches the chain even w/o frame pointers) */
    volatile int marker = 0; (void)marker;
    uintptr_t sp = (uintptr_t)&marker;
    MEMORY_BASIC_INFORMATION mbi;
    if (VirtualQuery((void *)sp, &mbi, sizeof(mbi))) {
        uintptr_t top = (uintptr_t)mbi.BaseAddress + mbi.RegionSize;
        int cnt = 0;
        logmsg("[CL] --- raw stack scan for in-module return addrs ---");
        for (uintptr_t a = sp; a + 8 <= top && cnt < 48; a += 8) {
            uint64_t v = *(uint64_t *)a;
            if (v >= lo && v < hi) {
                logmsg("[CL]   sp+0x%-4llx -> base+0x%llx",
                       (unsigned long long)(a - sp), (unsigned long long)(v - lo));
                cnt++;
            }
        }
    }
    logmsg("[CL] --- end stack walk (cross-ref base+offset in Ghidra) ---");
}

/* our replacement for matchmaking vtable[CreateLobby] */
static uint64_t createlobby_thunk(void *thisptr, int eLobbyType, int cMaxMembers)
{
    logmsg("[CL] *** CreateLobby FIRED *** this=%p eLobbyType=%d cMaxMembers=%d",
           thisptr, eLobbyType, cMaxMembers);
    stack_walk_log();
    if (g_probe_req) probe_req_dump_at_create();
    uint64_t r = 0;
    createlobby_fn orig = (createlobby_fn)g_orig_createlobby;
    if (orig) r = orig(thisptr, eLobbyType, cMaxMembers);   /* real create runs */
    logmsg("[CL] orig CreateLobby returned SteamAPICall_t=0x%llx",
           (unsigned long long)r);
    return r;
}

/* Resolve matchmaking = (*DAT_1408db898)(&PTR_FUN_140a34d90)[+0x20]. */
/* resolve the Steam interface SINGLETON: (*DAT_1408db898)(&PTR_FUN_140a34d90) */
static void *resolve_singleton(void)
{
    uint64_t acc_ptr = 0;
    if (!rd_u64(g_base + OFF_IFACE_ACCESSOR, &acc_ptr) || !acc_ptr) return NULL;
    if (!mem_readable((void *)(uintptr_t)acc_ptr, 1)) return NULL;
    void *iface = NULL;
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        iface_accessor_fn acc = (iface_accessor_fn)(uintptr_t)acc_ptr;
        iface = acc((void *)(g_base + OFF_IFACE_ARG));
        g_in_game_call = 0;
    } else { g_in_game_call = 0; return NULL; }
    return iface;
}

static void *resolve_matchmaking(void)
{
    void *iface = resolve_singleton();
    if (!iface || !mem_readable((char *)iface + IFACE_MM_OFF, 8)) {
        logmsg("[CL] singleton=%p invalid", iface);
        return NULL;
    }
    void *mm = *(void **)((char *)iface + IFACE_MM_OFF);
    if (!mm || !mem_readable(mm, 8)) {
        logmsg("[CL] matchmaking iface=%p invalid", mm);
        return NULL;
    }
    logmsg("[CL] singleton=%p matchmaking=%p", iface, mm);
    return mm;
}

/* ISteamUtils / ISteamUser resolvers + Steam vtable-call scaffolding ---------- */
/* raw resolvers (no crash-guard setjmp) -- for use ON THE MAIN THREAD, where the
 * helper-thread crash-guard doesn't apply anyway and g_jmp must not be touched. */
static void *resolve_singleton_raw(void)
{
    uint64_t acc_ptr = 0;
    if (!rd_u64(g_base + OFF_IFACE_ACCESSOR, &acc_ptr) || !acc_ptr) return NULL;
    if (!mem_readable((void *)(uintptr_t)acc_ptr, 1)) return NULL;
    iface_accessor_fn acc = (iface_accessor_fn)(uintptr_t)acc_ptr;
    return acc((void *)(g_base + OFF_IFACE_ARG));
}
static void *resolve_iface_raw(uint64_t off)
{
    void *si = resolve_singleton_raw();
    if (!si) return NULL;
    uint64_t p = 0;
    if (!rd_u64((uintptr_t)si + off, &p) || !p) return NULL;
    if (!mem_readable((void *)(uintptr_t)p, 8)) return NULL;
    return (void *)(uintptr_t)p;
}

/* Steam vtable method signatures (Win64 ABI) */
typedef int      (*getresult_fn)(void *this_, uint64_t hCall, void *pCb, int cub,
                                 int iCbExpected, unsigned char *pbFailed);
typedef int      (*isdone_fn)(void *this_, uint64_t hCall, unsigned char *pbFailed);

/* vtable slot INDICES -- set via set_slots; -1 = unset (chain inert). */
static int g_slot_getresult   = -1;
static int g_slot_isdone      = -1;
static int g_slot_getsteamid  = -1;
static uint64_t g_created_lobby = 0;
static uint64_t g_our_steamid   = 0;
static volatile uint64_t g_deleg_coord = 0;   /* coord stashed by the delegate detour */
/* Crash-guard for Steam calls made from the [lc] LobbyCreated listener (SetLobbyData /
 * GetLobbyOwner). cb_lc_run runs on the main thread inside Steam's OWN dispatch, which is
 * NOT wrapped by on_mt_call's setjmp -- so it needs its own longjmp buffer. A fault here
 * must NEVER kill the game. */
static intptr_t      g_lc_jmp[8];
static volatile LONG g_lc_in_call = 0;
static DWORD         g_lc_tid      = 0;

/* call vtable[idx] of obj with bounds-check; returns the fn ptr or NULL */
static void *vslot(void *obj, int idx)
{
    if (idx < 0 || !obj || !mem_readable(obj, 8)) return NULL;
    void **vt = *(void ***)obj;
    if (!mem_readable(vt, (SIZE_T)(idx + 1) * 8)) return NULL;
    return vt[idx];
}

/* resolve a vtable entry by BYTE offset (Ghidra gives these directly, e.g. +0x108).
 * Bounds-checked; returns the fn ptr or NULL. */
static void *mm_vfn(void *obj, uint64_t byteoff)
{
    if (!obj || !mem_readable(obj, 8)) return NULL;
    void **vt = *(void ***)obj;
    if (!mem_readable((char *)vt + byteoff, 8)) return NULL;
    return *(void **)((char *)vt + byteoff);
}

/* Install the vtable hook on matchmaking->CreateLobby (pure pointer swap). */
static void install_createlobby_hook(void)
{
    if (g_cl_hooked) { logmsg("[CL] already hooked"); return; }
    void *mm = resolve_matchmaking();
    if (!mm) return;
    void **vtbl = *(void ***)mm;
    if (!mem_readable(vtbl, MM_VT_CREATELOBBY + 8)) {
        logmsg("[CL] vtable %p not readable", (void *)vtbl); return;
    }
    void **slot = (void **)((char *)vtbl + MM_VT_CREATELOBBY);
    void *orig = *slot;
    logmsg("[CL] matchmaking vtable=%p CreateLobby slot=%p orig=%p (base+0x%llx)",
           (void *)vtbl, (void *)slot, orig,
           (unsigned long long)((uintptr_t)orig - g_base));
    DWORD oldp;
    if (!VirtualProtect(slot, 8, PAGE_READWRITE, &oldp)) {
        logmsg("[CL] VirtualProtect(vtable slot) FAILED"); return;
    }
    g_orig_createlobby = orig;
    g_cl_slot = slot;
    *slot = (void *)&createlobby_thunk;
    VirtualProtect(slot, 8, oldp, &oldp);
    g_cl_hooked = 1;
    logmsg("[CL] CreateLobby vtable-hook INSTALLED -> thunk %p. Now do a manual "
           "Custom Match create; the thunk logs args + stack walk.",
           (void *)&createlobby_thunk);
}

static void uninstall_createlobby_hook(void)
{
    if (!g_cl_hooked || !g_cl_slot) return;
    DWORD oldp;
    if (VirtualProtect(g_cl_slot, 8, PAGE_READWRITE, &oldp)) {
        *g_cl_slot = g_orig_createlobby;
        VirtualProtect(g_cl_slot, 8, oldp, &oldp);
    }
    g_cl_hooked = 0;
    logmsg("[CL] CreateLobby vtable-hook removed");
}

/* --------- host-via-join: hijack SteamMatchmaking::JoinLobby -> CreateLobby ----
 * The steam://joinlobby flow makes the game stand up the WHOLE online session
 * (manager/netplay/coord) for the join target, then call JoinLobby. We intercept
 * that JoinLobby (vtable +0x70) and instead call the game's own CreateLobby
 * (+0x68) with (this, 2, 2), returning CreateLobby's SteamAPICall_t -- so the
 * already-primed callback handlers process the created lobby and host us. */
typedef uint64_t (*joinlobby_fn)(void *thisptr, uint64_t steamIDLobby);
static void  **g_hijack_vtbl = 0;
static void  **g_hijack_slot = 0;      /* &vtable[JoinLobby]                    */
static void   *g_hijack_join_orig = 0;
static volatile LONG g_hijack_armed = 0;
static volatile LONG g_hijack_fired = 0;
static int     g_hijack_autodisarm = 1;
static uint64_t g_hijack_call = 0;     /* CreateLobby's returned SteamAPICall_t  */
/* wire-A: hook ISteamUtils::GetAPICallResult and, for hCreate, hand the game's
 * own join CCallResult a synthetic LobbyEnter_t{createdId} so it wires+hosts. */
static void  **g_gr_slot = 0;          /* &utils_vtable[GetAPICallResult]        */
static void   *g_orig_getresult = 0;
static volatile LONG g_wireA_hooked = 0;
static volatile LONG g_wireA_armed  = 0;
/* route A' (PRIMARY): JMP-detour the FLAT SteamAPI_ISteamUtils_GetAPICallResult in
 * steam_api64.dll (the fetch the CCallResult path actually uses; the vtable is
 * bypassed under Proton). Non-matching calls pass through to the real vtable impl
 * (self->vtable[slot]) -- no trampoline needed. */
static void   *g_gr_flat = 0;
static BYTE    g_gr_flat_orig[14];
static volatile LONG g_wireA2_hooked = 0;
static volatile LONG g_wireA2_armed  = 0;
/* route A3 (PROTON PRIMARY): hook SteamAPI_ManualDispatch_GetAPICallResult (hCall
 * is the 2nd arg). Pass-through = unpatch/call/repatch (ManualDispatch pumps on a
 * single thread, so no trampoline/length-disassembler needed). */
static void   *g_md_target = 0;
static BYTE    g_md_orig[14];
static volatile LONG g_wireA3_hooked = 0;
static volatile LONG g_wireA3_armed  = 0;
/* THE definitive wire: JMP-detour the join-result delegate (base+0x1389e0) and
 * fully replace it -- force success + set coord+0x340=createdId -> host. */
static void   *g_deleg_target = 0;
static BYTE    g_deleg_orig[14];
static volatile LONG g_deleg_hooked = 0;
static volatile LONG g_deleg_armed  = 0;
/* post-create progression poll (runs on the HELPER thread, set by the thunk) */
static volatile LONG g_hijack_poll_pending = 0;
static DWORD   g_hijack_poll_start = 0;
static uint64_t g_hj_last_lobby = 0, g_hj_last_owner = 0, g_hj_last_created = 0;
static uint32_t g_hj_last_state = 0;
static int     g_hj_last_insession = 0, g_hj_have_last = 0;
static uint8_t g_hj_last_host = 0;

static void unhost_via_join(void)
{
    if (InterlockedExchange(&g_hijack_armed, 0) == 0) return;
    if (g_hijack_slot) {
        DWORD oldp;
        if (VirtualProtect(g_hijack_slot, 8, PAGE_READWRITE, &oldp)) {
            *g_hijack_slot = g_hijack_join_orig;
            VirtualProtect(g_hijack_slot, 8, oldp, &oldp);
        }
    }
    logmsg("[hijack] JoinLobby hook removed");
}

/* our replacement for matchmaking vtable[JoinLobby] (runs on the GAME thread;
 * must NOT block -- the 8s progression poll runs on the helper thread) */
static uint64_t joinlobby_thunk(void *thisptr, uint64_t steamIDLobby)
{
    logmsg("[hijack] JoinLobby(0x%llx) INTERCEPTED (join flow reached JoinLobby)",
           (unsigned long long)steamIDLobby);
    /* one-shot: auto-disarm so a LATER real join isn't hijacked */
    if (g_hijack_autodisarm) unhost_via_join();
    g_hijack_fired = 1;
    /* route through the CURRENT CreateLobby slot (so the probe_cl backstop, if
     * armed, still logs [CL] *** FIRED *** + backtrace and calls the real one) */
    uint64_t r = 0;
    createlobby_fn cl = 0;
    if (g_hijack_vtbl &&
        mem_readable((char *)g_hijack_vtbl + MM_VT_CREATELOBBY, 8))
        cl = *(createlobby_fn *)((char *)g_hijack_vtbl + MM_VT_CREATELOBBY);
    if (!cl) {
        logmsg("[hijack] -> CreateLobby slot NULL/unreadable -- cannot create");
    } else {
        r = cl(thisptr, 2 /*k_ELobbyTypePublic*/, 2 /*cMaxMembers*/);
        g_hijack_call = r;
        logmsg("[hijack] -> CreateLobby(eLobbyType=2, cMaxMembers=2) returned "
               "SteamAPICall_t=0x%llx%s", (unsigned long long)r,
               (r == 0 || r == 0xffffffffffffffffULL) ? " (INVALID!)" : "");
        logmsg("[hijack] created-call handle=0x%llx (GetAPICallResult LobbyCreated_t "
               "off this = the created lobby id -- see wire_lobby)",
               (unsigned long long)r);
    }
    /* kick off the helper-thread post-create progression poll */
    g_hj_have_last = 0;
    g_hijack_poll_start = GetTickCount();
    g_hijack_poll_pending = 1;
    return r;
}

static void install_join_hijack(void)
{
    if (g_hijack_armed) { logmsg("[hijack] already armed"); return; }
    void *mm = resolve_matchmaking();
    if (!mm) return;
    void **vtbl = *(void ***)mm;
    if (!mem_readable(vtbl, MM_VT_JOINLOBBY + 8)) {
        logmsg("[hijack] vtable %p not readable", (void *)vtbl); return;
    }
    void **slot = (void **)((char *)vtbl + MM_VT_JOINLOBBY);
    void *orig = *slot;
    logmsg("[hijack] matchmaking vtable=%p JoinLobby slot=%p orig=%p (base+0x%llx)",
           (void *)vtbl, (void *)slot, orig,
           (unsigned long long)((uintptr_t)orig - g_base));
    DWORD oldp;
    if (!VirtualProtect(slot, 8, PAGE_READWRITE, &oldp)) {
        logmsg("[hijack] VirtualProtect(JoinLobby slot) FAILED"); return;
    }
    g_hijack_vtbl = vtbl;
    g_hijack_slot = slot;
    g_hijack_join_orig = orig;
    *slot = (void *)&joinlobby_thunk;
    VirtualProtect(slot, 8, oldp, &oldp);
    g_hijack_armed = 1;
    g_hijack_fired = 0;
    logmsg("[hijack] host_via_join ARMED -> thunk %p. Send a steam://joinlobby link now; "
           "the join becomes a hosted CreateLobby(2,2).", (void *)&joinlobby_thunk);
}

/* wire-A thunk: ISteamUtils::GetAPICallResult replacement. When the game's own
 * join CCallResult fetches the result for hCreate, we fetch the real LobbyCreated_t
 * to learn createdId, then OVERWRITE the caller's buffer with a synthetic
 * LobbyEnter_t{createdId, perms=0xFFFFFFFF, locked=0, response=1} and return
 * success -- so the game wires OUR created lobby and hosts. Runs on Steam's own
 * dispatch (main thread); we never call into Steam except the same GetAPICallResult
 * the game was already making. LobbyEnter_t (pack8): lobby@0, perms@8, locked@12,
 * EChatRoomEnterResponse@16 (sizeof ~24). */
static int getresult_thunk(void *thisptr, uint64_t hCall, void *pCb, int cub,
                           int iCbExpected, unsigned char *pbFailed)
{
    getresult_fn orig = (getresult_fn)g_orig_getresult;
    if (g_wireA_armed && g_hijack_call && hCall == g_hijack_call) {
        unsigned char tmp[16]; memset(tmp, 0, sizeof(tmp));
        unsigned char f2 = 0;
        int rc = orig ? orig(thisptr, hCall, tmp, 16, LOBBYCREATED_T_CBID, &f2) : 0;
        uint32_t eres = *(uint32_t *)tmp;
        uint64_t createdId = *(uint64_t *)(tmp + 8);         /* pack8: @8 */
        if (!createdId) createdId = g_created_lobby;         /* fallback to [lc] */
        logmsg("[wireA] GetAPICallResult(hCreate=0x%llx) iCbExpected=%d cub=%d -> "
               "real eResult=%u createdId=0x%llx (rc=%d)", (unsigned long long)hCall,
               iCbExpected, cub, eres, (unsigned long long)createdId, rc);
        if (createdId && pCb && cub >= 20) {
            memset(pCb, 0, (size_t)cub);
            *(uint64_t *)((char *)pCb + 0)  = createdId;     /* m_ulSteamIDLobby     */
            *(uint32_t *)((char *)pCb + 8)  = 0xFFFFFFFFu;   /* m_rgfChatPermissions */
            *(unsigned char *)((char *)pCb + 12) = 0;        /* m_bLocked            */
            *(uint32_t *)((char *)pCb + 16) = 1;             /* response = success   */
            if (pbFailed) *pbFailed = 0;
            g_wireA_armed = 0;                               /* one-shot            */
            logmsg("[wireA] SUBSTITUTED LobbyEnter_t{lobby=0x%llx resp=1} -> game join "
                   "CCallResult (should wire + host)", (unsigned long long)createdId);
            return 1;
        }
    }
    return orig ? orig(thisptr, hCall, pCb, cub, iCbExpected, pbFailed) : 0;
}

static void install_wireA(void)
{
    if (g_wireA_hooked) return;
    if (g_slot_getresult < 0) { logmsg("[wireA] GetAPICallResult slot unset (set_slots)"); return; }
    void *si = resolve_singleton();
    uint64_t up = 0;
    if (!si || !rd_u64((uintptr_t)si + IFACE_UTILS_OFF, &up) || !up) {
        logmsg("[wireA] ISteamUtils null (steam not up?)"); return;
    }
    void **vt = *(void ***)(uintptr_t)up;
    if (!mem_readable(vt, (SIZE_T)(g_slot_getresult + 1) * 8)) {
        logmsg("[wireA] utils vtable too short"); return;
    }
    void **slot = &vt[g_slot_getresult];
    DWORD oldp;
    if (!VirtualProtect(slot, 8, PAGE_READWRITE, &oldp)) { logmsg("[wireA] vprotect FAILED"); return; }
    g_orig_getresult = *slot;
    g_gr_slot = slot;
    *slot = (void *)&getresult_thunk;
    VirtualProtect(slot, 8, oldp, &oldp);
    g_wireA_hooked = 1;
    logmsg("[wireA] GetAPICallResult hooked (slot %d orig=%p -> thunk %p)",
           g_slot_getresult, g_orig_getresult, (void *)&getresult_thunk);
}
static void uninstall_wireA(void)
{
    if (!g_wireA_hooked || !g_gr_slot) return;
    DWORD oldp;
    if (VirtualProtect(g_gr_slot, 8, PAGE_READWRITE, &oldp)) {
        *g_gr_slot = g_orig_getresult;
        VirtualProtect(g_gr_slot, 8, oldp, &oldp);
    }
    g_wireA_hooked = 0;
    g_wireA_armed = 0;
    logmsg("[wireA] GetAPICallResult hook removed");
}

/* ------- route A' : hook the FLAT steam_api64 GetAPICallResult (the real path) */
static void uninstall_wireA2(void);   /* fwd (one-shot self-disarm)             */

/* pass-through helper: call the REAL GetAPICallResult via the utils vtable impl
 * (self->vtable[slot]) -- equivalent to the flat wrapper, no trampoline/recursion. */
static int gr_passthrough(void *self, uint64_t hCall, void *pCb, int cub,
                          int iCbExpected, unsigned char *pbFailed)
{
    if (self && mem_readable(self, 8) && g_slot_getresult >= 0) {
        void **vt = *(void ***)self;
        if (mem_readable(vt, (SIZE_T)(g_slot_getresult + 1) * 8)) {
            getresult_fn real = (getresult_fn)vt[g_slot_getresult];
            return real(self, hCall, pCb, cub, iCbExpected, pbFailed);
        }
    }
    return 0;
}

/* flat-export detour: substitute a synthetic LobbyEnter_t for hCreate, else pass
 * through. Runs on whatever thread the game's CCallResult dispatch uses (Steam's
 * own; safe). LobbyEnter_t pack(8): lobby@0, perms@8, locked@12, response@16. */
static int getresult_detour(void *self, uint64_t hCall, void *pCb, int cub,
                            int iCbExpected, unsigned char *pbFailed)
{
    if (g_wireA2_armed && g_hijack_call && hCall == g_hijack_call && pCb && cub >= 20) {
        uint64_t createdId = g_created_lobby;
        if (!createdId) {                       /* fallback: fetch inline */
            unsigned char tmp[16]; memset(tmp, 0, sizeof(tmp));
            unsigned char f2 = 0;
            gr_passthrough(self, hCall, tmp, 16, LOBBYCREATED_T_CBID, &f2);
            createdId = *(uint64_t *)(tmp + 8);
        }
        logmsg("[wireA2] flat GetAPICallResult(hCreate=0x%llx) iCbExpected=%d cub=%d "
               "createdId=0x%llx (tid=%lu)", (unsigned long long)hCall, iCbExpected,
               cub, (unsigned long long)createdId, (unsigned long)GetCurrentThreadId());
        if (createdId) {
            memset(pCb, 0, (size_t)cub);
            *(uint64_t *)((char *)pCb + 0)  = createdId;      /* m_ulSteamIDLobby     */
            *(uint32_t *)((char *)pCb + 8)  = 0xFFFFFFFFu;    /* m_rgfChatPermissions */
            *(unsigned char *)((char *)pCb + 12) = 0;         /* m_bLocked            */
            if (cub >= 20) *(uint32_t *)((char *)pCb + 16) = 1; /* response = success */
            if (pbFailed) *pbFailed = 0;
            g_wireA2_armed = 0;                               /* one-shot */
            logmsg("[wireA2] SUBSTITUTED LobbyEnter_t{lobby=0x%llx resp=1} -> join "
                   "CCallResult (per-frame FUN_14013af30 -> GetLobbyOwner==us -> HOST)",
                   (unsigned long long)createdId);
            uninstall_wireA2();
            return 1;
        }
    }
    return gr_passthrough(self, hCall, pCb, cub, iCbExpected, pbFailed);
}

/* log export names containing a substring (diagnostic when the exact name misses) */
static void enum_exports_matching(HMODULE h, const char *needle)
{
    BYTE *b = (BYTE *)h;
    DWORD e = *(DWORD *)(b + 0x3c);
    DWORD exprva = *(DWORD *)(b + e + 4 + 20 + 112);   /* opt-hdr datadir[0].rva */
    if (!exprva) { logmsg("[wireA2] no export dir"); return; }
    BYTE *ed = b + exprva;
    DWORD nnames = *(DWORD *)(ed + 24);
    DWORD names_rva = *(DWORD *)(ed + 32);
    DWORD *names = (DWORD *)(b + names_rva);
    int shown = 0;
    for (DWORD i = 0; i < nnames && shown < 20; i++) {
        const char *nm = (const char *)(b + names[i]);
        if (strstr(nm, needle)) { logmsg("[wireA2]   export: %s", nm); shown++; }
    }
}

static void install_wireA2(void)
{
    if (g_wireA2_hooked) return;
    if (g_slot_getresult < 0) {
        logmsg("[wireA2] GetAPICallResult vtable slot unset (set_slots) -- needed for "
               "pass-through"); return;
    }
    HMODULE h = GetModuleHandleW(L"steam_api64.dll");
    if (!h) { logmsg("[wireA2] steam_api64.dll not loaded"); return; }
    void *flat = (void *)GetProcAddress(h, "SteamAPI_ISteamUtils_GetAPICallResult");
    if (!flat) {
        logmsg("[wireA2] SteamAPI_ISteamUtils_GetAPICallResult not found; candidates:");
        enum_exports_matching(h, "GetAPICallResult");
        return;
    }
    g_gr_flat = flat;
    if (!mem_readable(flat, JMP_PATCH_LEN)) { logmsg("[wireA2] flat export unreadable"); return; }
    memcpy(g_gr_flat_orig, flat, JMP_PATCH_LEN);
    BYTE patch[JMP_PATCH_LEN] = { 0xFF, 0x25, 0,0,0,0 };
    void *det = (void *)&getresult_detour;
    memcpy(patch + 6, &det, 8);
    DWORD oldp;
    if (!VirtualProtect(flat, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) {
        logmsg("[wireA2] VirtualProtect FAILED"); return;
    }
    memcpy(flat, patch, JMP_PATCH_LEN);
    VirtualProtect(flat, JMP_PATCH_LEN, oldp, &oldp);
    FlushInstructionCache(GetCurrentProcess(), flat, JMP_PATCH_LEN);
    g_wireA2_hooked = 1;
    logmsg("[wireA2] JMP-detoured flat SteamAPI_ISteamUtils_GetAPICallResult @%p", flat);
}

static void uninstall_wireA2(void)
{
    if (!g_wireA2_hooked || !g_gr_flat) return;
    DWORD oldp;
    if (VirtualProtect(g_gr_flat, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) {
        memcpy(g_gr_flat, g_gr_flat_orig, JMP_PATCH_LEN);
        VirtualProtect(g_gr_flat, JMP_PATCH_LEN, oldp, &oldp);
        FlushInstructionCache(GetCurrentProcess(), g_gr_flat, JMP_PATCH_LEN);
    }
    g_wireA2_hooked = 0;
    logmsg("[wireA2] flat GetAPICallResult hook removed");
}

/* ------- route A3: hook SteamAPI_ManualDispatch_GetAPICallResult (Proton path) */
/* generic 14-byte JMP patch helpers */
static int jmp_apply(void *target, void *detour, BYTE *saved14)
{
    if (!mem_readable(target, JMP_PATCH_LEN)) return 0;
    if (saved14) memcpy(saved14, target, JMP_PATCH_LEN);
    BYTE patch[JMP_PATCH_LEN] = { 0xFF, 0x25, 0,0,0,0 };
    memcpy(patch + 6, &detour, 8);
    DWORD oldp;
    if (!VirtualProtect(target, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) return 0;
    memcpy(target, patch, JMP_PATCH_LEN);
    VirtualProtect(target, JMP_PATCH_LEN, oldp, &oldp);
    FlushInstructionCache(GetCurrentProcess(), target, JMP_PATCH_LEN);
    return 1;
}
static void jmp_restore(void *target, BYTE *saved14)
{
    DWORD oldp;
    if (VirtualProtect(target, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) {
        memcpy(target, saved14, JMP_PATCH_LEN);
        VirtualProtect(target, JMP_PATCH_LEN, oldp, &oldp);
        FlushInstructionCache(GetCurrentProcess(), target, JMP_PATCH_LEN);
    }
}

static void uninstall_wireA3(void);   /* fwd */
typedef int (*mdgr_fn)(int32_t pipe, uint64_t hCall, void *pCb, int cub,
                       int iCbExpected, unsigned char *pbFailed);

/* ManualDispatch detour: match hCreate on the 2nd arg; substitute LobbyEnter_t,
 * else pass through via unpatch/call/repatch (single-threaded dispatch). */
static int md_getresult_detour(int32_t pipe, uint64_t hCall, void *pCb, int cub,
                               int iCbExpected, unsigned char *pbFailed)
{
    if (g_wireA3_armed && g_hijack_call && hCall == g_hijack_call && pCb && cub >= 20) {
        uint64_t createdId = g_created_lobby;
        logmsg("[wireA3] ManualDispatch GetAPICallResult(hCreate=0x%llx) iCbExpected=%d "
               "cub=%d createdId=0x%llx (tid=%lu)", (unsigned long long)hCall,
               iCbExpected, cub, (unsigned long long)createdId,
               (unsigned long)GetCurrentThreadId());
        if (createdId) {
            memset(pCb, 0, (size_t)cub);
            *(uint64_t *)((char *)pCb + 0)  = createdId;
            *(uint32_t *)((char *)pCb + 8)  = 0xFFFFFFFFu;
            *(unsigned char *)((char *)pCb + 12) = 0;
            if (cub >= 20) *(uint32_t *)((char *)pCb + 16) = 1;
            if (pbFailed) *pbFailed = 0;
            g_wireA3_armed = 0;
            uninstall_wireA3();               /* one-shot */
            logmsg("[wireA3] SUBSTITUTED LobbyEnter_t{lobby=0x%llx resp=1} -> join "
                   "CCallResult (per-frame GetLobbyOwner==us -> HOST)",
                   (unsigned long long)createdId);
            return 1;
        }
    }
    /* pass-through: unpatch, call original, re-patch (single dispatch thread) */
    jmp_restore(g_md_target, g_md_orig);
    int r = ((mdgr_fn)g_md_target)(pipe, hCall, pCb, cub, iCbExpected, pbFailed);
    if (g_wireA3_hooked) jmp_apply(g_md_target, (void *)&md_getresult_detour, NULL);
    return r;
}

static void install_wireA3(void)
{
    if (g_wireA3_hooked) return;
    HMODULE h = GetModuleHandleW(L"steam_api64.dll");
    if (!h) { logmsg("[wireA3] steam_api64.dll not loaded"); return; }
    void *fn = (void *)GetProcAddress(h, "SteamAPI_ManualDispatch_GetAPICallResult");
    if (!fn) {
        logmsg("[wireA3] ManualDispatch_GetAPICallResult not found; candidates:");
        enum_exports_matching(h, "GetAPICallResult");
        return;
    }
    logmsg("[wireA3] ManualDispatch present: Init=%p RunFrame=%p GetNextCallback=%p",
           (void *)GetProcAddress(h, "SteamAPI_ManualDispatch_Init"),
           (void *)GetProcAddress(h, "SteamAPI_ManualDispatch_RunFrame"),
           (void *)GetProcAddress(h, "SteamAPI_ManualDispatch_GetNextCallback"));
    g_md_target = fn;
    if (!jmp_apply(fn, (void *)&md_getresult_detour, g_md_orig)) {
        logmsg("[wireA3] patch FAILED"); return;
    }
    g_wireA3_hooked = 1;
    logmsg("[wireA3] JMP-detoured SteamAPI_ManualDispatch_GetAPICallResult @%p "
           "(unpatch/repatch pass-through)", fn);
}
static void uninstall_wireA3(void)
{
    if (!g_wireA3_hooked || !g_md_target) return;
    jmp_restore(g_md_target, g_md_orig);
    g_wireA3_hooked = 0;
    logmsg("[wireA3] ManualDispatch hook removed");
}

/* -------- THE definitive session wire: detour the join-result delegate ------- */
static int  is_lobby_id(uint64_t v);      /* fwd (defined in the memory section) */
static void uninstall_delegate(void);     /* fwd */

/* Full replacement of the join CCallResult delegate (base+0x1389e0). Its only
 * effects are two writes; we do them ourselves + set coord+0x340=createdId so the
 * per-frame host-election (GetLobbyOwner(createdId)==us) makes us HOST, then RET
 * to skip the original. Entered via JMP with the caller's retaddr on the stack, so
 * a normal C function that returns lands back in the caller. (rcx=coord, rdx=pParam,
 * r8b=bIOFailure -> MS x64 ABI params.) */
static void delegate_detour(void *coord, void *pParam, unsigned char bIOFailure)
{
    (void)pParam;                          /* pParam is the JOIN target under bIOFailure=1 -- garbage, do NOT read */
    g_deleg_coord = (uint64_t)coord;       /* stash rcx so the [lc] listener knows which coord to wire */
    if (coord && mem_readable(coord, 0x19778)) {
        uintptr_t c = (uintptr_t)coord;
        *(volatile unsigned char *)(c + DELEG_IOFAIL_OFF) = 0;    /* bIOFailure=false */
        *(volatile uint32_t *)(c + DELEG_STATUS_OFF) = 1;         /* status=SUCCESS   */
        /* Order-independence: if [lc] already captured the created lobby, wire it now.
         * Otherwise [lc] does the coord+0x340 write when LobbyCreated_t arrives. We do
         * NOT fall back to pParam (it is the join TARGET, not our created lobby). */
        uint64_t createdId = g_created_lobby;
        if (createdId) *(volatile uint64_t *)(c + DELEG_LOBBY_OFF) = createdId;
        uint64_t cur = 0; rd_u64(c + DELEG_LOBBY_OFF, &cur);
        logmsg("[deleg] FIRED coord=%p bIOFailure=%u -> status=1, createdId(global)=0x%llx, "
               "coord+0x340=0x%llx (tid=%lu)", coord, bIOFailure,
               (unsigned long long)createdId, (unsigned long long)cur,
               (unsigned long)GetCurrentThreadId());
    } else {
        logmsg("[deleg] FIRED but coord unreadable (%p)", coord);
    }
    g_deleg_armed = 0;
    uninstall_delegate();          /* one-shot: restore the original delegate */
}

static void install_delegate(void)
{
    if (g_deleg_hooked) return;
    if (!text_decrypted()) { logmsg("[deleg] .text not decrypted yet -- deferring"); return; }
    void *target = (void *)(uintptr_t)(g_base + OFF_JOIN_DELEGATE);
    if (!mem_readable(target, JMP_PATCH_LEN)) { logmsg("[deleg] target unreadable"); return; }
    BYTE *p = (BYTE *)target;
    logmsg("[deleg] target base+0x1389e0 bytes: %02x %02x %02x %02x %02x %02x ...",
           p[0], p[1], p[2], p[3], p[4], p[5]);
    if (!jmp_apply(target, (void *)&delegate_detour, g_deleg_orig)) {
        logmsg("[deleg] patch FAILED"); return;
    }
    g_deleg_target = target;
    g_deleg_hooked = 1;
    logmsg("[deleg] JMP-detoured join-result delegate @0x%llx -> full replacement",
           (unsigned long long)(uintptr_t)target);
}
static void uninstall_delegate(void)
{
    if (!g_deleg_hooked || !g_deleg_target) return;
    jmp_restore(g_deleg_target, g_deleg_orig);
    g_deleg_hooked = 0;
    logmsg("[deleg] delegate hook removed");
}

/* ---------------- generic call-intercept probe (arm/notify) ----------------- */
/* Build the RWX stub: capture retaddr=[rsp], preserve volatiles, call the C
 * logger with (rcx,rdx,r8,r9, retaddr@[rsp+0x20]), then chain to target. */
static int build_probe_stub(probe_t *h)
{
    if (h->detour) return 1;
    BYTE *b = (BYTE *)VirtualAlloc(NULL, 128, MEM_COMMIT | MEM_RESERVE,
                                   PAGE_EXECUTE_READWRITE);
    if (!b) { logmsg("[probe] %s VirtualAlloc failed", h->name); return 0; }
    static const BYTE tmpl[] = {
        0x48,0x8B,0x04,0x24,               /* mov rax,[rsp]  (retaddr)   @0  */
        0x50,0x51,0x52,0x41,0x50,0x41,0x51,0x41,0x52,0x41,0x53, /* push rax,rcx,rdx,r8,r9,r10,r11 @4 */
        0x48,0x83,0xEC,0x30,               /* sub rsp,0x30               @15 */
        0x48,0x89,0x44,0x24,0x20,          /* mov [rsp+0x20],rax (5th arg)@19 */
        0x48,0xB8,0,0,0,0,0,0,0,0,         /* mov rax, imm64 callback    @24 (imm@26) */
        0xFF,0xD0,                         /* call rax                   @34 */
        0x48,0x83,0xC4,0x30,               /* add rsp,0x30               @36 */
        0x41,0x5B,0x41,0x5A,0x41,0x59,0x41,0x58, /* pop r11,r10,r9,r8    @40 */
        0x5A,0x59,0x58,                    /* pop rdx,rcx,rax            @48 */
        0xFF,0x25,0,0,0,0,                 /* jmp [rip+0]                @51 */
        0,0,0,0,0,0,0,0                    /* qword target               @57 */
    };
    memcpy(b, tmpl, sizeof(tmpl));
    memcpy(b + 26, &h->callback, 8);
    memcpy(b + 57, &h->target, 8);
    FlushInstructionCache(GetCurrentProcess(), b, sizeof(tmpl));
    h->detour = b;
    return 1;
}

static void install_probe(probe_t *h)
{
    if (!h->target) h->target = (void *)(g_base + h->off);
    if (!text_decrypted()) return;                 /* never patch packed .text */
    if (InterlockedCompareExchange(&h->hooked, 1, 0) != 0) return;
    if (!build_probe_stub(h)) { h->hooked = 0; return; }
    if (!h->have_orig) {
        if (!mem_readable(h->target, JMP_PATCH_LEN)) {
            logmsg("[probe] %s target unreadable", h->name); h->hooked = 0; return;
        }
        memcpy(h->orig, h->target, JMP_PATCH_LEN);
        h->have_orig = 1;
        logmsg("[probe] %s prologue: %02x %02x %02x %02x %02x %02x ...", h->name,
               h->orig[0], h->orig[1], h->orig[2], h->orig[3], h->orig[4], h->orig[5]);
    }
    BYTE patch[JMP_PATCH_LEN] = { 0xFF, 0x25, 0,0,0,0 };
    memcpy(patch + 6, &h->detour, 8);
    DWORD oldp;
    if (!VirtualProtect(h->target, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) {
        h->hooked = 0; return;
    }
    memcpy(h->target, patch, JMP_PATCH_LEN);
    VirtualProtect(h->target, JMP_PATCH_LEN, oldp, &oldp);
    FlushInstructionCache(GetCurrentProcess(), h->target, JMP_PATCH_LEN);
    logmsg("[probe] %s ARMED at %p -> %p", h->name, h->target, h->detour);
}

static void unhook_probe(probe_t *h)
{
    if (InterlockedCompareExchange(&h->hooked, 0, 1) != 1) return;
    if (!h->have_orig || !h->target) return;
    DWORD oldp;
    if (!VirtualProtect(h->target, JMP_PATCH_LEN, PAGE_EXECUTE_READWRITE, &oldp)) return;
    memcpy(h->target, h->orig, JMP_PATCH_LEN);
    VirtualProtect(h->target, JMP_PATCH_LEN, oldp, &oldp);
    FlushInstructionCache(GetCurrentProcess(), h->target, JMP_PATCH_LEN);
}

/* loggers -- each records args + the caller RETURN address, then self-restores */
static void on_arm_call(void *mgr, uint32_t idx, void *p3, void *p4, void *ret)
{
    logmsg("[arm] FUN_14026ba90 mgr=%p idx=%u p3=%p p4=%p ret=%p (ret=base+0x%llx)",
           mgr, idx, p3, p4, ret,
           (unsigned long long)((uintptr_t)ret - g_base));
    unhook_probe(&g_arm_probe);
}
static void on_notify_call(void *queue, uint32_t idx, void *req, void *a, void *ret)
{
    logmsg("[notify] FUN_140393190 queue=%p idx=%u req=%p a=%p ret=%p (ret=base+0x%llx)",
           queue, idx, req, a, ret,
           (unsigned long long)((uintptr_t)ret - g_base));
    unhook_probe(&g_notify_probe);
}
static void on_ctor_call(void *rcx, uint32_t rdx, void *r8, void *r9, void *ret)
{
    logmsg("[ctor] FUN_14034bd40 this/rcx=%p rdx=%u r8=%p r9=%p ret=%p (ret=base+0x%llx) tid=%lu",
           rcx, rdx, r8, r9, ret,
           (unsigned long long)((uintptr_t)ret - g_base),
           (unsigned long)GetCurrentThreadId());
    unhook_probe(&g_ctor_probe);
}

/* poll-loop maintenance: self-heal + re-arm while active (one-shot self-restore) */
static void probe_poll(probe_t *h)
{
    if (!h->active) return;
    if (h->hooked) {
        if (mem_readable(h->target, 1) && *(volatile BYTE *)h->target != 0xFF)
            h->hooked = 0;                         /* fired+restored, or rewritten */
    }
    if (!h->hooked && !g_in_game_call) install_probe(h);
}

/* fully reset a probe (needed when re-pointing it at a different target: the stub
 * bakes the target address, so a new offset needs a fresh detour + saved bytes) */
static void reset_probe(probe_t *h)
{
    h->active = 0;
    unhook_probe(h);
    if (h->detour) { VirtualFree(h->detour, 0, MEM_RELEASE); h->detour = 0; }
    h->have_orig = 0;
    h->target = 0;
}

/* generic backtrace logger: args + full in-module RtlCaptureStackBackTrace, then
 * chain to the original. Point probe_bt at any base+offset to trace its callers. */
static void on_bt_call(void *rcx, void *rdx, void *r8, void *r9, void *ret)
{
    logmsg("[bt] %p(rcx=%p rdx=%p r8=%p r9=%p) ret=%p (ret=base+0x%llx)",
           g_bt_probe.target, rcx, rdx, r8, r9, ret,
           (unsigned long long)((uintptr_t)ret - g_base));
    if (g_RtlCapture) {
        void *frames[64];
        int want = g_bt_maxframes; if (want < 1) want = 24; if (want > 62) want = 62;
        USHORT nf = g_RtlCapture(1, (ULONG)want, frames, NULL);
        uint64_t modsz = module_size();
        uint64_t lo = g_base, hi = g_base + (modsz ? modsz : 0x4000000ULL);
        for (USHORT i = 0; i < nf; i++) {
            uintptr_t a = (uintptr_t)frames[i];
            if (a >= lo && a < hi)
                logmsg("[bt]   frame[%u] = base+0x%llx", i, (unsigned long long)(a - lo));
        }
    } else {
        logmsg("[bt]   (RtlCaptureStackBackTrace unavailable)");
    }
    unhook_probe(&g_bt_probe);
}

static void result_fail(const char *cmd, const char *err);   /* fwd */

/* Stamp the host lobby-data keys on OUR created lobby so the game's join processor
 * sub_14013b880 -> FUN_1401391e0 ("OwnerId"/slot/binary parser) ACCEPTS it instead of
 * aborting (empty keys -> parse returns 0 -> members never enumerated -> host=0). Runs
 * from the [lc] listener on the MAIN thread inside Steam's own dispatch (the safe context
 * for a Steam CALL), wrapped in the dedicated g_lc crash-guard. SetLobbyData is a
 * synchronous local-cache write, so FUN_1401391e0's GetLobbyData sees it immediately. */
static void lc_set_lobby_data(uint64_t lobby)
{
    if (!lobby) return;
    g_lc_tid = GetCurrentThreadId();
    /* volatile: these are read AFTER a possible longjmp out of the guarded blocks below,
     * so they must survive it (non-volatile locals changed between setjmp/longjmp are
     * indeterminate per C11 7.13.2.1). */
    void * volatile     mm   = NULL;
    void * volatile     setd = NULL;
    volatile uint64_t   ownerId = g_our_steamid ? g_our_steamid : BOX_STEAMID_DEFAULT;

    /* phase 1: resolve matchmaking + (best-effort) GetLobbyOwner(createdId) = the truthful
     * host id (== us, since we own it). A fault here only costs us the truthful owner; we
     * fall back to the box id and STILL do the SetLobbyData writes below. */
    if (__builtin_setjmp(g_lc_jmp) == 0) {
        g_lc_in_call = 1;
        mm   = resolve_iface_raw(IFACE_MM_OFF);
        if (mm) {
            setd       = mm_vfn(mm, MM_VT_SETLOBBYDATA);
            void *geto = mm_vfn(mm, MM_VT_GETLOBBYOWNER);
            if (geto) {
                uint64_t o = ((uint64_t (*)(void *, uint64_t))geto)(mm, lobby);
                if (((o >> 32) & 0xffffffffULL) == 0x01100001ULL) ownerId = o;   /* individual SteamID */
                logmsg("[lcdata] GetLobbyOwner(createdId)=0x%llx -> OwnerId=0x%llx",
                       (unsigned long long)o, (unsigned long long)ownerId);
            }
        }
        g_lc_in_call = 0;
    } else {
        g_lc_in_call = 0;
        logmsg("[lcdata] resolve/GetLobbyOwner FAULTED -- OwnerId fallback=0x%llx",
               (unsigned long long)ownerId);
    }

    if (!mm || !setd) {
        logmsg("[lcdata] matchmaking/SetLobbyData unavailable (mm=%p setd=%p) -- skip", mm, setd);
        return;
    }

    char ownerStr[32];
    snprintf(ownerStr, sizeof(ownerStr), "%016llX", (unsigned long long)ownerId);
    char bindata[129];
    memset(bindata, 0, sizeof(bindata));    /* 128 zero bytes (coordinator: zeros first) */

    typedef int (*setdata_fn)(void *, uint64_t, const char *, const char *);
    setdata_fn sd = (setdata_fn)setd;

    /* phase 2: write every key a205's parser expects, under the crash-guard. */
    if (__builtin_setjmp(g_lc_jmp) == 0) {
        g_lc_in_call = 1;
        int ro = sd(mm, lobby, "OwnerId",         ownerStr);
        int a  = sd(mm, lobby, "SlotPublicMax",   "2");
        int b  = sd(mm, lobby, "SlotPublicOpen",  "1");
        int c  = sd(mm, lobby, "SlotPrivateMax",  "0");
        int d  = sd(mm, lobby, "SlotPrivateOpen", "0");
        int e  = sd(mm, lobby, "SearchKeyNum",    "0");
        int f  = sd(mm, lobby, "BinarySize",      "128");
        int g  = sd(mm, lobby, "BinaryData",      bindata);
        g_lc_in_call = 0;
        logmsg("[lcdata] SetLobbyData lobby=0x%llx OwnerId=%s ok=%d slots=%d%d%d%d "
               "searchnum=%d binsz=%d bindata=%d", (unsigned long long)lobby, ownerStr,
               ro, a, b, c, d, e, f, g);
    } else {
        g_lc_in_call = 0;
        logmsg("[lcdata] SetLobbyData FAULTED -- recovered; lobby data may be incomplete");
    }
}

/* --- LobbyCreated_t listener: Steam calls these on its OWN dispatch (main thread).
 * We only READ the param -> re-entrancy-safe. (MS x64 ABI: this=RCX.) ---------- */
static void cb_lc_run(void *thisptr, void *pParam)
{
    (void)thisptr;
    if (!pParam) return;
    /* LobbyCreated_t is VALVE_CALLBACK_PACK_LARGE (pack(8)), sizeof 16:
     *   EResult m_eResult @0 (4) + 4 pad ; uint64 m_ulSteamIDLobby @8. */
    uint32_t eres  = *(volatile uint32_t *)pParam;
    uint64_t lobby = *(volatile uint64_t *)((char *)pParam + 8);   /* @8, not @4 */
    logmsg("[lc] LobbyCreated_t eResult=%u lobby=0x%llx (tid=%lu)", eres,
           (unsigned long long)lobby, (unsigned long)GetCurrentThreadId());
    if (eres == 1 && lobby) {
        g_created_lobby = lobby;
        /* Stamp the host lobby-data keys FIRST (before we point the game at createdId),
         * so the game's join processor sub_14013b880 -> FUN_1401391e0 parses non-empty
         * OwnerId/slot/binary data and ACCEPTS our lobby instead of aborting. */
        lc_set_lobby_data(lobby);
        /* Wire coord+0x340 = our created lobby so the per-frame host-election
         * (GetLobbyOwner(coord+0x340)==us -> coord+0x3c0=host) makes us HOST.
         * The delegate stashed coord (rcx); fall back to *(base+OFF_COORD_GLOBAL). */
        uint64_t coord = g_deleg_coord;
        if (!coord) rd_u64(g_base + OFF_COORD_GLOBAL, &coord);
        if (coord && mem_readable((void *)(uintptr_t)coord, DELEG_STATUS_OFF + 4)) {
            *(volatile uint64_t *)((char *)(uintptr_t)coord + DELEG_LOBBY_OFF) = lobby;
            *(volatile uint32_t *)((char *)(uintptr_t)coord + DELEG_STATUS_OFF) = 1; /* SUCCESS */
            logmsg("[lc] wired coord+0x340=createdId 0x%llx (coord=0x%llx)",
                   (unsigned long long)lobby, (unsigned long long)coord);
        } else {
            logmsg("[lc] captured createdId 0x%llx but coord not wireable yet (coord=0x%llx)",
                   (unsigned long long)lobby, (unsigned long long)coord);
        }
    }
}
static void cb_lc_run2(void *thisptr, void *pParam, unsigned char bIOFailure, uint64_t hCall)
{
    (void)bIOFailure; (void)hCall;
    cb_lc_run(thisptr, pParam);
}
static int cb_lc_getsize(void *thisptr) { (void)thisptr; return 16; }  /* pack(8) size */

/* register the listener (main-thread task) via SteamAPI_RegisterCallback */
static void mt_do_reglc(void)
{
    if (g_lc_registered) return;
    uint64_t reg_ptr = 0;
    if (!rd_u64(g_base + OFF_REGISTER_CALLBACK, &reg_ptr) || !reg_ptr) {
        logmsg("[lc] SteamAPI_RegisterCallback ptr null (steam not inited?)"); return;
    }
    g_lc_vtable[0] = (void *)&cb_lc_run;      /* Run(pParam)                    */
    g_lc_vtable[1] = (void *)&cb_lc_run2;     /* Run(pParam,bIOFailure,hCall)   */
    g_lc_vtable[2] = (void *)&cb_lc_getsize;  /* GetCallbackSizeBytes()         */
    g_lc_obj.vt = g_lc_vtable;
    g_lc_obj.flags = 0;
    g_lc_obj.iCallback = LOBBYCREATED_T_CBID;
    ((void (*)(void *, int))(uintptr_t)reg_ptr)(&g_lc_obj, LOBBYCREATED_T_CBID);
    g_lc_registered = 1;
    logmsg("[lc] registered LobbyCreated_t listener obj=%p vt=%p reg=0x%llx",
           (void *)&g_lc_obj, (void *)g_lc_vtable, (unsigned long long)reg_ptr);
}

/* --- main-thread task bodies (called from on_mt_call, i.e. on the game thread;
 * use RAW resolvers + direct calls, no crash-guard setjmp) ------------------- */
static void mt_get_steamid_raw(uint64_t *buf_out, uint64_t *rax_out)
{
    uint64_t buf = 0, rax = 0;
    if (g_slot_getsteamid >= 0) {
        void *user = resolve_iface_raw(IFACE_USER_OFF);
        void *f = vslot(user, g_slot_getsteamid);
        if (f) {
            ((void (*)(uint64_t *, void *))f)(&buf, user);   /* hidden-buf form */
            rax = ((uint64_t (*)(void *))f)(user);           /* legacy RAX form */
        }
    }
    if (buf_out) *buf_out = buf;
    if (rax_out) *rax_out = rax;
}

static void mt_do_getsteamid(void)
{
    uint64_t buf = 0, rax = 0;
    mt_get_steamid_raw(&buf, &rax);
    g_our_steamid = buf ? buf : rax;
    char b[320];
    int n = snprintf(b, sizeof(b),
        "{\"ok\":%s,\"cmd\":\"getsteamid\",\"thread\":\"main\",\"buf_form\":\"%llu\","
        "\"rax_form\":\"%llu\",\"buf_hex\":\"0x%llx\",\"rax_hex\":\"0x%llx\"}\n",
        (buf || rax) ? "true" : "false",
        (unsigned long long)buf, (unsigned long long)rax,
        (unsigned long long)buf, (unsigned long long)rax);
    write_file(g_result, b, (DWORD)n);
    logmsg("[cap][MT tid=%lu] GetSteamID buf=0x%llx rax=0x%llx",
           (unsigned long)GetCurrentThreadId(), (unsigned long long)buf,
           (unsigned long long)rax);
}

/* route B (main thread): re-drive the join to OUR created lobby through the game's
 * id-333 GameLobbyJoinRequested handler -- a fresh, fully-wired join that stands up
 * the session and hosts. Best-guess signature: FUN_14012f8f0(this=coord, pParam). */
static void mt_do_rejoin(void)
{
    uint64_t coord = 0;
    if (!rd_u64(g_base + OFF_COORD_GLOBAL, &coord) || !coord) {
        logmsg("[wireB] coord null -- cannot re-drive join"); return;
    }
    struct { uint64_t lobby; uint64_t friend_; } req;
    req.lobby   = g_rejoin_lobby;
    req.friend_ = g_box_id;
    logmsg("[wireB] FUN_14012f8f0(coord=0x%llx, {lobby=0x%llx, friend=0x%llx}) tid=%lu",
           (unsigned long long)coord, (unsigned long long)req.lobby,
           (unsigned long long)req.friend_, (unsigned long)GetCurrentThreadId());
    ((void (*)(void *, void *))(uintptr_t)(g_base + OFF_JOINREQ_HANDLER))
        ((void *)(uintptr_t)coord, &req);
    logmsg("[wireB] id-333 handler returned; the game should re-drive a wired join to "
           "createdId -> host");
}

static void mt_do_capture(void)
{
    if (g_slot_getresult < 0 || !g_hijack_call) {
        result_fail("capture_created", "slots_unset_or_no_handle"); return;
    }
    void *utils = resolve_iface_raw(IFACE_UTILS_OFF);
    getresult_fn gr = (getresult_fn)vslot(utils, g_slot_getresult);
    if (!gr) { result_fail("capture_created", "utils/GetAPICallResult_slot invalid"); return; }
    unsigned char buf[16]; memset(buf, 0, sizeof(buf));
    unsigned char failed = 0; int ok = 0;
    if (g_slot_isdone >= 0) {
        isdone_fn isd = (isdone_fn)vslot(utils, g_slot_isdone);
        if (isd) {
            unsigned char f2 = 0;
            int done = isd(utils, g_hijack_call, &f2);
            logmsg("[cap][MT] IsAPICallCompleted(0x%llx)=%d failed=%d",
                   (unsigned long long)g_hijack_call, done, f2);
        }
    }
    ok = gr(utils, g_hijack_call, buf, LOBBYCREATED_T_SIZE, LOBBYCREATED_T_CBID, &failed);
    uint32_t eres = *(uint32_t *)(buf + 0);
    uint64_t created = *(uint64_t *)(buf + 4);       /* PACKED: id at offset 4 */
    logmsg("[cap][MT tid=%lu] GetAPICallResult ok=%d failed=%d eResult=%u createdId=0x%llx",
           (unsigned long)GetCurrentThreadId(), ok, failed, eres,
           (unsigned long long)created);
    if (ok && !failed && eres == 1 && created) {
        g_created_lobby = created;
        uint64_t owner = 0, dummy = 0;
        mt_get_steamid_raw(&owner, &dummy);
        g_our_steamid = owner;
        char b2[320];
        int n = snprintf(b2, sizeof(b2),
            "{\"ok\":true,\"cmd\":\"capture_created\",\"thread\":\"main\",\"createdId\":\"%llu\","
            "\"createdHex\":\"0x%llx\",\"owner\":\"%llu\"}\n",
            (unsigned long long)created, (unsigned long long)created,
            (unsigned long long)owner);
        write_file(g_result, b2, (DWORD)n);
        logmsg("[cap][MT] READY createdId=0x%llx owner=0x%llx -> selfjoin/wire_lobby",
               (unsigned long long)created, (unsigned long long)owner);
    } else {
        result_fail("capture_created", "result_not_ready (retry / eResult!=1 / bad slot)");
    }
}

/* call26 (MAIN thread): post the create-action FUN_14026a880(manager, a1, a2, 0, 0) on
 * the game main thread. NON-blocking (no wait loop -- the create runs async on the game's
 * worker thread; the operator reads read_lobby ~1s later). Runs under on_mt_call's
 * main-thread crash-guard, so a fault here can never kill the game. */
static void mt_do_call26(void)
{
    uint64_t manager = g_call26_mgr ? g_call26_mgr : get_manager();
    if (!manager) { result_fail("call26", "manager_null_on_main"); return; }
    logmsg("[call26][MT tid=%lu] FUN_14026a880(mgr=0x%llx, a1=0x%x, a2=0x%x, 0, 0)",
           (unsigned long)GetCurrentThreadId(), (unsigned long long)manager,
           (unsigned)g_call26_a1, (unsigned)g_call26_a2);
    create_fn cf = (create_fn)(g_base + OFF_CREATE);
    cf((void *)manager, g_call26_a1, g_call26_a2, 0, 0);
    uint64_t c2 = get_coord(manager); uint8_t il2 = 0;
    if (c2) rd_u8((uintptr_t)c2 + COORD_IN_LOBBY, &il2);
    logmsg("[call26][MT] posted; coord=0x%llx in_lobby=%u (read_lobby after ~1s for coord+0x340)",
           (unsigned long long)c2, il2);
    char b[224];
    int n = snprintf(b, sizeof(b),
        "{\"ok\":true,\"cmd\":\"call26\",\"thread\":\"main\",\"posted\":true,"
        "\"manager\":\"0x%llx\",\"coord\":\"0x%llx\",\"in_lobby\":%u}\n",
        (unsigned long long)manager, (unsigned long long)c2, il2);
    write_file(g_result, b, (DWORD)n);
}

/* main-thread dispatcher: runs on the MAIN thread; executes queued tasks under a
 * MAIN-THREAD crash-guard so a faulting task can NEVER kill the game. */
static void on_mt_call(void *rcx, void *rdx, void *r8, void *r9, void *ret)
{
    (void)rcx; (void)rdx; (void)r8; (void)r9; (void)ret;
    g_mt_tid = GetCurrentThreadId();
    if (__builtin_setjmp(g_mt_jmp) == 0) {
        g_mt_in_task = 1;
        if (g_nav_pending) {
            uint64_t coord = 0;
            if (rd_u64(g_base + OFF_COORD_GLOBAL, &coord) && coord &&
                mem_readable((void *)(uintptr_t)coord, 0x430)) {
                uintptr_t c = (uintptr_t)coord; DWORD oldp;
                if (VirtualProtect((void *)(c + NAV_PENDING_ID), 0x1a0, PAGE_READWRITE, &oldp)) {
                    *(volatile uint64_t *)(c + NAV_PENDING_ID) = g_nav_lobby;
                    memset((void *)(c + NAV_MEMSET_OFF), 0, NAV_MEMSET_LEN);
                    *(volatile uint64_t *)(c + NAV_LOBBY_ID) = g_nav_lobby;
                    *(volatile uint32_t *)(c + NAV_FLAG_ON)  = 1;
                    *(volatile uint32_t *)(c + NAV_FLAG_OFF) = 0;
                    VirtualProtect((void *)(c + NAV_PENDING_ID), 0x1a0, oldp, &oldp);
                    g_nav_pending = 0;
                    logmsg("[nav] pending-join SET on MAIN thread tid=%lu coord=0x%llx lobby=0x%llx",
                           (unsigned long)GetCurrentThreadId(), (unsigned long long)coord,
                           (unsigned long long)g_nav_lobby);
                }
            }
        }
        if (g_mt_reglc)   { mt_do_reglc();      g_mt_reglc = 0; }
        if (g_mt_getid)   { mt_do_getsteamid(); g_mt_getid = 0; }
        if (g_mt_capture) { mt_do_capture();    g_mt_capture = 0; }
        if (g_mt_rejoin)  { mt_do_rejoin();     g_mt_rejoin = 0; }
        if (g_mt_call26)  { mt_do_call26();     g_mt_call26 = 0; }
        g_mt_in_task = 0;
        if (!g_nav_pending && !g_mt_getid && !g_mt_capture && !g_mt_reglc &&
            !g_mt_rejoin && !g_mt_call26)
            g_mt_probe.active = 0;
    } else {
        /* a main-thread task FAULTED -- recover, report, disarm (game preserved) */
        g_mt_in_task = 0;
        logmsg("[GUARD-MT] main-thread task FAULTED -- error result + disarm; game preserved");
        result_fail("mt_task", "main_thread_task_faulted (likely Steam-call re-entrancy) -- disarmed");
        g_nav_pending = 0; g_mt_getid = 0; g_mt_capture = 0; g_mt_call26 = 0;
        g_mt_probe.active = 0;
    }
    unhook_probe(&g_mt_probe);
}

/* queue a task + arm the main-thread hook */
static void mt_arm(void)
{
    g_mt_probe.callback = (void *)&on_mt_call;
    g_mt_probe.target   = (void *)(g_base + OFF_FRAME_CONSUMER);
    g_mt_probe.off      = OFF_FRAME_CONSUMER;
    g_mt_probe.active   = 1;
    install_probe(&g_mt_probe);
}

/* ------------------- persistent CM object state-watch (reads only) ---------- */
static volatile LONG g_watch_cm = 0;
static uint64_t g_cm_obj = 0;
static DWORD    g_watch_start = 0;
static const struct { uint64_t off; int size; const char *label; } g_cm_fields[] = {
    { 0x0b0, 4, "type" },
    { 0x168, 4, "sm+0x08" },
    { 0x16c, 4, "sm+0x0c" },
    { 0x170, 4, "STATE(sm+0x10)" },
    { 0x174, 1, "flag174" },
    { 0x175, 1, "flag175" },
    { 0x176, 1, "flag176" },
    { 0x177, 1, "flag177" },
    { 0x178, 4, "sm+0x18" },
    { 0x17c, 4, "sm+0x1c" },
    { 0x180, 8, "steamSMptr(sm+0x20)" },
    { 0x788, 8, "timer(sm+0x628)" },
    { 0x790, 4, "counter(sm+0x630)" },
};
#define CM_NFIELDS ((int)(sizeof(g_cm_fields)/sizeof(g_cm_fields[0])))
static uint64_t g_cm_last[CM_NFIELDS];
static int g_cm_have_base = 0;

/* read one field (1/4/8 bytes) into a uint64_t; 0 on failure */
static int cm_read(uint64_t addr, int size, uint64_t *out)
{
    if (size == 1) { uint8_t v; if (!rd_u8(addr, &v)) return 0; *out = v; return 1; }
    if (size == 4) { uint32_t v; if (!rd_u32(addr, &v)) return 0; *out = v; return 1; }
    if (size == 8) { return rd_u64(addr, out); }
    return 0;
}

/* scan a pointer array for an element whose vtable == CM vtable; return it or 0 */
static uint64_t cm_scan_array(uint64_t base_obj, uint64_t arr_off, uint64_t cnt_off, uint64_t vt)
{
    uint32_t cnt = 0; rd_u32(base_obj + cnt_off, &cnt);
    if (cnt > 64) cnt = 64;
    for (uint32_t i = 0; i < cnt; i++) {
        uint64_t p = 0, cv = 0;
        if (rd_u64(base_obj + arr_off + (uint64_t)i * 8, &p) && p &&
            rd_u64(p, &cv) && cv == vt)
            return p;
    }
    return 0;
}

/* Resolve the persistent CM object by its vtable. Caches g_cm_obj; re-scans if lost. */
static uint64_t resolve_cm_obj(void)
{
    uint64_t manager = get_manager();
    if (!manager) return 0;
    uint64_t vt = g_base + OFF_CM_VTABLE, cv = 0;
    if (g_cm_obj && rd_u64(g_cm_obj, &cv) && cv == vt) return g_cm_obj;
    g_cm_obj = 0;
    /* 4 session slots at manager+0x250..+0x268 */
    for (int i = 0; i < 4; i++) {
        uint64_t cand = 0;
        if (rd_u64(manager + 0x250 + (uint64_t)i * 8, &cand) && cand &&
            rd_u64(cand, &cv) && cv == vt) { g_cm_obj = cand; return cand; }
    }
    /* fallback: pointer arrays at manager+0x178 and session0+0x178 */
    uint64_t hit = cm_scan_array(manager, 0x178, 0x978, vt);
    if (!hit) {
        uint64_t s0 = 0;
        if (rd_u64(manager + 0x250, &s0) && s0)
            hit = cm_scan_array(s0, 0x178, 0x978, vt);
    }
    if (hit) g_cm_obj = hit;
    return g_cm_obj;
}

static void watch_cm_tick(int log_all)
{
    uint64_t obj = resolve_cm_obj();
    if (!obj) { if (log_all) logmsg("[cm] CM object not found yet (vtable base+0x%llx)",
                                    (unsigned long long)OFF_CM_VTABLE); return; }
    DWORD t = GetTickCount() - g_watch_start;
    for (int i = 0; i < CM_NFIELDS; i++) {
        uint64_t v = 0;
        if (!cm_read(obj + g_cm_fields[i].off, g_cm_fields[i].size, &v)) continue;
        if (log_all || (g_cm_have_base && v != g_cm_last[i]))
            logmsg("[cm] t=%-6lu off=0x%03llx %-20s 0x%llx -> 0x%llx",
                   (unsigned long)t, (unsigned long long)g_cm_fields[i].off,
                   g_cm_fields[i].label,
                   (unsigned long long)(g_cm_have_base ? g_cm_last[i] : 0),
                   (unsigned long long)v);
        g_cm_last[i] = v;
    }
    g_cm_have_base = 1;
}

/* -------- steamSM WRAPPER object state-watch (the REAL create trigger) -------
 * steamSM = *(void**)(cm_obj+0x180). Its per-tick update runs vtable[0xa]; the
 * create only fires when the wrapper's OWN state says "create requested" (what
 * the Create button sets). Watch a generous span for the field that flips. */
#define SM_SPAN   0x800ULL
#define SM_NDW    ((int)(SM_SPAN / 4))
static volatile LONG g_watch_sm = 0;
static uint64_t g_sm_obj = 0;
static DWORD    g_watch_sm_start = 0;
static uint32_t g_sm_last[SM_NDW];
static int      g_sm_have_base = 0;

static uint64_t resolve_sm_obj(void)
{
    uint64_t cm = resolve_cm_obj();
    if (!cm) return 0;
    uint64_t sm = 0;
    if (!rd_u64(cm + CM_STEAMSM_FIELD, &sm) || !sm) return 0;
    if (!mem_readable((void *)(uintptr_t)sm, 8)) return 0;
    return sm;
}

static void watch_sm_tick(int log_all)
{
    uint64_t obj = resolve_sm_obj();
    if (!obj) { if (log_all) logmsg("[sm] steamSM not resolved (cm+0x180 null?)"); return; }
    if (obj != g_sm_obj) {
        g_sm_obj = obj; g_sm_have_base = 0;
        logmsg("[sm] steamSM=0x%llx (re)resolved", (unsigned long long)obj);
    }
    DWORD t = GetTickCount() - g_watch_sm_start;
    for (int d = 0; d < SM_NDW; d++) {
        uint32_t v = 0;
        if (!rd_u32(obj + (uint64_t)d * 4, &v)) continue;
        if (log_all || (g_sm_have_base && v != g_sm_last[d]))
            logmsg("[sm] t=%-6lu off=0x%03x 0x%08x -> 0x%08x",
                   (unsigned long)t, (unsigned)(d * 4),
                   g_sm_have_base ? g_sm_last[d] : 0, v);
        g_sm_last[d] = v;
    }
    g_sm_have_base = 1;
}

/* ------------------------------------------------------- vectored handler */
/* Handles (a) the HW-BP capture single-step and (b) the game-call crash-guard.
 * The JMP-detour capture path does NOT use exceptions. */
static LONG NTAPI veh(PEXCEPTION_POINTERS ep)
{
    EXCEPTION_RECORD *er = ep->ExceptionRecord;
    DWORD code = er->ExceptionCode;

    /* (a) HW-BP capture: DR0 execute-break fired at FUN_14026a880 (fault, args
     * intact). Cache, then clear this thread's DR + set RF so the instruction
     * runs on resume. One-shot: poll loop clears the other threads. */
    if (g_hw_armed && code == EXCEPTION_SINGLE_STEP) {
        CONTEXT *c = ep->ContextRecord;
        if (er->ExceptionAddress == g_target || (c->Dr6 & 0x1)) {
            g_matchId = (LONG)(c->Rdx & 0xffffffff);
            g_mode    = (LONG)(c->R8  & 0xffffffff);
            g_last_manager = (uint64_t)c->Rcx;
            g_have_capture = 1;
            g_capture_dirty = 1;
            g_hw_fired = 1;
            c->Dr0 = 0;
            c->Dr7 &= ~(DWORD64)1;      /* disable L0 on this thread          */
            c->Dr6 = 0;
            c->EFlags |= 0x10000;       /* RF: don't re-trap the same insn    */
            c->ContextFlags |= CONTEXT_DEBUG_REGISTERS;
            return EXCEPTION_CONTINUE_EXECUTION;
        }
    }

    /* (b) crash-guard for our own game calls (helper thread) */
    if (g_in_game_call && GetCurrentThreadId() == g_helper_tid &&
        code != EXCEPTION_BREAKPOINT && code != EXCEPTION_SINGLE_STEP &&
        (code & 0xC0000000) == 0xC0000000) {
        logmsg("[GUARD] exception 0x%08lx at %p during game call -- recovering "
               "(netplay may be wedged; restart game if create stops working)",
               (unsigned long)code, er->ExceptionAddress);
        g_in_game_call = 0;
        __builtin_longjmp(g_jmp, 1);
    }

    /* (c) MAIN-thread crash-guard: a fault in a marshaled main-thread task must
     * NEVER kill the game -- recover to on_mt_call's setjmp. */
    if (g_mt_in_task && GetCurrentThreadId() == g_mt_tid &&
        code != EXCEPTION_BREAKPOINT && code != EXCEPTION_SINGLE_STEP &&
        (code & 0xC0000000) == 0xC0000000) {
        logmsg("[GUARD-MT] exception 0x%08lx at %p in main-thread task -- recovering",
               (unsigned long)code, er->ExceptionAddress);
        g_mt_in_task = 0;
        __builtin_longjmp(g_mt_jmp, 1);
    }

    /* (d) [lc]-listener crash-guard: SetLobbyData/GetLobbyOwner from the LobbyCreated
     * callback must NEVER kill the game -- recover to lc_set_lobby_data's setjmp. */
    if (g_lc_in_call && GetCurrentThreadId() == g_lc_tid &&
        code != EXCEPTION_BREAKPOINT && code != EXCEPTION_SINGLE_STEP &&
        (code & 0xC0000000) == 0xC0000000) {
        logmsg("[GUARD-LC] exception 0x%08lx at %p in LobbyCreated data-write -- recovering",
               (unsigned long)code, er->ExceptionAddress);
        g_lc_in_call = 0;
        __builtin_longjmp(g_lc_jmp, 1);
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

/* --------------------------------------------------------------- persistence */
static void persist_capture(void)
{
    char buf[256];
    int n = snprintf(buf, sizeof(buf),
                      "matchId=%ld mode=%ld manager=0x%llx\r\n",
                      (long)g_matchId, (long)g_mode,
                      (unsigned long long)g_last_manager);
    if (n > 0) append_bytes(g_capture, buf, (DWORD)n);   /* append: keep history */
    logmsg("[capture] host params matchId=%ld mode=%ld manager=0x%llx (SAVED)",
           (long)g_matchId, (long)g_mode,
           (unsigned long long)g_last_manager);
}

/* parse the LAST "matchId=<d> mode=<d>" line from the capture file at startup */
static void load_capture(void)
{
    HANDLE h = CreateFileW(g_capture, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return;
    char buf[4096]; DWORD rd = 0;
    if (!ReadFile(h, buf, sizeof(buf) - 1, &rd, NULL)) { CloseHandle(h); return; }
    CloseHandle(h);
    buf[rd] = 0;
    int found = 0, mi = 0, mo = 0;
    char *p = buf;
    while ((p = strstr(p, "matchId=")) != NULL) {
        int a = 0, b = 0;
        if (sscanf(p, "matchId=%d mode=%d", &a, &b) == 2) { mi = a; mo = b; found = 1; }
        p += 8;
    }
    if (found) {
        g_matchId = mi; g_mode = mo; g_have_capture = 1;
        logmsg("[capture] loaded from file: matchId=%d mode=%d", mi, mo);
    }
}

/* --------------------------------------------------------------- results */
static void result_fail(const char *cmd, const char *err)
{
    char buf[512];
    int n = snprintf(buf, sizeof(buf),
                      "{\"ok\":false,\"cmd\":\"%s\",\"error\":\"%s\",\"ts\":%llu}\n",
                      cmd, err, (unsigned long long)time(NULL));
    if (n > 0) write_file(g_result, buf, (DWORD)n);
    logmsg("[result] FAIL cmd=%s error=%s", cmd, err);
}

static void result_ok_create(uint64_t lobby, uint64_t companion)
{
    char buf[512];
    int n = snprintf(buf, sizeof(buf),
        "{\"ok\":true,\"cmd\":\"create\",\"lobby_id\":\"%llu\","
        "\"companion\":\"%llu\",\"ts\":%llu}\n",
        (unsigned long long)lobby, (unsigned long long)companion,
        (unsigned long long)time(NULL));
    if (n > 0) write_file(g_result, buf, (DWORD)n);
    logmsg("[result] OK create lobby_id=%llu companion=%llu",
           (unsigned long long)lobby, (unsigned long long)companion);
}

static void result_ok_simple(const char *cmd)
{
    char buf[256];
    int n = snprintf(buf, sizeof(buf),
                      "{\"ok\":true,\"cmd\":\"%s\",\"ts\":%llu}\n",
                      cmd, (unsigned long long)time(NULL));
    if (n > 0) write_file(g_result, buf, (DWORD)n);
    logmsg("[result] OK cmd=%s", cmd);
}

/* --------------------------------------------------------------- commands */
/* FULLY-STATIC create -- replicates FUN_140066f00 case 1 exactly, so it needs NO
 * prior manual create and NO capture click:
 *   matchId = FUN_14006cf10(*(u64*)(base+0xbd3ca0));   // allocate slot id
 *   if (FUN_14026b270(manager, matchId, 0) == 0)       // not already present
 *       FUN_14026a880(manager, matchId, 2, 0, 0);      // post create, mode=2 */

/* shared tail: wait for a fresh lobby id at coord+0x340, write result */
static void wait_and_report(uint64_t manager)
{
    uint64_t lob = 0, comp = 0;
    for (int i = 0; i < 240; i++) {              /* up to ~12s */
        uint64_t c = get_coord(manager);
        if (c && rd_u64((uintptr_t)c + COORD_LOBBY_ID, &lob) && lob != 0) {
            rd_u64((uintptr_t)c + COORD_COMPANION, &comp);
            break;
        }
        Sleep(50);
    }
    if (lob) result_ok_create(lob, comp);
    else     result_fail("create", "created_no_lobby_id_timeout (posted but "
                         "coord+0x340 stayed 0 -- check log)");
}

/* DEFAULT create = CAPTURE-AND-REPLAY. We reuse the (matchId, mode) the game
 * itself passed on a real manual create (observed by the JMP hook), instead of
 * synthesizing an id (the top-menu allocator returns 0). Requires one prior
 * manual create so the hook has captured. */
static void do_create(void)
{
    uint64_t manager = get_manager();
    if (!manager) {
        result_fail("create", "netplay_not_initialized (manager null -- enter an "
                    "online/netplay screen first)");
        return;
    }
    uint64_t coord = get_coord(manager);
    if (session_active(coord) == 1) {
        result_fail("create", "session_already_active (leave first, or already hosting)");
        return;
    }
    if (!g_have_capture) {
        result_fail("create", "no_capture_yet (do ONE manual create so the hook "
                    "records the real matchId/mode, then retry -- see log/.ready)");
        return;
    }

    int matchId = g_matchId, mode = g_mode;
    unhook_create();   /* our own POST must run clean, not via the detour */
    if (!text_decrypted()) {
        result_fail("create", "not_decrypted_yet (FUN_14026a880 still packed -- open "
                    "the online menu so .text decrypts)");
        return;
    }

    logmsg("[create] REPLAY: FUN_14026a880(mgr=0x%llx, matchId=%d, mode=%d, 0, 0)",
           (unsigned long long)manager, matchId, mode);

    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        exists_fn ef = (exists_fn)(g_base + OFF_SESSION_EXISTS);
        create_fn cf = (create_fn)(g_base + OFF_CREATE);
        void *ex = ef((void *)manager, (uint32_t)matchId, 0);
        if (ex != 0)
            logmsg("[create] note: SESSION_EXISTS(matchId=%d)=%p (nonzero) -- posting "
                   "anyway to prove replay", matchId, ex);
        cf((void *)manager, matchId, mode, 0, 0);
        g_in_game_call = 0;
        wait_and_report(manager);
    } else {
        g_in_game_call = 0;
        result_fail("create", "exception_during_create_call (see log; netplay "
                    "likely wedged -- restart game)");
    }
}

/* EXPERIMENTAL: the pure-static allocate-then-post path (menu case 1). Known to
 * return matchId=0 from the top-menu state; kept as a diagnostic command so we
 * can probe whether it yields a valid id from deeper menu states. */
static void do_create_static(void)
{
    uint64_t manager = get_manager();
    if (!manager) { result_fail("create_static", "netplay_not_initialized"); return; }
    if (session_active(get_coord(manager)) == 1) {
        result_fail("create_static", "session_already_active"); return;
    }
    uint64_t mgr2 = 0;
    if (!rd_u64(g_base + OFF_SESSION_MGR2_GLOBAL, &mgr2) || !mgr2) {
        result_fail("create_static", "session_mgr2_null (open the menu first)"); return;
    }
    unhook_create();
    if (!text_decrypted()) {
        result_fail("create_static", "not_decrypted_yet (open the online menu first)");
        return;
    }
    logmsg("[create_static] mgr=0x%llx mgr2=0x%llx (mode=%d)",
           (unsigned long long)manager, (unsigned long long)mgr2, HOST_MODE);
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        alloc_id_fn af = (alloc_id_fn)(g_base + OFF_ALLOC_MATCH_ID);
        exists_fn   ef = (exists_fn)(g_base + OFF_SESSION_EXISTS);
        create_fn   cf = (create_fn)(g_base + OFF_CREATE);
        uint32_t matchId = af((void *)mgr2);
        logmsg("[create_static] alloc matchId=%u", matchId);
        if (ef((void *)manager, matchId, 0) == 0)
            cf((void *)manager, (int)matchId, HOST_MODE, 0, 0);
        else
            logmsg("[create_static] matchId=%u already present (skip post)", matchId);
        g_in_game_call = 0;
        wait_and_report(manager);
    } else {
        g_in_game_call = 0;
        result_fail("create_static", "exception_during_create_call (see log)");
    }
}

/* call26 <hexArg1> <hexArg2> [main]: fire the game's OWN create-action poster
 *   FUN_14026a880(manager, arg1, arg2, 0, 0)          @ base+0x26a880 (__fastcall)
 *   manager = *(u64*)(base+0x2ebccb8)
 * This is the CREATE path -- the game's worker thread then runs the full real
 * CreateLobby -> SetLobbyData -> SetLobbyJoinable -> host handshake = a REAL HOST
 * netplay session (what a manual Create produces), sidestepping the join-hijack's
 * joiner wall. arg1=HOST_MATCH_ID, arg2=HOST_MODE (capture them once with `cap26`).
 * Command thread first (crash-guarded); on a fault, or with a 'main' suffix, marshal
 * to the game MAIN thread. */
static void do_call26(const char *arg)
{
    if (!arg || !*arg) { result_fail("call26", "need_hexArg1_hexArg2 [main]"); return; }
    char *e = NULL;
    uint64_t a1 = strtoull(arg, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    if (!*e) { result_fail("call26", "need_TWO_hex_args (arg1 arg2 -- e.g. 'call26 1 2')"); return; }
    uint64_t a2 = strtoull(e, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    int force_main = (*e == 'm' || *e == 'M');

    uint64_t manager = get_manager();
    if (!manager) {
        result_fail("call26", "netplay_not_initialized (manager null -- enter an online screen first)");
        return;
    }
    uint64_t coord = get_coord(manager);
    int sa = session_active(coord);
    uint8_t in_lobby = 0; if (coord) rd_u8((uintptr_t)coord + COORD_IN_LOBBY, &in_lobby);
    if (sa == 1) { result_fail("call26", "session_already_active (leave first, or already hosting)"); return; }
    if (!text_decrypted()) {
        result_fail("call26", "not_decrypted_yet (FUN_14026a880 still packed -- open the online menu)");
        return;
    }

    logmsg("[call26] PRE manager=0x%llx coord=0x%llx in_lobby=%u session_active=%d -> "
           "FUN_14026a880(mgr, a1=0x%llx, a2=0x%llx, 0, 0) %s",
           (unsigned long long)manager, (unsigned long long)coord, in_lobby, sa,
           (unsigned long long)a1, (unsigned long long)a2,
           force_main ? "[MAIN THREAD]" : "[cmd thread]");

    unhook_create();   /* our own POST must run clean, not via the capture detour */

    if (force_main) {
        g_call26_mgr = manager; g_call26_a1 = (int)a1; g_call26_a2 = (int)a2;
        g_mt_call26 = 1; mt_arm();
        result_ok_simple("call26_queued_main_thread (read_lobby after ~1s)");
        return;
    }

    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        create_fn cf = (create_fn)(g_base + OFF_CREATE);
        cf((void *)manager, (int)a1, (int)a2, 0, 0);
        g_in_game_call = 0;
        uint64_t c2 = get_coord(manager); uint8_t il2 = 0;
        if (c2) rd_u8((uintptr_t)c2 + COORD_IN_LOBBY, &il2);
        logmsg("[call26] POST (cmd thread) coord=0x%llx in_lobby=%u -- waiting for coord+0x340",
               (unsigned long long)c2, il2);
        wait_and_report(manager);
    } else {
        g_in_game_call = 0;
        logmsg("[call26] FAULT on cmd thread -- retrying on the game MAIN thread");
        g_call26_mgr = manager; g_call26_a1 = (int)a1; g_call26_a2 = (int)a2;
        g_mt_call26 = 1; mt_arm();
        result_fail("call26", "cmd_thread_faulted_retrying_on_main_thread (read_lobby after ~1s)");
    }
}

static void do_leave(void)
{
    uint64_t manager = get_manager();
    if (!manager) { result_fail("leave", "netplay_not_initialized"); return; }
    if (!text_decrypted()) {
        result_fail("leave", "not_decrypted_yet (open the online menu first)"); return;
    }
    logmsg("[leave] calling FUN_14026acd0(manager=0x%llx, 7)",
           (unsigned long long)manager);
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        leave_fn fn = (leave_fn)(g_base + OFF_LEAVE);
        fn((void *)manager, 7);
        g_in_game_call = 0;
        result_ok_simple("leave");
    } else {
        g_in_game_call = 0;
        result_fail("leave", "exception_during_leave_call (see log)");
    }
}

/* PRIMARY capture: arm the JMP detour -- but only NOW (issued at the online menu,
 * well past the startup window where an early .text patch crashed launch), and
 * only over a decrypted prologue. */
static void do_capture_arm(void)
{
    if (!prologue_decrypted()) {
        result_fail("capture", "not_decrypted_yet (issue 'capture' at the online "
                    "menu once FUN_14026a880's first byte reaches 0x48)");
        return;
    }
    install_jmp_hook();
    result_ok_simple(g_hooked ? "capture_armed_jmp" : "capture_arm_failed");
}

/* FALLBACK capture: hardware breakpoint (DR0) -- modifies NO code, so it cannot
 * trip a code-integrity check. Use if arming the JMP still crashes/wedges. */
static void do_capture_hw(void)
{
    if (!prologue_decrypted()) {
        result_fail("capture_hw", "not_decrypted_yet (issue at the online menu)");
        return;
    }
    if (g_hooked) unhook_create();   /* don't mix the two mechanisms */
    arm_hw_bp();
    result_ok_simple(g_hw_armed ? "capture_hw_armed" : "capture_hw_failed");
}

/* DIAGNOSTIC: hook ISteamMatchmaking::CreateLobby (vtable slot swap -- no code
 * patched, no anti-tamper risk) to find the REAL Custom Match create-initiator.
 * Issue at the online menu, THEN do a manual Custom Match create -> the log shows
 * CreateLobby's args + a stack walk (base+offset -> Ghidra) up to the initiator. */
static void do_probe_cl(void)
{
    install_createlobby_hook();
    result_ok_simple(g_cl_hooked ? "createlobby_hook_installed"
                                 : "createlobby_hook_failed (see log)");
}

/* Arm the join->create hijack + keep the CreateLobby backstop so we confirm the fire. */
static void do_host_via_join(void)
{
    install_createlobby_hook();      /* backstop: confirm CreateLobby fires */
    install_join_hijack();
    g_created_lobby = 0;             /* reset; the LobbyCreated cb will fill it */
    g_deleg_coord = 0;               /* reset; the delegate stashes the fresh coord */
    g_rejoin_fired = 0;
    if (!g_lc_registered) { g_mt_reglc = 1; mt_arm(); }   /* register listener */
    /* THE definitive wire: detour the game's own join-result delegate + set
     * coord+0x340=createdId -> per-frame GetLobbyOwner==us -> HOST. */
    install_delegate(); g_deleg_armed = 1;
    g_wireA2_armed = g_wireA3_armed = g_wireB_enabled = 0;   /* GetAPICallResult hooks never fire; off */
    logmsg("[host] armed: delegate(base+0x1389e0)=%s -- send the join now",
           g_deleg_hooked ? "yes" : "NO");
    result_ok_simple(g_hijack_armed ? "host_via_join_armed" : "host_via_join_failed");
}

/* Toggle the delegate wire independently: `wire_deleg on` | `wire_deleg off`. */
static void do_wire_deleg(const char *arg)
{
    if (arg && _stricmp(arg, "off") == 0) {
        uninstall_delegate(); g_deleg_armed = 0;
        result_ok_simple("wire_deleg_off"); return;
    }
    install_delegate();
    g_deleg_armed = 1;
    result_ok_simple(g_deleg_hooked ? "wire_deleg_on" : "wire_deleg_failed");
}

/* Toggle route A3 independently: `wire_a3 on` | `wire_a3 off`. */
static void do_wire_a3(const char *arg)
{
    if (arg && _stricmp(arg, "off") == 0) {
        uninstall_wireA3(); g_wireA3_armed = 0;
        result_ok_simple("wire_a3_off"); return;
    }
    install_wireA3();
    g_wireA3_armed = 1;
    result_ok_simple(g_wireA3_hooked ? "wire_a3_on" : "wire_a3_failed");
}

/* Toggle route A' independently: `wire_a2 on` | `wire_a2 off`. */
static void do_wire_a2(const char *arg)
{
    if (arg && _stricmp(arg, "off") == 0) {
        uninstall_wireA2(); g_wireA2_armed = 0;
        result_ok_simple("wire_a2_off"); return;
    }
    if (g_slot_getresult < 0) { result_fail("wire_a2", "slot_unset (set_slots <GetAPICallResult>)"); return; }
    install_wireA2();
    g_wireA2_armed = 1;
    result_ok_simple(g_wireA2_hooked ? "wire_a2_on" : "wire_a2_failed");
}

/* Toggle route B independently: `wire_b on` | `wire_b off`. */
static void do_wire_b(const char *arg)
{
    g_wireB_enabled = !(arg && _stricmp(arg, "off") == 0);
    result_ok_simple(g_wireB_enabled ? "wire_b_on" : "wire_b_off");
}

/* Override our own SteamID (m_steamIDFriend for the re-drive). Accepts dec or hex. */
static void do_set_ourid(const char *arg)
{
    if (!arg || !*arg) { result_fail("set_ourid", "need_id (dec or 0xhex)"); return; }
    g_box_id = strtoull(arg, NULL, 0);
    logmsg("[wireB] our id set to %llu (0x%llx)", (unsigned long long)g_box_id,
           (unsigned long long)g_box_id);
    result_ok_simple("ourid_set");
}

/* Toggle wire-A independently: `wire_a on` | `wire_a off`. */
static void do_wire_a(const char *arg)
{
    if (arg && _stricmp(arg, "off") == 0) {
        uninstall_wireA();
        result_ok_simple("wire_a_off");
        return;
    }
    if (g_slot_getresult < 0) { result_fail("wire_a", "slot_unset (set_slots <GetAPICallResult>)"); return; }
    install_wireA();
    g_wireA_armed = 1;
    result_ok_simple(g_wireA_hooked ? "wire_a_on" : "wire_a_failed");
}

/* Standalone: register the LobbyCreated_t listener (marshaled to main thread). */
static void do_register_lc(void)
{
    if (g_lc_registered) { result_ok_simple("lc_already_registered"); return; }
    g_mt_reglc = 1;
    mt_arm();
    result_ok_simple("register_lc_queued");
}

/* Report the created lobby id captured by the LobbyCreated_t listener. */
static void do_read_created(void)
{
    char b[256];
    int n = snprintf(b, sizeof(b),
        "{\"ok\":%s,\"cmd\":\"read_created\",\"createdId\":\"%llu\",\"createdHex\":\"0x%llx\","
        "\"registered\":%s}\n",
        g_created_lobby ? "true" : "false",
        (unsigned long long)g_created_lobby, (unsigned long long)g_created_lobby,
        g_lc_registered ? "true" : "false");
    write_file(g_result, b, (DWORD)n);
    logmsg("[lc] read_created=0x%llx registered=%d",
           (unsigned long long)g_created_lobby, (int)g_lc_registered);
}

/* PRIMARY producer-finder: intercept the arm primitive FUN_14026ba90 and log its
 * args + RETURN address (the CM-create handler). Also keeps the CreateLobby hook
 * as the ground-truth backstop. Do a manual Custom Match create after issuing. */
static void do_probe_arm(void)
{
    if (!text_decrypted()) {
        result_fail("probe_arm", "not_decrypted_yet (issue at the online menu)");
        return;
    }
    g_arm_probe.callback = (void *)&on_arm_call;
    g_arm_probe.target   = (void *)(g_base + OFF_ARM_SLOT);
    g_arm_probe.active   = 1;
    install_probe(&g_arm_probe);
    install_createlobby_hook();            /* backstop */
    logmsg("[probe] arm-primitive intercept active; do a manual Custom Match create "
           "-> [arm] lines show idx/p3/p4/ret. ret=base+0x.. is the CM handler.");
    result_ok_simple(g_arm_probe.hooked ? "probe_arm_active" : "probe_arm_failed");
}

/* FALLBACK: intercept the notify primitive FUN_140393190 directly (in case the CM
 * post bypasses FUN_14026ba90). NOTE: this fn is high-frequency, so the one-shot
 * self-restore + re-arm samples it -- expect many [notify] lines; find the one
 * whose ret is in the CM-create region / whose idx matches. */
static void do_probe_notify(void)
{
    if (!text_decrypted()) {
        result_fail("probe_notify", "not_decrypted_yet (issue at the online menu)");
        return;
    }
    g_notify_probe.callback = (void *)&on_notify_call;
    g_notify_probe.target   = (void *)(g_base + OFF_NOTIFY_POST);
    g_notify_probe.active   = 1;
    install_probe(&g_notify_probe);
    result_ok_simple(g_notify_probe.hooked ? "probe_notify_active" : "probe_notify_failed");
}

/* Intercept the CM session CONSTRUCTOR FUN_14034bd40: its return address is the
 * MENU handler that builds+links the session (the producer to define `create`),
 * and its tid tells us which thread must run the eventual call. */
static void do_probe_ctor(void)
{
    if (!text_decrypted()) {
        result_fail("probe_ctor", "not_decrypted_yet (issue at the online menu)");
        return;
    }
    g_ctor_probe.callback = (void *)&on_ctor_call;
    g_ctor_probe.target   = (void *)(g_base + OFF_CM_CTOR);
    g_ctor_probe.active   = 1;
    install_probe(&g_ctor_probe);
    install_createlobby_hook();            /* backstop */
    logmsg("[probe] CM-ctor intercept active; do a manual Custom Match create -> "
           "[ctor] line's ret=base+0x.. is the menu Create handler, tid its thread.");
    result_ok_simple(g_ctor_probe.hooked ? "probe_ctor_active" : "probe_ctor_failed");
}

/* GENERIC backtrace probe: detour base+<off> and log args + a full in-module
 * backtrace on each call, then chain. Point it at any menu fn to trace callers. */
static void do_probe_bt(const char *arg)
{
    if (!arg || !*arg) { result_fail("probe_bt", "need_hexoffset [maxframes]"); return; }
    if (!text_decrypted()) {
        result_fail("probe_bt", "not_decrypted_yet (issue at a menu)"); return;
    }
    char *e = NULL;
    uint64_t off = strtoull(arg, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    g_bt_maxframes = *e ? (int)strtoul(e, NULL, 0) : 24;
    void *newtarget = (void *)(uintptr_t)(g_base + off);
    if (g_bt_probe.target != newtarget) reset_probe(&g_bt_probe);   /* re-point */
    g_bt_probe.callback = (void *)&on_bt_call;
    g_bt_probe.target   = newtarget;
    g_bt_probe.off      = off;
    g_bt_probe.active   = 1;
    install_probe(&g_bt_probe);
    logmsg("[bt] probe armed at base+0x%llx (maxframes=%d); trigger the code path -> "
           "[bt] logs args + backtrace.", (unsigned long long)off, g_bt_maxframes);
    result_ok_simple(g_bt_probe.hooked ? "probe_bt_active" : "probe_bt_failed");
}

/* Pure in-process "enter online + pending-join <id>". Sets pending-join on the
 * MAIN thread (via a hook on FUN_140054100) so the game navigates online + calls
 * JoinLobby(id) -- which host_via_join hijacks into a hosted CreateLobby. */
static void do_nav_online(const char *arg)
{
    if (!arg || !*arg) { result_fail("nav_online", "need_hexLobbyID"); return; }
    if (!text_decrypted()) { result_fail("nav_online", "not_decrypted_yet"); return; }
    g_nav_lobby = strtoull(arg, NULL, 16);
    uint64_t coord = 0;
    int coord_ready = (rd_u64(g_base + OFF_COORD_GLOBAL, &coord) && coord);
    g_nav_pending = 1;
    mt_arm();
    logmsg("[nav] armed on FUN_140054100 for lobby=0x%llx (coord %s); pending-join "
           "will be written on the next main-thread frame.",
           (unsigned long long)g_nav_lobby, coord_ready ? "ready" : "null-now/retry");
    result_ok_simple(g_mt_probe.hooked ? "nav_online_armed" : "nav_online_failed");
}

/* Watch the persistent CM object's state fields (reads only, ~5ms). Log on change. */
static void do_watch_cm(void)
{
    uint64_t obj = resolve_cm_obj();
    if (!obj) {
        result_fail("watch_cm", "cm_obj_not_found (enter the online/custom-match menu "
                    "so the CM object exists)");
        return;
    }
    uint64_t vt = 0; rd_u64(obj, &vt);
    logmsg("[cm] === WATCH obj=0x%llx vtable=0x%llx (base+0x%llx) ===",
           (unsigned long long)obj, (unsigned long long)vt,
           (unsigned long long)(vt - g_base));
    g_cm_have_base = 0;
    g_watch_start = GetTickCount();
    watch_cm_tick(1);            /* baseline dump */
    install_createlobby_hook();  /* backstop: see the tick CreateLobby fires */
    g_watch_cm = 1;
    result_ok_simple("watch_cm_active");
}

/* VirtualProtect-guarded writes to game memory */
static int poke32(uint64_t addr, uint32_t val)
{
    DWORD oldp;
    if (!VirtualProtect((void *)(uintptr_t)addr, 4, PAGE_READWRITE, &oldp)) return 0;
    *(volatile uint32_t *)(uintptr_t)addr = val;
    VirtualProtect((void *)(uintptr_t)addr, 4, oldp, &oldp);
    return 1;
}
static int poke64(uint64_t addr, uint64_t val)
{
    DWORD oldp;
    if (!VirtualProtect((void *)(uintptr_t)addr, 8, PAGE_READWRITE, &oldp)) return 0;
    *(volatile uint64_t *)(uintptr_t)addr = val;
    VirtualProtect((void *)(uintptr_t)addr, 8, oldp, &oldp);
    return 1;
}
static int poke8(uint64_t addr, uint8_t val)
{
    DWORD oldp;
    if (!VirtualProtect((void *)(uintptr_t)addr, 1, PAGE_READWRITE, &oldp)) return 0;
    *(volatile uint8_t *)(uintptr_t)addr = val;
    VirtualProtect((void *)(uintptr_t)addr, 1, oldp, &oldp);
    return 1;
}

/* read the live lobby id/owner from the coordinator (coord+0x340 / +0x348) */
static void report_lobby(const char *cmd)
{
    uint64_t manager = get_manager();
    uint64_t coord = get_coord(manager);
    uint64_t lob = 0, comp = 0;
    if (coord) {
        for (int i = 0; i < 200; i++) {        /* wait up to ~10s for the id */
            coord = get_coord(manager);
            if (coord && rd_u64((uintptr_t)coord + COORD_LOBBY_ID, &lob) && lob) {
                rd_u64((uintptr_t)coord + COORD_COMPANION, &comp);
                break;
            }
            Sleep(50);
        }
    }
    if (lob) result_ok_create(lob, comp);
    else     result_fail(cmd, "no_lobby_id (coord+0x340 stayed 0 -- create did not "
                         "stand up a lobby)");
}

/* Poke the CM state field obj+0x170 (replicate test). Explicit only. */
static void do_poke_cm(const char *arg)
{
    uint64_t obj = resolve_cm_obj();
    if (!obj) { result_fail("poke_cm", "cm_obj_not_found"); return; }
    if (!arg || !*arg) { result_fail("poke_cm", "need_hex_dword_arg"); return; }
    uint32_t val = (uint32_t)strtoul(arg, NULL, 16);
    uint64_t addr = obj + CM_STATE_FIELD;
    uint32_t old = 0; rd_u32(addr, &old);
    if (!poke32(addr, val)) { result_fail("poke_cm", "vprotect_failed"); return; }
    logmsg("[cm] POKE obj+0x170 STATE: 0x%x -> 0x%x", old, val);
    result_ok_simple("poke_cm_done");
}

/* Watch the steamSM wrapper object (the create trigger lives here). reads only. */
static void do_watch_sm(void)
{
    uint64_t obj = resolve_sm_obj();
    if (!obj) {
        result_fail("watch_sm", "steamSM_null (cm_obj+0x180 not set -- be on the "
                    "Create-Lobby screen)");
        return;
    }
    uint64_t vt = 0; rd_u64(obj, &vt);
    logmsg("[sm] === WATCH steamSM=0x%llx vtable=0x%llx (base+0x%llx) span=0x%llx ===",
           (unsigned long long)obj, (unsigned long long)vt,
           (unsigned long long)(vt - g_base), (unsigned long long)SM_SPAN);
    g_sm_obj = obj; g_sm_have_base = 0; g_watch_sm_start = GetTickCount();
    watch_sm_tick(1);            /* baseline dump */
    install_createlobby_hook();  /* backstop: see the tick CreateLobby fires */
    g_watch_sm = 1;
    result_ok_simple("watch_sm_active");
}

/* Poke a u32 in the steamSM wrapper: "poke_sm <hexoff> <hexval>". */
static void do_poke_sm(const char *arg)
{
    uint64_t obj = resolve_sm_obj();
    if (!obj) { result_fail("poke_sm", "steamSM_null"); return; }
    if (!arg || !*arg) { result_fail("poke_sm", "need_two_hex_args (off val)"); return; }
    char *end = NULL;
    unsigned long off = strtoul(arg, &end, 16);
    while (*end == ' ' || *end == '\t') end++;
    if (!*end) { result_fail("poke_sm", "need_two_hex_args (off val)"); return; }
    uint32_t val = (uint32_t)strtoul(end, NULL, 16);
    uint64_t addr = obj + off;
    uint32_t old = 0; rd_u32(addr, &old);
    if (!poke32(addr, val)) { result_fail("poke_sm", "vprotect_failed"); return; }
    logmsg("[sm] POKE steamSM+0x%lx: 0x%x -> 0x%x", off, old, val);
    result_ok_simple("poke_sm_done");
}

/* PRIMARY replicate: drive the persistent CM object's state machine into its
 * state-6 create branch by writing counter=0, timer=1, state=6 (in that order).
 * The game's OWN tick then calls FUN_14015b150 -> CreateLobby (game-thread; the
 * enqueue is lock-protected). Pure memory writes = zero cross-thread risk. */
static void do_create_poke(void)
{
    uint64_t obj = resolve_cm_obj();
    if (!obj) {
        result_fail("create_poke", "cm_obj_not_found (be on the Create-Lobby screen)");
        return;
    }
    uint64_t sm = 0;
    if (!rd_u64(obj + CM_STEAMSM_FIELD, &sm) || !sm) {
        result_fail("create_poke", "steamSM_ptr_null (obj+0x180 not set -- not on the "
                    "Create-Lobby screen yet)");
        return;
    }
    install_createlobby_hook();               /* backstop: see the fire */
    int ok = 1;
    ok &= poke32(obj + CM_COUNTER_FIELD, 0);  /* counter < 1 */
    ok &= poke64(obj + CM_TIMER_FIELD, 1);    /* timer != 0 && <= now */
    ok &= poke32(obj + CM_STATE_FIELD, 6);    /* state == 6 -> fire on next tick */
    logmsg("[cm] CREATE_POKE obj=0x%llx wrote state=6 timer=1 counter=0 (writes_ok=%d)",
           (unsigned long long)obj, ok);
    if (!ok) { result_fail("create_poke", "vprotect_failed"); return; }
    report_lobby("create_poke");              /* confirm a REAL lobby stood up */
}

/* FALLBACK replicate: call the create primitive FUN_14015b150 directly from the
 * helper thread (enqueue is lock-protected). Use if the state-6 poke races with
 * the object's own state writes. */
static void do_call_create(void)
{
    uint64_t obj = resolve_cm_obj();
    if (!obj) { result_fail("call_create", "cm_obj_not_found"); return; }
    uint64_t sm = 0;
    if (!rd_u64(obj + CM_STEAMSM_FIELD, &sm) || !sm) {
        result_fail("call_create", "steamSM_ptr_null (obj+0x180)"); return;
    }
    if (!text_decrypted()) { result_fail("call_create", "not_decrypted_yet"); return; }
    void *arg2 = (void *)(uintptr_t)(obj + CM_MSG_FIELD);
    logmsg("[cm] CALL_CREATE FUN_14015b150(steamSM=0x%llx, msg=obj+0x188=%p)",
           (unsigned long long)sm, arg2);
    typedef void (*createprim_fn)(void *steamSM, void *msg);
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        createprim_fn fn = (createprim_fn)(g_base + OFF_CREATE_PRIM);
        fn((void *)(uintptr_t)sm, arg2);
        g_in_game_call = 0;
        install_createlobby_hook();
        report_lobby("call_create");
    } else {
        g_in_game_call = 0;
        result_fail("call_create", "exception_during_call (see log)");
    }
}

/* Read the current hosted lobby id/owner (for the steam://joinlobby link). */
static void do_read_lobby(void)
{
    uint64_t manager = get_manager();
    uint64_t coord = get_coord(manager);
    if (!coord) { result_fail("read_lobby", "coord_null (not in netplay yet)"); return; }
    uint64_t lob = 0, owner = 0; uint32_t state = 0; uint8_t oflag = 0, inlob = 0;
    rd_u64((uintptr_t)coord + COORD_LOBBY_ID, &lob);
    rd_u64((uintptr_t)coord + COORD_COMPANION, &owner);   /* owner CSteamID cache */
    rd_u32((uintptr_t)coord + COORD_STATE, &state);
    rd_u8((uintptr_t)coord + COORD_OWNER_FLAG, &oflag);
    rd_u8((uintptr_t)coord + COORD_IN_LOBBY, &inlob);
    char buf[512];
    int n = snprintf(buf, sizeof(buf),
        "{\"ok\":%s,\"cmd\":\"read_lobby\",\"lobby_id\":\"%llu\",\"owner\":\"%llu\","
        "\"owner_flag\":%u,\"in_lobby\":%u,\"state\":%u,"
        "\"join\":\"steam://joinlobby/2634890/%llu/%llu\",\"ts\":%llu}\n",
        lob ? "true" : "false",
        (unsigned long long)lob, (unsigned long long)owner,
        oflag, inlob, state,
        (unsigned long long)lob, (unsigned long long)owner,
        (unsigned long long)time(NULL));
    if (n > 0) write_file(g_result, buf, (DWORD)n);
    logmsg("[lobby] id=%llu owner=%llu owner_flag=%u in_lobby=%u state=%u",
           (unsigned long long)lob, (unsigned long long)owner, oflag, inlob, state);
}

/* press_create capture callback: FUN_140066f00's Update runs = the user is on the
 * Create-Lobby screen. Its `this` (rcx) is the create-action object we set +0x1184=1
 * on. Stash it (validated: readable + *(obj) is an in-module vtable), then self-restore.
 * Runs on the GAME thread; one-shot (poll re-arms only while active). */
static void on_pc_update(void *rcx, void *rdx, void *r8, void *r9, void *ret)
{
    (void)rdx; (void)r8; (void)r9; (void)ret;
    uint64_t obj = (uint64_t)rcx;
    if (obj && mem_readable((void *)(uintptr_t)obj, CREATE_ACTION_STATE_FLAG + 4)) {
        uint64_t vt = 0;
        if (rd_u64(obj, &vt)) {
            uint64_t modsz = module_size();
            uint64_t lo = g_base, hi = g_base + (modsz ? modsz : 0x4000000ULL);
            if (vt >= lo && vt < hi) {
                if (g_pc_obj != obj)
                    logmsg("[press_create] captured create-action obj=0x%llx vt=base+0x%llx (tid=%lu)",
                           (unsigned long long)obj, (unsigned long long)(vt - g_base),
                           (unsigned long)GetCurrentThreadId());
                g_pc_obj = obj;
            }
        }
    }
    unhook_probe(&g_pc_probe);
}

/* press_create: the CLEAN memory-level "press the Create button". Capture the live
 * create-action object via the FUN_140066f00 Update hook, then set the single flag the
 * Enter key sets -- obj+0x1184 = 1 -- and let the framework's own per-frame state
 * machine run states 1..5 (async gate + full netplay bring-up). Precondition: the user
 * must be ON the Create-Lobby screen (object live + config populated). */
static void do_press_create(void)
{
    if (!text_decrypted()) {
        result_fail("press_create", "not_decrypted_yet (open the online/Create menu first)");
        return;
    }
    /* arm the capture hook (fires on the game thread each frame the Update runs) */
    g_pc_probe.callback = (void *)&on_pc_update;
    g_pc_probe.target   = (void *)(g_base + OFF_CREATE_MENU_UPDATE);
    g_pc_probe.off      = OFF_CREATE_MENU_UPDATE;
    g_pc_probe.active   = 1;
    install_probe(&g_pc_probe);
    logmsg("[press_create] armed FUN_140066f00 capture hook (hooked=%ld) -- be on the "
           "Create-Lobby screen", (long)g_pc_probe.hooked);

    /* wait up to ~2s for the Update to fire and stash the live object */
    uint64_t obj = 0;
    for (int i = 0; i < 40; i++) { obj = g_pc_obj; if (obj) break; Sleep(50); }

    /* disarm the hook now -- we have the object, and the framework must run
     * FUN_140066f00 UNIMPEDED to drive states 1..5. */
    g_pc_probe.active = 0;
    unhook_probe(&g_pc_probe);

    if (!obj) {
        result_fail("press_create", "no_create_action_object (FUN_140066f00 never ran -- "
                    "be on the Create-Lobby screen, then retry)");
        return;
    }

    uint32_t flag = 0xffffffff;
    if (!rd_u32((uintptr_t)obj + CREATE_ACTION_STATE_FLAG, &flag)) {
        g_pc_obj = 0;
        result_fail("press_create", "obj+0x1184_unreadable (object went stale)");
        return;
    }
    uint32_t pa0 = 0, pb0 = 0;
    rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_A, &pa0);
    rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_B, &pb0);
    logmsg("[press_create] obj=0x%llx PRE +0x1184=%u (+0x390=0x%x +0x394=0x%x)",
           (unsigned long long)obj, flag, pa0, pb0);

    /* Block ONLY when a create sequence is actively mid-flight. Empirically the
     * Create-Lobby screen RESTS at flag==5 (idle-ready), and Enter writes 1 from
     * there. States 1..4 are the running sequence -> refuse those; fire from any
     * other (resting) value. */
    if (flag >= 1 && flag <= 4) {
        char e[176];
        snprintf(e, sizeof(e), "flag_not_idle (+0x1184=%u -- a create sequence is already "
                 "in progress; wait for it or `leave` first)", flag);
        result_fail("press_create", e);
        return;
    }

    /* THE press: set the one flag the Enter key sets. */
    if (!poke32((uintptr_t)obj + CREATE_ACTION_STATE_FLAG, 1)) {
        result_fail("press_create", "poke_failed (+0x1184 not writable)");
        return;
    }
    uint32_t after = 0; rd_u32((uintptr_t)obj + CREATE_ACTION_STATE_FLAG, &after);
    logmsg("[press_create] PRESSED obj+0x1184: %u -> %u ; framework will run states 1..5",
           flag, after);

    /* poll ~8s for the host lobby to stand up; snapshot the state-progress fields. */
    uint64_t manager = get_manager();
    uint64_t lob = 0;
    for (int i = 0; i < 160; i++) {
        Sleep(50);
        uint32_t pa = 0, pb = 0, fl = 0;
        rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_A, &pa);
        rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_B, &pb);
        rd_u32((uintptr_t)obj + CREATE_ACTION_STATE_FLAG, &fl);
        uint64_t c = get_coord(manager);
        lob = 0; if (c) rd_u64((uintptr_t)c + COORD_LOBBY_ID, &lob);
        if ((i % 20) == 0 || lob)
            logmsg("[press_create] t=+%dms +0x1184=%u +0x390=0x%x +0x394=0x%x coord=0x%llx lobby=0x%llx",
                   i * 50, fl, pa, pb, (unsigned long long)c, (unsigned long long)lob);
        if (lob) break;
    }
    uint32_t paF = 0, pbF = 0;
    rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_A, &paF);
    rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_B, &pbF);
    logmsg("[press_create] DONE poll: obj+0x390=0x%x obj+0x394=0x%x lobby=0x%llx "
           "(want 0x14/0x3 + a lobby)", paF, pbF, (unsigned long long)lob);
    do_read_lobby();   /* final host-check: owner_flag=1 + joinable lobby_id? */
}

/* watch_pc <ms>: OBSERVE-ONLY (never writes). Re-captures the live create-action
 * object, then samples obj+0x1184 / +0x390 / +0x394 (and the coord lobby id) every
 * 25ms for <ms> and logs on ANY change. Use it to watch the game's OWN Create
 * sequence when the user presses Enter manually -- this reveals the true resting
 * value, the exact 5->1->..->lobby progression, and validates the press_create
 * recipe before we trust the hands-free write. Default 15000ms. */
static void do_watch_pc(const char *arg)
{
    if (!text_decrypted()) {
        result_fail("watch_pc", "not_decrypted_yet (open the online/Create menu first)");
        return;
    }
    int ms = (arg && *arg) ? (int)strtoul(arg, NULL, 0) : 15000;
    if (ms < 500)   ms = 500;
    if (ms > 60000) ms = 60000;

    /* (re)capture the object -- one-shot hook, self-disarms in on_pc_update */
    g_pc_probe.callback = (void *)&on_pc_update;
    g_pc_probe.target   = (void *)(g_base + OFF_CREATE_MENU_UPDATE);
    g_pc_probe.off      = OFF_CREATE_MENU_UPDATE;
    g_pc_probe.active   = 1;
    install_probe(&g_pc_probe);
    uint64_t obj = 0;
    for (int i = 0; i < 40; i++) { obj = g_pc_obj; if (obj) break; Sleep(50); }
    g_pc_probe.active = 0;
    unhook_probe(&g_pc_probe);
    if (!obj) {
        result_fail("watch_pc", "no_create_action_object (be on the Create-Lobby screen)");
        return;
    }

    uint64_t manager = get_manager();
    uint32_t lf = 0xffffffff, la = 0xffffffff, lb = 0xffffffff;
    uint64_t llob = 0xffffffffffffffffULL;
    logmsg("[watch_pc] OBSERVING obj=0x%llx for %d ms -- PRESS ENTER on the Create "
           "screen now (no memory is written)", (unsigned long long)obj, ms);
    int iters = ms / 25;
    for (int i = 0; i < iters; i++) {
        Sleep(25);
        uint32_t fl = 0, pa = 0, pb = 0;
        rd_u32((uintptr_t)obj + CREATE_ACTION_STATE_FLAG, &fl);
        rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_A, &pa);
        rd_u32((uintptr_t)obj + CREATE_ACTION_PROG_B, &pb);
        uint64_t c = get_coord(manager);
        uint64_t lob = 0; if (c) rd_u64((uintptr_t)c + COORD_LOBBY_ID, &lob);
        if (fl != lf || pa != la || pb != lb || lob != llob) {
            logmsg("[watch_pc] t=+%dms +0x1184=%u +0x390=0x%x +0x394=0x%x lobby=0x%llx",
                   i * 25, fl, pa, pb, (unsigned long long)lob);
            lf = fl; la = pa; lb = pb; llob = lob;
        }
    }
    char summary[128];
    snprintf(summary, sizeof(summary),
             "watch_pc_done (last +0x1184=%u +0x390=0x%x +0x394=0x%x lobby=0x%llx)",
             lf, la, lb, (unsigned long long)llob);
    result_ok_simple(summary);
}

/* Dump the Steam interface-singleton pointer table (matchmaking=+0x20). Reveals
 * ISteamUtils/ISteamUser offsets (their vtbl base+off) so we can call
 * GetAPICallResult / GetSteamID to capture the created lobby id + own SteamID. */
static void do_dump_singleton(const char *arg)
{
    int n = (arg && *arg) ? (int)strtoul(arg, NULL, 0) : 32;
    if (n < 1) n = 1;
    if (n > 128) n = 128;
    void *si = resolve_singleton();
    if (!si) { result_fail("dump_singleton", "singleton_null (Steam not up yet?)"); return; }
    uint64_t modsz = module_size(), mlo = g_base, mhi = g_base + (modsz ? modsz : 0x4000000ULL);
    logmsg("[si] singleton=%p (dumping %d qwords; matchmaking=+0x20)", si, n);
    for (int i = 0; i < n; i++) {
        uint64_t q = 0;
        if (!rd_u64((uintptr_t)si + (uint64_t)i * 8, &q) || !q) continue;
        uint64_t vt = 0; int hasvt = 0;
        if (mem_readable((void *)(uintptr_t)q, 8) && rd_u64(q, &vt) && vt >= mlo && vt < mhi)
            hasvt = 1;
        if (hasvt) logmsg("[si] +0x%03x = 0x%llx  vtbl=base+0x%llx", (unsigned)(i * 8),
                          (unsigned long long)q, (unsigned long long)(vt - g_base));
        else       logmsg("[si] +0x%03x = 0x%llx", (unsigned)(i * 8), (unsigned long long)q);
    }
    result_ok_simple("dump_singleton_done");
}

/* Route (b) direct session-wire test: write a (real, created) lobby id + owner
 * into the coordinator so read_lobby shows us as OWNER. Supply the created lobby
 * id (from the [hijack] trace / GetAPICallResult) + optionally our SteamID. */
static void do_wire_lobby(const char *arg)
{
    if (!arg || !*arg) { result_fail("wire_lobby", "need_hexLobbyID [hexOwnerID]"); return; }
    char *e = NULL;
    uint64_t lobby = strtoull(arg, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    uint64_t owner = *e ? strtoull(e, NULL, 16) : 0;
    uint64_t manager = get_manager();
    uint64_t coord = get_coord(manager);
    if (!coord) { result_fail("wire_lobby", "coord_null (not in netplay)"); return; }
    poke64(coord + COORD_LOBBY_ID, lobby);
    if (owner) poke64(coord + COORD_COMPANION, owner);
    poke8(coord + COORD_OWNER_FLAG, 1);
    poke8(coord + COORD_IN_LOBBY, 1);
    logmsg("[wire] coord=0x%llx wrote lobby=0x%llx owner=0x%llx owner_flag=1 in_lobby=1",
           (unsigned long long)coord, (unsigned long long)lobby, (unsigned long long)owner);
    do_read_lobby();
}

/* set the version-specific Steam vtable slot indices (from your Ghidra pass):
 *   set_slots <GetAPICallResult_idx> <GetSteamID_idx> [IsAPICallCompleted_idx] */
static void do_set_slots(const char *arg)
{
    if (!arg || !*arg) {
        result_fail("set_slots", "need <GetAPICallResult_idx> <GetSteamID_idx> [IsAPICallCompleted_idx]");
        return;
    }
    char *e = NULL;
    long gr = strtol(arg, &e, 0);
    while (*e == ' ' || *e == '\t') e++;
    long gid = *e ? strtol(e, &e, 0) : -1;
    while (*e == ' ' || *e == '\t') e++;
    long isd = *e ? strtol(e, NULL, 0) : -1;
    g_slot_getresult = (int)gr;
    g_slot_getsteamid = (int)gid;
    g_slot_isdone = (int)isd;
    logmsg("[cap] slots set: GetAPICallResult=%d GetSteamID=%d IsAPICallCompleted=%d",
           (int)gr, (int)gid, (int)isd);
    result_ok_simple("slots_set");
}

/* Steam vtable calls MUST run on the game main thread (steamclient bridge is
 * main/callback-thread bound; off-thread returns 0). So these commands MARSHAL:
 * queue the task + arm the FUN_140054100 main-thread hook; the result file is
 * (over)written by the main-thread worker (mt_do_*) within a few frames. */
static void do_getsteamid(void)
{
    if (g_slot_getsteamid < 0) { result_fail("getsteamid", "slot_unset (set_slots first)"); return; }
    g_mt_getid = 1;
    mt_arm();
    char b[192];
    int n = snprintf(b, sizeof(b),
        "{\"ok\":true,\"cmd\":\"getsteamid\",\"queued\":true,"
        "\"note\":\"marshaled to main thread; re-read result in ~150ms\"}\n");
    write_file(g_result, b, (DWORD)n);
    logmsg("[cap] getsteamid queued -> main thread");
}

static void do_capture_created(void)
{
    if (g_slot_getresult < 0) { result_fail("capture_created", "slots_unset (set_slots first)"); return; }
    if (!g_hijack_call) { result_fail("capture_created", "no_create_handle (run host_via_join first)"); return; }
    g_mt_capture = 1;
    mt_arm();
    char b[192];
    int n = snprintf(b, sizeof(b),
        "{\"ok\":true,\"cmd\":\"capture_created\",\"queued\":true,"
        "\"note\":\"marshaled to main thread; re-read result in ~150ms\"}\n");
    write_file(g_result, b, (DWORD)n);
    logmsg("[cap] capture_created queued -> main thread (hCall=0x%llx)",
           (unsigned long long)g_hijack_call);
}

/* Route (2a) test: drive the game to JOIN its own created lobby through the
 * REAL JoinLobby (hook bypassed). We OWN it, so self-join == host, and the game's
 * normal LobbyEnter path wires the session. Supply the created lobby id. Then the
 * 8s progression poll shows whether in_session/owner light up. */
static void do_selfjoin(const char *arg)
{
    if (!arg || !*arg) { result_fail("selfjoin", "need_hexLobbyID"); return; }
    uint64_t id = strtoull(arg, NULL, 16);
    void *mm = resolve_matchmaking();
    if (!mm) { result_fail("selfjoin", "matchmaking_null"); return; }
    void **vtbl = *(void ***)mm;
    /* use the ORIGINAL JoinLobby (never our thunk, to avoid re-hijack) */
    joinlobby_fn jl = 0;
    if (g_hijack_armed && g_hijack_join_orig) jl = (joinlobby_fn)g_hijack_join_orig;
    else if (mem_readable((char *)vtbl + MM_VT_JOINLOBBY, 8))
        jl = *(joinlobby_fn *)((char *)vtbl + MM_VT_JOINLOBBY);
    if (!jl) { result_fail("selfjoin", "joinlobby_slot_null"); return; }
    install_createlobby_hook();          /* keep the backstop */
    uint64_t h = 0;
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        h = jl(mm, id);
        g_in_game_call = 0;
        logmsg("[selfjoin] real JoinLobby(0x%llx) -> handle=0x%llx",
               (unsigned long long)id, (unsigned long long)h);
        g_hj_have_last = 0;               /* watch the session wire up */
        g_hijack_poll_start = GetTickCount();
        g_hijack_poll_pending = 1;
        result_ok_simple("selfjoin_issued");
    } else {
        g_in_game_call = 0;
        result_fail("selfjoin", "exception_during_joinlobby (see log)");
    }
}

static void write_ready(void);   /* fwd */

/* post-create progression poll for host_via_join (helper thread, ~8s). Logs the
 * coord/lobby/owner/in_session/state progression so we see exactly how far the
 * hijack chain gets, then dumps the final read_lobby + heartbeat. */
static void hijack_poll_tick(void)
{
    if (!g_hijack_poll_pending) return;
    DWORD t = GetTickCount() - g_hijack_poll_start;
    uint64_t coord = 0; rd_u64(g_base + OFF_COORD_GLOBAL, &coord);
    uint64_t lobby = 0, owner = 0, gate = 0, myrec = 0; uint32_t state = 0;
    uint8_t hostflag = 0;
    if (coord) {
        rd_u64(coord + COORD_LOBBY_ID, &lobby);
        rd_u64(coord + COORD_COMPANION, &owner);
        rd_u64(coord + COORD_GATE, &gate);
        rd_u32(coord + COORD_STATE, &state);
        rd_u8(coord + COORD_OWNER_FLAG, &hostflag);   /* +0x3c0 host=1 */
        rd_u64(coord + 0x13fb0, &myrec);              /* my member record ptr */
    }
    int insess = gate != 0;
    /* Re-assert the session wire until the machine is ACTIVE: if we have a captured
     * createdId but coord+0x340 has drifted off it (a later delegate/menu write), put
     * it back so the per-frame host-election keeps resolving GetLobbyOwner(us)=host.
     * Stop once in_session (gate!=0) so we don't fight the live session state. */
    if (g_created_lobby && coord && !insess && lobby != g_created_lobby &&
        mem_readable((void *)(uintptr_t)coord, DELEG_STATUS_OFF + 4)) {
        *(volatile uint64_t *)((char *)(uintptr_t)coord + DELEG_LOBBY_OFF) = g_created_lobby;
        *(volatile uint32_t *)((char *)(uintptr_t)coord + DELEG_STATUS_OFF) = 1;
        logmsg("[hijack] t=+%lums re-assert coord+0x340=createdId 0x%llx (was 0x%llx)",
               (unsigned long)t, (unsigned long long)g_created_lobby,
               (unsigned long long)lobby);
        lobby = g_created_lobby;
    }
    if (!g_hj_have_last || lobby != g_hj_last_lobby || owner != g_hj_last_owner ||
        insess != g_hj_last_insession || state != g_hj_last_state ||
        hostflag != g_hj_last_host) {
        logmsg("[hijack] t=+%lums coord=0x%llx lobby_id=0x%llx owner=0x%llx "
               "in_session=%d state=%u HOST(+0x3c0)=%u myrec(+0x13fb0)=0x%llx",
               (unsigned long)t, (unsigned long long)coord, (unsigned long long)lobby,
               (unsigned long long)owner, insess, state, hostflag,
               (unsigned long long)myrec);
        g_hj_last_lobby = lobby; g_hj_last_owner = owner;
        g_hj_last_insession = insess; g_hj_last_state = state; g_hj_last_host = hostflag;
        g_hj_have_last = 1;
    }
    if (g_created_lobby && g_created_lobby != g_hj_last_created) {
        logmsg("[hijack] t=+%lums LobbyCreated captured createdId=0x%llx (from cb)",
               (unsigned long)t, (unsigned long long)g_created_lobby);
        g_hj_last_created = g_created_lobby;
    }
    /* route B: once we have createdId AND the failed first join has settled,
     * re-drive a wired join to OUR lobby (marshaled to the main thread). */
    if (g_wireB_enabled && g_created_lobby && !g_rejoin_fired && t >= 1500) {
        g_rejoin_lobby = g_created_lobby;
        g_rejoin_fired = 1;
        g_mt_rejoin = 1;
        mt_arm();
        logmsg("[wireB] t=+%lums queuing re-drive join to createdId=0x%llx (main thread)",
               (unsigned long)t, (unsigned long long)g_created_lobby);
    }
    if (t >= 8000) {
        g_hijack_poll_pending = 0;
        logmsg("[hijack] === poll done (8s). createdId=0x%llx  Final read_lobby: ===",
               (unsigned long long)g_created_lobby);
        do_read_lobby();     /* writes the result file + [lobby] log line */
        write_ready();       /* refresh nobd_arcade.ready heartbeat snapshot */
    }
}

/* -------------------- menu_snap: empirical screen-state + field finder -------
 * Snapshots regions to nobd_arcade.snap, tagged by <label>, sampling each region
 * 5x over ~100ms to flag per-dword stability (so the offline diff drops flicker).
 * Regions: A = .data state globals (base+0x2eb0000, 64KB), B = the CM object
 * (0x2078), C = the kcode/input area (base+0xac6000, 8KB, best-effort for menu
 * input). Diff across labels: stable-per-screen + differs-across = screen-state;
 * differs-when-a-setting-changes = that field's offset. */
#define SNAP_SAMPLES 5

/* page-safe bulk read: readable pages copied, unmapped pages zero-filled */
static void read_region_safe(BYTE *dest, uint64_t base, uint64_t size)
{
    uint64_t off = 0;
    while (off < size) {
        uint64_t addr = base + off;
        uint64_t chunk = 0x1000 - (addr & 0xFFF);      /* to next page boundary */
        if (chunk > size - off) chunk = size - off;
        if (mem_readable((void *)(uintptr_t)addr, chunk))
            memcpy(dest + off, (void *)(uintptr_t)addr, (size_t)chunk);
        else
            memset(dest + off, 0, (size_t)chunk);
        off += chunk;
    }
}

/* sample a region SNAP_SAMPLES times; write per-dword lines to handle h:
 *   "<tag> +0x<off> <hexval> <.|~>"  (~ = flickered within the 100ms window) */
static void snap_region(HANDLE h, const char *tag, uint64_t base, uint64_t size)
{
    int ndw = (int)(size / 4);
    BYTE *first = (BYTE *)VirtualAlloc(NULL, (SIZE_T)size, MEM_COMMIT, PAGE_READWRITE);
    BYTE *cur   = (BYTE *)VirtualAlloc(NULL, (SIZE_T)size, MEM_COMMIT, PAGE_READWRITE);
    BYTE *unst  = (BYTE *)VirtualAlloc(NULL, (SIZE_T)ndw,  MEM_COMMIT, PAGE_READWRITE);
    SIZE_T txtcap = (SIZE_T)ndw * 32 + 128;
    char  *txt  = (char *)VirtualAlloc(NULL, txtcap, MEM_COMMIT, PAGE_READWRITE);
    if (!first || !cur || !unst || !txt) { logmsg("[snap] alloc failed for %s", tag); goto done; }

    read_region_safe(first, base, size);
    for (int s = 1; s < SNAP_SAMPLES; s++) {
        Sleep(20);
        read_region_safe(cur, base, size);
        for (int d = 0; d < ndw; d++)
            if (((uint32_t *)cur)[d] != ((uint32_t *)first)[d]) unst[d] = 1;
    }

    size_t p = 0;
    p += (size_t)snprintf(txt + p, txtcap - p,
                          "--- region %s base=0x%llx size=0x%llx ---\n",
                          tag, (unsigned long long)base, (unsigned long long)size);
    for (int d = 0; d < ndw; d++) {
        uint32_t v = ((uint32_t *)first)[d];
        p += (size_t)snprintf(txt + p, txtcap - p, "%s +0x%05x %08x %c\n",
                              tag, (unsigned)(d * 4), v, unst[d] ? '~' : '.');
        if (p > txtcap - 64) break;   /* safety */
    }
    { DWORD wr = 0; WriteFile(h, txt, (DWORD)p, &wr, NULL); }
done:
    if (first) VirtualFree(first, 0, MEM_RELEASE);
    if (cur)   VirtualFree(cur, 0, MEM_RELEASE);
    if (unst)  VirtualFree(unst, 0, MEM_RELEASE);
    if (txt)   VirtualFree(txt, 0, MEM_RELEASE);
}

static void do_menu_snap(const char *label)
{
    if (!label || !*label) label = "unlabeled";
    HANDLE h = open_retry(g_snap, FILE_APPEND_DATA, OPEN_ALWAYS);
    if (h == INVALID_HANDLE_VALUE) { result_fail("menu_snap", "cannot_open_snap"); return; }
    SetFilePointer(h, 0, NULL, FILE_END);
    uint64_t cm = resolve_cm_obj();
    char hdr[256];
    int hn = snprintf(hdr, sizeof(hdr),
        "\n===== SNAP label=%s ts=%llu base=0x%llx cm_obj=0x%llx =====\n",
        label, (unsigned long long)time(NULL),
        (unsigned long long)g_base, (unsigned long long)cm);
    DWORD wr = 0; if (hn > 0) WriteFile(h, hdr, (DWORD)hn, &wr, NULL);

    snap_region(h, "A", g_base + 0x2eb0000ULL, 0x10000);    /* .data state globals */
    if (cm) snap_region(h, "B", cm, 0x2078);                 /* the CM object       */
    else { const char *m = "B (CM object not resolved)\n"; WriteFile(h, m, (DWORD)strlen(m), &wr, NULL); }
    snap_region(h, "C", g_base + 0xac6000ULL, 0x2000);       /* kcode/input area    */

    CloseHandle(h);
    logmsg("[snap] wrote label=%s (regions A/B/C) to nobd_arcade.snap", label);
    result_ok_simple("menu_snap_done");
}

/* ---------------- CE-style value-delta scanner (find cursor/screen vars) -----
 * scan_new snapshots {addr,val} for every u32 in [1,max) across committed PRIVATE
 * RW regions; scan_delta/same/changed prune to survivors matching a value change.
 * Direct reads under the crash-guard (a freed region can't crash us). Excludes 0
 * to keep the first pass bounded -- so ensure the target var is NON-ZERO at
 * scan_new (e.g. move the cursor to item >=1 first). */
static uint64_t *g_scan_addr = 0;
static uint32_t *g_scan_val  = 0;
static int g_scan_cap = 0;
static int g_scan_count = 0;

static int scan_alloc(void)
{
    if (g_scan_addr && g_scan_val) return 1;
    int caps[] = { 12000000, 6000000, 3000000, 1000000 };
    for (int i = 0; i < (int)(sizeof(caps)/sizeof(caps[0])); i++) {
        int c = caps[i];
        g_scan_addr = (uint64_t *)VirtualAlloc(NULL, (SIZE_T)c * 8,
                          MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        g_scan_val  = (uint32_t *)VirtualAlloc(NULL, (SIZE_T)c * 4,
                          MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (g_scan_addr && g_scan_val) { g_scan_cap = c; return 1; }
        if (g_scan_addr) { VirtualFree(g_scan_addr, 0, MEM_RELEASE); g_scan_addr = 0; }
        if (g_scan_val)  { VirtualFree(g_scan_val, 0, MEM_RELEASE);  g_scan_val = 0; }
    }
    return 0;
}

static int parse_signed_hex(const char *s, int32_t *out)
{
    if (!s || !*s) return 0;
    int neg = 0;
    if (*s == '-') { neg = 1; s++; } else if (*s == '+') s++;
    char *e = NULL;
    unsigned long v = strtoul(s, &e, 16);
    if (e == s) return 0;
    *out = neg ? -(int32_t)v : (int32_t)v;
    return 1;
}

static void scan_report(const char *cmd)
{
    int show = g_scan_count < 40 ? g_scan_count : 40;
    char buf[4096]; int p = 0;
    p += snprintf(buf + p, sizeof(buf) - p,
                  "{\"ok\":true,\"cmd\":\"%s\",\"count\":%d,\"survivors\":[",
                  cmd, g_scan_count);
    for (int i = 0; i < show; i++) {
        p += snprintf(buf + p, sizeof(buf) - p, "%s{\"addr\":\"0x%llx\",\"val\":%u}",
                      i ? "," : "", (unsigned long long)g_scan_addr[i], g_scan_val[i]);
        if (p > (int)sizeof(buf) - 80) break;
    }
    p += snprintf(buf + p, sizeof(buf) - p, "]}\n");
    write_file(g_result, buf, (DWORD)p);
    logmsg("[scan] %s: %d survivors%s", cmd, g_scan_count,
           g_scan_count > show ? " (first 40 logged)" : "");
    for (int i = 0; i < show; i++)
        logmsg("[scan]   0x%llx = %u (0x%x)", (unsigned long long)g_scan_addr[i],
               g_scan_val[i], g_scan_val[i]);
}

static void do_scan_new(const char *arg)
{
    uint32_t max = 0x10000;
    if (arg && *arg) max = (uint32_t)strtoul(arg, NULL, 16);
    if (!scan_alloc()) { result_fail("scan_new", "alloc_failed"); return; }
    g_scan_count = 0;
    int capped = 0, faulted = 0;
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        uintptr_t addr = 0;
        MEMORY_BASIC_INFORMATION mbi;
        while (VirtualQuery((void *)addr, &mbi, sizeof(mbi)) && !capped) {
            uintptr_t next = (uintptr_t)mbi.BaseAddress + mbi.RegionSize;
            DWORD pr = mbi.Protect & 0xff;
            if (mbi.State == MEM_COMMIT && mbi.Type == MEM_PRIVATE &&
                !(mbi.Protect & PAGE_GUARD) &&
                (pr == PAGE_READWRITE || pr == PAGE_WRITECOPY ||
                 pr == PAGE_EXECUTE_READWRITE || pr == PAGE_EXECUTE_WRITECOPY)) {
                uintptr_t p = (uintptr_t)mbi.BaseAddress;
                for (; p + 4 <= next; p += 4) {
                    uint32_t v = *(volatile uint32_t *)p;
                    if (v != 0 && v < max) {
                        if (g_scan_count >= g_scan_cap) { capped = 1; break; }
                        g_scan_addr[g_scan_count] = p;
                        g_scan_val[g_scan_count]  = v;
                        g_scan_count++;
                    }
                }
            }
            if (next <= addr) break;
            addr = next;
        }
        g_in_game_call = 0;
    } else { g_in_game_call = 0; faulted = 1; }
    char buf[256];
    int n = snprintf(buf, sizeof(buf),
        "{\"ok\":true,\"cmd\":\"scan_new\",\"candidates\":%d,\"max\":\"0x%x\","
        "\"capped\":%s,\"faulted\":%s,\"cap\":%d}\n",
        g_scan_count, max, capped ? "true" : "false",
        faulted ? "true" : "false", g_scan_cap);
    write_file(g_result, buf, (DWORD)n);
    logmsg("[scan] new: %d candidates (val in [1,0x%x))%s%s", g_scan_count, max,
           capped ? " CAPPED" : "", faulted ? " FAULTED(partial)" : "");
}

/* mode 0 = keep new==old+delta ; mode 1 = keep new!=old (changed) */
static void scan_prune(int mode, int32_t delta, const char *cmd)
{
    if (!g_scan_addr || g_scan_count == 0) {
        result_fail(cmd, "no_candidates (scan_new first)"); return;
    }
    int faulted = 0, kept = 0;
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        for (int i = 0; i < g_scan_count; i++) {
            uint32_t nv = *(volatile uint32_t *)(uintptr_t)g_scan_addr[i];
            int keep = mode == 1 ? (nv != g_scan_val[i])
                                 : (nv == (uint32_t)(g_scan_val[i] + (uint32_t)delta));
            if (keep) {
                g_scan_addr[kept] = g_scan_addr[i];
                g_scan_val[kept]  = nv;
                kept++;
            }
        }
        g_in_game_call = 0;
        g_scan_count = kept;
    } else {
        g_in_game_call = 0; faulted = 1; g_scan_count = 0;
    }
    if (faulted) { result_fail(cmd, "faulted_during_scan (region freed) -- scan_new again"); return; }
    scan_report(cmd);
}

static void do_scan_delta(const char *arg)
{
    int32_t d;
    if (!parse_signed_hex(arg, &d)) { result_fail("scan_delta", "bad_delta (signed hex)"); return; }
    scan_prune(0, d, "scan_delta");
}
static void do_scan_read(const char *arg)
{
    if (!arg || !*arg) { result_fail("scan_read", "need_hexaddr"); return; }
    uint64_t addr = strtoull(arg, NULL, 16);
    uint32_t v = 0;
    if (!rd_u32(addr, &v)) { result_fail("scan_read", "unreadable"); return; }
    char buf[256];
    int n = snprintf(buf, sizeof(buf),
        "{\"ok\":true,\"cmd\":\"scan_read\",\"addr\":\"0x%llx\",\"val\":%u,\"hex\":\"0x%x\"}\n",
        (unsigned long long)addr, v, v);
    write_file(g_result, buf, (DWORD)n);
    logmsg("[scan] read 0x%llx = %u (0x%x)", (unsigned long long)addr, v, v);
}

/* --------------- value search (find a specific u32/u64 everywhere) -----------
 * Scans ALL committed readable regions (private heap AND image/.data) for the
 * value, reporting hit addresses + the next dword + whether the hit is inside the
 * game module. Finds the live UI screen object by its reflection class-name ptr. */
static void find_val(uint64_t val, int is64, int maxhits, const char *cmd)
{
    if (maxhits <= 0) maxhits = 64;
    if (maxhits > 256) maxhits = 256;
    uint64_t modsz = module_size();
    uint64_t mlo = g_base, mhi = g_base + (modsz ? modsz : 0x4000000ULL);
    static uint64_t hits[256]; static uint32_t nexts[256]; static int inimg[256];
    int nhit = 0, total = 0;
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        uintptr_t addr = 0; MEMORY_BASIC_INFORMATION mbi;
        while (VirtualQuery((void *)addr, &mbi, sizeof(mbi))) {
            uintptr_t next = (uintptr_t)mbi.BaseAddress + mbi.RegionSize;
            DWORD pr = mbi.Protect & 0xff;
            if (mbi.State == MEM_COMMIT && !(mbi.Protect & PAGE_GUARD) &&
                pr != PAGE_NOACCESS) {
                uintptr_t p = (uintptr_t)mbi.BaseAddress, lim = next;
                uintptr_t need = is64 ? 8 : 4;
                for (; p + need <= lim; p += 4) {
                    int match = is64 ? (*(volatile uint64_t *)p == val)
                                     : (*(volatile uint32_t *)p == (uint32_t)val);
                    if (!match) continue;
                    total++;
                    if (nhit < maxhits) {
                        hits[nhit] = p;
                        uintptr_t nxa = p + need;
                        nexts[nhit] = (nxa + 4 <= lim) ? *(volatile uint32_t *)nxa : 0;
                        inimg[nhit] = (p >= mlo && p < mhi);
                        nhit++;
                    }
                }
            }
            if (next <= addr) break;
            addr = next;
        }
        g_in_game_call = 0;
        char buf[8192]; int q = 0;
        q += snprintf(buf + q, sizeof(buf) - q,
            "{\"ok\":true,\"cmd\":\"%s\",\"val\":\"0x%llx\",\"total\":%d,\"shown\":%d,\"hits\":[",
            cmd, (unsigned long long)val, total, nhit);
        for (int i = 0; i < nhit; i++) {
            q += snprintf(buf + q, sizeof(buf) - q,
                "%s{\"addr\":\"0x%llx\",\"next\":\"0x%08x\",\"img\":%s}",
                i ? "," : "", (unsigned long long)hits[i], nexts[i],
                inimg[i] ? "true" : "false");
            if (q > (int)sizeof(buf) - 96) break;
        }
        q += snprintf(buf + q, sizeof(buf) - q, "]}\n");
        write_file(g_result, buf, (DWORD)q);
        logmsg("[find] %s val=0x%llx total=%d shown=%d", cmd,
               (unsigned long long)val, total, nhit);
        for (int i = 0; i < nhit; i++)
            logmsg("[find]   0x%llx next=0x%08x %s", (unsigned long long)hits[i],
                   nexts[i], inimg[i] ? "IMG" : "heap");
    } else {
        g_in_game_call = 0;
        result_fail(cmd, "faulted_during_scan (region freed) -- retry");
    }
}

static void do_find(const char *arg, int is64, const char *cmd)
{
    if (!arg || !*arg) { result_fail(cmd, "need_hexval [maxhits]"); return; }
    char *e = NULL;
    uint64_t val = strtoull(arg, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    int maxhits = *e ? (int)strtoul(e, NULL, 0) : 64;
    find_val(is64 ? val : (val & 0xffffffffULL), is64, maxhits, cmd);
}

/* dump <hexaddr> <ndwords> -- read a window of u32s in one call (per-dword
 * mem_readable-guarded, so a faulting page is marked "--------" not crashed). */
static void do_dump(const char *arg)
{
    if (!arg || !*arg) { result_fail("dump", "need_hexaddr [ndwords]"); return; }
    char *e = NULL;
    uint64_t base = strtoull(arg, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    int n = *e ? (int)strtoul(e, NULL, 0) : 96;
    if (n < 1) n = 1;
    if (n > 512) n = 512;
    static char buf[16384];
    int q = 0, unreadable = 0;
    q += snprintf(buf + q, sizeof(buf) - q,
        "{\"ok\":true,\"cmd\":\"dump\",\"base\":\"0x%llx\",\"n\":%d,\"dw\":[",
        (unsigned long long)base, n);
    for (int i = 0; i < n; i++) {
        uint32_t v = 0;
        int ok = rd_u32(base + (uint64_t)i * 4, &v);
        if (!ok) unreadable++;
        if (ok) q += snprintf(buf + q, sizeof(buf) - q, "%s\"%08x\"", i ? "," : "", v);
        else    q += snprintf(buf + q, sizeof(buf) - q, "%s\"--------\"", i ? "," : "");
        if (q > (int)sizeof(buf) - 24) break;   /* safety */
    }
    q += snprintf(buf + q, sizeof(buf) - q, "],\"unreadable\":%d}\n", unreadable);
    write_file(g_result, buf, (DWORD)q);
    logmsg("[dump] base=0x%llx n=%d unreadable=%d", (unsigned long long)base, n, unreadable);
}

/* Resolve a caller-supplied path to a Windows/Wine path: a bare basename -> the
 * injector dir; a Linux-abs path (/...) -> Z:\... (Wine maps / to Z:); anything
 * with a separator/drive -> as-is. Forward slashes -> backslashes. */
static void to_winpath(const char *path, wchar_t *out, int outcount)
{
    if (path[0] == '/') {
        wchar_t tmp[1024];
        MultiByteToWideChar(CP_UTF8, 0, path, -1, tmp, 1024);
        _snwprintf(out, outcount, L"Z:%s", tmp);
    } else if (strchr(path, '/') || strchr(path, '\\') ||
               (path[0] && path[1] == ':')) {
        MultiByteToWideChar(CP_UTF8, 0, path, -1, out, outcount);
    } else {
        wchar_t wbase[512];
        MultiByteToWideChar(CP_UTF8, 0, path, -1, wbase, 512);
        _snwprintf(out, outcount, L"%s\\%s", g_dir, wbase);
    }
    for (wchar_t *p = out; *p; p++) if (*p == L'/') *p = L'\\';
}

/* dump_file <hexAddr> <hexSize> <path> -- write the RAW (decrypted) bytes of
 * [addr, addr+size) to <path> for offline Ghidra analysis. Page-safe (holes
 * zero-filled + logged), chunked 1MB, crash-guarded. */
static void do_dump_file(const char *arg)
{
    if (!arg || !*arg) { result_fail("dump_file", "need <hexAddr> <hexSize> <path>"); return; }
    char *e = NULL;
    uint64_t addr = strtoull(arg, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    uint64_t size = strtoull(e, &e, 16);
    while (*e == ' ' || *e == '\t') e++;
    const char *path = e;
    if (!*path) { result_fail("dump_file", "need <hexAddr> <hexSize> <path>"); return; }
    if (size == 0 || size > 0x8000000ULL) { result_fail("dump_file", "bad_size (1..128MB)"); return; }
    wchar_t wpath[1024]; to_winpath(path, wpath, 1024);
    HANDLE h = CreateFileW(wpath, GENERIC_WRITE, FILE_SHARE_READ, NULL,
                           CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        logmsg("[dumpf] cannot open '%ls' (err %lu)", wpath, (unsigned long)GetLastError());
        result_fail("dump_file", "cannot_open_output"); return;
    }
    const uint64_t CHUNK = 0x100000;   /* 1 MB */
    BYTE *cbuf = (BYTE *)VirtualAlloc(NULL, CHUNK, MEM_COMMIT, PAGE_READWRITE);
    if (!cbuf) { CloseHandle(h); result_fail("dump_file", "alloc_failed"); return; }
    uint64_t written = 0, holes = 0; int nholes = 0, faulted = 0;
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        uint64_t off = 0;
        while (off < size) {
            uint64_t fill = 0;
            while (fill < CHUNK && off + fill < size) {
                uint64_t a = addr + off + fill;
                uint64_t pglen = 0x1000 - (a & 0xFFF);
                if (pglen > CHUNK - fill) pglen = CHUNK - fill;
                if (pglen > size - (off + fill)) pglen = size - (off + fill);
                if (mem_readable((void *)(uintptr_t)a, pglen)) {
                    memcpy(cbuf + fill, (void *)(uintptr_t)a, (size_t)pglen);
                } else {
                    memset(cbuf + fill, 0, (size_t)pglen);
                    holes += pglen;
                    if (nholes < 40)
                        logmsg("[dumpf] hole +0x%llx len 0x%llx (addr 0x%llx)",
                               (unsigned long long)(off + fill), (unsigned long long)pglen,
                               (unsigned long long)a);
                    nholes++;
                }
                fill += pglen;
            }
            DWORD wr = 0;
            WriteFile(h, cbuf, (DWORD)fill, &wr, NULL);
            written += wr;
            off += fill;
        }
        g_in_game_call = 0;
    } else { g_in_game_call = 0; faulted = 1; }
    VirtualFree(cbuf, 0, MEM_RELEASE);
    CloseHandle(h);
    char b[600];
    int n = snprintf(b, sizeof(b),
        "{\"ok\":%s,\"cmd\":\"dump_file\",\"addr\":\"0x%llx\",\"size\":\"0x%llx\","
        "\"written\":%llu,\"holes\":%llu,\"nholes\":%d,\"faulted\":%s,\"path\":\"%ls\"}\n",
        faulted ? "false" : "true", (unsigned long long)addr, (unsigned long long)size,
        (unsigned long long)written, (unsigned long long)holes, nholes,
        faulted ? "true" : "false", wpath);
    write_file(g_result, b, (DWORD)n);
    logmsg("[dumpf] addr=0x%llx size=0x%llx -> %ls  written=%llu holes=0x%llx(%d)%s",
           (unsigned long long)addr, (unsigned long long)size, wpath,
           (unsigned long long)written, (unsigned long long)holes, nholes,
           faulted ? " FAULTED(partial)" : "");
}

/* ---- route B: capture the created lobby id from MEMORY (no Steam call) ------
 * A Steam LOBBY CSteamID has universe==1 (bits63-56) and account-type==8/chat
 * (bits55-52): high dword like 0x0186.... e.g. 0x0186000070060f1a. */
static int is_lobby_id(uint64_t v)
{
    return ((v >> 56) == 0x01ULL) && (((v >> 52) & 0xFULL) == 0x8ULL);
}

/* Direct-field read: the CM object / steamSM wrapper / coordinator +0x340 -- the
 * spots the lobby CSteamID lands on a normal create. Fast, safe, no Steam call. */
static void do_capture_mem(void)
{
    uint64_t cm = resolve_cm_obj();
    uint64_t sm = 0; if (cm) rd_u64(cm + CM_STEAMSM_FIELD, &sm);
    uint64_t manager = get_manager(), coord = get_coord(manager);
    uint64_t v_cm = 0, v_sm = 0, v_co = 0;
    if (cm)    rd_u64(cm + 0x340, &v_cm);
    if (sm)    rd_u64(sm + 0x340, &v_sm);
    if (coord) rd_u64(coord + 0x340, &v_co);
    uint64_t found = 0;
    if (is_lobby_id(v_sm)) found = v_sm;
    else if (is_lobby_id(v_cm)) found = v_cm;
    else if (is_lobby_id(v_co)) found = v_co;
    logmsg("[capmem] cm=0x%llx+0x340=0x%llx  sm=0x%llx+0x340=0x%llx  coord=0x%llx+0x340=0x%llx  found=0x%llx",
           (unsigned long long)cm, (unsigned long long)v_cm,
           (unsigned long long)sm, (unsigned long long)v_sm,
           (unsigned long long)coord, (unsigned long long)v_co, (unsigned long long)found);
    char b[512];
    int n = snprintf(b, sizeof(b),
        "{\"ok\":%s,\"cmd\":\"capture_mem\",\"createdId\":\"%llu\",\"createdHex\":\"0x%llx\","
        "\"cm340\":\"0x%llx\",\"sm340\":\"0x%llx\",\"coord340\":\"0x%llx\"}\n",
        found ? "true" : "false", (unsigned long long)found, (unsigned long long)found,
        (unsigned long long)v_cm, (unsigned long long)v_sm, (unsigned long long)v_co);
    write_file(g_result, b, (DWORD)n);
    if (found) g_created_lobby = found;
}

/* Signature scan: find all DISTINCT lobby CSteamIDs in committed memory (target +
 * our created one). Diff against the known target to isolate the created lobby. */
static void do_find_lobbyids(const char *arg)
{
    int maxv = (arg && *arg) ? (int)strtoul(arg, NULL, 0) : 48;
    if (maxv < 1) maxv = 1;
    if (maxv > 128) maxv = 128;
    static uint64_t vals[128]; static int cnts[128];
    int nv = 0, faulted = 0;
    if (__builtin_setjmp(g_jmp) == 0) {
        g_in_game_call = 1;
        uintptr_t addr = 0; MEMORY_BASIC_INFORMATION mbi;
        while (VirtualQuery((void *)addr, &mbi, sizeof(mbi))) {
            uintptr_t next = (uintptr_t)mbi.BaseAddress + mbi.RegionSize;
            DWORD pr = mbi.Protect & 0xff;
            if (mbi.State == MEM_COMMIT && !(mbi.Protect & PAGE_GUARD) && pr != PAGE_NOACCESS) {
                uintptr_t p = (uintptr_t)mbi.BaseAddress;
                for (; p + 8 <= next; p += 4) {
                    uint64_t v = *(volatile uint64_t *)p;
                    if (!is_lobby_id(v)) continue;
                    int j;
                    for (j = 0; j < nv; j++) if (vals[j] == v) { cnts[j]++; break; }
                    if (j == nv && nv < maxv) { vals[nv] = v; cnts[nv] = 1; nv++; }
                }
            }
            if (next <= addr) break;
            addr = next;
        }
        g_in_game_call = 0;
    } else { g_in_game_call = 0; faulted = 1; }
    char b[4096]; int q = 0;
    q += snprintf(b + q, sizeof(b) - q,
                  "{\"ok\":%s,\"cmd\":\"find_lobbyids\",\"distinct\":%d,\"ids\":[",
                  faulted ? "false" : "true", nv);
    for (int i = 0; i < nv; i++) {
        q += snprintf(b + q, sizeof(b) - q, "%s{\"id\":\"%llu\",\"hex\":\"0x%llx\",\"n\":%d}",
                      i ? "," : "", (unsigned long long)vals[i],
                      (unsigned long long)vals[i], cnts[i]);
        if (q > (int)sizeof(b) - 96) break;
    }
    q += snprintf(b + q, sizeof(b) - q, "]}\n");
    write_file(g_result, b, (DWORD)q);
    logmsg("[capmem] find_lobbyids: %d distinct lobby CSteamIDs%s", nv, faulted ? " (FAULTED)" : "");
    for (int i = 0; i < nv; i++)
        logmsg("[capmem]   0x%llx (%llu) x%d", (unsigned long long)vals[i],
               (unsigned long long)vals[i], cnts[i]);
}

/* ---- session-request-array snapshotter (find the PRODUCER's request shape) -- */
/* Dump / diff one window [base+lo, base+hi). log_all=1 dumps every non-zero
 * qword (baseline); log_all=0 logs only qwords that changed since last tick. */
static void snap_window(const char *tag, uint64_t base_addr, uint64_t lo, uint64_t hi,
                        uint64_t *baseline, int *have_base, int log_all)
{
    int n = (int)((hi - lo) / 8), logged = 0;
    for (int i = 0; i < n; i++) {
        uint64_t a = base_addr + lo + (uint64_t)i * 8, v = 0;
        if (!rd_u64(a, &v)) continue;
        if (log_all) {
            if (v) logmsg("[req] %s+0x%03llx = 0x%016llx", tag,
                          (unsigned long long)(lo + i * 8), (unsigned long long)v);
        } else if (*have_base && v != baseline[i] && logged < 24) {
            logmsg("[req] %s+0x%03llx: 0x%016llx -> 0x%016llx", tag,
                   (unsigned long long)(lo + i * 8),
                   (unsigned long long)baseline[i], (unsigned long long)v);
            logged++;
        }
        baseline[i] = v;
    }
    *have_base = 1;
}

/* dump every non-zero qword of a window NOW (no baseline touched -- safe to call
 * from the CreateLobby thunk on the worker thread without racing the poll loop). */
static void dump_window_now(const char *tag, uint64_t base_addr, uint64_t lo, uint64_t hi)
{
    int n = (int)((hi - lo) / 8);
    for (int i = 0; i < n; i++) {
        uint64_t a = base_addr + lo + (uint64_t)i * 8, v = 0;
        if (rd_u64(a, &v) && v)
            logmsg("[req] %s+0x%03llx = 0x%016llx", tag,
                   (unsigned long long)(lo + i * 8), (unsigned long long)v);
    }
}

/* Watch the session0+0x178 POINTER array (+ count @+0x978) and FOLLOW new
 * pointers, dumping the request object each points to -- that object IS the
 * request struct the producer built. log_all=1 dumps all current entries. */
static void probe_ptrarray_tick(uint64_t s0, int log_all)
{
    uint32_t cnt = 0;
    if (rd_u32(s0 + REQ_COUNT_OFF, &cnt)) {
        if (log_all || cnt != g_base_count)
            logmsg("[req] s0+0x978 count = %u", cnt);
        g_base_count = cnt;
    }
    for (int i = 0; i < REQ_PTR_SLOTS; i++) {
        uint64_t a = s0 + REQ_ARRAY_OFF + (uint64_t)i * 8, p = 0;
        if (!rd_u64(a, &p)) continue;
        int changed = g_have_base_ptrs && (p != g_base_ptrs[i]);
        if (log_all) {
            if (p) {
                logmsg("[req] s0+0x178[%02d] = 0x%016llx", i, (unsigned long long)p);
                if (mem_readable((void *)(uintptr_t)p, 0x20))
                    dump_window_now("  base req*", p, 0, REQ_OBJ_DUMP);
            }
        } else if (changed) {
            logmsg("[req] s0+0x178[%02d]: 0x%016llx -> 0x%016llx", i,
                   (unsigned long long)g_base_ptrs[i], (unsigned long long)p);
            if (p && mem_readable((void *)(uintptr_t)p, 0x20)) {
                logmsg("[req]   following NEW request ptr 0x%016llx:",
                       (unsigned long long)p);
                dump_window_now("  req*", p, 0, REQ_OBJ_DUMP);
            }
        }
        g_base_ptrs[i] = p;
    }
    g_have_base_ptrs = 1;
}

/* capture the request arrays at the exact create moment (called from the thunk) */
static void probe_req_dump_at_create(void)
{
    uint64_t manager = get_manager();
    if (!manager) return;
    logmsg("[req] === SNAPSHOT AT CreateLobby (request being consumed) ===");
    dump_window_now("CL/mgr(ranked)", manager, REQ_MGR_LO, REQ_MGR_HI);
    dump_window_now("CL/mgr(cm-slot)", manager, REQ_MGR2_LO, REQ_MGR2_HI);
    uint64_t s0 = 0;
    if (rd_u64(manager + 0x250, &s0) && s0) {
        dump_window_now("CL/s0", s0, REQ_S0_LO, REQ_S0_HI);
        dump_window_now("CL/s0q(notify)", s0, REQ_S0Q_LO, REQ_S0Q_HI);
        uint32_t cnt = 0; rd_u32(s0 + REQ_COUNT_OFF, &cnt);
        logmsg("[req] CL/s0+0x978 count = %u", cnt);
        for (int i = 0; i < REQ_PTR_SLOTS; i++) {
            uint64_t p = 0;
            if (!rd_u64(s0 + REQ_ARRAY_OFF + (uint64_t)i * 8, &p) || !p) continue;
            logmsg("[req] CL/s0+0x178[%02d] = 0x%016llx", i, (unsigned long long)p);
            if (mem_readable((void *)(uintptr_t)p, 0x20))
                dump_window_now("  CL/req*", p, 0, REQ_OBJ_DUMP);
        }
    }
}

/* one snapshot pass: ranked inline slots + CM request slots + CM notify queue +
 * session0 pointer array (follow). */
static void probe_req_tick(int log_all)
{
    uint64_t manager = get_manager();
    if (!manager) return;
    snap_window("mgr(ranked)", manager, REQ_MGR_LO, REQ_MGR_HI,
                g_base_mgr, &g_have_base_mgr, log_all);
    snap_window("mgr(cm-slot)", manager, REQ_MGR2_LO, REQ_MGR2_HI,
                g_base_mgr2, &g_have_base_mgr2, log_all);
    uint64_t s0 = 0;
    if (rd_u64(manager + 0x250, &s0) && s0) {
        snap_window("s0", s0, REQ_S0_LO, REQ_S0_HI,
                    g_base_s0, &g_have_base_s0, log_all);
        snap_window("s0q(notify)", s0, REQ_S0Q_LO, REQ_S0Q_HI,
                    g_base_s0q, &g_have_base_s0q, log_all);
        probe_ptrarray_tick(s0, log_all);
    }
}

/* DIAGNOSTIC: watch the session-request array(s) for the bytes the Custom Match
 * PRODUCER writes. Issue at the online menu, then do a manual Custom Match create
 * (and, separately, a ranked create) and DIFF the [req] change lines. Also arms
 * the CreateLobby hook so we can correlate the exact create moment. */
static void do_probe_req(void)
{
    g_probe_req = 1;
    install_createlobby_hook();
    uint64_t manager = get_manager();
    if (manager) {
        uint64_t s0 = 0; rd_u64(manager + 0x250, &s0);
        logmsg("[req] === BASELINE (manager=0x%llx session0=0x%llx) ===",
               (unsigned long long)manager, (unsigned long long)s0);
    }
    probe_req_tick(1);   /* dump baseline (all non-zero) */
    logmsg("[req] snapshotter ACTIVE. Do a manual Custom Match create now; then a "
           "ranked create. Diff the [req] mgr+.. / s0+.. change lines.");
    result_ok_simple("probe_req_active");
}

/* --------------------------------------------------------------- ready file */
static void write_ready(void)
{
    uint64_t manager = get_manager();
    uint64_t coord = get_coord(manager);
    int act = session_active(coord);
    uint64_t lob = 0;
    if (coord) rd_u64((uintptr_t)coord + COORD_LOBBY_ID, &lob);
    uint32_t state = 0;
    if (coord) rd_u32((uintptr_t)coord + COORD_STATE, &state);
    char buf[512];
    int n = snprintf(buf, sizeof(buf),
        "{\"ready\":true,\"manager\":%s,\"coord\":%s,\"in_session\":%s,"
        "\"hooked\":%s,\"hw_armed\":%s,\"cl_hooked\":%s,\"have_capture\":%s,"
        "\"matchId\":%ld,\"mode\":%ld,"
        "\"lobby_id\":\"%llu\",\"state\":%lu,\"ts\":%llu}\n",
        manager ? "true" : "false",
        coord ? "true" : "false",
        act == 1 ? "true" : "false",
        g_hooked ? "true" : "false",
        g_hw_armed ? "true" : "false",
        g_cl_hooked ? "true" : "false",
        g_have_capture ? "true" : "false",
        (long)g_matchId, (long)g_mode,
        (unsigned long long)lob, (unsigned long)state,
        (unsigned long long)time(NULL));
    if (n > 0) write_file(g_ready, buf, (DWORD)n);
}

/* --------------------------------------------------------------- cmd read */
/* read the whole command line (trimmed) into out. Returns 1 if non-empty. */
static int read_command(char *out, int outsz)
{
    HANDLE h = CreateFileW(g_cmd, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return 0;
    char buf[256]; DWORD rd = 0;
    ReadFile(h, buf, sizeof(buf) - 1, &rd, NULL);
    CloseHandle(h);
    DeleteFileW(g_cmd);                 /* consume-once */
    buf[rd] = 0;
    int i = 0;
    while (buf[i] == ' ' || buf[i] == '\t' || buf[i] == '\r' || buf[i] == '\n') i++;
    int j = 0;
    while (buf[i] && buf[i] != '\r' && buf[i] != '\n' && j < outsz - 1)
        out[j++] = buf[i++];
    while (j > 0 && (out[j - 1] == ' ' || out[j - 1] == '\t')) j--;  /* rtrim */
    out[j] = 0;
    return j > 0;
}

/* --------------------------------------------------------------- helper thread */
static void build_paths(void)
{
    /* directory: env NOBD_ARCADE_DIR, else the proxy DLL's own directory */
    DWORD n = GetEnvironmentVariableW(L"NOBD_ARCADE_DIR", g_dir, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) {
        GetModuleFileNameW(g_self, g_dir, MAX_PATH);
        wchar_t *slash = wcsrchr(g_dir, L'\\');
        if (!slash) slash = wcsrchr(g_dir, L'/');
        if (slash) *slash = 0;
    }
    _snwprintf(g_log,     MAX_PATH, L"%s\\nobd_arcade.log",         g_dir);
    _snwprintf(g_cmd,     MAX_PATH, L"%s\\nobd_arcade.cmd",         g_dir);
    _snwprintf(g_result,  MAX_PATH, L"%s\\nobd_arcade.result",      g_dir);
    _snwprintf(g_capture, MAX_PATH, L"%s\\nobd_arcade_capture.txt", g_dir);
    _snwprintf(g_ready,   MAX_PATH, L"%s\\nobd_arcade.ready",       g_dir);
    _snwprintf(g_snap,    MAX_PATH, L"%s\\nobd_arcade.snap",        g_dir);
}

static DWORD WINAPI helper(LPVOID arg)
{
    (void)arg;
    g_helper_tid = GetCurrentThreadId();
    g_base = (uintptr_t)GetModuleHandleW(NULL);
    build_paths();

    logmsg("========================================================");
    logmsg("NOBD ARCADE injector up. base=0x%llx self=0x%llx",
           (unsigned long long)g_base, (unsigned long long)g_self);
    logmsg("dir=%ls", g_dir);
    logmsg("FUN_14026a880=0x%llx FUN_14026acd0=0x%llx manager_ptr=0x%llx",
           (unsigned long long)(g_base + OFF_CREATE),
           (unsigned long long)(g_base + OFF_LEAVE),
           (unsigned long long)(g_base + OFF_MANAGER));

    if (!g_base) {
        logmsg("[fatal] GetModuleHandleW(NULL) returned 0 -- aborting helper");
        return 1;
    }

    g_target = (void *)(g_base + OFF_CREATE);
    AddVectoredExceptionHandler(1, veh);

    /* resolve RtlCaptureStackBackTrace for the CreateLobby stack walk (best-effort) */
    {
        HMODULE k = GetModuleHandleW(L"kernel32.dll");
        if (k) g_RtlCapture = (rtlcapture_fn)(void *)
                   GetProcAddress(k, "RtlCaptureStackBackTrace");
        if (!g_RtlCapture) {
            HMODULE nt = GetModuleHandleW(L"ntdll.dll");
            if (nt) g_RtlCapture = (rtlcapture_fn)(void *)
                        GetProcAddress(nt, "RtlCaptureStackBackTrace");
        }
    }

    /* Default 'create' = CAPTURE-AND-REPLAY. We NEVER arm automatically: the EXE
     * .text is PACKED, and patching FUN_14026a880 during the startup window
     * crashed launch even over a valid decrypted prologue (anti-tamper / startup
     * corruption). The old int3 build proved a LATE .text patch (issued at the
     * menu) is safe. So arming happens ONLY on the explicit 'capture' command
     * (JMP detour) or 'capture_hw' (hardware BP, no code touched) -- both still
     * gated on the decrypted 0x48 prologue. The poll loop only WATCHES + logs the
     * decryption state for visibility; it does not patch anything. */
    load_capture();
    logmsg("[create] default = REPLAY. Arming is MANUAL + LATE (safe): at the "
           "online menu issue 'capture' (JMP) or 'capture_hw' (hardware BP). "
           "Nothing is patched until then. Watching decrypt state:");

    DWORD last_ready = 0;
    char line[96];
    while (g_running) {
        if (g_capture_dirty) { g_capture_dirty = 0; persist_capture(); }

        /* HW-BP one-shot cleanup: once it fired, clear DR0 on the other threads */
        if (g_hw_fired) { g_hw_fired = 0; disarm_hw_bp(); }

        /* self-heal: if a JMP patch we placed is later gone (packer/game rewrote
         * the region), drop the flag rather than trust a stale patch. */
        if (g_hooked) {
            int fb = target_first_byte();
            if (fb != 0xFF) {   /* our patch begins with FF 25 */
                logmsg("[hook] patch not present at %p (byte=0x%02x) -- resetting",
                       g_target, fb);
                g_hooked = 0;
            }
        }

        /* visibility only: log the decrypt byte flipping garbage -> 0x48 while
         * idle (so the operator knows when it's safe to issue 'capture'). NO arm. */
        if (!g_hooked && !g_hw_armed) (void)prologue_decrypted();

        /* request-array snapshotter: log changes while probe_req is active */
        if (g_probe_req) probe_req_tick(0);

        /* call-intercept probes: self-heal + re-arm while active */
        probe_poll(&g_arm_probe);
        probe_poll(&g_notify_probe);
        probe_poll(&g_ctor_probe);
        probe_poll(&g_bt_probe);
        probe_poll(&g_mt_probe);

        /* host_via_join post-create progression poll */
        if (g_hijack_poll_pending) hijack_poll_tick();

        /* persistent CM object / steamSM wrapper state-watch (reads only) */
        if (g_watch_cm) watch_cm_tick(0);
        if (g_watch_sm) watch_sm_tick(0);

        if (read_command(line, sizeof(line))) {
            logmsg("[cmd] received '%s'", line);
            char cmd[64]; int k = 0;
            while (line[k] && line[k] != ' ' && line[k] != '\t' && k < 63) { cmd[k] = line[k]; k++; }
            cmd[k] = 0;
            int a = k; while (line[a] == ' ' || line[a] == '\t') a++;
            const char *arg = line + a;
            if      (_stricmp(cmd, "create")        == 0) do_create();
            else if (_stricmp(cmd, "create_static") == 0) do_create_static();
            else if (_stricmp(cmd, "leave")         == 0) do_leave();
            else if (_stricmp(cmd, "capture")       == 0) do_capture_arm();
            else if (_stricmp(cmd, "cap26")         == 0) do_capture_arm();   /* JMP-detour FUN_14026a880 + [cap26] arg log */
            else if (_stricmp(cmd, "call26")        == 0) do_call26(arg);     /* call FUN_14026a880 (create poster) */
            else if (_stricmp(cmd, "press_create")  == 0) do_press_create();  /* memory-level Create (obj+0x1184=1) */
            else if (_stricmp(cmd, "watch_pc")      == 0) do_watch_pc(arg);   /* observe create-action state while user presses Enter */
            else if (_stricmp(cmd, "capture_hw")    == 0) do_capture_hw();
            else if (_stricmp(cmd, "probe_cl")      == 0) do_probe_cl();
            else if (_stricmp(cmd, "unprobe_cl")    == 0) { uninstall_createlobby_hook();
                                                            result_ok_simple("unprobe_cl"); }
            else if (_stricmp(cmd, "host_via_join") == 0) do_host_via_join();
            else if (_stricmp(cmd, "unhost_via_join")==0) { unhost_via_join();
                                                            uninstall_wireA();
                                                            uninstall_wireA2();
                                                            uninstall_wireA3();
                                                            uninstall_delegate();
                                                            result_ok_simple("unhost_via_join"); }
            else if (_stricmp(cmd, "wire_a")        == 0) do_wire_a(arg);
            else if (_stricmp(cmd, "wire_a2")       == 0) do_wire_a2(arg);
            else if (_stricmp(cmd, "wire_a3")       == 0) do_wire_a3(arg);
            else if (_stricmp(cmd, "wire_deleg")    == 0) do_wire_deleg(arg);
            else if (_stricmp(cmd, "wire_b")        == 0) do_wire_b(arg);
            else if (_stricmp(cmd, "set_ourid")     == 0) do_set_ourid(arg);
            else if (_stricmp(cmd, "dump_singleton")== 0) do_dump_singleton(arg);
            else if (_stricmp(cmd, "wire_lobby")    == 0) do_wire_lobby(arg);
            else if (_stricmp(cmd, "selfjoin")      == 0) do_selfjoin(arg);
            else if (_stricmp(cmd, "register_lc")   == 0) do_register_lc();
            else if (_stricmp(cmd, "read_created")  == 0) do_read_created();
            else if (_stricmp(cmd, "set_slots")     == 0) do_set_slots(arg);
            else if (_stricmp(cmd, "getsteamid")    == 0) do_getsteamid();
            else if (_stricmp(cmd, "capture_created")==0) do_capture_created();
            else if (_stricmp(cmd, "probe_req")     == 0) do_probe_req();
            else if (_stricmp(cmd, "unprobe_req")   == 0) { g_probe_req = 0;
                                                            result_ok_simple("unprobe_req"); }
            else if (_stricmp(cmd, "probe_arm")     == 0) do_probe_arm();
            else if (_stricmp(cmd, "unprobe_arm")   == 0) { g_arm_probe.active = 0;
                                                            unhook_probe(&g_arm_probe);
                                                            result_ok_simple("unprobe_arm"); }
            else if (_stricmp(cmd, "probe_notify")  == 0) do_probe_notify();
            else if (_stricmp(cmd, "unprobe_notify")== 0) { g_notify_probe.active = 0;
                                                            unhook_probe(&g_notify_probe);
                                                            result_ok_simple("unprobe_notify"); }
            else if (_stricmp(cmd, "probe_ctor")    == 0) do_probe_ctor();
            else if (_stricmp(cmd, "unprobe_ctor")  == 0) { g_ctor_probe.active = 0;
                                                            unhook_probe(&g_ctor_probe);
                                                            result_ok_simple("unprobe_ctor"); }
            else if (_stricmp(cmd, "probe_bt")      == 0) do_probe_bt(arg);
            else if (_stricmp(cmd, "unprobe_bt")    == 0) { g_bt_probe.active = 0;
                                                            unhook_probe(&g_bt_probe);
                                                            result_ok_simple("unprobe_bt"); }
            else if (_stricmp(cmd, "nav_online")    == 0) do_nav_online(arg);
            else if (_stricmp(cmd, "watch_cm")      == 0) do_watch_cm();
            else if (_stricmp(cmd, "unwatch_cm")    == 0) { g_watch_cm = 0;
                                                            result_ok_simple("unwatch_cm"); }
            else if (_stricmp(cmd, "poke_cm")       == 0) do_poke_cm(arg);
            else if (_stricmp(cmd, "create_poke")   == 0) do_create_poke();
            else if (_stricmp(cmd, "call_create")   == 0) do_call_create();
            else if (_stricmp(cmd, "read_lobby")    == 0) do_read_lobby();
            else if (_stricmp(cmd, "status")        == 0) do_read_lobby();
            else if (_stricmp(cmd, "menu_snap")     == 0) do_menu_snap(arg);
            else if (_stricmp(cmd, "watch_sm")      == 0) do_watch_sm();
            else if (_stricmp(cmd, "unwatch_sm")    == 0) { g_watch_sm = 0;
                                                            result_ok_simple("unwatch_sm"); }
            else if (_stricmp(cmd, "poke_sm")       == 0) do_poke_sm(arg);
            else if (_stricmp(cmd, "scan_new")      == 0) do_scan_new(arg);
            else if (_stricmp(cmd, "scan_delta")    == 0) do_scan_delta(arg);
            else if (_stricmp(cmd, "scan_same")     == 0) scan_prune(0, 0, "scan_same");
            else if (_stricmp(cmd, "scan_changed")  == 0) scan_prune(1, 0, "scan_changed");
            else if (_stricmp(cmd, "scan_read")     == 0) do_scan_read(arg);
            else if (_stricmp(cmd, "find_u32")      == 0) do_find(arg, 0, "find_u32");
            else if (_stricmp(cmd, "find_u64")      == 0) do_find(arg, 1, "find_u64");
            else if (_stricmp(cmd, "find_lobbyids") == 0) do_find_lobbyids(arg);
            else if (_stricmp(cmd, "capture_mem")   == 0) do_capture_mem();
            else if (_stricmp(cmd, "dump")          == 0) do_dump(arg);
            else if (_stricmp(cmd, "dump_file")     == 0) do_dump_file(arg);
            else result_fail(cmd, "unknown_command (create|create_poke|call_create|leave|"
                             "read_lobby|menu_snap <label>|watch_sm|poke_sm <off> <val>|"
                             "scan_new [max]|scan_delta <±hex>|scan_same|scan_changed|"
                             "scan_read <addr>|find_u32 <val>|find_u64 <val>|dump <addr> <n>|"
                             "capture|probe_*|watch_cm|poke_cm + un* variants)");
        }

        DWORD now = GetTickCount();
        if (now - last_ready >= 1000) { last_ready = now; write_ready(); }

        int fast = g_probe_req || g_arm_probe.active || g_notify_probe.active ||
                   g_ctor_probe.active || g_bt_probe.active || g_mt_probe.active ||
                   g_hijack_poll_pending;
        Sleep((g_watch_cm || g_watch_sm) ? 5 : (fast ? 25 : 250));  /* 5ms while watching */
    }
    return 0;
}

/* --------------------------------------------------------------- DllMain */
BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID reserved)
{
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        g_self = hinst;
        DisableThreadLibraryCalls(hinst);
        HANDLE t = CreateThread(NULL, 0, helper, NULL, 0, NULL);
        if (t) CloseHandle(t);
    } else if (reason == DLL_PROCESS_DETACH) {
        g_running = 0;
    }
    return TRUE;
}
