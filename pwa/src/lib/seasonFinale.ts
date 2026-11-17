// Season finale page: availability, the ladder, the summary. Highlights, feedback and the pure display shaping
// live in lib/finale/.
//
// Server shapes (server/src/stats.rs `season_summary`, app path `/rr/season/summary?season=<id>`; the ladder is
// the ordinary `/rr/leaderboard?tab=rating&season=<id>`). Every figure is OPTIONAL: a missing field, a zero (the
// server returns zeros for an empty season) or a 404 (older server) drops that item. Nothing is ever filled in
// with a made-up or zero number.

import { apiGet } from './net.svelte';
import { withSeason, type Season, type SeasonTable } from './seasons';
import { playerRef, obj, pos, type PlayerRef, type Valued } from './finale/highlights';
import type { Player } from './types';

// ── availability ────────────────────────────────────────────────────────────────────────────────

export type FinaleAvailability =
	| { state: 'ready'; season: Season; next: Season | null }
	| { state: 'unavailable' };

/** A wrap-up exists only for a season the server marks finished (end_ms set). Anything else: unavailable. */
export function finaleAvailability(table: SeasonTable | null, id: string): FinaleAvailability {
	if (!table) return { state: 'unavailable' };
	const i = table.seasons.findIndex((s) => s.id === id);
	if (i < 0) return { state: 'unavailable' };
	const season = table.seasons[i];
	if (season.end_ms == null || season.id === table.current) return { state: 'unavailable' };
	return { state: 'ready', season, next: table.seasons[i + 1] ?? null };
}

// ── the ladder: champion, 2nd and 3rd, places 4 to 8 ────────────────────────────────────────────

export interface Ladder {
	/** 1st place, from one player up; null for an empty ladder */
	champion: Player | null;
	/** 2nd and 3rd place (zero, one or two players) */
	side: Player[];
	/** places 4 to 8 */
	rows: { player: Player; pos: number }[];
	count: number;
}

export function shapeLadder(players: Player[] | undefined | null): Ladder {
	const all = (Array.isArray(players) ? players : []).filter((p) => p && p.steamid).slice(0, 8);
	return {
		champion: all[0] ?? null,
		side: all.slice(1, 3),
		rows: all.slice(3).map((player, i) => ({ player, pos: i + 4 })),
		count: all.length
	};
}

export async function fetchLadder(seasonId: string): Promise<Player[]> {
	const url = withSeason('/rr/leaderboard?tab=rating&period=all&scope=ranked&limit=8', seasonId);
	const res = await apiGet<{ players?: Player[]; season?: string }>(url);
	// the server names the season it answered for; never show another season's ladder on this page
	if (res.season && res.season !== seasonId) return [];
	return Array.isArray(res.players) ? res.players : [];
}

// ── the summary ─────────────────────────────────────────────────────────────────────────────────

/** keys of `top` that name a player list the page may use (no OCVs: the flag's meaning is unconfirmed) */
export type HonourKey = 'best_streak' | 'wins' | 'peak_rating' | 'perfects' | 'comebacks' | 'games';
export const HONOUR_KEYS: HonourKey[] = ['best_streak', 'wins', 'peak_rating', 'perfects', 'comebacks', 'games'];

export interface Summary {
	games?: number;
	sets?: number;
	players?: number;
	/** players ON the season roster (signed up); absent on a server that has no roster yet */
	roster?: number;
	/** players with games who are not on the roster */
	unlisted?: number;
	/** players who finished with a rank (5+ ranked games) */
	placed?: number;
	/** game counts by mode; only ranked, casual lobby and tournament, and only when two or more are non-zero */
	modes: { key: 'ranked' | 'lobby' | 'tourney'; label: string; value: number }[];
	busiestDay?: { date: string; games: number };
	medianGames?: number;
	/** epoch ms, only when after 2020-01-01 (old rows carry seconds) */
	firstMs?: number;
	lastMs?: number;
	top: Partial<Record<HonourKey, Valued[]>>;
}

/** 2020-01-01 UTC: any earlier "millisecond" value is a seconds-era row and is treated as missing */
export const MIN_SANE_MS = 1577836800000;
export const saneMs = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= MIN_SANE_MS ? v : undefined);

export function shapeSummary(raw: unknown): Summary | null {
	const j = obj(raw);
	if (!j || j.ok === false) return null;
	const games = obj(j.games);
	const players = obj(j.players);
	const act = obj(j.activity);
	const bm = obj(games?.by_mode);
	const MODES = [
		['ranked', 'Ranked'],
		['lobby', 'Casual lobby'],
		['tourney', 'Tournament']
	] as const;
	const modes = MODES.flatMap(([key, label]) => {
		const value = pos(bm?.[key]);
		return value === undefined ? [] : [{ key, label, value }];
	});
	const bd = obj(act?.busiest_day);
	const date = typeof bd?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bd.date) ? bd.date : undefined;
	const top = obj(j.top);
	const lists: Partial<Record<HonourKey, Valued[]>> = {};
	for (const k of HONOUR_KEYS) {
		const rows = (Array.isArray(top?.[k]) ? (top?.[k] as unknown[]) : []).flatMap((r) => {
			const o = obj(r);
			const player: PlayerRef | null = playerRef(o);
			const value = pos(o?.value);
			return player && value !== undefined ? [{ player, value }] : [];
		});
		if (rows.length) lists[k] = rows;
	}
	const s: Summary = {
		games: pos(games?.total),
		sets: pos(games?.sets),
		players: pos(players?.played),
		roster: pos(players?.roster),
		unlisted: pos(players?.unlisted),
		placed: pos(players?.placed),
		modes: modes.length >= 2 ? [...modes] : [],
		busiestDay: date && pos(bd?.games) ? { date, games: bd?.games as number } : undefined,
		medianGames: pos(obj(act?.games_per_player)?.median),
		firstMs: saneMs(act?.first_match_ms),
		lastMs: saneMs(act?.last_match_ms),
		top: lists
	};
	const any = s.games || s.sets || s.players || s.placed || s.busiestDay || s.medianGames || Object.keys(lists).length;
	return any ? s : null;
}

/** GET /rr/season/summary. null on any failure (404 = older server): the page then shows no stats. */
export async function fetchSummary(seasonId: string): Promise<Summary | null> {
	try {
		return shapeSummary(await apiGet<unknown>(withSeason('/rr/season/summary', seasonId)));
	} catch {
		return null;
	}
}

/** "2026-11-16" -> "16 Nov 2026" (the server's UTC date, formatted without a timezone shift) */
export function dayLabel(iso: string): string | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return undefined;
	const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const mon = MON[Number(m[2]) - 1];
	return mon ? `${Number(m[3])} ${mon} ${m[1]}` : undefined;
}
