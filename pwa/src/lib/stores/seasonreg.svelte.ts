import { apiGet } from '$lib/net.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { obj, pos } from '$lib/finale/highlights';
import { registerRefusal } from '$lib/launch';

// Registration for the CURRENT season. A flag only: it never gates whether games count. Status comes from the
// public GET /rr/season/status (count for everyone; `registered` when a steamid is sent); joining is the same
// authed POST the Settings card uses. The server now wants a Steam-PROVEN sign-in (403 otherwise).

export class SeasonRegStore {
	/** public count of registered players, undefined until read or on an old server */
	count = $state<number | undefined>(undefined);
	registered = $state(false);
	/** the status has been read for the current viewer */
	known = $state(false);
	busy = $state(false);
	justJoined = $state(false);
	refusal = $state<'signin' | 'error' | null>(null);
	/** an error sentence from the server for a refusal that is not about sign-in */
	message = $state('');

	#reqId = 0;

	/** Read the public status (and this viewer's own, when signed in). Never throws. */
	async load(steamid: string | null = auth.steamid): Promise<void> {
		const my = ++this.#reqId;
		try {
			const qs = steamid ? `?steamid=${encodeURIComponent(steamid)}` : '';
			const j = obj(await apiGet<unknown>(`/rr/season/status${qs}`, { ttl: 0, force: true }));
			if (my !== this.#reqId || !j || j.ok === false) return;
			this.count = pos(j.registered_count);
			this.registered = steamid ? j.registered === true : false;
			this.known = true;
		} catch {
			/* old server or a blip: no count, no strip, no error */
		}
	}

	/** Register for the open season. Refused before any request when signed out. */
	async join(): Promise<boolean> {
		if (this.busy) return false;
		if (!auth.authed) {
			this.refusal = 'signin';
			return false;
		}
		this.busy = true;
		this.message = '';
		const r = await auth.post('/rr/season/register', {});
		this.busy = false;
		if (r.ok) {
			this.refusal = null;
			this.registered = true;
			this.justJoined = true;
			this.count = (this.count ?? 0) + 1;
			return true;
		}
		this.refusal = registerRefusal(r.error);
		if (this.refusal === 'error') this.message = r.error ?? 'Could not register right now.';
		return false;
	}

	reset() {
		this.registered = false;
		this.known = false;
		this.justJoined = false;
		this.refusal = null;
		this.message = '';
	}
}

export const seasonReg = new SeasonRegStore();
