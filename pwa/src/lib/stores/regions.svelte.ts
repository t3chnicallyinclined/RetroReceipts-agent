import { api } from '$lib/config';

// Regions ("represent") store. rune-$state, modelled on LeaderboardStore: one fetch, keep-last-good on
// error. The list is small (one row per city/country ladder) so no virtualization / live channel is
// needed — a plain fetch snapshot is the right call. Types declared locally (types.ts off-limits).
//   • data: GET /skinsync/regions?level=city|country&sort=wins|players|winrate&limit=40
//            → { ok, level, sort, min_games, regions:[…] }

export type RegionLevel = 'city' | 'country';
export type RegionSort = 'wins' | 'players' | 'winrate';

export interface RegionTop {
	name?: string;
	steamid?: string;
	avatar?: string;
	cc?: string;
	wins?: number;
}

export interface Region {
	name: string; // city (city level) or country (country level) name
	region?: string; // scene/region label, e.g. "SoCal"
	cc?: string;
	country?: string;
	players?: number;
	games?: number;
	wins?: number;
	losses?: number;
	avg_rating?: number;
	top?: RegionTop;
}

interface RegionsResponse {
	ok?: boolean;
	level?: string;
	sort?: string;
	min_games?: number;
	regions?: Region[];
}

export class RegionsStore {
	regions = $state<Region[]>([]);
	level = $state<RegionLevel>('city');
	sort = $state<RegionSort>('wins');
	minGames = $state(5);
	loading = $state(false);
	error = $state<string | null>(null);
	lastLoaded = $state(0);

	#reqId = 0;

	async load(): Promise<void> {
		const myReq = ++this.#reqId;
		const level = this.level; // snapshot the request axes so a late response can't mislabel the board
		const sort = this.sort;
		this.loading = true;
		try {
			const qs = new URLSearchParams({ level, sort, limit: '40' });
			const res = await fetch(api(`/skinsync/regions?${qs}`), { headers: { accept: 'application/json' } });
			if (!res.ok) throw new Error(`regions ${res.status}`);
			const json = (await res.json()) as RegionsResponse;
			if (myReq !== this.#reqId) return; // a newer level/sort request superseded this one
			// Trust the server's order — it sorts deterministically for every `sort` (winrate also applies
			// the min-games threshold, which a naive client compare can't reproduce). NO client re-sort.
			this.regions = json.regions ?? [];
			this.minGames = json.min_games ?? 5;
			this.error = null;
			this.lastLoaded = Date.now();
		} catch (e) {
			if (myReq !== this.#reqId) return;
			// keep-last-good — do NOT clear this.regions on a transient blip.
			this.error = e instanceof Error ? e.message : 'error';
		} finally {
			if (myReq === this.#reqId) this.loading = false;
		}
	}

	setLevel(l: RegionLevel): void {
		if (l === this.level) return;
		this.level = l;
		void this.load();
	}

	setSort(s: RegionSort): void {
		if (s === this.sort) return;
		this.sort = s;
		void this.load();
	}
}

export const regions = new RegionsStore();
