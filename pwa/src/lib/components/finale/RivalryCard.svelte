<script lang="ts">
	import Avatar from '$lib/components/Avatar.svelte';
	import { base } from '$app/paths';
	import type { PlayerRef } from '$lib/finale/highlights';
	import type { Snippet } from 'svelte';

	// Two players, a gold VS, a centre figure; the drawing and the action come in as snippets.
	let { a, b, season, mid }: { a: PlayerRef; b: PlayerRef; season: string; mid: Snippet } = $props();
</script>

{#snippet side(p: PlayerRef)}
	<span class="side">
		<Avatar url={p.avatar} size={44} alt="" />
		<a class="nm" href="{base}/u/{encodeURIComponent(p.steamid)}?season={encodeURIComponent(season)}">{p.name}</a>
	</span>
{/snippet}
<div class="riv">
	{@render side(a)}
	<span class="mid"><span class="vs" aria-hidden="true">VS</span>{@render mid()}</span>
	{@render side(b)}
</div>
