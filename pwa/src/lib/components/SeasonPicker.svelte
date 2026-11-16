<script lang="ts">
	import { onMount } from 'svelte';
	import { seasons } from '$lib/stores/seasons.svelte';

	// Season picker: a native <select> (best keyboard + screen-reader + phone behaviour for a short list).
	// Renders nothing on a server with no season table, or one with only a single season, so an old server
	// shows no picker at all. Picking calls `onchange` so the page can refetch with the new season.
	let { onchange }: { onchange?: (id: string) => void } = $props();

	onMount(() => {
		void seasons.load();
	});

	const value = $derived(seasons.activeId ?? '');

	function pick(e: Event & { currentTarget: HTMLSelectElement }) {
		const id = e.currentTarget.value;
		if (seasons.select(id)) onchange?.(id);
	}
</script>

{#if seasons.multiple}
	<label class="sp" class:past={seasons.archived}>
		<select class="sel" {value} onchange={pick} aria-label="Season">
			{#each seasons.newestFirst as s (s.id)}
				<option value={s.id} selected={s.id === value}
					>{s.label}{s.id === seasons.currentId ? ' (current)' : ' (final)'}</option
				>
			{/each}
		</select>
	</label>
{/if}

<style>
	.sp {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}
	.sel {
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		color: var(--ink);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 6px 10px;
		min-height: 34px;
		max-width: 100%;
		cursor: pointer;
	}
	.sel:hover {
		border-color: var(--gold-soft);
	}
	.sel:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
	/* a past season is marked on the control itself, not only in the note under it */
	.past .sel {
		border-color: var(--gold);
	}
	@media (max-width: 899px) {
		.sel {
			/* 16px: below it iOS/iPadOS Safari zooms the page when the control is focused. */
			font-size: 16px;
			min-height: 40px;
		}
	}
</style>
