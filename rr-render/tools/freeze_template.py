#!/usr/bin/env python3
"""freeze_template.py -- freeze the captured D3D state the Python emitter lifts at runtime from two packs into
JSON the crate embeds (include_str!). Exactly what tape_to_seq.template() / WorldTemplate.__init__ read:

  frame_2574.pack  -> frozen/template_2574.json  {pack_sha256, viewport, sceneRT, inputLayouts,
                       draw (the first psVariant=='indexed' draw), cbs {hash: hex} (manifest order)}
  capgate/frame_4445.pack -> frozen/world_4445.json  {pack_sha256, inputLayouts,
                       draw {psVariant: KEYS of the first vs_world draw of that variant},
                       pscb {psVariant: [hex|null x4]}  (only buffers with len not in (432, 48)),
                       by_state [[state_key, KEYS-draw] ...]  (first vs_world draw per captured state, tsp_state.state_key),
                       preamble [3 draws: KEYS + vscbHash + pscbHash]  (only when the pack opens with the three clear quads),
                       preamble_cb [{hash: hex} x3]}
Run:  python tools/freeze_template.py   (paths default to the replay dir). ROM pixels are NOT copied: only state
words, shader/layout hashes and the small PS/VS constant buffers (fog, alpha ref, scene block, the 1x1 white
placeholder never leaves the pack).
"""
import hashlib, json, os, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPLAY = r'C:\Users\trist\projects\mvc-live-skins-quarters\d3dcap\replay'
sys.path.insert(0, REPLAY)
import tsp_state as TS

KEYS = ('vs', 'ps', 'il', 'vsVariant', 'psVariant', 'psFog', 'samp', 'blend',
        'bfactor', 'smask', 'depth', 'raster', 'vp', 'scissor', 'stride')


def load(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'RRPK', path
    n = struct.unpack_from('<I', b, 4)[0]
    return json.loads(b[8:8 + n].decode('utf-8')), b[8 + n:], hashlib.sha256(b).hexdigest()


def freeze_2574(path):
    man, body, sha = load(path)
    d = next(x for x in man['draws'] if x['psVariant'] == 'indexed')
    cbs = {h: body[r['off']:r['off'] + r['len']].hex() for h, r in man['constantBuffers'].items()}
    return {'pack': os.path.basename(path), 'pack_sha256': sha, 'draw_i': d['i'],
            'viewport': man['viewport'], 'sceneRT': man['sceneRT'], 'inputLayouts': man['inputLayouts'],
            'draw': d, 'cbs': cbs}


def freeze_4445(path):
    man, body, sha = load(path)
    cbs = man['constantBuffers']
    B = lambda h: body[cbs[h]['off']:cbs[h]['off'] + cbs[h]['len']]
    draw, pscb, by_state = {}, {}, []
    seen_state = set()
    for d in man['draws']:
        if d.get('vsVariant') != 'vs_world':
            continue
        v = d.get('psVariant')
        if v not in draw:
            draw[v] = {k: d[k] for k in KEYS}
            pscb[v] = [B(h).hex() if (h and cbs.get(h) and cbs[h]['len'] != 432 and cbs[h]['len'] != 48) else None
                       for h in (d.get('pscbHash') or [])]
        k = TS.state_key(TS.captured(d))
        if k not in seen_state:
            seen_state.add(k)
            by_state.append([list(k), {kk: d[kk] for kk in KEYS}])
    preamble, preamble_cb = [], []
    pre = man['draws'][:3]
    if (len(pre) == 3 and pre[0]['stride'] == 28 and pre[1]['stride'] == 40 and pre[2]['stride'] == 28
            and pre[2].get('ps') is None and pre[1]['tex'][0]
            and man['textures'][pre[1]['tex'][0]]['w'] == 1 and man['textures'][pre[1]['tex'][0]]['h'] == 1):
        for d in pre:
            preamble.append({k: d.get(k) for k in KEYS + ('vscbHash', 'pscbHash')})
            preamble_cb.append({h: B(h).hex() for h in (d.get('vscbHash') or []) + (d.get('pscbHash') or [])
                                if h and h in cbs})
    return {'pack': 'capgate/' + os.path.basename(path), 'pack_sha256': sha, 'inputLayouts': man['inputLayouts'],
            'draw': draw, 'pscb': pscb, 'by_state': by_state, 'preamble': preamble, 'preamble_cb': preamble_cb}


def main():
    out = os.path.join(HERE, '..', 'src', 'frozen')
    os.makedirs(out, exist_ok=True)
    t = freeze_2574(os.path.join(REPLAY, 'frame_2574.pack'))
    w = freeze_4445(os.path.join(REPLAY, 'capgate', 'frame_4445.pack'))
    json.dump(t, open(os.path.join(out, 'template_2574.json'), 'w'), indent=0)
    json.dump(w, open(os.path.join(out, 'world_4445.json'), 'w'), indent=0)
    print('template_2574: sha256 %s, %d cbs, draw i=%d' % (t['pack_sha256'], len(t['cbs']), t['draw_i']))
    print('world_4445: sha256 %s, variants %s, by_state %d, preamble %d, cbs %s' % (
        w['pack_sha256'], list(w['draw']), len(w['by_state']), len(w['preamble']),
        [sorted(c) for c in w['preamble_cb']]))
    for v, l in w['pscb'].items():
        print('  pscb', v, [(None if x is None else len(x) // 2) for x in l])


if __name__ == '__main__':
    main()
