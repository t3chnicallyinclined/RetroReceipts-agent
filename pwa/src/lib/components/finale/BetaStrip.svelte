<script lang="ts">
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { seasonReg } from '$lib/stores/seasonreg.svelte';
	import GetTheApp from '$lib/components/GetTheApp.svelte';
	import { BLOCK_HEAD, RESIGN_LINE, STRIP_SUB, ctaFor, joinState, joinedLine } from '$lib/finale/beta';

	// The call to action under the hero: the open season is live TODAY. A bold block (not gold: gold stays for the
	// champion) with one BIG primary button and "Get the app" next to it. The headline links to the full block below.
	let { label, onjump }: { label: string; onjump: (id: string) => void } = $props();
	const st = $derived(joinState({ authed: auth.authed, known: seasonReg.known, registered: seasonReg.registered, busy: seasonReg.busy, justJoined: seasonReg.justJoined, refusal: seasonReg.refusal }));
	const cta = $derived(ctaFor(st, label));
	const joined = $derived(joinedLine(seasonReg.count));
	function press() {
		if (cta.act === 'signin') auth.login();
		else if (cta.act === 'join') void seasonReg.join();
	}
</script>

<section class="bstrip" aria-label="{label} is open">
	<div class="bs-txt">
		<a class="bs-h" href="#beta" onclick={(e) => { e.preventDefault(); onjump('beta'); }}>{BLOCK_HEAD(label)}</a>
		<span class="bs-sub">{STRIP_SUB}</span>
		{#if joined}<span class="bs-n">{joined}</span>{/if}
	</div>
	<div class="bs-act">
		{#if cta.act === 'ladder'}
			<a class="bigjoin" href="{base}/ranks">{cta.label}</a>
		{:else}
			<button type="button" class="bigjoin" disabled={cta.disabled} onclick={press}>{cta.label}</button>
		{/if}
		<GetTheApp showSignin={false} secondary label="Get the app" />
		{#if st === 'resign'}<p class="bs-note" role="status">{RESIGN_LINE}</p>{/if}
	</div>
</section>
