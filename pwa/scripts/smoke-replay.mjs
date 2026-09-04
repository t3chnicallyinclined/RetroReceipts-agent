// smoke-replay.mjs — headless-Chrome gate for the in-page replay (LIVE-TAB-SPEC §12 Phase 2 + the replay-everywhere pass
// + REPLAY-OVERLAY-SPEC rev 2 Phase A + the LATEST TAPE hero).
//
//   node scripts/smoke-replay.mjs [--url http://localhost:5173/match?dev=1] [--row local_stage9]
//                                 [--out <dir>] [--l3 http://localhost:8099] [--skins] [--surfaces]
//                                 [--overlay] [--hero]
//
// Opens the dev server, expands the TEST TAPES row, waits for the embed's `ready` state (window.__rrEmbed,
// exposed by ReplayEmbed for tests), asserts frames ADVANCE while playing, screenshots the page, and:
//   --l3        compares the frame-0 scene-RT sha-256 with the dev player's for the same tape+pack at the same
//               display options (serve.py running in d3dcap/replay on :8099) — identical pixels, not "looks right"
//   --skins     re-opens the row with ?devskin=ff00ff (P1's first character painted flat magenta) and asserts the
//               frame-0 sha DIFFERS from the stock sha, while the stock run must EQUAL --stock-sha when given
//   --surfaces  screenshots (a) the set view opened from the LIVE tab (per-game affordances) and (b) the share
//               page /r/set/<id> with the affordance, then opens a per-game ▶ REPLAY there (the ReplaySheet)
//   --overlay   THE OVERLAY gate (REPLAY-OVERLAY-SPEC rev 2 §10 Phase A) on the LATEST TAPE hero with ?devcredit=1:
//               (1) readback sha identical with the layer full / off (the canvas is untouched — DOM, never canvas);
//               (2) the layer's client rect equals the canvas's rect at 1280 wide, 1920×1080 fullscreen, 844×390
//               and 390×844, and each element's rect ÷ k matches the §2.2 table (rev 3: identity rows in the top strip
//               y 0–24, stamp in the dead gap, watermark above the hyper bars) within 1 px; (3) no element enters a
//               §2.1 no-go zone (rows clear of the health bars at y 25); (4) minimal within 3.3 s of play, full on pause / hover; (5) the fullscreen HUD fades
//               ≤ 2.5 s and is anchored to the picture's bottom edge. Screenshots of every frame go to --out.
//   --hero      the LATEST TAPE hero reaches `playing` on load with no click (desktop), sits `closed` with NO tape or
//               pack request under a mobile user-agent, and stops at `ready` under prefers-reduced-motion.
//   --art       THE ART GATE (2026-09-04, the server serves packs to owners): writes static/replay/packfix/manifest.json
//               (gitignored) from the real local pack — the SAME shapes GET /rr/packs/manifest?key= will return — and
//               drives the dev row `local_stage9_art` through the flow: (1) the nopack panel offers the ownership
//               checkbox and NO pack file is requested before it is ticked and the button pressed; (2) the assembled
//               pack is byte-identical to the local directory pack (same file names, offsets, lengths and a matching
//               blob sha-256) and the frame-0 readback equals the local-pack baseline; (3) a second load hits Cache
//               Storage — 0 network bytes for the shared parts; (4) under a mobile UA the art loads on the tap, never
//               automatically; (5) OPEN REPLAYS (2026-09-04): the whole run is SIGNED OUT — a tape resolves and plays
//               with no account, the ownership tick posts NO /rr/attest, every pack request carries X-RR-Owns-Game: 1,
//               the acknowledgement survives a reload, and a row with no tape key is still refused.
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

/** the server-shaped pack manifest fixture: the real local pack's files, addressed by URL exactly as the server will */
async function writePackFixture() {
	const src = `${ORIGIN}/replay/packs/${ROW}/manifest.json`;
	const man = await (await fetch(src)).json();
	// `?art=1` marks these as the FIXTURE's fetches: the same bytes as the local pack, but distinguishable from the
	// hero's own directory load on the same page (and a different Cache Storage key, so the hit we measure is ours)
	const files = man.files.map((f) => ({ name: f.name, url: `/replay/packs/${ROW}/${f.name}?art=1`, bytes: f.bytes, sha256: f.sha256 }));
	const out = {
		_: 'GENERATED by scripts/smoke-replay.mjs --art; mirrors GET /rr/packs/manifest?key=<key>. Never committed.',
		ok: true,
		key: ROW,
		parts: [...new Set(files.map((f) => f.name.split('/')[0]))],
		files,
		total_bytes: files.reduce((a, f) => a + f.bytes, 0)
	};
	const dir = path.resolve('static/replay/packfix');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(out, null, 1));
	log(`pack fixture: ${files.length} files, ${(out.total_bytes / 1048576).toFixed(1)} MB → static/replay/packfix/manifest.json`);
	return out;
}

const log = (...a) => console.error('[smoke]', ...a);
// puppeteer teardown quirk: closing a page after fullscreen + viewport changes can reject a stale internal
// waitForFunction with "frame got detached" from an event handler (unhandled) — harmless, never a check
const teardownNoise = (e) => /frame got detached|detached Frame|Target closed|Session closed/i.test(String(e));
process.on('unhandledRejection', (e) => {
	if (teardownNoise(e)) return log('(ignored puppeteer teardown rejection)');
	throw e;
});
// the same noise can surface as an uncaught throw from puppeteer's own dispose handlers
process.on('uncaughtException', (e) => {
	if (teardownNoise(e)) return log('(ignored puppeteer teardown exception)');
	log('UNCAUGHT', String(e?.stack ?? e).slice(0, 400));
	process.exit(1);
});
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
		'--window-size=1920,1600',
		'--disable-background-timer-throttling'
	]
});
let failed = 0;
const check = (ok, what) => {
	log(ok ? 'PASS' : 'FAIL', what);
	if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = ['ready', 'playing', 'paused', 'ended', 'error', 'nopack'];
/** wait for an embed's hook (window.__rrEmbed by default; the hero registers as window.__rrHero) to reach a settled state */
async function waitEmbed(page, hook = '__rrEmbed', states = READY) {
	await page.waitForFunction((h, R) => window[h] && R.includes(window[h].state), { timeout: 600000, polling: 250 }, hook, states);
	return page.evaluate((h) => ({ state: window[h].state, count: window[h].count, quality: window[h].quality, ttffMs: window[h].ttffMs, key: window[h].key, res: window[h].res, taps: window[h].taps, backing: window[h].backing, rt: window[h].rt }), hook);
}
/** read a hook property, waiting for the hook to (re)appear — a dev-server reload can drop it mid-run */
async function hookProp(page, prop, hook = '__rrEmbed') {
	await page.waitForFunction((h) => !!window[h], { timeout: 120000, polling: 100 }, hook);
	return page.evaluate((h, k) => window[h][k], hook, prop);
}
async function frame0sha(page, hook = '__rrEmbed') {
	await page.evaluate((h) => window[h].pause(), hook);
	await page.evaluate((h) => window[h].seek(0), hook);
	await page.waitForFunction((h) => window[h].frame === 0, { timeout: 60000 }, hook);
	return page.evaluate((h) => window[h].readback(), hook);
}
async function newPage(w = 1280, h = 1600) {
	const page = await browser.newPage();
	await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));
	page.errors = errors;
	return page;
}
const unexpected = (errors) => errors.filter((e) => !/favicon|ogimg|404|net::ERR|Failed to load resource|\/rr\/tape|\/rr\/loadout|\/rr\/matches/i.test(e));

