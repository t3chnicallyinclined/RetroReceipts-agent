<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { seasonReg } from '$lib/stores/seasonreg.svelte';
	import { joinStripState, RESIGN_COPY } from '$lib/launch';

	// The register strip above the board for the CURRENT open season: signed out -> sign in; signed in and not
	// registered -> one-tap "Join {label}", which turns into a quiet confirmation. Registration is a flag only.
	let { label, current }: { label: string; current: boolean } = $props();
	onMount(() => void seasonReg.load(auth.steamid));
	// re-read when the sign-in changes (sign in or out while the page is open)
	let seen = $state<string | null | undefined>(undefined);
	$effect(() => {
		const sid = auth.steamid;
		if (seen === undefined) {
			seen = sid;
			return;
		}
		if (seen !== sid) {
			seen = sid;
			seasonReg.reset();
			void seasonReg.load(sid);
		}
	});
	const st = $derived(
		joinStripState({ current, authed: auth.authed, known: seasonReg.known, registered: seasonReg.registered, busy: seasonReg.busy, justJoined: seasonReg.justJoined, refusal: seasonReg.refusal })
	);
</script>

{#if st !== 'hidden'}
	<div class="js" class:done={st === 'done'} role="group" aria-label="Season registration">
		{#if st === 'done'}
			<p role="status" aria-live="polite">You’re registered for {label}.</p>
		{:else if st === 'signin'}
			<p>Sign in to register for {label}.</p>
			<button type="button" onclick={() => auth.login()}>Sign in through Steam</button>
		{:else if st === 'resign'}
			<p role="status" aria-live="polite">{RESIGN_COPY}</p>
			<button type="button" onclick={() => auth.login()}>Sign in through Steam</button>
		{:else}
			<p>{label} is open. Register to take part.</p>
			<button type="button" class="pri" disabled={st === 'busy'} onclick={() => seasonReg.join()}>{st === 'busy' ? 'Joining…' : `Join ${label}`}</button>
		{/if}
		{#if seasonReg.message}<p class="err" role="status" aria-live="polite">{seasonReg.message}</p>{/if}
	</div>
{/if}

<style>
	.js {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 12px;
		margin: 0 0 12px;
		padding: 9px 12px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
		font-size: 12.5px;
		color: var(--ink);
	}
	.js.done {
		color: var(--dim);
		border-style: dashed;
	}
	p {
		margin: 0;
		flex: 1 1 200px;
		min-width: 0;
	}
	.err {
		flex-basis: 100%;
		color: var(--dim);
	}
	button {
		font: inherit;
		font-weight: 800;
		font-size: 12px;
		min-height: 40px;
		padding: 0 16px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
		cursor: pointer;
	}
	button.pri {
		background: var(--ink);
		color: var(--bg);
		border-color: var(--ink);
	}
	button:disabled {
		opacity: 0.6;
	}
	button:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
</style>
