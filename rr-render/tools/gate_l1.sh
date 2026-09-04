#!/usr/bin/env bash
# L1 gate: draw-list equality of rr-render vs the Python oracle (tape_to_seq.py --no-world), sprite draws.
# The --start values below are the rows that cover the named frame clocks (recorded here, not in prose):
#   stage-13 59613662: row 1500 = clock 2743; clock 4445 = row 3202, 4505 = row 3262, 7279 = row 6036
#   training 59613506: clock 4445 = row 3437, 4505 = row 3497 (7279 is outside this tape's range 1008..5788)
#   rotation 59612784: general-rotation nodes at clocks 4463..5208 = rows 3250..3995
#   palrows  59614009: 0.3.41 tape (palrows present), any in-match clip
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PY=C:/Users/trist/projects/mvc-live-skins-quarters/d3dcap/replay
# gs-cache is a ring and rolls over; the four gate tapes live in replay-kit/tapes-kept (2026-09-04)
GS=C:/Users/trist/projects/mvc-live-skins-quarters/replay-kit/tapes-kept
KEPT=C:/Users/trist/projects/mvc-live-skins-quarters/replay-kit/tapes-kept
OUT="${GATE_OUT:-$TEMP/rr-render-gate}"; mkdir -p "$OUT"
EMIT="$HERE/../target/release/emit_seq.exe"
[ -x "$EMIT" ] || (cd "$HERE/.." && cargo build --release)

# MODE=sprites (W1: both sides --no-world) or MODE=full (W2: the whole frame -- preamble, deck, world lists, sprites, HUD)
MODE="${MODE:-full}"
gate() {  # name tape start count [extra-diff-args]
  local name=$1 tape=$2 start=$3 count=$4 extra=$5 nw=""
  [ "$MODE" = sprites ] && nw=--no-world
  echo "== $MODE $name  ($(basename "$tape") --start $start --count $count)"
  (cd "$PY" && PYTHONIOENCODING=utf-8 python tape_to_seq.py "$tape" --start "$start" --count "$count" $nw -o "$OUT/py_$name.seq" >/dev/null)
  "$EMIT" "$tape" --start "$start" --count "$count" $nw -o "$OUT/rs_$name.seq" >/dev/null
  python "$HERE/seq_diff.py" "$OUT/py_$name.seq" "$OUT/rs_$name.seq" $extra
}

T13="$GS/76561197999665347_76561199789482789_76561199789482789_59613662_76561197999665347.json.gz"
T11="$GS/76561197999665347_76561198047120675_76561198047120675_59613506_76561197999665347.json.gz"
TPAL="$GS/76561197999665347_76561199799517760_76561199799517760_59614009_76561197999665347.json.gz"
TROT="$KEPT/76561197999665347_76561198029172402_76561198029172402_59612784_76561197999665347.json.gz"

gate stage13_1500 "$T13" 1500 60
gate stage13_7279 "$T13" 6000 60
gate train_4445_4505 "$T11" 3430 80
gate palrows_1000 "$TPAL" 1000 60
gate rot_3245 "$TROT" 3245 60

# closed-form camera vs the fitted camera_block.json rows (report only; the emitter keeps the fitted model)
echo "== camera closed form vs fitted block"
"$EMIT" "$T13" --start 1500 --count 60 --camera-gate | grep "camera gate"
"$EMIT" "$TPAL" --start 1000 --count 60 --camera-gate | grep "camera gate"
