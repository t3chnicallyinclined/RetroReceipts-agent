// smoke-replay.mjs — headless-Chrome gate for the LIVE tab's in-page replay (LIVE-TAB-SPEC §12 Phase 2).
//
//   node scripts/smoke-replay.mjs [--url http://localhost:5173/match?dev=1] [--row local_stage9]
//                                 [--out <dir>] [--l3 http://localhost:8099]
//
// Opens the dev server, expands the TEST TAPES row, waits for the embed's `ready` state (window.__rrEmbed,
// exposed by ReplayEmbed for tests), asserts frames ADVANCE while playing, screenshots the page, and — with
// --l3 (serve.py running in d3dcap/replay on :8099) — compares the frame-0 scene-RT sha-256 with the dev
// player's for the same tape+pack at the same display options (the L3 gate: identical pixels, not "looks right").
// Chrome needs a real GPU: the flags below are the ones capture_video.mjs uses.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let puppeteer;
try {
	puppeteer = require('puppeteer-core');
} catch {
	puppeteer = createRequire('file:///C:/Users/trist/projects/maplecast-flycast/tools/render-replica-poc/node_modules/')('puppeteer-core');
}

const arg = (k, d) => {
	const i = process.argv.indexOf(k);
	return i > 0 ? process.argv[i + 1] : d;
};
const URL_ = arg('--url', 'http://localhost:5173/match?dev=1');
const ROW = arg('--row', 'local_stage9');
const OUT = arg('--out', path.resolve('smoke-out'));
const L3 = arg('--l3', '');
const CHROME = arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.error('[smoke]', ...a);
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: 'new',
	args: [
		'--enable-unsafe-webgpu',
		'--enable-features=Vulkan,WebGPU',
		'--ignore-gpu-blocklist',
		'--use-gl=angle',
		'--use-angle=d3d11',
		'--no-sandbox',
		'--window-size=1280,1600',
		'--disable-background-timer-throttling'
	]
});
let failed = 0;
const check = (ok, what) => {
	log(ok ? 'PASS' : 'FAIL', what);
	if (!ok) failed++;
};
try {
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 1 });
	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));
	log('open', URL_);
	await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 120000 });
	check(await page.evaluate(() => !!navigator.gpu), 'navigator.gpu present');

	const rowSel = `[data-test="tape-row-${ROW}"] button`;
	await page.waitForSelector(rowSel, { timeout: 60000 });
	check(true, `test row ${ROW} rendered`);
	await page.click(rowSel);
	check(await page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-expanded') === 'true', rowSel), 'row aria-expanded=true');

	const t0 = Date.now();
	await page.waitForFunction(
		() => window.__rrEmbed && ['ready', 'playing', 'paused', 'ended', 'error'].includes(window.__rrEmbed.state),
		{ timeout: 600000, polling: 250 }
	);
	const st = await page.evaluate(() => ({ state: window.__rrEmbed.state, count: window.__rrEmbed.count, quality: window.__rrEmbed.quality, ttffMs: window.__rrEmbed.ttffMs }));
	log('embed', JSON.stringify(st), `after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	check(st.state !== 'error', `embed reached ${st.state}`);
	check(st.count > 0, `tape has ${st.count} frames`);

	// frames must advance while playing (autoplay is on for non-reduced-motion; call play() regardless)
	await page.evaluate(() => window.__rrEmbed.play());
	const f0 = await page.evaluate(() => window.__rrEmbed.frame);
	await new Promise((r) => setTimeout(r, 2500));
	const f1 = await page.evaluate(() => window.__rrEmbed.frame);
	log(`frame ${f0} → ${f1} over 2.5 s (state ${await page.evaluate(() => window.__rrEmbed.state)})`);
	check(f1 > f0, 'frames advance during playback');

	// seek forward + back, pause, and the readback hash for the L3 gate
	await page.evaluate(() => window.__rrEmbed.pause());
	await page.evaluate(() => window.__rrEmbed.seek(0));
	await page.waitForFunction(() => window.__rrEmbed.frame === 0, { timeout: 60000 });
	const rb0 = await page.evaluate(() => window.__rrEmbed.readback());
	log('embed frame 0 readback', JSON.stringify(rb0));
	check(rb0.bytes > 0, 'readback returned scene-RT bytes');

	const shot = path.join(OUT, `live-tab-${ROW}.png`);
	await page.screenshot({ path: shot, fullPage: true });
	log('screenshot', shot);
	const shotEmbed = path.join(OUT, `embed-${ROW}.png`);
	const emb = await page.$('.emb');
	if (emb) {
		await emb.screenshot({ path: shotEmbed });
		log('embed screenshot', shotEmbed);
	}
	const bad = errors.filter((e) => !/favicon|ogimg|404|net::ERR|Failed to load resource/i.test(e));
	check(bad.length === 0, `console clean (${errors.length} messages, ${bad.length} unexpected)`);
	if (bad.length) for (const e of bad) log('  console:', e.slice(0, 300));

	if (L3) {
		// the dev player, same tape+pack, same display options (res=4 box → the embed's 'high' quality)
		const p2 = await browser.newPage();
		const tapes = await page.evaluate(async () => (await (await fetch('/replay/index.json')).json()).tapes);
		const t = tapes[ROW];
		const rel = t.pack.replace(/^\/replay\//, '');
		const u = `${L3}/player.html?tape=${encodeURIComponent(`${rel}/tape.json.gz`)}&pack=${encodeURIComponent(rel)}&auto=1${st.quality === 'high' ? '&res=4&filter=box' : ''}`;
		log('L3 dev player', u);
		await p2.goto(u, { waitUntil: 'load', timeout: 120000 });
		await p2.waitForFunction(() => window.__rr && window.__rr.ready === true, { timeout: 600000, polling: 250 });
		await p2.evaluate(() => window.__rr.show(0));
		const rbDev = await p2.evaluate(() => window.__rr.readback());
		log('dev player frame 0 readback', JSON.stringify(rbDev));
		check(rbDev.sha === rb0.sha && rbDev.bytes === rb0.bytes, `L3: embed frame-0 sha == dev player frame-0 sha (${rb0.sha.slice(0, 12)}…)`);
		await p2.close();
	}
} finally {
	await browser.close();
}
log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
