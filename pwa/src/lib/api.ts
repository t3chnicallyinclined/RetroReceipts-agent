import { apiGet } from './net.svelte';
import type { LeaderboardResponse, LeaderboardTab, LeaderboardPeriod } from './types';
import type { LeaderboardScope } from './boards';

/** The board response plus the server's echoed `scope` — used as the version-skew guard (a pre-scope
 *  server omits it or echoes `ranked`, so the store must not render its rows under a scoped view).
 *  Declared here (not types.ts, which is off-limits) as an extension of the shipped response shape. */
export type ScopedLeaderboardResponse = LeaderboardResponse & { scope?: string };

/**
 * GET /rr/leaderboard?tab=…&period=…&scope=…&limit=…
 * Live data source for the board. Same-origin in prod (nobd.net/app); Vite-proxied in dev.
 * `scope` defaults to `ranked` (legacy behaviour: ratings + tier titles + region fast-path).
 */
export async function fetchLeaderboard(
	tab: LeaderboardTab,
	period: LeaderboardPeriod,
	scope: LeaderboardScope = 'ranked',
	limit = 50,
	signal?: AbortSignal
): Promise<ScopedLeaderboardResponse> {
	// SSOT sweep fix: through apiGet, so the board shares the dedup layer and — critically — the
	// app-wide invalidate('/rr/leaderboard') on match_result actually clears something (it was a dead
	// no-op against a raw fetch). `signal` is accepted for API compatibility but unused: in-flight
	// dedup makes an abort race harmless and the store already guards with a request id.
	void signal;
	return apiGet<ScopedLeaderboardResponse>(
		`/rr/leaderboard?tab=${encodeURIComponent(tab)}&period=${encodeURIComponent(period)}&scope=${encodeURIComponent(scope)}&limit=${limit}`
	);
}
