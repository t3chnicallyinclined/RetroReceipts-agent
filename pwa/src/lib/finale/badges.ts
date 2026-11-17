// Season badges, from the SERVER only (profile `badges`, finished seasons only). Nothing is computed here: this module
// shapes what the server sent, orders it strongest first, and collapses it for a phone. An absent or malformed field is
// "no badges" and every surface hides.
//
// Server shape (server/src/highlights.rs `badges_for`, commit 72d3b58):
//   badges: [{season, kind, label, rank|null}]
//   champion  "Champion of {label}" rank 1        podium  "2nd place in {label}" / "3rd place in {label}" rank 2 / 3
//   top8      "Top 8 in {label}" rank 4-8         tier    the tier name, rank null
//   tester    "Ran the app in {label}"            made_rank "Made rank without the app", rank = overall place
//   played    "Played {label}"
export type BadgeKind = 'champion' | 'podium' | 'top8' | 'tier' | 'made_rank' | 'tester' | 'played';

export interface Badge {
	season: string;
	kind: BadgeKind;
	label: string;
	rank: number | null;
}

/** strongest first (the order the row shows them in) */
export const BADGE_ORDER: readonly BadgeKind[] = ['champion', 'podium', 'top8', 'tier', 'made_rank', 'tester', 'played'];

/** one plain line per kind: what the badge means */
export const BADGE_LEGEND: Record<BadgeKind, string> = {
	champion: 'Finished first on the final ladder.',
	podium: 'Finished second or third on the final ladder.',
	top8: 'Finished fourth to eighth on the final ladder.',
	tier: 'The tier they finished in.',
	made_rank: 'Never ran the app, and their recorded games still ranked among the best.',
	tester: 'Ran the app during the season.',
	played: 'Played at least one game that season.'
};

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

/** server `badges` -> typed, one per (season, kind, label), strongest first (then season, then place). Anything else is dropped. */
export function normalizeBadges(raw: unknown): Badge[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: Badge[] = [];
	for (const e of raw) {
		const o = obj(e);
		if (!o) continue;
		const kind = o.kind as BadgeKind;
		const label = typeof o.label === 'string' ? o.label.trim() : '';
		const season = typeof o.season === 'string' ? o.season : '';
		if (!BADGE_ORDER.includes(kind) || !label || !season) continue;
		const rank = typeof o.rank === 'number' && Number.isInteger(o.rank) && o.rank > 0 ? o.rank : null;
		const key = `${season}|${kind}|${label}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ season, kind, label, rank });
	}
	return out.sort((a, b) => BADGE_ORDER.indexOf(a.kind) - BADGE_ORDER.indexOf(b.kind) || a.season.localeCompare(b.season) || (a.rank ?? 99) - (b.rank ?? 99));
}

/** only this season's badges (the finale's record card) */
export const badgesFor = (list: Badge[] | undefined, season: string): Badge[] => (list ?? []).filter((b) => b.season === season);

/** the first `max` badges and how many are folded into "+N" (a phone shows fewer) */
export function collapseBadges(list: Badge[], max: number): { shown: Badge[]; more: number } {
	const m = Math.max(1, Math.floor(max));
	return { shown: list.slice(0, m), more: Math.max(0, list.length - m) };
}

/** gold is for the champion alone; the rest are neutral, the tier badge takes its tier colour */
export const isGold = (b: Pick<Badge, 'kind'>): boolean => b.kind === 'champion';
export const badgeTitle = (b: Pick<Badge, 'kind' | 'label'>): string => `${b.label}. ${BADGE_LEGEND[b.kind]}`;
