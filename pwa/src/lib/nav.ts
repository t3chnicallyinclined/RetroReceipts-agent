// The primary arena tabs. Regions is intentionally NOT here — the city/region leaderboard lives inside the
// Ranks page (a board mode there); /regions stays a deep-linkable route but is off the primary nav.
export interface NavItem {
	id: string;
	label: string;
	href: string;
	/** stroke-SVG path(s) on a 24×24 viewBox, drawn on currentColor. */
	d: string;
	live: boolean;
}

// Primary nav = the competitive core only. Two deliberate off-nav routes (still deep-linkable, like
// /regions & /library): SKINS lives in the account menu (a personal loadout tool), and FLEET is folded
// into Match as "The Arcade" live cabinet map (live money-match discovery belongs on the money axis).
export const NAV: NavItem[] = [
	{
		// Match — the money-match / live hub (the core of the app).
		id: 'match',
		label: 'Match',
		href: '/match',
		d: 'M4 20 L17 7 M17 7 h-3.6 M17 7 v3.6 M20 20 L7 7 M7 7 h3.6 M7 7 v3.6',
		live: true
	},
	{ id: 'ranks', label: 'Ranks', href: '/ranks', d: 'M5 21 V10 M12 21 V4 M19 21 V14', live: true },
	{
		id: 'tournament',
		label: 'Tournament',
		href: '/tournament',
		d: 'M6 3 v18 M6 4 h12 l-3 4 l3 4 H6',
		live: false
	}
];
