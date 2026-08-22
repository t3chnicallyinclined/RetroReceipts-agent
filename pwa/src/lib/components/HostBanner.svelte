<script lang="ts">
	import { onMount } from 'svelte';
	import { hosts, hostStatus } from '$lib/stores/hosts.svelte';
	import { timeAgo } from '$lib/format';

	// 🎛 Cabinet-status banner — "what this host node is doing right now", MODE-AWARE (money / tournament /
	// idle). Rendered on the host's OWN /match (self=true → operator view + don't-play reminder) and on a
	// host's /u profile (self=false → viewer/TO view: trust signals + a watch link). Reads the shared fleet
	// poll; renders NOTHING when this steamid isn't an online host. The who-vs-who enriches the moment the
	// server ships wager/tourney on the host row — until then it falls back to the lobby status.
	let { steamid, self = false }: { steamid: string; self?: boolean } = $props();

	onMount(() => {
		hosts.start();
		const onVis = () => (document.hidden ? hosts.stop() : hosts.start());
		document.addEventListener('visibilitychange', onVis);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			hosts.stop();
		};
	});

	const host = $derived(hosts.byId(steamid));
	const status = $derived(host ? hostStatus(host) : null);
	const w = $derived(host?.wager ?? null); // money assignment
	const t = $derived(host?.tourney ?? null); // tournament assignment

	// Accent edge: money = gold, tournament = stream, else the lobby-status colour.
	const STATUS_ACCENT: Record<string, string> = {
		match: 'var(--live)',
		standby: 'var(--gold)',
		available: 'var(--good)',
		idle: 'var(--faint)'
	};
	const accent = $derived(w ? 'var(--gold)' : t ? 'var(--stream)' : STATUS_ACCENT[status ?? 'idle']);

	const ping = $derived(host?.steam_ping_ms);
	const showPing = $derived(ping != null && ping >= 0);
	const pingCls = $derived(ping == null ? '' : ping < 60 ? 'good' : ping < 150 ? 'warn' : 'bad');
	const ftLabel = $derived(host?.ft && host.ft > 0 ? `FT${host.ft}` : '');
	const canJoin = $derived(!!host?.join && host.join.startsWith('steam://joinlobby/'));
	const ago = $derived(host ? timeAgo(host.last_seen_ms) : '');
</script>

{#if host}
	<section class="cab" style="--acc:{accent}">
		<div class="hd">
			<span class="tag">🎛 {self ? 'Your cabinet' : `${host.name}'s cabinet`}</span>
			{#if status === 'match'}
				<span class="pill live"><span class="dot" aria-hidden="true"></span>In match</span>
			{:else if w || t}
				<span class="pill gold">Assigned</span>
			{:else if status === 'available'}
				<span class="pill good">Open</span>
			{:else}
				<span class="pill idle">{status === 'idle' ? 'Starting' : 'In lobby'}</span>
			{/if}
		</div>

		<p class="act">
			{#if w}
				{#if w.status === 'locked'}
					Refereeing <b>{w.challenger?.name ?? 'a player'}</b> vs <b>{w.acceptor?.name ?? 'a player'}</b> —
					🪙 {w.pot ?? (w.stake ?? 0) * 2} · FT{w.ft ?? 3}{#if w.cw != null && w.aw != null}
						· {w.cw}–{w.aw}{/if}
				{:else}
					Open money match — 🪙 {w.stake ?? 0} · FT{w.ft ?? 3}, waiting for a taker{#if w.challenger?.name}
						({w.challenger.name} put it up){/if}
				{/if}
			{:else if t}
				🏆 <b>{t.name ?? 'Tournament'}</b> — <b>{t.A?.name ?? 'TBD'}</b> vs <b>{t.B?.name ?? 'TBD'}</b>{#if t.round}
					· {t.round}{/if}
			{:else if status === 'match'}
				🔴 A match is live on this cabinet.
			{:else if status === 'available'}
				Open & ready — waiting for a match{#if !self} · put a quarter up to play here{/if}.
			{:else if status === 'standby'}
				Lobby open — warming up.
			{:else}
				Cabinet starting up…
			{/if}
		</p>

		{#if self}
			<!-- operator contribution — how much this cabinet has done + earned (money_hosted/earned fill in
			     once the server surfaces them; matches_hosted is live today). -->
			<div class="stats">
				<span class="st"><b>{host.matches_hosted ?? 0}</b> hosted</span>
				{#if host.money_hosted != null}<span class="st">🪙 <b>{host.money_hosted}</b> money matches</span>{/if}
				{#if host.earned != null}<span class="st">🪙 <b>{host.earned}</b> earned</span>{/if}
			</div>
		{/if}

		<div class="chips">
			{#if host.region}<span class="c">{host.region}</span>{/if}
			{#if showPing}<span class="c ping {pingCls}">{ping}ms</span>{/if}
			{#if ftLabel}<span class="c">{ftLabel}</span>{/if}
			{#if !self && host.matches_hosted != null}<span class="c"><b>{host.matches_hosted}</b> refereed</span>{/if}
			{#if ago}<span class="c dim">{ago} ago</span>{/if}
		</div>

		{#if self}
			<p class="warn">⚠ Don't play on this machine while it's hosting — one Steam account can't host and play at once.</p>
		{:else if canJoin}
			<a class="watch" href={host.join} title="Open this cabinet's lobby in Steam">
				{status === 'match' ? '▶ Watch' : '▶ Join'}
			</a>
		{/if}
	</section>
{/if}

<style>
	.cab {
		margin: 0 0 12px;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-left: 4px solid var(--acc);
		border-radius: 12px;
		background: linear-gradient(120deg, color-mix(in srgb, var(--acc) 12%, transparent), transparent 70%), var(--panel);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.tag {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--ink);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pill {
		flex: none;
	}
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
			animation: cabpulse 1.6s ease-in-out infinite;
		}
	}
	@keyframes cabpulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}
	.act {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.45;
		color: var(--ink);
	}
	.act b {
		font-weight: 800;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: 11px;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.chips .c {
		white-space: nowrap;
	}
	.chips .c.dim {
		color: var(--faint);
	}
	.chips .c b {
		font-weight: 800;
		color: var(--ink);
	}
	.chips .ping {
		font-weight: 800;
	}
	.chips .ping.good {
		color: var(--good);
	}
	.chips .ping.warn {
		color: var(--gold);
	}
	.chips .ping.bad {
		color: var(--loss);
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		font-size: 12px;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.stats .st b {
		font-size: 15px;
		font-weight: 900;
		color: var(--ink);
		margin-right: 3px;
	}
	.warn {
		margin: 0;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--gold);
	}
	.watch {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		text-decoration: none;
		font-size: 12px;
		font-weight: 800;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 7px 14px;
	}
	.watch:hover {
		filter: brightness(1.05);
	}
</style>
