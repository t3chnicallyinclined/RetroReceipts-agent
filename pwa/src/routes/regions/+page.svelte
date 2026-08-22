<script lang="ts">
	import { onMount } from 'svelte';
	import { regions, type Region, type RegionLevel, type RegionSort } from '$lib/stores/regions.svelte';
	import RegionRow from '$lib/components/RegionRow.svelte';
	import RegionModal from '$lib/components/RegionModal.svelte';

	onMount(() => {
		void regions.load();
	});

	// Cities vs Countries level + the server-backed sort. Switching either re-fetches (regions.load);
	// keep-last-good on a blip. No live channel — the board is a small plain-fetch snapshot by design.
	const LEVELS: { id: RegionLevel; label: string; icon: string }[] = [
		{ id: 'city', label: 'Cities', icon: '🏙️' },
		{ id: 'country', label: 'Countries', icon: '🌎' }
	];
	const SORTS: { id: RegionSort; label: string }[] = [
		{ id: 'wins', label: 'Wins' },
		{ id: 'players', label: 'Players' },
		{ id: 'winrate', label: 'Win %' }
	];
	const SORT_DESC: Record<RegionSort, string> = {
		wins: 'total wins',
		players: 'player count',
		winrate: 'win %'
	};

	const list = $derived(regions.regions);
	const level = $derived(regions.level);
	const sort = $derived(regions.sort);
	const cold = $derived(regions.loading && list.length === 0);

	const kind = $derived(level === 'city' ? 'cities' : 'countries');
	const place = $derived(level === 'city' ? 'city' : 'country');
	const mdesc = $derived(
		`Where the fighters rep — top ${kind} ranked by ${SORT_DESC[sort]}` +
			(sort === 'winrate' ? ` (under ${regions.minGames} games show “—”)` : '') +
			`. Play ${regions.minGames} games to put your ${place} on the map.`
	);

	let openRegion = $state<Region | null>(null); // region drill-in (players roster) modal
</script>

<svelte:head><title>Regions · MetaSync</title></svelte:head>

<!-- Masthead: title + ghost watermark + accent seam + description (matches /ranks) -->
<section class="mast" style="--acc:#34d39a">
	<div class="ghost" aria-hidden="true">REPRESENT</div>
	<div class="mrow">
		<h1 class="mtitle">REGIONS</h1>
		{#if regions.error && list.length}
			<span class="pill live" title={regions.error}>RECONNECTING…</span>
		{:else}
			<span class="pill good">LIVE</span>
		{/if}
	</div>
	<div class="seam" aria-hidden="true"></div>
	<p class="mdesc">{mdesc}</p>
</section>

<!-- ONE grouped control row (DESIGN-SYSTEM hard-rule #1): level switch · sort. Gold spent only on the
     level pill; sort is a subdued secondary refinement so it never reads as a second primary axis. -->
<div class="controls">
	<div class="scopes" role="tablist" aria-label="Region level">
		{#each LEVELS as lv (lv.id)}
			<button
				class="scope"
				class:on={lv.id === level}
				role="tab"
				aria-selected={lv.id === level}
				title={lv.label}
				onclick={() => regions.setLevel(lv.id)}
				><span class="sic" aria-hidden="true">{lv.icon}</span><span class="slbl">{lv.label}</span></button
			>
		{/each}
	</div>
	<div class="sorts" role="group" aria-label="Sort regions">
		<span class="rail">Sort</span>
		{#each SORTS as s (s.id)}
			<button class="srt" class:on={s.id === sort} aria-pressed={s.id === sort} onclick={() => regions.setSort(s.id)}
				>{s.label}</button
			>
		{/each}
	</div>
</div>

{#if cold}
	<div class="empty">LOADING…</div>
{:else if list.length === 0}
	<div class="empty">No {kind} on the board yet — win some matches to put your {place} up.</div>
{:else}
	<div class="board">
		<div class="bd-head">
			<span>{level === 'city' ? 'City' : 'Country'}</span>
			<span class="r">Record</span>
			<span class="r col-top">Top player</span>
		</div>
		<div class="bd-body">
			{#each list as rg, i (rg.name + '|' + (rg.region ?? '') + '|' + (rg.cc ?? ''))}
				<RegionRow region={rg} pos={i + 1} {level} onOpen={(r) => (openRegion = r)} />
			{/each}
		</div>
	</div>
{/if}

{#if openRegion}
	<RegionModal region={openRegion} {level} onClose={() => (openRegion = null)} />
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

	/* ONE grouped control row — mirrors /ranks. */
	.controls {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin: 4px 0 12px;
	}
	/* Level switch — the rounded segmented pill (gold-active), same control as the Ranks scope switch. */
	.scopes {
		display: inline-flex;
		align-items: center;
		flex: none;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--panel);
	}
	.scope {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 0;
		background: transparent;
		color: var(--dim);
		border-radius: 999px;
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.15s, background 0.15s;
	}
	.scope:hover {
		color: var(--ink);
	}
	.scope.on {
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		color: var(--gold-ink);
		font-style: italic;
	}
	.sic {
		font-size: 12.5px;
		line-height: 1;
	}
	/* Sort — subdued secondary refinement (no gold), same look as the Ranks period buttons. */
	.sorts {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.rail {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.srt {
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: transparent;
		color: var(--dim);
		font-size: 11px;
		font-weight: 700;
		white-space: nowrap;
		cursor: pointer;
		transition: color 0.15s, background 0.15s, border-color 0.15s;
	}
	.srt:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.srt.on {
		color: var(--ink);
		background: var(--panel);
		border-color: var(--gold-soft);
	}

	.board {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		margin-top: 10px;
	}
	.bd-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 0 14px;
		height: 32px;
		border-bottom: 1px solid var(--line);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.bd-head .r {
		text-align: right;
	}
	.bd-head .col-top {
		flex: 0 0 170px;
	}
	.bd-body {
		max-height: min(74vh, 900px);
		max-height: min(74dvh, 900px);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	@media (max-width: 560px) {
		.bd-head .col-top {
			display: none;
		}
	}
</style>
