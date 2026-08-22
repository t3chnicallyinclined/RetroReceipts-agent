# legacy/ — frozen MetaSync 0.2.6 (reference only)

This is the **frozen source of the 0.2.6 Tauri desktop app**, kept for
reference and emergency fixes while some users are still on that build.
It is **not built or deployed** by any Retro Receipts pipeline — the live
client is the tray agent (`../agent/`) and the web client (`../pwa/`).

Contents (source only):

- `src-tauri/` — the Rust/Tauri app. No `target/`, no bundled `frontend/`
  (it was a dup of `web/`), no icons.
- `web/` — THE ARENA web UI: `index.html`, `studio/`, `idle_frames.json`.

**BYOR:** no ROM-derived assets are included. The 0.2.6 skin sprites
(`web/skins/` — ~9.5k PNGs) and the bundled frontend are regenerated
locally from the user's own ROM and are intentionally omitted here.

Superseded by `agent/` (tray) + `pwa/` (web).
