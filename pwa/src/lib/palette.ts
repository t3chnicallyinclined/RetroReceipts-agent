// Palette remapping for the MvC2 sprites — the client half of "your skins show wherever your team does".
//
// MvC2 sprites are palette-indexed in the game; our atlases and portraits are those sprites BAKED with the
// stock palette (STOCK_PALETTES is generated from the same bank0 the bake used). That makes a custom skin a
// deterministic pixel remap: every baked pixel's RGB is exactly one of the 16 stock entries, so mapping
// stock[i] → custom[i] reproduces the in-game recolor with no new art. Antialiasing would break this —
// the pixel-art assets have none.
//
// The remap runs ONCE per (image URL, palette) on an offscreen canvas and is cached module-wide, because
// receipts render the same six characters ten times over — the atlas must never be re-walked per chip.
import { STOCK_PALETTES } from '$lib/stockPalettes';

/** Stable cache key half for a palette (null/empty → '' = stock, no remap). */
export function paletteKey(pal: string[] | null | undefined): string {
	return pal && pal.length ? pal.join(',') : '';
}

/** True when `pal` is a usable custom palette that actually differs from the character's stock colors. */
export function isCustomPalette(cid: number, pal: string[] | null | undefined): boolean {
	if (!pal || pal.length === 0) return false;
	const stock = STOCK_PALETTES[cid];
	if (!stock) return false;
	return paletteKey(pal) !== paletteKey(stock);
}

function hexToRgb(h: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
	if (!m) return null;
	const v = parseInt(m[1], 16);
	return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * Remap `img` (a baked sprite image) from `cid`'s stock palette to `pal`, returning an offscreen canvas
 * usable as a draw source. Pixels that match no stock entry (there shouldn't be any) pass through, and
 * alpha is always preserved. Returns null when the palette is unusable — caller falls back to the original.
 */
export function remapSprite(
	img: CanvasImageSource & { width: number; height: number },
	cid: number,
	pal: string[]
): HTMLCanvasElement | null {
	const stock = STOCK_PALETTES[cid];
	if (!stock || !pal.length) return null;
	const map = new Map<number, [number, number, number]>();
	for (let i = 0; i < stock.length && i < pal.length; i++) {
		const from = hexToRgb(stock[i]);
		const to = hexToRgb(pal[i]);
		if (from && to) map.set((from[0] << 16) | (from[1] << 8) | from[2], to);
	}
	if (!map.size) return null;

	const cv = document.createElement('canvas');
	cv.width = img.width;
	cv.height = img.height;
	const ctx = cv.getContext('2d', { willReadFrequently: true });
	if (!ctx) return null;
	ctx.drawImage(img, 0, 0);
	let data: ImageData;
	try {
		data = ctx.getImageData(0, 0, cv.width, cv.height);
	} catch {
		return null; // tainted canvas (shouldn't happen: same-origin assets) — stock look survives
	}
	const px = data.data;
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] === 0) continue; // transparent — skip
		const to = map.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
		if (to) {
			px[i] = to[0];
			px[i + 1] = to[1];
			px[i + 2] = to[2];
		}
	}
	ctx.putImageData(data, 0, 0);
	return cv;
}

// ── module-wide cache: (image URL | palette) → remapped canvas ──────────────────────────────────────────
const cache = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * Load `url` and remap it to `pal` for character `cid`, cached module-wide. Resolves null on any failure
 * (missing asset, bad palette) so callers can fall back to the stock asset without their own try/catch.
 */
export function remappedImage(url: string, cid: number, pal: string[]): Promise<HTMLCanvasElement | null> {
	const key = `${url}|${cid}|${paletteKey(pal)}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const p = (async () => {
		try {
			const img = new Image();
			img.decoding = 'async';
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error('sprite load failed'));
				img.src = url;
			});
			return remapSprite(img, cid, pal);
		} catch {
			return null;
		}
	})();
	cache.set(key, p);
	return p;
}
