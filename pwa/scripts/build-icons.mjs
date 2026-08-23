// Rasterize the RR marks to PNG for the places SVG does not work.
//
// Why this exists: the web manifest and iOS both want raster icons. Chrome will not use an SVG for an
// INSTALLED app/shortcut icon and falls back to a generated letter tile, and iOS ignores an SVG
// apple-touch-icon outright. With SVG-only icons the installed shortcut showed a generated letter rather
// than the receipt mark. The SVGs in static/ stay the source of truth — run this after changing them:
//
//   node scripts/build-icons.mjs
//
// Outputs (static/, committed): icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');
const CHROME = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium'
].find((p) => existsSync(p));
if (!CHROME) {
	console.error('No Chrome/Edge found to rasterize with.');
	process.exit(2);
}

// apple-touch-icon and the maskable icon both render on an opaque ground: iOS paints transparency black
// and applies its own rounding, and a maskable icon is cropped by the OS — so both use the dark-ground art.
const JOBS = [
	{ src: 'icon.svg', out: 'icon-192.png', size: 192 },
	{ src: 'icon.svg', out: 'icon-512.png', size: 512 },
	{ src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
	{ src: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180 }
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
	for (const { src, out, size } of JOBS) {
		// strip the fixed width/height so the mark scales from its viewBox to the viewport
		const svg = readFileSync(join(STATIC, src), 'utf8').replace(/\s(width|height)="100"/g, '');
		const page = await browser.newPage();
		await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
		await page.setContent(
			`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace('<svg', '<svg style="width:100%;height:100%;display:block"')}</div></body>`
		);
		await new Promise((r) => setTimeout(r, 150)); // let the webfont-less text lay out
		const buf = await page.screenshot({ omitBackground: true, type: 'png' });
		writeFileSync(join(STATIC, out), buf);
		await page.close();
		console.log(`✓ ${out} (${size}px from ${src}, ${buf.length}B)`);
	}
} finally {
	await browser.close();
}
