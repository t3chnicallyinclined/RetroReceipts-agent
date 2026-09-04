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
//   --health    THE HALF-SPEED WATCHDOG (2026-09-04): a transient slow period drops playback to half speed and then
//               RECOVERS to 60 when throughput comes back (hysteresis: >16 ms for 2 s down, <12 ms for 3 s up), the
//               UI says so while it lasts, and a manual speed choice is never overridden.
//   --limited   LIMITED REPLAYS (measured on prod 2026-09-04: a tape from an agent < 0.3.34 has no world sections, so
//               it draws fighters with no stage and no HUD): builds the fixture by stripping nodes/anodes/aobjs/palrows
//               from a copy of the local tape and forcing ver 0.3.31, then asserts the LIMITED marker + the update
//               nudge appear on it (and that no HUD/stage was faked), and that NEITHER appears on the full tape.
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
const ROW = arg('--row', 'local_stage9');
// pin the LATEST TAPE hero to the local test pack: with the server live, a real prod row resolves `ready` and would
// legitimately open the art panel instead of autoplaying (that is the product; this keeps the gate deterministic)
const URL_ = `${arg('--url', 'http://localhost:5173/match?dev=1')}&hero=${ROW}`;
const ORIGIN = new URL(URL_).origin;
const OUT = arg('--out', path.resolve('smoke-out'));
const L3 = arg('--l3', '');
const STOCK_SHA = arg('--stock-sha', '');
const CHROME = arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
fs.mkdirSync(OUT, { recursive: true });

