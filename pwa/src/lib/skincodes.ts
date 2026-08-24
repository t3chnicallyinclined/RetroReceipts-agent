// Share codes — a colorway as a pasteable string, the PalMod scene's hex-string tradition with structural
// credit. The CODE IS THE PALETTE: version, character, 16×RGB888, name, author, checksum — base64url over
// a tiny binary layout, ~100 chars for typical names. Zero server involvement: encode/decode are pure
// client, and a share LINK is just the skins route with the code in the URL. Anyone can wear it; the
// author's name rides along and renders as credit wherever the skin shows.
//
// Layout (little baggage on purpose):
//   u8  version (1)
//   u8  cid
//   u8[48] colors (16 × R,G,B)
//   u8  nameLen,   utf8 bytes (≤ 40)
//   u8  authorLen, utf8 bytes (≤ 40)
//   u8  checksum — XOR of all preceding bytes (typo tripwire, not security; palettes aren't secrets)
import { hexToRgb, rgbToHex } from '$lib/ramps';

export interface SkinCode {
	cid: number;
	name: string;
	author: string;
	/** 16 × '#rrggbb' */
	palette: string[];
}

const PREFIX = 'RR1-';

function b64urlEncode(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array | null {
	try {
		const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
		const out = new Uint8Array(b.length);
		for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

export function encodeSkin(code: SkinCode): string {
	const enc = new TextEncoder();
	const name = enc.encode(code.name.slice(0, 40));
	const author = enc.encode(code.author.slice(0, 40));
	const bytes = new Uint8Array(2 + 48 + 1 + name.length + 1 + author.length + 1);
	let o = 0;
	bytes[o++] = 1;
	bytes[o++] = code.cid & 0xff;
	for (let i = 0; i < 16; i++) {
		const [r, g, b] = hexToRgb(code.palette[i] ?? '#000000');
		bytes[o++] = r;
		bytes[o++] = g;
		bytes[o++] = b;
	}
	bytes[o++] = name.length;
	bytes.set(name, o);
	o += name.length;
	bytes[o++] = author.length;
	bytes.set(author, o);
	o += author.length;
	let x = 0;
	for (let i = 0; i < o; i++) x ^= bytes[i];
	bytes[o++] = x;
	return PREFIX + b64urlEncode(bytes.subarray(0, o));
}

/** Decode a pasted code (whitespace-tolerant). Null on anything malformed — never throws. */
export function decodeSkin(raw: string): SkinCode | null {
	const s = raw.trim().replace(/\s+/g, '');
	if (!s.startsWith(PREFIX)) return null;
	const body = s.slice(PREFIX.length);
	const bytes = b64urlDecode(body);
	if (!bytes || bytes.length < 2 + 48 + 3) return null;
	let o = 0;
	if (bytes[o++] !== 1) return null;
	const cid = bytes[o++];
	const palette: string[] = [];
	for (let i = 0; i < 16; i++) {
		palette.push(rgbToHex(bytes[o], bytes[o + 1], bytes[o + 2]));
		o += 3;
	}
	const dec = new TextDecoder();
	const nameLen = bytes[o++];
	if (o + nameLen + 2 > bytes.length) return null;
	const name = dec.decode(bytes.subarray(o, o + nameLen));
	o += nameLen;
	const authorLen = bytes[o++];
	if (o + authorLen + 1 > bytes.length) return null;
	const author = dec.decode(bytes.subarray(o, o + authorLen));
	o += authorLen;
	let x = 0;
	for (let i = 0; i < o; i++) x ^= bytes[i];
	if (bytes[o] !== x) return null; // typo tripwire
	return { cid, name, author, palette };
}

/** The shareable URL form: the skins rack route with the code in the query. */
export function skinLink(base: string, code: string): string {
	return `https://nobd.net${base}/skins?code=${encodeURIComponent(code)}`;
}
