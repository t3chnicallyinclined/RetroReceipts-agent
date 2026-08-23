import { api } from '$lib/config';
import { auth } from '$lib/stores/auth.svelte';

// 🔔 Result Check store — the contest/confirm system for reported match results. Poll-based (the server has
// NO SSE channel for this): GET /rr/notifications?steamid=<me> (authed; steamid must equal the token)
// returns the contests the USER filed (`mine`, pending vs resolved + final winner once attested), an optional
// heads-up when an opponent contested one of the user's matches (`headsUp`), and `unread` (the bell badge).
// Writes go through auth.post (the single authed path — handles 401→logout + {ok:false}): POST /rr/contest
// {match_key} and POST /rr/confirm {match_key}. Owns its lifecycle app-wide like WalletStore: load on
// sign-in, poll while visible, pause while hidden. Keep-last-good on a transient blip. Types are local.

export interface RcMine {
	match_key: string;
	mid?: string;
	confirmed?: boolean;
	ts?: number;
	status: 'pending' | 'resolved';
	resolved: boolean;
	attested?: boolean;
	final_winner?: string | null;
	i_won?: boolean;
	opponent?: { steamid?: string; name?: string };
}
export interface RcHeadsUp {
	match_key: string;
	mid?: string;
	confirmed?: boolean;
	ts?: number;
	contester?: { steamid?: string; name?: string };
	stored_winner?: 'you' | 'them';
	status?: string;
}

const CONFIRMED_KEY = 'rc_confirmed'; // match_keys this user already confirmed (their side) — no re-prompt
const POLL_MS = 25000; // status refresh cadence while the tab is visible

class ResultCheckStore {
	mine = $state<RcMine[]>([]);
	headsUp = $state<RcHeadsUp[]>([]);
	unread = $state(0);
	loaded = $state(false);
	/** match_keys with an in-flight contest/confirm → blocks a double-submit (mirrors Tauri rcInflight). */
	inflight = $state<Set<string>>(new Set());

	#confirmed = new Set<string>();
	#sid = '';
	#timer: ReturnType<typeof setInterval> | null = null;
	#reqId = 0;

	constructor() {
		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem(CONFIRMED_KEY);
			if (raw) this.#confirmed = new Set(JSON.parse(raw) as string[]);
		} catch {
			/* storage blocked — start empty */
		}
	}

	haveConfirmed(key: string): boolean {
		return this.#confirmed.has(String(key));
	}
	#markConfirmed(key: string) {
		if (!key) return;
		this.#confirmed.add(String(key));
		try {
			localStorage.setItem(CONFIRMED_KEY, JSON.stringify([...this.#confirmed]));
		} catch {
			/* ignore */
		}
	}

	/** Pull the caller's Result Check status. keep-last-good on any failure; #reqId drops a stale response. */
	async load(steamid?: string | null): Promise<void> {
		const sid = String(steamid ?? auth.steamid ?? '');
		this.#sid = sid;
		if (!sid || !auth.token) {
			this.mine = [];
			this.headsUp = [];
			this.unread = 0;
			this.loaded = false;
			return;
		}
		const myReq = ++this.#reqId;
		try {
			const res = await fetch(api(`/rr/notifications?steamid=${encodeURIComponent(sid)}`), {
				headers: { accept: 'application/json', ...auth.headers() }
			});
			if (!res.ok) return; // keep last-good (a later poll retries)
			const j = (await res.json()) as {
				ok?: boolean;
				mine?: RcMine[];
				heads_up?: RcHeadsUp[];
				unread?: number;
			};
			if (myReq !== this.#reqId) return; // superseded by a newer load
			if (!j?.ok) return;
			this.mine = Array.isArray(j.mine) ? j.mine : [];
			this.headsUp = Array.isArray(j.heads_up) ? j.heads_up : [];
			this.unread = Number(j.unread) || 0;
			this.loaded = true;
		} catch {
			/* keep last-good */
		}
	}

	/** Start polling (idempotent). Pass the signed-in steamid so status tracks it. */
	connect(steamid?: string | null): void {
		if (steamid !== undefined) this.#sid = String(steamid || '');
		void this.load(this.#sid);
		if (this.#timer) return;
		this.#timer = setInterval(() => void this.load(this.#sid), POLL_MS);
	}
	disconnect(): void {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	/** Contest a result (you're claiming you should be the winner). Enters the admin queue; never moves W/L. */
	async contest(matchKey: string): Promise<{ ok: boolean; error?: string }> {
		const key = String(matchKey || '');
		if (!key || this.inflight.has(key)) return { ok: false, error: 'busy' };
		this.#setInflight(key, true);
		try {
			const res = await auth.post('/rr/contest', { match_key: key });
			if (res.ok) await this.load(this.#sid);
			return { ok: res.ok, error: res.error };
		} finally {
			this.#setInflight(key, false);
		}
	}

	/** Confirm a result is correct. Both participants confirming flips the match to `confirmed`. */
	async confirm(
		matchKey: string
	): Promise<{ ok: boolean; confirmed?: boolean; need?: string | null; error?: string }> {
		const key = String(matchKey || '');
		if (!key || this.inflight.has(key)) return { ok: false, error: 'busy' };
		this.#setInflight(key, true);
		try {
			const res = await auth.post<{ confirmed?: boolean; need?: string | null }>('/rr/confirm', {
				match_key: key
			});
			if (res.ok) {
				this.#markConfirmed(key);
				await this.load(this.#sid);
			}
			return { ok: res.ok, confirmed: res.data?.confirmed, need: res.data?.need ?? null, error: res.error };
		} finally {
			this.#setInflight(key, false);
		}
	}

	#setInflight(key: string, on: boolean) {
		const next = new Set(this.inflight); // reassign so $state tracks the mutation
		if (on) next.add(key);
		else next.delete(key);
		this.inflight = next;
	}
}

export const resultcheck = new ResultCheckStore();
