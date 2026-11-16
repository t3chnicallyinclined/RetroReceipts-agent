// Season table helpers — plain TypeScript (no runes, no app imports) so they are unit-testable in node.
// The shapes mirror the server's GET /rr/seasons (server/src/seasons.rs, routes.rs).

export interface Season {
	id: string;
	/** Display name — always comes from the server, never hard-coded in the app. */
	label: string;
	start_ms: number;
	/** null = the open (current) season. */
	end_ms: number | null;
}

export interface SeasonTable {
	/** id of the current (open) season */
	current: string;
	hash?: string;
	/** server order: oldest first, the current season last */
	seasons: Season[];
}

/**
 * Validate a /rr/seasons body. Returns null for anything we can't trust (old server, bad body), which the
 * caller treats exactly like "no seasons": no picker, today's behaviour.
 */
export function parseSeasonTable(json: unknown): SeasonTable | null {
	if (!json || typeof json !== 'object') return null;
	const j = json as { ok?: unknown; current?: unknown; hash?: unknown; seasons?: unknown };
	if (j.ok === false || typeof j.current !== 'string' || !Array.isArray(j.seasons)) return null;
	const seasons: Season[] = [];
	for (const s of j.seasons) {
		if (!s || typeof s !== 'object') return null;
		const r = s as Record<string, unknown>;
		if (typeof r.id !== 'string' || !r.id || typeof r.label !== 'string' || !r.label) return null;
		seasons.push({
			id: r.id,
			label: r.label,
			start_ms: typeof r.start_ms === 'number' ? r.start_ms : 0,
			end_ms: typeof r.end_ms === 'number' ? r.end_ms : null
		});
	}
	if (!seasons.length || !seasons.some((s) => s.id === j.current)) return null;
	return { current: j.current, hash: typeof j.hash === 'string' ? j.hash : undefined, seasons };
}

/** Append `season=<id>` to an app path; a missing id leaves the path untouched (server default = current). */
export function withSeason(path: string, season: string | undefined): string {
	if (!season) return path;
	return `${path}${path.includes('?') ? '&' : '?'}season=${encodeURIComponent(season)}`;
}
