/*
 * arcade_offsets.h -- ALL game-specific RE constants live here (swappable).
 *
 * Source: docs/ARCADE-CREATE-RE.md, Marvel vs Capcom Fighting Collection
 *         (appid 2634890), x86-64 recompile, Ghidra image base 0x140000000.
 *
 * Every value below is a RELATIVE offset from the module base. The runtime
 * base is resolved with GetModuleHandleW(NULL) -- never hardcode 0x140000000.
 *
 * If a game update shifts these, edit ONLY this file and rebuild.
 */
#ifndef ARCADE_OFFSETS_H
#define ARCADE_OFFSETS_H

/* ---- netplay MANAGER global pointer (object B) ------------------------------
 * manager = *(uint64*)(base + OFF_MANAGER)   ; DAT_142ebccb8, null until
 * netplay init. GUARD on non-null before any call. */
#define OFF_MANAGER        0x2ebccb8ULL

/* ---- coordinator (object C) 3-level pointer chain ---------------------------
 * coord = *(*(*(base+OFF_MANAGER) + SESS0_OFF) + COORD_OFF) */
#define SESS0_OFF          0x250ULL   /* manager -> session[0]              */
#define COORD_OFF          0x180ULL   /* session[0] -> coordinator (C)      */

/* ---- coordinator field offsets (byte offsets into object C) ---------------- */
#define COORD_LOBBY_ID     0x340ULL   /* u64  Steam LOBBY CSteamID (created) */
#define COORD_COMPANION    0x348ULL   /* u64  lobby-id companion / owner cache */
#define COORD_OWNER_FLAG   0x3c0ULL   /* u8   1 = I am the lobby owner/host   */
#define COORD_IN_LOBBY     0x3c1ULL   /* u8   in-lobby / session-active flag  */
#define COORD_GATE         0x13fc0ULL /* ptr  GATE: non-zero => machine ACTIVE
                                       *      (GUARD: do not create if != 0)   */
#define COORD_STATE        0x19758ULL /* i32  host state machine var (0..6)    */

/* ---- callable entry points (relative to base) ------------------------------ */
/* c1 (RECOMMENDED): post "start host session" command.
 *   void __fastcall FUN_14026a880(manager[RCX], matchId[EDX], mode[R8D],
 *                                 maxA[R9D], maxB[stack]);
 * The worker then runs the whole real CreateLobby -> SetLobbyData ->
 * SetLobbyType/Joinable -> host handshake. */
#define OFF_CREATE         0x26a880ULL

/* ---- FULLY-STATIC create sequence (from decompiled FUN_140066f00 case 1) ----
 * The menu "create" handler does, verbatim:
 *   matchId = FUN_14006cf10(*(u64*)(base+0xbd3ca0));     // allocate match slot id
 *   if (FUN_14026b270(manager, matchId, 0) == 0)         // not already present?
 *       FUN_14026a880(manager, matchId, 2, 0, 0);        // POST create, mode=2
 * => HOST_MODE is the literal constant 2; HOST_MATCH_ID is allocated at runtime
 *    by the game itself (NOT a constant, NOT a capture). This lets create() run
 *    with zero prior manual create / zero capture click. */
#define OFF_ALLOC_MATCH_ID     0x6cf10ULL   /* uint32 __fastcall(void* mgr2)     */
#define OFF_SESSION_MGR2_GLOBAL 0xbd3ca0ULL /* DAT_140bd3ca0; deref for the arg  */
#define OFF_SESSION_EXISTS     0x26b270ULL  /* void* __fastcall(void* mgr, u32 id, int) ; 0 = not present */
#define HOST_MODE              2            /* confirmed literal in case 1       */

/* ---- ISteamMatchmaking interface + CreateLobby vtable slot (diagnostic) ------
 * The game fetches its Steam interface singleton via a stored accessor:
 *     singleton = (*DAT_1408db898)(&PTR_FUN_140a34d90);   // FUN_14003ee40
 *     matchmaking = *(void**)(singleton + 0x20);          // SteamMatchMaking009
 * The matchmaking object's vtable slot +0x68 is CreateLobby (confirmed in RE).
 * Every lobby creation -- ranked, casual, OR Custom Match -- goes through it, so
 * hooking the vtable slot (a pure pointer swap, no code patched) catches the real
 * Custom Match create and lets us stack-walk to its initiator. */
#define OFF_IFACE_ACCESSOR   0x8db898ULL /* DAT_1408db898: holds accessor fn ptr */
#define OFF_IFACE_ARG        0xa34d90ULL /* &PTR_FUN_140a34d90: arg to accessor   */
/* CSteamAPIContext singleton layout (confirmed via dump_singleton): */
#define IFACE_USER_OFF       0x08ULL     /* singleton[+0x08] = ISteamUser         */
#define IFACE_UTILS_OFF      0x18ULL     /* singleton[+0x18] = ISteamUtils        */
#define IFACE_MM_OFF         0x20ULL     /* singleton[+0x20] = matchmaking iface  */
#define MM_VT_CREATELOBBY    0x68ULL     /* matchmaking vtable byte offset        */
#define MM_VT_JOINLOBBY      0x70ULL     /* SteamMatchmaking::JoinLobby slot      */
/* SetLobbyData(this, CSteamID lobby, const char* key, const char* value) -> bool.
 * GetLobbyOwner(this, CSteamID lobby) -> CSteamID (RAX). Byte offsets into the
 * matchmaking vtable (from Ghidra RE). Used by the [lc] listener to stamp the
 * host lobby-data keys the game's sub_14013b880 -> FUN_1401391e0 parser requires. */
