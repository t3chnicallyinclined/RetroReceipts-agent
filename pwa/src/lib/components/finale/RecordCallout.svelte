<script lang="ts">
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import GetTheApp from '$lib/components/GetTheApp.svelte';
	import { FIND_CAP, RECORD_LEAD, findMatches, unlistedPool, wallNames } from '$lib/finale/unlisted';
	import { nf } from '$lib/finale/derive';
	import type { Unlisted } from '$lib/finale/highlights';
	import type { Roster } from '$lib/finale/players';
	import type { Mine } from '$lib/finale/mine';

	// "You might have a record here": a warm invitation to the recorded players. A wall of names (the most active and
	// the top unlisted), a find-your-name filter over everyone recorded but not on the app, and the Steam sign-in.
	// Plain anchors and text only: names are user text.
	let { u, roster, season, label, nextLabel, mine }: { u: Unlisted; roster: Roster | null; season: string; label: string; nextLabel?: string; mine: Mine | null } = $props();
	let q = $state('');
	const wall = $derived(wallNames(u));
	const pool = $derived(unlistedPool(roster));
	const found = $derived(findMatches(pool, q));
	const href = (id: string) => `${base}/u/${encodeURIComponent(id)}?season=${encodeURIComponent(season)}`;
	const unlistedViewer = $derived(auth.authed && mine?.found && mine.onRoster === false);
</script>

<div class="card rec">
	<p>{RECORD_LEAD(u.count, label, nextLabel)}</p>
	{#if unlistedViewer}
		<p class="status" role="status"><b>You have a {label} record.</b> <a class="plain" href="#you">See it in Your season</a>.</p>
	{:else}
		<GetTheApp />
	{/if}
	{#if wall.length}
		<span class="rail">Some of the names on the ladder</span>
		<ul class="names wallnames">{#each wall as p (p.steamid)}<li><a href={href(p.steamid)}>{p.name}</a></li>{/each}</ul>
	{/if}
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
</div>
