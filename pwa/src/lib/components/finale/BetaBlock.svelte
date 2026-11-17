<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import GetTheApp from '$lib/components/GetTheApp.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { seasonReg } from '$lib/stores/seasonreg.svelte';
	import { BLOCK_HEAD, BLOCK_LEAD, IN_LINE, JOIN_NOTE, NO_LEADERS, RESIGN_LINE, STEP_PLAY, earlyLeaders, joinState, liveNumbers } from '$lib/finale/beta';
	import { nf } from '$lib/finale/derive';
	import type { Player } from '$lib/types';

	// The page's second hero: the open season is live, here is how to take part. Three numbered steps with their own
	// state, live numbers (each hidden when absent or zero), and the early leaders. Plain text and links only.
	let { label, games, onBoard, leaders }: { label: string; games?: number; onBoard?: number; leaders: Player[] } = $props();
	const st = $derived(joinState({ authed: auth.authed, known: seasonReg.known, registered: seasonReg.registered, busy: seasonReg.busy, justJoined: seasonReg.justJoined, refusal: seasonReg.refusal }));
	const nums = $derived(liveNumbers({ joined: seasonReg.count, games, onBoard }));
	const top = $derived(earlyLeaders(leaders));
</script>

<div class="beta card" id="beta">
	<span class="rail">Open now</span>
	<h2 class="bh" id="beta-h" tabindex="-1">{BLOCK_HEAD(label)}</h2>
	<p class="bl">{BLOCK_LEAD}</p>
	{#if nums.length}
		<ul class="bn" aria-label="{label} so far">{#each nums as x (x.label)}<li><b>{nf(x.n)}</b> <span>{x.label}</span></li>{/each}</ul>
	{/if}
	<ol class="steps">
		<li>
			<span class="n" aria-hidden="true">1</span>
			<div><b>Get the app</b><GetTheApp showSignin={false} /></div>
		</li>
		<li>
			<span class="n" aria-hidden="true">2</span>
			<div>
				<b>Join {label}</b>
				{#if st === 'in'}
					<p class="ok" role="status">{IN_LINE}</p>
				{:else if st === 'signin'}
					<div class="cta"><button type="button" class="btn" onclick={() => auth.login()}>Sign in through Steam</button></div>
				{:else if st === 'resign'}
					<p class="dimp" role="status">{RESIGN_LINE}</p>
					<div class="cta"><button type="button" class="btn" onclick={() => auth.login()}>Sign in through Steam</button></div>
				{:else if st === 'join' || st === 'busy'}
					<div class="cta"><button type="button" class="btn pri" disabled={st === 'busy'} onclick={() => seasonReg.join()}>{st === 'busy' ? 'Joining…' : `Join ${label}`}</button></div>
				{/if}
				{#if seasonReg.message}<p class="dimp" role="status" aria-live="polite">{seasonReg.message}</p>{/if}
				<p class="dimp jn">{JOIN_NOTE}</p>
			</div>
		</li>
		<li>
			<span class="n" aria-hidden="true">3</span>
			<div><b>Play</b><p class="dimp" style="margin:2px 0 0">{STEP_PLAY}</p></div>
		</li>
	</ol>
	<div class="early">
		<span class="rail">Early leaders</span>
		{#if top.length}
			<ul class="el">
				{#each top as p, i (p.steamid)}
					<li><a href="{base}/u/{encodeURIComponent(p.steamid)}"><span class="pos">{i + 1}</span><Avatar url={p.avatar} size={28} alt="" /><span class="pn">{p.name}</span><span class="pr">{Math.round(p.rating)}</span></a></li>
				{/each}
			</ul>
			<a class="wlink" href="{base}/ranks">See the live ladder</a>
		{:else}
			<p class="dimp">{NO_LEADERS}</p>
			<a class="wlink" href="{base}/ranks">See the live ladder</a>
		{/if}
	</div>
</div>