try {
	const page = await newPage();
	// the baseline run forces STOCK skins (?devskin=none): P1 of a test tape may own a real cloud loadout, and the
	// emitter now wears it — the L3 / --stock-sha comparisons need the no-skins picture
	const STOCK_URL = `${URL_}&devskin=none`;
	log('open (stock baseline)', STOCK_URL);
	await page.goto(STOCK_URL, { waitUntil: 'load', timeout: 120000 });
	check(await page.evaluate(() => !!navigator.gpu), 'navigator.gpu present');

	if (has('--hero')) {
		// the LATEST TAPE hero autoplays on load — no click anywhere
		const t = Date.now();
		const h = await waitEmbed(page, '__rrHero', ['playing', 'error', 'nopack']);
		log('hero', JSON.stringify(h), `after ${((Date.now() - t) / 1000).toFixed(1)} s`);
		check(h.state === 'playing', `hero reaches playing on load with no click (${h.state}, key ${h.key})`);
		check(await page.evaluate(() => /Latest Tape/i.test(document.querySelector('[data-test="hero"] .shead')?.textContent ?? '')), 'hero section is titled LATEST TAPE');
		check(await page.evaluate(() => { const b = document.body.getBoundingClientRect(); const hero = document.querySelector('[data-test="hero"]')?.getBoundingClientRect(); const money = [...document.querySelectorAll('h2.shead')].find((x) => /Live Money/.test(x.textContent))?.getBoundingClientRect(); return !!hero && !!money && hero.top < money.top && b.top <= hero.top; }), 'hero sits above LIVE MONEY');
	}

	const rowSel = `[data-test="tape-row-${ROW}"] button`;
	await page.waitForSelector(rowSel, { timeout: 60000 });
	check(true, `test row ${ROW} rendered`);
	check(await page.evaluate((s) => /REPLAY/.test(document.querySelector(s)?.textContent ?? ''), rowSel), 'row shows the ▶ REPLAY affordance');
	// OPEN REPLAYS: this whole run is signed out (no token is ever set) — no 🔒 chip may exist anywhere on the tab
	check(
		await page.evaluate(() => !document.body.textContent.includes('SIGN IN TO WATCH') && !document.querySelector('.ra.signin')),
		'open: no 🔒 SIGN IN chip on the page while signed out'
	);
	check(await page.evaluate(() => !localStorage.getItem('rr_token')), 'open: the run is genuinely signed out (no token)');
	await page.click(rowSel);
	check(await page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-expanded') === 'true', rowSel), 'row aria-expanded=true');

	const t0 = Date.now();
	const st = await waitEmbed(page);
	log('embed', JSON.stringify(st), `after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	check(st.state !== 'error' && st.state !== 'nopack', `embed reached ${st.state}`);
	check(st.count > 0, `tape has ${st.count} frames`);
	log('display plan (inline)', JSON.stringify({ res: st.res, taps: st.taps, backing: st.backing, rt: st.rt }));
	check(st.backing && st.backing.w === 640 && st.backing.h === 480 && st.res === 2 && st.taps === 2 && st.rt && st.rt.w === 2048 && st.rt.h === 1024, `display: inline 640 CSS @ DPR 1 → backing 640×480, res 2 (RT 2048×1024), 2 box taps (got ${JSON.stringify({ res: st.res, taps: st.taps, backing: st.backing, rt: st.rt })})`);
	if (has('--hero')) check(await page.evaluate(() => window.__rrHero && window.__rrHero.state !== 'playing'), 'expanding a row pauses the hero (one picture at a time)');

	await page.evaluate(() => window.__rrEmbed?.play());
	const f0 = await hookProp(page, 'frame');
	await sleep(2500);
	const f1 = await hookProp(page, 'frame');
	log(`frame ${f0} → ${f1} over 2.5 s (state ${await hookProp(page, 'state')})`);
	check(f1 > f0, 'frames advance during playback');

	const rb0 = await frame0sha(page);
	log('embed frame 0 readback (stock)', JSON.stringify(rb0));
	check(rb0.bytes > 0, 'readback returned scene-RT bytes');
	if (STOCK_SHA) check(rb0.sha === STOCK_SHA, `stock frame-0 sha equals the known stock sha (${STOCK_SHA.slice(0, 12)}…)`);
	check(
		await page.evaluate(() => /RETRO RECEIPTS/.test(document.querySelector('[data-hook="rrEmbed"] .ovl .wm')?.textContent ?? '') && !!document.querySelector('[data-hook="rrEmbed"] .ovl .wm a[href$="/ranks"]')),
		'watermark (RETRO RECEIPTS · nobd.net/app/ranks) on the picture, in the overlay layer'
	);

	const shot = path.join(OUT, `live-tab-${ROW}.png`);
	await page.screenshot({ path: shot, fullPage: true });
	log('screenshot', shot);
	const emb = await page.$('[data-hook="rrEmbed"]');
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
		// the embed's internal res follows its displayed size (displayPlan): compare against the dev player at the SAME res
		const u = `${L3}/player.html?tape=${encodeURIComponent(`${rel}/tape.json.gz`)}&pack=${encodeURIComponent(rel)}&auto=1${st.quality === 'high' ? `&res=${st.res}&filter=box` : ''}`;
		log('L3 dev player', u);
		await p2.goto(u, { waitUntil: 'load', timeout: 120000 });
		await p2.waitForFunction(() => window.__rr && window.__rr.ready === true, { timeout: 600000, polling: 250 });
		await p2.evaluate(() => window.__rr.show(0));
		const rbDev = await p2.evaluate(() => window.__rr.readback());
		log('dev player frame 0 readback', JSON.stringify(rbDev));
		check(rbDev.sha === rb0.sha && rbDev.bytes === rb0.bytes, `L3 (res ${st.res}): embed frame-0 sha == dev player frame-0 sha (${rb0.sha.slice(0, 12)}…)`);
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
		const emb3 = await p3.$('[data-hook="rrEmbed"]');
		if (emb3) {
			const shotSkin = path.join(OUT, `embed-${ROW}-devskin.png`);
			await emb3.screenshot({ path: shotSkin });
			log('skinned embed screenshot', shotSkin);
		}
		await p3.close();
	}

	if (has('--overlay')) {
		// ═══ THE OVERLAY gate — on the hero (autoplays, one load) with fake credits (?devcredit=1) and stock skins ═══
		const H = '__rrHero';
		const SEL = '[data-test="hero"] .emb';
		const p6 = await newPage(1280, 1600);
		await p6.goto(`${URL_}&devcredit=1&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		const h6 = await waitEmbed(p6, H);
		log('overlay: hero', JSON.stringify(h6));
		check(h6.state !== 'error' && h6.state !== 'nopack', `overlay: hero embed reached ${h6.state}`);

		// geometry helpers (page side): rects in viewport px → picture units via the canvas rect and k
		const geom = (sel) =>
			p6.evaluate(
				(s, h) => {
					const c = document.querySelector(`${s} canvas`).getBoundingClientRect();
					const k = window[h].scale;
					const r = (q) => {
						const e = document.querySelector(`${s} ${q}`);
						if (!e) return null;
						const b = e.getBoundingClientRect();
						return { x: (b.left - c.left) / k, y: (b.top - c.top) / k, w: b.width / k, h: b.height / k, r: (b.right - c.left) / k, b: (b.bottom - c.top) / k };
					};
					const ov = document.querySelector(`${s} .ovl`)?.getBoundingClientRect();
					return {
						k,
						canvas: { w: c.width, h: c.height, left: c.left, top: c.top, bottom: c.bottom },
						layer: ov ? { dl: ov.left - c.left, dt: ov.top - c.top, dw: ov.width - c.width, dh: ov.height - c.height } : null,
						p1: r('.ovl .pid.p1'),
						p2: r('.ovl .pid.p2'),
						r1: r('.ovl .pid.p1 .r1'),
						r2: r('.ovl .pid.p1 .r2'),
						by1: (document.querySelector(`${s} .ovl .pid.p1 .r2`)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
						by2: (document.querySelector(`${s} .ovl .pid.p2 .r2`)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
						nmFont: (() => { const cs = getComputedStyle(document.querySelector(`${s} .ovl .pid.p1 .nm`)); return `${cs.fontStyle} ${cs.fontWeight}`; })(),
						stampShown: (() => { const e = document.querySelector(`${s} .ovl .stamp`); return !!e && getComputedStyle(e).display !== 'none'; })(),
						stamp: r('.ovl .stamp'),
						wm: r('.ovl .wm'),
						tr: (() => { const e = document.querySelector(`${s} .tr`); if (!e) return null; const b = e.getBoundingClientRect(); return { bottom: b.bottom, opacity: getComputedStyle(e).opacity }; })(),
						mode: window[h].overlay,
						links: [...document.querySelectorAll(`${s} .ovl .pid .r2 a`)].map((a) => a.getAttribute('href')),
						p2order: (() => { const l = document.querySelector(`${s} .ovl .pid.p2 .r2 .lb`)?.getBoundingClientRect(); const n = document.querySelector(`${s} .ovl .pid.p2 .r2 .by`)?.getBoundingClientRect(); return !!l && !!n && l.right <= n.left; })()
					};
				},
				sel,
				H
			);
		const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
		const layerOk = (g) => g.layer && Math.abs(g.layer.dl) <= 1.5 && Math.abs(g.layer.dt) <= 1.5 && Math.abs(g.layer.dw) <= 1.5 && Math.abs(g.layer.dh) <= 1.5;
		// §2.2 placement in picture units + §2.1 no-go zones
		const placement = (g, label) => {
			check(layerOk(g), `${label}: layer rect == canvas rect (k ${g.k.toFixed(4)}, Δ ${g.layer ? [g.layer.dl, g.layer.dt, g.layer.dw, g.layer.dh].map((v) => v.toFixed(1)).join('/') : 'none'})`);
			// rev 3: identity in the top strip (y 0–24), clear of the health bars (y 25); always on
			check(g.p1 && near(g.p1.x, 8) && g.p1.y >= 0 && g.p1.b <= 24.5, `${label}: P1 rows x 8 inside y 0–24 (got x ${g.p1?.x.toFixed(1)}, y ${g.p1?.y.toFixed(1)}–${g.p1?.b.toFixed(1)})`);
			check(g.p2 && near(g.p2.r, 632) && g.p2.y >= 0 && g.p2.b <= 24.5, `${label}: P2 rows right edge x 632 inside y 0–24 (got r ${g.p2?.r.toFixed(1)}, y ${g.p2?.y.toFixed(1)}–${g.p2?.b.toFixed(1)})`);
			check(g.r1 && near(g.r1.y, 1) && near(g.r1.h, 11) && g.r2 && near(g.r2.y, 13) && near(g.r2.h, 11), `${label}: row 1 y 1–12, row 2 y 13–24 (got r1 ${g.r1?.y.toFixed(1)}+${g.r1?.h.toFixed(1)}, r2 ${g.r2?.y.toFixed(1)}+${g.r2?.h.toFixed(1)})`);
			check(g.p1 && g.p1.b < 25 && g.p2.b < 25, `${label}: rows clear of the health bars (y 25)`);
			check(/italic (900|bold)/.test(g.nmFont), `${label}: name in the display face (italic 900; got ${g.nmFont})`);
			check(g.by1 === 'Skin by: Ruby' && g.by2 === 'Skin by: Ruby', `${label}: Skin by: rows read the unique creators (got "${g.by1}" / "${g.by2}")`);
			check(g.links.length === 2 && g.links.every((l) => /\/u\/\d{17}$/.test(l)), `${label}: linked creators → /u/<steamid> (${g.links.length} links)`);
			check(g.p2order, `${label}: P2 row 2 reads left-to-right (label before the name), right-justified`);
			if (g.mode === 'full') {
				check(g.stampShown, `${label}: record stamp shown in full`);
				check(g.stamp && near(g.stamp.y, 56) && near(g.stamp.x + g.stamp.w / 2, 320) && g.stamp.w <= 105 && g.stamp.h <= 44, `${label}: record stamp top y 56, centred x 320, ≤ 104 wide (got y ${g.stamp?.y.toFixed(1)}, cx ${g.stamp ? (g.stamp.x + g.stamp.w / 2).toFixed(1) : '-'}, w ${g.stamp?.w.toFixed(1)}, h ${g.stamp?.h.toFixed(1)})`);
				check(g.stamp && g.stamp.x >= 268 && g.stamp.r <= 375 && g.stamp.y >= 55 && g.stamp.b <= 101, `${label}: stamp inside the dead gap (x 269–374, y 55–101) — clear of the timer and assist stacks`);
			} else {
				check(!g.stampShown, `${label}: record stamp hidden in minimal`);
			}
			check(g.wm && near(g.wm.y, 437) && near(g.wm.h, 12) && near(g.wm.x + g.wm.w / 2, 320), `${label}: watermark y 437, h 12, centred x 320 (got y ${g.wm?.y.toFixed(1)}, h ${g.wm?.h.toFixed(1)}, cx ${g.wm ? (g.wm.x + g.wm.w / 2).toFixed(1) : '-'})`);
			check(g.wm && g.wm.b <= 453 && g.wm.x >= 66 && g.wm.r <= 574, `${label}: watermark above the hyper bars (y 453) and between the LEVEL pods (x 66–574)`);
		};

		// (1) the canvas is untouched: readback sha identical with the layer full and off (and == the stock baseline for the same tape)
		await p6.evaluate((h) => window[h].setOverlay('full'), H);
		const rbFull = await frame0sha(p6, H);
		await p6.evaluate((h) => window[h].setOverlay('off'), H);
		const rbOff = await frame0sha(p6, H);
		check(rbFull.sha === rbOff.sha && rbFull.bytes === rbOff.bytes, `overlay: readback sha identical with the layer full and off (${rbFull.sha.slice(0, 12)}…)`);
		if (h6.key === ROW) check(rbFull.sha === rb0.sha, 'overlay: hero frame-0 sha == the stock baseline sha (same tape, layer is chrome, never pixels)');
		check(await p6.evaluate((s) => !document.querySelector(`${s} .ovl`) || getComputedStyle(document.querySelector(`${s} .ovl`)).display === 'none', SEL), 'overlay: off = the layer is gone');

		// (2)/(3) inline geometry, full form, on a fight frame
		await p6.evaluate((h) => window[h].setOverlay('full'), H);
		await p6.evaluate((h) => window[h].seek(900), H);
		await p6.waitForFunction((h) => window[h].frame === 900, { timeout: 60000 }, H);
		await sleep(300);
		let g = await geom(SEL);
		check(near(g.k, Math.min(1, g.canvas.w / 640), 0.01), `overlay: inline k = ${g.k.toFixed(4)} (canvas ${g.canvas.w.toFixed(0)} px wide)`);
		placement(g, 'inline');
		{
			const from = await p6.evaluate((h) => window[h].template, H);
			const name = await p6.evaluate((s) => document.querySelector(`${s} .ovl`)?.getAttribute('data-template'), SEL);
			check(name === 'retro-receipts-default' && /^(builtin|server):retro-receipts-default$/.test(from), `template: the layer is rendered from the default template (${from})`);
		}
		const shotInline = path.join(OUT, 'overlay-inline.png');
		await (await p6.$(SEL)).screenshot({ path: shotInline });
		log('screenshot (inline, full overlay, devcredit)', shotInline);

		// (4) timing: auto → full for the first 3 s of play → minimal by 3.3 s → full on pause → full on hover → minimal 3 s after the pointer leaves
		await p6.mouse.move(5, 5);
		await p6.evaluate((h) => { window[h].setOverlay('auto'); window[h].play(); }, H);
		await sleep(400);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'full', 'overlay: full during the first 3 s of play');
		await sleep(3000);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'minimal', 'overlay: minimal within 3.3 s of play (no pokes)');
		await sleep(400); // the full-only elements fade out over 300 ms (spec §2.5) before they leave the flow
		g = await geom(SEL);
		check(!g.stampShown, 'overlay: minimal hides the record stamp');
		check(g.p1 && g.p2 && g.by1 === 'Skin by: Ruby', 'overlay: minimal keeps the identity rows (always on) + watermark');
		placement(g, 'inline minimal');
		const shotMin = path.join(OUT, 'overlay-inline-minimal.png');
		await (await p6.$(SEL)).screenshot({ path: shotMin });
		log('screenshot (inline, minimal while playing)', shotMin);
		await p6.evaluate((h) => window[h].pause(), H);
		await sleep(100);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'full', 'overlay: full on pause');
		await p6.evaluate((h) => window[h].play(), H);
		await sleep(3400);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'minimal', 'overlay: minimal again after the intro');
		await p6.hover(`${SEL} canvas`);
		await sleep(150);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'full', 'overlay: full on hover (pointer over the picture)');
		await p6.mouse.move(5, 5);
		await sleep(3400);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'minimal', 'overlay: minimal 3 s after the pointer leaves');
		// `o` cycles auto → full → minimal → off → auto
		await p6.focus(SEL);
		await p6.keyboard.press('o');
		check((await p6.evaluate((h) => window[h].overlayMode, H)) === 'full', 'overlay: `o` → full');
		await p6.keyboard.press('o');
		await p6.keyboard.press('o');
		check((await p6.evaluate((h) => window[h].overlayMode, H)) === 'off', 'overlay: `o` `o` → off');
		await p6.keyboard.press('o');
		check((await p6.evaluate((h) => window[h].overlayMode, H)) === 'auto', 'overlay: `o` → auto');
		await p6.evaluate((h) => window[h].pause(), H);

		// (2)/(5) fullscreen 1920×1080: picture 2× (1280×960), layer == canvas, HUD fades ≤ 2.5 s and is anchored to the picture
		const fsBtn = `${SEL} .tr button[aria-label="Full screen"]`;
		async function goFs(w, h, label) {
			await p6.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
			await sleep(200);
			await p6.click(fsBtn);
			await p6.waitForFunction((s) => !!document.querySelector(`${s}.fs`), { timeout: 10000 }, SEL);
			await sleep(400);
			log(`${label}: fullscreen (${(await p6.evaluate(() => (document.fullscreenElement ? 'Fullscreen API' : 'pseudo')))})`);
		}
		async function leaveFs() {
			await p6.evaluate((h) => window[h].exitFullscreen(), H);
			await p6.waitForFunction((s) => !document.querySelector(`${s}.fs`), { timeout: 10000 }, SEL);
			await sleep(200);
		}
		let rbFs = null;
		await goFs(1920, 1080, 'fs 1920×1080');
		await p6.evaluate((h) => window[h].setOverlay('full'), H);
		await sleep(100);
		g = await geom(SEL);
		check(near(g.canvas.w, 1280, 1) && near(g.k, 2, 0.01), `fs 1920×1080: picture 2× = 1280 px wide, k ${g.k.toFixed(3)}`);
		{
			const d = await p6.evaluate((h) => ({ res: window[h].res, taps: window[h].taps, backing: window[h].backing, rt: window[h].rt, css: (() => { const c = document.querySelector('[data-test="hero"] .emb canvas').getBoundingClientRect(); return { w: c.width, h: c.height }; })() }), H);
			log('display plan (fs 1920×1080)', JSON.stringify(d));
			check(d.backing.w === 1280 && d.backing.h === 960 && d.res === 4 && d.taps === 2 && d.rt && d.rt.w === 4096 && d.rt.h === 2048, `fs 1920×1080: backing 1280×960 device px, res 4 (RT 4096×2048 = viewport 2560×1920), 2 integer box taps`);
			check(Math.abs(d.css.h / d.css.w - 0.75) < 0.002 && d.backing.h / d.backing.w === 0.75, `fs 1920×1080: picture aspect exactly 4:3 (CSS ${d.css.w.toFixed(0)}×${d.css.h.toFixed(0)}, backing ${d.backing.w}×${d.backing.h}) — never stretched`);
			if (L3) {
				// the same scene at res 4 must equal the dev player at res 4 — read it back HERE (in fullscreen); the dev-player
				// tab opens after leaveFs() (a new tab drops the page out of the Fullscreen API)
				rbFs = await frame0sha(p6, H);
				await p6.evaluate((h) => window[h].seek(900), H);
				await p6.waitForFunction((h) => window[h].frame === 900, { timeout: 60000 }, H);
			}
		}
		placement(g, 'fs 1920×1080');
		check(g.tr && near(g.tr.bottom, g.canvas.bottom, 1), `fs 1920×1080: transport HUD anchored to the picture's bottom edge (HUD bottom ${g.tr?.bottom.toFixed(0)}, picture bottom ${g.canvas.bottom.toFixed(0)})`);
		const shotFs = path.join(OUT, 'overlay-fullscreen-1920x1080.png');
		await p6.screenshot({ path: shotFs });
		log('screenshot (fullscreen 1920×1080, full overlay)', shotFs);
		// HUD fade: no pokes for > 2.5 s → .hudoff; the overlay drops to minimal while playing
		await p6.evaluate((h) => { window[h].setOverlay('auto'); window[h].play(); }, H);
		await sleep(3200);
		check(await p6.evaluate((s) => !!document.querySelector(`${s}.fs.hudoff`), SEL), 'fs 1920×1080: HUD fades within 2.5 s idle');
		g = await geom(SEL);
		check(g.tr && g.tr.opacity === '0', 'fs 1920×1080: faded HUD is opacity 0 (never a chrome element over the picture while hidden)');
		check(g.mode === 'minimal', 'fs 1920×1080: overlay minimal while playing after the fade');
		const shotFsMin = path.join(OUT, 'overlay-fullscreen-1920x1080-minimal.png');
		await p6.screenshot({ path: shotFsMin });
		log('screenshot (fullscreen 1920×1080, minimal, HUD faded)', shotFsMin);
		await p6.evaluate((h) => window[h].pause(), H);
		await leaveFs();
		if (L3 && rbFs) {
			const p2b = await newPage();
			const tapes = await p6.evaluate(async () => (await (await fetch('/replay/index.json')).json()).tapes);
			const t = tapes[h6.key];
			if (t) {
				const rel = t.pack.replace(/^\/replay\//, '');
				await p2b.goto(`${L3}/player.html?tape=${encodeURIComponent(`${rel}/tape.json.gz`)}&pack=${encodeURIComponent(rel)}&auto=1&res=4&filter=box`, { waitUntil: 'load', timeout: 120000 });
				await p2b.waitForFunction(() => window.__rr && window.__rr.ready === true, { timeout: 600000, polling: 250 });
				await p2b.evaluate(() => window.__rr.show(0));
				const rbDev4 = await p2b.evaluate(() => window.__rr.readback());
				check(rbDev4.sha === rbFs.sha && rbDev4.bytes === rbFs.bytes, `L3 (res 4, fullscreen re-target): embed frame-0 sha == dev player res-4 sha (${rbFs.sha.slice(0, 12)}…, ${rbFs.bytes} bytes)`);
			} else check(false, `L3 res-4: hero key ${h6.key} is a local tape`);
			await p2b.close();
		}

		// phone landscape 844×390: picture fit to height 520×390 → k 0.8125
		await goFs(844, 390, 'phone landscape 844×390');
		await p6.evaluate((h) => window[h].setOverlay('full'), H);
		await sleep(100);
		g = await geom(SEL);
		check(near(g.canvas.w, 520, 1) && near(g.k, 0.8125, 0.01), `phone landscape: picture 520 px wide (fit to height), k ${g.k.toFixed(4)}`);
		{
			const d = await p6.evaluate((h) => ({ res: window[h].res, taps: window[h].taps, backing: window[h].backing, rt: window[h].rt }), H);
			log('display plan (phone landscape)', JSON.stringify(d));
			check(d.backing.w === 520 && d.backing.h === 390 && d.res === 2 && d.backing.h / d.backing.w === 0.75, `phone landscape: backing 520×390 (4:3 exactly), res 2 (RT ${d.rt?.w}×${d.rt?.h}), ${d.taps} rounded box taps`);
		}
		placement(g, 'phone landscape 844×390');
		const shotPl = path.join(OUT, 'overlay-phone-landscape-844x390.png');
		await p6.screenshot({ path: shotPl });
		log('screenshot (phone landscape 844×390, full overlay)', shotPl);
		await p6.evaluate((h) => window[h].setOverlay('auto'), H);
		await leaveFs();

		// phone portrait 390×844: k 0.61 → minimal-only while playing, full on pause; transport static in the band
		await goFs(390, 844, 'phone portrait 390×844');
		await sleep(100);
		g = await geom(SEL);
		check(near(g.canvas.w, 390, 1) && g.k < 0.75, `phone portrait: picture 390 px wide, k ${g.k.toFixed(4)} (< 0.75)`);
		placement(g, 'phone portrait 390×844');
		await p6.evaluate((h) => window[h].play(), H);
		await sleep(400);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'minimal', 'phone portrait: minimal while playing even in the first 3 s (k < 0.75)');
		await p6.evaluate((h) => window[h].pause(), H);
		await sleep(100);
		check((await p6.evaluate((h) => window[h].overlay, H)) === 'full', 'phone portrait: full on pause');
		check(await p6.evaluate((s) => !!document.querySelector(`${s}.fs.portrait`) && getComputedStyle(document.querySelector(`${s} .tr`)).position === 'static', SEL), 'phone portrait: transport static in the band under the picture');
		const shotPp = path.join(OUT, 'overlay-phone-portrait-390x844.png');
		await p6.screenshot({ path: shotPp });
		log('screenshot (phone portrait 390×844, paused = full overlay)', shotPp);
		await leaveFs();
		// §6.5 keyboard walk still reaches both plate groups (DOM order: plates before the transport)
		check(await p6.evaluate((s) => { const g = [...document.querySelectorAll(`${s} [role="group"][aria-label]`)].map((e) => e.getAttribute('aria-label')); return g.length >= 2 && g[0].startsWith('Player 1:') && g[1].startsWith('Player 2:'); }, SEL), 'a11y: two plate groups labelled Player 1 / Player 2 (seats known) before the transport in DOM order');
		const bad6 = unexpected(p6.errors);
		check(bad6.length === 0, `overlay page console clean (${bad6.length} unexpected)`);
		if (bad6.length) for (const e of bad6) log('  console:', e.slice(0, 300));
		await p6.close();

		// (6) TEMPLATE-DRIVEN: an alternate template via ?overlay= moves elements with no code change
		const p9 = await newPage(1280, 1600);
		await p9.goto(`${URL_}&devcredit=1&devskin=none&overlay=/replay/overlay/shifted.json`, { waitUntil: 'load', timeout: 120000 });
		await waitEmbed(p9, H);
		await p9.evaluate((h) => window[h].setOverlay('full'), H);
		await sleep(300);
		const g9 = await p9.evaluate((s, h) => {
			const c = document.querySelector(`${s} canvas`).getBoundingClientRect();
			const k = window[h].scale;
			const r = (q) => { const b = document.querySelector(`${s} ${q}`)?.getBoundingClientRect(); return b ? { x: (b.left - c.left) / k, y: (b.top - c.top) / k } : null; };
			return { tpl: document.querySelector(`${s} .ovl`)?.getAttribute('data-template'), from: window[h].template, p1: r('.ovl .pid.p1'), stamp: r('.ovl .stamp') };
		}, SEL, H);
		check(g9.tpl === 'shifted-test' && /^preview:/.test(g9.from), `template: ?overlay= preview loads the alternate template (${g9.from})`);
		check(g9.p1 && near(g9.p1.x, 20) && g9.stamp && near(g9.stamp.y, 60), `template: elements moved by the template alone — P1 x 20, stamp y 60 (got ${g9.p1?.x.toFixed(1)}, ${g9.stamp?.y.toFixed(1)})`);
		const rb9 = await frame0sha(p9, H);
		check(rb9.sha === rbFull.sha, 'template: readback sha unchanged under an alternate template (the layer is chrome, never pixels)');
		await p9.close();

		// (7) THE OVERLAY BLOCK SHIPPED WITH THE TAPE (STEP 4b): the dev manifest row local_stage9_srv carries one —
		//     names / credits / watermark bind from it VERBATIM (row names differ; ?devcredit is ignored)
		const p10 = await newPage(1280, 1600);
		await p10.goto(`${URL_}&devcredit=1&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		const srvSel = '[data-test="tape-row-local_stage9_srv"] button';
		await p10.waitForSelector(srvSel, { timeout: 60000 });
		await p10.click(srvSel);
		await waitEmbed(p10, '__rrEmbed');
		await p10.evaluate(() => window.__rrEmbed.setOverlay('full'));
		await sleep(300);
		const g10 = await p10.evaluate(() => {
			const s = '[data-hook="rrEmbed"]';
			const t = (q) => (document.querySelector(`${s} ${q}`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
			return { n1: t('.ovl .pid.p1 .nm'), n2: t('.ovl .pid.p2 .nm'), b1: t('.ovl .pid.p1 .r2'), b2: t('.ovl .pid.p2 .r2'), link: document.querySelector(`${s} .ovl .pid.p1 .r2 a`)?.getAttribute('href') ?? '', wm: t('.ovl .wm'), rec: t('.ovl .stamp .rec'), shipped: window.__rrEmbed.overlayMeta?.shipped };
		});
		check(g10.shipped === true, 'tape overlay block: the embed bound the shipped overlay.meta (no client assembly)');
		check(g10.n1 === 'Server P1' && g10.n2 === 'Server P2', `tape overlay block: names verbatim from overlay.meta (got "${g10.n1}" / "${g10.n2}")`);
		check(g10.b1 === 'Skin by: Zed' && g10.b2 === '' && /\/u\/76561198000000002$/.test(g10.link), `tape overlay block: credits from overlay.meta, ?devcredit ignored (got "${g10.b1}" / "${g10.b2}", link ${g10.link})`);
		check(/SERVER WATERMARK/.test(g10.wm) && /RANKED · FT3 · G2/.test(g10.rec), `tape overlay block: watermark + record from overlay.meta ("${g10.wm}" / "${g10.rec}")`);
		await p10.close();
	}

	if (has('--hero')) {
		// a phone: the hero sits `closed` on the poster — NO tape / pack request until a tap
		const p7 = await browser.newPage();
		await p7.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
		await p7.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
		const heavy = [];
		p7.on('request', (r) => {
			if (/\/replay\/packs\/.*(tape\.json\.gz|manifest\.json|\.png|\.bin)$/i.test(r.url())) heavy.push(r.url());
		});
		// mobile emulation can swap the renderer process mid-settle (puppeteer: "detached Frame") — re-open once if so
		let stM = '';
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				heavy.length = 0;
				await p7.goto(URL_, { waitUntil: 'load', timeout: 120000 });
				await p7.waitForFunction(() => !!window.__rrHero, { timeout: 60000, polling: 250 });
				await sleep(4000);
				stM = await p7.evaluate(() => window.__rrHero.state);
				break;
			} catch (e) {
				if (!/detached/i.test(String(e)) || attempt) throw e;
				log('(phone page frame detached — re-opening once)');
			}
		}
		check(stM === 'closed', `hero on a phone UA stays closed (state ${stM}) — tap to watch`);
		check(heavy.length === 0, `hero on a phone UA requested no tape/pack bytes (${heavy.length} heavy requests)`);
		check(await p7.evaluate(() => /Watch the tape/.test(document.querySelector('[data-test="hero"] .emb .ov.closed')?.textContent ?? '')), 'hero on a phone shows the poster + ▶ Watch the tape');
		const shotM = path.join(OUT, 'hero-phone-closed.png');
		await p7.screenshot({ path: shotM });
		log('screenshot (hero, phone UA, closed)', shotM);
		await p7.close();

		// reduced motion: the hero loads but does NOT autoplay (stops at ready)
		const p8 = await newPage();
		await p8.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
		await p8.goto(`${URL_}&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		const stR = await waitEmbed(p8, '__rrHero');
		await sleep(1500);
		const stR2 = await p8.evaluate(() => window.__rrHero.state);
		check(stR.state === 'ready' && stR2 === 'ready', `hero under prefers-reduced-motion stops at ready, never autoplays (${stR.state} → ${stR2})`);
		await p8.close();
	}

	if (has('--art')) {
		// ═══ THE ART GATE — the server-served pack: ownership checkbox → manifest → files → play ═══
		const fixture = await writePackFixture();
		const ART = 'local_stage9_art';
		const artSel = `[data-test="tape-row-${ART}"] button`;
		const packReqs = (page) => {
			const seen = [];
			page.on('request', (r) => {
				const u = r.url();
				if (u.includes('art=1')) seen.push(u); // only the fixture's files — the page's other rows use the plain URLs
			});
			return seen;
		};

		// (1) the gate: the panel, the checkbox, and NO pack file before the tick + tap
		const pa = await newPage();
		await pa.evaluateOnNewDocument(() => { try { localStorage.removeItem('rr.attest.dev'); } catch { /* private */ } });
		const reqsA = packReqs(pa);
		await pa.goto(`${URL_}&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		await pa.waitForSelector(artSel, { timeout: 60000 });
		await pa.click(artSel);
		const stA = await waitEmbed(pa, '__rrEmbed', ['nopack', 'ready', 'playing', 'error']);
		check(stA.state === 'nopack', `art: the server-pack row opens on the art panel (state ${stA.state})`);
		const panel = await pa.evaluate(() => {
			const s = '[data-hook="rrEmbed"] .ov.art';
			const t = (q) => (document.querySelector(`${s} ${q}`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
			const btn = document.querySelector(`${s} button`);
			return { head: t('.h'), own: t('.own'), box: !!document.querySelector(`${s} .own input[type=checkbox]`), checked: document.querySelector(`${s} .own input`)?.checked, btn: (btn?.textContent ?? '').trim(), disabled: !!btn?.disabled };
		});
		log('art panel', JSON.stringify(panel));
		check(/Tape's in\. Art loads from us\./.test(panel.head), `art: copy "Tape's in. Art loads from us." (got "${panel.head}")`);
		check(panel.box && panel.checked === false, 'art: an unticked ownership checkbox is present');
		check(/I own Marvel vs\. Capcom 2/.test(panel.own), `art: the checkbox names the game and the personal-replay purpose`);
		check(/^Load the art/.test(panel.btn) && panel.disabled, `art: the load button is disabled until the box is ticked ("${panel.btn}")`);
		await sleep(1200);
		check(reqsA.length === 0, `art: NO pack file requested before the attestation (${reqsA.length} requests)`);

		// every /rr/attest call and every pack request header (the signed-out path must post nothing and send the header)
		const attestCalls = [];
		const packHeaders = [];
		pa.on('request', (r) => {
			if (r.url().includes('/rr/attest')) attestCalls.push(`${r.method()} ${r.url()}`);
			if (r.url().includes('art=1')) packHeaders.push(r.headers()['x-rr-owns-game'] ?? '(none)');
		});

		// tick + load
		await pa.click(`[data-hook="rrEmbed"] .ov.art .own input`);
		check(!(await pa.evaluate(() => document.querySelector('[data-hook="rrEmbed"] .ov.art button')?.disabled)), 'art: ticking the box enables the button');
		await pa.click(`[data-hook="rrEmbed"] .ov.art button`);
		const stA2 = await waitEmbed(pa, '__rrEmbed', ['ready', 'playing', 'paused', 'error', 'nopack', 'unavailable']);
		check(stA2.state !== 'error' && stA2.state !== 'nopack', `art: the tape plays after the art loads (state ${stA2.state})`);
		const packA = await pa.evaluate(() => window.__rrEmbed.pack);
		log('art pack', JSON.stringify(packA));
		check(packA.kind === 'server' && packA.attested === true, 'art: the embed used the server pack path with the attestation recorded');
		check(packA.files === fixture.files.length && packA.totalBytes === fixture.total_bytes, `art: the manifest drove the load (${packA.files} files, ${packA.totalBytes} B)`);
		check(packA.networkBytes === fixture.total_bytes, `art: every file came off the network on the first load (${packA.networkBytes} B)`);
		check(attestCalls.length === 0, `open: signed out, the tick posted nothing to /rr/attest (${attestCalls.length} calls)`);
		check(packHeaders.length > 0 && packHeaders.every((h) => h === '1'), `open: X-RR-Owns-Game: 1 on every pack request (${packHeaders.filter((h) => h === '1').length}/${packHeaders.length})`);
		const owns = await pa.evaluate(() => localStorage.getItem('rr.owns.v1'));
		check(!!owns && JSON.parse(owns).owns_game === true && typeof JSON.parse(owns).ts === 'number', `open: the acknowledgement is a versioned local record (${owns})`);
		check(reqsA.length === fixture.files.length, `art: exactly the manifest's files were requested (${reqsA.length})`);

		// (2) byte-identical to the local directory pack: same names/offsets/lengths + the same frame-0 pixels
		const rbArt = await frame0sha(pa, '__rrEmbed');
		check(rbArt.sha === rb0.sha, `art: frame-0 readback equals the local-pack baseline (${rbArt.sha.slice(0, 12)}…)`);
		const idx = await pa.evaluate(async (origin, row) => {
			const p = window.__rrEmbed.packIndex;
			const man = await (await fetch(`${origin}/replay/packs/${row}/manifest.json`)).json();
			const local = man.files.map((f) => `${f.name}:${f.bytes}`).join('|');
			const built = p.map((e) => `${e.name}:${e.len}`).join('|');
			let off = 0, contiguous = true;
			for (const e of p) { if (e.off !== off) contiguous = false; off += e.len; }
			return { same: local === built, contiguous, n: p.length, bytes: off };
		}, ORIGIN, ROW);
		log('assembled index', JSON.stringify(idx));
		check(idx.same, `art: the assembled packIndex matches the local pack file-for-file (${idx.n} files)`);
		check(idx.contiguous && idx.bytes === fixture.total_bytes, `art: the packBlob is contiguous and complete (${idx.bytes} B)`);
		const shotArt = path.join(OUT, 'art-loaded.png');
		await (await pa.$('[data-hook="rrEmbed"]')).screenshot({ path: shotArt });
		log('screenshot (art loaded from the server-shaped manifest)', shotArt);
		await pa.close();

		// (3) the second load is a Cache Storage hit: 0 network bytes for the shared parts
		const pb = await newPage();
		const reqsB = packReqs(pb);
		await pb.goto(`${URL_}&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		await pb.waitForSelector(artSel, { timeout: 60000 });
		await pb.click(artSel);
		const stB = await waitEmbed(pb, '__rrEmbed', ['ready', 'playing', 'paused', 'nopack', 'error', 'unavailable']);
		if (stB.state === 'nopack') {
			// already attested → the panel shows only the button (no checkbox)
			const hasBox = await pb.evaluate(() => !!document.querySelector('[data-hook="rrEmbed"] .ov.art .own'));
			check(!hasBox, 'art: an attested viewer sees the button without the checkbox');
			await pb.click(`[data-hook="rrEmbed"] .ov.art button`);
			await waitEmbed(pb, '__rrEmbed', ['ready', 'playing', 'paused', 'error', 'unavailable']);
		}
		const packB = await pb.evaluate(() => window.__rrEmbed.pack);
		log('art pack (second load)', JSON.stringify(packB));
		check(packB.networkBytes === 0 && packB.cachedFiles === fixture.files.length, `art: the second load is 100% Cache Storage — 0 network bytes, ${packB.cachedFiles} cached files`);
		check(reqsB.length === 0, `art: no pack file hit the network on the second load (${reqsB.length} requests)`);
		// the acknowledgement survived the reload with no account, so the second visit skipped the checkbox
		check(await pb.evaluate(() => !!localStorage.getItem('rr.owns.v1')), 'open: the acknowledgement survives a reload without an account');
		check(await pb.evaluate(() => !document.querySelector('[data-hook="rrEmbed"] .ov.art .own')), 'open: an acknowledged viewer sees no checkbox on the next visit');
		// a row with no tape key is still refused — opening the gate did not open everything
		const refused = await pb.evaluate(async () => {
			const m = await import('/src/lib/replay/source.ts');
			return [await m.availability({ ts: Date.now() }), (await m.resolveSource({ ts: Date.now() })).kind, (await m.resolveSource({ ts: Date.now() })).reason];
		});
		check(refused[0] === 'none' && refused[1] === 'none' && refused[2] === 'none', `open: a keyless (lobby) row is still refused — availability ${refused[0]}, source ${refused[1]}/${refused[2]}`);
		await pb.close();

		// (4) a phone: the same flow, on the tap, never automatic
		const pm = await browser.newPage();
		await pm.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
		await pm.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
		const reqsM = packReqs(pm);
		await pm.goto(`${URL_}&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		// The desktop case above already filled Cache Storage (shared across pages in this browser), so a phone
		// run would fetch 0 files and the "download started on the tap" assertion would be vacuous. Clear the
		// pack caches here so the phone case measures a REAL first load, which is what a phone user gets.
		await pm.evaluate(async () => { for (const k of await caches.keys()) if (/rr-pack/i.test(k)) await caches.delete(k); });
		await pm.reload({ waitUntil: 'load', timeout: 120000 });
		await pm.waitForSelector(artSel, { timeout: 60000 });
		await pm.click(artSel);
		await sleep(2500);
		check(reqsM.length === 0, `art (phone): nothing downloads before the tap (${reqsM.length} requests)`);
		const stM = await pm.evaluate(() => window.__rrEmbed?.state ?? '');
		const btnM = await pm.evaluate(() => (document.querySelector('[data-hook="rrEmbed"] .ov.art button')?.textContent ?? '').trim());
		check(stM === 'nopack' || stM === 'closed', `art (phone): the row waits on the art panel (state ${stM})`);
		check(/^Load the art/.test(btnM), `art (phone): the button carries the size ("${btnM}")`);
		const box = await pm.$('[data-hook="rrEmbed"] .ov.art .own input');
		if (box) await box.click();
		await pm.click(`[data-hook="rrEmbed"] .ov.art button`);
		const stM2 = await waitEmbed(pm, '__rrEmbed', ['ready', 'playing', 'paused', 'error', 'nopack', 'unavailable']);
		check(stM2.state !== 'error' && stM2.state !== 'nopack', `art (phone): the art loads on the tap and the tape plays (${stM2.state})`);
		check(reqsM.length > 0, `art (phone): the download started on the tap (${reqsM.length} files)`);
		const shotM = path.join(OUT, 'art-phone.png');
		await pm.screenshot({ path: shotM });
		log('screenshot (phone, art loaded on tap)', shotM);
		await pm.close();
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
