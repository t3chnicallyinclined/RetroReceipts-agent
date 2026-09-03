//! rr-tape -- emit a v5 TAPE from the receipt runner's per-tick memory images (GATE 2, docs/RECEIPT-RUNNER-GATE2.md).
//!
//!   rr-tape --pre <run\pre> --ticks <rr_runner --out dir, made with --harvest-dump> --n 300 -o <tape.json.gz>
//!           [--match-key K] [--reporter R]
//!
//! Same harvest, same encoders as the live agent (rr_agent::harvest); the memory comes from rr_agent::runner::RunnerView.
//! Output = the .json.gz the agent would have spooled. Prints one JSON line of stats.
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut pre, mut ticks, mut out) = (None::<PathBuf>, None::<PathBuf>, None::<PathBuf>);
    let (mut n, mut key, mut rep) = (300usize, "runner".to_string(), "runner".to_string());
    let mut i = 0;
    while i < args.len() {
        let next = |i: &mut usize| -> String { *i += 1; args.get(*i).cloned().unwrap_or_default() };
        match args[i].as_str() {
            "--pre" => pre = Some(PathBuf::from(next(&mut i))),
            "--ticks" => ticks = Some(PathBuf::from(next(&mut i))),
            "--n" => n = next(&mut i).parse().unwrap_or(300),
            "-o" | "--out" => out = Some(PathBuf::from(next(&mut i))),
            "--match-key" => key = next(&mut i),
            "--reporter" => rep = next(&mut i),
            a => { eprintln!("unknown argument {a}"); std::process::exit(2); }
        }
        i += 1;
    }
    let (Some(pre), Some(ticks), Some(out)) = (pre, ticks, out) else {
        eprintln!("usage: rr-tape --pre <run\\pre> --ticks <runner out dir> [--n 300] -o <tape.json.gz> [--match-key K] [--reporter R]");
        std::process::exit(2);
    };
    match rr_agent::runner::emit_runner_tape(&pre, &ticks, n, &key, &rep) {
        Ok((built, st)) => {
            if let Err(e) = std::fs::write(&out, &built.gz) { eprintln!("{}: {e}", out.display()); std::process::exit(1); }
            println!("{{\"out\":{:?},\"bytes\":{},\"ticks\":{},\"frames\":{},\"clock_first\":{},\"clock_last\":{},\"rejected_rows\":{:?},\"nodes\":{},\"anodes\":{},\"aobjs\":{},\"palrows\":{},\"calib_frames\":{},\"dcram_delta_pages\":{},\"dcram_delta_bytes\":{}}}",
                     out.display().to_string(), built.gz.len(), st.ticks, st.frames, st.clock_first, st.clock_last, st.rejected_rows, st.nodes, st.anodes, st.aobjs, st.palrows, st.calib_frames, st.delta_pages, st.delta_bytes);
        }
        Err(e) => { eprintln!("rr-tape: {e}"); std::process::exit(1); }
    }
}
