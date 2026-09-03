// ── Replay source resolver (LIVE-TAB-SPEC §7.1, §7.11, §11) ─────────────────────────────────────────
// Given a Live Results row (its server tape handle `match_key` and/or `session_id`) answer: where is the
// tape and its asset pack, and what availability does the row show (▶ TAPE / ⏳ / —)?
//
// TODAY there is NO server contract for any of this (C1 `replay` on the result payload, C2 public
// `GET /rr/tape/<key>`, C3 pack hosting — all lane 1, all unbuilt: LIVE-TAB-SPEC §11). So:
//   (a) a DEV/LOCAL manifest `static/replay/index.json` maps ids → {tape, pack} (the two test packs);
//   (b) `probeServer()` is a clearly-marked STUB for the future public read — it returns
//       {kind:'none', reason:'pending'} for anything the manifest doesn't know.
// Nothing here fetches game data; packs are ROM-derived and only ever served from a gitignored folder.
import { base } from '$app/paths';
import { api } from '$lib/config';
import { auth } from '$lib/stores/auth.svelte';

export type ReplaySource =
	| { kind: 'tape'; tapeUrl: string; packUrl: string; start?: number; count?: number; frames?: number }
	| { kind: 'stream'; url: string; frames: number } // phones, M-interim keyed frames — C9, not built
	| { kind: 'none'; reason: 'pending' | 'expired' | 'none' | 'unsupported' | 'signin' };

/** Row-level replay availability — drives the MatchBanner affordance (§6.1). */
export type ReplayAvail = 'ready' | 'pending' | 'none' | 'expired' | 'saved';

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

// ── STUB: the future public tape read (lane-1 contract C2, LIVE-TAB-SPEC §11) ─────────────────────────
// When `GET /rr/tape?key=<match_key>` exists it should answer {ok, tape_url, pack_url, frames, state}.
// Until then this never hits the network for unknown keys: it reports `pending` (the row shows ⏳ inside
// the 3-minute post-result window, then —). Replace the body, keep the signature.
export const TAPE_READ_PATH = '/rr/tape'; // reserved; unbuilt server-side
export async function probeServer(matchKey: string): Promise<ReplaySource> {
	void api(TAPE_READ_PATH); // keeps the intended endpoint visible to grep; no request is made yet
	void matchKey;
	return { kind: 'none', reason: 'pending' };
}

/** Rows within this window after `ts` with a key are `pending` (agent upload lag), then `none` (§7.11). */
const PENDING_WINDOW_MS = 3 * 60_000;

export interface RowLike {
	match_key?: string;
	session_id?: string;
	ts: number;
}

/** Which local manifest id a row maps to: its tape handle, else its session id. */
export async function localFor(row: RowLike): Promise<{ id: string; tape: LocalTape } | null> {
	const tapes = await localTapes();
	for (const id of [row.match_key, row.session_id]) {
		if (id && tapes[id]) return { id, tape: tapes[id] };
	}
	// a manifest entry may carry the session id under `sessionId`
	if (row.session_id) {
		for (const [id, t] of Object.entries(tapes)) if (t.sessionId === row.session_id) return { id, tape: t };
	}
	return null;
}

/** Row availability for the affordance. Never `ready` unless a source is actually resolvable (§7.11). */
export async function availability(row: RowLike): Promise<ReplayAvail> {
	if (await localFor(row)) return 'ready';
	if (row.match_key) return Date.now() - row.ts < PENDING_WINDOW_MS ? 'pending' : 'none';
	return 'none';
}

/** Resolve a row into an embed source: local manifest first, then the (stub) server probe. */
export async function resolveSource(row: RowLike): Promise<ReplaySource> {
	// Replays are for signed-in users (Tris, 2026-09-03): the affordance can invite, the picture needs an account.
	// The dev server's local test tapes stay open so the render path can be exercised signed-out.
	if (!auth.authed && !import.meta.env.DEV) return { kind: 'none', reason: 'signin' };
	const loc = await localFor(row);
	if (loc) return sourceOfLocal(loc.tape);
	if (row.match_key) return probeServer(row.match_key);
	return { kind: 'none', reason: 'none' };
}
