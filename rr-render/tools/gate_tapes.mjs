// gate_tapes.mjs -- A/B browser gate: TWO tapes rendered through the wasm FrameFeed in player.html (the same path the
// PWA uses); per frame the scene-RT sha (raw BGRA readback, not the canvas) must be equal. Used by GATE 2
// (docs/RECEIPT-RUNNER-GATE2.md): A = the live agent's tape, B = the receipt runner's tape of the same match, same clocks.
//
//   python serve.py   (in d3dcap/replay)   then
//   node gate_tapes.mjs --a packs/local_stage9/tape.json.gz --b packs/local_stage9/runner_tape.json.gz --pack packs/local_stage9
//                       --start 0 --count 60 [--extra "&noworld=1"] [--base http://localhost:8099]
import { createRequire } from 'node:module';
const require = createRequire('file:///C:/Users/trist/projects/maplecast-flycast/tools/render-replica-poc/node_modules/');
const puppeteer = require('puppeteer-core');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const A = arg('--a'), B = arg('--b'), PACK = arg('--pack');
const START = +arg('--start', 0), COUNT = +arg('--count', 60);
const BASE = arg('--base', 'http://localhost:8099');
const EXTRA = arg('--extra', '');
const CHROME = arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
if (!A || !B || !PACK) { console.error('usage: --a <tape> --b <tape> --pack <dir> [--start N] [--count N]'); process.exit(2); }

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', protocolTimeout: 600000,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11',
           '--no-sandbox', '--window-size=700,700', '--disable-background-timer-throttling'],
});

async function run(label, url) {
    const page = await browser.newPage();
    await page.setViewport({ width: 700, height: 700, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { const t = m.text(); if (/error|GPU|Error/i.test(t)) errors.push(t.slice(0, 200)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__rr && window.__rr.ready === true, { timeout: 600000, polling: 250 });
    const loadMs = Date.now() - t0;
    const count = await page.evaluate(() => window.__rr.count);
    const shas = [];
    for (let i = 0; i < count; i++) {
        await page.evaluate((k) => window.__rr.show(k), i);
        shas.push((await page.evaluate(() => window.__rr.readback())).sha);
    }
    await page.close();
    console.log(`[${label}] ${count} frames, page load+prepare ${loadMs} ms` + (errors.length ? `\n  errors: ${errors.join(' | ')}` : ''));
    return { count, shas };
}

const url = (t) => `${BASE}/player.html?tape=${encodeURIComponent(t)}&pack=${encodeURIComponent(PACK)}&start=${START}&count=${COUNT}&auto=1${EXTRA}`;
const RA = await run('A ' + A, url(A));
const RB = await run('B ' + B, url(B));
await browser.close();
const n = Math.min(RA.count, RB.count);
let equal = 0, first = -1; const diffs = [];
for (let i = 0; i < n; i++) { if (RA.shas[i] === RB.shas[i]) equal++; else { if (first < 0) first = i; diffs.push(i); } }
for (let i = 0; i < n; i++) console.log(`frame ${START + i}: A ${RA.shas[i].slice(0, 12)}  B ${RB.shas[i].slice(0, 12)}  ${RA.shas[i] === RB.shas[i] ? 'EQUAL' : 'DIFFER'}`);
console.log(`TAPE A/B GATE: ${equal} / ${n} frames byte-equal scene targets (A ${RA.count}, B ${RB.count})` + (first >= 0 ? `; differing clip frames: ${diffs.slice(0, 20).join(',')}${diffs.length > 20 ? ',...' : ''}` : ''));
process.exit(equal === n && RA.count === RB.count ? 0 : 1);
