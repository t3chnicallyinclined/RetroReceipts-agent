<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { seasonReg } from '$lib/stores/seasonreg.svelte';
	import { IN_LINE, RESIGN_LINE, joinState, stripLine } from '$lib/finale/beta';

	// The slim strip under the hero: "{label} is live · {n} joined" with Join / "You're in ✓", and the words link to the
	// full block. One line on a phone. Not gold: gold stays for the champion. Joining is the same call as the block's.
	let { label, onjump }: { label: string; onjump: (id: string) => void } = $props();
	const st = $derived(joinState({ authed: auth.authed, known: seasonReg.known, registered: seasonReg.registered, busy: seasonReg.busy, justJoined: seasonReg.justJoined, refusal: seasonReg.refusal }));
</script>

<div class="bstrip" role="group" aria-label="{label} is open">
	<span class="dot" aria-hidden="true"></span>
	<a class="txt" href="#beta" onclick={(e) => { e.preventDefault(); onjump('beta'); }}>{stripLine(label, seasonReg.count)}</a>
	{#if st === 'in'}
		<span class="in" role="status">{IN_LINE}</span>
	{:else if st === 'join' || st === 'busy'}
		<button type="button" class="bj" disabled={st === 'busy'} onclick={() => seasonReg.join()}>{st === 'busy' ? 'Joining…' : 'Join'}</button>
	{:else if st === 'signin' || st === 'resign'}
		<button type="button" class="bj" onclick={() => auth.login()} title={st === 'resign' ? RESIGN_LINE : undefined}>{st === 'resign' ? 'Sign in again' : 'Join'}</button>
	{/if}
</div>
