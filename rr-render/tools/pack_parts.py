#!/usr/bin/env python3
"""pack_parts.py -- the HOSTED ASSET PACK LIBRARY: split the per-match pack built by pack_assets.py into
DEDUPLICATED PARTS so the server stores each byte exactly once and a signed-in, ownership-attested client
assembles its pack from `common + <=6 chars + 1 stage`.

    python tools/pack_parts.py --out <replay>/packs/parts            # build every part (all chars, all stages)
    python tools/pack_parts.py --out ... --chars 0C 17 --stages-only 09
    python tools/pack_parts.py --out ... --verify <replay>/packs/local_stage9   # GATE

Parts (each is a directory that MIRRORS the pack tree, plus a manifest.json):

    common/          tcw/index.json + every library page it names, camera_block.json,
                     frozen/template_2574.json, frozen/world_4445.json
    chars/PL<XX>/    chars/PL<XX>_idx.png _asm.json _lut.json, chars/PL<XX>_GFX_DATA_00.BIN _01.BIN
    stages/STG<XX>/  stage/STG<XX>.json + its textures, tcw/stage_<XX>/index.json + its PNGs

    <part>/manifest.json = {"part": "<id>", "files": [{"name", "bytes", "sha256"}, ...]}

`name` is the path relative to the PACK ROOT exactly as pack_assets.py names it (chars/PL2C_idx.png,
tcw/stage_09/index.json, ...) AND is also the path of the file inside the part directory, so assembling a
pack is a plain tree-merge of the chosen parts -- no name mapping on the client.

Sources are pack_assets.py's (rr-render/tools/pack_assets.py:22-25):
    ATLAS   maplecast-flycast/web/test-atlas/chars      PL<XX>_idx.png/_asm.json/_lut.json
    DASM    maplecast-flycast/dasm_PLDAT/Output/PL<XX>_DAT/*GFX_DATA_0[01].BIN
    STAGES  maplecast-flycast/atlas/stages              STG<XX>.json + STG<XX>_tNN.png
    REPLAY  mvc-live-skins-quarters/d3dcap/replay       tcw_pages/, camera_block.json

STAGE KEYING: pack_assets.py:70,75 uses the tape's `stage_id` DIRECTLY as the STGxx disc-file index
('STG%02X.json' % int(sid), 'stage_%02X' % int(sid)). This script keys stage parts by that same index, so
the client resolves a part id with the identical rule. (maplecast-flycast/tools/stage_id_map.json records
one CONFIRMED wire id 0x11 -> STG0B that contradicts the direct rule; that mapping is UNRESOLVED and is
deliberately NOT applied here -- parts are keyed by disc-file index only.)

ROM-derived: the output root is gitignored (a `.gitignore` with `*` is written into it). NEVER commit it,
NEVER place it under a web root. It is served only by an authed route to owners of the game.
"""
import argparse, glob, hashlib, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS = r'C:\Users\trist\projects\maplecast-flycast\web\test-atlas\chars'
DASM = r'C:\Users\trist\projects\maplecast-flycast\dasm_PLDAT\Output'
STAGES = r'C:\Users\trist\projects\maplecast-flycast\atlas\stages'
REPLAY = r'C:\Users\trist\projects\mvc-live-skins-quarters\d3dcap\replay'

FROZEN = os.path.join(HERE, '..', 'src', 'frozen')
FROZEN_FILES = ('template_2574.json', 'world_4445.json')
# per-match, not an asset: pack_assets.py --tape-copy writes it into the pack + manifest
NOT_A_PART = ('tape.json.gz',)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


