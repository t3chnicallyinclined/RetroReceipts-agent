#!/usr/bin/env python3
"""pack_assets.py -- the browser ASSET PACK: exactly the files rr-render reads for one tape (roster + stage),
copied from the existing rips into one directory with a manifest, so the JS host can fetch them and hand the
bytes to the wasm FrameFeed. ROM-derived: the output directory is gitignored (a `.gitignore` with `*` is written
into it) and must never be committed or served publicly.

    python tools/pack_assets.py <tape.json.gz> -o <replay>/packs/<match>   [--tape-copy]

Layout (rr_render::pack::AssetPack):
    manifest.json                       {version, source, roster, stage_id, files: [{name, bytes, sha256}]}
    chars/PLxx_idx.png _asm.json _lut.json _GFX_DATA_00.BIN _GFX_DATA_01.BIN    (per roster character)
    stage/STGxx.json + STGxx_tNN.png    (arc rip; the PNGs are the WRONG rip_stage decode = the Python fallback)
    tcw/stage_XX/index.json + PNGs      (host-decoded stage pages, rip_texbank.py --bank stage)
    tcw/index.json + PNGs               (capture-derived TCW library)
    camera_block.json
    frozen/template_2574.json frozen/world_4445.json   (informational copy; the crate embeds them)
    tape.json.gz                        (--tape-copy: the tape itself, so the page can fetch it from the pack)
"""
import argparse, glob, gzip, hashlib, json, os, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS = r'C:\Users\trist\projects\maplecast-flycast\web\test-atlas\chars'
DASM = r'C:\Users\trist\projects\maplecast-flycast\dasm_PLDAT\Output'
STAGES = r'C:\Users\trist\projects\maplecast-flycast\atlas\stages'
REPLAY = r'C:\Users\trist\projects\mvc-live-skins-quarters\d3dcap\replay'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tape')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--atlas', default=ATLAS)
    ap.add_argument('--dasm', default=DASM)
    ap.add_argument('--stages', default=STAGES)
    ap.add_argument('--tcw', default=os.path.join(REPLAY, 'tcw_pages'))
    ap.add_argument('--camera', default=os.path.join(REPLAY, 'camera_block.json'))
    ap.add_argument('--tape-copy', action='store_true', help='copy the tape into the pack as tape.json.gz')
    a = ap.parse_args()

    raw = open(a.tape, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    t = json.loads(raw)
    roster = sorted(set(int(c) for c in (t['p1_team'] + t['p2_team'])))
    sid = t.get('stage_id')
    os.makedirs(a.out, exist_ok=True)
    open(os.path.join(a.out, '.gitignore'), 'w').write('*\n')     # ROM-derived: never committed
    files, missing = [], []

    def put(name, src):
        if not os.path.exists(src):
            missing.append((name, src)); return
        dst = os.path.join(a.out, name.replace('/', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        b = open(dst, 'rb').read()
        files.append({'name': name, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})

    for cid in roster:
        nm = 'PL%02X' % cid
        for suf in ('_idx.png', '_asm.json', '_lut.json'):
            put('chars/%s%s' % (nm, suf), os.path.join(a.atlas, nm + suf))
        for suf in ('GFX_DATA_00.BIN', 'GFX_DATA_01.BIN'):
            g = sorted(glob.glob(os.path.join(a.dasm, nm + '_DAT', '*' + suf)))
            if g:
                put('chars/%s_%s' % (nm, suf), g[0])
            else:
                missing.append(('chars/%s_%s' % (nm, suf), os.path.join(a.dasm, nm + '_DAT')))
    if sid is not None:
        sj = os.path.join(a.stages, 'STG%02X.json' % int(sid))
        if os.path.exists(sj):
            put('stage/STG%02X.json' % int(sid), sj)
            for tx in json.load(open(sj)).get('textures', []):
                put('stage/' + tx['file'], os.path.join(a.stages, tx['file']))
        sdir = os.path.join(a.tcw, 'stage_%02X' % int(sid))
        if os.path.exists(os.path.join(sdir, 'index.json')):
            put('tcw/stage_%02X/index.json' % int(sid), os.path.join(sdir, 'index.json'))
            for f in sorted(os.listdir(sdir)):
                if f.endswith('.png'):
                    put('tcw/stage_%02X/%s' % (int(sid), f), os.path.join(sdir, f))
    idx = os.path.join(a.tcw, 'index.json')
    if os.path.exists(idx):
        put('tcw/index.json', idx)
        for k, v in json.load(open(idx)).items():
            fn = v.get('file', 'tcw_%s_%dx%d_f%d.png' % (k, v['w'], v['h'], v['fmt']))
            if os.path.exists(os.path.join(a.tcw, fn)):
                put('tcw/' + fn, os.path.join(a.tcw, fn))
    put('camera_block.json', a.camera)
    for fz in ('template_2574.json', 'world_4445.json'):
        put('frozen/' + fz, os.path.join(HERE, '..', 'src', 'frozen', fz))
    if a.tape_copy:
        put('tape.json.gz', a.tape)
    man = {'version': 1, 'source': os.path.basename(a.tape), 'roster': roster, 'stage_id': sid,
           'agent': t.get('ver'), 'tape_ver': t.get('tape_ver'), 'files': files,
           'note': 'ROM-derived asset pack for rr-render (browser FrameFeed). Never commit, never serve publicly.'}
    json.dump(man, open(os.path.join(a.out, 'manifest.json'), 'w'), indent=1)
    total = sum(f['bytes'] for f in files)
    print('pack %s: %d files, %.1f MB, roster %s, stage %s' % (a.out, len(files), total / 1048576.0,
          ['PL%02X' % c for c in roster], sid))
    for name, src in missing:
        print('  missing %-40s (%s)' % (name, src))


if __name__ == '__main__':
    main()
