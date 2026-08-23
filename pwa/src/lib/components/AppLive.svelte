<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { wallet } from '$lib/stores/wallet.svelte';
	import { agent } from '$lib/stores/agent.svelte';
	import { resultcheck } from '$lib/stores/resultcheck.svelte';
	import { wager } from '$lib/stores/wager.svelte';

	// Headless app-wide live-data owner (no markup). Every live surface — wallet, agent, result-check, and
	// wager/challenges — used to own its own connect/poll/visibility inside its chip's onMount, which meant a
	// chip removed at a breakpoint (or during the top-bar consolidation) silently killed its subscription. That
	// lifecycle now lives HERE, once, so the chrome is pure-render and the data keeps flowing regardless of what's
	// on screen. Pauses on tab-hidden (CPU discipline); reconnects + reconciles (re-fetches, never relies on a
	// missed SSE event) on show. Mount this once in +layout.svelte.

	// Bind the per-user surfaces to the signed-in id: re-runs on sign in / out.
	$effect(() => {
		const sid = auth.steamid;
		void wallet.load(sid);
		void agent.load(sid);
		void resultcheck.load(sid);
		void wager.loadMine(sid);
	});

	onMount(() => {
		wallet.connect();
		resultcheck.connect(auth.steamid);
		wager.connect(auth.steamid);
		void wager.loadOpen(); // the arcade (open challenges) is a public read — keep it live regardless of sign-in

		const onVis = () => {
			if (document.hidden) {
				wallet.disconnect();
				resultcheck.disconnect();
				wager.disconnect();
			} else {
				wallet.connect();
				void wallet.load(auth.steamid);
				resultcheck.connect(auth.steamid);
				wager.connect(auth.steamid);
				void wager.loadMine(auth.steamid);
				void wager.loadOpen();
				void agent.load(auth.steamid);
			}
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			wallet.disconnect();
			resultcheck.disconnect();
			wager.disconnect();
		};
	});
</script>
