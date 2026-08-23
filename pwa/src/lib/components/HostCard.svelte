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
	const members = $derived(host.members ?? 0);
	// The host runs the game and sits in its OWN lobby as the referee/spectator, so a hosted cabinet is never
	// "0 in lobby" — the host occupies one seat. `members` is the joined-PLAYER count (excludes the host), so
	// the occupancy we show is host(1) + players, but only once it's actually hosting (idle = no lobby yet → 0).
	const inLobby = $derived(status === 'idle' ? members : Math.min(members + 1, CAP));
	const ago = $derived(timeAgo(host.last_seen_ms));

	// Per-node telemetry (all optional; a node with no report yet degrades to nothing shown).
	//   • ping chip hides on unknown (-1/absent); colour thresholds: <60 green, <150 amber, else red.
	const ping = $derived(host.steam_ping_ms);
	const showPing = $derived(ping != null && ping >= 0);
	const pingCls = $derived(ping == null ? '' : ping < 60 ? 'good' : ping < 150 ? 'warn' : 'bad');
	const hasTele = $derived(!!host.os || showPing || host.matches_hosted != null);
	// Only a real steam://joinlobby link is actionable; an empty/other join is not offered.
	const canJoin = $derived(!!host.join && host.join.startsWith('steam://joinlobby/'));
	// 17-digit steamid → deep-link the node's owner to their profile (mirrors PlayerTag).
	const is17 = $derived(/^\d{17}$/.test(host.steamid));

	// status → { label, pill-class, accent var } — one source for the pill + the accent edge + the dot.
	const META: Record<HostStatus, { label: string; cls: string; accent: string }> = {
		match: { label: 'In Match', cls: 'live', accent: 'var(--live)' },
		standby: { label: 'In Lobby', cls: 'gold', accent: 'var(--gold)' },
		available: { label: 'Available', cls: 'good', accent: 'var(--good)' },
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
				<a class="nm" href="{base}/u/{host.steamid}" title={host.name}>{host.name}</a>
			{:else}
				<span class="nm" title={host.name}>{host.name}</span>
			{/if}
			<span class="rg" title="Region">
				{#if host.region}{host.region}{:else}<i class="muted">Unknown region</i>{/if}
			</span>
		</div>
		<span class="pill {meta.cls}">
			{#if status === 'match'}<span class="dot" aria-hidden="true"></span>{/if}
			{meta.label}
		</span>
	</div>

	<div class="meta">
		<span class="fill" title="In this cabinet's lobby — the host referee + any players">
			<b>{inLobby}</b><i aria-hidden="true">/</i><span class="cap">{CAP}</span>
			<span class="lbl">in lobby</span>
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

	{#if canJoin}
		<a class="join" href={host.join} title="Join this lobby in-game (opens Steam)" aria-label="Join {host.name}">
			<span class="tri" aria-hidden="true">▶</span><span>Join</span>
		</a>
	{:else}
		<span class="join off" aria-hidden="true">
			<span class="tri">▶</span><span>{status === 'match' ? 'No open seat' : 'Not hosting'}</span>
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
	.rg {
		font-size: 11px;
		font-weight: 600;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rg .muted {
		color: var(--faint);
		font-style: italic;
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
	.join .tri {
		font-size: 8px;
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
	.join.off .tri {
		color: var(--faint);
	}
</style>
