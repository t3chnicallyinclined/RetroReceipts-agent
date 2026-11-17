// Season finale: "Special thanks". GET /rr/season/players?season=<id>:
//   regulars[{player{steamid,name,avatar,cc}, days, games}]  players who played on `regular_days` or more days
//   everyone[{steamid, name}]                                every player with at least one game
//   counts{regulars, everyone}, regular_days
// Names are user-controlled text: they are only ever rendered as text (Svelte escapes), never as HTML.
// 404 (older server) or a malformed body gives null and the section is simply absent.

import { apiGet } from '../net.svelte';
import { withSeason } from '../seasons';
import { obj, playerRef, pos, type PlayerRef } from './highlights';

export interface Regular {
	player: PlayerRef;
	days: number;
}
export interface Roster {
	regulars: Regular[];
	/** `onRoster` is undefined on a server that has no roster yet */
	everyone: { steamid: string; name: string; onRoster?: boolean }[];
	regularDays: number;
	counts?: { roster?: number; everyone?: number; regulars?: number };
}

export function normalizeRoster(raw: unknown): Roster | null {
	const j = obj(raw);
	if (!j || j.ok === false) return null;
	const regulars = (Array.isArray(j.regulars) ? j.regulars : []).flatMap((r): Regular[] => {
		const o = obj(r);
		const player = playerRef(o?.player ?? o);
		const days = pos(o?.days);
		return player && days !== undefined ? [{ player, days }] : [];
	});
	const seen = new Set<string>();
	const everyone = (Array.isArray(j.everyone) ? j.everyone : []).flatMap((r) => {
		const o = obj(r);
		const steamid = typeof o?.steamid === 'string' ? o.steamid : '';
		const name = typeof o?.name === 'string' ? o.name.trim() : '';
		if (!steamid || !name || seen.has(steamid)) return [];
		seen.add(steamid);
		return [{ steamid, name, onRoster: typeof o?.on_roster === 'boolean' ? o.on_roster : undefined }];
	});
	if (!regulars.length && !everyone.length) return null;
	const c = obj(j.counts);
	return { regulars, everyone, regularDays: pos(j.regular_days) ?? 10, counts: c ? { roster: pos(c.roster), everyone: pos(c.everyone), regulars: pos(c.regulars) } : undefined };
}

export async function fetchRoster(seasonId: string): Promise<Roster | null> {
	try {
		return normalizeRoster(await apiGet<unknown>(withSeason('/rr/season/players', seasonId)));
	} catch {
		return null;
	}
}

/** How many names show before "Show all". A short list (tiny season) shows entirely, with no button. */
export const FIRST_SCREEN = 60;

/** Case-insensitive "contains" on the name as stored; an empty query keeps everyone. */
export function filterNames<T extends { name: string }>(list: T[], query: string): T[] {
	const q = query.trim().toLowerCase();
	return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
}

export interface NameWindow<T> {
	shown: T[];
	/** names hidden behind "Show all" (0 when there is nothing to expand) */
	hidden: number;
}
/** The names to render: all when expanded, when filtering, or when the list is short; else the first screenful. */
export function windowNames<T>(list: T[], expanded: boolean, filtering: boolean, first = FIRST_SCREEN): NameWindow<T> {
	if (expanded || filtering || list.length <= first + 12) return { shown: list, hidden: 0 };
	return { shown: list.slice(0, first), hidden: list.length - first };
}

/**
 * "Find me": the signed-in viewer's own row. Returns its index in the FULL list (so the caller can expand if the
 * row is hidden), or -1 when the viewer is signed out or did not play.
 */
export function findMe(list: { steamid: string }[], steamid: string | null | undefined): number {
	if (!steamid) return -1;
	return list.findIndex((p) => p.steamid === steamid);
}
