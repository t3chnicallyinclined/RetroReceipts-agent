// ── The one place a GET leaves the app ──────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS. We have 17 stores and most data does flow through them, but components also fetch
// directly, and nothing deduped: /rr/profile was requested from 5 separate call sites, /rr/session from 5,
// /rr/leaderboard from 6. Open a profile while the live match card is up and the same player got fetched
// twice in the same tick — two requests, two JSON parses, two chances to disagree with each other.
//
// This does three things and deliberately nothing else:
//   1. IN-FLIGHT DEDUP — N callers asking for the same URL while a request is open share that ONE promise.
//      This is the big win and it needs no caller restructuring.
//   2. A SHORT TTL — a repeat GET within `ttl` ms serves the previous body instead of re-hitting the server.
//      Default is deliberately tiny (1.5s): long enough to collapse a render storm, far too short to serve
//      anyone stale data. Pass ttl:0 to force a fresh read.
//   3. INVALIDATION — `invalidate(prefix)` drops matching entries so the SSE bus can push freshness in
//      rather than components polling for it. Ratings changing after a match is an EVENT; treat it as one.
//
// What it is NOT: a normalized entity cache. Sharing one Player record across every surface is the right
// next step, but it's a bigger change and this lands the redundancy win first.
//
// ⚠ GETs only. Mutations must never be deduped or cached — two clicks are two intents.
import { api } from '$lib/config';

type Entry = { at: number; body: unknown };

const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, Entry>();

/** Collapse a render storm without ever serving something a user would notice as stale. */
const DEFAULT_TTL_MS = 1500;

export interface GetOpts {
	/** ms a previous body stays servable. 0 = always hit the network. */
	ttl?: number;
	/** Authorization: Bearer <token> — pass auth.token for owner-scoped reads. */
	token?: string | null;
	/** Bypass BOTH the cache and any in-flight share (a deliberate refresh). */
	force?: boolean;
}

/**
 * GET `path` (an app-relative path like `/rr/profile?steamid=…`) as JSON.
 *
 * Throws on a non-2xx so callers keep their existing error handling; a rejected request is removed from the
 * in-flight map so the next caller retries rather than inheriting the failure.
 */
export async function apiGet<T = unknown>(path: string, opts: GetOpts = {}): Promise<T> {
	const { ttl = DEFAULT_TTL_MS, token = null, force = false } = opts;
	// The token is part of the identity of the request: the owner view of a profile differs from the public
	// one, so a signed-in read must never be served from a signed-out entry (or vice versa).
	const key = `${token ? 'auth' : 'anon'}:${path}`;

	if (!force) {
		const hit = cache.get(key);
		if (hit && ttl > 0 && Date.now() - hit.at < ttl) return hit.body as T;
		const open = inflight.get(key);
		if (open) return open as Promise<T>;
	}

	const p = (async () => {
		const headers: Record<string, string> = { accept: 'application/json' };
		if (token) headers.authorization = `Bearer ${token}`;
		const res = await fetch(api(path), { headers });
		if (!res.ok) throw new Error(`${res.status}`);
		const body = (await res.json()) as T;
		if (ttl > 0) cache.set(key, { at: Date.now(), body });
		return body;
	})();

	inflight.set(key, p);
	try {
		return (await p) as T;
	} finally {
		inflight.delete(key);
	}
}

/**
 * Drop cached bodies whose path starts with `prefix` (both the anon and authed variants).
 *
 * Call this from the SSE handlers — e.g. a result lands → `invalidate('/rr/profile')` + `'/rr/leaderboard'`
 * — so freshness is pushed by events instead of polled. With no argument, drops everything (sign-out).
 */
export function invalidate(prefix?: string): void {
	if (!prefix) {
		cache.clear();
		return;
	}
	for (const k of [...cache.keys()]) {
		// keys are "<anon|auth>:<path>" — match on the path half so both variants clear together
		if (k.slice(k.indexOf(':') + 1).startsWith(prefix)) cache.delete(k);
	}
}

/** Diagnostics for the dedup layer — handy in the console when checking a page's real request count. */
export function netStats(): { cached: number; inflight: number } {
	return { cached: cache.size, inflight: inflight.size };
}
