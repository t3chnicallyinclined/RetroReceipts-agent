// seek gate: scene-RT sha of frames reached by DIRECT SEEK must equal the sha of the same frames reached SEQUENTIALLY.
import { createRequire } from 'node:module'; const require = createRequire('file:///C:/Users/trist/projects/maplecast-flycast/tools/render-replica-poc/node_modules/');
const puppeteer = require('puppeteer-core');
const url = process.argv[2]; const targets = process.argv.slice(3).map(Number);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox', '--disable-background-timer-throttling'] });
async function run(mode) {
  const page = await browser.newPage(); await page.setViewport({ width: 700, height: 700 });
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 160))); page.on('console', m => { if (/error/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__rr && window.__rr.ready === true, { timeout: 300000, polling: 250 });
  const out = {};
  if (mode === 'sequential') { const last = Math.max(...targets); for (let k = 0; k <= last; k++) { await page.evaluate(async (k) => { await window.__rr.show(k); }, k); if (targets.includes(k)) out[k] = (await page.evaluate(() => window.__rr.readback())).sha; } }
  else { for (const k of targets) { await page.evaluate(async (k) => { await window.__rr.show(k); }, k); out[k] = (await page.evaluate(() => window.__rr.readback())).sha; } }
  await page.close(); return { out, errs };
}
const A = await run('sequential'); const B = await run('seek'); await browser.close();
let ok = 0; for (const k of targets) { const same = A.out[k] === B.out[k]; ok += same; console.log(`frame ${k}: sequential ${A.out[k].slice(0, 12)}  seek ${B.out[k].slice(0, 12)}  ${same ? 'EQUAL' : 'DIFFER'}`); }
console.log(`SEEK GATE: ${ok}/${targets.length} frames byte-equal to the sequential render${A.errs.length + B.errs.length ? '; errors: ' + [...A.errs, ...B.errs].join(' | ') : ''}`);
