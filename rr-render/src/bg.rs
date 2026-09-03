//! FRAME BACKGROUND -- `bg_rule.py` verbatim (FUN_1406101b0 == loc_8c02dc4c; docs/FRAME-BACKGROUND-GHIDRA.md):
//! `STAGE_BG`, `mul_word` (f32 per byte, int trunc, & 0xff), `background_words`, `vertex_colours`, `from_row`.
use crate::tape::Tape;
use serde_json::Value;
use std::collections::BTreeMap;

/// stage id (blk+0x6D04) -> (mode, [word0, word1, word2]) as the stage initialiser writes blk+0x6CB4..0x6CC3
pub fn stage_bg(stage: i64) -> Option<(i64, [i64; 3])> {
    Some(match stage {
        0x00 => (0, [0x007f7f7f, 0, 0]), 0x01 => (0, [0x006061e3, 0, 0]), 0x02 => (0, [0, 0, 0]),
        0x03 => (2, [0, 0x00b0459a, 0]), 0x04 => (0, [0x007f7f7f, 0, 0]), 0x05 => (0, [0, 0, 0]),
        0x06 => (0, [0x007f7f7f, 0, 0]), 0x07 => (0, [0x007f7f7f, 0, 0]), 0x08 => (0, [0, 0, 0]),
        0x09 => (0, [0, 0, 0]), 0x0A => (0, [0x006061e3, 0, 0]), 0x0B => (0, [0, 0, 0]),
        0x0C => (2, [0, 0x00b0459a, 0]), 0x0D => (0, [0x007f7f7f, 0, 0]), 0x0E => (0, [0, 0, 0]),
        0x0F => (0, [0x007f7f7f, 0, 0]), 0x10 => (0, [0x007f7f7f, 0, 0]),
        _ => return None,
    })
}

/// bg_rule.mul_word: per byte `int(np.float32(byte) * np.float32(deck[k])) & 0xff`.
pub fn mul_word(word: i64, deck: (f64, f64, f64)) -> i64 {
    let (b0, b1, b2) = (word & 0xff, (word >> 8) & 0xff, (word >> 16) & 0xff);
    let (d0, d1, d2) = (deck.0 as f32, deck.1 as f32, deck.2 as f32);
    let r = ((b2 as f32 * d0) as i64) & 0xff;
    let g = ((b1 as f32 * d1) as i64) & 0xff;
    let b = ((b0 as f32 * d2) as i64) & 0xff;
    (r << 16) | (g << 8) | b
}

/// bg_rule.background_words -> (c0, c1, c2) or None (mode outside 0..3).
pub fn background_words(mode: i64, words: [i64; 3], deck: (f64, f64, f64), fade: i64, fade_col: i64, blackout: i64, ent6: i64, in_fight: bool) -> Option<(i64, i64, i64)> {
    let mut mode = mode;
    let (a, b, c);
    if !in_fight {
        a = words[0] & 0xffffff; b = words[1] & 0xffffff; c = words[2] & 0xffffff;
    } else if fade != 0 {
        mode = 0; a = fade_col & 0xffffff; b = 0; c = 0;
    } else if blackout != 0 && ent6 != 0 {
        mode = 0; a = 0; b = 0; c = 0;
    } else {
        a = mul_word(words[0], deck);
        b = if mode >= 1 { mul_word(words[1], deck) } else { 0 };
        c = if mode == 3 { mul_word(words[2], deck) } else { 0 };
    }
    match mode { 0 => Some((a, a, a)), 1 => Some((a, b, a)), 2 => Some((a, a, b)), 3 => Some((a, b, c)), _ => None }
}

/// bg_rule.vertex_colours: (R, G, B, A) x 4 in submission order TL, BL, TR, BR.
pub fn vertex_colours(c: (i64, i64, i64)) -> [[u8; 4]; 4] {
    let rgba = |w: i64| [((w >> 16) & 0xff) as u8, ((w >> 8) & 0xff) as u8, (w & 0xff) as u8, 0xff];
    [rgba(c.0), rgba(c.1), rgba(c.2), rgba(c.2)]
}

/// bg_rule.from_row: the 0.3.42 columns when present, else the per-stage table + deck/blackout rows.
pub fn from_row(tape: &Tape, r: &Value, stage_id: Option<i64>, stats: &mut BTreeMap<String, u64>) -> Option<(i64, i64, i64)> {
    let deck = match tape.cell(r, "deck") {
        Some(v) if v.is_array() => { let a = tape.arr(r, "deck").unwrap_or_default(); (a.get(0).copied().unwrap_or(0.0), a.get(1).copied().unwrap_or(0.0), a.get(2).copied().unwrap_or(0.0)) }
        _ => (1.0, 1.0, 1.0),
    };
    let mut blackout = tape.num(r, "blackout").map(|x| x as i64).unwrap_or(0);
    let (mode, words, fade, fade_col, in_fight, ent6);
    if tape.has_col("bg_mode") && tape.has_col("bg_col") {
        mode = tape.num(r, "bg_mode").unwrap_or(0.0) as i64;
        let w = tape.arr(r, "bg_col").unwrap_or_default();
        words = [w.get(0).copied().unwrap_or(0.0) as i64, w.get(1).copied().unwrap_or(0.0) as i64, w.get(2).copied().unwrap_or(0.0) as i64];
        fade = tape.num(r, "fade_mode").unwrap_or(0.0) as i64;
        fade_col = tape.num(r, "fade_col").unwrap_or(0.0) as i64;
        let mut inf = true; let mut e6v = 1;
        if let Some(g) = tape.arr(r, "bg_gate") {
            if g.len() >= 6 {
                let (g0, g1, g2, g2e, e6, e96) = (g[0] as i64, g[1] as i64, g[2] as i64, g[3] as i64, g[4] as i64, g[5] as i64);
                inf = (g0, g1, g2) == (2, 1, 2) && (g2e & 1) == 0;
                if e6 != 0xff { e6v = e6; }
                if e96 != 0xff { blackout = e96; }
            }
        }
        in_fight = inf; ent6 = e6v;
        *stats.entry("tape bytes".into()).or_insert(0) += 1;
    } else {
        let sid = stage_id?;
        let Some((m, w)) = stage_bg(sid) else {
            *stats.entry(format!("no table entry for stage {}", sid)).or_insert(0) += 1;
            return None;
        };
        mode = m; words = w; fade = 0; fade_col = 0; in_fight = true; ent6 = 1;
        *stats.entry("per-stage table (tape lacks bg bytes)".into()).or_insert(0) += 1;
    }
    let out = background_words(mode, words, deck, fade, fade_col, blackout, ent6, in_fight);
    *stats.entry(format!("mode {}", mode)).or_insert(0) += 1;
    if fade != 0 { *stats.entry("fade frames".into()).or_insert(0) += 1; }
    if blackout != 0 && ent6 != 0 && in_fight && fade == 0 { *stats.entry("blackout (black) frames".into()).or_insert(0) += 1; }
    out
}
