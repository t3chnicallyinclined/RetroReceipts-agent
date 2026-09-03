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
#[derive(Default, Clone)]
pub struct OrderedMap<V> { pub keys: Vec<String>, pub vals: Vec<V>, index: std::collections::HashMap<String, usize> }

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
