// Season finale: the highlights aggregate (GET /rr/season/highlights?season=<id>), typed and validated.
//
// Every field is OPTIONAL. The page draws only what is here, and a zero, a missing field or a malformed row
// drops that line rather than showing a placeholder. The server shape is documented in
// server/src/highlights.rs (BUILD-SPEC section 7); where the committed server differs from the spec the
// differences are absorbed HERE so no component has to know (see the notes marked SERVER).

import { apiGet } from '../net.svelte';
import { withSeason } from '../seasons';
import { CHAR_NAME } from '../chars';

export interface PlayerRef {
	steamid: string;
	name: string;
	avatar?: string;
	cc?: string;
}
export interface Valued {
	player: PlayerRef;
	value: number;
}
export interface Month {
	m: string;
	games: number;
	newPlayers?: number;
	activePlayers?: number;
	partialThrough?: string;
}
export interface TeamRow {
	team: number[];
	share?: number;
	players?: number;
}
export interface SetRef {
	sessionId: string;
	tape: boolean;
}
export interface MentionBoard {
	key: string;
	label: string;
	value: number | string;
	/** 1-3, or null for the unranked boards (rivalries, sweeps) */
	rank: number | null;
}
export interface Mention {
	player: PlayerRef;
	place?: number;
	/** lower-case tier slug, e.g. "adamantium" */
	tier?: string;
	boards: MentionBoard[];
}
export interface UnlistedRow {
	player: PlayerRef;
	rating: number;
	peak?: number;
	wins?: number;
	losses?: number;
	games?: number;
	/** where they would sit if everyone were listed */
	overallPlace?: number;
	/** lower-case tier slug */
	tier?: string;
}
/** Players with games who are NOT on the season roster (they never ran the app; their games were recorded by an app user's agent). */
export interface Unlisted {
	count: number;
	withWins?: number;
	placed?: number;
	top: UnlistedRow[];
	mostActive: { player: PlayerRef; games: number; days?: number }[];
}

export interface Highlights {
	days?: number;
	everyDay: boolean;
	time?: { hours?: number; timedGames?: number; medianS?: number; longestS?: number };
	months: Month[];
	peak?: { hourUtc: number; weekday: number };
	habits?: { days2?: number; days10?: number; medianGames?: number; players100?: number };
	tiers?: { placed: number; median?: number; min?: number; max?: number; now: Record<string, number>; reached: Record<string, number> };
	streaks?: { reached10?: number; top: Valued[] };
	chars: { charId: number; share: number; players?: number }[];
	teams?: {
		distinct?: number;
		ordered?: number;
		once?: number;
		top10Share?: number;
		mirrors?: number;
		pair?: { a: number; b: number; share?: number };
		top: TeamRow[];
	};
	texture?: { higherRatedWin?: number; firstHitWin?: number };
	upset?: { winner: PlayerRef; winnerRating: number; oppRating: number; gap: number; date?: string; over300?: number } & Partial<SetRef>;
	rivalries?: {
		pairs?: number;
		pairs10?: number;
		most?: { a: PlayerRef; b: PlayerRef; games: number } & Partial<SetRef>;
		even?: { a: PlayerRef; b: PlayerRef; aWins: number; bWins: number } & Partial<SetRef>;
	};
	sets?: { full?: number; scores: { score: string; sets: number }[] };
	perfects?: { total?: number; players?: number; top: Valued[] };
	comebacks?: { total?: number; players?: number; top: Valued[] };
	combo?: { hits: number; date?: string; over100?: number } & Partial<SetRef>;
	climbers?: { since?: string; rows: { player: PlayerRef; delta: number; from?: number; to?: number }[] };
	world?: { known?: number; countries?: number; crossShare?: number; topPair?: [string, string]; top: { cc: string; players: number }[] };
	trust?: { confirmedShare?: number; taped?: number };
	mentions: Mention[];
	unlisted?: Unlisted;
}

type Raw = Record<string, unknown>;
export const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Raw => !!x) : []);
/** a finite number greater than zero, else undefined (zero is "nothing to show") */
export const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
/** a finite number (zero allowed) */
const fin = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

