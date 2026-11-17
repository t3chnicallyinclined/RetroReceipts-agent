<script lang="ts">
	import { browser } from '$app/environment';
	import { auth } from '$lib/stores/auth.svelte';
	import { agentWinUrl, WIN_URL_FALLBACK, LINUX_CMD } from '$lib/agentUrl';

	// The one call to action for a season: get the app and play. The download link is the SAME one the "Get the
	// desktop agent" banner uses (agentUrl.ts, resolved from the updater manifest), so it follows a renamed release
	// asset. Signing in through Steam is the quiet second action. Never a registration step.
	let {
		line,
		signinNote = 'to see your stats and vote',
		showSignin = true,
		small = false
	}: { line?: string; signinNote?: string; showSignin?: boolean; small?: boolean } = $props();

	let winUrl = $state(WIN_URL_FALLBACK);
	$effect(() => {
		if (browser) void agentWinUrl().then((u) => (winUrl = u));
	});
	const isLinux = browser && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
</script>

<div class="gta" class:small>
	{#if line}<p class="gl">{line}</p>{/if}
	<div class="acts">
		<a class="pri" href={winUrl}>Download the app</a>
		{#if showSignin && !auth.authed}
			<span class="sg"><button type="button" class="sec" onclick={() => auth.login()}>Sign in through Steam</button><span class="note">{signinNote}</span></span>
		{/if}
	</div>
	{#if isLinux}<p class="lin">On Linux or Steam Deck, run <code>{LINUX_CMD}</code></p>{/if}
</div>

<style>
	.gta {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.gl {
		margin: 0;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.acts {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 10px;
	}
	.pri,
	.sec {
		font: inherit;
		font-weight: 800;
		font-size: 12.5px;
		min-height: 40px;
		padding: 0 16px;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		text-decoration: none;
		cursor: pointer;
	}
	.pri {
		background: var(--ink);
		color: var(--bg);
		border: 1px solid var(--ink);
	}
	.sec {
		background: var(--panel-2);
		color: var(--ink);
		border: 1px solid var(--line);
	}
	.sg {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 8px;
	}
	.note {
		font-size: 12px;
		color: var(--dim);
	}
	.lin {
		margin: 0;
		font-size: 12px;
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	.lin code {
		font-size: 11.5px;
		color: var(--ink);
	}
	.small .pri,
	.small .sec {
		min-height: 36px;
		font-size: 12px;
	}
	.pri:focus-visible,
	.sec:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
</style>
