# Marvel vs Capcom 2 (Steam Fighting Collection) — reverse-engineering notes

Community notes on the **Steam** release of MvC2 (inside *MARVEL vs CAPCOM Fighting Collection*),
shared for other modders/tool-makers. These are observations from black-box RE of a legally-owned
copy — no game code or assets are included here, and everything is for interoperability
(companion tools, overlays, skin editors). Offsets are build-specific and can shift between game
patches; treat them as a starting point and re-verify against your own copy.

## What the Steam build actually is

The Steam MvC2 is **not** an SH4/NAOMI emulator wrapper the way the Dreamcast/arcade titles are
usually packaged. Evidence from a live scan of the running process: **~0% SH4 code** in the game's
memory, versus a retail Dreamcast image where the SH4 `1ST_READ.BIN` is a couple percent of the
image. The build banner strings also point at a Dreamcast-lineage codebase (`__DEV_TYPE_DC__`,
an `SHC211`-style tag).

Working conclusion: it's a **native x86-64 recompilation of the Dreamcast-lineage MvC2 engine**
(same game logic as the DC/NAOMI versions, with rollback/training/savestate features layered in),
rather than instruction-level emulation. Practically, that means:

- The **game logic and data layout mirror the DC/NAOMI version**, so DC RE (struct fields, move
  tables, timers) cross-references well — but the **struct stride and offsets are the Steam build's
  own** (see below); the DC numbers do **not** map 1:1.
- There's no SH4 CPU to hook; you read/observe the native process directly.

## Asset pipeline (skins / textures / palettes)

Character art and palettes live inside a packed archive that unwraps in layers:

```
game_50.arc  →  zlib  →  IBIS container  →  AFS archive  →  per-character DAT
```

- The AFS archive holds the roster's character DATs; within a DAT you'll find the sprite/texture
  data plus **palette banks**.
- Palettes are **16-colour banks** in a NAOMI-style **ARGB4444** layout (4 bits per channel). When
  comparing/among palettes it's the 4-bit-per-channel **nibbles** of colours 1..15 that identify a
  unit's look (colour 0 is the transparent/background entry).
- Textures use a Capcom LZ-style compression; decoding is a straightforward LZ pass once you've
  located the sub-stream. (This repo ships **no** decoded art — BYOR.)

A skin, at bottom, is just a replacement 16-colour palette applied to the character's colour bank.

## Live memory: the fighter array

While a match is running, the six on-screen fighter slots are laid out as a contiguous array:

```
slot(i) = array_base + i * 0x738          // i = 0..5
order   = [ P1C1, P2C1, P1C2, P2C2, P1C3, P2C3 ]   // interleaved by side
```

Note the array is **volatile**: under rollback the engine keeps multiple savestate copies, and the
live array relocates between matches — so a fixed absolute address won't hold. Find it by
fingerprint (a run of six structs whose palette-pointer field is populated) and re-validate before
each read. Some fields extend **past** the `0x738` stride (health, below, sits well beyond it), so
read a slot as a window a bit larger than the stride.

### Useful per-slot fields (offsets from the slot base)

| Field | Offset | Type | Notes |
|---|---:|---|---|
| Character id | `+0x554` | u16 | roster index |
| Colour / variant | `+0x006` | u8 | the 6 select-button variants |
| Palette pointer (DatPal) | `+0x04c` | ptr | points at the working-buffer palette actually rendered |
| Input register | `+0x4fc` | u16 | current inputs for this slot |
| Assist type | `+0x4e9` | u8 | 0=α, 1=β, 2=γ (fixed at character select) |
| Position X / Y | `+0x61c` / `+0x620` | f32 | |
| Velocity X / Y | `+0x644` / `+0x648` | f32 | |
| Facing | `+0x720` | u8 | (mirrored at a couple nearby offsets) |
| Action / state | `+0x76c` | u8 | granular animation/action state |
| Combo (dealt) | `+0x1ca` | u16 | current combo the slot is dealing |
| Combo (received) | `+0x902` | u16 | |
| Hitstun | `+0x909` | u8 | `0xFF` during a combo, `0` on block |
| Health | `+0xb44` | u32 | low 16 bits are 0..144 |
| Red (recoverable) health | `+0xb48` | u16 | tracks health + a few frames |