export function playerRef(v: unknown): PlayerRef | null {
	const o = obj(v);
	const steamid = str(o?.steamid);
	const name = str(o?.name);
	if (!o || !steamid || !name) return null;
	return { steamid, name, avatar: str(o.avatar), cc: str(o.cc) };
}
function valued(v: unknown): Valued[] {
	return arr(v).flatMap((r) => {
		const player = playerRef(r.player ?? r);
		const value = pos(r.value);
		return player && value !== undefined ? [{ player, value }] : [];
	});
}
/** SERVER: `tape` is the tape state string ("ready", ...), the spec says boolean. Either means "has a tape". */
export const tapeReady = (v: unknown): boolean => v === true || v === 'ready';
function setRef(o: Raw): Partial<SetRef> {
	const sessionId = str(o.session_id);
	return sessionId ? { sessionId, tape: tapeReady(o.tape) } : {};
}
/** only roster characters count: an id with no name would print as "#255" */
const realChar = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n in CHAR_NAME;
export function teamIds(key: unknown): number[] | null {
	const ids = String(key ?? '').split(',').map(Number);
	return ids.length && ids.every(realChar) ? ids : null;
}
const counts = (v: unknown): Record<string, number> => {
	const o = obj(v) ?? {};
	return Object.fromEntries(Object.entries(o).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)).map(([k, n]) => [k.toLowerCase(), n as number]));
};

/** SERVER: score strings come with an en dash ("10–0"); the spec says a plain hyphen. Accept both, keep one form. */
export const scoreKey = (s: string): string => s.replace('–', '-');

