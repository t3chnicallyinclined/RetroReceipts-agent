<script lang="ts">
	import { seasons } from '$lib/stores/seasons.svelte';

	// Shown only while a finished season is on screen: says plainly that these numbers are final and offers
	// the way back. Not a control row (DESIGN-SYSTEM hard-rule #1): one line of text plus one link-button.
	const s = $derived(seasons.archived ? seasons.active : null);
	const cur = $derived(seasons.currentLabel);

	let { onback }: { onback?: (id: string) => void } = $props();

	function back() {
		const id = seasons.currentId;
		if (id && seasons.select(id)) onback?.(id);
	}
</script>

{#if s}
	<div class="note" role="status">
		<span class="tag">FINAL</span>
		<span class="txt"
			><b>{s.label}</b> is over. You're looking at its final standings, which won't change.</span
		>
		{#if cur}<button class="back" type="button" onclick={back}>Back to {cur}</button>{/if}
	</div>
{/if}

<style>
	.note {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 10px;
		margin: 0 0 12px;
		padding: 9px 12px;
		border: 1px solid color-mix(in srgb, var(--gold) 34%, var(--line));
		border-radius: 10px;
		background: var(--gold-soft);
		font-size: 12.5px;
		color: var(--ink);
	}
	.tag {
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.08em;
		color: var(--gold);
		border: 1px solid color-mix(in srgb, var(--gold) 50%, transparent);
		border-radius: 5px;
		padding: 1px 5px;
	}
	.txt {
		flex: 1 1 220px;
		min-width: 0;
	}
	.back {
		font: inherit;
		font-size: 12px;
		font-weight: 800;
		color: var(--gold);
		background: transparent;
		border: 0;
		padding: 8px 4px;
		min-height: 36px;
		cursor: pointer;
		text-decoration: underline;
	}
	.back:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
</style>
