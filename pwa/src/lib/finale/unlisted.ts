// Season finale: the players who are RECORDED but not on the season roster ("unlisted"). They never ran the app; every one
// of their games was recorded from the other side of the match by an app user's agent. Their ratings and records are
// real and unchanged. This module shapes the two sections that speak to them. Pure, unit-tested. Names are user text and
// are only ever returned as strings for the component to render as text.

import type { PlayerRef, Unlisted, UnlistedRow } from './highlights';
import { ordinal } from './derive';
import type { Roster } from './players';

/** the wording of the props section (BUILD: ROSTER-SPEC "App contract"); kept here so it can be edited in one place */
export const PROPS_LEAD = (label: string) =>
	`These players never ran the app. Every one of their games was recorded from the other side of the match, and they still finished among the best in ${label}.`;
export const ELO_EXPLAINER =
	'How that happens: the ladder uses Elo. Your rating moves by who you beat, not by how many games you play. Beat higher-rated players and you climb fast; lose to lower-rated players and you drop. That is why someone with a few dozen games against strong opponents can out-rate someone with thousands.';
export const RECORD_LEAD = (count: number, label: string, nextLabel?: string) =>
	`If you played someone running Retro Receipts, your games were recorded. ${count.toLocaleString('en-US')} players have a ${label} record and never ran the app. Download the app and just play to get on the board for ${nextLabel ?? 'the next season'}, or sign in with Steam to see your stats.`;

/** "would have finished 3rd overall", or nothing when the place is unknown */
export function overallText(r: UnlistedRow): string | undefined {
	return r.overallPlace ? `would have finished ${ordinal(r.overallPlace)} overall` : undefined;
}

/** the cards: best final rating first, as the server sends them; at most `max` */
export function propsCards(u: Unlisted | undefined, max = 12): UnlistedRow[] {
	return (u?.top ?? []).slice(0, max);
}

export interface WallName {
	steamid: string;
	name: string;
}
/** The name wall: the most active and the top unlisted players, de-duplicated by steamid, names as stored. */
export function wallNames(u: Unlisted | undefined): WallName[] {
	const seen = new Set<string>();
	const out: WallName[] = [];
	const add = (p: PlayerRef) => {
		if (!p.steamid || !p.name || seen.has(p.steamid)) return;
		seen.add(p.steamid);
		out.push({ steamid: p.steamid, name: p.name });
	};
	for (const r of u?.mostActive ?? []) add(r.player);
	for (const r of u?.top ?? []) add(r.player);
	return out;
}

/** The searchable list: roll-call rows that are NOT on the roster. Empty when the server does not flag roster rows. */
export function unlistedPool(roster: Roster | null): WallName[] {
	return (roster?.everyone ?? []).filter((p) => p.onRoster === false).map((p) => ({ steamid: p.steamid, name: p.name }));
}

/** the testers: roster players from the roll call (when the server flags roster rows) */
export function testers(roster: Roster | null): Roster['everyone'] {
	return (roster?.everyone ?? []).filter((p) => p.onRoster === true);
}
/** true when the roll call distinguishes roster players (a roster-aware server) */
export function rosterAware(roster: Roster | null): boolean {
	return !!roster && roster.everyone.some((p) => typeof p.onRoster === 'boolean');
}

/** How many filter matches to draw at once (keeps a 500-name list light on a phone). */
export const FIND_CAP = 40;
export function findMatches(pool: WallName[], query: string): { shown: WallName[]; total: number } {
	const q = query.trim().toLowerCase();
	if (q.length < 2) return { shown: [], total: 0 };
	const all = pool.filter((p) => p.name.toLowerCase().includes(q));
	return { shown: all.slice(0, FIND_CAP), total: all.length };
}

/** A name split after "/", "\\" and "|" so a long handle like "twitch.tv/gthrillah" wraps at the slash, not mid-word.
 *  Plain text parts only (names are user text; they are rendered as text with a <wbr> between parts). */
export function breakable(name: string): string[] {
	return name.split(/(?<=[/\\|])/).filter((x) => x.length > 0);
}
