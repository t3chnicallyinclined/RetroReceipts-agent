// Season wrap-up ("finale") page: types, the one fetch, and the pure shaping. Kept in one small module so the
// field names can be matched to the server in one place.
//
// Server shapes (server/src/stats.rs `season_summary`, routes.rs `/skinsync/season/summary`, app path
// `/rr/season/summary?season=<id>`; the ladder is the ordinary `/rr/leaderboard?tab=rating&season=<id>`).
// Every stat below is OPTIONAL: a missing field, a zero (the server returns zeros for an empty season) or a
// 404 (older server) simply drops that item. Nothing is ever filled in with a made-up or zero number.

import { apiGet } from './net.svelte';
import { withSeason, type Season, type SeasonTable } from './seasons';
import { CHAR_NAME, charName } from './chars';
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

// ── the ladder: top 3 + places 4 to 8 ───────────────────────────────────────────────────────────

export interface Ladder {
	/** podium players, in place order (1st, 2nd, 3rd); empty unless there are at least 3 players */
	podium: Player[];
	/** rows after the podium (places 4-8), or every row (places 1-8) when the board is too short for a podium */
	rows: { player: Player; pos: number }[];
}

export function shapeLadder(players: Player[] | undefined | null): Ladder {
	const all = (Array.isArray(players) ? players : []).filter((p) => p && p.steamid).slice(0, 8);
	if (all.length >= 3) {
		return { podium: all.slice(0, 3), rows: all.slice(3).map((player, i) => ({ player, pos: i + 4 })) };
	}
	return { podium: [], rows: all.map((player, i) => ({ player, pos: i + 1 })) };
}

export async function fetchLadder(seasonId: string): Promise<Player[]> {
	const url = withSeason('/rr/leaderboard?tab=rating&period=all&scope=ranked&limit=8', seasonId);
	const res = await apiGet<{ players?: Player[]; season?: string }>(url);
	// the server names the season it answered for; never show another season's ladder on this page
	if (res.season && res.season !== seasonId) return [];
	return Array.isArray(res.players) ? res.players : [];
}

// ── the summary ─────────────────────────────────────────────────────────────────────────────────

export interface StatTile {
	key: string;
	label: string;
	value: string;
	/** small second line, e.g. a player's name */
	note?: string;
	/** profile to link the note to */
	steamid?: string;
}

export interface BoardRow {
	label: string;
	value: string;
	steamid?: string;
}

export interface MiniBoard {
	key: string;
	title: string;
	rows: BoardRow[];
}

export interface Finale {
	tiles: StatTile[];
	/** game totals by mode, only the modes with games */
	modes: { label: string; value: string }[];
	boards: MiniBoard[];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Raw => !!x) : []);
/** a finite number greater than zero, else undefined (zero is "nothing to show", never printed) */
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
const n1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');

/** "2026-11-16" -> "16 Nov 2026" (the server's UTC date, formatted without a timezone shift) */
export function dayLabel(iso: string): string | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return undefined;
	const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const mon = MON[Number(m[2]) - 1];
	return mon ? `${Number(m[3])} ${mon} ${m[1]}` : undefined;
}

/** a team key "44,42,52" -> "Magneto / Storm / Sentinel" */
function teamName(key: string): string | undefined {
	const ids = key.split(',').map(Number);
	// an id that is not a real roster entry (e.g. an empty slot recorded as 255) would print as "#255": drop the row
	if (!ids.length || ids.some((n) => !Number.isInteger(n) || !(n in CHAR_NAME))) return undefined;
	return ids.map(charName).join(' / ');
}

// the "other leaderboards": server key under `top` -> plain title
const PLAYER_BOARDS: [string, string][] = [
	['wins', 'Most wins'],
	['games', 'Most games played'],
	['best_streak', 'Longest win streak'],
	['peak_rating', 'Highest rating reached'],
	['perfects', 'Most perfects'],
	['ocvs', 'Most one-character victories'],
	['comebacks', 'Most comebacks']
];

