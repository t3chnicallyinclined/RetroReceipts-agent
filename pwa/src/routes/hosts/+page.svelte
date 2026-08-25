<script lang="ts">
	import { onMount } from 'svelte';
	import { hosts, hostStatus } from '$lib/stores/hosts.svelte';
	import HostCard from '$lib/components/HostCard.svelte';
	import ArcadeMap from '$lib/components/ArcadeMap.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import Masthead from '$lib/components/Masthead.svelte';

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

<svelte:head><title>Arcades · Retro Receipts</title></svelte:head>

<!-- Masthead: title + ghost watermark + accent seam + description (matches /ranks · /regions · /match) -->
<Masthead
	title="ARCADES"
	accent="var(--p2)"
	desc="The live arcade network — where the host cabinets are. Money matches & tournaments run on these; the map shows the hosting footprint."
>
	{#snippet pills()}
		{#if hosts.error && list.length}
			<span class="pill live" title={hosts.error}>RECONNECTING…</span>
		{:else}
			<span class="pill good">LIVE</span>
		{/if}
	{/snippet}
</Masthead>

<ArcadeMap />

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
