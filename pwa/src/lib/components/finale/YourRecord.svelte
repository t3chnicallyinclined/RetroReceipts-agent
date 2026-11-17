<script lang="ts">
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import GetTheApp from '$lib/components/GetTheApp.svelte';
	import SeasonCard from './SeasonCard.svelte';
	import { nf } from '$lib/finale/derive';
	import { FIND_CAP, RECORD_LEAD_OUT, everyonePool, findMatches, wallNames } from '$lib/finale/unlisted';
	import type { Unlisted } from '$lib/finale/highlights';
	import type { Roster } from '$lib/finale/players';
	import type { Mine } from '$lib/finale/mine';

	// ONE section for "your record", whoever is looking:
	//   signed out   a lead, a "Find your name" filter over everyone who played, Sign in + Download the app
	//   signed in    their season card (on the roster, or "would have finished Nth overall" and not listed, or
	//                "No {label} games on your account.") -- SeasonCard owns those three
	// Below it, for every state, the wall of recorded players stays folded so the page does not grow for app users.
	// Plain anchors and text only: names are user text.
	let { u, roster, mine, mineLoaded, season, label, nextLabel }: { u?: Unlisted; roster: Roster | null; mine: Mine | null; mineLoaded: boolean; season: string; label: string; nextLabel?: string } = $props();
	let q = $state('');
	let showWall = $state(false);
	const wall = $derived(wallNames(u));
	const pool = $derived(everyonePool(roster));
	const found = $derived(findMatches(pool, q));
	const href = (id: string) => `${base}/u/${encodeURIComponent(id)}?season=${encodeURIComponent(season)}`;
</script>

{#if !auth.authed}
	<div class="card rec">
		<p>{RECORD_LEAD_OUT(u?.count, label)}</p>
		{#if pool.length}
			<div class="row finder">
				<label class="sr" for="find-record">Find your name</label>
				<input id="find-record" class="finput" type="search" placeholder="Find your name" autocomplete="off" bind:value={q} />
			</div>
			<p class="status" role="status" aria-live="polite">
				{#if q.trim().length >= 2}{found.total ? `${nf(found.total)} ${found.total === 1 ? 'name' : 'names'}${found.total > FIND_CAP ? `, showing the first ${FIND_CAP}. Keep typing to narrow it down.` : ''}` : 'No name matches that. Try fewer letters.'}{/if}
			</p>
			{#if found.shown.length}
				<ul class="names">{#each found.shown as p (p.steamid)}<li><a href={href(p.steamid)}>{p.name}</a></li>{/each}</ul>
			{/if}
		{/if}
		<GetTheApp signinNote="to see your record and vote" />
	</div>
{:else}
	<SeasonCard {mine} loading={!mineLoaded} loaded={mineLoaded} {season} {label} {nextLabel} />
{/if}

{#if wall.length}
	<div class="wallwrap">
		<button type="button" class="btn sm" aria-expanded={showWall} aria-controls="record-wall" onclick={() => (showWall = !showWall)}>{showWall ? 'Hide players with a record' : 'Show players with a record'}</button>
		{#if showWall}
			<div id="record-wall">
				<span class="rail">Some of the names on the ladder</span>
				<ul class="names wallnames">{#each wall as p (p.steamid)}<li><a href={href(p.steamid)}>{p.name}</a></li>{/each}</ul>
			</div>
		{/if}
	</div>
{/if}
