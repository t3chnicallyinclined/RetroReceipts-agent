<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import RankSprite from '$lib/components/RankSprite.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import AppLive from '$lib/components/AppLive.svelte';
	import ChallengeStrip from '$lib/components/ChallengeStrip.svelte';
	import DownloadAgent from '$lib/components/DownloadAgent.svelte';
	import RankInfoModal from '$lib/components/RankInfoModal.svelte';
	import { pwa } from '$lib/stores/pwa.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { rankInfo } from '$lib/stores/rankinfo.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { rankOf } from '$lib/ranks';

	let { children } = $props();

	// The viewer's own tier, so the legend can tag their row YOU from wherever it was opened.
	const myGames = $derived((auth.me?.wins ?? 0) + (auth.me?.losses ?? 0));
	const mySlug = $derived(auth.me ? rankOf(auth.me.rating ?? 0, myGames).s : null);

	// Boot-time: capture the install prompt + sync the theme store to what the inline script already applied.
	onMount(() => {
		pwa.init();
		theme.init();
	});
</script>

<!-- headless: owns the app-wide live-data lifecycle (wallet / agent / result-check / wager) so the chrome is pure-render -->
<AppLive />

<!-- rank-badge sprite: injected once, referenced by every RankBadge via <use> -->
<RankSprite />

<div class="app">
	<div class="wrap">
		<TopBar />
		<ChallengeStrip />
		<DownloadAgent />
		<main>
			{@render children()}
		</main>
	</div>
	<TabBar />
</div>

<!-- One legend for the whole app: every rank title (board rows, plates, profile hero, match cards, the
     ladder) opens THIS instance through the rankInfo store, instead of each site mounting its own. -->
{#if rankInfo.slug}
	<RankInfoModal slug={rankInfo.slug} {mySlug} onClose={() => rankInfo.close()} />
{/if}

<style>
	main {
		margin-top: 6px;
	}
</style>
