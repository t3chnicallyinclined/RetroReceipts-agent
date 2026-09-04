import { api } from '$lib/config';
import { auth } from '$lib/stores/auth.svelte';
import { getChannel, type SseChannel } from '$lib/rt.svelte';
import type { SseFrame } from '$lib/types';

// 💬 ANCHORED COMMENTS (LIVE-TAB-V2-SPEC §4, contracts C19 + C20 — both LIVE on prod) ────────────────────────
// A comment can carry the exact FRAME it is about, so the timestamp is native rather than parsed out of the
// text, and anyone can click it to jump to that moment.
//
// THIS STORE DUPLICATES NO SERVER RULE. Every safety mechanism — the rate limits, the same-match burst, the
// participants-only hide, auto-hide at three distinct reporters, and hiding itself — is enforced server-side
// and smoke-verified there. So the client's job is to SURFACE THE SERVER'S REFUSAL verbatim: `auth.post` passes
// `error` through untouched and the UI prints it. Re-implementing a limit here would only create a second set
// of numbers to drift — the spec's own 30 s same-match cooldown was measured to refuse 3 of the 4 moment marks
// the feature exists for, and shipped as a 6-per-5-minute burst instead.
//
// Hiding is enforced on the server too (comments.rs `list`: a hidden row is returned only to its author or an
// admin), so a hidden body never reaches another viewer's browser — client-side hiding here is presentation,
// never protection.

/** One row of `GET /rr/comments`; the C20 bus delta is the same shape plus `type` (comments.rs `comment_row`). */
export interface CommentRow {
	id: string;
	key: string;
	session_id: string;
	/** the anchor: null = a flat comment about the whole match; a number = the exact frame */
	frame: number | null;
	author: string;
	name: string;
	avatar: string;
	rating: number;
	games: number;
	text: string;
	ts: number;
	hidden: boolean;
	/** '' | 'players' | 'reports' — so the author can be told WHICH happened */
	hidden_reason: '' | 'players' | 'reports';
}

type Frame = SseFrame & Partial<CommentRow> & { type?: string; hidden?: boolean };

const newestFirst = (a: CommentRow, b: CommentRow) => b.ts - a.ts;

class CommentsStore {
	/** the match key the wall is currently showing */
	key = $state('');
	rows = $state<CommentRow[]>([]);
	/** the server's count of VISIBLE comments (not rows.length — a page can be partial) */
	total = $state(0);
	/** MECHANISM 3, the visible half: hidden rows are COUNTED for everyone. Suppression you can count is self-limiting. */
	hiddenCount = $state(0);
	participants = $state<{ winner: string; loser: string }>({ winner: '', loser: '' });
	more = $state(false);
	loading = $state(false);
	/** the last refusal, in the SERVER's voice */
	error = $state('');

	#unsub: (() => void) | null = null;
	#ch: SseChannel | null = null;
	#seq = 0;

	/** true when the signed-in viewer fought in this match — drives the gold FOUGHT THIS chip and Hide */
	get viewerIsParticipant(): boolean {
		return this.isParticipant(auth.steamid ?? '');
	}
	isParticipant(sid: string): boolean {
		return !!sid && (sid === this.participants.winner || sid === this.participants.loser);
	}

	/** Point the wall at a match: seed from the endpoint, then follow the bus. */
	async open(key: string): Promise<void> {
		if (!key) {
			this.close();
			return;
		}
		if (key === this.key) return;
		this.key = key;
		this.rows = [];
		this.total = 0;
		this.hiddenCount = 0;
		this.error = '';
		this.#subscribe();
		await this.reseed();
	}

	close(): void {
		this.#unsub?.(); // ref-counted in rt.svelte.ts: the shared EventSource closes only when the last sub goes
		this.#unsub = null;
		this.#ch = null;
		this.key = '';
		this.rows = [];
	}

	#subscribe(): void {
		if (this.#ch) return;
		// the EXISTING `matches` channel — C20 refuses a per-match channel ("no new key, no new cardinality").
		// getChannel is ref-counted, so this shares matchfeed's connection rather than opening a second one.
		const ch = getChannel('matches');
		this.#ch = ch;
		this.#unsub = ch.subscribe((f) => this.applyDelta(f as Frame));
	}

