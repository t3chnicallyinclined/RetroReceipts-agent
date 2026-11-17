<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { seasons } from '$lib/stores/seasons.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import { agent } from '$lib/stores/agent.svelte';
	import GetTheApp from '$lib/components/GetTheApp.svelte';
	import { announcementFor, announcementHiddenOn, readDismissed, writeDismissed } from '$lib/launch';

	// "Season closed, new season open": derived from the seasons table, so it reaches visitors who arrive cold
	// (the broadcast banner only reaches people who are connected when it is sent). Shown for 21 days after a season
	// ends; dismissal is remembered per ended season. No card on an old server or with only one season.
	// No registration step: the call to action is to get the app and play.
	let dismissed = $state<Set<string>>(new Set());
	let now = $state(Date.now());
	onMount(() => {
		dismissed = readDismissed();
		now = Date.now();
		void seasons.load();
	});
	const a = $derived(announcementHiddenOn(page.url.pathname, base) ? null : announcementFor(seasons.table, now, dismissed));
	// a server banner may already be on screen: keep this card to a single quiet row so they do not stack heavily
	const compact = $derived(announce.items.length > 0);

	function close() {
		if (!a) return;
		const next = new Set(dismissed);
		next.add(a.ended.id);
		dismissed = next;
		writeDismissed(next);
	}
</script>

{#if a}
	<section class="sa" class:compact aria-label="Season announcement">
		<div class="body">
			<p class="l1"><b>{a.ended.label}</b> is closed. <a href="{base}/season/{encodeURIComponent(a.ended.id)}">See the final standings and the season in numbers.</a></p>
			{#if !agent.reporting}
				<div class="l2"><p><a class="ol" href="{base}/season/{encodeURIComponent(a.ended.id)}#next"><b>{a.open.label}</b> is open.</a> Download the app and just play.</p><GetTheApp small showSignin={false} /></div>
			{/if}
		</div>
		<button type="button" class="x" aria-label="Dismiss the season announcement" onclick={close}>✕</button>
	</section>
{/if}

<style>
	.sa {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin: 6px 0 2px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
		font-size: 12.5px;
		color: var(--ink);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 4px;
	}
	.sa p {
		margin: 0;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.sa a {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.l2 {
		color: var(--dim);
		display: grid;
		gap: 6px;
	}
	.l2 b {
		color: var(--ink);
	}
	.x {
		flex: none;
		font: inherit;
		font-size: 14px;
		line-height: 1;
		width: 32px;
		height: 32px;
		color: var(--faint);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 8px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ink);
	}
	.sa :focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
	/* with a server banner already up: one tight row, no second line of actions on phones */
	.compact {
		padding: 7px 10px;
	}
	@media (max-width: 720px) {
		.compact .l2 {
			display: none;
		}
	}
</style>
