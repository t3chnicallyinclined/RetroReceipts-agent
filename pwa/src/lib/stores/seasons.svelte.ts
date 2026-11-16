import { apiGet } from '$lib/net.svelte';
import { parseSeasonTable, type Season, type SeasonTable } from '$lib/seasons';

// The season table and the viewer's selected season. Loaded ONCE per page load from GET /rr/seasons; every
// label in the app comes from it (nothing is hard-coded). Old servers have no such route: a 404 (or any
// body we can't trust) leaves `available` false, so there is no picker and every request goes out exactly
// as it did before seasons existed.
//
// The selection is shared by the leaderboard, regions, tier list and profile pages. `param` is what a fetch
// appends as `?season=`: undefined while viewing the current season (the server's default), so the common
// case sends the same URL as before and shares the same cache entries.

export class SeasonsStore {
	table = $state<SeasonTable | null>(null);
	/** viewer's pick; null = follow the current season */
	selected = $state<string | null>(null);
	/** idle → loading → ready | absent (old server). A transient failure drops back to idle so a later load() retries. */
	status = $state<'idle' | 'loading' | 'ready' | 'absent'>('idle');

	#inflight: Promise<void> | null = null;

	get available(): boolean {
		return !!this.table;
	}

	/** The picker is only worth showing once there is something to pick between. */
	get multiple(): boolean {
		return (this.table?.seasons.length ?? 0) > 1;
	}

	get currentId(): string | null {
		return this.table?.current ?? null;
	}

	get currentLabel(): string | null {
		return this.labelOf(this.currentId);
	}

	/** Season being viewed (id), or null when the server has no seasons. */
	get activeId(): string | null {
		return this.selected ?? this.currentId;
	}

	get active(): Season | null {
		return this.find(this.activeId);
	}

	/** True when the viewer is looking at a finished season. */
	get archived(): boolean {
		return this.selected !== null && this.selected !== this.currentId;
	}

	/** Value for `?season=` — undefined unless a past season is selected. */
	get param(): string | undefined {
		return this.archived ? (this.selected ?? undefined) : undefined;
	}

	/** The finished season right before the current one (its wrap-up is linkable), or null. */
	get previous(): Season | null {
		const list = this.table?.seasons ?? [];
		const i = list.findIndex((s) => s.id === this.table?.current);
		return i > 0 ? list[i - 1] : null;
	}

	/** Newest first — the order a person expects in a list. */
	get newestFirst(): Season[] {
		return [...(this.table?.seasons ?? [])].reverse();
	}

	find(id: string | null | undefined): Season | null {
		if (!id) return null;
		return this.table?.seasons.find((s) => s.id === id) ?? null;
	}

	labelOf(id: string | null | undefined): string | null {
		return this.find(id)?.label ?? null;
	}

	/** Load the table once; concurrent and repeat callers share the result. Never throws. */
	load(): Promise<void> {
		if (this.status === 'ready' || this.status === 'absent') return Promise.resolve();
		if (this.#inflight) return this.#inflight;
		this.status = 'loading';
		this.#inflight = (async () => {
			try {
				const t = parseSeasonTable(await apiGet<unknown>('/rr/seasons', { ttl: 0 }));
				this.table = t;
				this.status = t ? 'ready' : 'absent';
			} catch (e) {
				// 404 = a server from before seasons: settled, stay quiet. Anything else: allow a retry.
				const notThere = e instanceof Error && e.message === '404';
				this.status = notThere ? 'absent' : 'idle';
			} finally {
				this.#inflight = null;
			}
		})();
		return this.#inflight;
	}

	/** Pick a season by id. Unknown ids are ignored; picking the current one means "follow current". */
	select(id: string): boolean {
		if (!this.find(id)) return false;
		this.selected = id === this.currentId ? null : id;
		return true;
	}
}

export const seasons = new SeasonsStore();