	/**
	 * Re-read the wall from the endpoint.
	 *
	 * Comment chatter shares the 500-entry `matches` replay window with results and rail deltas, so the stream
	 * is NOT guaranteed complete on a busy match: the endpoint is the source of truth and the stream is only the
	 * live edge. It is also the only way to restore a body after an un-hide, since the state deltas carry no text.
	 */
	async reseed(): Promise<void> {
		const key = this.key;
		if (!key) return;
		const seq = ++this.#seq;
		this.loading = true;
		try {
			const res = await fetch(api(`/rr/comments?key=${encodeURIComponent(key)}&limit=100`), {
				headers: { accept: 'application/json', ...auth.headers() }
			});
			if (!res.ok) return;
			const j = (await res.json()) as {
				ok?: boolean;
				comments?: CommentRow[];
				total?: number;
				hidden_count?: number;
				more?: boolean;
				participants?: { winner: string; loser: string };
			};
			if (seq !== this.#seq || this.key !== key) return; // superseded by a newer match
			if (j.ok === false) return;
			this.rows = (j.comments ?? []).slice().sort(newestFirst);
			this.total = j.total ?? this.rows.length;
			this.hiddenCount = j.hidden_count ?? 0;
			this.more = j.more ?? false;
			this.participants = j.participants ?? { winner: '', loser: '' };
		} catch {
			/* keep-last-good — a dead wall must never cost the page its picture */
		} finally {
			if (seq === this.#seq) this.loading = false;
		}
	}

	/**
	 * C20 deltas, on the shared `matches` channel.
	 *
	 * Public rather than private because it is also what the gate drives (scripts/smoke-replay.mjs --comments):
	 * a hide delta that the consumer ignores renders comments the server has hidden, and that is not a bug you
	 * want to discover in production. Driving the REAL method beats a dev-only backdoor that could diverge.
	 */
	applyDelta(d: Frame): void {
		const t = d.type;
		if (t !== 'comment' && t !== 'comment_hide' && t !== 'comment_del') return;
		if (!d.key || d.key !== this.key) return;

		if (t === 'comment_del') {
			if (!this.rows.some((r) => r.id === d.id)) return;
			this.rows = this.rows.filter((r) => r.id !== d.id);
			this.total = Math.max(0, this.total - 1);
			return;
		}

		if (t === 'comment_hide') {
			// ⚠ TEXT-FREE BY DESIGN: a hidden body is never re-broadcast, so an in-order replay ends hidden ONLY
			// because this branch exists. Ignore these deltas and you render comments the server has hidden.
			if (d.hidden) {
				const mine = !!auth.steamid && d.author === auth.steamid;
				if (mine) {
					// the author keeps seeing their own, marked — they are the one person who must be told
					this.rows = this.rows.map((r) =>
						r.id === d.id ? { ...r, hidden: true, hidden_reason: r.hidden_reason || 'players' } : r
					);
				} else if (this.rows.some((r) => r.id === d.id)) {
					this.rows = this.rows.filter((r) => r.id !== d.id);
					this.total = Math.max(0, this.total - 1);
				}
				this.hiddenCount += 1;
			} else {
				// un-hidden: the body is not in the delta, so a re-read is the only honest way to get it back
				void this.reseed();
			}
			return;
		}

		const row = d as unknown as CommentRow;
		if (!row.id || this.rows.some((r) => r.id === row.id)) return;
		this.rows = [row, ...this.rows].sort(newestFirst);
		this.total += 1;
	}

	// ── writes: each returns the SERVER's refusal string, untouched ─────────────────────────────────────────
	async post(text: string, frame: number | null): Promise<{ ok: boolean; error?: string }> {
		this.error = '';
		const body: { key: string; text: string; frame?: number } = { key: this.key, text };
		if (frame != null && Number.isFinite(frame)) body.frame = Math.max(0, Math.round(frame));
		const r = await auth.post<{ comment?: CommentRow }>('/rr/comment', body);
		if (!r.ok) {
			this.error = r.error ?? 'Could not post that.';
			return { ok: false, error: this.error };
		}
		const c = r.data?.comment;
		if (c && !this.rows.some((x) => x.id === c.id)) {
			this.rows = [c, ...this.rows].sort(newestFirst);
			this.total += 1;
		}
		return { ok: true };
	}

	async del(id: string): Promise<{ ok: boolean; error?: string }> {
		this.error = '';
		try {
			const res = await fetch(api(`/rr/comment/${encodeURIComponent(id)}`), {
				method: 'DELETE',
				headers: { accept: 'application/json', ...auth.headers() }
			});
			const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
			if (!res.ok || j.ok === false) {
				this.error = j.error ?? `Request failed (${res.status})`;
				return { ok: false, error: this.error };
			}
			this.rows = this.rows.filter((r) => r.id !== id);
			this.total = Math.max(0, this.total - 1);
			return { ok: true };
		} catch {
			this.error = 'Network error — check your connection and try again.';
			return { ok: false, error: this.error };
		}
	}

	/** participants only — the server refuses anyone else, in its own words */
	async hide(id: string, hidden: boolean): Promise<{ ok: boolean; error?: string }> {
		this.error = '';
		const r = await auth.post(`/rr/comment/${encodeURIComponent(id)}/hide`, { hidden });
		if (!r.ok) {
			this.error = r.error ?? 'Could not hide that.';
			return { ok: false, error: this.error };
		}
		await this.reseed(); // visibility just changed for everyone; re-read rather than guess
		return { ok: true };
	}

	async report(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
		this.error = '';
		const r = await auth.post('/rr/report', { kind: 'comment', id, reason });
		if (!r.ok) {
			this.error = r.error ?? 'Could not report that.';
			return { ok: false, error: this.error };
		}
		return { ok: true };
	}
}

export const comments = new CommentsStore();

// DEV-only handle so the smoke harness can drive the real store (seed, deltas, tick marks) without an account.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
	(window as unknown as Record<string, unknown>).__rrComments = comments;
}
