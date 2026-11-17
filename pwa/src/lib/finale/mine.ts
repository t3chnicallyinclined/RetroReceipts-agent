// Season finale: "Your season". The signed-in viewer's own profile for the season (GET /rr/profile?season=) plus
// its `season_card` block. A server without the block still gives the rating, record and tier.

import { apiGet } from '../net.svelte';
import { withSeason } from '../seasons';
import { obj, pos } from './highlights';
import { normalizeSeasonCard, type SeasonCardData } from './derive';
import { normalizeBadges, type Badge } from './badges';
import { RANK_MIN_GAMES } from '../ranks';

export interface Mine {
	found: boolean;
	name: string;
	avatar?: string;
	cc?: string;
	rating: number;
	wins: number;
	losses: number;
	bestStreak?: number;
	peak?: number;
	team?: number[];
	card: SeasonCardData | null;
	/** on the season's roster (listed on its boards); undefined when the server does not say */
	onRoster?: boolean;
	/** the server's season badges for this player (all finished seasons); [] when the server sends none */
	badges: Badge[];
}

export const mineGames = (m: Mine): number => m.wins + m.losses;
/** a rank needs RANK_MIN_GAMES ranked games */
export const mineUnranked = (m: Mine): boolean => mineGames(m) < RANK_MIN_GAMES;

export function normalizeMine(raw: unknown): Mine | null {
	const j = obj(raw);
	if (!j) return null;
	const wins = typeof j.wins === 'number' ? j.wins : 0;
	const losses = typeof j.losses === 'number' ? j.losses : 0;
	const teams = Array.isArray(j.teams) ? j.teams : [];
	const t0 = obj(teams[0]);
	const team = typeof t0?.team === 'string' ? t0.team.split(',').map(Number).filter((n) => Number.isFinite(n)) : undefined;
	return {
		found: j.found === true && wins + losses > 0,
		name: typeof j.name === 'string' && j.name ? j.name : 'Player',
		avatar: typeof j.avatar === 'string' ? j.avatar : undefined,
		cc: typeof j.cc === 'string' && j.cc ? j.cc : undefined,
		rating: typeof j.rating === 'number' ? j.rating : 1000,
		wins,
		losses,
		bestStreak: pos(j.best_streak),
		peak: pos(j.peak_rating),
		team: team?.length ? team : undefined,
		card: normalizeSeasonCard(j.season_card),
		onRoster: typeof j.on_roster === 'boolean' ? j.on_roster : undefined,
		badges: normalizeBadges(j.badges)
	};
}

export async function fetchMine(steamid: string, seasonId: string, token: string | null): Promise<Mine | null> {
	try {
		return normalizeMine(await apiGet<unknown>(withSeason(`/rr/profile?steamid=${encodeURIComponent(steamid)}`, seasonId), { token }));
	} catch {
		return null;
	}
}
