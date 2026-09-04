//! Byte helpers shared by the modules. No I/O.
use sha2::{Digest, Sha256};
use std::io::Read;

pub type Res<T> = Result<T, String>;

/// tape_to_seq.sha8: sha256 hexdigest()[:16].
pub fn sha8(b: &[u8]) -> String {
    let d = Sha256::digest(b);
    let mut s = String::with_capacity(16);
    for x in &d[..8] { s.push_str(&format!("{:02x}", x)); }
    s
}

pub fn sha256(b: &[u8]) -> [u8; 32] {
    let d = Sha256::digest(b);
    let mut o = [0u8; 32];
    o.copy_from_slice(&d);
    o
}

pub fn gunzip(b: &[u8]) -> Res<Vec<u8>> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(b).read_to_end(&mut out).map_err(|e| format!("gunzip: {e}"))?;
    Ok(out)
}

/// gzip.decompress(base64.b64decode(s)) -- the encoding of every binary stream in the tape envelope.
pub fn gz_b64(s: &str) -> Res<Vec<u8>> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|e| format!("base64: {e}"))?;
    gunzip(&raw)
}

#[inline] pub fn u16le(b: &[u8], o: usize) -> u16 { u16::from_le_bytes([b[o], b[o + 1]]) }
#[inline] pub fn i16le(b: &[u8], o: usize) -> i16 { i16::from_le_bytes([b[o], b[o + 1]]) }
#[inline] pub fn u32le(b: &[u8], o: usize) -> u32 { u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) }
#[inline] pub fn i32le(b: &[u8], o: usize) -> i32 { i32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) }
#[inline] pub fn u64le(b: &[u8], o: usize) -> u64 { let mut a = [0u8; 8]; a.copy_from_slice(&b[o..o + 8]); u64::from_le_bytes(a) }
#[inline] pub fn f32le(b: &[u8], o: usize) -> f32 { f32::from_bits(u32le(b, o)) }

/// Insertion-ordered string map (Python dict / OrderedDict semantics) without an extra dependency.
#[derive(Clone)]
pub struct OrderedMap<V> { pub keys: Vec<String>, pub vals: Vec<V>, index: std::collections::HashMap<String, usize> }

impl<V> Default for OrderedMap<V> { fn default() -> Self { Self::new() } }

impl<V> OrderedMap<V> {
    pub fn new() -> Self { Self { keys: Vec::new(), vals: Vec::new(), index: Default::default() } }
    pub fn len(&self) -> usize { self.keys.len() }
    pub fn contains(&self, k: &str) -> bool { self.index.contains_key(k) }
    pub fn get(&self, k: &str) -> Option<&V> { self.index.get(k).map(|&i| &self.vals[i]) }
    pub fn position(&self, k: &str) -> Option<usize> { self.index.get(k).copied() }
    /// Insert only if absent (Python `if key not in d: d[key] = v`). Returns the index.
    pub fn insert_new(&mut self, k: &str, v: V) -> usize {
        if let Some(&i) = self.index.get(k) { return i; }
        self.keys.push(k.to_string()); self.vals.push(v);
        let i = self.keys.len() - 1;
        self.index.insert(k.to_string(), i);
        i
    }
    pub fn iter(&self) -> impl Iterator<Item = (&String, &V)> { self.keys.iter().zip(self.vals.iter()) }
}

/// RR_PROF=1 phase timing (native only; a no-op on wasm). `prof::lap("name", &mut t)` accumulates ms into a
/// thread-local table `emit_row` prints every 60 rows.
#[cfg(not(target_arch = "wasm32"))]
pub mod prof {
    use std::cell::RefCell;
    use std::collections::HashMap;
    thread_local! {
        pub static ON: bool = std::env::var("RR_PROF").is_ok();
        pub static T: RefCell<HashMap<&'static str, (f64, u64)>> = RefCell::new(HashMap::new());
    }
    #[inline] pub fn on() -> bool { ON.with(|b| *b) }
    #[inline] pub fn now() -> std::time::Instant { std::time::Instant::now() }
    #[inline] pub fn lap(name: &'static str, t: &mut std::time::Instant) {
        if !on() { return }
        let d = t.elapsed().as_secs_f64() * 1000.0;
        T.with(|c| { let mut m = c.borrow_mut(); let e = m.entry(name).or_insert((0.0, 0)); e.0 += d; e.1 += 1; });
        *t = std::time::Instant::now();
    }
    pub fn report(rows: u64) -> String {
        T.with(|c| {
            let m = c.borrow();
            let mut v: Vec<_> = m.iter().collect();
            v.sort_by(|a, b| (b.1).0.partial_cmp(&(a.1).0).unwrap());
            v.iter().map(|(k, e)| format!("{} {:.2} ms", k, e.0 / rows.max(1) as f64)).collect::<Vec<_>>().join(" | ")
        })
    }
}

