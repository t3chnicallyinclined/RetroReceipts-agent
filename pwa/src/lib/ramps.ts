// Material ramps — the enabling mechanic of the Dye Station ("paint the fighter, not the palette").
//
// MvC2's 16 palette slots aren't 16 random colors: pixel-art palettes are built as RAMPS — 3–7 shades of
// one material (armor, cape, skin), dark→light. We have no per-part metadata, and we don't need it:
// clustering the STOCK palette by hue-adjacency + monotonic lightness recovers the materials (validated
// across all 59 characters: 3–10 ramps, median 5, semantically real — Magneto splits face/armor/cape).
//
// Rules that keep editing sane:
//   • Ramps are derived from STOCK and FROZEN — editing colors never reshuffles the grouping mid-session.
//   • Coverage (what % of the sprite's pixels a ramp paints) ranks ramps biggest-first and powers the
//     tap-the-sprite hit-test: portrait pixel → exact stock-color match → slot → ramp.
//   • Hue-rotating a ramp preserves the artist's intra-ramp lightness/hue deltas — edits look pro because
//     the shading was never touched.
import { STOCK_PALETTES } from '$lib/stockPalettes';

export interface Ramp {
	/** slot indices, ordered light→dark as authored */
	slots: number[];
	/** share of visible sprite pixels this ramp paints (0..1); 0 until analyze() has run */
	coverage: number;
}

