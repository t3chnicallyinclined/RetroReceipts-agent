import { api } from '$lib/config';

// Fleet ("host nodes") store — the live pool of MvC2 lobby-host machines (the maplecast-style node
// map). Rune-$state, modelled on RegionsStore + the matchfeed connect/disconnect pattern: an immediate
// load then a poll every 6s, keep-last-good on a transient blip. The list is small (one row per online
// host) so a plain snapshot + polling is the right call — no virtualization, and the arcade/hosts
// endpoint isn't on the SSE bus. Types are declared here (types.ts is off-limits) as an extension of
// the shipped /arcade/hosts shape.
//   • data: GET /rr/arcade/hosts → { ok, hosts:[ … ] }
//   • the server already filters to ONLINE hosts (a 45s liveness window); the list may be empty.

/** A person on a cabinet's assigned match (server sends {steamid,name}). */
interface AssignedPerson {
	name?: string;
	steamid?: string;
}
/** Raw server enrichment (server host-bundle): discriminated + nested under `assigned`. The client card
 *  historically reads flat `wager`/`tourney`, so we normalize the wire shape into those below (see
 *  normalizeAssignment). Keeping the server's discriminated shape as the wire format is deliberate. */
type Assigned =
	| {
			kind: 'wager';
			wager_id: string;
			status?: string; // open | locked
			stake?: number;
			pot?: number;
			ft?: number;
			challenger?: AssignedPerson;
			acceptor?: AssignedPerson | null;
			cw?: number;
			aw?: number;
	  }
	| {
			kind: 'tourney';
			tid?: string;
			match_id?: string;
			name?: string;
			a?: AssignedPerson;
			b?: AssignedPerson;
			best_of?: number;
			status?: string;
	  };

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
	/** Money (quarter-match) matches this node has refereed (lifetime); server-added (absent until then). */
	money_hosted?: number;
	/** 🪙 quarters this node has earned as host (lifetime house fees); server-added (absent until then). */
	earned?: number;
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

	// --- assignment enrichment (server adds these when the cabinet is bound to a match; all absent = idle/open).
	//     One slot at a time today (queue = future multi-assign). The banner reads them defensively — until the
	//     server ships the enrichment these stay undefined and the banner falls back to the lobby status. ---
	/** raw assignment slot: "mm:<id>" | "t:<tid>#<mid>" | "" — the mode discriminator. */
	assigned_match?: string;
	/** raw server enrichment (discriminated); normalized into `wager`/`tourney` on load. null/absent = idle. */
	assigned?: Assigned | null;
	/** money-match assignment (cabinet bound to a wager). */
	wager?: {
		id: string;
		status?: string; // open | locked
		stake?: number;
		pot?: number;
		ft?: number;
		challenger?: { name?: string; steamid?: string };
		acceptor?: { name?: string; steamid?: string } | null;
		cw?: number;
		aw?: number;
	};
	/** tournament-match assignment (cabinet bound to a bracket match). */
	tourney?: {
		tid?: string;
		name?: string;
		match_id?: string;
		round?: string;
		A?: { name?: string; steamid?: string };
		B?: { name?: string; steamid?: string };
		best_of?: number;
		score?: string;
		status?: string;
	};
}

interface HostsResponse {
	ok?: boolean;
	hosts?: Host[];
}

/** Derived node state — one definition shared by the card's pill/accent and the header counters. */
export type HostStatus = 'match' | 'standby' | 'available' | 'idle';

/**
 * Classify a host from the raw fields. NOTE: `members` INCLUDES the host referee (the server floors the
 * owner in), so joined PLAYERS = members - 1.
 *   • match     — a match is being fought right now (active === 1)
 *   • idle      — online but not hosting a lobby yet (no join link)
 *   • standby   — a player has joined and is waiting for a match (players ≥ 1, i.e. members > 1)
 *   • available — the host is refereeing an empty lobby, open for a money match (players === 0)
 */
// ── ONE cabinet-status vocabulary (card-system step 6). Both the public floor (HostCard/HostBanner)
// and the TO console read THESE words + colors — the audit found two parallel status functions whose
// labels drifted ("Match live" vs "IN MATCH"). Add states here, never locally.
export const HOST_STATUS_META: Record<string, { label: string; cls: string; accent: string }> = {
	match: { label: 'Match live', cls: 'live', accent: 'var(--live)' },
	standby: { label: 'Challenger in', cls: 'gold', accent: 'var(--gold)' },
	available: { label: 'Open', cls: 'good', accent: 'var(--good)' },
	hosting: { label: 'Hosting', cls: 'good', accent: 'var(--good)' },
	idle: { label: 'Starting', cls: 'idle', accent: 'var(--faint)' },
	offline: { label: 'Offline', cls: 'off', accent: 'var(--faint)' }
};

export function hostStatus(h: Host): HostStatus {
	if (h.active === 1) return 'match';
	if (!h.join) return 'idle';
	if ((h.members ?? 0) - 1 > 0) return 'standby'; // players (members minus the host) waiting
	return 'available';
}

// Normalize the server's discriminated `assigned` enrichment into the flat `wager`/`tourney` the card reads.
// Server wire: {kind:'wager', wager_id, …} / {kind:'tourney', a, b, …}. Card: host.wager{id,…} / host.tourney
// {A,B,…}. Without this the banner silently falls back to lobby status (wager/tourney stay undefined).
function normalizeAssignment(h: Host): Host {
	const a = h.assigned;
	if (!a) return h;
	if (a.kind === 'wager') {
		h.wager = {
			id: a.wager_id,
			status: a.status,
			stake: a.stake,
			pot: a.pot,
			ft: a.ft,
			challenger: a.challenger,
			acceptor: a.acceptor ?? null,
			cw: a.cw,
			aw: a.aw
		};
	} else if (a.kind === 'tourney') {
		h.tourney = {
			tid: a.tid,
			name: a.name,
			match_id: a.match_id,
			A: a.a,
			B: a.b,
			best_of: a.best_of,
			status: a.status
		};
	}
	return h;
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
	#refs = 0; // refcounted so /hosts + /match + /u can each drive the poll independently

	/** The online host row for a steamid, or null (used by the cabinet-status banner on /match + /u). */
	byId(steamid: string | null | undefined): Host | null {
		const sid = String(steamid || '');
		return sid ? (this.hosts.find((h) => h.steamid === sid) ?? null) : null;
	}

	async load(): Promise<void> {
		const myReq = ++this.#reqId;
		this.loading = true;
		try {
			const res = await fetch(api('/rr/arcade/hosts'), {
				headers: { accept: 'application/json' }
			});
			if (!res.ok) throw new Error(`hosts ${res.status}`);
			const json = (await res.json()) as HostsResponse;
			if (myReq !== this.#reqId) return;
			this.hosts = sortHosts((json.hosts ?? []).map(normalizeAssignment));
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

	/** Begin polling (immediate load + every 6s). Refcounted — safe for multiple consumers (/hosts, /match,
	 *  /u) to each start/stop; the poll runs while at least one is active. */
	start(): void {
		this.#refs++;
		void this.load();
		if (this.#timer == null && typeof window !== 'undefined') {
			this.#timer = setInterval(() => void this.load(), POLL_MS);
		}
	}

	/** Release one consumer. The poll stops only when the last one leaves; keeps the last-good list. */
	stop(): void {
		this.#refs = Math.max(0, this.#refs - 1);
		if (this.#refs === 0 && this.#timer != null) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}
}

export const hosts = new HostsStore();
