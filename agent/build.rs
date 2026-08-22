// Build script: stage the bundled injector proxy dll into OUT_DIR so host.rs can `include_bytes!` it,
// and flip `cfg(injector_bundled)` when a real (non-empty) dll is present.
//
// The dll is produced by the release pipeline (scripts/build-injector.sh -> agent/assets/version.dll,
// gitignored). In a dev build with no dll we stage an EMPTY placeholder so the crate still compiles;
// host mode then reports the injector isn't bundled instead of failing to build.
use std::path::Path;

fn main() {
    // Declare the custom cfg so rustc (1.80+) doesn't warn about an "unexpected cfg".
    println!("cargo:rustc-check-cfg=cfg(injector_bundled)");
    println!("cargo:rerun-if-changed=assets/version.dll");

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR set by cargo");
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR set by cargo");
    let dst = Path::new(&out_dir).join("version.dll");
    let src = Path::new(&manifest).join("assets").join("version.dll");

    let bundled = matches!(std::fs::metadata(&src), Ok(m) if m.len() > 0);
    if bundled {
        std::fs::copy(&src, &dst).expect("stage injector version.dll into OUT_DIR");
        println!("cargo:rustc-cfg=injector_bundled");
    } else {
        // No real dll (dev build). Empty placeholder keeps include_bytes! valid.
        std::fs::write(&dst, b"").expect("write empty injector placeholder into OUT_DIR");
    }
}
