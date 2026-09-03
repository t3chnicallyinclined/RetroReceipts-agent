#!/usr/bin/env python3
"""seq_diff.py -- gate a Rust-emitted RRSQ against the Python oracle's, draw by draw.

    python seq_diff.py gold.seq rust.seq [--sprites-only]

Per frame, per draw: every JSON field of the draw record (state copied from the template, i, firstIndex,
indexCount, stride, voff, tex keys), the referenced texture records (w/h/fmt + BYTES), the draw's vertex
bytes (indexCount indices through the ib into the vb: raw bytes, i.e. f32 BIT-compare) and the bytes of every
referenced constant buffer. --sprites-only keeps only psVariant == 'indexed' draws on both sides and ignores
`i`/`firstIndex` (the Python side then may carry world draws; the sprite subsequence is what is gated).
Prints exact/total draws and the FIRST differing field. Exit 0 iff every draw is exact.
"""
import json, struct, sys


def load(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'RRSQ', path
    n = struct.unpack_from('<I', b, 4)[0]
    return json.loads(b[8:8 + n].decode('utf-8')), b[8 + n:]


def blob(pool, rec):
    return pool[rec['off']:rec['off'] + rec['len']]


def draw_view(head, pool, d, norm):
    """Everything a draw means, resolved to bytes: (fields, textures, vertices, cbs)."""
    fields = {k: v for k, v in d.items() if not (norm and k in ('i', 'firstIndex'))}
    tex = []
    for k in d.get('tex') or []:
        if k is None:
            tex.append(None); continue
        t = head['textures'].get(k)
        tex.append(None if t is None else (t['w'], t['h'], t['fmt'], blob(pool, t)))
    ib = blob(pool, head['ib'])
    vb = blob(pool, head['vb'])
    stride, voff = d['stride'], d['voff']
    verts = []
    for j in range(d['indexCount']):
        idx = struct.unpack_from('<I', ib, (d['firstIndex'] + j) * 4)[0]
        verts.append(vb[voff + idx * stride: voff + (idx + 1) * stride])
    cbs = []
    for h in (d.get('vscbHash') or []) + (d.get('pscbHash') or []):
        r = head['constantBuffers'].get(h) if h else None
        cbs.append(None if r is None else blob(pool, r))
    return fields, tex, verts, cbs


def first_diff(a, b):
    fa, ta, va, ca = a
    fb, tb, vb, cb = b
    for k in sorted(set(fa) | set(fb)):
        if json.dumps(fa.get(k), sort_keys=True) != json.dumps(fb.get(k), sort_keys=True):
            return 'field %s: py=%s rs=%s' % (k, json.dumps(fa.get(k)), json.dumps(fb.get(k)))
    for j, (x, y) in enumerate(zip(ta, tb)):
        if x != y:
            if x is None or y is None or x[:3] != y[:3]:
                return 'tex[%d] record: py=%s rs=%s' % (j, None if x is None else x[:3], None if y is None else y[:3])
            return 'tex[%d] bytes differ (%d B)' % (j, len(x[3]))
    for j, (x, y) in enumerate(zip(va, vb)):
        if x != y:
            fx = struct.unpack('<4f2f4B4B2f', x) if len(x) == 40 else x
            fy = struct.unpack('<4f2f4B4B2f', y) if len(y) == 40 else y
            return 'vertex %d: py=%s rs=%s' % (j, fx, fy)
    for j, (x, y) in enumerate(zip(ca, cb)):
        if x != y:
            return 'cb[%d] bytes differ' % j
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        sys.exit(__doc__)
    sprites_only = '--sprites-only' in sys.argv
    (ma, pa), (mb, pb) = load(args[0]), load(args[1])
    fa, fb = ma['frames'], mb['frames']
    if len(fa) != len(fb):
        print('frame count differs: py %d rs %d' % (len(fa), len(fb)))
    total = exact = 0
    first = None
    kinds = {}
    for fi, (ha, hb) in enumerate(zip(fa, fb)):
        if ha['frame'] != hb['frame'] and first is None:
            first = (fi, -1, 'frame clock: py %s rs %s' % (ha['frame'], hb['frame']))
        da, db = ha['draws'], hb['draws']
        if sprites_only:
            da = [d for d in da if d.get('psVariant') == 'indexed']
            db = [d for d in db if d.get('psVariant') == 'indexed']
        if len(da) != len(db) and first is None:
            first = (fi, -1, 'draw count: py %d rs %d' % (len(da), len(db)))
        for di, (x, y) in enumerate(zip(da, db)):
            total += 1
            why = first_diff(draw_view(ha, pa, x, sprites_only), draw_view(hb, pb, y, sprites_only))
            if why is None:
                exact += 1
            else:
                kinds[why.split(':')[0].split(' ')[0]] = kinds.get(why.split(':')[0].split(' ')[0], 0) + 1
                if first is None:
                    first = (fi, di, why)
        total += abs(len(da) - len(db))
    print('frames compared %d (py %d, rs %d)   draws exact %d / %d' % (min(len(fa), len(fb)), len(fa), len(fb), exact, total))
    if kinds:
        print('differing draws by kind: %s' % kinds)
    if first is not None:
        print('FIRST DIFFERENCE: frame index %d (clock %s) draw %d: %s' % (first[0], fa[first[0]]['frame'] if first[0] < len(fa) else '?', first[1], first[2]))
    print('GATE ' + ('PASS' if exact == total and first is None and len(fa) == len(fb) else 'FAIL'))
    sys.exit(0 if exact == total and first is None and len(fa) == len(fb) else 1)


if __name__ == '__main__':
    main()
