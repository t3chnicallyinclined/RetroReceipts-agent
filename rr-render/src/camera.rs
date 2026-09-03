//! CAMERA -- (a) `tape_to_seq.scene_block` (the fitted 108-float model in `d3dcap/replay/camera_block.json`),
//! `scene_VP` and `sprite_vertex_z` (FUN_1408432e0), with numpy's float32 arithmetic reproduced in f32 -- this is
//! what the emitter USES (the Python oracle ships the fitted model); (b) the CLOSED FORM of
//! docs/WORLD-CAMERA-GHIDRA.md §2 (`FUN_140847f20` perspective, `FUN_140846c80` look-at, the three call sites),
//! provided for the gate `closed_form_gate` -- it replaces (a) only once bit-identical.
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
    if z > 0.0 { z } else { 0.0 }
}

// ── closed form (WORLD-CAMERA-GHIDRA.md §2; f32 throughout, as the recompiled game computes) ─────────────

/// `FUN_140847f20(angle u16, aspect, near, far)` with offsets (ox, oy) from `FUN_140848200`.
pub fn perspective(angle: u16, aspect: f32, near: f32, far: f32, ox: f32, oy: f32) -> [[f32; 4]; 4] {
    let t = ((angle as f32 * 6.2831855f32) * (1.0f32 / 65536.0f32) * 0.5f32).tan();
    let h = ((t * 240.0f32) / 320.0f32).atan();
    let cot = h.cos() / h.sin();
    [[cot / aspect, 0.0, 0.0, 0.0],
     [0.0, cot, 0.0, 0.0],
     [-ox, -oy, -(far + near) / (far - near), -1.0],
     [0.0, 0.0, -2.0f32 * far * near / (far - near), 0.0]]
}

fn norm3(v: [f32; 3]) -> [f32; 3] { let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt(); [v[0] / l, v[1] / l, v[2] / l] }
fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

fn mm4(a: &[[f32; 4]; 4], b: &[[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut o = [[0f32; 4]; 4];
    for i in 0..4 { for j in 0..4 { let mut acc = a[i][0] * b[0][j]; for k in 1..4 { acc = a[i][k].mul_add(b[k][j], acc); } o[i][j] = acc; } }
    o
}

/// `FUN_140846c80(eye, target, roll)`: `V = L x Rz(roll)` (row-vector convention; Rz first, then L pre-multiplied).
pub fn look_at(eye: [f32; 3], target: [f32; 3], roll: u16) -> [[f32; 4]; 4] {
    let d = norm3([-(target[0] - eye[0]), -(target[1] - eye[1]), -(target[2] - eye[2])]);
    let r = norm3(cross3([0.0, 1.0, 0.0], d));
    let u = cross3(d, r);
    let l = [[r[0], u[0], d[0], 0.0], [r[1], u[1], d[1], 0.0], [r[2], u[2], d[2], 0.0], [-dot3(eye, r), -dot3(eye, u), -dot3(eye, d), 1.0]];
    if roll == 0 { return l; }
    let th = (roll as f32 * 6.2831855f32) * (1.0f32 / 65536.0f32);
    let (s, c) = (th.sin(), th.cos());
    let rz = [[c, s, 0.0, 0.0], [-s, c, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]];
    mm4(&l, &rz)
}

/// `(blk+0x6974 * 65536/360 + 0.5) & 0xFFFF`
pub fn fov_angle(fov_deg: f32) -> u16 { ((fov_deg * (65536.0f32 / 360.0f32) + 0.5f32) as i64 & 0xFFFF) as u16 }

/// The (V, P) pair of one call site: `list6` = FUN_14061d7e0 (far 1.4e6), `list7` = FUN_14061d6a0 (eye/target x0.1,
/// far 12000), `hud` = FUN_14061d5b0 (angle 0x4000, offsets 0, V = I, far 12000). near = 1.0 on all three.
pub fn closed_form_vp(variant: &str, eye: [f32; 3], target: [f32; 3], fov_deg: f32, yoff: f32, roll: u16) -> ([[f32; 4]; 4], [[f32; 4]; 4]) {
    let aspect = 1.3333334f32;
    match variant {
        "hud" => ([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]],
                  perspective(0x4000, aspect, 1.0, 12000.0, 0.0, 0.0)),
        "list7" => (look_at([eye[0] * 0.1, eye[1] * 0.1, eye[2] * 0.1], [target[0] * 0.1, target[1] * 0.1, target[2] * 0.1], roll),
                    perspective(fov_angle(fov_deg), aspect, 1.0, 12000.0, 0.0, yoff)),
        _ => (look_at(eye, target, roll), perspective(fov_angle(fov_deg), aspect, 1.0, 1400000.0, 0.0, yoff)),
    }
}

/// One matrix comparison: max abs error, bit-identical entries, entries equal in value but not in bits
/// (signed zero: the fitted model carries -0.0 where the closed form has 0.0 or vice versa).
#[derive(Clone, Copy, Debug, Default)]
pub struct MatCmp { pub max_abs: f32, pub bit_exact: usize, pub signed_zero: usize }

/// The closed form against the fitted block rows 7..10 (V) and 15..18 (P), per variant, for one camera.
pub fn closed_form_gate(cm: &CameraModel, variant: &str, cam: (f64, f64), eye: [f32; 3], target: [f32; 3], fov_deg: f32, yoff: f32, roll: u16)
    -> Option<(MatCmp, MatCmp)> {
    let scb = cm.scene_block(cam, variant)?;
    let (vf, pf) = (scene_v(&scb), scene_p(&scb));
    let (vc, pc) = closed_form_vp(variant, eye, target, fov_deg, yoff, roll);
    let cmp = |a: &[[f32; 4]; 4], b: &[[f32; 4]; 4]| {
        let mut c = MatCmp::default();
        for i in 0..4 { for j in 0..4 {
            let d = (a[i][j] - b[i][j]).abs(); if d > c.max_abs { c.max_abs = d; }
            if a[i][j].to_bits() == b[i][j].to_bits() { c.bit_exact += 1; } else if a[i][j] == b[i][j] { c.signed_zero += 1; }
        } }
        c
    };
    Some((cmp(&vf, &vc), cmp(&pf, &pc)))
}
