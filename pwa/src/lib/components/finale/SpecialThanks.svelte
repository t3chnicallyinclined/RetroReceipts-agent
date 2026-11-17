<script lang="ts">
	import { base } from '$app/paths';
	import { tick } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { filterNames, findMe, windowNames, type Roster } from '$lib/finale/players';
	import { nf } from '$lib/finale/derive';
	import { rosterAware, testers } from '$lib/finale/unlisted';

	// Credits, not a ranking: the regulars as a wall of name plates (days is the only figure), then every name as a
	// plain list so nobody is forgotten. Plain anchors only (no per-row components), so 566+ links stay cheap.
	let { roster, season, label }: { roster: Roster; season: string; label: string } = $props();
	let query = $state('');
	let expanded = $state(false);
	let status = $state('');
	const filtering = $derived(query.trim().length > 0);
	const matches = $derived(filterNames(roster.everyone, query));
	const win = $derived(windowNames(matches, expanded, filtering));
	const href = (id: string) => `${base}/u/${encodeURIComponent(id)}?season=${encodeURIComponent(season)}`;
	const meIdx = $derived(findMe(roster.everyone, auth.steamid));
	// a roster-aware server flags who is on the roster: "The testers" are those players, then everyone recorded
	const aware = $derived(rosterAware(roster));
	const tester = $derived(testers(roster));
	const regById = $derived(new Map(roster.regulars.map((r) => [r.player.steamid, r])));

	async function findMine() {
		if (meIdx < 0) {
			status = auth.authed ? `We could not find your name in ${label}.` : 'Sign in to find your name.';
			return;
		}
		query = '';
		expanded = true;
		await tick();
		const el = document.getElementById('thanks-me');
		el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
		el?.focus({ preventScroll: true });
		status = 'Found you. Thank you for playing.';
	}
</script>

<p class="ssub">Shout-out to everyone who helped shape the beta. Thank you for playing, for the feedback, and for putting up with a project that is still in testing.</p>

{#if aware && tester.length}
	<h3 class="rail subh">The testers</h3>
	<p class="dimp" style="margin:0 2px 10px">{nf(tester.length)} {tester.length === 1 ? 'player' : 'players'} ran the app in {label}. Thank you for being the first people on it.</p>
	<ul class="wall">
		{#each tester as t (t.steamid)}
			{@const reg = regById.get(t.steamid)}
			<li>
				<a class="plate" href={href(t.steamid)}>
					<Avatar url={reg?.player.avatar} size={36} alt="" />
					<span class="pn"><span class="pt" title={t.name}>{t.name}</span>{#if reg}<span class="pd">{nf(reg.days)} days</span>{/if}</span>
				</a>
			</li>
		{/each}
	</ul>
{:else if roster.regulars.length}
	<h3 class="rail subh">The regulars</h3>
	<p class="dimp" style="margin:0 2px 10px">{nf(roster.regulars.length)} players showed up on {roster.regularDays} or more days of {label}.</p>
	<ul class="wall">
		{#each roster.regulars as r (r.player.steamid)}
			<li>
				<a class="plate" href={href(r.player.steamid)}>
					<Avatar url={r.player.avatar} size={36} alt="" />
					<span class="pn"><span class="pt" title={r.player.name}>{r.player.name}</span><span class="pd">{nf(r.days)} days</span></span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if roster.everyone.length}
	<h3 class="rail subh" id="everyone-h">{aware ? 'Everyone who showed up on the ladder' : `Everyone who played ${label}`}</h3>
	<p class="dimp" style="margin:0 2px 10px">{nf(roster.everyone.length)} players, so nobody is forgotten.</p>
	<div class="row finder">
		<label class="sr" for="find-name">Find your name</label>
		<input id="find-name" class="finput" type="search" placeholder="Find your name" autocomplete="off" bind:value={query} />
		<button type="button" class="btn sm" onclick={findMine}>Find me</button>
	</div>
	<p class="status" role="status" aria-live="polite">{status || (filtering ? `${nf(matches.length)} of ${nf(roster.everyone.length)} names` : '')}</p>
	{#if matches.length}
		<ul class="names" aria-labelledby="everyone-h">
			{#each win.shown as p (p.steamid)}
				<li><a class:me={p.steamid === auth.steamid} id={p.steamid === auth.steamid ? 'thanks-me' : undefined} href={href(p.steamid)}>{p.name}</a></li>
			{/each}
		</ul>
		{#if win.hidden > 0}
			<div class="cta" style="margin-top:10px"><button type="button" class="btn" onclick={() => (expanded = true)}>Show all {nf(roster.everyone.length)} players</button></div>
		{/if}
	{:else}
		<div class="empty">No name matches that. Try fewer letters.</div>
	{/if}
{/if}