These were confirmed live against two independent array bases; expect small drift on future game
patches, and always sanity-check (e.g. health in `0..=144`, char id in range) before trusting a read.

### Palettes at the render layer

The palettes the game actually draws each frame sit in a fixed working-buffer window in memory. A
skin tool can recolour by writing a replacement 16-colour row into that window (or by following a
slot's DatPal pointer), which is why a cosmetic recolour is possible without touching any files on
disk. Same-character, same-colour "mirror" matchups produce **byte-identical** palettes on both
sides, so per-side recolouring needs the slot's side (from the array order above), not the palette
bytes alone.

## Networking: lobbies & matchmaking (Steam)

Online play (ranked and Custom Match) is built on the ordinary **Steam matchmaking lobby**
API — `ISteamMatchmaking` — so lobby behaviour is observable/steerable the same way it is in any
Steamworks title, no game-specific netcode required for the *lobby* layer. (The fight itself —
rollback + inputs — is direct P2P between the two players and host-independent.)

### Creating a lobby

A Custom Match create resolves to a normal `CreateLobby(eLobbyType, cMaxMembers)` on the
matchmaking interface (vtable slot `+0x68`). Observed defaults for a Custom Match: `eLobbyType=2`
(public/listed), `cMaxMembers=2`. The **`eLobbyType`** is the standard Steam enum — `0` private,
`1` friends-only, `2` public, `3` invisible — so it controls whether the room is listed in the
in-game browser or reachable only by an explicit join. The engine's lobby holds **up to 9
members**, so `cMaxMembers=2` is just the default for a 1v1, not a ceiling.

The create runs **producer/worker**: the menu posts a request that a worker later consumes and turns
into the `CreateLobby` call. A tool can hook `ISteamMatchmaking::CreateLobby` to observe (or rewrite)
`eLobbyType`/`cMaxMembers`, which is useful for **visibility** (public vs unlisted). But note an
empirically-confirmed caveat about **room size**: the game's displayed/enforced player count does
**not** follow the Steam `cMaxMembers` arg (nor the `SlotPublicMax` lobby-data key). Rewriting either
leaves the in-game "1 / 2 players" header unchanged. The count is driven by the create screen's own
**"Number of Players" menu field**, held in a game-side object during the create; setting that field
(via the menu, or by writing the game's own count object) is what actually produces a 3+-seat room.
Treat `cMaxMembers`/`SlotPublicMax` as advisory mirrors, not the source of truth for capacity.

### Lobby metadata (`SetLobbyData` keys)

After create, the host publishes the room state as string key/value pairs the joining client parses:

| Key | Meaning |
|---|---|
| `OwnerId` | host SteamID, `%016llX` |
| `SlotPublicMax` / `SlotPublicOpen` | public seat count / seats still open |
| `SlotPrivateMax` / `SlotPrivateOpen` | private (invite) seats |
| `SearchKeyNum` / `SearchKey%d` | matchmaking search filters |
| `BinarySize` / `BinaryData` | a 128-byte opaque **match-settings blob** (→ lobby-info `+0x50`) |

The FT count (e.g. "FT10") is a **social convention**, not a lobby key. The match rules that *are*
encoded live in the 128-byte `BinaryData` blob (contents not yet decoded).

### Joining by link

The game only consumes `+connect_lobby <id>` on launch, but a standard Steam deep link joins a
running lobby by id — build it yourself as
`steam://joinlobby/2634890/<lobbyID>/<ownerID>` (2634890 = the app id). This works even for an
**unlisted** lobby (types 0/1/3) — the id is the only thing needed — which makes the link itself an
access token when the room isn't in the public browser. `InviteUserToLobby` (matchmaking vtable
`+0x80`) is the game's programmatic invite path.

## Caveats

- All offsets are for the current Steam build at time of writing; a patch can move them.
- The array is savestate-heavy under rollback — read the **live** copy, not a frozen one.
- This is interoperability RE on your own copy. Don't redistribute game code or art.

Corrections/additions welcome via issues/PRs.