export function normalizeHighlights(raw: unknown): Highlights | null {
	const j = obj(raw);
	if (!j || j.ok === false) return null;
	const out: Highlights = { everyDay: j.every_day === true, months: [], chars: [], mentions: [] };
	out.days = pos(j.days);

	const t = obj(j.time);
	if (t) out.time = { hours: pos(t.hours), timedGames: pos(t.timed_games), medianS: pos(t.median_s), longestS: pos(t.longest_s) };

	out.months = arr(j.months).flatMap((r) => {
		const m = str(r.m);
		const games = fin(r.games);
		return m && /^\d{4}-\d{2}$/.test(m) && games !== undefined
			? [{ m, games, newPlayers: fin(r.new_players), activePlayers: fin(r.active_players), partialThrough: str(r.partial_through) }]
			: [];
	});

	const pk = obj(j.peak);
	if (pk && fin(pk.hour_utc) !== undefined && fin(pk.weekday) !== undefined) out.peak = { hourUtc: pk.hour_utc as number, weekday: pk.weekday as number };
	const h = obj(j.habits);
	if (h) out.habits = { days2: pos(h.days2), days10: pos(h.days10), medianGames: pos(h.median_games), players100: pos(h.players100) };

	const ti = obj(j.tiers);
	if (ti && pos(ti.placed)) {
		out.tiers = { placed: ti.placed as number, median: pos(ti.median), min: pos(ti.min), max: pos(ti.max), now: counts(ti.now), reached: counts(ti.reached) };
	}
	const st = obj(j.streaks);
	if (st) out.streaks = { reached10: pos(st.reached10), top: valued(st.top) };

	out.chars = arr(j.chars).flatMap((r) => (realChar(r.char_id) && fin(r.team_share) !== undefined ? [{ charId: r.char_id, share: r.team_share as number, players: pos(r.players) }] : []));

	const te = obj(j.teams);
	if (te) {
		const top = arr(te.top).flatMap((r) => {
			const team = teamIds(r.team);
			return team ? [{ team, share: pos(r.share), players: pos(r.players) }] : [];
		});
		const pr = obj(te.pair);
		const pair = pr && realChar(pr.a) && realChar(pr.b) ? { a: pr.a, b: pr.b, share: pos(pr.share) } : undefined;
		out.teams = { distinct: pos(te.distinct), ordered: pos(te.ordered), once: pos(te.once), top10Share: pos(te.top10_share), mirrors: pos(te.mirrors), pair, top };
	}
	const tx = obj(j.texture);
	if (tx) out.texture = { higherRatedWin: pos(tx.higher_rated_win), firstHitWin: pos(tx.first_hit_win) };

	const up = obj(j.upset);
	const upW = playerRef(up?.winner);
	if (up && upW && pos(up.gap) && pos(up.winner_rating) && pos(up.opp_rating)) {
		out.upset = { winner: upW, winnerRating: up.winner_rating as number, oppRating: up.opp_rating as number, gap: up.gap as number, date: str(up.date), over300: pos(up.over300), ...setRef(up) };
	}

	const rv = obj(j.rivalries);
	if (rv) {
		const mo = obj(rv.most);
		const ev = obj(rv.even);
		const ma = playerRef(mo?.a), mb = playerRef(mo?.b), ea = playerRef(ev?.a), eb = playerRef(ev?.b);
		out.rivalries = {
			pairs: pos(rv.pairs),
			pairs10: pos(rv.pairs10),
			most: mo && ma && mb && pos(mo.games) ? { a: ma, b: mb, games: mo.games as number, ...setRef(mo) } : undefined,
			even: ev && ea && eb && pos(ev.a_wins) !== undefined && pos(ev.b_wins) !== undefined ? { a: ea, b: eb, aWins: ev.a_wins as number, bWins: ev.b_wins as number, ...setRef(ev) } : undefined
		};
	}
	const se = obj(j.sets);
	if (se) {
		const scores = arr(se.scores).flatMap((r) => (str(r.score) && pos(r.sets) ? [{ score: scoreKey(r.score as string), sets: r.sets as number }] : []));
		out.sets = { full: pos(se.full), scores };
	}
	for (const k of ['perfects', 'comebacks'] as const) {
		const o = obj(j[k]);
		if (o) out[k] = { total: pos(o.total), players: pos(o.players), top: valued(o.top) };
	}
	const co = obj(j.combo);
	if (co && pos(co.hits)) out.combo = { hits: co.hits as number, date: str(co.date), over100: pos(co.over100), ...setRef(co) };

	const cl = obj(j.climbers);
	if (cl) {
		const rows = arr(cl.rows).flatMap((r) => {
			const player = playerRef(r.player);
			const delta = pos(r.delta);
			return player && delta !== undefined ? [{ player, delta, from: pos(r.from), to: pos(r.to) }] : [];
		});
		out.climbers = { since: str(cl.since), rows };
	}
	const wo = obj(j.world);
	if (wo) {
		const top = arr(wo.top).flatMap((r) => (typeof r.cc === 'string' && /^[A-Za-z]{2}$/.test(r.cc) && pos(r.players) ? [{ cc: r.cc.toUpperCase(), players: r.players as number }] : []));
		const tp = Array.isArray(wo.top_pair) && wo.top_pair.length === 2 && wo.top_pair.every((c) => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)) ? ([String(wo.top_pair[0]).toUpperCase(), String(wo.top_pair[1]).toUpperCase()] as [string, string]) : undefined;
		out.world = { known: pos(wo.known), countries: pos(wo.countries), crossShare: pos(wo.cross_share), topPair: tp, top };
	}
	const tr = obj(j.trust);
	if (tr) out.trust = { confirmedShare: pos(tr.confirmed_share), taped: pos(tr.taped) };

	const ul = obj(j.unlisted);
	if (ul) {
		const top = arr(ul.top).flatMap((r): UnlistedRow[] => {
			const player = playerRef(r.player);
			const rating = pos(r.rating);
			return player && rating !== undefined ? [{ player, rating, peak: pos(r.peak), wins: fin(r.wins), losses: fin(r.losses), games: pos(r.games), overallPlace: pos(r.overall_place), tier: str(r.tier)?.toLowerCase() }] : [];
		});
		const mostActive = arr(ul.most_active).flatMap((r) => {
			const player = playerRef(r.player);
			const games = pos(r.games);
			return player && games !== undefined ? [{ player, games, days: pos(r.days) }] : [];
		});
		const count = pos(ul.count);
		if (count !== undefined || top.length || mostActive.length) out.unlisted = { count: count ?? Math.max(top.length, mostActive.length), withWins: pos(ul.with_wins), placed: pos(ul.placed), top, mostActive };
	}
	out.mentions = arr(j.mentions).flatMap((r) => {
		const player = playerRef(r.player);
		if (!player) return [];
		const boards = arr(r.boards).flatMap((b) => {
			const key = str(b.key);
			const label = str(b.label);
			const value = typeof b.value === 'string' ? str(b.value) : pos(b.value);
			if (!key || !label || value === undefined) return [];
			return [{ key, label, value, rank: typeof b.rank === 'number' && b.rank >= 1 && b.rank <= 3 ? b.rank : null }];
		});
		return boards.length ? [{ player, place: pos(r.place), tier: str(r.tier)?.toLowerCase(), boards }] : [];
	});
	return out;
}

/** GET /rr/season/highlights. null on any failure (404 = older server): the page then shows only what the summary gives. */
export async function fetchHighlights(seasonId: string): Promise<Highlights | null> {
	try {
		return normalizeHighlights(await apiGet<unknown>(withSeason('/rr/season/highlights', seasonId)));
	} catch {
		return null;
	}
}