#define MM_VT_SETLOBBYDATA   0x108ULL    /* SteamMatchmaking::SetLobbyData slot    */
#define MM_VT_GETLOBBYOWNER  0x118ULL    /* SteamMatchmaking::GetLobbyOwner slot   */
/* ISteamUtils::GetAPICallResult / IsAPICallCompleted + ISteamUser::GetSteamID
 * vtable slot INDICES are version-specific -- set at runtime via `set_slots`
 * (default -1 = unset; the capture chain stays INERT until confirmed, so a wrong
 * slot cannot fire). LobbyCreated_t is a PACKED 12 bytes: eResult@0, lobbyId@4. */
#define LOBBYCREATED_T_CBID  513
#define LOBBYCREATED_T_SIZE  12
/* SteamAPI_RegisterCallback fn pointer (same mechanism the game uses for id-333).
 * reg = *(void**)(base+OFF_REGISTER_CALLBACK); reg(CCallbackBase*, iCallback). */
#define OFF_REGISTER_CALLBACK 0x8db8a8ULL

/* ---- CUSTOM MATCH producer/worker family (Ghidra RE 2026-08-19) -------------
 * The Custom Match create is producer/worker (NOT FUN_14026a880's ranked path).
 *   producer: fills a request SLOT at mgr+0x328 (stride 0x20, 16 slots), then
 *             FUN_140393190(session0+0x7c0, idx, mgr+0x328+idx*0x20, 1, 0)
 *   FUN_14026ba90(mgr, idx, p3, p4): mgr+0x330+idx*0x20=p3, +0x340+idx*0x20=p4,
 *             then the FUN_140393190 post above (arm-slot helper).
 *   worker FUN_14026dd20 drains session0+0x178 (ptr array, count @+0x978).
 * The exact CM slot fields + type/mode constant come from the probe_req capture
 * and/or decompiling the CM-stack producers FUN_14034a5a0/bd40/f1a0. */
#define OFF_NOTIFY_POST    0x393190ULL  /* FUN_140393190(queue, idx, req, u8, u8) */
#define OFF_ARM_SLOT       0x26ba90ULL  /* FUN_14026ba90 slot-set + notify        */
#define OFF_ALLOC_SESSION  0x26aa50ULL  /* FUN_14026aa50 session0 alloc + replay  */
#define OFF_CM_CTOR        0x34bd40ULL  /* FUN_14034bd40 = CM session ctor (0x2078,
                                         * sets +0xb0=2 type; frame on CM create) */
#define OFF_CM_STATE_MACH  0x349c70ULL  /* FUN_140349c70 = CM state machine (fr5)  */

/* ---- MEMORY-LEVEL "press Create" (press_create) -----------------------------
 * FUN_14026a880 is only STATE 1 of a 5-state async-gated create sequence. The
 * create-menu-action object's Update = FUN_140066f00 (10-state machine, jump table
 * at 0x140067234) drives states 1..5 itself (async gate FUN_14006cf20()==4, session
 * activate, transport cfg, descriptor register FUN_14034c120, host-start
 * FUN_14026ba90(manager,7,action,&cb), then obj+0x390=0x14 / obj+0x394=3). The Enter
 * key ONLY sets one flag: action+0x1184 = 1 (input handler at 0x14006522c). So we set
 * that flag on the live object and the framework's per-frame Update does the rest.
 *   obj = rcx of FUN_140066f00 (captured by JMP-hooking that Update). */
#define OFF_CREATE_MENU_UPDATE 0x66f00ULL   /* FUN_140066f00 (create-action Update) */
#define CREATE_ACTION_STATE_FLAG 0x1184ULL  /* u32; Enter sets =1 -> run states 1..5 */
#define CREATE_ACTION_PROG_A   0x390ULL     /* u32; reaches 0x14 at state 4/5         */
#define CREATE_ACTION_PROG_B   0x394ULL     /* u32; reaches 3 at state 4/5            */

/* ---- persistent CM session object (state-watch, not a hook) -----------------
 * The CM object is built on entering the online menu and persists; clicking
 * Create just advances its state machine. Identify it by its vtable, then watch:
 *   state  = *(u32*)(obj+0x170)   [sm=obj+0x160, sm+0x10]  ; create gated on ==6
 *   type   = *(u32*)(obj+0xb0)                              ; ==2 for CM
 *   steamSMptr = *(void**)(obj+0x180) (sm+0x20)
 *   timer  = *(u64*)(obj+0x788) (sm+0x628) ; counter = *(u32*)(obj+0x790) (sm+0x630) */
