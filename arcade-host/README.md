# arcade-host — the Retro Receipts host-node runtime (Linux)

The scripts that let a Linux box **host** the neutral referee lobbies for money matches
+ tournament matches: it drives the game's own menus (create → drop to spectate),
reads the lobby/match state via the injector, heartbeats the server pool, and
rotates to a fresh lobby after each settled match.

## The tray contract
The tray's **"Host this machine"** toggle shells out to the daemon — it never touches
the heartbeat body or token itself:

| Toggle | Command |
|---|---|
| ON  | `arcade_hostd.sh register`   — enables + starts the systemd `--user` loop (8s heartbeat, self-healing, rotate-on-settle) |
| OFF | `arcade_hostd.sh unregister` — POSTs `/arcade/host/unregister` + stops/disables the loop |
| indicator | `arcade_hostd.sh status` — hosting enabled/active + current lobby JSON |

## Install
```
bash install.sh
```
Copies the scripts to `~/.local/share/retro-receipts/arcade-host/` and installs the
systemd `--user` unit. Then `register` (or the tray toggle) turns hosting on.

## Requirements (runtime)
- **ydotool** + **ydotoold** running with access to `/dev/uinput` (drives the game menus)
- **wmctrl** (focus-guards the game's XWayland window before each key)
- a **live graphical session** (the game needs a display); for an always-on headless
  host also run `loginctl enable-linger "$USER"`
- `spectacle` or `grim` only for calibration (`act_shot.sh`), not for hosting

## Files
- `arcade_host.sh` — the menu driver: `{host|create|spectate|leave|cycle|status}`
- `arcade_hostd.sh` — the daemon: `{loop|register|unregister|status}` (heartbeat + self-heal + rotate)
- `arcade-hostd.service` — the systemd `--user` unit (uses `%h`; no hardcoded paths)
- `act_shot.sh` — calibration helper (tap keycodes → screenshot)
- `install.sh` — per-user installer

## Config (env; all optional)
`MVC_GAME_DIR` (override game-dir auto-detect) · `METASYNC_HOST` (default `https://nobd.net`) ·
`REGION` · `NODE_NAME` (default hostname) · `INTERVAL` (loop secs, default 8) ·
`ARCADE_FT`/`ARCADE_ONE_BUTTON`/`ARCADE_VERSION`/`ARCADE_PLAYERS`/`ARCADE_GAME` (reported lobby settings).

## Known limitations
- **Linux only.** Windows hosting isn't viable yet (the menu automation uses ydotool/uinput;
  Windows `PostMessage` doesn't reach the game — it polls DirectInput — and we avoid 3rd-party drivers).
- **Lobby settings on a fresh box:** the game *persists* the last-used Create-Lobby options,
  and its Left/Right value pickers *wrap* (no clamp), so the automation can't blind-set an
  arbitrary Victory Condition without reading the current value. Set the options once manually
  (Game Version = English/US, One-button = None, Victory Condition = First to 2); they persist.
  Robust arbitrary-FT selection is pending an injector read of the setting.
