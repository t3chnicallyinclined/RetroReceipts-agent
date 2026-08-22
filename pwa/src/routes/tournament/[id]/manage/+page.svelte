<script lang="ts">
	// Tournament TO COMMAND-CENTER (Phase 2). Owner-gated build-the-field + launch surface, reusing the live
	// TourneyStore (doc + SSE) so every panel reflects real-time deltas. Every write goes through auth.post
	// (bearer = the acting SteamID server-side); every panel reads from store.doc — no cached/ad-hoc DOM, so a
	// host_update / registration / status delta just re-renders. HOSTED-ONLY: the Host pool is the critical path.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { api } from '$lib/config';
	import { TourneyStore } from '$lib/stores/tourney.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { flagEmoji } from '$lib/format';
	import { teamAbbr } from '$lib/chars';
	import { statusMeta, shortId, type Registration, type BracketMatch } from '$lib/tourney';

	// ── live store wiring (identical discipline to the detail route) ────────────────────────────────
	const store = new TourneyStore();
	const id = $derived(page.params.id ?? '');
	let curId = '';
	$effect(() => {
		const i = id;
		if (i && i !== curId) {
			curId = i;
			store.connect(i);
		}
	});

	// a slow wall-clock tick so host "online" (heartbeat within 45s) recomputes even with no new delta.
	let now = $state(Date.now());
	onMount(() => {
		const onVis = () => {
			if (document.hidden) store.disconnect();
			else store.connect(store.id);
		};
		document.addEventListener('visibilitychange', onVis);
		const iv = setInterval(() => (now = Date.now()), 5000);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			clearInterval(iv);
			store.disconnect();
		};
	});

	const doc = $derived(store.doc);
	const players = $derived(store.players);
	const cold = $derived(store.loading && !doc);
	const st = $derived(statusMeta(doc?.status));
	const status = $derived((doc?.status ?? '').toLowerCase());
	const live = $derived(status === 'running' || status === 'done');

	const isTO = $derived(
		auth.authed && !!auth.steamid && (doc?.to_steamid === auth.steamid || (doc?.co_tos ?? []).includes(auth.steamid))
	);

	// hosts[] is typed unknown[] on TournamentDoc — narrow it here.
	interface TourneyHost {
		steamid: string;
		name?: string;
		lobby_id?: string;
		members?: string[];
		owner?: string;
		on_stream?: boolean;
		active?: number; // 1 = in a match, 0 = standby/menu, -1 = unreadable
		last_seen_ms?: number;
		added_ms?: number;
		assigned_match?: string; // "" free | "t:<tid>#<mid>"
		region?: string;
	}
	const hosts = $derived((doc?.hosts ?? []) as TourneyHost[]);

	// entrants — seeded first (asc), then registration order (mirrors the detail route).
	const regs = $derived(
		(doc?.registrations ?? []).slice().sort((a: Registration, b: Registration) => {
			const sa = a.seed ?? 0;
			const sb = b.seed ?? 0;
			if (sa && sb && sa !== sb) return sa - sb;
			if (sa && !sb) return -1;
			if (sb && !sa) return 1;
			return (a.registered_ms ?? 0) - (b.registered_ms ?? 0);
		})
	);
	const cap = $derived(doc?.cap ?? 0);
	const activeCount = $derived(
		regs.filter((r) => r.status === 'registered' || r.status === 'checked_in').length
	);

	function pname(sid?: string | null): string {
		if (!sid) return '';
		return players[sid]?.name || shortId(sid);
	}
	const SID_RE = /^\d{17}$/;

	// ── shared action plumbing (one busy latch + one notice, like the detail route) ─────────────────
	let busy = $state(false);
	let notice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

	async function act<T = unknown>(
		path: string,
		body: Record<string, unknown>,
		okMsg?: string
	): Promise<{ ok: boolean; error?: string; data?: T } | null> {
		if (busy) return null;
		busy = true;
		notice = null;
		const res = await auth.post<T>(path, { id, ...body });
		busy = false;
		if (res.ok) {
			if (okMsg) notice = { kind: 'ok', text: okMsg };
			void store.load(id); // immediate reconcile (the SSE delta debounce-reloads too)
		} else {
			notice = { kind: 'err', text: res.error ?? 'Something went wrong.' };
		}
		return res;
	}

	// ── HOST POOL (priority) ─────────────────────────────────────────────────────────────────────
	let newHostSid = $state('');
	let newHostName = $state('');

	function isOnline(h: TourneyHost): boolean {
		const seen = h.last_seen_ms ?? 0;
		return seen > 0 && now - seen < 45000; // HOST_ONLINE_MS
	}
	function hostStat(h: TourneyHost): { label: string; cls: string } {
		if (!isOnline(h)) return { label: 'OFFLINE', cls: 'off' };
		if (h.active === 1) return { label: 'IN MATCH', cls: 'live' };
		if (h.lobby_id) return { label: 'HOSTING', cls: 'good' };
		return { label: 'ONLINE', cls: 'idle' };
	}
	function assignedLabel(a?: string): string {
		if (!a) return '';
		const m = /^t:.+#(\d+)$/.exec(a);
		return m ? `Match #${Number(m[1]) + 1}` : '';
	}

	async function addHost(): Promise<void> {
		const sid = newHostSid.trim();
		if (!SID_RE.test(sid)) {
			notice = { kind: 'err', text: 'Enter a 17-digit SteamID64.' };
			return;
		}
		const res = await act('/skinsync/tourney/host_add', { steamid: sid, name: newHostName.trim() }, 'Host registered.');
		if (res?.ok) {
			newHostSid = '';
			newHostName = '';
		}
	}
	function removeHost(sid: string): void {
		void act('/skinsync/tourney/host_remove', { steamid: sid }, 'Host removed.');
	}

	// optional: prefill a SteamID from the GLOBAL online arcade fleet (NOT tourney-specific volunteers).
	interface FleetHost {
		steamid: string;
		name?: string;
		region?: string;
		members?: number;
		active?: number;
	}
	let fleetOpen = $state(false);
	let fleetLoading = $state(false);
	let fleet = $state<FleetHost[]>([]);
	async function toggleFleet(): Promise<void> {
		fleetOpen = !fleetOpen;
		if (fleetOpen && fleet.length === 0) await loadFleet();
	}
	async function loadFleet(): Promise<void> {
		fleetLoading = true;
		try {
			const r = await fetch(api('/skinsync/arcade/hosts'), { headers: { accept: 'application/json' } });
			const j = (await r.json()) as { hosts?: FleetHost[] };
			fleet = j.hosts ?? [];
		} catch {
			fleet = [];
		}
		fleetLoading = false;
	}
	function useFleet(h: FleetHost): void {
		newHostSid = h.steamid;
		if (!newHostName.trim()) newHostName = h.name || h.region || '';
	}
	const alreadyHost = $derived(new Set(hosts.map((h) => h.steamid)));

	// ── ENTRANTS ─────────────────────────────────────────────────────────────────────────────────
	let addSid = $state('');
	async function addEntrant(): Promise<void> {
		const sid = addSid.trim();
		if (!SID_RE.test(sid)) {
			notice = { kind: 'err', text: 'Enter a 17-digit SteamID64.' };
			return;
		}
		const res = await act('/skinsync/tourney/add_entrant', { steamid: sid }, 'Entrant added.');
		if (res?.ok) addSid = '';
	}
	function setSeed(sid: string, raw: string): void {
		const n = Math.max(0, Math.floor(Number(raw) || 0));
		void act('/skinsync/tourney/entrant_update', { steamid: sid, seed: n });
	}
	function setStatus(sid: string, s: string, msg?: string): void {
		void act('/skinsync/tourney/entrant_update', { steamid: sid, status: s }, msg);
	}
	function toggleCheckin(sid: string, ci: boolean): void {
		void act('/skinsync/tourney/entrant_update', { steamid: sid, checked_in: ci });
	}
	function dq(sid: string): void {
		void act('/skinsync/tourney/entrant_dq', { steamid: sid }, 'Entrant disqualified.');
	}

	// ── SEEDING + CHECK-IN + START ─────────────────────────────────────────────────────────────────
	function seedBy(method: string): void {
		void act('/skinsync/tourney/seed', { method }, `Seeded by ${method === 'elo' ? 'ELO' : method}.`);
	}
	function checkinCtl(action: string, extra: Record<string, unknown> = {}, msg?: string): void {
		void act('/skinsync/tourney/checkin_ctl', { action, ...extra }, msg);
	}
	async function startBracket(): Promise<void> {
		const res = await act<{ needs_host?: boolean }>('/skinsync/tourney/start', {});
		if (res?.ok) {
			notice = res.data?.needs_host
				? { kind: 'err', text: 'Bracket started — but no host is registered. Add a host below so matches can be played.' }
				: { kind: 'ok', text: 'Bracket started.' };
		}
	}

	// ══ RUN CONSOLE (live) ═══════════════════════════════════════════════════════════════════════════
	// Everything below derives from the live bracket in store.doc — no local match cache, so an SSE
	// match_update / bracket_advance just re-renders. There is NO per-host queue on the server:
	// "who's up next per host" is grouped CLIENT-SIDE from each match's own `host` field.
	const br = $derived(doc?.bracket ?? null);
	const allMatches = $derived(Array.isArray(br?.matches) ? (br?.matches ?? []) : []);
	const champion = $derived(br?.champion ?? null);

	// state → sort weight (live first, decided last). Matches server MState (snake_case).
	const MSTATE_ORDER: Record<string, number> = { live: 0, ready: 1, pending: 2, done: 3, bye: 4, void: 5 };
	function mstate(m: BracketMatch): string {
		return String(m?.state ?? '').toLowerCase();
	}
	function isTerminal(m: BracketMatch): boolean {
		const s = mstate(m);
		return s === 'done' || s === 'bye' || s === 'void';
	}
	// The TO can report a Ready OR Live match once both seats are real players (server rule — calling to
	// station is a signal, not a prerequisite for reporting).
	function reportable(m: BracketMatch): boolean {
		const s = mstate(m);
		return (s === 'ready' || s === 'live') && !!m.p1 && !!m.p2;
	}
	function brLabel(m: BracketMatch): string {
		const b = String(m?.bracket ?? '').toLowerCase();
		if (b === 'grand') return 'GF';
		const pre = b === 'winners' ? 'W' : b === 'losers' ? 'L' : b ? b.slice(0, 1).toUpperCase() : '';
		const r = m?.round ?? 0;
		return r ? `${pre}R${r}` : pre || '—';
	}
	function runChip(m: BracketMatch): { label: string; cls: string } {
		switch (mstate(m)) {
			case 'live':
				return { label: 'LIVE', cls: 'live' };
			case 'ready':
				return { label: 'READY', cls: 'ready' };
			case 'done':
				return { label: m.score || 'DONE', cls: 'done' };
			case 'bye':
				return { label: 'BYE', cls: 'muted' };
			case 'void':
				return { label: 'VOID', cls: 'muted' };
			default:
				return { label: 'PENDING', cls: 'muted' };
		}
	}

	// The console match list: everything except structural bye/void, ordered live → ready → pending → done.
	const runMatches = $derived(
		allMatches
			.filter((m) => {
				const s = mstate(m);
				return s !== 'bye' && s !== 'void';
			})
			.slice()
			.sort((a, b) => {
				const oa = MSTATE_ORDER[mstate(a)] ?? 8;
				const ob = MSTATE_ORDER[mstate(b)] ?? 8;
				if (oa !== ob) return oa - ob;
				return (a.id ?? 0) - (b.id ?? 0);
			})
	);
	const openCount = $derived(runMatches.filter((m) => !isTerminal(m)).length);
	// ready matches (both players known) still without a host — the "assign me" backlog.
	const unassignedOpen = $derived(
		runMatches.filter((m) => !isTerminal(m) && !m.host && !!m.p1 && !!m.p2).length
	);

	// "Up next" PER HOST — grouped client-side from match.host (there is no server queue). For each host:
	// on-now (live first, else the next ready/pending), the one after it, and a count of any beyond.
	interface Station {
		host: TourneyHost;
		onNow?: BracketMatch;
		next?: BracketMatch;
		more: number;
	}
	const stations = $derived.by<Station[]>(() => {
		const byHost = new Map<string, BracketMatch[]>();
		for (const m of allMatches) {
			const h = String(m.host ?? '');
			if (!h || isTerminal(m)) continue;
			const arr = byHost.get(h);
			if (arr) arr.push(m);
			else byHost.set(h, [m]);
		}
		return hosts.map((host) => {
			const arr = (byHost.get(host.steamid) ?? []).slice().sort((a, b) => {
				const oa = MSTATE_ORDER[mstate(a)] ?? 8;
				const ob = MSTATE_ORDER[mstate(b)] ?? 8;
				if (oa !== ob) return oa - ob;
				return (a.id ?? 0) - (b.id ?? 0);
			});
			return { host, onNow: arr[0], next: arr[1], more: Math.max(0, arr.length - 2) };
		});
	});

	// ── run-control actions (all TO-authed; every write flows through act → auth.post) ──────────────
	function assignHost(matchId: number, hostSid: string): void {
		void act('/skinsync/tourney/host_assign', { match_id: matchId, host_steamid: hostSid });
	}
	function callToStation(matchId: number): void {
		void act('/skinsync/tourney/match_run', { match_id: matchId, live: true }, 'Players called to station.');
	}
	function pullBack(matchId: number): void {
		void act('/skinsync/tourney/match_run', { match_id: matchId, live: false }, 'Match set back to ready.');
	}
	function toggleStream(m: BracketMatch): void {
		void act('/skinsync/tourney/match_run', { match_id: m.id, on_stream: !m.on_stream });
	}
	async function reportWinner(matchId: number, winnerSid: string): Promise<void> {
		const res = await act<{ champion?: string | null }>(
			'/skinsync/tourney/report',
			{ match_id: matchId, winner_steamid: winnerSid },
			'Result recorded.'
		);
		if (res?.ok && res.data?.champion) {
			notice = { kind: 'ok', text: `🏆 Champion — ${pname(res.data.champion)}` };
		}
	}
	function undoMatch(matchId: number): void {
		void act('/skinsync/tourney/match_reset', { match_id: matchId }, 'Match reset.');
	}

	// ── DELETE (double-confirm) ─────────────────────────────────────────────────────────────────────
	let confirmDelete = $state(false);
	async function doDelete(): Promise<void> {
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		const res = await act('/skinsync/tourney/delete', {});
		if (res?.ok) void goto(`${base}/tournament`);
	}
