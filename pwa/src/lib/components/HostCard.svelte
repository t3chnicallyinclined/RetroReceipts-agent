<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from './Avatar.svelte';
	import { timeAgo } from '$lib/format';
	import { hostStatus, type Host, type HostStatus } from '$lib/stores/hosts.svelte';

	// One node in the fleet map — a card carrying the host's identity, live status, lobby fill and a
	// real Steam Join link. Shares the arena vocabulary (panel/pill/tokens); the status drives both the
	// pill and the card's left accent edge so a node reads at a glance.
	let { host }: { host: Host } = $props();

	// MvC2 host lobbies are 1v1 → capacity 2. The payload carries a live member COUNT, not a capacity, so
	// the denominator comes from the node's reported player-slot count (defaults to 2 — the "1/2" convention).
	const CAP = $derived(host.players && host.players > 0 ? host.players : 2);

	const status = $derived(hostStatus(host));
	// `members` is the TRUE lobby occupancy INCLUDING the host (read_my_lobby pushes the owner — the host is
	// always a member), so render it directly. A "0/N while a host is present" reading is a reader-side bug
	// (the scan failing to detect the host's OWN lobby, e.g. the Proton heap-region-cap class), NOT a reason
	// to +1 here — that would double-count the host once the reader is fixed.
	const members = $derived(host.members ?? 0);
	// The host runs the cabinet as the referee (spectator) and occupies one seat, so what matters to a
	// challenger is the PLAYER seats: players = members − the host; seats = capacity − the host.
	const players = $derived(Math.max(0, members - 1));
	const playerSeats = $derived(Math.max(1, CAP - 1));
	// can a challenger put a quarter up here? — the cabinet is hosting with a free player seat, not mid-match.
	const canPlay = $derived((status === 'available' || status === 'standby') && players < playerSeats);
	const ago = $derived(timeAgo(host.last_seen_ms));

	// Per-node telemetry (all optional; a node with no report yet degrades to nothing shown).
	//   • ping chip hides on unknown (-1/absent); colour thresholds: <60 green, <150 amber, else red.
	const ping = $derived(host.steam_ping_ms);
	const showPing = $derived(ping != null && ping >= 0);
	const pingCls = $derived(ping == null ? '' : ping < 60 ? 'good' : ping < 150 ? 'warn' : 'bad');
	const hasTele = $derived(!!host.os || showPing || host.matches_hosted != null);
	// 17-digit steamid → deep-link the node's owner to their profile (mirrors PlayerTag).
	const is17 = $derived(/^\d{17}$/.test(host.steamid));

	// status → { label, pill-class, accent var } — one source for the pill + the accent edge + the dot.
	const META: Record<HostStatus, { label: string; cls: string; accent: string }> = {
		match: { label: 'Match live', cls: 'live', accent: 'var(--live)' },
		standby: { label: 'Challenger in', cls: 'gold', accent: 'var(--gold)' },
		available: { label: 'Open', cls: 'good', accent: 'var(--good)' },
		idle: { label: 'Starting', cls: 'idle', accent: 'var(--faint)' }
	};
	const meta = $derived(META[status]);

	// Cabinet RULES — the lobby config this node creates (what a player is actually joining). All optional;
	// the row hides entirely when a node hasn't reported any settings yet.
	const ftLabel = $derived(host.ft && host.ft > 0 ? `FT${host.ft}` : '');
	const oneBtn = $derived(host.one_button ?? null);
	const hasRules = $derived(!!host.game || !!ftLabel || !!host.version || oneBtn != null || !!host.lobby_code);
</script>