#[cfg(target_arch = "wasm32")]
pub mod prof {
    pub struct Instant;
    #[inline] pub fn on() -> bool { false }
    #[inline] pub fn now() -> Instant { Instant }
    #[inline] pub fn lap(_n: &'static str, _t: &mut Instant) {}
    pub fn report(_rows: u64) -> String { String::new() }
}

// ── SHARED GEOMETRY (FrameRecord v2) ────────────────────────────────────────────────────────────────────────
// A frame's vertex/index bytes are a LIST OF SEGMENTS, each either INLINE (bytes this record carries) or a
// reference to a SHARED BLOB an earlier record already sent. The concatenation of a frame's segments is
// byte-for-byte the single buffer the old format sent whole, and `len()` counts the total, so every `voff` and
// `firstIndex` derived from it is unchanged -- the sharing is invisible above this type.
//
// The lever: the arc stage deck is ~464 KB of a ~706 KB record and its bytes depend only on the deck colour, so
// it is one blob per deck colour for a whole match instead of 464 KB re-serialised 60 times a second.

/// One shared geometry blob: vertex bytes, or index words (kept as words so the `.seq` path can flatten them).
#[derive(Clone, Debug)]
pub enum Blob { Verts(Vec<u8>), Idxs(Vec<u32>) }

impl Blob {
    pub fn byte_len(&self) -> usize { match self { Blob::Verts(v) => v.len(), Blob::Idxs(v) => v.len() * 4 } }
    /// The blob as it goes on the wire (index words little-endian).
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            Blob::Verts(v) => v.clone(),
            Blob::Idxs(v) => { let mut o = Vec::with_capacity(v.len() * 4); for i in v { o.extend_from_slice(&i.to_le_bytes()); } o }
        }
    }
}

/// Blobs by id, first-seen order (the feed sends each one once, exactly like the texture and CB tables).
#[derive(Default, Clone, Debug)]
pub struct BlobStore { pub blobs: Vec<Blob> }

impl BlobStore {
    pub fn push(&mut self, b: Blob) -> u32 { self.blobs.push(b); (self.blobs.len() - 1) as u32 }
    pub fn len(&self) -> usize { self.blobs.len() }
    pub fn is_empty(&self) -> bool { self.blobs.is_empty() }
}

/// Vertex bytes as segments. `extend_from_slice` / `extend` append INLINE; `push_blob` references a shared blob.
#[derive(Default, Clone, Debug)]
pub struct VbSegs { pub inline: Vec<u8>, pub segs: Vec<(i32, u32)>, total: usize }

impl VbSegs {
    #[inline] pub fn len(&self) -> usize { self.total }
    #[inline] pub fn is_empty(&self) -> bool { self.total == 0 }
    #[inline] fn grew(&mut self, n: usize) {
        match self.segs.last_mut() { Some(s) if s.0 < 0 => s.1 += n as u32, _ => self.segs.push((-1, n as u32)) }
        self.total += n;
    }
    #[inline] pub fn extend_from_slice(&mut self, b: &[u8]) { self.inline.extend_from_slice(b); self.grew(b.len()); }
    #[inline] pub fn extend<I: IntoIterator<Item = u8>>(&mut self, it: I) {
        let n0 = self.inline.len(); self.inline.extend(it); let n = self.inline.len() - n0; self.grew(n);
    }
    #[inline] pub fn push_blob(&mut self, id: u32, byte_len: usize) { self.segs.push((id as i32, byte_len as u32)); self.total += byte_len; }
    /// The whole buffer as the old format sent it (the `.seq` writer and the L1/L2 gates).
    pub fn flatten(&self, store: &BlobStore) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.total);
        let mut at = 0usize;
        for &(id, n) in &self.segs {
            if id < 0 { out.extend_from_slice(&self.inline[at..at + n as usize]); at += n as usize; }
            else { match &store.blobs[id as usize] { Blob::Verts(v) => out.extend_from_slice(v), Blob::Idxs(_) => panic!("index blob in a vertex segment") } }
        }
        out
    }
}

