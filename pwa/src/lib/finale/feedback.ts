// Season finale: the feedback API (polls, votes, notes, the "what players asked for" list) and the poll state
// machine. Server: server/src/feedback.rs, routes `/rr/season/feedback` (GET), `/vote` and `/note` (POST).
//
// SERVER: both POSTs answer with the whole feedback view (the same body as the GET), not just the updated poll.
// Voting needs a Steam-PROVEN sign-in: a token that was only claimed gets 403 "sign in with Steam to vote".

import { apiGet } from '../net.svelte';
import { withSeason } from '../seasons';
import { obj } from './highlights';

export interface PollOption {
	id: string;
	label: string;
	votes: number;
}
export interface Poll {
	id: string;
	q: string;
	hint: string;
	options: PollOption[];
	/** the caller's option id, or null */
	mine: string | null;
}
export type AskedStatus = 'asked' | 'looking' | 'done' | 'not_planned';
export interface Asked {
	id: string;
	text: string;
	status: AskedStatus;
	note: string;
}
export interface FeedbackView {
	/** a signed-in viewer who may not vote or send a note (only players of that season can): the reason to show */
	blocked?: string;
	open: boolean;
	polls: Poll[];
	asked: Asked[];
}

const STATUSES: AskedStatus[] = ['asked', 'looking', 'done', 'not_planned'];
export const STATUS_LABEL: Record<AskedStatus, string> = { asked: 'Asked', looking: 'Looking at it', done: 'Done', not_planned: 'Not planned' };

export function normalizeFeedback(raw: unknown): FeedbackView | null {
	const j = obj(raw);
	if (!j || j.ok === false || !Array.isArray(j.polls)) return null;
	const polls = (j.polls as unknown[]).flatMap((p): Poll[] => {
		const o = obj(p);
		if (!o || typeof o.id !== 'string' || typeof o.q !== 'string' || !Array.isArray(o.options)) return [];
		const options = (o.options as unknown[]).flatMap((x): PollOption[] => {
			const q = obj(x);
			return q && typeof q.id === 'string' && typeof q.label === 'string' ? [{ id: q.id, label: q.label, votes: typeof q.votes === 'number' && q.votes > 0 ? q.votes : 0 }] : [];
		});
		return options.length >= 2 ? [{ id: o.id, q: o.q, hint: typeof o.hint === 'string' ? o.hint : '', options, mine: typeof o.mine === 'string' ? o.mine : null }] : [];
	});
	const asked = (Array.isArray(j.asked) ? (j.asked as unknown[]) : []).flatMap((a): Asked[] => {
		const o = obj(a);
		if (!o || typeof o.id !== 'string' || typeof o.text !== 'string' || !o.text.trim()) return [];
		const status = STATUSES.includes(o.status as AskedStatus) ? (o.status as AskedStatus) : 'asked';
		return [{ id: o.id, text: o.text, status, note: typeof o.note === 'string' ? o.note : '' }];
	});
	// SERVER: `can_vote: false` (signed-in viewers only) comes with a reason; show it instead of failing on tap
	const reasonRaw = [j.vote_reason, j.can_vote_reason, j.reason].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
	const blocked = j.can_vote === false ? (reasonRaw ?? 'Only players who played this season can vote.') : undefined;
	return { open: j.open !== false, polls, asked, blocked };
}

/** GET /rr/season/feedback. null on any failure (404 = older server): polls, note and the asked list hide. */
export async function fetchFeedback(seasonId: string, token: string | null): Promise<FeedbackView | null> {
	try {
		return normalizeFeedback(await apiGet<unknown>(withSeason('/rr/season/feedback', seasonId), { token, ttl: 0, force: true }));
	} catch {
		return null;
	}
}

// ── poll state machine ──────────────────────────────────────────────────────────────────────────

export type PollPhase = 'choose' | 'results';
export interface PollStatus {
	phase: PollPhase;
	total: number;
	/** the line under the poll (aria-live) */
	text: string;
	/** show the sign-in button next to the line */
	needsSignIn: boolean;
}

/**
 * What a poll shows. Before voting: the options only (results appear after a vote, or on "Show results").
 * After: counts, percentages and the caller's own pick. Closed polls show results only.
 */