/** the LIMITED tape fixture: the local tape with the four world sections removed and ver forced to an old agent */
async function writeLimitedTape() {
	const zlib = await import('node:zlib');
	const gz = Buffer.from(await (await fetch(`${ORIGIN}/replay/packs/${ROW}/tape.json.gz`)).arrayBuffer());
	const env = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
	const dropped = ['nodes', 'anodes', 'aobjs', 'palrows'].filter((k) => k in env);
	for (const k of Object.keys(env)) if (/^(nodes|anodes|aobjs|palrows)(_|$)/.test(k)) delete env[k];
	env.ver = '0.3.31';
	env.stage_id = null;
	const dir = path.resolve('static/replay/packfix');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'limited.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(env))));
	log(`limited fixture: dropped ${dropped.join(', ')} → ver ${env.ver}, static/replay/packfix/limited.json.gz`);
	return dropped;
}

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
			check(g.p1 && near(g.p1.x, 14) && g.p1.y >= 0 && g.p1.b <= 24.5, `${label}: P1 rows x 14 inside y 0–24 (got x ${g.p1?.x.toFixed(1)}, y ${g.p1?.y.toFixed(1)}–${g.p1?.b.toFixed(1)})`);
			check(g.p2 && near(g.p2.r, 626) && g.p2.y >= 0 && g.p2.b <= 24.5, `${label}: P2 rows right edge x 626 inside y 0–24 (got r ${g.p2?.r.toFixed(1)}, y ${g.p2?.y.toFixed(1)}–${g.p2?.b.toFixed(1)})`);
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
		// The theatre renders at its OWN size now (LIVE-TAB-V2-SPEC §1.3: 700 px → res 4), so its scene RT is a
		// different target from the 640/res-2 row baseline and a raw sha comparison would be comparing 33.5 MB of
		// pixels against 8 MB. Compare like with like: equality against the stock baseline ONLY when the two
		// actually rendered at the same resolution; otherwise assert the readback is the right SIZE for the res
		// it claims, and let the --l3 check above prove the pixels against the dev player at that same res.
		// (The "layer is chrome, never pixels" property is proven by the full-vs-off check on the line above,
		// which runs at the theatre's own resolution.)
		if (h6.key === ROW) {
			const hres = await p6.evaluate((h) => window[h].res, H);
			if (hres === st.res) {
				check(rbFull.sha === rb0.sha, `overlay: theatre frame-0 sha == the stock baseline sha at the same res ${hres} (layer is chrome, never pixels)`);
			} else {
				const want = rb0.bytes * (hres / st.res) ** 2;
				check(rbFull.bytes === want, `overlay: theatre renders at res ${hres} vs the row's ${st.res}, so its readback is ${rbFull.bytes} B (= baseline ${rb0.bytes} × (${hres}/${st.res})²); pixel equality at res ${hres} is the --l3 check`);
				check(rbFull.sha !== rb0.sha, `overlay: and it is genuinely a different target, not the same buffer relabelled`);
			}
		}
		check(await p6.evaluate((s) => !document.querySelector(`${s} .ovl`) || getComputedStyle(document.querySelector(`${s} .ovl`)).display === 'none', SEL), 'overlay: off = the layer is gone');

		// (2)/(3) inline geometry, full form, on a fight frame
		await p6.evaluate((h) => window[h].setOverlay('full'), H);
		await p6.evaluate((h) => window[h].seek(900), H);
		await p6.waitForFunction((h) => window[h].frame === 900, { timeout: 60000 }, H);
		await sleep(300);
		let g = await geom(SEL);
		// k is the 640-space overlay scaled onto the canvas, so it is canvas.w / 640 at ANY width. The old
		// assertion clamped it with Math.min(1, ...) because the inline picture could never exceed 640 — that
		// cap is now the `maxPicture` prop and THE THEATRE passes 700 (LIVE-TAB-V2-SPEC §1.3), so the clamp
		// would fail a correct layer. Dropping it also makes this STRICTER: above 640 the clamped form accepted
		// any k >= 1, this form pins it to the exact ratio.
		check(near(g.k, g.canvas.w / 640, 0.01), `overlay: inline k = ${g.k.toFixed(4)} = canvas ${g.canvas.w.toFixed(0)} / 640`);
		placement(g, 'inline');
		{
			// ── rev 4 typography, in the state EVERY REAL TAPE is in today ──────────────────────────────────
			// The rest of this gate runs with ?devcredit=1, which fills the `Skin by:` row and therefore only
			// ever proves the SMALL two-row layout. No shipped tape has credits (C13 is not built), so the
			// layout users actually see was untested until this block.
			const pn = await newPage(1280, 1600);
			// PIN THE BUILT-IN: this block gates the template THIS REPO SHIPS. The unpinned assertions above
			// deliberately run against the SERVER's copy, so if the deployed template is stale they fail loudly
			// there instead of here — which is the signal that a template edit was not published.
			await pn.goto(`${URL_}&devskin=none&overlay=/replay/overlay/default.json`, { waitUntil: 'load', timeout: 120000 });
			await waitEmbed(pn, H);
			await pn.evaluate((h) => window[h].setOverlay('full'), H);
			await sleep(250);
			const T = await pn.evaluate((s) => {
				const c = document.querySelector(`${s} canvas`).getBoundingClientRect();
				const k = c.width / 640;
				const r = (q) => { const b = document.querySelector(`${s} ${q}`)?.getBoundingClientRect(); return b ? { x: (b.left - c.left) / k, y: (b.top - c.top) / k, r: (b.right - c.left) / k, b: (b.bottom - c.top) / k, h: b.height / k } : null; };
				const nm = document.querySelector(`${s} .ovl .pid.p1 .nm`);
				return {
					// NOT divided by k: `.ovl` is transform:scale(k)'d as a whole, so a computed fontSize inside it
					// is already in 640x480 picture units. Dividing again reported 18px as 16.5.
					size: nm ? parseFloat(getComputedStyle(nm).fontSize) : 0,
					p1: r('.ovl .pid.p1'), p2: r('.ovl .pid.p2'),
					r2: !!document.querySelector(`${s} .ovl .pid.p1 .r2`)
				};
			}, SEL);
			log('overlay rev4 (no credits)', JSON.stringify(T));
			check(!T.r2, 'rev4: with no credits the `Skin by:` row does not render, so it reserves no space');
			check(near(T.size, 18, 0.6), `rev4: the player name is 18 px in picture units, up from 12 (got ${T.size.toFixed(1)})`);
			check(T.p1 && near(T.p1.x, 14), `rev4: P1 identity inset to x 14, up from 8 (got ${T.p1?.x.toFixed(1)})`);
			check(T.p2 && near(T.p2.r, 626), `rev4: P2 identity inset to x 626 from the right edge (got ${T.p2?.r.toFixed(1)})`);
			// the hard constraint: the game's health bars and portraits start at y 25 (SPEC §2.1)
			check(T.p1 && T.p1.b <= 24.5 && T.p2.b <= 24.5, `rev4: still clear of the health bars at y 25 (P1 bottom ${T.p1?.b.toFixed(1)}, P2 ${T.p2?.b.toFixed(1)})`);
			await pn.close();
		}
		{
			// LIVE-TAB-V2-SPEC P0 gate: a 700 px picture must climb the quality ladder rather than upscale a
			// 640-wide render — res 4 at dpr 1 (2560×1920 internal). Nothing asserted this before.
			const d = await p6.evaluate((h) => ({ res: window[h].res, taps: window[h].taps, backing: window[h].backing, info: window[h].tape ?? null }), H);
			log('display plan (theatre inline)', JSON.stringify(d));
			const want = g.canvas.w > 640 ? 4 : 2;
			check(d.res === want, `theatre: ${g.canvas.w.toFixed(0)} px picture @ dpr 1 renders at res ${d.res} (want ${want}) — the ladder, not an upscale`);
			check(!!d.info && d.info.world !== null && typeof d.info.agent === 'string' && d.info.agent !== '', `theatre: the hook exposes the tape's own info — world ${d.info?.world}, agent ${d.info?.agent} (P0: p.info is read, not ignored)`);
		}
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
		const manifestHeaders = [];
		pa.on('request', (r) => {
			if (r.url().includes('/rr/attest')) attestCalls.push(`${r.method()} ${r.url()}`);
			if (r.url().includes('art=1')) packHeaders.push(r.headers()['x-rr-owns-game'] ?? '(none)');
			if (r.url().includes('/replay/packfix/manifest.json')) manifestHeaders.push(r.headers()['x-rr-owns-game'] ?? '(none)');
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
		// A pack can list the same file twice (a shared asset: 148 entries / 146 unique URLs here). A duplicate is a
		// Cache-Storage hit — UNLESS both copies are in flight at once (6-wide concurrency), so the first load fetches
		// between the unique bytes and the full total. Both ends are correct behaviour; anything outside is not.
		const uniq = [...new Map(fixture.files.map((f) => [f.url, f])).values()];
		const uniqBytes = uniq.reduce((a, f) => a + f.bytes, 0);
		check(
			packA.networkBytes >= uniqBytes && packA.networkBytes <= fixture.total_bytes,
			`art: the first load fetched every distinct file (${packA.networkBytes} B, expected ${uniqBytes}–${fixture.total_bytes} for ${uniq.length}/${fixture.files.length} unique)`
		);
		check(attestCalls.length === 0, `open: signed out, the tick posted nothing to /rr/attest (${attestCalls.length} calls)`);
		check(packHeaders.length > 0 && packHeaders.every((h) => h === '1'), `open: X-RR-Owns-Game: 1 on every pack FILE request (${packHeaders.filter((h) => h === '1').length}/${packHeaders.length})`);
		// the server gates per route with no session for an anonymous viewer: a manifest-only header would 403 every file
		check(manifestHeaders.length > 0 && manifestHeaders.every((h) => h === '1'), `open: X-RR-Owns-Game: 1 on the MANIFEST request too (${manifestHeaders.join(',') || 'none seen'})`);
		const owns = await pa.evaluate(() => localStorage.getItem('rr.owns.v1'));
		check(!!owns && JSON.parse(owns).owns_game === true && typeof JSON.parse(owns).ts === 'number', `open: the acknowledgement is a versioned local record (${owns})`);
		check(
			reqsA.length >= uniq.length && reqsA.length <= fixture.files.length,
			`art: only the manifest's files were requested (${reqsA.length}, expected ${uniq.length}–${fixture.files.length})`
		);

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
		check(packB.networkBytes === 0 && packB.cachedFiles === fixture.files.length, `art: the second load is 100% Cache Storage — 0 network bytes, ${packB.cachedFiles}/${fixture.files.length} cached files`);
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

		// (5) AUTOPLAY ON LOAD for the LATEST TAPE hero when the art is a SERVER pack (Tris 2026-09-04).
		//     A fresh viewer must not auto-download; the tick loads and plays; every later load autoplays with no click.
		const HERO_URL = `${arg('--url', 'http://localhost:5173/match?dev=1')}&hero=${ART}&devskin=none`;
		const freshCtx = await browser.createBrowserContext(); // its own localStorage + Cache Storage = a first-time viewer
		const pf = await freshCtx.newPage();
		await pf.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 1 });
		const reqsF = packReqs(pf);
		await pf.goto(HERO_URL, { waitUntil: 'load', timeout: 120000 });
		await pf.waitForFunction(() => !!window.__rrHero, { timeout: 60000, polling: 250 });
		await sleep(4000);
		const stF = await pf.evaluate(() => window.__rrHero.state);
		check(stF === 'nopack', `autoplay: a first-time viewer's hero waits on the art panel (state ${stF})`);
		check(reqsF.length === 0, `autoplay: a first-time viewer downloads no art on load (${reqsF.length} requests)`);
		check(await pf.evaluate(() => !!document.querySelector('[data-test="hero"] .emb .ov.art .own input')), 'autoplay: the first-time hero shows the ownership checkbox');
		await pf.click('[data-test="hero"] .emb .ov.art .own input');
		await pf.click('[data-test="hero"] .emb .ov.art button');
		const stF2 = await waitEmbed(pf, '__rrHero', ['playing', 'ready', 'paused', 'error', 'nopack', 'unavailable']);
		check(stF2.state === 'playing', `autoplay: ticking the box loads the art and plays immediately (${stF2.state})`);
		check(reqsF.length > 0, `autoplay: the download started on the tick (${reqsF.length} files)`);
		await pf.close();

		// the SAME context again: acknowledged + cached → plays with no click at all
		const pg2 = await freshCtx.newPage();
		await pg2.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 1 });
		const reqsG = packReqs(pg2);
		await pg2.goto(HERO_URL, { waitUntil: 'load', timeout: 120000 });
		const stG = await waitEmbed(pg2, '__rrHero', ['playing', 'ready', 'paused', 'error', 'nopack', 'unavailable']);
		check(stG.state === 'playing', `autoplay: an acknowledged viewer's hero plays on load with NO click (${stG.state})`);
		const packG = await pg2.evaluate(() => window.__rrHero.pack);
		check(packG.networkBytes === 0 && packG.cachedFiles > 0, `autoplay: it played from Cache Storage — 0 network bytes, ${packG.cachedFiles} cached files`);
		check(reqsG.length === 0, `autoplay: no pack file hit the network on the autoplaying load (${reqsG.length} requests)`);
		const shotAuto = path.join(OUT, 'hero-autoplay.png');
		await (await pg2.$('[data-test="hero"] .emb')).screenshot({ path: shotAuto });
		log('screenshot (hero autoplaying from cache, no click)', shotAuto);
		// and it never restarts itself after the viewer pauses it
		await pg2.evaluate(() => window.__rrHero.pause());
		await sleep(2500);
		check((await pg2.evaluate(() => window.__rrHero.state)) === 'paused', 'autoplay: the hero stays paused once the viewer pauses it');
		await pg2.close();

		// reduced motion: acknowledged, cached — and still never autoplays (nor auto-downloads)
		const pr2 = await freshCtx.newPage();
		await pr2.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 1 });
		const reqsR = packReqs(pr2);
		await pr2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
		await pr2.goto(HERO_URL, { waitUntil: 'load', timeout: 120000 });
		await pr2.waitForFunction(() => !!window.__rrHero, { timeout: 60000, polling: 250 });
		await sleep(4000);
		const stR2 = await pr2.evaluate(() => window.__rrHero.state);
		check(stR2 !== 'playing', `autoplay: prefers-reduced-motion never autoplays the hero (state ${stR2})`);
		check(reqsR.length === 0, `autoplay: prefers-reduced-motion downloads no art on load (${reqsR.length} requests)`);
		await pr2.close();
		await freshCtx.close();
	}

	if (has('--limited')) {
		// ═══ LIMITED REPLAY: the marker + the update nudge on an old-client tape, and neither on a full one ═══
		const dropped = await writeLimitedTape();
		check(dropped.length === 4, `limited: the fixture dropped all four world sections (${dropped.join(', ')})`);
		const pl = await newPage();
		// pin the BUILT-IN template: the live server template predates the `limited` element, and the marker must not
		// depend on it — the chrome row below is asserted separately and is what always renders
		await pl.goto(`${URL_}&devskin=none&overlay=/replay/overlay/default.json`, { waitUntil: 'load', timeout: 120000 });
		const limSel = '[data-test="tape-row-local_stage9_limited"] button';
		await pl.waitForSelector(limSel, { timeout: 60000 });
		await pl.click(limSel);
		const stL = await waitEmbed(pl, '__rrEmbed', ['ready', 'playing', 'paused', 'error', 'nopack', 'unavailable']);
		check(stL.state !== 'error' && stL.state !== 'nopack', `limited: the old-client tape still plays (state ${stL.state})`);
		const qL = await pl.evaluate(() => window.__rrEmbed.tape);
		log('limited tape quality', JSON.stringify(qL));
		check(qL.world === false, `limited: the feed reports world:false for the stripped tape (${qL.world})`);
		check(qL.agent === '0.3.31' && qL.limited === true && qL.oldClient === true, `limited: agent ${qL.agent} → limited ${qL.limited}, oldClient ${qL.oldClient}`);
		await pl.evaluate(() => window.__rrEmbed.setOverlay('full'));
		await sleep(300);
		const uiL = await pl.evaluate(() => {
			const s = '[data-hook="rrEmbed"]';
			const t = (q) => (document.querySelector(`${s} ${q}`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
			return {
				chrome: t('.metarow .limited'),
				chromeTitle: document.querySelector(`${s} .metarow .limited`)?.getAttribute('title') ?? '',
				marker: t('.ovl .stamp .limited'),
				markerTitle: document.querySelector(`${s} .ovl .stamp .limited`)?.getAttribute('title') ?? '',
				nudge: t('[data-test="update-nudge"] .nl'),
				href: document.querySelector(`${s} [data-test="update-nudge"] .nb`)?.getAttribute('href') ?? '',
				stage: t('.ovl .stamp .stage')
			};
		});
		log('limited UI', JSON.stringify(uiL));
		check(uiL.chrome === 'LIMITED · older client', `limited: the chrome's record row carries the marker ("${uiL.chrome}")`);
		check(/recorded before the client captured the stage and HUD/i.test(uiL.chromeTitle), 'limited: the marker explains itself on hover');
		check(uiL.marker === 'LIMITED · older client', `limited: the built-in overlay template carries the same marker ("${uiL.marker}")`);
		check(uiL.stage === '', `limited: no stage line invented for a tape with no stage id ("${uiL.stage}")`);
		check(/Is this your match\? Update Retro Receipts to record full-quality replays\./.test(uiL.nudge), `limited: the update nudge is present ("${uiL.nudge}")`);
		check(/^https:\/\/.+/.test(uiL.href), `limited: the nudge links at the manifest-resolved agent URL (${uiL.href})`);
		const shotL = path.join(OUT, 'limited-replay.png');
		await (await pl.$('[data-hook="rrEmbed"]')).screenshot({ path: shotL });
		log('screenshot (limited replay: marker + nudge)', shotL);
		await pl.close();

		// the FULL tape in the same build: neither marker nor nudge
		const pfull = await newPage();
		await pfull.goto(`${URL_}&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		await pfull.waitForSelector(rowSel, { timeout: 60000 });
		await pfull.click(rowSel);
		await waitEmbed(pfull, '__rrEmbed');
		const qF = await pfull.evaluate(() => window.__rrEmbed.tape);
		await pfull.evaluate(() => window.__rrEmbed.setOverlay('full'));
		await sleep(300);
		const uiF = await pfull.evaluate(() => ({
			chrome: !!document.querySelector('[data-hook="rrEmbed"] .metarow .limited'),
			marker: !!document.querySelector('[data-hook="rrEmbed"] .ovl .stamp .limited'),
			nudge: !!document.querySelector('[data-hook="rrEmbed"] [data-test="update-nudge"]')
		}));
		log('full tape quality', JSON.stringify(qF), JSON.stringify(uiF));
		check(qF.world === true && qF.limited === false, `limited: a full tape reports world:true (agent ${qF.agent})`);
		check(!uiF.chrome && !uiF.marker && !uiF.nudge, 'limited: a full-quality replay shows neither the marker nor the nudge');
		await pfull.close();
	}

	if (has('--health')) {
		// ═══ the watchdog: transient slowness must not leave playback at half speed ═══
		const ph = await newPage();
		await ph.goto(`${URL_}&devskin=none`, { waitUntil: 'load', timeout: 120000 });
		await ph.waitForSelector(rowSel, { timeout: 60000 });
		await ph.click(rowSel);
		await waitEmbed(ph, '__rrEmbed');
		await ph.evaluate(() => window.__rrEmbed.play());
		await sleep(1500);
		const h0 = await ph.evaluate(() => window.__rrEmbed.health);
		log('health (steady)', JSON.stringify(h0));
		check(h0.speed === 60 && h0.halfAuto === false, `health: a healthy run stays at 60 (speed ${h0.speed}, halfAuto ${h0.halfAuto})`);
		check(h0.intervalMs > 0 && h0.intervalMs < h0.avgMs + 50, `health: the watchdog measures a per-second cost (${h0.intervalMs.toFixed(1)} ms) alongside the lifetime average (${h0.avgMs.toFixed(1)} ms)`);

		// force a transient slow period: 3 samples at 40 ms/frame → the drop
		check(await ph.evaluate(() => window.__rrEmbed.devSlow(40, 3)), 'health: the dev slow-injection hook is available');
		await ph.waitForFunction(() => window.__rrEmbed.health.halfAuto === true, { timeout: 20000, polling: 250 });
		const h1 = await ph.evaluate(() => window.__rrEmbed.health);
		check(h1.speed === 30 && h1.halfAuto === true, `health: sustained slowness drops to half speed (speed ${h1.speed})`);
		const note = await ph.evaluate(() => (document.querySelector('[data-hook="rrEmbed"] .note')?.textContent ?? '').trim());
		check(/half speed/.test(note), `health: the UI says it is throttled ("${note}")`);
		check(await ph.evaluate(() => document.querySelector('[data-hook="rrEmbed"] .spd')?.value === '30'), 'health: the speed control reads ½×, not 1×');

		// throughput recovers → back to 60 within the hysteresis window, no click. The fast period is injected so the
		// gate proves the LOGIC on any machine; the thresholds themselves are set from the measured 13–16.9 ms range.
		await ph.evaluate(() => window.__rrEmbed.devSlow(5, 6));
		await ph.waitForFunction(() => window.__rrEmbed.health.halfAuto === false, { timeout: 30000, polling: 250 });
		const h2 = await ph.evaluate(() => window.__rrEmbed.health);
		check(h2.speed === 60 && h2.halfAuto === false, `health: it RECOVERS to 60 once throughput comes back (speed ${h2.speed}, ${h2.intervalMs.toFixed(1)} ms/frame)`);
		check(await ph.evaluate(() => !document.querySelector('[data-hook="rrEmbed"] .note')?.textContent.includes('half speed')), 'health: the half-speed note disappears on recovery');

		// a manual choice is never overridden
		await ph.select('[data-hook="rrEmbed"] .spd', '30');
		await ph.evaluate(() => window.__rrEmbed.devSlow(2, 6));
		await sleep(4500);
		const h3 = await ph.evaluate(() => window.__rrEmbed.health);
		check(h3.speed === 30 && h3.userSpeed === true && h3.halfAuto === false, `health: a manual ½× is never overridden by the watchdog (speed ${h3.speed}, userSpeed ${h3.userSpeed})`);
		await ph.close();
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
	// The theatre pinned to a LOCAL dev tape has no session_id, so it legitimately shows no share link — there
	// is no set receipt to point at. To test SHARE we must first put a REAL feed row in the theatre, which is
	// also the realistic path: open BROWSE, pick a match, share what you are watching.
	const putRealMatchInTheatre = async (pg) => {
		await pg.waitForSelector('[data-test="hero"]', { timeout: 60000 });
		await pg.keyboard.press('KeyB');
		await pg.waitForFunction(() => document.querySelectorAll('[role="dialog"] .brow .mb').length > 0, { timeout: 60000 });
		await pg.evaluate(() => document.querySelector('[role="dialog"] .brow .mb').click());
		await pg.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Browse matches"]'), { timeout: 30000 });
		await pg.waitForFunction(() => [...document.querySelectorAll('[data-test="hero"] .acts .a')].some((b) => /Copy link/.test(b.textContent || '')), { timeout: 60000 });
	};

	// ═══ PLAYBACK CADENCE (the judder fix) ═══════════════════════════════════════════════════════════════
	// Drives the REAL Pacer from a SYNTHETIC refresh clock, so all four rates are covered without four physical
	// panels. The requirement being gated: refresh rate may change how many TIMES a frame is shown; it may never
	// change how fast the match plays. The second assertion below is the one that catches a 120 Hz
	// double-speed regression.
	if (has('--pacer')) {
		const pp = await newPage(1280, 900);
		await pp.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await pp.waitForFunction(() => !!window.__rrPacer, { timeout: 60000 });
		const R = await pp.evaluate(() => {
			const Pacer = window.__rrPacer;
			// PHYSICAL refresh model: timestamp i is i*T plus BOUNDED error. A panel does not random-walk away
			// from real time, and modelling it as if it did flatters the old algorithm.
			const train = (hz, n, jit, seed = 999) => {
				let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
				const T = 1000 / hz; const out = []; let prev = -1;
				for (let i = 0; i < n; i++) { const t = i * T + (rnd() - 0.5) * 2 * jit; if (t > prev) { out.push(t); prev = t; } }
				return out;
			};
			const run = (hz, speed) => {
				const ts = train(hz, 1400, 0.5);
				const p = new Pacer(ts[0], speed);
				const adv = [];
				for (let i = 1; i < ts.length; i++) adv.push(p.tick(ts[i], speed));
				const w = adv.slice(250);
				const shown = w.reduce((a, b) => a + b, 0);
				const secs = (ts[ts.length - 1] - ts[250]) / 1000;
				let beats = 0;
				for (let i = 1; i < w.length; i++) if ((w[i - 1] === 0 && w[i] === 2) || (w[i - 1] === 2 && w[i] === 0)) beats++;
				// hold lengths: how many refreshes each source frame was displayed for
				const holds = []; let run_ = 0;
				for (const a of w) { if (a === 0) run_++; else { for (let k = 0; k < a; k++) { holds.push(run_ + 1); run_ = 0; } } }
				const distinct = [...new Set(holds.slice(5, -5))].sort((a, b) => a - b);
				return { hz, speed, fps: shown / secs, beats, distinct, seq: w.slice(0, 40).join('') };
			};
			return {
				r60: run(60, 60), r90: run(90, 60), r120: run(120, 60), r144: run(144, 60), r240: run(240, 60),
				half120: run(120, 30), dbl60: run(60, 120)
			};
		});
		for (const k of Object.keys(R)) log(`pacer ${k}`, JSON.stringify(R[k]));

		for (const [k, want] of [['r60', 60], ['r90', 60], ['r120', 60], ['r144', 60], ['r240', 60], ['half120', 30], ['dbl60', 120]]) {
			const r = R[k];
			// (a) SPEED is unchanged by refresh rate — the 120 Hz double-speed regression dies here
			check(Math.abs(r.fps / want - 1) < 0.01, `pacer ${r.hz}Hz @ speed ${r.speed}: plays at ${r.fps.toFixed(3)} fps (want ${want}, within 1%)`);
			// (b) the cadence is a STABLE pattern, never the noise-driven repeat/skip beat
			check(r.beats === 0, `pacer ${r.hz}Hz @ speed ${r.speed}: no 0/2 repeat-then-skip beat (${r.beats})`);
			// (c) at most two distinct hold lengths — one for an integer ratio, two for a Bresenham pattern
			check(r.distinct.length <= 2, `pacer ${r.hz}Hz @ speed ${r.speed}: hold lengths are ${JSON.stringify(r.distinct)} (<= 2 distinct = a fixed pattern)`);
		}
		// the integer ratios must be PERFECTLY uniform, not merely patterned
		check(R.r60.distinct.length === 1 && R.r60.distinct[0] === 1, `pacer 60Hz: exactly one refresh per source frame, uniformly (${JSON.stringify(R.r60.distinct)})`);
		check(R.r120.distinct.length === 1 && R.r120.distinct[0] === 2, `pacer 120Hz: every frame held exactly 2 refreshes (${JSON.stringify(R.r120.distinct)})`);
		check(R.r240.distinct.length === 1 && R.r240.distinct[0] === 4, `pacer 240Hz: every frame held exactly 4 refreshes (${JSON.stringify(R.r240.distinct)})`);
		await pp.close();
	}

	// ═══ 💬 ANCHORED COMMENTS (LIVE-TAB-V2-SPEC §4, P5) ══════════════════════════════════════════════════
	// Signed out on purpose. Posting, the rate limits, the participants-only hide and auto-hide at three
	// reporters are ENFORCED AND SMOKE-VERIFIED SERVER-SIDE, so re-asserting them here would only prove the
	// client can duplicate a rule it must not duplicate. What is client-owned and gated here: the wall seeds
	// from the endpoint, a signed-out visitor reads everything and is prompted in place, the C20 deltas are
	// APPLIED (a hide the consumer ignores renders a comment the server hid), and the anchors become ticks.
	if (has('--comments')) {
		const pc2 = await newPage(1400, 1600);
		await pc2.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await waitEmbed(pc2, '__rrHero', ['playing', 'ready', 'paused', 'closed', 'nopack']);
		await pc2.waitForFunction(() => !!window.__rrComments, { timeout: 60000 });
		await pc2.waitForSelector('[data-test="comments"]', { timeout: 30000 });
		check(true, 'comments: the wall renders beside the theatre');

		// (1) signed out: reads everything, prompted IN PLACE - no modal, no interstitial
		const out = await pc2.evaluate(() => ({
			prompt: /Sign in with Steam to comment/.test(document.querySelector('[data-test="comments"]')?.textContent ?? ''),
			steamBtn: !!document.querySelector('[data-test="comments"] .steam'),
			composer: !!document.querySelector('[data-test="comments"] textarea'),
			token: !!localStorage.getItem('rr_token')
		}));
		log('comments: signed out', JSON.stringify(out));
		check(!out.token, 'comments: the run is genuinely signed out');
		check(out.prompt && out.steamBtn, 'comments: a signed-out visitor gets the in-place Steam prompt');
		check(!out.composer, 'comments: and no composer it could not use');

		// (2) the C20 deltas, driven through the REAL store method the bus calls
		const d = await pc2.evaluate(async () => {
			const C = window.__rrComments;
			const key = C.key;
			const mk = (id, frame, ts) => ({ type: 'comment', id, key, session_id: '', frame, author: 'A' + id, name: 'Tester', avatar: '', rating: 1200, games: 40, text: 'mark ' + id, ts, hidden: false, hidden_reason: '' });
			C.applyDelta(mk('c1', 1000, 1000));
			C.applyDelta(mk('c2', 1010, 1001));
			C.applyDelta(mk('c3', 3000, 1002));
			const afterAdd = { rows: C.rows.length, total: C.total };
			C.applyDelta(mk('c1', 1000, 1000));
			const afterDupe = C.rows.length;
			C.applyDelta({ type: 'comment_hide', id: 'c3', key, author: 'Ac3', hidden: true, ts: 1003 });
			const afterHide = { rows: C.rows.length, hiddenCount: C.hiddenCount, stillThere: C.rows.some((r) => r.id === 'c3') };
			C.applyDelta({ type: 'comment_del', id: 'c2', key, author: 'Ac2', hidden: false, ts: 1004 });
			const afterDel = { rows: C.rows.length, stillThere: C.rows.some((r) => r.id === 'c2') };
			C.applyDelta({ ...mk('other2', 500, 1006), key: 'some-other-match' });
			return { key, afterAdd, afterDupe, afterHide, afterDel, final: C.rows.length };
		});
		log('comments: deltas', JSON.stringify(d));
		check(d.afterAdd.rows === 3 && d.afterAdd.total === 3, `comments: three new-comment deltas insert three rows (${d.afterAdd.rows})`);
		check(d.afterDupe === 3, 'comments: a repeated id does not double up (the 500-entry window replays)');
		check(!d.afterHide.stillThere && d.afterHide.rows === 2, 'comments: a comment_hide REMOVES the row - ignoring these renders comments the server hid');
		check(d.afterHide.hiddenCount === 1, `comments: and it is counted for everyone (${d.afterHide.hiddenCount})`);
		check(!d.afterDel.stillThere && d.afterDel.rows === 1, 'comments: a comment_del removes the row');
		check(d.final === 1, `comments: a delta for another match is ignored (${d.final} rows, want 1)`);

		// (3) the footer count, and the anchors as TICKS on the bar - never on the picture
		await sleep(400);
		const ui = await pc2.evaluate(() => {
			const w = document.querySelector('[data-test="comments"]');
			return {
				foot: (w?.querySelector('.foot')?.textContent ?? '').trim(),
				onPicture: document.querySelectorAll('[data-test="hero"] .pic .tick').length,
				ticks: document.querySelectorAll('[data-test="hero"] .scrubw .tick').length
			};
		});
		log('comments: ui', JSON.stringify(ui));
		check(/1 comment hidden by the players/.test(ui.foot), `comments: the footer counts what was hidden ("${ui.foot}")`);
		check(ui.onPicture === 0, 'comments: ticks live on the BAR, never on the 640x480 picture');

		// clustering: two anchors a few frames apart are ~1 px apart on the track and MUST merge
		const cl = await pc2.evaluate(async () => {
			const C = window.__rrComments;
			C.applyDelta({ type: 'comment', id: 'n1', key: C.key, session_id: '', frame: 1005, author: 'An1', name: 'N', avatar: '', rating: 1200, games: 40, text: 'near', ts: 1100, hidden: false, hidden_reason: '' });
			await new Promise((r) => setTimeout(r, 400));
			const ticks = [...document.querySelectorAll('[data-test="hero"] .scrubw .tick')];
			return { count: ticks.length, labels: ticks.map((t) => t.getAttribute('title')), many: ticks.filter((t) => t.classList.contains('many')).map((t) => t.textContent.trim()) };
		});
		log('comments: clustering', JSON.stringify(cl));
		check(cl.count === 1 && cl.many.length === 1 && cl.many[0] === '2', `comments: two anchors 5 frames apart MERGE into one tick reading 2 (${JSON.stringify(cl)})`);
		check(/2 comments from/.test(cl.labels[0] ?? ''), `comments: and the cluster says how many (${cl.labels[0]})`);

		// (4) clicking a tick seeks the picture and pauses it
		const st0 = await pc2.evaluate(() => window.__rrHero.state);
		if (st0 !== 'closed' && st0 !== 'nopack' && st0 !== 'unavailable' && st0 !== 'error') {
			await pc2.evaluate(() => document.querySelector('[data-test="hero"] .scrubw .tick').click());
			await pc2.waitForFunction(() => window.__rrHero.state === 'paused', { timeout: 30000 }).catch(() => {});
			await sleep(1200);
			const j = await pc2.evaluate(() => ({ frame: window.__rrHero.frame, state: window.__rrHero.state }));
			log('comments: tick jump', JSON.stringify(j));
			check(Math.abs(j.frame - 1000) <= 12, `comments: the tick seeks to its own frame (${j.frame}, want ~1000)`);
			check(j.state === 'paused', `comments: and PAUSES - you clicked to look at something (${j.state})`);
		} else {
			log(`comments: picture is ${st0}; the tick-jump assertions need a playing tape and are skipped`);
		}
		await pc2.close();
	}

	// ═══ ↗ SHARE (LIVE-TAB-V2-SPEC §5, P4 gate) ══════════════════════════════════════════════════════════
	// The OS-sheet half of P4 ("on a real Android phone and a real iPhone the sheet opens and Discord receives
	// the link") CANNOT be asserted headlessly — there is no sheet and no Discord here. What is asserted:
	// the control appears ONLY where navigator.share exists, it is called with the right url/text, the copied
	// link carries ?m=, and a REFUSED clipboard still leaves the URL selectable instead of a dead button.
	if (has('--share')) {
		// (a) desktop: no navigator.share → no ↗ Share control, and copy still works
		const pd = await newPage(1280, 1600);
		await pd.evaluateOnNewDocument(() => {
			try { delete Navigator.prototype.share; } catch { /* already absent */ }
			window.__copied = null;
			navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); };
		});
		await pd.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await putRealMatchInTheatre(pd);
		const hasShareBtn = await pd.evaluate(() => [...document.querySelectorAll('[data-test="hero"] .acts .a')].some((b) => /Share/.test(b.textContent || '')));
		check(!hasShareBtn, 'share: on a browser with no navigator.share the ↗ Share control is ABSENT');
		const copyRes = await pd.evaluate(async () => {
			const b = [...document.querySelectorAll('[data-test="hero"] .acts .a')].find((x) => /Copy link/.test(x.textContent || ''));
			if (!b) return { ok: false, why: 'no copy button' };
			b.click();
			await new Promise((r) => setTimeout(r, 300));
			return { ok: true, copied: window.__copied, label: b.textContent.trim(), fallback: !!document.querySelector('[data-test="hero"] .cfb') };
		});
		log('share: desktop copy', JSON.stringify(copyRes));
		check(copyRes.ok && /^https:\/\/nobd\.net\/(s\/[0-9a-f]+|app\/r\/set\/)/.test(copyRes.copied ?? ''), `share: copy writes the short link (${copyRes.copied})`);
		check(/m=/.test(copyRes.copied ?? ''), `share: the copied link carries ?m= so the recipient lands on THIS game (${copyRes.copied})`);
		check(/Copied/.test(copyRes.label ?? ''), 'share: the button confirms with "Copied"');
		check(!copyRes.fallback, 'share: a SUCCESSFUL copy does not reveal the manual-select fallback');
		await pd.close();

		// (b) a browser that HAS a share sheet → the control appears and is called with the right payload
		const ps = await newPage(1280, 1600);
		await ps.evaluateOnNewDocument(() => {
			window.__shared = null;
			Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared = d; return Promise.resolve(); } });
		});
		await ps.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await putRealMatchInTheatre(ps);
		const shared = await ps.evaluate(async () => {
			const b = [...document.querySelectorAll('[data-test="hero"] .acts .a')].find((x) => /Share/.test(x.textContent || ''));
			if (!b) return null;
			b.click();
			await new Promise((r) => setTimeout(r, 300));
			return window.__shared;
		});
		log('share: navigator.share payload', JSON.stringify(shared));
		check(!!shared, 'share: where navigator.share EXISTS the ↗ Share control is rendered and calls it');
		check(!!shared && /m=/.test(shared.url || ''), `share: the shared url carries ?m= (${shared?.url})`);
		check(!!shared && typeof shared.text === 'string' && shared.text.length > 0, `share: a share TEXT is composed client-side (${shared?.text})`);
		await ps.close();

		// (c) the clipboard REFUSES → the URL is still selectable. Five of the six old copy sites did nothing here.
		const pc = await newPage(1280, 1600);
		await pc.evaluateOnNewDocument(() => {
			navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
			document.execCommand = () => false; // defeat the legacy fallback too, so this really is the failure path
		});
		await pc.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await putRealMatchInTheatre(pc);
		const fb = await pc.evaluate(async () => {
			const b = [...document.querySelectorAll('[data-test="hero"] .acts .a')].find((x) => /Copy link/.test(x.textContent || ''));
			b.click();
			await new Promise((r) => setTimeout(r, 300));
			const i = document.querySelector('[data-test="hero"] .cfb');
			return { present: !!i, value: i?.value ?? '', readonly: i?.hasAttribute('readonly'), label: b.textContent.trim() };
		});
		log('share: clipboard denied', JSON.stringify(fb));
		check(fb.present && fb.readonly, 'share: a DENIED clipboard reveals a readonly, selectable URL instead of doing nothing');
		check(/^https:\/\/nobd\.net\//.test(fb.value) && /m=/.test(fb.value), `share: the revealed URL is the real share link (${fb.value})`);
		check(!/Copied/.test(fb.label), 'share: and it does NOT claim "Copied" when nothing was copied');
		await pc.close();
	}

	// ═══ ⌕ BROWSE MATCHES (LIVE-TAB-V2-SPEC §3, P3 gate) ═════════════════════════════════════════════════
	if (has('--browse')) {
		const pb = await newPage(1280, 1600);
		await pb.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await waitEmbed(pb, '__rrHero', ['playing', 'ready', 'closed', 'nopack', 'unavailable', 'error']);
		const navsBefore = await pb.evaluate(() => performance.getEntriesByType('navigation').length);

		// `B` opens it — the keyboard route, not just the button
		await pb.keyboard.press('KeyB');
		await pb.waitForSelector('[role="dialog"][aria-label="Browse matches"]', { timeout: 30000 });
		check(true, 'browse: `B` opens the popup');
		check(
			await pb.evaluate(() => {
				const d = document.querySelector('[role="dialog"][aria-label="Browse matches"]');
				return d?.getAttribute('aria-modal') === 'true';
			}),
			'browse: role=dialog aria-modal=true labelled "Browse matches"'
		);
		await pb.waitForFunction(() => document.querySelectorAll('[role="dialog"] .brow').length > 0, { timeout: 60000 });
		const n0 = await pb.evaluate(() => document.querySelectorAll('[role="dialog"] .brow').length);
		check(n0 > 0 && n0 <= 10, `browse: the newest 100 is paged 10 at a time (page shows ${n0})`);

		// the scope tabs and the free client-side filter
		const filt = await pb.evaluate(async () => {
			const total = () => Number(/of (\d+)/.exec(document.querySelector('[role="dialog"] .pager .cnt')?.textContent || '')?.[1] ?? 0);
			const before = total();
			document.querySelector('[role="dialog"] .only input').click();
			await new Promise((r) => setTimeout(r, 250));
			const rows = [...document.querySelectorAll('[role="dialog"] .brow')];
			return { before, after: total(), everyReplayable: rows.length > 0 && rows.every((r) => /REPLAY/.test(r.textContent || '')) };
		});
		log('browse: replayable-only', JSON.stringify(filt));
		check(filt.everyReplayable, 'browse: "Replayable only" leaves ONLY rows that show ▶ REPLAY');
		// the filter must actually REMOVE something, or it is not being exercised: the live feed carries both
		// ready and none rows (measured 54/46 on prod), so a no-op here means the filter is not wired.
		check(filt.after > 0 && filt.after < filt.before, `browse: the filter genuinely narrows the list (${filt.before} → ${filt.after})`);
		await pb.evaluate(() => document.querySelector('[role="dialog"] .only input').click());
		await sleep(200);

		// ↑/↓ move the row cursor and take focus with it; Enter picks
		await pb.keyboard.press('ArrowDown');
		await sleep(150);
		const onRow = await pb.evaluate(() => !!document.activeElement?.closest('.brow'));
		check(onRow, 'browse: ↓ moves the row cursor and focus lands on a row');

		const before = await pb.evaluate(() => window.__rrHero?.key ?? '');
		await pb.keyboard.press('Enter');
		await pb.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Browse matches"]'), { timeout: 30000 });
		check(true, 'browse: Enter picks the row and closes the popup');
		await sleep(600);
		const after = await pb.evaluate(() => ({ key: window.__rrHero?.key ?? '', m: new URL(location.href).searchParams.get('m'), navs: performance.getEntriesByType('navigation').length }));
		log('browse: pick', JSON.stringify({ before, after }));
		check(after.key !== before, `browse: picking a row SWAPPED the theatre (${before} → ${after.key})`);
		check(!!after.m && after.m === after.key, `browse: the pick is recorded in ?m=${after.m}`);
		check(after.navs === navsBefore, `browse: the swap is a content change, NOT a navigation (${after.navs} navigation entries, was ${navsBefore})`);

		// Esc closes, and the end-of-list line tells the truth about how many there are
		await pb.keyboard.press('KeyB');
		await pb.waitForSelector('[role="dialog"][aria-label="Browse matches"]', { timeout: 30000 });
		await pb.waitForFunction(() => document.querySelectorAll('[role="dialog"] .brow').length > 0, { timeout: 60000 });
		const endTxt = await pb.evaluate(async () => {
			const d = document.querySelector('[role="dialog"]');
			let guard = 0;
			while (guard++ < 30) {
				const next = [...d.querySelectorAll('.pager .pg')].find((b) => /Next/.test(b.textContent));
				if (!next || next.disabled) break;
				next.click();
				await new Promise((r) => setTimeout(r, 120));
			}
			return { end: d.querySelector('.end')?.textContent?.trim() ?? '', rows: d.querySelector('.pager .cnt')?.textContent ?? '' };
		});
		log('browse: last page', JSON.stringify(endTxt));
		check(/^That's (the newest 100|all \d+ of them)\.$/.test(endTxt.end), `browse: the last page says where the list ends, truthfully ("${endTxt.end}")`);
		await pb.keyboard.press('Escape');
		await pb.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Browse matches"]'), { timeout: 30000 });
		check(true, 'browse: Esc closes the popup');
		await pb.close();
	}

	// ═══ ★ MATCH OF THE DAY (LIVE-TAB-V2-SPEC §1.6, P1b gate) ═══════════════════════════════════════════
	// Drives the REAL scorer out of the REAL bundle via window.__rrMotd (dev-only hook in motd.svelte.ts).
	// A re-implementation here would be free to agree with itself while disagreeing with the page.
	if (has('--motd')) {
		const pm = await newPage(1280, 1600);
		await pm.goto(URL_, { waitUntil: 'load', timeout: 120000 });
		await pm.waitForFunction(() => !!window.__rrMotd, { timeout: 60000 });

		const R = await pm.evaluate(() => {
			const M = window.__rrMotd;
			const noon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
			const row = (i, o) => ({
				key: `k${i}`, match_key: `k${i}`, winner: 'W', loser: 'L',
				winner_name: `W${i}`, loser_name: `L${i}`, verified: false,
				ts: noon - i * 60000, mode: 'ranked', replay: { state: 'ready' }, ...o
			});
			// a hand-computable set. Expected scores from the §1.6 weights:
			//   a: comeback 40 + combo48 30 + elo22 25            = 95   (3 reasons, in that order)
			//   b: ocv 35 + perfect 25 + both>=1200 20 + verified 10 = 90
			//   c: money 15 + elo13 12                             = 27
			const a = row(1, { comeback: true, combo: 48, elo: 22 });
			const b = row(2, { ocv: true, perfect: true, winner_rating: 1300, loser_rating: 1250, verified: true });
			const c = row(3, { mode: 'money', elo: 13 });
			const filler = [4, 5, 6].map((i) => row(i, {}));            // score 0 each
            const yesterday = row(9, { comeback: true, ts: noon - 36 * 3600 * 1000 });
			const unplayable = row(8, { comeback: true, ocv: true, replay: { state: 'pending' } });

			const six = [a, b, c, ...filler];
			const p1 = M.pickMatchOfTheDay(six, noon);
			const p2 = M.pickMatchOfTheDay(six.slice(), noon);         // reproducibility: same rows again
			const five = [a, b, c, filler[0], filler[1]];
			return {
				sa: M.scoreMatch(a), sb: M.scoreMatch(b), sc: M.scoreMatch(c),
				p1: { key: p1.pick?.key, score: p1.pick?.score, reasons: p1.pick?.reasons, pool: p1.pool, crowned: p1.crowned },
				p2key: p2.pick?.key,
				five: { key: M.pickMatchOfTheDay(five, noon).pick?.key, pool: M.pickMatchOfTheDay(five, noon).pool, crowned: M.pickMatchOfTheDay(five, noon).crowned },
				none: M.pickMatchOfTheDay([unplayable, yesterday], noon),
				// row(i).ts = noon - i minutes, so the SMALLER index is the NEWER match. Two identical scores,
				// listed oldest-first, must resolve to k10.
				tie: M.pickMatchOfTheDay([row(20, { comeback: true }), row(10, { comeback: true })], noon).pick?.key,
				shout: M.shoutText(p1.pick),
				limits: { pool: M.MIN_POOL, score: M.MIN_SCORE }
			};
		});
		log('motd', JSON.stringify(R));

		// hand-computed scores agree with the implementation, to the point
		check(R.sa.score === 95, `motd: comeback+48combo+22elo scores 95 (got ${R.sa.score})`);
		check(R.sb.score === 90, `motd: ocv+perfect+bothRated+verified scores 90 (got ${R.sb.score})`);
		check(R.sc.score === 27, `motd: money+13elo scores 27 (got ${R.sc.score})`);
		// reasons are in score order, max three, and name only EVENTS (never "verified"/"both rated")
		check(JSON.stringify(R.sa.reasons) === JSON.stringify(['comeback', '48-hit combo', '+22 rating']), `motd: reasons in score order (${R.sa.reasons.join(' · ')})`);
		check(R.sb.reasons.length === 2 && !R.sb.reasons.some((x) => /verified|rated/i.test(x)), `motd: context signals score but are never named (${R.sb.reasons.join(' · ')})`);
		// pure + reproducible
		check(R.p1.key === 'k1' && R.p2key === 'k1', `motd: the same rows give the same match_key twice (${R.p1.key} / ${R.p2key})`);
		check(R.tie === 'k10', `motd: a tie goes to the NEWER match — k10 is 10 min old, k20 is 20 (got ${R.tie})`);
		// the crown is earned
		check(R.limits.pool === 6 && R.limits.score === 60, `motd: thresholds are ${R.limits.pool} replayable / score ${R.limits.score} (Tris Q8: unchanged)`);
		check(R.p1.pool === 6 && R.p1.crowned === true, `motd: 6 replayable and a top score of ${R.p1.score} earns the crown`);
		check(R.five.pool === 5 && R.five.crowned === false && R.five.key === 'k1', 'motd: a seeded day of FIVE replayable matches still picks the best one but is NOT crowned (▶ TODAY, no superlative)');
		// nothing replayable today → no pick at all, so the page falls through to today's ▶ LATEST TAPE path
		check(R.none.pick === null && R.none.pool === 0 && R.none.crowned === false, 'motd: a pending tape and a yesterday match leave NO pick — the ▶ LATEST TAPE path is untouched');
		// the share text carries the shout-out the cached OG image cannot
		check(/^Match of the day: W1 over L1 — comeback, 48-hit combo, \+22 rating\.$/.test(R.shout), `motd: share text (${R.shout})`);

		// ── INTEGRATION: the crown must actually REACH THE MARQUEE ────────────────────────────────────────
		// The checks above only prove the scorer. They passed while the crown never appeared on the page, twice:
		// once because `pickTheatre` read `motd.pick` after an `await` (invisible to the effect's dependency
		// tracking), and once because it looked the crown up in the current scope's newest 20 rows, where the
		// day's best match usually is not. Both were caught by loading the real page, so the gate now does that.
		// Loaded WITHOUT the `?hero=` dev pin, which deliberately bypasses the crown to keep other runs
		// deterministic.
		const pi = await newPage(1280, 1600);
		await pi.goto(`${arg('--url', 'http://localhost:5173/match?dev=1')}`, { waitUntil: 'load', timeout: 120000 });
		await pi.waitForFunction(() => window.__rrMotd?.store?.settled === true, { timeout: 60000 });
		await sleep(2500);
		const I = await pi.evaluate(() => {
			const st = window.__rrMotd.store;
			return {
				crowned: st.crowned,
				pool: st.pool,
				pickKey: st.pick?.key ?? null,
				reasons: [...(st.pick?.reasons ?? [])], // a $state proxy serialises as an OBJECT, not an array
				label: (document.querySelector('[data-test="hero"] .shead')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
				theatreKey: window.__rrHero?.key ?? null,
				offerShown: !!document.querySelector('[data-test="hero"] .crown'),
				// "the most recent replayable match" is asserted as a PROPERTY, not by matching an exact key.
				// The theatre picks from the tab's mode-scoped rows while this store holds the un-scoped newest
				// 100, so comparing keys directly would fail whenever the newest ready match sits in another
				// mode — a wrong assertion, not a caught bug. Instead: find the row the theatre is showing, and
				// check no row in ITS OWN mode is both ready and newer.
				theatre: (() => {
					const k = window.__rrHero?.key;
					const row = st.rows.find((r) => (r.match_key ?? r.key) === k);
					if (!row) return { found: false };
					const newer = st.rows.filter((r) => (r.mode ?? 'ranked') === (row.mode ?? 'ranked') && r.replay?.state === 'ready' && r.ts > row.ts);
					return { found: true, ready: row.replay?.state === 'ready', mode: row.mode ?? 'ranked', newerReadyInMode: newer.length };
				})()
			};
		});
		log('motd integration', JSON.stringify(I));
		// ⚠ REWRITTEN 2026-09-04 (Tris): the crown is NO LONGER the default pick. This block used to assert the
		// opposite — that the theatre opens ON the crown — so it is rewritten rather than deleted, because the
		// behaviour it guards genuinely reversed and a deleted assertion guards nothing.
		//
		// (1) the theatre opens on the NEWEST replayable row, not the day's best one
		if (I.theatre.found) {
			check(I.theatre.ready, `motd: the theatre opened on a REPLAYABLE match (${I.theatreKey})`);
			check(I.theatre.newerReadyInMode === 0, `motd: and it is the MOST RECENT one in its scope — ${I.theatre.newerReadyInMode} newer ready ${I.theatre.mode} matches exist (want 0)`);
		} else {
			check(false, `motd: could not locate the theatre's row (${I.theatreKey}) in the newest 100 — cannot verify the default pick`);
		}
		if (I.crowned && I.pickKey && I.pickKey !== I.newestReplayable) {
			check(I.theatreKey !== I.pickKey, 'motd: on a crowned day the crown is deliberately NOT what plays on load');
		}
		// (2) the crown is reachable in ONE tap and swaps the theatre with no navigation
		if (I.crowned) {
			check(I.offerShown, 'motd: a crowned day offers ★ MATCH OF THE DAY in the marquee');
			const navsBefore = await pi.evaluate(() => performance.getEntriesByType('navigation').length);
			await pi.evaluate(() => document.querySelector('[data-test="hero"] .crown').click());
			await pi.waitForFunction((k) => window.__rrHero?.key === k, { timeout: 60000 }, I.pickKey).catch(() => {});
			const after = await pi.evaluate(() => ({ key: window.__rrHero?.key ?? '', label: (document.querySelector('[data-test="hero"] .shead')?.textContent ?? '').replace(/\s+/g, ' ').trim(), navs: performance.getEntriesByType('navigation').length, offer: !!document.querySelector('[data-test="hero"] .crown') }));
			log('motd: crown tapped', JSON.stringify(after));
			check(after.key === I.pickKey, `motd: tapping the crown swaps the theatre to it (${after.key})`);
			check(after.navs === navsBefore, `motd: and it is a content swap, NOT a navigation (${after.navs} entries)`);
			check(after.label.includes('Match of the Day'), `motd: the marquee then reads the earned label ("${after.label.slice(0, 70)}")`);
			check(!after.offer, 'motd: the offer hides once the theatre is already showing it — never a control that does nothing');
			for (const why of I.reasons) check(after.label.includes(why), `motd: the shout-out names "${why}"`);
		} else {
			// (3) a day that has not earned a crown shows NO affordance rather than a hollow one
			check(!I.offerShown, `motd: an un-crowned day (pool ${I.pool}) offers no crown at all, rather than a hollow one`);
		}
		await pi.close();
		await pm.close();
	}

	await browser.close();
}
log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
