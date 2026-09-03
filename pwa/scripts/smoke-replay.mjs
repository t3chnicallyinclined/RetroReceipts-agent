// smoke-replay.mjs — headless-Chrome gate for the in-page replay (LIVE-TAB-SPEC §12 Phase 2 + the replay-everywhere pass).
//
//   node scripts/smoke-replay.mjs [--url http://localhost:5173/match?dev=1] [--row local_stage9]
//                                 [--out <dir>] [--l3 http://localhost:8099] [--skins] [--surfaces]
//
// Opens the dev server, expands the TEST TAPES row, waits for the embed's `ready` state (window.__rrEmbed,
// exposed by ReplayEmbed for tests), asserts frames ADVANCE while playing, screenshots the page, and:
//   --l3        compares the frame-0 scene-RT sha-256 with the dev player's for the same tape+pack at the same
//               display options (serve.py running in d3dcap/replay on :8099) — identical pixels, not "looks right"
//   --skins     re-opens the row with ?devskin=ff00ff (P1's first character painted flat magenta) and asserts the
//               frame-0 sha DIFFERS from the stock sha, while the stock run must EQUAL --stock-sha when given
//   --surfaces  screenshots (a) the set view opened from the LIVE tab (per-game affordances) and (b) the share
//               page /r/set/<id> with the affordance, then opens a per-game ▶ REPLAY there (the ReplaySheet)
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
const has = (k) => process.argv.includes(k);
const URL_ = arg('--url', 'http://localhost:5173/match?dev=1');
const ORIGIN = new URL(URL_).origin;
const ROW = arg('--row', 'local_stage9');
const OUT = arg('--out', path.resolve('smoke-out'));
const L3 = arg('--l3', '');
const STOCK_SHA = arg('--stock-sha', '');
const CHROME = arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.error('[smoke]', ...a);
const browser = await puppeteer.launch({
	executablePath: CHROME,
	headless: 'new',
	protocolTimeout: 600000,
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
const READY = ['ready', 'playing', 'paused', 'ended', 'error', 'nopack'];
async function waitEmbed(page) {
	await page.waitForFunction((R) => window.__rrEmbed && R.includes(window.__rrEmbed.state), { timeout: 600000, polling: 250 }, READY);
	return page.evaluate(() => ({ state: window.__rrEmbed.state, count: window.__rrEmbed.count, quality: window.__rrEmbed.quality, ttffMs: window.__rrEmbed.ttffMs }));
}
async function frame0sha(page) {
	await page.evaluate(() => window.__rrEmbed.pause());
	await page.evaluate(() => window.__rrEmbed.seek(0));
	await page.waitForFunction(() => window.__rrEmbed.frame === 0, { timeout: 60000 });
	return page.evaluate(() => window.__rrEmbed.readback());
}
async function newPage() {
	const page = await browser.newPage();
	await page.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 1 });
	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));
	page.errors = errors;
	return page;
}
const unexpected = (errors) => errors.filter((e) => !/favicon|ogimg|404|net::ERR|Failed to load resource|\/rr\/tape/i.test(e));