export function pollStatus(p: Poll, ctx: { signedIn: boolean; open: boolean; showResults: boolean; refusal?: VoteRefusal | null; blocked?: string }): PollStatus {
	const total = p.options.reduce((n, o) => n + o.votes, 0);
	const phase: PollPhase = !ctx.open || p.mine || ctx.showResults ? 'results' : 'choose';
	if (!ctx.open) return { phase, total, text: 'Voting has closed.', needsSignIn: false };
	if (ctx.blocked) return { phase: 'results', total, text: ctx.blocked, needsSignIn: false };
	if (ctx.refusal === 'signin') return { phase, total, text: 'Sign in to vote. One vote per account.', needsSignIn: true };
	if (ctx.refusal === 'limit') return { phase, total, text: 'Too many changes just now. Try again in a little while.', needsSignIn: false };
	if (ctx.refusal === 'error') return { phase, total, text: 'Could not save that. Please try again.', needsSignIn: false };
	if (p.mine) return { phase, total, text: `${total} ${total === 1 ? 'vote' : 'votes'} · tap another answer to change yours`, needsSignIn: false };
	if (!ctx.signedIn) return { phase, total, text: 'One vote per signed-in account.', needsSignIn: false };
	if (phase === 'results') return { phase, total, text: total ? `${total} ${total === 1 ? 'vote' : 'votes'}` : 'No votes yet.', needsSignIn: false };
	return { phase, total, text: 'Tap an answer to vote. Results show after you vote.', needsSignIn: false };
}

/** the percentage of an option among all votes (rounded; 0 when there are no votes) */
export const optionPct = (p: Poll, o: PollOption): number => {
	const total = p.options.reduce((n, x) => n + x.votes, 0);
	return total ? Math.round((o.votes * 100) / total) : 0;
};

export type VoteRefusal = 'signin' | 'closed' | 'limit' | 'error';
export type VoteResult = { ok: true; view: FeedbackView | null; poll: Poll | null } | { ok: false; refusal: VoteRefusal };
type Post = (path: string, body: unknown) => Promise<{ ok: boolean; error?: string; data?: unknown }>;

/** Map the server's refusal text to a reason the UI can word. */
export function refusalOf(error: string | undefined): VoteRefusal {
	const e = (error ?? '').toLowerCase();
	if (e.includes('sign in') || e.includes('session expired') || e.includes('unauthorized')) return 'signin';
	if (e.includes('closed')) return 'closed';
	if (e.includes('too many')) return 'limit';
	return 'error';
}

/** Cast or change a vote. Signed-out and closed are refused here, before any request. */
export async function submitVote(a: { signedIn: boolean; open: boolean; season: string; poll: string; option: string; post: Post }): Promise<VoteResult> {
	if (!a.open) return { ok: false, refusal: 'closed' };
	if (!a.signedIn) return { ok: false, refusal: 'signin' };
	const r = await a.post('/rr/season/feedback/vote', { season: a.season, poll: a.poll, option: a.option });
	// SERVER: a vote answers with the UPDATED POLL ({id, q, options, mine}); the whole view is accepted too
	if (!r.ok) return { ok: false, refusal: refusalOf(r.error) };
	const view = normalizeFeedback(r.data);
	const one = view ? null : normalizeFeedback({ ok: true, polls: [r.data] })?.polls[0] ?? null;
	return { ok: true, view, poll: one };
}

export const NOTE_MIN = 4;
export const NOTE_MAX = 280;
export async function submitNote(a: { signedIn: boolean; season: string; text: string; post: Post }): Promise<{ ok: boolean; message: string }> {
	const text = a.text.trim();
	if (!a.signedIn) return { ok: false, message: 'Sign in to send a note, or tell us in Discord.' };
	if (text.length < NOTE_MIN) return { ok: false, message: 'Please write a few more words.' };
	if (text.length > NOTE_MAX) return { ok: false, message: `Notes can be up to ${NOTE_MAX} characters.` };
	const r = await a.post('/rr/season/feedback/note', { season: a.season, text });
	if (r.ok) return { ok: true, message: 'Thanks. Your note was sent.' };
	return { ok: false, message: /too many|3 notes|limit/i.test(r.error ?? '') ? 'You have sent the most notes we can take for this season.' : (r.error ?? 'Could not send that. Please try again.') };
}
