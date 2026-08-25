<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { tournaments } from '$lib/stores/tournaments.svelte';
	import TournamentCard from '$lib/components/TournamentCard.svelte';
	import Masthead from '$lib/components/Masthead.svelte';

	// ── live wiring: initial fetch + subscribe to the "tourney_index" SSE channel; pause on hide ──
	onMount(() => {
		void tournaments.load();
		tournaments.connect();
		const onVis = () => {
			if (document.hidden) {
				tournaments.disconnect(); // stop the stream while backgrounded (CPU discipline)
			} else {
				tournaments.connect();
				void tournaments.load(); // catch anything missed while hidden
			}
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			tournaments.disconnect();
		};
	});

	const list = $derived(tournaments.list);
	const cold = $derived(tournaments.loading && list.length === 0);
</script>

<svelte:head><title>Tournaments · Retro Receipts</title></svelte:head>

<!-- Masthead: title + ghost watermark + accent seam + description (matches /ranks · /regions) -->
<Masthead
	title="TOURNAMENTS"
	ghost="BRACKETS"
	accent="#8b6dff"
	desc="Brackets that run themselves — browse open events and follow the action live from your phone."
>
	{#snippet pills()}
		{#if tournaments.error && list.length}
			<span class="pill live" title={tournaments.error}>RECONNECTING…</span>
		{:else}
			<span class="pill good">LIVE</span>
		{/if}
		{#if auth.authed}
			<a class="mkbtn" href="{base}/tournament/create">＋ Create</a>
		{/if}
	{/snippet}
</Masthead>

{#if cold}
	<div class="empty">LOADING…</div>
{:else if list.length === 0}
	<div class="empty">No tournaments yet — check back when an organizer opens one up.</div>
{:else}
	<div class="grid">
		{#each list as t (t.id)}
			<TournamentCard {t} />
		{/each}
	</div>
{/if}

<style>
	/* TO create affordance — a small gold Cut in the page masthead (no second bar; hard-rule #1) */
	.mkbtn {
		margin-left: auto;
		font-size: 11.5px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-radius: 8px;
		padding: 6px 12px;
		text-decoration: none;
		transform: skewX(-8deg);
	}
	.mkbtn:hover {
		filter: brightness(1.05);
	}
	.grid {
		display: grid;
		/* minmax(min(100%, 280px), 1fr): a single column below ~280px (never overflows the phone),
		   auto-filling wider tracks on tablet/desktop. */
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
		gap: 12px;
		margin-top: 10px;
	}
</style>
