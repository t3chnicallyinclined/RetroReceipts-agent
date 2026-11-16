<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import type { PlayerRef } from '$lib/finale/highlights';

	// A named player: avatar + name (as stored), linking to their profile for the season. No link without a steamid.
	let { p, season, size = 22 }: { p: PlayerRef; season: string; size?: number } = $props();
</script>

{#if p.steamid}
	<a class="w" href="{base}/u/{encodeURIComponent(p.steamid)}?season={encodeURIComponent(season)}"><Avatar url={p.avatar} {size} alt="" /><span title={p.name}>{p.name}</span></a>
{:else}
	<span class="w"><Avatar url={p.avatar} {size} alt="" /><span>{p.name}</span></span>
{/if}
