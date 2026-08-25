// TEAM LOADOUTS — named whole-loadout snapshots ("MSP but everyone in gold"), the locker's one-tap
// wardrobe swap. Server contract (requested 2026-08-24, skins-vault pattern): POST /rr/teams/save
// {id?, name, entries:[{cid, colors:[u32×16]}]}, GET /rr/teams/list, POST /rr/teams/delete {id}.
// DEFENSIVE BY DESIGN: `available` stays false until the list endpoint answers 200, so the whole TEAMS
// UI hides gracefully on a server that hasn't shipped the store yet. APPLY is client-side — it loops the
// existing per-cid loadout equip, so the server never needs an apply arm.
import { api } from '$lib/config';
import { auth } from '$lib/stores/auth.svelte';
import { loadouts, type Loadout } from '$lib/stores/loadouts.svelte';

export interface TeamPreset {
	id: string;
	name: string;
	entries: { cid: number; colors: number[] }[];
	updated_ms: number;
}

class TeamsStore {
	teams = $state<TeamPreset[]>([]);
	available = $state(false);
	busy = $state(false);
	#probed = false;

	async load(): Promise<void> {
		if (!auth.authed || this.#probed) return;
		this.#probed = true;
		try {
			const res = await fetch(api('/rr/teams/list'), { headers: { accept: 'application/json', ...auth.headers() } });
			if (!res.ok) return; // 404 = server half not shipped yet → UI stays hidden
			const j = (await res.json()) as { teams?: TeamPreset[] };
			this.teams = (j.teams ?? []).filter((t) => t && t.id);
			this.available = true;
		} catch {
			/* stay hidden */
		}
	}

	/** Snapshot the CURRENT loadout under a name. */
	async saveCurrent(name: string): Promise<boolean> {
		const mine: Loadout | null = auth.steamid ? loadouts.peek(auth.steamid) : null;
		if (!this.available || !mine || this.busy) return false;
		const entries = Object.entries(mine).map(([cid, pal]) => ({
			cid: Number(cid),
			colors: pal.slice(0, 16).map((h) => parseInt(h.replace('#', ''), 16) & 0xffffff)
		}));
		if (!entries.length) return false;
		this.busy = true;
		try {
			const res = await fetch(api('/rr/teams/save'), {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...auth.headers() },
				body: JSON.stringify({ name: name.slice(0, 40), entries })
			});
			if (res.ok) await this.reload();
			return res.ok;
		} catch {
			return false;
		} finally {
			this.busy = false;
		}
	}

	/** Wear a preset: equip every entry (additive — characters outside the preset keep their skins). */
	async apply(t: TeamPreset): Promise<number> {
		if (this.busy) return 0;
		this.busy = true;
		let n = 0;
		try {
			for (const e of t.entries) {
				const hex = e.colors.slice(0, 16).map((v) => '#' + (v & 0xffffff).toString(16).padStart(6, '0'));
				if (await loadouts.equipOwn(e.cid, hex)) n++;
			}
		} finally {
			this.busy = false;
		}
		return n;
	}

	async remove(id: string): Promise<boolean> {
		if (!this.available || this.busy) return false;
		this.busy = true;
		try {
			const res = await fetch(api('/rr/teams/delete'), {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...auth.headers() },
				body: JSON.stringify({ id })
			});
			if (res.ok) this.teams = this.teams.filter((t) => t.id !== id);
			return res.ok;
		} catch {
			return false;
		} finally {
			this.busy = false;
		}
	}

	async reload(): Promise<void> {
		this.#probed = false;
		this.available = false;
		await this.load();
	}
}

export const teams = new TeamsStore();