/// Index words as segments. Lengths here are INDEX COUNTS (the wire converts to bytes).
#[derive(Default, Clone, Debug)]
pub struct IbSegs { pub inline: Vec<u32>, pub segs: Vec<(i32, u32)>, total: usize }

impl IbSegs {
    #[inline] pub fn len(&self) -> usize { self.total }
    #[inline] pub fn is_empty(&self) -> bool { self.total == 0 }
    #[inline] fn grew(&mut self, n: usize) {
        match self.segs.last_mut() { Some(s) if s.0 < 0 => s.1 += n as u32, _ => self.segs.push((-1, n as u32)) }
        self.total += n;
    }
    #[inline] pub fn extend_from_slice(&mut self, b: &[u32]) { self.inline.extend_from_slice(b); self.grew(b.len()); }
    #[inline] pub fn extend<I: IntoIterator<Item = u32>>(&mut self, it: I) {
        let n0 = self.inline.len(); self.inline.extend(it); let n = self.inline.len() - n0; self.grew(n);
    }
    #[inline] pub fn push_blob(&mut self, id: u32, count: usize) { self.segs.push((id as i32, count as u32)); self.total += count; }
    pub fn flatten(&self, store: &BlobStore) -> Vec<u32> {
        let mut out = Vec::with_capacity(self.total);
        let mut at = 0usize;
        for &(id, n) in &self.segs {
            if id < 0 { out.extend_from_slice(&self.inline[at..at + n as usize]); at += n as usize; }
            else { match &store.blobs[id as usize] { Blob::Idxs(v) => out.extend_from_slice(v), Blob::Verts(_) => panic!("vertex blob in an index segment") } }
        }
        out
    }
}

/// The keys a FrameRecord carries PER DRAW, so they are not part of a pipeline-state identity.
pub const PER_DRAW_KEYS: [&str; 8] = ["i", "firstIndex", "indexCount", "stride", "voff", "tex", "vscbHash", "pscbHash"];

/// Content fingerprint of a draw's pipeline-state map, `PER_DRAW_KEYS` excluded. Computed ONCE where the state is
/// interned (`WorldTemplate::select`, the sprite template) and carried on the `Draw`, so the feed does not re-walk
/// a ~15-key nested JSON map for every one of ~500 draws a frame just to look an id up.
pub fn state_fp(m: &serde_json::Map<String, serde_json::Value>) -> u64 {
    use serde_json::Value;
    use std::hash::{Hash, Hasher};
    fn hv(v: &Value, h: &mut std::collections::hash_map::DefaultHasher) {
        match v {
            Value::Null => 0u8.hash(h),
            Value::Bool(b) => { 1u8.hash(h); b.hash(h) }
            Value::Number(n) => { 2u8.hash(h); if let Some(i) = n.as_i64() { i.hash(h) } else { n.as_f64().unwrap_or(0.0).to_bits().hash(h) } }
            Value::String(s) => { 3u8.hash(h); s.hash(h) }
            Value::Array(a) => { 4u8.hash(h); a.len().hash(h); for x in a { hv(x, h) } }
            Value::Object(o) => { 5u8.hash(h); o.len().hash(h); for (k, x) in o { k.hash(h); hv(x, h) } }
        }
    }
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for (k, v) in m { if PER_DRAW_KEYS.contains(&k.as_str()) { continue; } k.hash(&mut h); hv(v, &mut h); }
    h.finish()
}
