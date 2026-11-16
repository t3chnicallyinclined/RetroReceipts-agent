// Season launch: the pure logic behind the announcement card, the join strip and the "new season started" notice.
// Registration is a FLAG ONLY: nothing here ties registration to how any game is treated.

import type { Season, SeasonTable } from './seasons';

export const ANNOUNCE_DAYS = 21;
const DAY_MS = 86_400_000;

export interface Announcement {
	ended: Season;
	open: Season;
}

/**
 * The app-wide "season closed, new season open" card, derived from the seasons table alone (it reaches visitors
 * who arrive cold, which the live broadcast banner cannot). Shown only when:
 *  - there is a table with an OPEN current season and the season right before it has an end date,
 *  - that season ended within ANNOUNCE_DAYS of `now`,
 *  - the visitor has not dismissed it (dismissal is per ended season).
 * An old server or a single-season server has no such pair, so nothing shows.
 */
export function announcementFor(table: SeasonTable | null, now: number, dismissed: ReadonlySet<string>): Announcement | null {
	if (!table || table.seasons.length < 2) return null;
	const i = table.seasons.findIndex((s) => s.id === table.current);
	if (i < 1) return null;
	const open = table.seasons[i];
	const ended = table.seasons[i - 1];
	if (open.end_ms != null || ended.end_ms == null) return null;
	const age = now - ended.end_ms;
	if (age < 0 || age > ANNOUNCE_DAYS * DAY_MS) return null;
	if (dismissed.has(ended.id)) return null;
	return { ended, open };
}

/**
 * Pages that do not show the card: the LIVE tab (its own banners were just cut so the match is the first thing on
 * screen) and the finale itself (the card would only point at the page you are on). `base` is the app's path prefix.
 */
export function announcementHiddenOn(pathname: string, base = ''): boolean {
	const p = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
	return p === '/match' || p.startsWith('/match/') || p.startsWith('/season/');
}

const KEY = 'rr:season-announce:dismissed';
/** Dismissed ended-season ids, from localStorage. Works without it (private mode, blocked storage). */
export function readDismissed(): Set<string> {
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
	} catch {
		return new Set();
	}
}
export function writeDismissed(ids: ReadonlySet<string>): void {
	try {
		localStorage.setItem(KEY, JSON.stringify([...ids]));
	} catch {
		/* storage blocked: the card simply comes back next visit */
	}
}

// ── the join strip ──────────────────────────────────────────────────────────────────────────────

export type JoinState =
	/** nothing to show: finished season, old server, or already registered before this visit */
	| 'hidden'
	/** signed out: "Sign in to register for {label}" */
	| 'signin'
	/** signed in, not registered, status known: the one-tap "Join {label}" */
	| 'join'
	/** the join call is in flight */
	| 'busy'
	/** registered just now: a quiet confirmation */
	| 'done'
	/** the server refused an older, unproven sign-in: "Please sign in with Steam once more to register." */
	| 'resign';

export function joinStripState(a: {
	/** the viewer is looking at the current open season */
	current: boolean;
	authed: boolean;
	/** registration status has been read (never offer Join before it is known) */
	known: boolean;
	registered: boolean;
	busy: boolean;
	/** registered during this visit (the confirmation) */
	justJoined: boolean;
	refusal: 'signin' | 'error' | null;
}): JoinState {
	if (!a.current) return 'hidden';
	if (a.justJoined) return 'done';
	if (!a.authed) return 'signin';
	if (a.refusal === 'signin') return 'resign';
	if (!a.known || a.registered) return 'hidden';
	return a.busy ? 'busy' : 'join';
}

/** Map a failed register call to what to show. 403 "Sign in with Steam to register." = an unproven sign-in. */
export function registerRefusal(error: string | undefined): 'signin' | 'error' {
	const e = (error ?? '').toLowerCase();
	return e.includes('sign in') || e.includes('session expired') || e.includes('unauthorized') ? 'signin' : 'error';
}
export const RESIGN_COPY = 'Please sign in with Steam once more to register.';

// ── a season change while the app is open ───────────────────────────────────────────────────────

/** True when the table's current season is no longer the one this tab started with. */
export function seasonChanged(baseline: string | null, now: string | null): boolean {
	return !!baseline && !!now && baseline !== now;
}
