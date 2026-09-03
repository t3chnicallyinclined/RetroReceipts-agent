// ── Replay source resolver (LIVE-TAB-SPEC §7.1, §7.11, §11 + docs/HANDOFF-LANE1-TAPE-ARCHIVE.md) ─────────
// Given ANY match/game row (its server tape handle `match_key`, its `session_id`, its `ts`) answer:
//   • availability — what the ReplayAffordance shows (▶ REPLAY / ⏳ TAPE INCOMING / 📼 REQUEST REPLAY / — / 🔒)
//   • source       — where the tape and its asset pack are, for the ReplayEmbed
//
// Tape side (lane 1 — the archive contract, built against docs/HANDOFF-LANE1-TAPE-ARCHIVE.md):
//   GET  /rr/tape?key=<match_key>  → {ok, state:'ready'|'pending'|'archived'|'none', tape_url?, frames?, ts?, session_id?}
//   POST /rr/tape/request {key}    → {ok, state:'pending'}   (authed; the server pulls the tape from R2 into hot storage)
// Until the endpoint exists it 404s: a 404 / network error falls back to today's inference (pending inside the
// 3-minute post-result window, else none) and is cached per key for 30 s so no surface ever spams it.
//
// Pack side: packs are ROM-derived (game pixels) and come ONLY from the local manifest static/replay/index.json
// (dev: streamed from the render lane's pack folder; the agent-side derivation is a separate item). A `ready`
// tape whose pack isn't on this device still shows ▶ REPLAY — the embed then says so in house voice instead of
// failing silently (source.packUrl === '').
import { base } from '$app/paths';
import { api } from '$lib/config';
import { auth } from '$lib/stores/auth.svelte';

export type ReplaySource =
	| { kind: 'tape'; tapeUrl: string; packUrl: string; start?: number; count?: number; frames?: number }
	| { kind: 'stream'; url: string; frames: number } // phones, M-interim keyed frames — C9, not built
	| { kind: 'none'; reason: NoneReason };
export type NoneReason = 'pending' | 'archived' | 'requested' | 'expired' | 'none' | 'unsupported' | 'signin';

/** Row-level replay availability — what the affordance shows. `signin` is the auth gate over ready/archived. */
export type ReplayAvail = 'ready' | 'pending' | 'archived' | 'none' | 'expired' | 'saved' | 'signin';

export interface LocalTapeSide {
	steamid: string;
	name?: string;
	team?: number[];
}
/** One entry of static/replay/index.json. */
export interface LocalTape {
	tape: string;
	pack: string;
	frames?: number;
	stageId?: number;
	agent?: string;
	sessionId?: string;
	/** the server's tape handle this pack was built from (feed/session/profile rows carry it as match_key) */
	matchKey?: string;
	gameNo?: number;
	/** the SteamID in each PHYSICAL seat (skins: P1's own loadout paints slots 0/2/4, P2's 1/3/5) */
	p1?: string;
	p2?: string;
	a: LocalTapeSide;
	b: LocalTapeSide;
	winner: 'a' | 'b';
	mode: string;
	ts: number;
}

let manifest: Promise<Record<string, LocalTape>> | null = null;

/** The dev/local manifest (cached for the session). Missing/invalid → {} (never throws). */
export function localTapes(): Promise<Record<string, LocalTape>> {
	if (!manifest) {
		manifest = fetch(`${base}/replay/index.json`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : {}))
			.then((j: { tapes?: Record<string, LocalTape> }) => j?.tapes ?? {})
			.catch(() => ({}));
	}
	return manifest;
}

/** Prefix an app-relative manifest URL with the SvelteKit base (prod lives at nobd.net/app). */
function withBase(u: string): string {
	return /^https?:\/\//.test(u) ? u : `${base}${u.startsWith('/') ? u : `/${u}`}`;
}

/** The ReplayEmbed source for a local manifest entry. */
export function sourceOfLocal(t: LocalTape): ReplaySource {
	return { kind: 'tape', tapeUrl: withBase(t.tape), packUrl: withBase(t.pack), frames: t.frames };
}

export interface RowLike {
	match_key?: string;
	session_id?: string;
	ts: number;
}

/** Which local manifest entry a row maps to: by its tape handle (`match_key`), else by manifest id. */
export async function localFor(row: RowLike): Promise<{ id: string; tape: LocalTape } | null> {
	const tapes = await localTapes();
	const k = row.match_key;
	if (k) {
		if (tapes[k]) return { id: k, tape: tapes[k] };
		for (const [id, t] of Object.entries(tapes)) if (t.matchKey === k) return { id, tape: t };
	}
	return null;
}

/** A pack for a server-hosted tape: only the local manifest knows packs (by match key). '' = not on this device. */
async function packFor(matchKey: string): Promise<string> {
	const loc = await localFor({ match_key: matchKey, ts: 0 });
	return loc ? withBase(loc.tape.pack) : '';
}

