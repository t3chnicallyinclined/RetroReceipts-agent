import { api } from '$lib/config';
import { toResultRow, type MatchResult } from '$lib/stores/matchfeed.svelte';

// ★ MATCH OF THE DAY (LIVE-TAB-V2-SPEC §1.6) ────────────────────────────────────────────────────────────────
// A thin editorial layer over the feed the LIVE tab already loads: no new endpoint, no new component, no new
// store on the server, no per-row work. Everything scored here is ALREADY on a `match_result` row
// (app.rs `match_result_delta`), so this is arithmetic over data in hand.
//
// THE POINT: this is the DEFAULT PICK, not a badge stuck on the newest match. The page's job is that the first
// thing a visitor sees is the most WATCHABLE match; "newest" was only ever a proxy for that.
//
// THE BADGE IS EARNED. It appears only when the day actually held a competition (§1.6 "A quiet day"): at least
// MIN_POOL replayable matches AND a top score of at least MIN_SCORE. Below that the theatre still opens on the
// best match but calls it `▶ TODAY` with no superlative, because naming a "match of the day" out of three games
// is a claim about a competition that did not happen. Three labels, each literally true.
//
// Tris's answers (2026-09-04): the money-match nudge STAYS at +15 (Q9), and the two thresholds are unchanged
// at 6 and 60 (Q8).

/** ≥ this many replayable matches today before a crown is even possible. */
export const MIN_POOL = 6;
/** …and the top score must clear this. */
export const MIN_SCORE = 60;

export interface Scored {
	/** the row's tape handle (`match_key ?? key`) — what `?m=` carries and what the theatre resolves */
	key: string;
	score: number;
	/** at most three, in score order — the marquee's shout-out */
	reasons: string[];
	row: MatchResult;
}

/**
 * Score ONE row, and say WHY in the same pass.
 *
 * The weights say something a player would agree with out loud: a comeback beats an OCV beats a flawless game;
 * a big swing between two good players beats a big swing between two new ones; a huge combo counts; money
 * counts a little; and a fact we cannot vouch for counts for NOTHING — never against it (`verified` only ever
 * adds, so an unverified match is never punished for the server's uncertainty).
 *
 * Two signals score but produce NO reason string, deliberately: "both players rated ≥ 1200" and `verified`
 * are context, not a thing that happened in the match. The shout-out only ever names events.
 *
 * PURE: same row in, same score and same strings out. No clock, no `Math.random`, no store reads.
 */
export function scoreMatch(r: MatchResult): { score: number; reasons: string[] } {
	// [weight, reason | null] — the reason list is sorted by the weight that earned it, so the sub-line reads
	// in the same order the score was built.
	const hits: [number, string | null][] = [];

	if (r.comeback) hits.push([40, 'comeback']);
	if (r.ocv) hits.push([35, 'one-character victory']);

	const combo = r.combo ?? 0;
	if (combo >= 40) hits.push([30, `${combo}-hit combo`]);
	else if (combo >= 25) hits.push([15, `${combo}-hit combo`]);

	if (r.perfect) hits.push([25, 'flawless game']);

	// `elo` is already the winner's ABSOLUTE gain in the store (the loser's is the negative), so this is the
	// swing either way round.
	const elo = r.elo ?? 0;
	if (elo >= 20) hits.push([25, `+${elo} rating`]);
	else if (elo >= 12) hits.push([12, `+${elo} rating`]);

	// context, no reason string: two established players make a big swing mean more
	if ((r.winner_rating ?? 0) >= 1200 && (r.loser_rating ?? 0) >= 1200) hits.push([20, null]);

	if (r.mode === 'money') hits.push([15, 'money match']);

	// a fact we cannot vouch for counts for nothing, never against it
	if (r.verified) hits.push([10, null]);

	const score = hits.reduce((a, [w]) => a + w, 0);
	const reasons = hits
		.filter((h): h is [number, string] => h[1] != null)
		.sort((a, b) => b[0] - a[0])
		.slice(0, 3)
		.map(([, why]) => why);
	return { score, reasons };
}

