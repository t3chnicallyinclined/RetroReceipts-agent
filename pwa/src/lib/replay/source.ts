// ── Replay source resolver (LIVE-TAB-SPEC §7.1, §7.11, §11 + docs/HANDOFF-LANE1-TAPE-ARCHIVE.md) ─────────
// Given ANY match/game row (its server tape handle `match_key`, its `session_id`, its `ts`) answer:
//   • availability — what the ReplayAffordance shows (▶ REPLAY / ⏳ TAPE INCOMING / 📼 REQUEST REPLAY / — / 🔒)
//   • source       — where the tape and its asset pack are, for the ReplayEmbed
//
// Replays are OPEN: a signed-out visitor resolves and plays a tape exactly like a signed-in one (Tris 2026-09-04).
// The only account-bound action left here is `POST /rr/tape/request` (an archive pull writes on the server); the
// ownership acknowledgement that gates the ART lives in lib/replay/pack.ts.
//
// Tape side (lane 1 — the archive contract, built against docs/HANDOFF-LANE1-TAPE-ARCHIVE.md):
//   GET  /rr/tape?key=<match_key>  → {ok, state:'ready'|'pending'|'archived'|'none', tape_url?, frames?, ts?, session_id?,
//                                      pack?: {manifest_url:'/rr/packs/manifest?key=…', attested:bool}  (2026-09-04: the
//                                      art is served BY US to owners — GET /rr/packs/manifest?key= (authed + attested)
//                                      lists {name,url,bytes,sha256}; files at /rr/packs/<part>/<file>. lib/replay/pack.ts),
//                                      overlay?: {template, version, meta}}   (STEP 4b, HANDOFF-LANE1-REPLAY-DATA.md: the
//                                      overlay ships WITH the tape read — `template` = a versioned static file (404 → the
//                                      built-in), `meta` = the binding schema in lib/replay/overlay.ts, bound VERBATIM)
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
import type { TapeOverlay } from './overlay';
import type { TapePackRef } from './pack';

export type ReplaySource =
	| { kind: 'tape'; tapeUrl: string; packUrl: string; start?: number; count?: number; frames?: number; overlay?: TapeOverlay | null; pack?: TapePackRef | null }
	| { kind: 'stream'; url: string; frames: number } // phones, M-interim keyed frames — C9, not built
	| { kind: 'none'; reason: NoneReason };
export type NoneReason = 'pending' | 'archived' | 'requested' | 'expired' | 'none' | 'unsupported';

/** Row-level replay availability — what the affordance shows. No auth gate: replays are open to everyone
 *  (Tris 2026-09-04: "let's not make it so you have to sign in to play the replays"). */
export type ReplayAvail = 'ready' | 'pending' | 'archived' | 'none' | 'expired' | 'saved';

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
	/** the overlay block as the server will ship it with a tape read (STEP 4b) — dev fixtures only */
	overlay?: TapeOverlay;
	/** a server-SHAPED pack ref (a manifest of URLs) instead of this row's directory — dev fixtures only */
	packSrv?: TapePackRef;
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
	// a fixture row may point at a server-SHAPED manifest (mirrors GET /rr/packs/manifest) instead of the directory
	const srv = t.packSrv?.manifest_url ? { ...t.packSrv, manifest_url: withBase(t.packSrv.manifest_url) } : null;
	return { kind: 'tape', tapeUrl: withBase(t.tape), packUrl: srv ? '' : withBase(t.pack), frames: t.frames, overlay: t.overlay ?? null, pack: srv };
}

export interface RowLike {
	match_key?: string;
	session_id?: string;
	ts: number;
	/** The server's own availability projection, carried on every `match_result` row (app.rs `replay_avail`).
	 *  When present it is AUTHORITATIVE and `availability()` answers from it with no network at all — that is the
	 *  whole point of LIVE-TAB-V2-SPEC P0: a list of 100 rows costs 0 probes instead of 100. */
	replay?: { state: 'ready' | 'pending' | 'archived' | 'none'; tape_url?: string; bytes?: number; frames?: number };
	/** server-resolved physical seats (app.rs `seat_sid`) — skins paint the right side with no reporter arithmetic */
	p1?: string;
	p2?: string;
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
	/** STEP 4b: the overlay template + metadata resolved server-side at request time */
	overlay?: TapeOverlay;
	/** 2026-09-04: where this tape's art lives on the server, and whether this viewer has attested ownership */
	pack?: TapePackRef;
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
			return { state, tape_url: j.tape_url, frames: j.frames, ts: j.ts, session_id: j.session_id, overlay: j.overlay, pack: j.pack, known: true };
		} catch {
			return { state: 'none', known: false };
		}
	})();
	probes.set(matchKey, { at: Date.now(), p });
	return p;
}