// ── the archive contract (lane 1) ────────────────────────────────────────────────────────────────────
export const TAPE_READ_PATH = '/rr/tape';
export const TAPE_REQUEST_PATH = '/rr/tape/request';
export interface TapeProbe {
	state: 'ready' | 'pending' | 'archived' | 'none';
	tape_url?: string;
	frames?: number;
	ts?: number;
	session_id?: string;
	/** true when the endpoint answered; false = 404/network → the caller infers from the row */
	known: boolean;
}
const PROBE_TTL_MS = 30_000;
const probes = new Map<string, { at: number; p: Promise<TapeProbe> }>();

/** GET /rr/tape?key= — cached per key for 30 s (a 404 is cached too: never spam an endpoint that isn't built). */
export function probeServer(matchKey: string, force = false): Promise<TapeProbe> {
	const hit = probes.get(matchKey);
	if (!force && hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.p;
	const p = (async (): Promise<TapeProbe> => {
		try {
			const res = await fetch(api(`${TAPE_READ_PATH}?key=${encodeURIComponent(matchKey)}`), {
				headers: { accept: 'application/json', ...auth.headers() }
			});
			if (!res.ok) return { state: 'none', known: false };
			const j = (await res.json()) as Partial<TapeProbe> & { ok?: boolean };
			if (j?.ok === false || !j.state) return { state: 'none', known: false };
			const state = (['ready', 'pending', 'archived', 'none'] as const).includes(j.state) ? j.state : 'none';
			return { state, tape_url: j.tape_url, frames: j.frames, ts: j.ts, session_id: j.session_id, known: true };
		} catch {
			return { state: 'none', known: false };
		}
	})();
	probes.set(matchKey, { at: Date.now(), p });
	return p;
}

/** POST /rr/tape/request {key} — one click pulls the tape from R2 into hot storage; the row turns pending. */
export async function requestReplay(matchKey: string): Promise<{ ok: boolean; error?: string }> {
	if (!auth.authed) return { ok: false, error: 'signin' };
	try {
		const res = await fetch(api(TAPE_REQUEST_PATH), {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json', ...auth.headers() },
			body: JSON.stringify({ key: matchKey })
		});
		const j = (await res.json().catch(() => ({}))) as { ok?: boolean; state?: string; error?: string };
		if (!res.ok || j.ok === false) return { ok: false, error: j.error ?? `HTTP ${res.status}` };
		// the next probe must see the new state, not the cached one
		probes.set(matchKey, { at: Date.now(), p: Promise.resolve({ state: 'pending', known: true }) });
		return { ok: true };
	} catch (e) {
		return { ok: false, error: String((e as Error)?.message ?? e) };
	}
}

/** Rows within this window after `ts` with a key are `pending` (agent upload lag), then `none` (§7.11). */
const PENDING_WINDOW_MS = 3 * 60_000;

/** The sign-in gate: replays are for players with an account (Tris 2026-09-03); dev test tapes stay open. */
export function gated(a: ReplayAvail): ReplayAvail {
	if ((a === 'ready' || a === 'archived' || a === 'saved') && !auth.authed && !import.meta.env.DEV) return 'signin';
	return a;
}

/** Row availability, UNGATED (see `gated`). Never `ready` unless a tape is actually resolvable (§7.11). */
export async function availability(row: RowLike): Promise<ReplayAvail> {
	if (await localFor(row)) return 'ready';
	if (!row.match_key) return 'none';
	const pr = await probeServer(row.match_key);
	if (pr.known) return pr.state;
	return Date.now() - row.ts < PENDING_WINDOW_MS ? 'pending' : 'none';
}

/** Resolve a row into an embed source: local manifest first, then the archive contract. */
export async function resolveSource(row: RowLike): Promise<ReplaySource> {
	if (!auth.authed && !import.meta.env.DEV) return { kind: 'none', reason: 'signin' };
	const loc = await localFor(row);
	if (loc) return sourceOfLocal(loc.tape);
	if (!row.match_key) return { kind: 'none', reason: 'none' };
	const pr = await probeServer(row.match_key);
	if (!pr.known) return { kind: 'none', reason: Date.now() - row.ts < PENDING_WINDOW_MS ? 'pending' : 'none' };
	if (pr.state === 'ready' && pr.tape_url) {
		return { kind: 'tape', tapeUrl: pr.tape_url, packUrl: await packFor(row.match_key), frames: pr.frames };
	}
	return { kind: 'none', reason: pr.state === 'ready' ? 'none' : pr.state };
}

/**
 * Physical seats for the skins feed (opts.skins = {p1:[…], p2:[…]}): from a result row's reporter side
 * (`side` 1 = the reporter was P1) plus reporter/winner/loser; unknown → null (stock for both).
 */
export function seatsOf(r: { side?: number; reporter?: string; winner?: string; loser?: string }): { p1: string; p2: string } | null {
	if (!r.side || !r.reporter || !r.winner || !r.loser) return null;
	const other = r.reporter === r.winner ? r.loser : r.winner;
	return r.side === 1 ? { p1: r.reporter, p2: other } : { p1: other, p2: r.reporter };
}
