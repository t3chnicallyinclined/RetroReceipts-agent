//! CAMERA -- `tape_to_seq.scene_block` (the fitted 108-float model in `d3dcap/replay/camera_block.json`),
//! `scene_VP` and `sprite_vertex_z` (FUN_1408432e0), with numpy's float32 arithmetic reproduced in f32.
//! W1 needs only the projection P (slot 3 during the sprite walk); the closed-form camera
//! (WORLD-CAMERA-GHIDRA.md) replaces this model in W2 and must be gated against it (review-render §4.2 (a)).
use crate::util::{f32le, Res};
use std::collections::HashMap;

enum Kind { Const(f64), Lin(f64, f64, f64) }
struct Variant { scale: f64, model: Vec<Kind> }

pub struct CameraModel { variants: HashMap<String, Variant> }

impl CameraModel {
    /// `scene_block.model = json.load(open(CAMERA_BLOCK))`
    pub fn from_json(bytes: &[u8]) -> Res<CameraModel> {
        let v: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| format!("camera_block.json: {e}"))?;
        let mut variants = HashMap::new();
        for (name, m) in v.as_object().ok_or("camera_block.json: not an object")? {
            let scale = m.get("scale").and_then(|x| x.as_f64()).unwrap_or(1.0);
            let model_o = m.get("model").and_then(|x| x.as_object()).ok_or(format!("camera_block.json: {name} has no model"))?;
            let mut model = Vec::with_capacity(108);
            for i in 0..108 {
                let k = model_o.get(&i.to_string()).and_then(|x| x.as_array()).ok_or(format!("camera_block.json: {name} model[{i}] missing"))?;
                let kind = k.get(0).and_then(|x| x.as_str()).unwrap_or("");
                if kind == "const" {
                    model.push(Kind::Const(k.get(1).and_then(|x| x.as_f64()).unwrap_or(0.0)));
                } else {
                    let abc = k.get(1).and_then(|x| x.as_array()).ok_or(format!("camera_block.json: {name} model[{i}] lin"))?;
                    let g = |j: usize| abc.get(j).and_then(|x| x.as_f64()).unwrap_or(0.0);
                    model.push(Kind::Lin(g(0), g(1), g(2)));
                }
            }
            variants.insert(name.clone(), Variant { scale, model });
        }
        Ok(CameraModel { variants })
    }

    /// `scene_block(cam, variant)`: the 432-byte scene constant block. Evaluated in f64 (`a * cx + b * cy + c`,
    /// Python float arithmetic) and packed `<108f` (f64 -> f32 round-to-nearest).
    pub fn scene_block(&self, cam: (f64, f64), variant: &str) -> Option<[u8; 432]> {
        let m = self.variants.get(variant)?;
        let (cx, cy) = (cam.0 * m.scale, cam.1 * m.scale);
        let mut out = [0u8; 432];
        for (i, k) in m.model.iter().enumerate() {
            let v: f64 = match k { Kind::Const(c) => *c, Kind::Lin(a, b, c) => a * cx + b * cy + c };
            out[i * 4..i * 4 + 4].copy_from_slice(&(v as f32).to_le_bytes());
        }
        Some(out)
    }
}

/// `scene_VP`: V = rows 7..10, P = rows 15..18 of the block, float32, row-major 4x4.
pub fn scene_v(scb: &[u8]) -> [[f32; 4]; 4] { mat_at(scb, 7 * 16) }
pub fn scene_p(scb: &[u8]) -> [[f32; 4]; 4] { mat_at(scb, 15 * 16) }

fn mat_at(scb: &[u8], off: usize) -> [[f32; 4]; 4] {
    let mut m = [[0f32; 4]; 4];
    for i in 0..4 { for j in 0..4 { m[i][j] = f32le(scb, off + (i * 4 + j) * 4); } }
    m
}

/// `sprite_vertex_z(D, P)` = FUN_1408432e0: `z = (P[3,2] - D*P[2,2]) / D` in float32, `max(0, z)`; D == 0 -> 0.
pub fn sprite_vertex_z(d: f32, p: &[[f32; 4]; 4]) -> f32 {
    if d == 0.0 { return 0.0; }
    let z = (p[3][2] - d * p[2][2]) / d;
    if z > 0.0 { z } else { 0.0 }   // Python max(np.float32(0), z): 0 unless z is strictly greater
}
