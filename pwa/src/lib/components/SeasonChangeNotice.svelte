<script lang="ts">
	import { onMount } from 'svelte';
	import { seasons } from '$lib/stores/seasons.svelte';

	// A tab opened before a season changed shows the old ladder until it is refreshed. The table is re-read when the
	// tab regains focus (at most once a minute); if the CURRENT season changed, say so and offer a refresh.
	onMount(() => {
		const check = () => {
			if (document.visibilityState === 'visible') void seasons.recheck();
		};
		document.addEventListener('visibilitychange', check);
		addEventListener('focus', check);
		return () => {
			document.removeEventListener('visibilitychange', check);
			removeEventListener('focus', check);
		};
	});
</script>

{#if seasons.changed}
	<div class="chg" role="status" aria-live="polite">
		<span>A new season has started. Refresh to see the new ladder.</span>
		<button type="button" onclick={() => location.reload()}>Refresh</button>
	</div>
{/if}

<style>
	.chg {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px 12px;
		margin: 6px 0 2px;
		padding: 9px 12px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
		font-size: 12.5px;
		color: var(--ink);
	}
	button {
		font: inherit;
		font-weight: 800;
		font-size: 12px;
		color: var(--bg);
		background: var(--ink);
		border: 1px solid var(--ink);
		border-radius: 999px;
		min-height: 36px;
		padding: 0 16px;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
</style>