/* ---- in-process "navigate to online + pending-join" trigger (nav_online) -----
 * GameLobbyJoinRequested handler FUN_14012f8f0 just sets pending-join fields on
 * coord = *(base+0x2eb36a0); the per-frame consumer FUN_140054100 (MAIN thread)
 * validates + navigates online + calls JoinLobby(coord+0x410). We replicate the
 * field writes on the main thread (inside a hook on FUN_140054100). */
#define OFF_COORD_GLOBAL   0x2eb36a0ULL /* DAT_142eb36a0; coord = *(base+this)    */
#define OFF_FRAME_CONSUMER 0x54100ULL   /* FUN_140054100 (main-thread per-frame)  */
/* route B: the GameLobbyJoinRequested (id-333) handler FUN_14012f8f0. Best-guess
 * signature: FUN_14012f8f0(this[coord = *(base+0x2eb36a0)], pParam). pParam =
 * GameLobbyJoinRequested_t: m_steamIDLobby[+0], m_steamIDFriend[+8] (16 bytes).
 * Called on the MAIN thread with lobby=createdId, friend=ourId to re-drive a
 * fully-wired join. */
#define OFF_JOINREQ_HANDLER 0x12f8f0ULL
#define BOX_STEAMID_DEFAULT 76561198654690714ULL

/* THE definitive session wire: the join's CCallResult delegate (m_Func @
 * coord+0x197b0, m_iCallback=504=LobbyEnter). Called (rcx=coord, rdx=pParam
 * [LobbyEnter_t], r8b=bIOFailure). Its ONLY effects: coord+0x19771=bIOFailure;
 * if pParam+0x10 (m_EChatRoomEnterResponse)==1 -> coord+0x19774=1 (success) else
 * =2 (fail); the game then enters whatever is in coord+0x340. We fully replace it:
 * force success + set coord+0x340=createdId so GetLobbyOwner(createdId)==us -> host. */
#define OFF_JOIN_DELEGATE   0x1389e0ULL
#define DELEG_IOFAIL_OFF    0x19771ULL   /* u8  bIOFailure                       */
#define DELEG_STATUS_OFF    0x19774ULL   /* u32 join status (1=success,2=fail)   */
#define DELEG_LOBBY_OFF     0x340ULL     /* u64 the lobby the game enters         */
#define NAV_PENDING_ID     0x290ULL     /* coord+0x290 = lobbyID (u64)            */
#define NAV_MEMSET_OFF     0x298ULL     /* memset(coord+0x298, 0, 400)            */
#define NAV_MEMSET_LEN     400
#define NAV_LOBBY_ID       0x410ULL     /* coord+0x410 = lobbyID (u64)            */
#define NAV_FLAG_ON        0x420ULL     /* coord+0x420 = 1 (u32)                  */
#define NAV_FLAG_OFF       0x428ULL     /* coord+0x428 = 0 (u32)                  */

#define OFF_CM_VTABLE      0x964ba0ULL  /* *(void**)obj == base+this => CM object */
#define CM_STATE_FIELD     0x170ULL     /* sm+0x10  state (==6 fires create)      */
#define CM_TIMER_FIELD     0x788ULL     /* sm+0x628 timer (u64; !=0 && <=now)     */
#define CM_COUNTER_FIELD   0x790ULL     /* sm+0x630 counter (u32; <1)             */
#define CM_STEAMSM_FIELD   0x180ULL     /* sm+0x20  steamSM ptr (create arg1)     */
#define CM_MSG_FIELD       0x188ULL     /* sm+0x28  create arg2 (address)         */
/* The state-6 branch of FUN_140349c70 calls FUN_14015b150(*(obj+0x180), obj+0x188)
 * = a lock-protected enqueue of a type-0x304 create message on the game tick. */
#define OFF_CREATE_PRIM    0x15b150ULL  /* FUN_14015b150(steamSM, msgptr)         */
#define CM_SLOTS_OFF       0x328ULL     /* mgr -> CM request slots                */
#define CM_SLOT_STRIDE     0x20ULL
#define CM_SLOT_COUNT      16
#define CM_NOTIFY_QUEUE_OFF 0x7c0ULL    /* session0 -> notify queue (stride 0x18) */

/* ---- packed-image DECRYPTION gate -------------------------------------------
 * The EXE .text is PACKED and only decrypts at runtime. At DLL-load the first
 * byte of FUN_14026a880 reads as encrypted garbage (observed 0xaf ...); once the
 * game decrypts (by the online menu) it becomes a real REX.W prologue starting
 * 0x48 (observed live by the old build). We must NEVER patch the hook until this
 * flips, or we corrupt the packer's compressed image and crash launch. */
#define EXPECTED_PROLOGUE_BYTE 0x48

/* teardown/leave slot + signal (lobby recycle):
 *   void FUN_14026acd0(void* manager, int k);   call with k = 7 */
#define OFF_LEAVE          0x26acd0ULL

/* The two args to OFF_CREATE are UNKNOWN until captured live (see README
 * "capture step"). They are NOT hardcoded -- they are read from the capture
 * file written by the int3 hook when a human clicks Create once. */

#endif /* ARCADE_OFFSETS_H */
