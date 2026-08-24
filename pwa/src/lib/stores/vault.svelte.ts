// The cloud vault, as one shared store — named skins that follow the SteamID. The Locker landing, every
// character Rack and the Dye Station all read/write THIS list (SSOT: one fetch, one cache, every surface).
// Server contract (read from the server source): POST /rr/skins/save {id?, cid, name, author, palette:int[]},
// GET /rr/skins/list → {skins:[{id,cid,name,palette,author,created_ms,updated_ms}]}, POST /rr/skins/delete {id}.
import { api } from '$lib/config';
import { auth } from '$lib/stores/auth.svelte';
import { rgbToHex, hexToRgb } from '$lib/ramps';

export interface VaultSkin {
	id: string;
	cid: number;
	name: string;
	author: string;
	/** 16 × '#rrggbb' */
	palette: string[];
	updated_ms: number;
}

const toInts = (pal: string[]): number[] =>
	pal.map((h) => {
		const [r, g, b] = hexToRgb(h);
		return (r << 16) | (g << 8) | b;
	});

function normalize(raw: unknown): VaultSkin | null {
	const o = raw as { id?: unknown; cid?: unknown; name?: unknown; author?: unknown; palette?: unknown; updated_ms?: unknown };
	const id = typeof o?.id === 'string' ? o.id : '';
	const cid = Number(o?.cid);
	if (!id || !Number.isFinite(cid) || !Array.isArray(o.palette) || o.palette.length < 16) return null;
	const ints = (o.palette as unknown[]).slice(0, 16).map(Number);
	if (ints.some((n) => !Number.isFinite(n))) return null;
	return {
		id,
		cid,
		name: typeof o.name === 'string' ? o.name : '',
		author: typeof o.author === 'string' ? o.author : '',
		palette: ints.map((n) => rgbToHex((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)),
		updated_ms: Number(o.updated_ms) || 0
	};
}

class VaultStore {
	skins = $state<VaultSkin[]>([]);
	loaded = $state(false);
	busy = $state(false);
	#loading = false;

	/** Idempotent list load (call from any skins surface's mount). */
	async load(force = false): Promise<void> {
		if (!auth.authed || this.#loading || (this.loaded && !force)) return;
		this.#loading = true;
		try {
			const res = await fetch(api('/rr/skins/list'), { headers: { accept: 'application/json', ...auth.headers() } });
			if (res.ok) {
				const j = (await res.json()) as { skins?: unknown[] };
				this.skins = (j.skins ?? []).map(normalize).filter((x): x is VaultSkin => !!x)
					.sort((a, b) => b.updated_ms - a.updated_ms);
				this.loaded = true;
			}
		} catch {
			/* keep last-good */
		} finally {
			this.#loading = false;
		}
	}

	forChar(cid: number): VaultSkin[] {
		return this.skins.filter((s) => s.cid === cid);
	}

	/** Save (or update by id). Returns the saved id, or null. */
	async save(cid: number, name: string, palette: string[], id?: string): Promise<string | null> {
		if (!auth.authed || this.busy) return null;
		this.busy = true;
		try {
			const res = await fetch(api('/rr/skins/save'), {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...auth.headers() },
				body: JSON.stringify({ ...(id ? { id } : {}), cid: String(cid), name, author: '', palette: toInts(palette) })
			});
			if (!res.ok) return null;
			const j = (await res.json().catch(() => null)) as { id?: string } | null;
			await this.load(true);
			return j?.id ?? id ?? '';
		} catch {
			return null;
		} finally {
			this.busy = false;
		}
	}

	async remove(id: string): Promise<boolean> {
		if (!auth.authed || this.busy) return false;
		this.busy = true;
		try {
			const res = await fetch(api('/rr/skins/delete'), {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...auth.headers() },
				body: JSON.stringify({ id })
			});
			if (res.ok) this.skins = this.skins.filter((s) => s.id !== id);
			return res.ok;
		} catch {
			return false;
		} finally {
			this.busy = false;
		}
	}
}

export const vault = new VaultStore();
