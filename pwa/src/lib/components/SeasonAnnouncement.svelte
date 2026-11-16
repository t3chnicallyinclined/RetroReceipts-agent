<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { seasons } from '$lib/stores/seasons.svelte';
	import { seasonReg } from '$lib/stores/seasonreg.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { announcementFor, readDismissed, writeDismissed, RESIGN_COPY } from '$lib/launch';

	// "Season closed, new season open": derived from the seasons table, so it reaches visitors who arrive cold
	// (the broadcast banner only reaches people who are connected when it is sent). Shown for 21 days after a season
	// ends; dismissal is remembered per ended season. No card on an old server or with only one season.
	// Registration is a flag: this card says nothing about how games are treated.
	let dismissed = $state<Set<string>>(new Set());
	let now = $state(Date.now());
	onMount(() => {
		dismissed = readDismissed();
		now = Date.now();
		void seasons.load();
	});
	const a = $derived(announcementFor(seasons.table, now, dismissed));
	// a server banner may already be on screen: keep this card to a single quiet row so they do not stack heavily
	const compact = $derived(announce.items.length > 0);

	// registration status for the open season (only read while the card is up)
	let readFor = '';
	$effect(() => {
		const open = a?.open.id;
		const who = auth.steamid ?? '';
		if (!open || readFor === `${open}|${who}`) return;
		readFor = `${open}|${who}`;
		seasonReg.reset();
		void seasonReg.load(auth.steamid);
	});

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
			{#if !seasonReg.registered || seasonReg.justJoined}
				<p class="l2">
					{#if seasonReg.justJoined}You’re registered for {a.open.label}.
					{:else if !auth.authed}<b>{a.open.label}</b> is open: sign in and register. <button type="button" class="act" onclick={() => auth.login()}>Sign in through Steam</button>
					{:else if seasonReg.refusal === 'signin'}{RESIGN_COPY} <button type="button" class="act" onclick={() => auth.login()}>Sign in through Steam</button>
					{:else if seasonReg.known}<b>{a.open.label}</b> is open: register to take part. <button type="button" class="act" disabled={seasonReg.busy} onclick={() => seasonReg.join()}>{seasonReg.busy ? 'Joining…' : `Join ${a.open.label}`}</button>
					{/if}
				</p>
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
	}
	.l2 b {
		color: var(--ink);
	}
	.act {
		font: inherit;
		font-weight: 800;
		font-size: 12px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 999px;
		min-height: 36px;
		padding: 0 14px;
		margin-left: 4px;
		cursor: pointer;
	}
	.act:disabled {
		opacity: 0.6;
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
