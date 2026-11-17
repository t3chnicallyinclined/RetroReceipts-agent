<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { seasons } from '$lib/stores/seasons.svelte';
	import { seasonLandingPath } from '$lib/finale/beta';

	// /season (no id): a short link for posts. It lands on the latest FINISHED season's finale, which is also the open
	// season's landing page, and keeps the hash: nobd.net/app/season#next scrolls to the open season's block. With no
	// finished season (or an old server) it says so and points at the ladder. An unknown id is /season/<id>'s own
	// not-available state, untouched.
	let state = $state<'loading' | 'none'>('loading');
	onMount(() => {
		void seasons.load().finally(() => {
			const to = seasonLandingPath(base, seasons.table, Date.now(), location.hash);
			if (to) void goto(to, { replaceState: true });
			else state = 'none';
		});
	});
</script>

<svelte:head><title>Seasons · Retro Receipts</title></svelte:head>

{#if state === 'loading'}
	<p class="note">Finding the season…</p>
{:else}
	<p class="note">There is no finished season to show yet. <a href="{base}/ranks">See the current ladder</a>.</p>
{/if}

<style>
	.note {
		margin: 40px 16px;
		color: var(--dim);
		text-align: center;
	}
	.note a {
		color: var(--ink);
	}
</style>
