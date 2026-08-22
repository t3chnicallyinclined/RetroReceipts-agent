// The Marvel Ladder — ported verbatim from web/index.html (RANK_TIERS / rankOf / RK_PLATE).
// ⚠ Cutoffs mirror skinsync/src/elo.rs rank_tier (K=32 zero-sum ELO, base 1000). The CLIENT derives
// tiers from rating+games so badges render correctly even against an older server payload — never trust
// a server-supplied rank string (DESIGN-SYSTEM.md "Badges" rule).

export interface Tier {
	n: string; // display name
	lo: number;
	hi: number;
}

export const RANK_TIERS: Tier[] = [
	{ n: 'Iron', lo: 840, hi: 920 },
	{ n: 'Bronze', lo: 920, hi: 980 },
	{ n: 'Silver', lo: 980, hi: 1050 },
	{ n: 'Gold', lo: 1050, hi: 1120 },
	{ n: 'Vibranium', lo: 1120, hi: 1200 },
	{ n: 'Adamantium', lo: 1200, hi: 1300 },
	{ n: 'Herald', lo: 1300, hi: 1400 },
	{ n: 'Infinity', lo: 1400, hi: 1500 },
	{ n: 'Galactus', lo: 1500, hi: Infinity } // the apex — ~top 1% of the pool.
];

export const RANK_MIN_GAMES = 5; // placement gate — mirrors elo.rs MIN_RANKED_GAMES

export interface Rank {
	n: string; // tier name (or "Civilian")
	s: string; // slug for CSS / sprite id (lowercase)
	t?: Tier;
}

export function tierOf(rating: number | null | undefined): Tier {
	const r = typeof rating === 'number' && isFinite(rating) ? rating : 1000;
	return RANK_TIERS.find((t) => r < t.hi) ?? RANK_TIERS[RANK_TIERS.length - 1];
}

// games==null ⇒ no placement info (derive tier straight from rating); games<5 ⇒ Civilian (unplaced)
export function rankOf(rating: number | null | undefined, games: number | null | undefined): Rank {
	if (games != null && games < RANK_MIN_GAMES) return { n: 'Civilian', s: 'civilian' };
	const t = tierOf(rating);
	return { n: t.n, s: t.n.toLowerCase(), t };
}

/**
 * Human ELO band for one tier row. Mirrors web/index.html openRankInfo(): the floor tier reads "< hi"
 * (everything below maps to Iron), the apex reads "lo+", every middle tier reads "lo–(hi-1)". Shared by
 * TierLadder + RankInfoModal.
 */
export function rankRange(t: Tier): string {
	if (t.hi === Infinity) return `${t.lo}+`;
	if (t.n === RANK_TIERS[0].n) return `< ${t.hi}`; // floor tier: the whole sub-band is one rank
	return `${t.lo}–${t.hi - 1}`;
}

// Plate accent pairs (fallback when a player has no equipped-skin colors). Keyed by tier slug.
export const RK_PLATE: Record<string, [string, string]> = {
	civilian: ['#6b7488', '#2a3140'],
	iron: ['#a7adb8', '#63697a'],
	bronze: ['#d59a5f', '#8a5527'],
	silver: ['#cdd7e4', '#93a1b6'],
	gold: ['#f2c74a', '#c98f0e'],
	vibranium: ['#b98cff', '#6428cf'],
	adamantium: ['#9fd4ef', '#48789e'],
	herald: ['#ffb35c', '#2c2456'],
	infinity: ['#ffe9b0', '#241b33'],
	galactus: ['#ff7ae0', '#7a5cff']
};

// Tier text colors (the .rk-* classes live in app.css; this map is for inline/JS use).
export const RK_TEXT: Record<string, string> = {
	civilian: 'var(--dim)',
	iron: '#a7adb8',
	bronze: '#d59a5f',
	silver: '#cdd7e4',
	gold: '#f2c74a',
	vibranium: '#b98cff',
	adamantium: '#9fd4ef',
	herald: '#ffb35c',
	infinity: '#ffe9b0',
	galactus: '#ff7ae0'
};

// Short per-tier lore — the "what this rank means" line. Ported verbatim from web/index.html openRankInfo()
// LORE, re-keyed by slug to match RK_PLATE/RK_TEXT. Client-side copy only.
export const RANK_LORE: Record<string, string> = {
	civilian: `In placements — play ${RANK_MIN_GAMES} games to earn a badge.`,
	iron: "Stark's metal — everyone starts somewhere.",
	bronze: 'The grind. The biggest tier on the ladder.',
	silver: 'The middle of the pack — new players place here at 1000.',
	gold: 'Proven — you beat the field more than it beats you.',
	vibranium: 'Wakanda-grade. Stronger than any common metal.',
	adamantium: 'Unbreakable — claws out.',
	herald: 'Wielding the Power Cosmic, one step from the throne.',
	infinity: 'All six stones. A snap away from the top.',
	galactus: 'The Devourer of ladders — roughly the top 1% of ranked players.'
};

// Tier floors for the cutline seams (WoW-cutoff style) — matches TIER_FLOOR in index.html.
export const TIER_FLOOR: Record<string, number> = {
	galactus: 1500,
	infinity: 1400,
	herald: 1300,
	adamantium: 1200,
	vibranium: 1120,
	gold: 1050,
	silver: 980,
	bronze: 920,
	iron: 0
};

export const gamesOf = (p: { wins?: number; losses?: number }): number =>
	(p.wins ?? 0) + (p.losses ?? 0);

export const winrateOf = (p: { wins?: number; losses?: number }): number => {
	const g = gamesOf(p);
	return g ? Math.round((100 * (p.wins ?? 0)) / g) : 0;
};

// color-coded win% (≥60 green / ≥45 lime / else orange) — Board rule, DESIGN-SYSTEM.md
export const winrateColor = (w: number): string =>
	w >= 60 ? '#4ade80' : w >= 45 ? '#a3e635' : '#fb923c';
