// The finale as the landing page for the OPEN season: the slim strip under the hero, the "{label} is live" block, the
// live numbers and the early leaders. Pure and unit-tested; the components only draw what these return.
//
// Truthful copy only: joining adds you to the season's sign-up count and puts the Registered mark on your profile. It is
// NOT needed to be on the board and unlocks nothing, and nothing here says otherwise.
import type { Player } from '$lib/types';
import type { SeasonTable } from '$lib/seasons';

export type JoinState =
	/** the status has not been read yet: show the count if there is one, no button */
	| 'unknown'
	/** signed out: Sign in through Steam */
	| 'signin'
	/** signed in, not joined: the Join button */
	| 'join'
	| 'busy'
	/** joined: "You're in ✓" */
	| 'in'
	/** the server said 403 (an older, unproven sign-in): "Please sign in with Steam once more." */
	| 'resign';

export function joinState(a: { authed: boolean; known: boolean; registered: boolean; busy: boolean; justJoined: boolean; refusal: 'signin' | 'error' | null }): JoinState {
	if (a.justJoined || (a.authed && a.known && a.registered)) return 'in';
	if (!a.authed) return 'signin';
	if (a.refusal === 'signin') return 'resign';
	if (!a.known) return 'unknown';
	return a.busy ? 'busy' : 'join';
}

export const RESIGN_LINE = 'Please sign in with Steam once more.';
export const IN_LINE = "You're in ✓";

/** the big call to action under the hero and the headline of the full block */
export const BLOCK_HEAD = (label: string) => `${label} is live today`;
export const STRIP_SUB = 'New season. Everyone starts fresh at 1000.';
/** "41 joined", or nothing when the count is absent or zero */
export function joinedLine(joined: number | undefined): string {
	return joined && joined > 0 ? `${joined.toLocaleString('en-US')} joined` : '';
}
/** the owner's voice, honest: nothing here says joining is needed for the board */
export const BLOCK_LEAD = 'New season, clean slate. Everyone starts at 1000, five ranked games gets you a rank, and the board is open to anyone running the app.';

/** the big button: what it says, and what it does */
export interface Cta {
	label: string;
	/** "join" = calls the register endpoint; "signin" = Steam sign-in; "ladder" = a link to the live ladder; "wait" = disabled */
	act: 'join' | 'signin' | 'ladder' | 'wait';
	disabled: boolean;
}
export function ctaFor(state: JoinState, label: string): Cta {
	switch (state) {
		case 'in':
			return { label: "You're in ✓ · See the live ladder", act: 'ladder', disabled: false };
		case 'signin':
		case 'resign':
			return { label: `Sign in and join ${label}`, act: 'signin', disabled: false };
		case 'busy':
			return { label: 'Joining…', act: 'join', disabled: true };
		case 'unknown':
			return { label: `Join ${label}`, act: 'wait', disabled: true };
		default:
			return { label: `Join ${label}`, act: 'join', disabled: false };
	}
}

export const FEEDBACK_ASK = 'Suggestions or feedback for the new season?';
export const FEEDBACK_DISCORD = 'Tell us in the NOBD Discord';
export const FEEDBACK_IDEA = 'Share an idea';
export const ANNOUNCE_LINE = (label: string) => `${label} is live today. Join now`;
export const STEP_PLAY = "Play five ranked games for a rank. Your games are recorded and you're on the board.";
/** what joining does, in plain words (it says nothing about the board) */
export const JOIN_NOTE = 'Joining adds you to the sign-up count and puts the Registered mark on your profile.';

export interface LiveNumber {
	n: number;
	label: string;
}
/** "{n} joined", "{n} games played so far", "{n} on the board": each dropped when absent or zero */
export function liveNumbers(a: { joined?: number; games?: number; onBoard?: number }): LiveNumber[] {
	const out: LiveNumber[] = [];
	if (a.joined && a.joined > 0) out.push({ n: a.joined, label: 'joined' });
	if (a.games && a.games > 0) out.push({ n: a.games, label: 'games played so far' });
	if (a.onBoard && a.onBoard > 0) out.push({ n: a.onBoard, label: 'on the board' });
	return out;
}

/** the current top three of the open season's rating board; placed players only, as the server sends them */
export function earlyLeaders(players: Player[] | undefined | null, max = 3): Player[] {
	return (Array.isArray(players) ? players : []).filter((p) => p && p.steamid && p.name).slice(0, max);
}
export const NO_LEADERS = 'Nobody has a rank yet. Be the first.';

/** the latest FINISHED season in the table (what /season lands on), or null */
export function latestFinished(table: SeasonTable | null | undefined, now: number): string | null {
	const done = (table?.seasons ?? []).filter((s) => s.end_ms !== null && s.end_ms <= now);
	if (!done.length) return null;
	return done.reduce((a, b) => ((b.end_ms ?? 0) > (a.end_ms ?? 0) ? b : a)).id;
}
/** where /season goes: the latest finished season's finale, keeping #next (or any hash) */
export function seasonLandingPath(base: string, table: SeasonTable | null | undefined, now: number, hash: string): string | null {
	const id = latestFinished(table, now);
	if (!id) return null;
	const h = /^#[A-Za-z0-9_=-]{1,100}$/.test(hash) ? hash : '';
	return `${base}/season/${encodeURIComponent(id)}${h}`;
}