</script>

<svelte:head><title>Manage · {doc?.name || 'Tournament'} · MetaSync</title></svelte:head>

<section class="mast" style="--acc:#8b6dff">
	<div class="ghost" aria-hidden="true">COMMAND</div>
	<div class="mrow">
		<h1 class="mtitle">MANAGE</h1>
		<a class="pill back" href="{base}/tournament/{id}">← Event</a>
	</div>
	<div class="seam" aria-hidden="true"></div>
	<p class="mdesc">Build the field, register hosts, and launch the bracket. Everything here is live.</p>
</section>

{#if !auth.authed}
	<div class="signin">
		<p>Sign in with Steam to manage this event.</p>
		<button type="button" class="steam" onclick={() => auth.login()}>Sign in through Steam</button>
	</div>
{:else if cold}
	<div class="empty">LOADING…</div>
{:else if !doc}
	<div class="empty">Couldn’t load this tournament.</div>
{:else if !isTO}
	<div class="empty">You’re not the organizer of this event.</div>
{:else}
	<div class="statusbar">
		<span class="pill {st.cls}">{st.label}</span>
		<span class="sb-name">{doc.name || 'Untitled'}</span>
		<span class="sb-count">{activeCount}{cap ? ` / ${cap}` : ''} in</span>
	</div>

	<!-- ═══ HOST POOL — the critical path (hosted-only) ═══ -->
	<div class="frail">Host pool</div>
	<div class="panel">
		{#if hosts.length}
			<div class="hlist">
				{#each hosts as h (h.steamid)}
					{@const s = hostStat(h)}
					{@const asg = assignedLabel(h.assigned_match)}
					<div class="host">
						<a class="hwho" href="{base}/u/{h.steamid}">
							<Avatar url={players[h.steamid]?.avatar} size={30} alt={pname(h.steamid)} />
							<span class="hnm">
								<span class="hname">{pname(h.steamid)}</span>
								{#if h.name}<span class="hlabel">{h.name}</span>{/if}
							</span>
						</a>
						<div class="htags">
							<span class="dot {s.cls}"></span><span class="hstat {s.cls}">{s.label}</span>
							{#if h.lobby_id}<span class="hmeta">🎮 {h.members?.length ?? 0} in lobby</span>{/if}
							{#if asg}<span class="hmeta">↳ {asg}</span>{/if}
							{#if h.on_stream}<span class="hmeta stream">▶ stream</span>{/if}
						</div>
						<button type="button" class="mini danger" disabled={busy} onclick={() => removeHost(h.steamid)}>Remove</button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="hollow">
				Register <b>2–3 hosts</b> to run this event — more hosts run more matches at once, so the bracket
				keeps moving. Anyone can volunteer their account (Bazzite/Linux for now).
			</div>
		{/if}

		<div class="hadd">
			<div class="frow">
				<div class="field">
					<label class="lbl" for="h-sid">Host SteamID64</label>
					<input id="h-sid" class="inp" inputmode="numeric" maxlength="17" placeholder="7656119…" bind:value={newHostSid} />
				</div>
				<div class="field">
					<label class="lbl" for="h-name">Label <span class="dimhint">— optional (“Main stream”)</span></label>
					<input id="h-name" class="inp" maxlength="48" placeholder="Setup name" bind:value={newHostName} />
				</div>
			</div>
			<div class="row-actions">
				<button type="button" class="mini" onclick={toggleFleet}>{fleetOpen ? 'Hide' : 'Pick from'} online hosts</button>
				<button type="submit" class="submit sm" disabled={busy} onclick={addHost}><span>Add host</span></button>
			</div>

			{#if fleetOpen}
				<div class="fleet">
					<div class="micro">Online host machines (global arcade fleet, heartbeating now) — tap to fill in the SteamID.</div>
					{#if fleetLoading}
						<div class="micro">Loading fleet…</div>
					{:else if fleet.length === 0}
						<div class="micro">No hosts are online right now.</div>
					{:else}
						<div class="flist">
							{#each fleet as f (f.steamid)}
								<button
									type="button"
									class="fitem"
									class:added={alreadyHost.has(f.steamid)}
									disabled={busy || alreadyHost.has(f.steamid)}
									onclick={() => useFleet(f)}
								>
									<span class="fnm">{f.name || shortId(f.steamid)}</span>
									<span class="fmeta">
										{#if f.region}{f.region} · {/if}{f.active === 1 ? 'in match' : 'idle'}
										{#if alreadyHost.has(f.steamid)} · added{/if}
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- ═══ RUN CONSOLE (once the bracket is live) ═══ -->
	{#if live}
		{#snippet miniMatch(m: BracketMatch)}
			<span class="qm">
				<span class="qm-id">#{(m.id ?? 0) + 1}</span>
				<span class="qm-vs">
					{m.p1 ? pname(m.p1) : m.p1_from || 'TBD'}<span class="qm-x">vs</span>{m.p2 ? pname(m.p2) : m.p2_from || 'TBD'}
				</span>
			</span>
		{/snippet}

		{#snippet runSeat(m: BracketMatch, sid: string | null | undefined, from: string | undefined, bye: boolean | undefined)}
			{@const isWin = !!m.winner && m.winner === sid}
			<div class="rseat" class:win={isWin}>
				{#if sid}
					<a class="rsname" href="{base}/u/{sid}">
						<Avatar url={players[sid]?.avatar} size={20} alt={pname(sid)} />
						<span class="rst">{pname(sid)}</span>
					</a>
				{:else if bye}
					<span class="rtbd">Bye</span>
				{:else}
					<span class="rtbd">{from || 'TBD'}</span>
				{/if}
				{#if isWin}<span class="rwtick" aria-hidden="true">✓</span>{/if}
				{#if reportable(m) && sid}
					<button
						type="button"
						class="win-cut"
						disabled={busy}
						title="Report {pname(sid)} as the winner"
						onclick={() => sid && reportWinner(m.id, sid)}
					>
						<span>WIN</span>
					</button>
				{/if}
			</div>
		{/snippet}

		{#snippet runCard(m: BracketMatch)}
			{@const chip = runChip(m)}
			{@const s = mstate(m)}
			{@const term = isTerminal(m)}
			<div class="rc st-{s}" class:on={m.on_stream} class:term>
				<div class="rc-hd">
					<span class="rc-id">#{(m.id ?? 0) + 1}</span>
					<span class="rc-br">{brLabel(m)}</span>
					<span class="chip {chip.cls}">{chip.label}</span>
					{#if m.on_stream}<span class="rc-stream">▶ STREAM</span>{/if}
				</div>
				<div class="rc-seats">
					{@render runSeat(m, m.p1, m.p1_from, m.p1_bye)}
					{@render runSeat(m, m.p2, m.p2_from, m.p2_bye)}
				</div>
				<div class="rc-ctl">
					<select
						class="hsel"
						aria-label="Assign host for match {(m.id ?? 0) + 1}"
						disabled={busy || term}
						value={m.host ?? ''}
						onchange={(e) => assignHost(m.id, e.currentTarget.value)}
					>
						<option value="">Unassigned</option>
						{#each hosts as h (h.steamid)}
							<option value={h.steamid}>{pname(h.steamid)}{h.name ? ` · ${h.name}` : ''}</option>
						{/each}
					</select>
					{#if !term}
						{#if s === 'ready'}
							<button type="button" class="mini call" disabled={busy} onclick={() => callToStation(m.id)}>▶ Call to station</button>
						{:else if s === 'live'}
							<button type="button" class="mini" disabled={busy} onclick={() => pullBack(m.id)}>Set ready</button>
						{/if}
						<button type="button" class="mini" class:active={m.on_stream} disabled={busy} onclick={() => toggleStream(m)}>
							{m.on_stream ? '▶ On stream' : 'Stream'}
						</button>
					{:else if s === 'done'}
						<button type="button" class="mini" disabled={busy} onclick={() => undoMatch(m.id)}>Undo result</button>
					{/if}
				</div>
			</div>
		{/snippet}

		{#if champion}
			<div class="champ-line">
				<span class="crown" aria-hidden="true">🏆</span>
				<span>Champion — <b>{pname(champion)}</b></span>
			</div>
		{/if}

		{#if status === 'running'}
			<div class="frail">Stations <span class="rail-cnt">{stations.length}</span></div>
			{#if hosts.length}
				<div class="stations">
					{#each stations as stn (stn.host.steamid)}
						{@const hs = hostStat(stn.host)}
						<div class="stn">
							<div class="stn-hd">
								<span class="dot {hs.cls}"></span>
								<span class="stn-nm">{pname(stn.host.steamid)}</span>
								{#if stn.host.name}<span class="stn-lb">{stn.host.name}</span>{/if}
								{#if stn.host.on_stream}<span class="stn-stream" title="On stream">▶</span>{/if}
							</div>
							{#if stn.onNow}
								{@const nc = runChip(stn.onNow)}
								<div class="stn-now">
									<span class="stn-k">ON NOW</span>
									{@render miniMatch(stn.onNow)}
									<span class="chip {nc.cls} sm">{nc.label}</span>
								</div>
								{#if stn.next}
									<div class="stn-next">
										<span class="stn-k dim">NEXT</span>
										{@render miniMatch(stn.next)}
										{#if stn.more}<span class="stn-more">+{stn.more} more</span>{/if}
									</div>
								{/if}
							{:else}
								<div class="stn-idle">No match assigned — assign one below.</div>
							{/if}
						</div>
					{/each}
				</div>
				{#if unassignedOpen}
					<div class="micro assign-hint">
						{unassignedOpen} ready match{unassignedOpen === 1 ? '' : 'es'} still {unassignedOpen === 1 ? 'needs' : 'need'} a host — assign in the list below.
					</div>
				{/if}
			{:else}
				<div class="panel"><div class="hollow">No hosts registered — add one in the Host pool above so matches can be dispatched to a station.</div></div>
			{/if}
		{/if}

		<div class="frail">Live matches <span class="rail-cnt">{openCount} open</span></div>
		<div class="panel">
			{#if runMatches.length}
				<div class="rlist">
					{#each runMatches as m (m.id)}
						{@render runCard(m)}
					{/each}
				</div>
			{:else}
				<div class="hollow">No matches to run yet.</div>
			{/if}
		</div>
	{/if}

	<!-- ═══ ENTRANTS ═══ -->
	<div class="frail">Entrants <span class="rail-cnt">{regs.length}</span></div>
	<div class="panel">
		{#if regs.length}
			<div class="etable">
				{#each regs as r (r.steamid)}
					{@const dropped = r.status === 'dropped' || r.status === 'dq'}
					{@const wl = r.status === 'waitlisted'}
					<div class="erow" class:dropped>
						<input
							class="seedin"
							type="number"
							min="0"
							inputmode="numeric"
							aria-label="Seed for {pname(r.steamid)}"
							value={r.seed || ''}
							disabled={busy || live}
							onchange={(e) => setSeed(r.steamid, e.currentTarget.value)}
						/>
						<a class="ewho" href="{base}/u/{r.steamid}">
							<Avatar url={players[r.steamid]?.avatar} size={26} alt={pname(r.steamid)} />
							<span class="enm">
								{#if players[r.steamid]?.cc}<span class="ef">{flagEmoji(players[r.steamid]?.cc)}</span>{/if}
								{pname(r.steamid)}
							</span>
						</a>
						{#if r.team && r.team.length}<span class="team">{teamAbbr(r.team)}</span>{/if}
						<span class="estat">
							{#if r.status === 'dq'}<span class="pill live">DQ</span>
							{:else if r.status === 'dropped'}<span class="pill muted">DROPPED</span>
							{:else if wl}<span class="pill gold">WAITLIST</span>
							{:else if r.checked_in || r.status === 'checked_in'}<span class="pill good">CHECKED IN</span>
							{:else}<span class="pill muted">REGISTERED</span>{/if}
						</span>
						{#if !live}
							<div class="eact">
								{#if wl || dropped}
									<button type="button" class="mini" disabled={busy} onclick={() => setStatus(r.steamid, 'registered', 'Promoted.')}>Promote</button>
								{:else}
									{#if r.checked_in || r.status === 'checked_in'}
										<button type="button" class="mini" disabled={busy} onclick={() => toggleCheckin(r.steamid, false)}>Uncheck</button>
									{:else}
										<button type="button" class="mini" disabled={busy} onclick={() => toggleCheckin(r.steamid, true)}>Check in</button>
									{/if}
									<button type="button" class="mini" disabled={busy} onclick={() => setStatus(r.steamid, 'waitlisted', 'Moved to waitlist.')}>Waitlist</button>
									<button type="button" class="mini danger" disabled={busy} onclick={() => dq(r.steamid)}>DQ</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="hollow">No entrants yet. Add one by SteamID below, or share the event link so players can register themselves.</div>
		{/if}

		{#if !live}
			<div class="hadd">
				<div class="frow">
					<div class="field">
						<label class="lbl" for="e-sid">Add entrant by SteamID64</label>
						<input id="e-sid" class="inp" inputmode="numeric" maxlength="17" placeholder="7656119…" bind:value={addSid} />
					</div>
					<div class="field row-actions end">
						<button type="submit" class="submit sm" disabled={busy} onclick={addEntrant}><span>Add entrant</span></button>
					</div>
				</div>
			</div>
		{/if}
	</div>

	{#if !live}
		<!-- ═══ CHECK-IN ═══ -->
		<div class="frail">Check-in</div>
		<div class="panel pad">
			<div class="ctrl-row">
				{#if status === 'checkin'}
					<button type="button" class="mini" disabled={busy} onclick={() => checkinCtl('close', {}, 'Check-in closed.')}>Close check-in</button>
					<button type="button" class="mini" disabled={busy} onclick={() => checkinCtl('finalize', {}, 'No-shows dropped.')}>Finalize · drop no-shows</button>
					<button type="button" class="mini danger" disabled={busy} onclick={() => checkinCtl('finalize', { dq_noshows: true }, 'No-shows DQ’d.')}>Finalize · DQ no-shows</button>
				{:else}
					<button type="button" class="mini" disabled={busy} onclick={() => checkinCtl('open', {}, 'Check-in is open.')}>Open check-in</button>
				{/if}
			</div>
			<div class="micro">Finalize drops (or DQs) everyone still registered but not checked in, then returns the event to Open to seed &amp; start.</div>
		</div>

		<!-- ═══ SEED &amp; START ═══ -->
		<div class="frail">Seed &amp; start</div>
		<div class="panel pad">
			<div class="ctrl-row">
				<button type="button" class="mini" disabled={busy} onclick={() => seedBy('elo')}>Seed by ELO</button>
				<button type="button" class="mini" disabled={busy} onclick={() => seedBy('random')}>Randomize</button>
				<span class="micro inline">or set seeds by hand in the entrant list above (that’s a manual seed).</span>
			</div>
			{#if hosts.length === 0}
				<div class="warn">No host is registered yet — matches will need a host to be played. You can still start.</div>
			{/if}
			<button type="submit" class="submit start" disabled={busy || activeCount < 2} onclick={startBracket}>
				<span>{busy ? 'Working…' : `Start bracket · ${activeCount} entrant${activeCount === 1 ? '' : 's'}`}</span>
			</button>
			{#if activeCount < 2}<div class="micro">Need at least 2 entrants to start.</div>{/if}
		</div>
	{/if}

	<!-- ═══ DANGER ═══ -->
	<div class="frail">Danger zone</div>
	<div class="panel pad danger-zone">
		{#if confirmDelete}
			<div class="warn">Permanently delete “{doc.name || 'this event'}”? This can’t be undone.</div>
			<div class="ctrl-row">
				<button type="button" class="mini" disabled={busy} onclick={() => (confirmDelete = false)}>Cancel</button>
				<button type="button" class="mini danger solid" disabled={busy} onclick={doDelete}>Yes, delete it</button>
			</div>
		{:else}
			<button type="button" class="mini danger" disabled={busy} onclick={doDelete}>Delete tournament</button>
		{/if}
	</div>

	{#if notice}<div class="notice {notice.kind}" role="status">{notice.text}</div>{/if}
{/if}

<style>
	.mast {
		position: relative;
		overflow: hidden;
		padding: 14px 4px 10px;
		margin-bottom: 6px;
	}
	.ghost {
		position: absolute;
		right: 0;
		top: -6px;
		font-size: clamp(42px, 12vw, 96px);
		font-style: italic;
		font-weight: 900;
		letter-spacing: -0.03em;
		color: var(--ink);
		opacity: 0.045;
		pointer-events: none;
		user-select: none;
		white-space: nowrap;
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.mtitle {
		font-size: clamp(20px, 5.5vw, 27px);
		font-weight: 900;
		font-style: italic;
		letter-spacing: 0.01em;
	}
	.pill.back {
		font-size: 10.5px;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-decoration: none;
		color: var(--dim);
		border: 1px solid var(--line);
		background: var(--panel-2);
		border-radius: 6px;
		padding: 4px 9px;
	}
	.pill.back:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.seam {
		height: 3px;
		width: 120px;
		margin: 8px 0 9px;
		transform: skewX(-14deg);
		background: linear-gradient(90deg, var(--acc), transparent);
	}
	.mdesc {
		margin: 0;
		max-width: 720px;
		color: var(--dim);
		font-size: 12.5px;
		line-height: 1.5;
	}
	.empty {
		margin: 14px 0;
		padding: 22px 16px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		text-align: center;
		color: var(--dim);
		font-size: 13px;
	}
	.signin {
		border: 1px dashed var(--line);
		border-radius: 14px;
		padding: 26px 18px;
		text-align: center;
		color: var(--dim);
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-items: center;
	}
	.steam {
		font: inherit;
		font-weight: 800;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: none;
		border-radius: 10px;
		padding: 10px 18px;
		cursor: pointer;
	}
	.statusbar {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 6px 2px 12px;
		flex-wrap: wrap;
	}
	.sb-name {
		font-weight: 800;
		font-size: 13.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.sb-count {
		margin-left: auto;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--gold);
		font-variant-numeric: tabular-nums;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.06em;
		padding: 2px 7px;
		border-radius: 6px;
		border: 1px solid var(--line);
		text-transform: uppercase;
	}
	.pill.good {
		color: var(--good);
		border-color: color-mix(in srgb, var(--good) 34%, var(--line));
		background: color-mix(in srgb, var(--good) 12%, transparent);
	}
	.pill.gold {
		color: var(--gold);
		border-color: color-mix(in srgb, var(--gold) 34%, var(--line));
		background: var(--gold-soft);
	}
	.pill.live {
		color: var(--live);
		border-color: color-mix(in srgb, var(--live) 40%, var(--line));
		background: color-mix(in srgb, var(--live) 12%, transparent);
	}
	.pill.muted {
		color: var(--faint);
	}
	.frail {
		margin: 16px 2px 8px;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.rail-cnt {
		font-size: 11px;
		letter-spacing: 0.02em;
		color: var(--gold);
		font-variant-numeric: tabular-nums;
	}
	.panel {
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--panel);
		overflow: hidden;
	}
	.panel.pad {
		padding: 13px 14px;
	}
	.hollow {
		padding: 20px 16px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
		color: var(--dim);
		font-size: 12.5px;
		line-height: 1.5;
	}
	.hlist {
		display: flex;
		flex-direction: column;
	}
	.host {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 13px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
		flex-wrap: wrap;
	}
	.hwho {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		flex: 1 1 180px;
		text-decoration: none;
		color: inherit;
	}
	.hnm {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.hname {
		font-weight: 800;
		font-size: 13.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hwho:hover .hname {
		color: var(--gold);
	}
	.hlabel {
		font-size: 10.5px;
		color: var(--faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.htags {
		display: flex;
		align-items: center;
		gap: 6px 10px;
		flex-wrap: wrap;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--faint);
		flex: none;
	}
	.dot.good,
	.dot.idle {
		background: var(--good);
	}
	.dot.live {
		background: var(--live);
	}
	.dot.off {
		background: var(--faint);
	}
	.hstat {
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.06em;
	}
	.hstat.good,
	.hstat.idle {
		color: var(--good);
	}
	.hstat.live {
		color: var(--live);
	}
	.hstat.off {
		color: var(--faint);
	}
	.hmeta {
		font-size: 11px;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.hmeta.stream {
		color: var(--stream);
	}
	.hadd {
		padding: 13px 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.frow {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
		gap: 10px 12px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.lbl {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.dimhint {
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
		color: var(--faint);
	}
	.inp {
		font: inherit;
		font-size: 16px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 10px 11px;
		width: 100%;
		min-height: 44px;
		appearance: none;
		-webkit-appearance: none;
	}
	.inp:focus-visible {
		outline: none;
		border-color: var(--gold-soft);
	}
	.row-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.row-actions.end {
		align-self: end;
		min-height: 44px;
	}
	.fleet {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 4px;
	}
	.flist {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	.fitem {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		font: inherit;
		text-align: left;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 7px 11px;
		cursor: pointer;
	}
	.fitem:hover:not(:disabled) {
		border-color: var(--gold-soft);
	}
	.fitem:disabled,
	.fitem.added {
		opacity: 0.5;
		cursor: default;
	}
	.fnm {
		font-size: 12.5px;
		font-weight: 800;
	}
	.fmeta {
		font-size: 10px;
		color: var(--faint);
	}
	.etable {
		display: flex;
		flex-direction: column;
	}
	.erow {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 9px 13px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
		flex-wrap: wrap;
	}
	.erow.dropped {
		opacity: 0.5;
	}
	.seedin {
		flex: none;
		width: 42px;
		font: inherit;
		font-size: 13px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		text-align: center;
		color: var(--gold);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 7px;
		padding: 6px 4px;
		appearance: textfield;
		-moz-appearance: textfield;
	}
	.seedin:disabled {
		color: var(--dim);
		opacity: 0.7;
	}
	.seedin:focus-visible {
		outline: none;
		border-color: var(--gold-soft);
	}
	.ewho {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		flex: 1 1 150px;
		text-decoration: none;
		color: inherit;
	}
	.enm {
		font-weight: 700;
		font-size: 13.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.enm .ef {
		margin-right: 3px;
	}
	.ewho:hover .enm {
		color: var(--gold);
	}
	.team {
		flex: none;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: var(--dim);
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
	}
	.estat {
		flex: none;
	}
	.eact {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-left: auto;
	}
	.ctrl-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.warn {
		margin: 2px 0 10px;
		padding: 9px 12px;
		border: 1px solid color-mix(in srgb, var(--gold) 30%, var(--line));
		background: var(--gold-soft);
		border-radius: 9px;
		font-size: 12px;
		font-weight: 700;
		color: var(--gold);
	}
	.danger-zone {
		border-color: color-mix(in srgb, var(--live) 30%, var(--line));
	}
	.mini {
		font: inherit;
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0;
		text-transform: none;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 7px;
		padding: 6px 11px;
		min-height: 32px;
		cursor: pointer;
	}
	.mini:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.mini:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.mini.danger {
		color: var(--live);
		border-color: color-mix(in srgb, var(--live) 30%, var(--line));
	}
	.mini.danger:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--live) 55%, var(--line));
		color: var(--live);
	}
	.mini.danger.solid {
		color: #fff;
		background: var(--live);
		border-color: var(--live);
	}
	.micro {
		font-size: 11px;
		color: var(--faint);
		line-height: 1.5;
	}
	.micro.inline {
		align-self: center;
	}
	.submit {
		font: inherit;
		font-size: 13.5px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 10px;
		padding: 0 20px;
		min-height: 44px;
		cursor: pointer;
		transform: skewX(-8deg);
		white-space: nowrap;
	}
	.submit.sm {
		min-height: 40px;
		font-size: 12.5px;
		padding: 0 16px;
	}
	.submit.start {
		margin-top: 12px;
		width: 100%;
	}
	.submit > span {
		display: inline-block;
		transform: skewX(8deg);
	}
	.submit:hover:not(:disabled) {
		filter: brightness(1.05);
	}
	.submit:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.notice {
		margin-top: 12px;
		font-size: 12.5px;
		font-weight: 700;
	}
	.notice.ok {
		color: var(--good);
	}
	.notice.err {
		color: var(--live);
	}

	/* ── run console ── */
	.champ-line {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 4px 0 12px;
		padding: 10px 13px;
		border: 1px solid color-mix(in srgb, var(--gold) 42%, var(--line));
		background: var(--gold-soft);
		border-radius: 11px;
		font-size: 13px;
		font-weight: 800;
	}
	.champ-line .crown {
		font-size: 15px;
	}
	/* state chips (shared by station queues + run cards) */
	.chip {
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.06em;
		padding: 1px 6px;
		border-radius: 5px;
		border: 1px solid var(--line);
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.chip.sm {
		font-size: 8.5px;
	}
	.chip.live {
		color: var(--live);
		border-color: color-mix(in srgb, var(--live) 40%, var(--line));
		background: color-mix(in srgb, var(--live) 12%, transparent);
	}
	.chip.ready {
		color: var(--gold);
		border-color: color-mix(in srgb, var(--gold) 40%, var(--line));
	}
	.chip.done {
		color: var(--good);
		border-color: color-mix(in srgb, var(--good) 34%, var(--line));
	}
	.chip.muted {
		color: var(--faint);
	}

	/* stations — the per-host "who's up next" (client-derived) */
	.stations {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
		gap: 10px;
	}
	.stn {
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.stn-hd {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.stn-nm {
		font-weight: 800;
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.stn-lb {
		font-size: 10px;
		color: var(--faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.stn-stream {
		margin-left: auto;
		color: var(--stream);
		font-size: 11px;
		flex: none;
	}
	.stn-now,
	.stn-next {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.stn-k {
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.1em;
		color: var(--good);
		flex: none;
	}
	.stn-k.dim {
		color: var(--faint);
	}
	.stn-idle {
		font-size: 11.5px;
		font-style: italic;
		color: var(--faint);
	}
	.stn-more {
		font-size: 10px;
		font-weight: 800;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.qm {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.qm-id {
		font-size: 10px;
		font-weight: 800;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
		flex: none;
	}
	.qm-vs {
		font-size: 12px;
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.qm-x {
		color: var(--faint);
		font-weight: 600;
		font-style: italic;
		margin: 0 5px;
	}
	.assign-hint {
		margin: 8px 2px 0;
		color: var(--dim);
	}

	/* run cards — the assign / call / report surface */
	.rlist {
		display: flex;
		flex-direction: column;
	}
	.rc {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 13px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
		border-left: 3px solid var(--line);
	}
	.rc:last-child {
		border-bottom: none;
	}
	.rc.st-live {
		border-left-color: color-mix(in srgb, var(--live) 60%, var(--line));
	}
	.rc.st-ready {
		border-left-color: color-mix(in srgb, var(--gold) 55%, var(--line));
	}
	.rc.st-done {
		border-left-color: color-mix(in srgb, var(--good) 40%, var(--line));
	}
	.rc.term {
		opacity: 0.72;
	}
	.rc.on {
		background: color-mix(in srgb, var(--stream) 6%, transparent);
	}
	.rc-hd {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.rc-id {
		font-size: 11px;
		font-weight: 900;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.rc-br {
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 1px 5px;
	}
	.rc-stream {
		margin-left: auto;
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.06em;
		color: var(--stream);
	}
	.rc-seats {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.rseat {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		padding: 2px 0;
	}
	.rsname {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		flex: 1 1 auto;
		text-decoration: none;
		color: inherit;
	}
	.rst {
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.rseat.win .rst {
		font-weight: 800;
		color: var(--ink);
	}
	.rsname:hover .rst {
		color: var(--gold);
	}
	.rtbd {
		font-size: 12px;
		font-style: italic;
		color: var(--faint);
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rwtick {
		flex: none;
		font-size: 12px;
		font-weight: 900;
		color: var(--good);
	}
	/* WIN = confirm-a-result (green Cut) — deliberately NOT gold; gold stays the app's one primary treatment. */
	.win-cut {
		margin-left: auto;
		flex: none;
		font: inherit;
		font-size: 10.5px;
		font-weight: 900;
		letter-spacing: 0.05em;
		color: #06210f;
		background: var(--good);
		border: 1px solid transparent;
		border-radius: 7px;
		padding: 5px 12px;
		min-height: 30px;
		cursor: pointer;
		transform: skewX(-12deg);
	}
	.win-cut > span {
		display: inline-block;
		transform: skewX(12deg);
	}
	.win-cut:hover:not(:disabled) {
		filter: brightness(1.06);
	}
	.win-cut:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.rc-ctl {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.hsel {
		flex: 1 1 160px;
		max-width: 240px;
		min-width: 0;
		/* ≥16px so iOS never zooms the viewport on focus (design HARD CONSTRAINT). */
		font: inherit;
		font-size: 16px;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 7px 9px;
		min-height: 36px;
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
	}
	.hsel:focus-visible {
		outline: none;
		border-color: var(--gold-soft);
	}
	.hsel:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.mini.call {
		color: var(--gold);
		border-color: color-mix(in srgb, var(--gold) 34%, var(--line));
	}
	.mini.call:hover:not(:disabled) {
		border-color: var(--gold-soft);
		color: var(--gold);
	}
	.mini.active {
		color: var(--stream);
		border-color: color-mix(in srgb, var(--stream) 40%, var(--line));
		background: color-mix(in srgb, var(--stream) 10%, transparent);
	}
</style>
