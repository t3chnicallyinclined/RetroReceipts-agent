// ── Asset packs: WHERE the game art comes from (Tris 2026-09-04: "make a link they click that loads the files for
// them so they can see it; on mobile we load them too; our users own the game — a checkbox that requires them to
// acknowledge they own the game").
//
// A pack is ROM-derived game art (tools/pack_assets.py): a manifest + files whose NAMES the engine's index/blob
// assembly keys on (chars/PL2C_idx.png, stage/STG09.json, tcw/stage_09/index.json, camera_block.json, frozen/…).
// Two sources, one assembled result:
//   local  — dev only: the manifest sits next to the files (static/replay/packs/<id>/manifest.json, streamed by the
//            vite middleware from the render lane's folder).
//   server — prod: GET /rr/packs/manifest?key=<match_key> (authed AND attested) lists {name, url, bytes, sha256};
//            each file is GET /rr/packs/<part>/<file> (authed + attested, private max-age 86400).
// This module turns either into the {packIndex, packBlob} pair the engine opens, with byte progress for the PACK bar,
// a sha256 check per file (WebCrypto — the art must be exactly what the manifest promises), and Cache Storage keyed by
// url+sha so the shared parts (common, chars, stage) make the second replay of the same roster/stage instant.
//
// Ownership: the art is loaded only after the viewer attests they own the game (POST /rr/attest {owns_game:true});
// the server enforces it (403 {error:'attest'}) and this module never fetches a file before the attestation is in.
import { api } from '$lib/config';
import { auth } from '$lib/stores/auth.svelte';

/** GET /rr/tape?key= → `pack` (the server's pack pointer for that tape) */
export interface TapePackRef {
	manifest_url?: string;
	attested?: boolean;
}
export type PackSource =
	/** dev/local: a directory manifest next to its files */
	| { kind: 'local'; packUrl: string }
	/** prod: a manifest of URLs, authed + attested */
	| { kind: 'server'; manifestUrl: string; attested: boolean };

export interface PackFile {
	name: string;
	url: string;
	bytes: number;
	sha256?: string;
}
export interface PackManifest {
	key?: string;
	parts?: string[];
	files: PackFile[];
	total_bytes: number;
}
export interface AssembledPack {
	packIndex: { name: string; off: number; len: number }[];
	packBlob: Uint8Array;
	/** bytes that came off the network (0 = every file was in Cache Storage) */
	networkBytes: number;
	cachedFiles: number;
}
/** every failure the UI distinguishes: sign in · attest · a missing part · anything else */
export class PackError extends Error {
	code: 'signin' | 'attest' | 'missing' | 'fetch' | 'sha';
	part?: string;
	constructor(code: PackError['code'], message: string, part?: string) {
		super(message);
		this.code = code;
		this.part = part;
	}
}

// ── ownership attestation ───────────────────────────────────────────────────────────────────────────────────
export const ATTEST_PATH = '/rr/attest';
let attestCache: { at: number; owns: boolean } | null = null;
const ATTEST_TTL = 5 * 60_000;
/** DEV ONLY: a fixture manifest (static, no server) records the attestation here so the gate is exercisable offline */
const DEV_ATTEST_KEY = 'rr.attest.dev';
const devAttested = () => {
	try {
		return localStorage.getItem(DEV_ATTEST_KEY) === '1';
	} catch {
		return false;
	}
};

/** GET /rr/attest → {ok, owns_game, ts}. Signed out (or the endpoint is missing) = not attested. */
export async function getAttest(force = false, dev = false): Promise<boolean> {
	if (dev) return devAttested();
	if (!auth.authed) return false;
	if (!force && attestCache && Date.now() - attestCache.at < ATTEST_TTL) return attestCache.owns;
	try {
		const res = await fetch(api(ATTEST_PATH), { headers: { accept: 'application/json', ...auth.headers() } });
		if (!res.ok) return false;
		const j = (await res.json()) as { ok?: boolean; owns_game?: boolean };
		const owns = !!j?.owns_game;
		attestCache = { at: Date.now(), owns };
		return owns;
	} catch {
		return false;
	}
}
/** POST /rr/attest {owns_game:true} — the checkbox the viewer ticked. One per account; idempotent. */
export async function postAttest(dev = false): Promise<{ ok: boolean; error?: string }> {
	if (dev) {
		// a fixture pack: the tick is recorded locally; no account, no server call (never reachable in a prod build)
		try {
			localStorage.setItem(DEV_ATTEST_KEY, '1');
		} catch {
			/* private mode: the tick lives for this page only */
		}
		attestCache = { at: Date.now(), owns: true };
		return { ok: true };
	}
	if (!auth.authed) return { ok: false, error: 'signin' };
	try {
		const res = await fetch(api(ATTEST_PATH), {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json', ...auth.headers() },
			body: JSON.stringify({ owns_game: true })
		});
		const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
		if (!res.ok || j.ok === false) return { ok: false, error: j.error ?? `HTTP ${res.status}` };
		attestCache = { at: Date.now(), owns: true };
		return { ok: true };
	} catch (e) {
		return { ok: false, error: String((e as Error)?.message ?? e) };
	}
}
export function forgetAttest(): void {
	attestCache = null;
	try {
		localStorage.removeItem(DEV_ATTEST_KEY);
	} catch {
		/* nothing stored */
	}
}
/** a manifest served from the app's own static folder is a DEV FIXTURE (prod manifests come from /rr/packs/…) */
export const isDevFixture = (src: PackSource | null) => !!src && src.kind === 'server' && src.manifestUrl.includes('/replay/');

