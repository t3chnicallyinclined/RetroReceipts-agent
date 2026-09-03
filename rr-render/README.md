# rr-render

Retro Receipts tape decoder + whole-frame emitter in Rust (preamble, arc deck, world lists, sprites, HUD, the
two-phase flush) — a verbatim port of the gated Python oracle `mvc-live-skins-quarters/d3dcap/replay/tape_to_seq.py`,
`tsp_state.py`, `bg_rule.py`, the `v3gate.py` rules and `rip_gfx2_assembly.read_cells` — plus the browser feed: the
crate built to wasm runs in a Web Worker and plays a TAPE directly (binary FrameRecords, no `.seq`).

Module map, formats, gate numbers and the plan: `mvc-live-skins-quarters/docs/RR-RENDER-CRATE.md`.

```
cargo build --release && cargo test --release --lib
target/release/emit_seq <tape.json.gz> --start 1500 --count 60 -o out.seq      # full frame (== tape_to_seq.py); --no-world = sprites only
target/release/emit_seq <tape.json.gz> --start 1500 --count 60 --feed-bench    # FrameRecord feed, ms/frame + KB/frame
target/release/emit_seq <tape.json.gz> --start 1500 --count 60 --camera-gate   # closed-form camera vs the fitted block (report)
python tools/seq_diff.py py.seq out.seq                                          # exact per draw
bash tools/gate_l1.sh                                                            # the L1/L2 table (MODE=sprites for W1)

cargo build --lib --release --target wasm32-unknown-unknown --features web       # the browser module
wasm-bindgen --target web --out-dir <replay>/wasm target/wasm32-unknown-unknown/release/rr_render.wasm
python tools/pack_assets.py <tape.json.gz> -o <replay>/packs/<match> --tape-copy # asset pack (ROM-derived, self-ignored)
node tools/gate_l3.mjs --seq gold.seq --tape packs/<m>/tape.json.gz --pack packs/<m> --start 1500 --count 60   # L3 pixels
python tools/freeze_template.py                                                  # regenerate src/frozen/*.json from the two packs
```

Browser replay: `python serve.py` in `d3dcap/replay`, then
`http://localhost:8099/player.html?tape=packs/<match>/tape.json.gz&pack=packs/<match>&start=1500&count=300&auto=1`.

ROM-derived inputs (PL rips, GFX bins, stage rips, tcw pages, packs) and every `.seq` output stay out of git.
