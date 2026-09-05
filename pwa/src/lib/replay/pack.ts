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
// Ownership, WITHOUT an account (Tris 2026-09-04: "you can keep the checkbox there, but just not have the sign in
// needed"): the art is the game's own assets, so the viewer still acknowledges they own the game — but watching needs
// no sign-in. Signed out, the tick is recorded in localStorage (versioned {owns_game, ts}) and `X-RR-Owns-Game: 1`
// rides EVERY pack request; signed in, it is `POST /rr/attest` as before. The server accepts either and reports
// `pack.attested`, so someone who already acknowledged sees only the button.
//
// ⚠ SERVER CONTRACT (35c70ae): the header is the gate on EACH route and the server keeps no session for an anonymous
// viewer — the manifest AND every single file request must carry it, or each file 403s. Accepted values: 1 / true /
// yes. A signed-in viewer with a stored attestation needs no header (the bearer token is the gate). `packHeaders()`
// is therefore the ONE header builder and both fetch sites below use it — never inline `auth.headers()` here again.
// Rate limits are per connection per hour: 1,200 pack files / 200 MB and 150 tape files / 1.2 GB — a normal session
// is nowhere near them, so a 429 is genuinely exceptional: one honest line, never an automatic retry.
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
	code: 'signin' | 'attest' | 'missing' | 'fetch' | 'sha' | 'rate';
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
/** the account-free acknowledgement: a versioned record so a later wording change can ask again */
export const OWNS_KEY = 'rr.owns.v1';
export interface OwnsRecord {
	owns_game: boolean;
	ts: number;
	/**
	 * How the acknowledgement was made. `false`/absent = the viewer ticked the box themselves. `true` = it was
	 * taken IMPLICITLY at the point of play on a good connection (Tris 2026-09-05: "lets remove the checkbox of
	 * the art/data from wifi, we want path least resistance").
	 *
	 * This flag is why removing the friction does not quietly remove the ATTESTATION with it: an implicit
	 * acknowledgement is still a recorded acknowledgement, it still sends `X-RR-Owns-Game` on every pack
	 * request, and the UI still states plainly what was affirmed and offers a way to withdraw it. Two different
	 * things were tangled in that checkbox — the DATA-COST gate and the OWNERSHIP claim — and only the first
	 * was relaxed.
	 */
	implicit?: boolean;
}
/** the local acknowledgement, or null — survives a reload with no account */
export function ownsLocal(): OwnsRecord | null {
	try {
		const raw = localStorage.getItem(OWNS_KEY);
		if (!raw) return null;
		const j = JSON.parse(raw) as OwnsRecord;
		return j?.owns_game ? j : null;
	} catch {
		return null;
	}
}
function setOwnsLocal(implicit = false): OwnsRecord {
	const rec: OwnsRecord = { owns_game: true, ts: Date.now(), implicit };
	try {
		localStorage.setItem(OWNS_KEY, JSON.stringify(rec));
	} catch {
		/* private mode: the tick lives for this page only */
	}
	return rec;
}
/**
 * The headers for EVERY pack request — the manifest and each file alike (the server gates per route, 35c70ae):
 * the bearer token when signed in, plus `X-RR-Owns-Game: 1` once the account-free acknowledgement is on this device.
 */
export function packHeaders(): Record<string, string> {
	return { ...auth.headers(), ...(ownsLocal() ? { 'X-RR-Owns-Game': '1' } : {}) };
}

/** GET /rr/attest → {ok, owns_game, ts}. Signed out (or the endpoint is missing) = not attested. */
export async function getAttest(force = false): Promise<boolean> {
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
export async function postAttest(): Promise<{ ok: boolean; error?: string }> {
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
		localStorage.removeItem(OWNS_KEY);
	} catch {
		/* nothing stored */
	}
}

/** Has this viewer acknowledged ownership? The local record counts for everyone; a signed-in account also asks the server. */
export async function hasOwnership(): Promise<boolean> {
	if (ownsLocal()) return true;
	return auth.authed ? getAttest() : false;
}
/**
 * The tick: signed in → POST /rr/attest (plus the local record, the fallback the server also accepts); signed out →
 * the local record + the `X-RR-Owns-Game` header on every pack request. Never asks anyone to sign in.
 */
export async function acknowledgeOwnership(implicit = false): Promise<{ ok: boolean; error?: string }> {
	setOwnsLocal(implicit);
	if (auth.authed) {
		const r = await postAttest();
		if (!r.ok && r.error !== 'signin') return { ok: true, error: r.error }; // the header path still works
	}
	attestCache = { at: Date.now(), owns: true };
	return { ok: true };
}

/**
 * Withdraw the acknowledgement. The counterpart to taking it implicitly: a viewer told "art is loaded because
 * you own this" must have somewhere to say "I do not". Clears the local record so `packHeaders()` stops sending
 * `X-RR-Owns-Game` immediately; a signed-in server attestation is the account's own to manage.
 */
export function revokeOwnership(): void {
	try {
		localStorage.removeItem(OWNS_KEY);
	} catch {
		/* private mode — there was nothing to clear */
	}
	attestCache = { at: Date.now(), owns: false };
}

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
	const res = await fetch(abs(src.manifestUrl), { headers: { accept: 'application/json', ...packHeaders() } });
	if (res.status === 429) throw new PackError('rate', 'rate limited');
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
			const res = await fetch(f.url, { headers: packHeaders() }).catch((e) => {
				throw new PackError('fetch', `${f.name}: ${String((e as Error)?.message ?? e)}`, f.name);
			});
			if (res.status === 429) throw new PackError('rate', `${f.name}: rate limited`, f.name);
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