// ── color math (small + dependency-free) ────────────────────────────────────────────────────────────────
export function hexToRgb(h: string): [number, number, number] {
	const v = parseInt(h.replace('#', ''), 16);
	return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
export function rgbToHex(r: number, g: number, b: number): string {
	return '#' + (((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)).toString(16).padStart(6, '0');
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	(r /= 255), (g /= 255), (b /= 255);
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
	let h = 0;
	const l = (max + min) / 2;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	if (d !== 0) {
		if (max === r) h = 60 * (((g - b) / d) % 6);
		else if (max === g) h = 60 * ((b - r) / d + 2);
		else h = 60 * ((r - g) / d + 4);
	}
	return [(h + 360) % 360, s, l];
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	h = ((h % 360) + 360) % 360;
	s = Math.min(1, Math.max(0, s));
	l = Math.min(1, Math.max(0, l));
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ── clustering (frozen, stock-anchored) ─────────────────────────────────────────────────────────────────
function cluster(pal: string[]): number[][] {
	const out: number[][] = [];
	let cur = [0];
	for (let i = 1; i < pal.length; i++) {
		const [h1, s1, l1] = rgbToHsl(...hexToRgb(pal[i - 1]));
		const [h2, s2, l2] = rgbToHsl(...hexToRgb(pal[i]));
		const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
		const sameHue = dh < 30 || s1 < 0.12 || s2 < 0.12; // greys join anything hue-wise
		const darker = l2 <= l1 + 0.08;
		if (sameHue && darker) cur.push(i);
		else {
			out.push(cur);
			cur = [i];
		}
	}
	out.push(cur);
	return out;
}

const rampCache = new Map<number, Ramp[]>();

/** Structural ramps for a character (coverage 0 until analyzeRamps resolves). Cached, frozen. */
export function rampsOf(cid: number): Ramp[] {
	const hit = rampCache.get(cid);
	if (hit) return hit;
	const pal = STOCK_PALETTES[cid] ?? [];
	const ramps = cluster(pal).map((slots) => ({ slots, coverage: 0 }));
	rampCache.set(cid, ramps);
	return ramps;
}

// ── coverage + hit-testing: exact-match the STOCK portrait's pixels to slots ────────────────────────────
type PixelMap = { slotAt: Int16Array; w: number; h: number };
const pixelCache = new Map<number, Promise<PixelMap | null>>();

function portraitPixels(cid: number, src: string): Promise<PixelMap | null> {
	const hit = pixelCache.get(cid);
	if (hit) return hit;
	const p = (async () => {
		try {
			const img = new Image();
			img.decoding = 'async';
			await new Promise<void>((res, rej) => {
				img.onload = () => res();
				img.onerror = () => rej(new Error('portrait load failed'));
				img.src = src;
			});
			const cv = document.createElement('canvas');
			cv.width = img.width;
			cv.height = img.height;
			const ctx = cv.getContext('2d', { willReadFrequently: true });
			if (!ctx) return null;
			ctx.drawImage(img, 0, 0);
			const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
			const stock = (STOCK_PALETTES[cid] ?? []).map((h) => {
				const [r, g, b] = hexToRgb(h);
				return (r << 16) | (g << 8) | b;
			});
			const slotAt = new Int16Array(cv.width * cv.height).fill(-1);
			for (let i = 0, px = 0; i < data.length; i += 4, px++) {
				if (data[i + 3] === 0) continue;
				const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
				const s = stock.indexOf(key);
				if (s >= 0) slotAt[px] = s;
			}
			return { slotAt, w: cv.width, h: cv.height };
		} catch {
			return null;
		}
	})();
	pixelCache.set(cid, p);
	return p;
}

/** Fill in real pixel coverage for a character's ramps (idempotent; ramps re-sort biggest-first). */
export async function analyzeRamps(cid: number, portraitSrc: string): Promise<Ramp[]> {
	const ramps = rampsOf(cid);
	if (ramps.some((r) => r.coverage > 0)) return ramps;
	const pm = await portraitPixels(cid, portraitSrc);
	if (!pm) return ramps;
	const counts = new Array<number>(16).fill(0);
	let total = 0;
	for (const s of pm.slotAt) {
		if (s >= 0) {
			counts[s]++;
			total++;
		}
	}
	if (total === 0) return ramps;
	for (const r of ramps) r.coverage = r.slots.reduce((n, s) => n + (counts[s] ?? 0), 0) / total;
	ramps.sort((a, b) => b.coverage - a.coverage);
	return ramps;
}

/**
 * Tap-the-sprite: map a click at (x,y) in DISPLAY coordinates of an element rendering the stock-shaped
 * portrait (object-fit: contain, bottom-anchored — CharSprite's layout) to the ramp painting that pixel.
 * Returns the ramp index in rampsOf(cid) order, or -1 (transparent / unmatched / not analyzed).
 */
export async function rampAtPoint(
	cid: number,
	portraitSrc: string,
	x: number,
	y: number,
	boxW: number,
	boxH: number
): Promise<number> {
	const pm = await portraitPixels(cid, portraitSrc);
	if (!pm) return -1;
	const scale = Math.min(boxW / pm.w, boxH / pm.h);
	const dw = pm.w * scale, dh = pm.h * scale;
	const ox = (boxW - dw) / 2, oy = boxH - dh; // contain, bottom-anchored
	const px = Math.floor((x - ox) / scale), py = Math.floor((y - oy) / scale);
	if (px < 0 || py < 0 || px >= pm.w || py >= pm.h) return -1;
	// sample a small neighbourhood so near-miss taps on thin limbs still land
	const ramps = rampsOf(cid);
	for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
		const qx = px + dx, qy = py + dy;
		if (qx < 0 || qy < 0 || qx >= pm.w || qy >= pm.h) continue;
		const slot = pm.slotAt[qy * pm.w + qx];
		if (slot >= 0) return ramps.findIndex((r) => r.slots.includes(slot));
	}
	return -1;
}

// ── transforms (all shading-preserving: they move the ramp, never the deltas) ───────────────────────────
/** Rotate a set of slots' hue by `deg`, preserving each slot's saturation/lightness. */
export function hueShift(pal: string[], slots: number[], deg: number): string[] {
	const out = pal.slice();
	for (const s of slots) {
		const [h, sa, l] = rgbToHsl(...hexToRgb(out[s]));
		out[s] = rgbToHex(...hslToRgb(h + deg, sa, l));
	}
	return out;
}
export type Tone = 'pastel' | 'deep' | 'neon' | 'mute';
/** Named saturation/lightness intents — novices don't want two more sliders. */
export function applyTone(pal: string[], slots: number[], tone: Tone): string[] {
	const out = pal.slice();
	for (const s of slots) {
		let [h, sa, l] = rgbToHsl(...hexToRgb(out[s]));
		if (tone === 'pastel') {
			sa *= 0.55;
			l = l * 0.6 + 0.4;
		} else if (tone === 'deep') {
			sa = Math.min(1, sa * 1.15);
			l *= 0.78;
		} else if (tone === 'neon') {
			sa = Math.min(1, sa * 1.6);
			l = l * 0.85 + 0.12;
		} else {
			sa *= 0.45;
		}
		out[s] = rgbToHex(...hslToRgb(h, sa, l));
	}
	return out;
}
/** Invert lightness across the given slots — the classic FGC negative alt, one tap. */
export function invert(pal: string[], slots: number[]): string[] {
	const out = pal.slice();
	for (const s of slots) {
		const [h, sa, l] = rgbToHsl(...hexToRgb(out[s]));
		out[s] = rgbToHex(...hslToRgb((h + 180) % 360, sa, 1 - l));
	}
	return out;
}
/** Retarget a ramp toward a chosen base hue/sat, keeping the stock lightness ladder. */
export function retargetRamp(stock: string[], pal: string[], slots: number[], baseHex: string): string[] {
	const out = pal.slice();
	const [bh, bs] = rgbToHsl(...hexToRgb(baseHex));
	for (const s of slots) {
		const [, , sl] = rgbToHsl(...hexToRgb(stock[s])); // lightness ladder comes from STOCK
		out[s] = rgbToHex(...hslToRgb(bh, bs, sl));
	}
	return out;
}
/** Shuffle: random harmonious re-hue of the UNLOCKED ramps (locked slot-sets untouched). */
export function shuffle(stock: string[], pal: string[], unlockedRamps: number[][]): string[] {
	let out = pal.slice();
	const base = Math.random() * 360;
	const schemes = [
		[0, 180, 90], // complementary + accent
		[0, 120, 240], // triadic
		[0, 30, -30], // analogous
		[0, 150, 210] // split-complementary
	];
	const scheme = schemes[Math.floor(Math.random() * schemes.length)];
	unlockedRamps.forEach((slots, i) => {
		const hue = base + scheme[i % scheme.length] + (Math.random() * 16 - 8);
		const sat = 0.45 + Math.random() * 0.4;
		out = retargetRamp(stock, out, slots, rgbToHex(...hslToRgb(hue, sat, 0.5)));
	});
	return out;
}

// ── themes: derived per character, previewed as live minis ──────────────────────────────────────────────
export const THEMES: { id: string; name: string; hue: number | null; sat: number; mode?: 'mono' | 'shadow' | 'invert' }[] = [
	{ id: 'crimson', name: 'crimson', hue: 356, sat: 0.72 },
	{ id: 'ice', name: 'ice', hue: 205, sat: 0.45 },
	{ id: 'gold', name: 'gold', hue: 42, sat: 0.78 },
	{ id: 'venom', name: 'venom', hue: 135, sat: 0.65 },
	{ id: 'royal', name: 'royal', hue: 268, sat: 0.6 },
	{ id: 'mono', name: 'mono', hue: null, sat: 0, mode: 'mono' },
	{ id: 'shadow', name: 'shadow', hue: null, sat: 0, mode: 'shadow' },
	{ id: 'negative', name: 'negative', hue: null, sat: 0, mode: 'invert' }
];
/** Apply a theme to the whole palette: big ramps take the theme hue, small/low-sat ramps stay anchored. */
export function applyTheme(cid: number, themeId: string): string[] {
	const stock = STOCK_PALETTES[cid] ?? [];
	const theme = THEMES.find((t) => t.id === themeId);
	if (!theme || !stock.length) return stock.slice();
	const ramps = rampsOf(cid);
	if (theme.mode === 'invert') return invert(stock, stock.map((_, i) => i));
	if (theme.mode === 'mono') return applyTone(stock, stock.map((_, i) => i), 'mute');
	if (theme.mode === 'shadow') {
		let out = stock.slice();
		for (const r of ramps) for (const s of r.slots) {
			const [h, sa, l] = rgbToHsl(...hexToRgb(out[s]));
			out[s] = rgbToHex(...hslToRgb(h, sa * 0.7, l * 0.55));
		}
		return out;
	}
	let out = stock.slice();
	// the two biggest colored ramps wear the theme (main + a darker companion); low-sat ramps (skin/greys)
	// keep their stock hue so faces stay faces
	const colored = ramps.filter((r) => r.slots.some((s) => rgbToHsl(...hexToRgb(stock[s]))[1] >= 0.25));
	colored.slice(0, 2).forEach((r, i) => {
		out = retargetRamp(stock, out, r.slots, rgbToHex(...hslToRgb(theme.hue! + i * 24, theme.sat, 0.5)));
	});
	return out;
}