class Part:
    """A part directory: copy in (pack-relative name -> source file), then write manifest.json."""

    def __init__(self, root, pid):
        self.pid, self.dir = pid, os.path.join(root, pid.replace('/', os.sep))
        self.files, self.missing = [], []

    def put(self, name, src):
        if not os.path.exists(src):
            self.missing.append((name, src))
            return False
        dst = os.path.join(self.dir, name.replace('/', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        sh = sha256_file(src)
        if not (os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src)
                and sha256_file(dst) == sh):
            shutil.copyfile(src, dst)
            sh = sha256_file(dst)
        self.files.append({'name': name, 'bytes': os.path.getsize(dst), 'sha256': sh})
        return True

    def write(self):
        self.files.sort(key=lambda f: f['name'])
        os.makedirs(self.dir, exist_ok=True)
        json.dump({'part': self.pid, 'files': self.files},
                  open(os.path.join(self.dir, 'manifest.json'), 'w'), indent=1)
        return sum(f['bytes'] for f in self.files)


# ---------------------------------------------------------------- part builders
def build_common(root, a):
    p = Part(root, 'common')
    idx = os.path.join(a.tcw, 'index.json')
    if p.put('tcw/index.json', idx):
        # pack_assets.py:95-98 -- same filename rule, same "only if it exists" rule
        for k, v in json.load(open(idx)).items():
            fn = v.get('file', 'tcw_%s_%dx%d_f%d.png' % (k, v['w'], v['h'], v['fmt']))
            src = os.path.join(a.tcw, fn)
            if os.path.exists(src):
                p.put('tcw/' + fn, src)
    p.put('camera_block.json', a.camera)
    for fz in FROZEN_FILES:
        p.put('frozen/' + fz, os.path.join(a.frozen, fz))
    return p


def build_char(root, a, cid):
    nm = 'PL%02X' % cid
    p = Part(root, 'chars/' + nm)
    for suf in ('_idx.png', '_asm.json', '_lut.json'):                       # pack_assets.py:61-62
        p.put('chars/%s%s' % (nm, suf), os.path.join(a.atlas, nm + suf))
    for suf in ('GFX_DATA_00.BIN', 'GFX_DATA_01.BIN'):                       # pack_assets.py:63-68
        g = sorted(glob.glob(os.path.join(a.dasm, nm + '_DAT', '*' + suf)))
        if g:
            p.put('chars/%s_%s' % (nm, suf), g[0])
        else:
            p.missing.append(('chars/%s_%s' % (nm, suf), os.path.join(a.dasm, nm + '_DAT')))
    return p


def build_stage(root, a, sid):
    nm = 'STG%02X' % sid
    p = Part(root, 'stages/' + nm)
    sj = os.path.join(a.stages, nm + '.json')
    if p.put('stage/%s.json' % nm, sj):                                       # pack_assets.py:70-74
        for tx in json.load(open(sj)).get('textures', []):
            p.put('stage/' + tx['file'], os.path.join(a.stages, tx['file']))
    sdir = os.path.join(a.tcw, 'stage_%02X' % sid)                            # pack_assets.py:87-91
    if os.path.exists(os.path.join(sdir, 'index.json')):
        p.put('tcw/stage_%02X/index.json' % sid, os.path.join(sdir, 'index.json'))
        for f in sorted(os.listdir(sdir)):
            if f.endswith('.png'):
                p.put('tcw/stage_%02X/%s' % (sid, f), os.path.join(sdir, f))
    else:
        p.missing.append(('tcw/stage_%02X/index.json' % sid, sdir))
    return p


# ---------------------------------------------------------------- gate
def verify(root, pack_dir):
    """Assemble the pack named by <pack_dir>/manifest.json out of parts and diff every sha256."""
    man = json.load(open(os.path.join(pack_dir, 'manifest.json')))
    roster, sid = man.get('roster') or [], man.get('stage_id')
    pids = (['common'] + ['chars/PL%02X' % c for c in roster]
            + (['stages/STG%02X' % int(sid)] if sid is not None else []))
    have, bad_parts = {}, []
    for pid in pids:
        pdir = os.path.join(root, pid.replace('/', os.sep))
        pm = os.path.join(pdir, 'manifest.json')
        if not os.path.exists(pm):
            bad_parts.append('%s: no manifest.json' % pid)
            continue
        for f in json.load(open(pm))['files']:
            on_disk = os.path.join(pdir, f['name'].replace('/', os.sep))
            if not os.path.exists(on_disk):
                bad_parts.append('%s: %s not on disk' % (pid, f['name']))
                continue
            real = sha256_file(on_disk)
            if real != f['sha256']:
                bad_parts.append('%s: %s manifest/disk sha mismatch' % (pid, f['name']))
            if f['name'] in have and have[f['name']][0] != real:
                bad_parts.append('%s: %s collides with part %s' % (pid, f['name'], have[f['name']][1]))
            have[f['name']] = (real, pid)
    ok, diff, miss, skipped = 0, [], [], []
    for f in man['files']:
        if f['name'] in NOT_A_PART:
            skipped.append(f['name'])
        elif f['name'] not in have:
            miss.append(f['name'])
        elif have[f['name']][0] == f['sha256']:
            ok += 1
        else:
            diff.append(f['name'])
    extra = sorted(set(have) - {f['name'] for f in man['files']})
    print('VERIFY %s' % pack_dir)
    print('  parts: %s' % ', '.join(pids))
    print('  pack manifest %d files -> %d byte-exact from parts, %d DIFFERENT, %d MISSING, %d not-an-asset (%s)'
          % (len(man['files']), ok, len(diff), len(miss), len(skipped), ','.join(skipped) or '-'))
    for n in diff:
        print('    DIFF    %s' % n)
    for n in miss:
        print('    MISSING %s' % n)
    for n in extra:
        print('    extra   %s  (in parts, not in this older pack manifest)' % n)
    for b in bad_parts:
        print('    PART    %s' % b)
    good = not diff and not miss and not bad_parts
    print('  GATE: %s' % ('PASS' if good else 'FAIL'))
    return good


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default=os.path.join(REPLAY, 'packs', 'parts'))
    ap.add_argument('--atlas', default=ATLAS)
    ap.add_argument('--dasm', default=DASM)
    ap.add_argument('--stages', default=STAGES)
    ap.add_argument('--tcw', default=os.path.join(REPLAY, 'tcw_pages'))
    ap.add_argument('--camera', default=os.path.join(REPLAY, 'camera_block.json'))
    ap.add_argument('--frozen', default=FROZEN)
    ap.add_argument('--chars', nargs='*', help='hex char ids (default: every PL<XX> the atlas has)')
    ap.add_argument('--stages-only', nargs='*', dest='stage_ids',
                    help='hex stage/disc-file ids (default: every STG<XX>.json)')
    ap.add_argument('--verify', nargs='*', help='verify these pack dirs against the parts and exit')
    a = ap.parse_args()

    if a.verify:
        sys.exit(0 if all([verify(a.out, p) for p in a.verify]) else 1)

    os.makedirs(a.out, exist_ok=True)
    open(os.path.join(a.out, '.gitignore'), 'w').write('*\n')     # ROM-derived: never committed

    hexdig = '0123456789ABCDEF'
    if a.chars:
        cids = [int(c, 16) for c in a.chars]
    else:
        cids = sorted({int(f[2:4], 16) for f in os.listdir(a.atlas)
                       if f.startswith('PL') and f.endswith('_idx.png') and len(f) == 12
                       and all(ch in hexdig for ch in f[2:4])})
    if a.stage_ids:
        sids = [int(s, 16) for s in a.stage_ids]
    else:
        sids = sorted({int(f[3:5], 16) for f in os.listdir(a.stages)
                       if f.startswith('STG') and f.endswith('.json') and len(f) == 10
                       and all(ch in hexdig for ch in f[3:5])})

    index, groups = {}, {}
    parts = ([build_common(a.out, a)] + [build_char(a.out, a, c) for c in cids]
             + [build_stage(a.out, a, s) for s in sids])
    for p in parts:
        n = p.write()
        index[p.pid] = {'files': len(p.files), 'bytes': n, 'missing': [m[0] for m in p.missing]}
        g = p.pid.split('/')[0]
        groups.setdefault(g, [0, 0])
        groups[g][0] += len(p.files)
        groups[g][1] += n
        print('%-18s %4d files  %8.2f MB%s'
              % (p.pid, len(p.files), n / 1048576.0, ('  MISSING %d' % len(p.missing)) if p.missing else ''))
        for name, src in p.missing:
            print('    missing %-36s (%s)' % (name, src))
    json.dump({'version': 1, 'parts': index,
               'note': 'ROM-derived asset PARTS for rr-render. common + N chars + 1 stage == a pack_assets.py pack. '
                       'Never commit, never serve without auth + ownership attestation.'},
              open(os.path.join(a.out, 'index.json'), 'w'), indent=1)
    print('---')
    for g, (n, b) in sorted(groups.items()):
        print('%-8s %4d files  %8.2f MB' % (g, n, b / 1048576.0))
    print('TOTAL    %4d files  %8.2f MB  -> %s'
          % (sum(v[0] for v in groups.values()), sum(v[1] for v in groups.values()) / 1048576.0, a.out))


if __name__ == '__main__':
    main()
