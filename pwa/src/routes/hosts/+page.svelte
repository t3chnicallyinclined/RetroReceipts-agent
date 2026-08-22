<script lang="ts">
	import { onMount } from 'svelte';
	import { hosts, hostStatus } from '$lib/stores/hosts.svelte';
	import HostCard from '$lib/components/HostCard.svelte';
	import StatTile from '$lib/components/StatTile.svelte';

	// Live FLEET map — the pool of online MvC2 host nodes. onMount starts the 6s poll and pauses it
	// while the tab is hidden (CPU discipline — mirrors /match + /ranks). The arcade/hosts endpoint
	// isn't on the SSE bus, so this polls (the list is already server-filtered to a 45s liveness window).
	onMount(() => {
		hosts.start();
		const onVis = () => (document.hidden ? hosts.stop() : hosts.start());
		document.addEventListener('visibilitychange', onVis);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			hosts.stop();
		};
	});

	const list = $derived(hosts.hosts);
	const cold = $derived(hosts.loading && list.length === 0);
	const online = $derived(list.length);
	const available = $derived(list.filter((h) => hostStatus(h) === 'available').length);
	const inMatch = $derived(list.filter((h) => hostStatus(h) === 'match').length);
</script>

<svelte:head><title>Fleet · MetaSync</title></svelte:head>

<!-- Masthead: title + ghost watermark + accent seam + description (matches /ranks · /regions · /match) -->
<section class="mast" style="--acc:var(--p2)">
	<div class="ghost" aria-hidden="true">FLEET</div>
	<div class="mrow">
		<h1 class="mtitle">FLEET</h1>
		{#if hosts.error && list.length}
			<span class="pill live" title={hosts.error}>RECONNECTING…</span>
		{:else}
			<span class="pill good">LIVE</span>
		{/if}
	</div>
	<div class="seam" aria-hidden="true"></div>
	<p class="mdesc">The live host pool — every online node ready to run a match. Jump straight into an open lobby, or watch one that's already fighting.</p>
</section>

<div class="stats">
	<StatTile label="Nodes online" value={online} accent="var(--p2)" />
	<StatTile label="Available" value={available} accent="var(--good)" />
	<StatTile label="In match" value={inMatch} accent="var(--live)" />
</div>

{#if cold}
	<div class="empty">LOADING…</div>
{:else if list.length === 0}
	<div class="empty">No host nodes online — the fleet is quiet right now.</div>
{:else}
	<div class="fleet">
		{#each list as h (h.steamid + '|' + (h.lobby_id ?? ''))}
			<HostCard host={h} />
		{/each}
	</div>
{/if}

<style>
	.mast {
		position: relative;
		overflow: hidden;
		padding: 14px 4px 10px;
		margin-bottom: 4px;
	}
	.ghost {
		position: absolute;
		right: 0;
		top: -6px;
		font-size: clamp(46px, 12vw, 96px);
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

	/* header stat row — 3 tiles that reflow to fit any width */
	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		margin: 10px 0 14px;
	}

	/* the fleet map — responsive card grid; collapses to one column on phones */
	.fleet {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
		gap: 12px;
	}
	@media (max-width: 420px) {
		.fleet {
			grid-template-columns: 1fr;
		}
	}
</style>
