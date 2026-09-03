//! rr_agent -- the library half of the Retro Receipts agent (GATE 2, docs/RECEIPT-RUNNER-GATE2.md).
//!
//! `mem`     the cross-platform process-memory layer (unchanged; the tray bin re-exports it at its root).
//! `harvest` the tape harvest + encoders behind the `MemSource` seam -- the ONLY code that turns game memory into
//!           tape bytes, shared by the live agent (ReadProcessMemory) and the receipt runner emitter.
//! `runner`  a `MemSource` over the receipt runner's per-tick images + the emitter that produces a v5 tape from them.
// the tape record json! envelope needs the same recursion limit as the bin (serde_json expands per token)
#![recursion_limit = "256"]
pub mod mem;
pub mod harvest;
pub mod runner;
