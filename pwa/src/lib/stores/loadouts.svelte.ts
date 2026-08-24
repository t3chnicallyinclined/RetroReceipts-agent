// Per-player skin loadouts — the lookup behind "your skins show wherever your team does".
//
// A loadout is {char_id: [16 hex]} — what the /skins picker saves to /rr/loadout. This store answers
// "what palette does player X use for character Y" for ANY steamid, so receipts, boards and live cards can
// paint each fighter in its owner's colors.
//
// Fetch strategy:
//   • the signed-in viewer's OWN loadout uses the authed GET /rr/loadout (live today);
//   • anyone else uses the PUBLIC GET /rr/loadout?steamid=<sid> (server contract requested 2026-08-24;
//     until it ships the read 404s and that player simply stays on stock — graceful by construction).
// Results (including misses) cache for the session; a loadout changes rarely and repainting mid-session
// is not worth per-render fetches. `refresh()` drops one player after their picker saves.
import { apiGet } from '$lib/net.svelte';
import { auth } from '$lib/stores/auth.svelte';

export type Loadout = Record<number, string[]>;

const toHex = (n: number) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

/**
 * Server shape (VERIFIED against the /skins editor + server lane 2026-08-24): an array of
 * `{cid, colors: [u32 × 16]}` with 0xRRGGBB INT colors — under `skins` on the authed own-read and
 * `loadout` on the public by-steamid read. Normalized here to {cid: [16 hex]} for the palette remapper.
 */
function normalize(raw: unknown): Loadout {
	const out: Loadout = {};
	if (!Array.isArray(raw)) return out;
	for (const e of raw as { cid?: unknown; colors?: unknown }[]) {
		const cid = Number(e?.cid);
		if (!Number.isFinite(cid) || !Array.isArray(e.colors) || e.colors.length < 16) continue;
		const ints = e.colors.slice(0, 16).map(Number);
		if (ints.some((n) => !Number.isFinite(n))) continue;
		out[cid] = ints.map(toHex);
	}
	return out;
}

class LoadoutStore {
	// steamid → loadout ({} = known-empty / unavailable). $state so consumers re-render on arrival.
	#byId = $state<Record<string, Loadout>>({});
	#pending = new Set<string>();

	/**
	 * The player's loadout, or null while unknown. Kicks off the fetch on first ask — call it from a
	 * $derived and the palette pops in when the read lands.
	 */
	of(steamid: string | null | undefined): Loadout | null {
		if (!steamid || !/^\d{17}$/.test(steamid)) return null;
		const have = this.#byId[steamid];
		if (have) return have;
		void this.#fetch(steamid);
		return null;
	}

	async #fetch(steamid: string): Promise<void> {
		if (this.#pending.has(steamid)) return;
		this.#pending.add(steamid);
		try {
			const own = auth.steamid === steamid && auth.token;
			const j = own
				? await apiGet<{ ok?: boolean; skins?: unknown }>('/rr/loadout', { token: auth.token, ttl: 30_000 })
				: await apiGet<{ ok?: boolean; loadout?: unknown }>(
						`/rr/loadout?steamid=${encodeURIComponent(steamid)}`,
						{ ttl: 30_000 }
					);
			this.#byId = { ...this.#byId, [steamid]: normalize(own ? (j as { skins?: unknown })?.skins : (j as { loadout?: unknown })?.loadout) };
		} catch {
			// 404 (public read not live yet) or network — record the miss so we don't hammer; stock look wins
			this.#byId = { ...this.#byId, [steamid]: {} };
		} finally {
			this.#pending.delete(steamid);
		}
	}

	/** Forget one player (e.g. after their picker saves) so the next ask refetches. */
	refresh(steamid: string): void {
		if (!steamid) return;
		const { [steamid]: _, ...rest } = this.#byId;
		this.#byId = rest;
	}
}

export const loadouts = new LoadoutStore();
