<script lang="ts">
	import { tick } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { optionPct, pollStatus, submitVote, type FeedbackView, type Poll, type VoteRefusal } from '$lib/finale/feedback';

	// One poll: a native radio group (arrow keys and Space work). Choosing an option votes at once. Results show
	// after a vote, on "Show results", or when voting has closed. One vote per signed-in account; focus returns to
	// the chosen radio after a vote.
	let { poll, open, season, hint, current = true, blocked, onview, onpoll }: { poll: Poll; open: boolean; season: string; hint?: string; current?: boolean; blocked?: string; onview: (v: FeedbackView) => void; onpoll: (p: Poll) => void } = $props();
	let showResults = $state(false);
	let refusal = $state<VoteRefusal | null>(null);
	let busy = $state(false);
	let box: HTMLFieldSetElement | undefined = $state();
	const st = $derived(pollStatus(poll, { signedIn: auth.authed, open, showResults, refusal, blocked }));

	async function pick(optionId: string) {
		if (busy || blocked) return;
		busy = true;
		const r = await submitVote({ signedIn: auth.authed, open, season, poll: poll.id, option: optionId, post: (p, b) => auth.post(p, b) });
		busy = false;
		if (r.ok) {
			refusal = null;
			if (r.poll) onpoll(r.poll);
			else if (r.view) onview(r.view);
			await tick();
			box?.querySelector<HTMLInputElement>(`input[value="${CSS.escape(optionId)}"]`)?.focus();
		} else {
			refusal = r.refusal;
			box?.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.checked = i.value === poll.mine)); // a refused tap must not look like a vote
		}
	}
</script>

<fieldset class="poll" class:cur={current} bind:this={box} disabled={busy}>
	<legend>{poll.q}</legend>
	{#if hint ?? poll.hint}<p class="hint">{hint ?? poll.hint}</p>{/if}
	{#each poll.options as o (o.id)}
		<label class="opt" class:mine={poll.mine === o.id}>
			<input type="radio" name="poll-{poll.id}" value={o.id} checked={poll.mine === o.id} disabled={!open || !!blocked} onchange={() => pick(o.id)} />
			{#if st.phase === 'results'}<span class="bar" style="--w:{optionPct(poll, o)}%"></span>{/if}
			<span class="dot" aria-hidden="true"></span>
			<span class="tx">{o.label}{#if poll.mine === o.id}<span class="yours">Your vote</span>{/if}</span>
			{#if st.phase === 'results'}<span class="ct"><b>{optionPct(poll, o)}%</b> · {o.votes}</span>{/if}
		</label>
	{/each}
	<div class="pf">
		<span role="status" aria-live="polite">{st.text}</span>
		{#if st.needsSignIn}<button type="button" class="btn sm" onclick={() => auth.login()}>Sign in through Steam</button>{/if}
		{#if st.phase === 'choose' && open && !blocked}<button type="button" class="linkbtn" onclick={() => (showResults = true)}>Show results</button>{/if}
	</div>
</fieldset>
