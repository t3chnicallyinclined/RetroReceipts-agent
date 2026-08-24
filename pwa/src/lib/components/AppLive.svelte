<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { wallet } from '$lib/stores/wallet.svelte';
	import { getChannel } from '$lib/rt.svelte';
	import { invalidate } from '$lib/net.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import type { SseFrame } from '$lib/types';
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

	// ── SSOT sweep fix (2026-08-24): result-driven freshness + announcements must be APP-WIDE, not
	// /match-scoped. The matchfeed store owns the rich feed handling, but it only connects on /match —
	// so the invalidate()+loadMe() push and the signed-out announcement path silently died on every
	// other page (ratings frozen at boot-time in the chrome; broadcasts missed off /match). This slim
	// subscriber rides the same shared 'matches' channel the wallet already holds open. Running
	// alongside matchfeed on /match is harmless: invalidate() is idempotent and announce.push dedups.
	let unsubLive: (() => void) | null = null;
	const connectLive = () => {
		if (unsubLive) return;
		unsubLive = getChannel('matches').subscribe((f: SseFrame) => {
			const t = String(f.type ?? '');
			if (t === 'announcement') return announce.push(f);
			if (t !== 'match_result') return;
			invalidate('/rr/profile');
			invalidate('/rr/leaderboard');
			invalidate('/rr/matchup');
			const mine = auth.steamid;
			if (mine && (String(f.winner) === mine || String(f.loser) === mine)) void auth.loadMe();
		});
	};
	const disconnectLive = () => {
		if (unsubLive) {
			unsubLive();
			unsubLive = null;
		}
	};

	onMount(() => {
		connectLive();
		wallet.connect();
		resultcheck.connect(auth.steamid);
		wager.connect(auth.steamid);
		void wager.loadOpen(); // the arcade (open challenges) is a public read — keep it live regardless of sign-in

		const onVis = () => {
			if (document.hidden) {
				disconnectLive();
				wallet.disconnect();
				resultcheck.disconnect();
				wager.disconnect();
			} else {
				connectLive();
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
			disconnectLive();
			wallet.disconnect();
			resultcheck.disconnect();
			wager.disconnect();
		};
	});
</script>