// ── the manifest ────────────────────────────────────────────────────────────────────────────────────────────
const abs = (u: string) => (/^https?:\/\//.test(u) || u.startsWith('/replay/') ? u : api(u));

/** Fetch + normalise a pack manifest from either source. Local manifests carry no URLs — they are `<dir>/<name>`. */
export async function loadPackManifest(src: PackSource): Promise<PackManifest> {
	if (src.kind === 'local') {
		const res = await fetch(`${src.packUrl}/manifest.json`, { cache: 'no-store' });
		if (!res.ok) throw new PackError(res.status === 404 ? 'missing' : 'fetch', `manifest: HTTP ${res.status}`);
		const j = (await res.json()) as { files?: { name: string; bytes: number; sha256?: string }[] };
		const files = (j.files ?? []).map((f) => ({ ...f, url: `${src.packUrl}/${f.name}` }));
		return { files, total_bytes: files.reduce((a, f) => a + (f.bytes || 0), 0) };
	}
	const res = await fetch(abs(src.manifestUrl), { headers: { accept: 'application/json', ...auth.headers() } });
	if (res.status === 401) throw new PackError('signin', 'sign in to load the art');
	if (res.status === 403) {
		const j = (await res.json().catch(() => ({}))) as { error?: string };
		throw new PackError(j?.error === 'attest' ? 'attest' : 'fetch', j?.error ?? 'forbidden');
	}
	if (!res.ok) throw new PackError(res.status === 404 ? 'missing' : 'fetch', `manifest: HTTP ${res.status}`);
	const j = (await res.json()) as Partial<PackManifest> & { ok?: boolean; error?: string; missing?: string };
	if (j?.ok === false) throw new PackError(j.error === 'attest' ? 'attest' : 'missing', j.error ?? 'no manifest', j.missing);
	const files = (j.files ?? []).map((f) => ({ ...f, url: abs(f.url) }));
	if (!files.length) throw new PackError('missing', 'the manifest lists no files');
	return { key: j.key, parts: j.parts, files, total_bytes: j.total_bytes ?? files.reduce((a, f) => a + (f.bytes || 0), 0) };
}

// ── the file cache (shared parts across matches) ─────────────────────────────────────────────────────────────
const CACHE_NAME = 'rr-pack-v1';
/** the cache key: url + the content hash, so a re-cut part is a MISS and a shared part is a HIT across matches */
const cacheKey = (f: PackFile) => `${f.url}${f.url.includes('?') ? '&' : '?'}__sha=${f.sha256 ?? 'nosha'}`;
async function packCache(): Promise<Cache | null> {
	try {
		return typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null;
	} catch {
		return null; // private mode / no Cache API — every load is a network load, nothing else changes
	}
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function sha256(bytes: Uint8Array): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/**
 * Fetch every file of a manifest (cache first), verify it, and lay it out as the engine's packBlob + packIndex.
 * `onProgress(got, total)` drives the existing PACK bar. Files are fetched with a small concurrency window so a
 * 40-file pack does not open 40 sockets.
 */
export async function assemblePack(
	man: PackManifest,
	onProgress?: (got: number, total: number) => void,
	concurrency = 6
): Promise<AssembledPack> {
	const cache = await packCache();
	const total = man.total_bytes || man.files.reduce((a, f) => a + (f.bytes || 0), 0);
	const out: (Uint8Array | null)[] = new Array(man.files.length).fill(null);
	let got = 0;
	let networkBytes = 0;
	let cachedFiles = 0;
	let next = 0;
	const one = async (i: number) => {
		const f = man.files[i];
		const key = cacheKey(f);
		let bytes: Uint8Array | null = null;
		if (cache) {
			const hit = await cache.match(key).catch(() => undefined);
			if (hit) {
				bytes = new Uint8Array(await hit.arrayBuffer());
				cachedFiles++;
			}
		}
		if (!bytes) {
			const res = await fetch(f.url, { headers: { ...auth.headers() } }).catch((e) => {
				throw new PackError('fetch', `${f.name}: ${String((e as Error)?.message ?? e)}`, f.name);
			});
			if (res.status === 401) throw new PackError('signin', `${f.name}: sign in`, f.name);
			if (res.status === 403) throw new PackError('attest', `${f.name}: attestation required`, f.name);
			if (res.status === 404) throw new PackError('missing', `${f.name}: not on the server`, f.name);
			if (!res.ok) throw new PackError('fetch', `${f.name}: HTTP ${res.status}`, f.name);
			const buf = new Uint8Array(await res.arrayBuffer());
			networkBytes += buf.byteLength;
			bytes = buf;
			if (f.sha256) {
				const h = await sha256(buf);
				if (h !== f.sha256) throw new PackError('sha', `${f.name}: sha256 mismatch (${h.slice(0, 12)}… vs ${f.sha256.slice(0, 12)}…)`, f.name);
			}
			if (cache) await cache.put(key, new Response(buf as BlobPart)).catch(() => {});
		}
		out[i] = bytes;
		got += bytes.byteLength;
		onProgress?.(got, total);
	};
	const worker = async () => {
		for (;;) {
			const i = next++;
			if (i >= man.files.length) return;
			await one(i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, man.files.length) }, worker));

	const size = out.reduce((a, b) => a + (b?.byteLength ?? 0), 0);
	const packBlob = new Uint8Array(size);
	const packIndex: { name: string; off: number; len: number }[] = [];
	let at = 0;
	for (let i = 0; i < man.files.length; i++) {
		const b = out[i] as Uint8Array;
		packBlob.set(b, at);
		packIndex.push({ name: man.files[i].name, off: at, len: b.byteLength });
		at += b.byteLength;
	}
	return { packIndex, packBlob, networkBytes, cachedFiles };
}

/** Drop every cached pack file (a settings action / a dev button). */
export async function clearPackCache(): Promise<void> {
	try {
		if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
	} catch {
		/* nothing to clear */
	}
}
export const mbText = (n: number) => (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1);