try {
	const page = await newPage();
	// the baseline run forces STOCK skins (?devskin=none): P1 of a test tape may own a real cloud loadout, and the
	// emitter now wears it — the L3 / --stock-sha comparisons need the no-skins picture
	const STOCK_URL = `${URL_}&devskin=none`;
	log('open (stock baseline)', STOCK_URL);
	await page.goto(STOCK_URL, { waitUntil: 'load', timeout: 120000 });
	check(await page.evaluate(() => !!navigator.gpu), 'navigator.gpu present');

	const rowSel = `[data-test="tape-row-${ROW}"] button`;
	await page.waitForSelector(rowSel, { timeout: 60000 });
	check(true, `test row ${ROW} rendered`);
	check(await page.evaluate((s) => /REPLAY/.test(document.querySelector(s)?.textContent ?? ''), rowSel), 'row shows the ▶ REPLAY affordance');
	await page.click(rowSel);
	check(await page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-expanded') === 'true', rowSel), 'row aria-expanded=true');

	const t0 = Date.now();
	const st = await waitEmbed(page);
	log('embed', JSON.stringify(st), `after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	check(st.state !== 'error' && st.state !== 'nopack', `embed reached ${st.state}`);
	check(st.count > 0, `tape has ${st.count} frames`);

	await page.evaluate(() => window.__rrEmbed.play());
	const f0 = await page.evaluate(() => window.__rrEmbed.frame);
	await new Promise((r) => setTimeout(r, 2500));
	const f1 = await page.evaluate(() => window.__rrEmbed.frame);
	log(`frame ${f0} → ${f1} over 2.5 s (state ${await page.evaluate(() => window.__rrEmbed.state)})`);
	check(f1 > f0, 'frames advance during playback');

	const rb0 = await frame0sha(page);
	log('embed frame 0 readback (stock)', JSON.stringify(rb0));
	check(rb0.bytes > 0, 'readback returned scene-RT bytes');
	if (STOCK_SHA) check(rb0.sha === STOCK_SHA, `stock frame-0 sha equals the known stock sha (${STOCK_SHA.slice(0, 12)}…)`);
	check(await page.evaluate(() => /RETRO RECEIPTS/.test(document.querySelector('.emb .wm')?.textContent ?? '') && !!document.querySelector('.emb .wm a[href$="/ranks"]')), 'watermark band present (RETRO RECEIPTS · nobd.net/app/ranks) under the picture');

	const shot = path.join(OUT, `live-tab-${ROW}.png`);
	await page.screenshot({ path: shot, fullPage: true });
	log('screenshot', shot);
	const emb = await page.$('.emb');
	if (emb) {
		const shotEmbed = path.join(OUT, `embed-${ROW}.png`);
		await emb.screenshot({ path: shotEmbed });
		log('embed screenshot', shotEmbed);
	}
	const bad = unexpected(page.errors);
	check(bad.length === 0, `console clean (${page.errors.length} messages, ${bad.length} unexpected)`);
	if (bad.length) for (const e of bad) log('  console:', e.slice(0, 300));

	if (L3) {
		const p2 = await newPage();
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

	if (has('--skins')) {
		// P1's OWN cloud loadout (no dev override): the picture wears it when one exists, else equals stock
		const own = await (await fetch(`${ORIGIN}/rr/loadout?steamids=${(await page.evaluate(async (r) => (await (await fetch('/replay/index.json')).json()).tapes[r].p1 ?? '', ROW))}`)).json().catch(() => null);
		const ownCount = Object.values(own?.loadouts ?? {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
		const p3b = await newPage();
		await p3b.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await p3b.waitForSelector(rowSel, { timeout: 60000 });
		await p3b.click(rowSel);
		await waitEmbed(p3b);
		const rbOwn = await frame0sha(p3b);
		log(`embed frame 0 readback (P1's own loadout, ${ownCount} skinned character(s))`, JSON.stringify(rbOwn));
		check(ownCount ? rbOwn.sha !== rb0.sha : rbOwn.sha === rb0.sha, ownCount ? "skins: P1's own cloud loadout changes the picture" : 'skins: no loadout → picture equals stock');
		await p3b.close();
		// positive check: a flat magenta loadout on P1's first character must change the pixels
		const p3 = await newPage();
		await p3.goto(`${URL_}&devskin=ff00ff`, { waitUntil: 'load', timeout: 120000 });
		await p3.waitForSelector(rowSel, { timeout: 60000 });
		await p3.click(rowSel);
		const st3 = await waitEmbed(p3);
		check(st3.state !== 'error', `skinned embed reached ${st3.state}`);
		const rbSkin = await frame0sha(p3);
		log('embed frame 0 readback (devskin=ff00ff on P1[0])', JSON.stringify(rbSkin));
		check(rbSkin.sha !== rb0.sha, 'skins: frame-0 sha DIFFERS from stock with a P1 loadout');
		const emb3 = await p3.$('.emb');
		if (emb3) {
			const shotSkin = path.join(OUT, `embed-${ROW}-devskin.png`);
			await emb3.screenshot({ path: shotSkin });
			log('skinned embed screenshot', shotSkin);
		}
		await p3.close();
	}

	if (has('--surfaces')) {
		// (a) the set view: THE TAPE from a test row that carries a session id → SessionModal → SetReceipt game rows
		const tapes = await page.evaluate(async () => (await (await fetch('/replay/index.json')).json()).tapes);
		const withSession = Object.entries(tapes).find(([, t]) => t.sessionId);
		if (!withSession) check(false, 'a test tape with a sessionId exists for the surfaces check');
		else {
			const [sid, t] = withSession;
			const p4 = await newPage();
			await p4.goto(URL_, { waitUntil: 'load', timeout: 120000 });
			const sel = `[data-test="tape-row-${sid}"] button`;
			await p4.waitForSelector(sel, { timeout: 60000 });
			await p4.click(sel);
			await p4.waitForSelector(`[data-test="tape-row-${sid}"] .acts .a`, { timeout: 60000 });
			// the actions row: THE TAPE › is the first action when a session id exists
			await p4.click(`[data-test="tape-row-${sid}"] .acts .a`);
			await p4.waitForSelector('.tape .g', { timeout: 120000 });
			const n = await p4.$$eval('.tape .g .ra', (els) => els.map((e) => e.textContent.trim()));
			log('set view per-game affordances:', JSON.stringify(n));
			check(n.length > 0, `set view lists a replay affordance on every game (${n.length})`);
			check(n.some((x) => /REPLAY/.test(x)), 'set view: at least one game shows ▶ REPLAY (the packed one)');
			const shotSet = path.join(OUT, `session-view-${sid}.png`);
			await p4.screenshot({ path: shotSet, fullPage: true });
			log('screenshot (session view)', shotSet);
			await p4.close();

			// (b) the share page /r/set/<id> — SetReceipt mounted directly; open the packed game's ▶ REPLAY → ReplaySheet
			const p5 = await newPage();
			const share = `${ORIGIN}/r/set/${encodeURIComponent(t.sessionId)}`;
			log('open share page', share);
			await p5.goto(share, { waitUntil: 'load', timeout: 120000 });
			await p5.waitForSelector('.tape .g', { timeout: 120000 });
			const btn = await p5.waitForSelector('.tape .g button.ra.ready', { timeout: 60000 });
			check(!!btn, 'share page: a game row shows the ▶ REPLAY button');
			const shotShare = path.join(OUT, `share-page-${sid}.png`);
			await p5.screenshot({ path: shotShare, fullPage: true });
			log('screenshot (share page)', shotShare);
			await btn.click();
			await p5.waitForSelector('[role="dialog"] .emb', { timeout: 60000 });
			const st5 = await waitEmbed(p5);
			log('sheet embed', JSON.stringify(st5));
			check(st5.state !== 'error' && st5.state !== 'nopack', `ReplaySheet embed reached ${st5.state} from the share page`);
			const shotSheet = path.join(OUT, `share-page-${sid}-sheet.png`);
			await p5.screenshot({ path: shotSheet });
			log('screenshot (share page + ReplaySheet)', shotSheet);
			const bad5 = unexpected(p5.errors);
			check(bad5.length === 0, `share page console clean (${bad5.length} unexpected)`);
			if (bad5.length) for (const e of bad5) log('  console:', e.slice(0, 300));
			await p5.close();
		}
	}
} finally {
	await browser.close();
}
log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