/** Turn the raw summary body into only what can honestly be shown. Never throws. */
export function shapeSummary(raw: unknown): Finale | null {
	const j = obj(raw);
	if (!j || j.ok === false) return null;
	const tiles: StatTile[] = [];
	const add = (key: string, label: string, v: number | undefined, fmt = n0, note?: string, steamid?: string) => {
		if (v !== undefined) tiles.push({ key, label, value: fmt(v), note, steamid });
	};

	const games = obj(j.games);
	add('games', 'Games played', pos(games?.total));
	add('sets', 'Sets played', pos(games?.sets));

	const players = obj(j.players);
	add('players', 'Players', pos(players?.played));
	add('ranked', 'Players with ranked games', pos(players?.ranked));

	const act = obj(j.activity);
	const gpp = obj(act?.games_per_player);
	add('avg', 'Games per player (average)', pos(gpp?.average), n1);
	add('median', 'Games per player (median)', pos(gpp?.median), n1);
	const mp = obj(gpp?.max_player);
	add('most', 'Most games by one player', pos(gpp?.max), n0, str(mp?.name), str(mp?.steamid));
	const bd = obj(act?.busiest_day);
	const day = str(bd?.date) ? dayLabel(String(bd?.date)) : undefined;
	if (day && pos(bd?.games)) tiles.push({ key: 'busiest', label: 'Busiest day', value: day, note: `${n0(pos(bd?.games)!)} games` });

	// Accounts. Labelled for what the server field is, not as "installs".
	const acc = obj(j.accounts);
	// `installs` = distinct Steam accounts in the registration log as of the season end (app or website sign-in,
	// so never worded as "installed"). For a finished season with accounts of unknown sign-up time it is a lower bound.
	const signed = pos(acc?.installs);
	add('signedup', 'players signed up', signed, (n) => (acc?.installs_is_lower_bound === true ? `At least ${n0(n)}` : n0(n)));
	add('signedplayed', 'of them played at least one game', pos(acc?.installs_played));
	// registered_in_season_with_agent_build = of those who FIRST signed up inside the season, those whose desktop
	// app reported a build (heartbeat `ver`).
	add('withapp', 'players who first signed up this season and ran the desktop app', pos(acc?.registered_in_season_with_agent_build));
	add('registered', 'Players who registered for the season', pos(acc?.season_registrations));

	const bm = obj(games?.by_mode);
	const MODES: [string, string][] = [
		['ranked', 'Ranked'],
		['lobby', 'Lobby'],
		['tourney', 'Tournament'],
		['money', 'Money match']
	];
	const modes = MODES.flatMap(([k, label]) => {
		const v = pos(bm?.[k]);
		return v === undefined ? [] : [{ label, value: n0(v) }];
	});

	const top = obj(j.top);
	const boards: MiniBoard[] = [];
	for (const [k, title] of PLAYER_BOARDS) {
		const rows = arr(top?.[k]).flatMap((r) => {
			const v = pos(r.value);
			const name = str(r.name);
			return v !== undefined && name ? [{ label: name, value: n0(v), steamid: str(r.steamid) }] : [];
		});
		if (rows.length) boards.push({ key: k, title, rows });
	}
	const teams = arr(top?.teams).flatMap((r) => {
		const name = str(r.team) ? teamName(String(r.team)) : undefined;
		const g = pos(r.games);
		return name && g !== undefined ? [{ label: name, value: `${n0(g)} games` }] : [];
	});
	if (teams.length) boards.push({ key: 'teams', title: 'Most played teams', rows: teams });
	const chars = arr(top?.characters).flatMap((r) => {
		const id = typeof r.char_id === 'number' && r.char_id in CHAR_NAME ? r.char_id : undefined;
		const g = pos(r.games);
		return id !== undefined && g !== undefined ? [{ label: charName(id), value: `${n0(g)} games` }] : [];
	});
	if (chars.length) boards.push({ key: 'characters', title: 'Most played characters', rows: chars });
	const regions = arr(top?.regions).flatMap((r) => {
		const name = str(r.name);
		const p = pos(r.players);
		return name && p !== undefined ? [{ label: name, value: `${n0(p)} player${p === 1 ? '' : 's'}` }] : [];
	});
	if (regions.length) boards.push({ key: 'regions', title: 'Busiest regions', rows: regions });

	if (!tiles.length && !modes.length && !boards.length) return null;
	return { tiles, modes, boards };
}

/** GET /rr/season/summary?season=<id>. null on any failure (404 = older server): the page just hides the stats. */
export async function fetchFinale(seasonId: string): Promise<Finale | null> {
	try {
		return shapeSummary(await apiGet<unknown>(withSeason('/rr/season/summary', seasonId)));
	} catch {
		return null;
	}
}