/** POST /rr/tape/request {key} — one click pulls the tape from R2 into hot storage; the row turns pending. */
export async function requestReplay(matchKey: string): Promise<{ ok: boolean; error?: string }> {
	// the ARCHIVE PULL is a server-side write, so it still needs an account (watching a hot tape does not)
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

/**
 * No gate — replays play for everyone, signed in or not (Tris 2026-09-04: "let's not make it so you have to sign
 * in to play the replays"). Kept as the ONE place a future gate would live so callers never re-invent one; the
 * ownership acknowledgement for the ART is a separate thing and still applies (lib/replay/pack.ts).
 */
export function gated(a: ReplayAvail): ReplayAvail {
	return a;
}

/**
 * Row availability, UNGATED (see `gated`). Never `ready` unless a tape is actually resolvable (§7.11).
 *
 * Order: a LOCAL pack wins (dev test tapes are always playable), then the row's OWN `replay.state` if the server
 * put one there — no request, because the server already answered this question when it built the row. Only a row
 * that predates that projection (an older cached delta) falls through to the per-key probe and, failing that, to
 * the post-result pending-window inference.
 */
export async function availability(row: RowLike): Promise<ReplayAvail> {
	if (await localFor(row)) return 'ready';
	if (row.replay) return row.replay.state;
	if (!row.match_key) return 'none';
	const pr = await probeServer(row.match_key);
	if (pr.known) return pr.state;
	return Date.now() - row.ts < PENDING_WINDOW_MS ? 'pending' : 'none';
}

/**
 * Resolve a row into an embed source: local manifest first, then the archive contract.
 *
 * This one still probes even when the row carries `replay.state === 'ready'`, and that is deliberate: `tape_url`
 * alone does not make a playable source. The PACK location (`pack.manifest_url`, whether this viewer has attested)
 * and the OVERLAY block (template + server-resolved meta, HANDOFF-LANE1-REPLAY-DATA step 4b) exist ONLY on the tape
 * read. So the saving from P0 is per-LIST (availability, once per row, now free) — not per-OPEN, which is one
 * request for one thing the viewer explicitly asked to watch. A row the server already called unplayable is
 * short-circuited below, so an un-openable row costs nothing either.
 */
export async function resolveSource(row: RowLike): Promise<ReplaySource> {
	const loc = await localFor(row);
	if (loc) return sourceOfLocal(loc.tape);
	if (!row.match_key) return { kind: 'none', reason: 'none' };
	// the server already said there is nothing to open — don't ask it again to hear the same answer
	if (row.replay && row.replay.state !== 'ready') return { kind: 'none', reason: row.replay.state };
	const pr = await probeServer(row.match_key);
	if (!pr.known) return { kind: 'none', reason: Date.now() - row.ts < PENDING_WINDOW_MS ? 'pending' : 'none' };
	if (pr.state === 'ready' && pr.tape_url) {
		return { kind: 'tape', tapeUrl: pr.tape_url, packUrl: await packFor(row.match_key), frames: pr.frames, overlay: pr.overlay ?? null, pack: pr.pack ?? null };
	}
	return { kind: 'none', reason: pr.state === 'ready' ? 'none' : pr.state };
}

/**
 * Physical seats for the skins feed (opts.skins = {p1:[…], p2:[…]}): from a result row's reporter side
 * (`side` 1 = the reporter was P1) plus reporter/winner/loser; unknown → null (stock for both).
 */
export function seatsOf(r: { side?: number; reporter?: string; winner?: string; loser?: string; p1?: string; p2?: string }): { p1: string; p2: string } | null {
	// The server resolves the seats itself (`seat_sid`, app.rs match_result_delta) and answers "" for unknown or
	// clashing claims. When it gave us both, that is the answer — the reporter arithmetic below is the fallback
	// for rows that predate the field.
	if (r.p1 && r.p2) return { p1: r.p1, p2: r.p2 };
	if (!r.side || !r.reporter || !r.winner || !r.loser) return null;
	const other = r.reporter === r.winner ? r.loser : r.winner;
	return r.side === 1 ? { p1: r.reporter, p2: other } : { p1: other, p2: r.reporter };
}
