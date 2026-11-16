<script lang="ts">
	import { ALSO_COMING } from '$lib/finale/nextCopy';

	// Two small "In testing" cards: no buttons, no links. A card renders only when its copy is non-empty.
	let { nextLabel }: { nextLabel?: string } = $props();
	const cards = $derived(ALSO_COMING.map((c) => ({ ...c, text: c.body(nextLabel).trim() })).filter((c) => c.text));
</script>

{#each cards as c (c.key)}
	<div class="card also">
		<span class="rail">{c.rail}</span>
		<h3 class="plainh">{c.title}</h3>
		<p class="dimp">{c.text}</p>
		{#if c.small}<p class="dimp">{c.small}</p>{/if}
	</div>
{/each}