<article class="host" style="--acc:{meta.accent}">
	<div class="top">
		<Avatar url={host.avatar} size={34} alt={host.name} />
		<div class="id">
			{#if is17}
				<a class="nm" href="{base}/u/{host.steamid}" title="{host.name} — the cabinet operator (opens their profile)">{host.name}</a>
			{:else}
				<span class="nm" title={host.name}>{host.name}</span>
			{/if}
			<span class="role" title="The operator hosts this cabinet as the referee — they sit in the lobby spectating, not playing.">
				<span class="hd">HOST</span> · spectating{#if host.region} · {host.region}{/if}
			</span>
		</div>
		<span class="pill {meta.cls}">
			{#if status === 'match'}<span class="dot" aria-hidden="true"></span>{/if}
			{meta.label}
		</span>
	</div>

	<div class="meta">
		<span class="fill" title="Player seats — the host referees; {players} of {playerSeats} player seats filled">
			<b>{players}</b><i aria-hidden="true">/</i><span class="cap">{playerSeats}</span>
			<span class="lbl">player seats</span>
		</span>
		{#if ago}<span class="seen" title="Last heartbeat">{ago} ago</span>{/if}
	</div>

	{#if hasRules}
		<div class="rules">
			{#if host.game}<span class="r game" title="Game">{host.game}</span>{/if}
			{#if ftLabel}<span class="r ft" title="Victory Condition — first to {host.ft}">{ftLabel}</span>{/if}
			{#if host.version}<span class="r ver" title="Game version">{host.version}</span>{/if}
			{#if oneBtn != null}<span class="r ob" class:on={oneBtn} title="One-button special moves">1-btn {oneBtn ? 'ON' : 'off'}</span>{/if}
			{#if host.lobby_code}<span class="r code" title="Lobby code (manual join)">{host.lobby_code}</span>{/if}
		</div>
	{/if}

	{#if hasTele}
		<div class="tele">
			{#if host.os}<span class="t os" title="Host OS">{host.os}</span>{/if}
			{#if showPing}
				<span class="t ping {pingCls}" title="Steam relay ping">{host.steam_ping_ms}ms</span>
			{/if}
			{#if host.matches_hosted != null}
				<span class="t mh" title="Matches refereed by this node"><b>{host.matches_hosted}</b> matches</span>
			{/if}
		</div>
	{/if}

	{#if canPlay}
		<a class="join" href="{base}/match" title="Put a quarter up — start a money match on this cabinet">
			<span class="coin" aria-hidden="true">🪙</span><span>Put a quarter up</span>
		</a>
	{:else}
		<span class="join off" aria-hidden="true">
			{status === 'match' ? '⚔ Match in progress' : status === 'idle' ? 'Cabinet starting up…' : 'Cabinet full'}
		</span>
	{/if}
</article>

<style>
	.host {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-left: 4px solid var(--acc);
		border-radius: 14px;
		padding: 12px 14px;
		box-shadow: var(--shadow);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.id {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1 1 auto;
	}
	.nm {
		font-size: 14px;
		font-weight: 800;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	a.nm:hover {
		color: var(--gold);
	}
	.role {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 600;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.role .hd {
		flex: none;
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.08em;
		color: var(--gold-ink);
		background: var(--gold);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.pill {
		flex: none;
	}
	/* the .pill / .pill.good / .pill.live / .pill.gold base styles come from app.css; only the idle
	   variant (dim, no semantic accent) is defined here. */
	.pill.idle {
		color: var(--faint);
		background: color-mix(in srgb, var(--faint) 12%, transparent);
		border-color: color-mix(in srgb, var(--faint) 30%, var(--line));
	}
	.pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--live);
		flex: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.pill.live .dot {
			animation: hostpulse 1.6s ease-in-out infinite;
		}
	}
	@keyframes hostpulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}

	.meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding-top: 2px;
		border-top: 1px solid var(--line-soft);
	}
	.fill {
		display: inline-flex;
		align-items: baseline;
		gap: 3px;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
	.fill b {
		font-size: 16px;
		font-weight: 900;
	}
	.fill i {
		font-style: normal;
		color: var(--faint);
	}
	.fill .cap {
		font-size: 13px;
		font-weight: 700;
		color: var(--dim);
	}
	.fill .lbl {
		margin-left: 5px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.seen {
		font-size: 11px;
		color: var(--faint);
		white-space: nowrap;
	}

	/* compact per-node telemetry line — small, muted, reuses arena tokens (no new palette). */
	.tele {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 3px 12px;
		font-size: 11px;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.tele .t {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
		white-space: nowrap;
		min-width: 0;
	}
	.tele .os {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.tele .mh b {
		font-weight: 800;
		color: var(--ink);
	}
	.tele .ping {
		font-weight: 800;
	}
	.tele .ping.good {
		color: var(--good);
	}
	.tele .ping.warn {
		color: var(--gold);
	}
	.tele .ping.bad {
		color: var(--loss);
	}

	/* cabinet rules — the lobby config as small chips (distinct from the plain .tele telemetry line) */
	.rules {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.rules .r {
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.04em;
		padding: 3px 8px;
		border-radius: 999px;
		background: var(--panel-2);
		border: 1px solid var(--line);
		color: var(--dim);
		white-space: nowrap;
	}
	.rules .r.ft {
		color: var(--ink);
		border-color: color-mix(in srgb, var(--gold) 45%, var(--line));
	}
	.rules .r.code {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.12em;
	}
	/* one-button ON is the non-standard case for competitive play → flag it gold; OFF stays muted/normal */
	.rules .r.ob.on {
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-color: transparent;
	}

	.join {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		text-decoration: none;
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 8px 14px;
	}
	.join .coin {
		font-size: 12px;
	}
	.join:hover {
		filter: brightness(1.05);
	}
	.join:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--gold) 55%, transparent);
	}
	/* disabled affordance — kept visible so the row height stays stable across states */
	.join.off {
		color: var(--faint);
		background: var(--panel-2);
		border-color: var(--line);
		cursor: default;
	}
</style>
