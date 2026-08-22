// Headless render-check — loads the built PWA in real Chrome and FAILS on any pageerror / console.error /
// own-asset requestfailed, so a runtime crash the build can't see (Svelte hydration, undefined access) is
// caught BEFORE deploy. Usage: node scripts/render-check.mjs <url> [more urls...]
//
// HERMETIC: it ABORTS every request to the live backend (/rt/ SSE + /skinsync/ API) so (a) the check never
// depends on prod being up, (b) the never-idle SSE stream can't keep Chrome alive and hang browser.close(),
// and (c) the app renders its empty/idle states — exactly where the risky branches live. A hard watchdog
// force-exits so a stuck launch can never stall the release pipeline.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME_CANDIDATES = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!exe) {
	console.error('No Chrome/Edge found for the render-check.');
	process.exit(2);
}

// watchdog: nothing here should take more than ~30s; if it does, fail loud rather than hang the pipeline.
const watchdog = setTimeout(() => {
	console.error('❌ render-check watchdog fired (stuck > 45s) — treating as failure');
	process.exit(1);
}, 45_000);
watchdog.unref();

const urls = process.argv.slice(2);
if (urls.length === 0) urls.push('http://localhost:4173/');

const isOwnAsset = (u) => u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1');
const isBackend = (u) => u.includes('/rt/') || u.includes('/skinsync/');

const browser = await puppeteer.launch({
	executablePath: exe,
	headless: true,
	args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
});
let failed = false;
try {
	for (const url of urls) {
		const errors = [];
		const page = await browser.newPage();
		if (process.env.SIGNED_IN) {
			await page.evaluateOnNewDocument(() => {
				try {
					localStorage.setItem('metasync_token', 'render-check-fake-token');
					localStorage.setItem('metasync_steamid', '76561197960287930');
				} catch (e) {}
			});
		}
		await page.setRequestInterception(true);
		page.on('request', (r) => {
			const u = r.url();
			// abort the live backend (SSE + API) → hermetic + no hang; let own assets + everything else load
			if (isBackend(u) || (!isOwnAsset(u) && !u.startsWith('data:'))) {
				r.abort().catch(() => {});
			} else {
				r.continue().catch(() => {});
			}
		});
		// pageerror = uncaught exception (Svelte hydration crash, undefined access) → the PRIMARY signal, never filtered.
		page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
		page.on('console', (m) => {
			if (m.type() !== 'error') return;
			const t = m.text();
			// the browser logs a generic "Failed to load resource" for every request we intentionally aborted
			// (the app uses relative /skinsync API URLs); that's expected hermetic noise, not an app bug.
			if (/Failed to load resource/i.test(t)) return;
			errors.push('[console.error] ' + t);
		});
		page.on('requestfailed', (r) => {
			const u = r.url();
			if (isBackend(u)) return; // we aborted these on purpose (hermetic) — not a failure
			if (!isOwnAsset(u)) return; // external (fonts, etc.) failing doesn't matter to a render check
			errors.push('[requestfailed] ' + u + ' ' + (r.failure()?.errorText ?? ''));
		});
		let status = 0;
		try {
			const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
			status = resp?.status() ?? 0;
		} catch (e) {
			errors.push('[goto] ' + e.message);
		}
		await new Promise((r) => setTimeout(r, 2500)); // let hydration run + throw if it will
		const bodyLen = await page.evaluate(() => document.body?.innerText?.trim().length || 0).catch(() => 0);
		const ok = status > 0 && status < 400 && bodyLen > 30 && errors.length === 0;
		console.log(`${ok ? '✅' : '❌'} ${url} → HTTP ${status}, ${bodyLen} chars rendered${errors.length ? ', ' + errors.length + ' error(s)' : ''}`);
		for (const e of errors) console.log('     ' + e);
		if (!ok) failed = true;
		await page.close().catch(() => {});
	}
} finally {
	// guard the close so a lingering connection can't hang us; the watchdog is the final backstop.
	await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
}
clearTimeout(watchdog);
process.exit(failed ? 1 : 0);
