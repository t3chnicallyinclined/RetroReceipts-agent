<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import SeasonPoll from './SeasonPoll.svelte';
	import SuggestModal from '$lib/components/SuggestModal.svelte';
	import { DISCORD_URL } from '$lib/links';
	import { NOTE_MAX, NOTE_MIN, STATUS_LABEL, submitNote, type FeedbackView } from '$lib/finale/feedback';

	// Help shape the next season: polls (phone: one question at a time with a pager, wide: a grid), one note, the
	// other ways to tell us, and "what players asked for". Feedback 404 (`fb` null): polls, note and the list hide;
	// Discord and "Suggest a stat" remain.
	let { fb, season, label, days, onview }: { fb: FeedbackView | null; season: string; label: string; days?: number; onview: (v: FeedbackView) => void } = $props();
	let qi = $state(0);
	let text = $state('');
	let noteMsg = $state('');
	let sending = $state(false);
	let showSuggest = $state(false);
	const n = $derived(fb?.polls.length ?? 0);
	const tooShort = $derived(text.trim().length < NOTE_MIN);

	async function send() {
		if (sending || tooShort) return;
		sending = true;
		const r = await submitNote({ signedIn: auth.authed, season, text, post: (p, b) => auth.post(p, b) });
		sending = false;
		noteMsg = r.message;
		if (r.ok) text = '';
	}
	const lengthHint = (p: { id: string; hint: string }) => (p.id === 'length' && days ? `${label} ran for ${days} days of play.` : undefined);
</script>

<p class="ssub">This is a side project and it is still in testing. We can’t promise what will be built, but every answer is read{fb ? ', and the running results are shown right here' : ''}.</p>

{#if fb && fb.polls.length}
	<div class="polls">
		{#each fb.polls as p, i (p.id)}
			<SeasonPoll poll={p} open={fb.open} {season} hint={lengthHint(p)} current={i === qi} blocked={fb.blocked} {onview} onpoll={(np) => fb && onview({ ...fb, polls: fb.polls.map((x) => (x.id === np.id ? np : x)) })} />
		{/each}
	</div>
	<div class="ppager">
		<button type="button" class="btn sm ghost" disabled={qi === 0} onclick={() => (qi = Math.max(0, qi - 1))}>Back</button>
		<span>Question {qi + 1} of {n}</span>
		<button type="button" class="btn sm ghost" disabled={qi >= n - 1} onclick={() => (qi = Math.min(n - 1, qi + 1))}>Next question</button>
	</div>
{/if}

<div class="fb2">
	{#if fb && fb.open}
		<div class="card">
			<h3 class="plainh">One thing you’d change</h3>
			{#if auth.authed && fb.blocked}
				<p class="dimp">{fb.blocked} You can still tell us in Discord.</p>
			{:else if auth.authed}
				<label class="sr" for="fin-note">Your note</label>
				<textarea id="fin-note" maxlength={NOTE_MAX} placeholder="About the season, the ladder, or this page" bind:value={text}></textarea>
				<div class="row">
					<span class="count">{text.length} / {NOTE_MAX}</span>
					<button type="button" class="btn pri" disabled={sending || tooShort} onclick={send}>Send</button>
				</div>
			{:else}
				<p class="dimp">Sign in to send a note, or tell us in Discord.</p>
				<div class="cta"><button type="button" class="btn" onclick={() => auth.login()}>Sign in through Steam</button></div>
			{/if}
			<p class="status" role="status" aria-live="polite">{noteMsg}</p>
		</div>
	{/if}
	<div class="card">
		<h3 class="plainh">Other ways to tell us</h3>
		<p class="dimp">Have an idea for a stat or a leaderboard? Send it from here. For anything longer, RETRO RECEIPTS lives in the NOBD Discord.</p>
		<div class="cta">
			{#if DISCORD_URL}<a class="btn pri" href={DISCORD_URL} rel="noopener">Join the NOBD Discord</a>{/if}
			{#if auth.authed}<button type="button" class="btn" onclick={() => (showSuggest = true)}>Suggest a stat</button>{/if}
		</div>
	</div>
	{#if fb}
		<div class="card full">
			<span class="rail">Where your answers go</span>
			<h3 class="plainh">What players asked for</h3>
			<p class="dimp">Votes are counted on this page. Notes and stat ideas are read by the one person who builds this. This list is updated as things are looked at.</p>
			{#if fb.asked.length}
				<ul class="asked">
					{#each fb.asked as a (a.id)}
						<li><span>{a.text}</span><span class="pill">{STATUS_LABEL[a.status]}</span>{#if a.note}<span class="an">{a.note}</span>{/if}</li>
					{/each}
				</ul>
			{:else}
				<p class="dimp">Nothing here yet. This list fills in as answers come in.</p>
			{/if}
		</div>
	{/if}
</div>

{#if showSuggest}<SuggestModal onClose={() => (showSuggest = false)} />{/if}
