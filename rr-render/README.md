# rr-render

Retro Receipts tape decoder + sprite emitter in Rust — a verbatim port of the gated Python oracle
`mvc-live-skins-quarters/d3dcap/replay/tape_to_seq.py` (sprite pass), `v3gate.py` rules and
`rip_gfx2_assembly.read_cells`. Python stays the oracle; `tools/seq_diff.py` gates Rust against it draw by draw.

Module map, gate numbers and the W2 plan: `mvc-live-skins-quarters/docs/RR-RENDER-CRATE.md`.

```
cargo build --release
target/release/emit_seq <tape.json.gz> --start 1500 --count 60 -o out.seq      # sprites only (== tape_to_seq.py --no-world)
python tools/seq_diff.py py.seq out.seq                                          # exact per draw
bash tools/gate_l1.sh                                                            # the whole L1 table
cargo check --lib --target wasm32-unknown-unknown                                # the core is wasm-friendly
```

ROM-derived inputs (PL rips, GFX bins, camera/template packs) and every `.seq` output stay out of git.
