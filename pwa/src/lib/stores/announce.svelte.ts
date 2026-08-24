// Broadcast announcements — the server-authored banner (beta launch, downtime, "season starts Friday").
//
// TWO DELIVERY PATHS, deliberately:
//   • the SSE `matches` channel (`type:"announcement"`) — live, and reaches SIGNED-OUT visitors, which the
//     poll cannot. For a launch announcement that audience is the whole point.
//   • `/rr/notifications` `announcements[]` — the on-load path, so someone opening the app cold sees it
//     without waiting for a broadcast. ⚠ That endpoint is auth-required, so this half is signed-in only.
//
// The server keeps NO per-user state for these (they stay out of the Result-Check `unread` count), so
// "seen" is ours to track — one localStorage key holding dismissed ids.
//
// Parsing is deliberately DEFENSIVE: `text` is the only field we require. Everything else (id, level, ttl)
// is optional and defaulted, so a shape change server-side degrades to "still shows the message" rather
// than to a blank banner or a crash.

const SEEN_KEY = 'rr_seen_announcements';
const SEEN_CAP = 50; // ids are tiny; keep the list from growing forever

export type AnnounceLevel = 'info' | 'launch' | 'warn';

export interface Announcement {
	id: string;
	text: string;
	level: AnnounceLevel;
	/** epoch ms this stops being shown; 0 = no expiry. */
	expires: number;
}

function readSeen(): string[] {
	try {
		const raw = localStorage.getItem(SEEN_KEY);
		const arr = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return []; // private mode / blocked storage → treat everything as unseen
	}
}

function writeSeen(ids: string[]): void {
	try {
		localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_CAP)));
	} catch {
		/* storage blocked — the banner simply reappears next visit, which is acceptable */
	}
}

/** Normalize one raw server object. Returns null when there's nothing worth showing. */
function normalize(raw: unknown): Announcement | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const text = typeof o.text === 'string' ? o.text.trim() : '';
	if (!text) return null;

	const lvlRaw = typeof o.level === 'string' ? o.level.toLowerCase() : '';
	const level: AnnounceLevel = lvlRaw === 'launch' || lvlRaw === 'warn' ? lvlRaw : 'info';

	const ts = Number(o.ts ?? o.created_ms ?? 0) || 0;
	const ttl = Number(o.ttl_ms ?? 0) || 0;
	// Prefer a server id so dismissal survives a re-broadcast of the SAME announcement. With no id, fall
	// back to the text itself — stable enough that re-sending identical copy stays dismissed.
	const id = typeof o.id === 'string' && o.id ? o.id : `t:${text}`;

	return { id, text, level, expires: ts && ttl ? ts + ttl : 0 };
}

class AnnounceStore {
	/** Active, unseen, unexpired — newest first. What the banner renders. */
	items = $state<Announcement[]>([]);
	#seen = $state<string[]>([]);
	#booted = false;

	#boot(): void {
		if (this.#booted) return;
		this.#booted = true;
		this.#seen = readSeen();
	}

	#visible(list: Announcement[]): Announcement[] {
		const now = Date.now();
		return list.filter((a) => !this.#seen.includes(a.id) && (a.expires === 0 || a.expires > now));
	}

	/** Merge the poll set (`/rr/notifications` announcements[]) — UNION by id, never replace: a live SSE
	 *  broadcast the auth-only poll payload doesn't carry must survive the next poll tick. */
	setAll(raw: unknown): void {
		this.#boot();
		const list = Array.isArray(raw) ? raw.map(normalize).filter((a): a is Announcement => !!a) : [];
		for (const cur of this.items) if (!list.some((a) => a.id === cur.id)) list.push(cur);
		this.items = this.#visible(list);
	}

	/** Merge one live broadcast (SSE `type:"announcement"`) without dropping what's already showing. */
	push(raw: unknown): void {
		this.#boot();
		const a = normalize(raw);
		if (!a) return;
		if (this.items.some((x) => x.id === a.id)) return; // already on screen
		this.items = this.#visible([a, ...this.items]);
	}

	/** User dismissed it — remember so it stays gone across reloads and re-broadcasts. */
	dismiss(id: string): void {
		this.#boot();
		if (!this.#seen.includes(id)) {
			this.#seen = [...this.#seen, id];
			writeSeen(this.#seen);
		}
		this.items = this.items.filter((a) => a.id !== id);
	}
}

export const announce = new AnnounceStore();