/** Start of the viewer's LOCAL day — "today" is the visitor's today, not the server's. */
export function startOfDay(now: number): number {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * The day's pick over a set of rows.
 *
 * Only rows from today that the server says are `ready` are eligible — a crown pointing at a tape nobody can
 * watch is worse than no crown. Ties go to the NEWER match.
 *
 * PURE and REPRODUCIBLE: the same rows and the same `now` give the same key out, every time.
 */
export function pickMatchOfTheDay(rows: MatchResult[], now: number): { pick: Scored | null; pool: number; crowned: boolean } {
	const since = startOfDay(now);
	const today = rows.filter((r) => r.ts >= since && r.replay?.state === 'ready');
	if (!today.length) return { pick: null, pool: 0, crowned: false };

	const scored: Scored[] = today.map((r) => {
		const { score, reasons } = scoreMatch(r);
		return { key: r.match_key ?? r.key, score, reasons, row: r };
	});
	scored.sort((a, b) => b.score - a.score || b.row.ts - a.row.ts);

	const top = scored[0];
	return { pick: top, pool: today.length, crowned: today.length >= MIN_POOL && top.score >= MIN_SCORE };
}

/** The shout-out's share text (§1.6 "Share") — composed CLIENT-side, which is why it can carry the day's
 *  crown when the disk-cached OG fight card cannot (`ogimg.rs` goes immutable once verified). */
export function shoutText(p: Scored): string {
	const who = `${p.row.winner_name} over ${p.row.loser_name}`;
	return p.reasons.length ? `Match of the day: ${who} — ${p.reasons.join(', ')}.` : `Match of the day: ${who}.`;
}

/**
 * The store. ONE un-scoped `GET /rr/matches/feed?limit=100` at load — `mode` is optional server-side
 * (routes.rs → app.rs), so a single request covers ranked, lobby, tourney AND money. The LIVE tab's own feed
 * store stays mode-scoped at 20 rows; this is deliberately a second, wider read rather than a change to that
 * store's contract, because the crown must consider matches the visitor's current scope filters out.
 */
class MotdStore {
	pick = $state<Scored | null>(null);
	crowned = $state(false);
	pool = $state(0);
	loaded = $state(false);
	#inflight: Promise<void> | null = null;

	/** Newest-first rows across every mode; kept so BROWSE's "all" scope can reuse the same read. */
	rows = $state<MatchResult[]>([]);

	load(force = false): Promise<void> {
		if (this.#inflight) return this.#inflight;
		if (this.loaded && !force) return Promise.resolve();
		this.#inflight = (async () => {
			try {
				const res = await fetch(api('/rr/matches/feed?limit=100'), { headers: { accept: 'application/json' } });
				if (!res.ok) return; // keep-last-good: a quiet failure must never cost the page its picture
				const snap = (await res.json()) as { results?: Parameters<typeof toResultRow>[0][] };
				const rows = (Array.isArray(snap.results) ? snap.results : [])
					.map((d) => toResultRow(d))
					.filter((r): r is MatchResult => r != null);
				this.rows = rows;
				const { pick, pool, crowned } = pickMatchOfTheDay(rows, Date.now());
				this.pick = pick;
				this.pool = pool;
				this.crowned = crowned;
				this.loaded = true;
			} catch {
				/* keep-last-good */
			} finally {
				this.#inflight = null;
			}
		})();
		return this.#inflight;
	}
}

export const motd = new MotdStore();

// DEV-only test hook: the smoke harness drives the REAL scorer out of the REAL bundle (scripts/smoke-replay.mjs
// --motd), rather than a re-implementation in the test — a second copy of these weights would be free to agree
// with itself while disagreeing with the page.
if (import.meta.env.DEV && typeof window !== 'undefined') {
	(window as unknown as Record<string, unknown>).__rrMotd = { scoreMatch, pickMatchOfTheDay, shoutText, startOfDay, MIN_POOL, MIN_SCORE };
}
