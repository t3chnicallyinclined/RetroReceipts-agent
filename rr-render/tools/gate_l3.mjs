// gate_l3.mjs -- L3: the browser renders the same clip two ways and the scene-RT pixels must be byte-exact.
//   A) from the Python .seq (tape_to_seq.py, the oracle)            player.html?seq=<seq>
//   B) from the TAPE through the wasm worker (rr-render FrameFeed)   player.html?tape=<tape>&pack=<pack>&start=&count=
// Per frame: __rr.show(i) then __rr.readback() = sha-256 of the raw BGRA scene target (copyTextureToBuffer, not the
// canvas). Reports equal/total frames, the first differing frame, and the worker's ms per FrameRecord.
//
//   python serve.py   (in d3dcap/replay)   then
//   node gate_l3.mjs --seq gold_13_1500.seq --tape packs/59613662/tape.json.gz --pack packs/59613662 --start 1500 --count 60
import { createRequire } from 'node:module';
const require = createRequire('file:///C:/Users/trist/projects/maplecast-flycast/tools/render-replica-poc/node_modules/');
const puppeteer = require('puppeteer-core');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEQ = arg('--seq', 'gold_13_1500.seq');
const TAPE = arg('--tape', 'packs/59613662/tape.json.gz');
const PACK = arg('--pack', 'packs/59613662');
const START = +arg('--start', 1500), COUNT = +arg('--count', 60);
const BASE = arg('--base', 'http://localhost:8099');
const CHROME = arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11',
           '--no-sandbox', '--window-size=700,700', '--disable-background-timer-throttling'],
});

async function run(label, url) {
    const page = await browser.newPage();
    await page.setViewport({ width: 700, height: 700, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { const t = m.text(); if (/error|GPU|Error/i.test(t)) errors.push(t); });
    page.on('pageerror', (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__rr && window.__rr.ready === true, { timeout: 600000, polling: 250 });
    const loadMs = Date.now() - t0;
    const count = await page.evaluate(() => window.__rr.count);
    const shas = [];
    const renderMs = [];
    for (let i = 0; i < count; i++) {
        const t1 = Date.now();
        await page.evaluate((k) => window.__rr.show(k), i);
        renderMs.push(Date.now() - t1);
        shas.push((await page.evaluate(() => window.__rr.readback())).sha);
    }
    const stats = await page.evaluate(() => window.__rr.stats());
    const logText = await page.evaluate(() => document.getElementById('log').textContent);
    await page.close();
    console.log(`[${label}] ${count} frames, page load+prepare ${loadMs} ms, show+readback ${(renderMs.reduce((a, b) => a + b, 0) / Math.max(1, count)).toFixed(1)} ms/frame`
                + (stats ? `, worker ${stats.avgMs.toFixed(2)} ms/frame avg (max ${stats.maxMs.toFixed(1)}), ${(stats.bytesPerFrame / 1024).toFixed(0)} KB/frame, open ${stats.openMs.toFixed(0)} ms, ${stats.textures} textures uploaded` : ''));
    for (const e of errors) console.log(`  [${label}] ${e}`);
    return { count, shas, logText };
}

const A = await run('seq ', `${BASE}/player.html?seq=${encodeURIComponent(SEQ)}&auto=1`);
const B = await run('tape', `${BASE}/player.html?tape=${encodeURIComponent(TAPE)}&pack=${encodeURIComponent(PACK)}&start=${START}&count=${COUNT}&auto=1`);
await browser.close();

const n = Math.min(A.count, B.count);
let equal = 0, first = -1;
for (let i = 0; i < n; i++) { if (A.shas[i] === B.shas[i]) equal++; else if (first < 0) first = i; }
console.log(`L3: frames equal ${equal} / ${n}  (seq ${A.count}, tape ${B.count})` + (first >= 0 ? `   FIRST DIFFERENCE at clip frame ${first} (sha seq ${A.shas[first].slice(0, 16)} vs tape ${B.shas[first].slice(0, 16)})` : ''));
console.log('GATE ' + (equal === n && A.count === B.count ? 'PASS' : 'FAIL'));
process.exit(equal === n && A.count === B.count ? 0 : 1);
