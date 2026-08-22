import { api } from '$lib/config';

// Fleet ("host nodes") store — the live pool of MvC2 lobby-host machines (the maplecast-style node
// map). Rune-$state, modelled on RegionsStore + the matchfeed connect/disconnect pattern: an immediate
// load then a poll every 6s, keep-last-good on a transient blip. The list is small (one row per online
// host) so a plain snapshot + polling is the right call — no virtualization, and the arcade/hosts
// endpoint isn't on the SSE bus. Types are declared here (types.ts is off-limits) as an extension of
// the shipped /arcade/hosts shape.
//   • data: GET /skinsync/arcade/hosts → { ok, hosts:[ … ] }
//   • the server already filters to ONLINE hosts (a 45s liveness window); the list may be empty.

export interface Host {
	steamid: string;
	name: string;
	region?: string;
	lobby_id?: string;
	owner?: string;
	/** steam://joinlobby/2634890/<lobby>/<owner> — EMPTY when the host isn't hosting a lobby yet. */
	join?: string;
	/** players currently in this host's lobby (0 = empty & available). */
	members?: number;
	/** 1 = a match is being fought now · 0 = standby/idle lobby · -1 = unknown. */
	active?: number;
	/** epoch-ms of the host's last heartbeat (drives the "3s ago" freshness label). */
	last_seen_ms?: number;
	/** Steam avatar URL — not always sent by the endpoint; Avatar falls back to a placeholder. */
	avatar?: string;
	/** Host OS banner, e.g. "Bazzite 6.19" — omitted by nodes that haven't reported telemetry yet. */
	os?: string;
	/** Steam relay RTT for this node, ms; -1 (or absent) = unknown → the card hides the ping chip. */
	steam_ping_ms?: number;
	/** Total matches this node has refereed (lifetime), for the fleet's per-node telemetry line. */
	matches_hosted?: number;
	// --- lobby settings the node CREATES its lobbies with (the cabinet's rules; shown on the card) ---
	/** Victory Condition target ("First to N"); 0/absent = unknown. */
	ft?: number;
	/** one-button special moves in the lobby (arcade standard = false/off). */
	one_button?: boolean;
	/** game version/region, e.g. "US". */
	version?: string;
	/** player-slot count (arcade = 2). */
	players?: number;
	/** game label, e.g. "MvC2". */
	game?: string;
	/** short friendly join code shown in-lobby (e.g. "DST6FU"); "" if the node can't read it. */
	lobby_code?: string;
}

interface HostsResponse {
	ok?: boolean;
	hosts?: Host[];
}

/** Derived node state — one definition shared by the card's pill/accent and the header counters. */
export type HostStatus = 'match' | 'standby' | 'available' | 'idle';

/**
 * Classify a host from the raw fields:
 *   • match     — a match is being fought right now (active === 1)
 *   • idle      — online but not hosting a lobby yet (no join link)
 *   • standby   — a hostable lobby with players waiting in it (members > 0)
 *   • available — an empty, joinable lobby (members === 0, join present)
 */
export function hostStatus(h: Host): HostStatus {
	if (h.active === 1) return 'match';
	if (!h.join) return 'idle';
	if ((h.members ?? 0) > 0) return 'standby';
	return 'available';
}

const POLL_MS = 6000;

// In-match first, then lobbies with players, then empty-available, then not-yet-hosting; ties broken
// by the freshest heartbeat. Deterministic so the fleet doesn't reshuffle on every poll.
function sortHosts(list: Host[]): Host[] {
	const rank = (h: Host): number => {
		const s = hostStatus(h);
		return s === 'match' ? 0 : s === 'standby' ? 1 : s === 'available' ? 2 : 3;
	};
	return list
		.slice()
		.sort((a, b) => rank(a) - rank(b) || (b.last_seen_ms ?? 0) - (a.last_seen_ms ?? 0));
}

export class HostsStore {
	hosts = $state<Host[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	lastLoaded = $state(0);

	#reqId = 0;
	#timer: ReturnType<typeof setInterval> | null = null;

	async load(): Promise<void> {
		const myReq = ++this.#reqId;
		this.loading = true;
		try {
			const res = await fetch(api('/skinsync/arcade/hosts'), {
				headers: { accept: 'application/json' }
			});
			if (!res.ok) throw new Error(`hosts ${res.status}`);
			const json = (await res.json()) as HostsResponse;
			if (myReq !== this.#reqId) return;
			this.hosts = sortHosts(json.hosts ?? []);
			this.error = null;
			this.lastLoaded = Date.now();
		} catch (e) {
			if (myReq !== this.#reqId) return;
			// keep-last-good — a transient blip must not blank the fleet.
			this.error = e instanceof Error ? e.message : 'error';
		} finally {
			if (myReq === this.#reqId) this.loading = false;
		}
	}

	/** Begin polling (immediate load + every 6s). Idempotent — safe to call again on tab resume. */
	start(): void {
		void this.load();
		if (this.#timer == null && typeof window !== 'undefined') {
			this.#timer = setInterval(() => void this.load(), POLL_MS);
		}
	}

	/** Stop polling (tab hidden / route left). Keeps the last-good list in place. */
	stop(): void {
		if (this.#timer != null) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}
}

export const hosts = new HostsStore();
