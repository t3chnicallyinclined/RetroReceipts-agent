// Who's on the collection RIGHT NOW — GET /rr/presence ({online, players[]}), the agent-heartbeat census.
// Powers the top-bar OnlineChip on every page, signed-in or not: "how many people are on" is the first
// thing a fighting-game player asks of a platform, and the honest answer is also the best marketing.
//
// Poll, not SSE: the count changes on the minutes scale, a 30s poll is one tiny GET through the shared
// dedup layer, and it works for signed-out visitors with zero bus plumbing. Pauses while the tab is
// hidden (visibilitychange) and refreshes immediately on return.
import { apiGet } from '$lib/net.svelte';

const POLL_MS = 30_000;

class PresenceStore {
	online = $state<number | null>(null); // null = not yet loaded (chip hides rather than showing 0)
	players = $state<string[]>([]);
	#timer: ReturnType<typeof setInterval> | null = null;
	#started = false;

	/** Idempotent — the chip calls this on mount; extra calls are no-ops. */
	start(): void {
		if (this.#started || typeof window === 'undefined') return;
		this.#started = true;
		void this.#tick();
		this.#timer = setInterval(() => {
			if (!document.hidden) void this.#tick();
		}, POLL_MS);
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) void this.#tick(); // fresh count the moment the tab returns
		});
	}

	async #tick(): Promise<void> {
		try {
			const j = await apiGet<{ online?: number; players?: unknown }>('/rr/presence', { ttl: 10_000 });
			const n = Number(j?.online);
			this.online = Number.isFinite(n) && n >= 0 ? n : null;
			this.players = Array.isArray(j?.players)
				? (j.players as unknown[]).filter((p): p is string => typeof p === 'string')
				: [];
		} catch {
			/* keep last-good — a blip must not blank the chip */
		}
	}
}

export const presence = new PresenceStore();
