<script lang="ts">
	import { announce } from '$lib/stores/announce.svelte';

	// The server-authored broadcast banner. Sits under the arena bar, above the page — one row per active
	// announcement, dismissible, styled by level.
	//
	// ⚠ GOLD BUDGET (DESIGN-SYSTEM): gold marks the winner, the take and the verified stamp. A "launch"
	// announcement is the one thing loud enough to earn it here; `info` stays quiet on panel, and `warn`
	// borrows the molten accent rather than inventing a colour.
	const items = $derived(announce.items);
</script>

{#if items.length}
	<div class="wrap" role="status" aria-live="polite">
		{#each items as a (a.id)}
			<div class="ann {a.level}">
				<span class="ic" aria-hidden="true">
					{a.level === 'launch' ? '🎉' : a.level === 'warn' ? '⚠' : '📣'}
				</span>
				<span class="tx">{a.text}</span>
				<button type="button" class="x" aria-label="Dismiss" onclick={() => announce.dismiss(a.id)}>✕</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.wrap {
		display: grid;
		gap: 6px;
		margin: 6px 0 2px;
	}
	.ann {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
		font-size: 12.5px;
		color: var(--ink);
	}
	.ic {
		flex: none;
		font-size: 14px;
		line-height: 1;
	}
	.tx {
		flex: 1;
		min-width: 0;
	}
	.x {
		flex: none;
		font: inherit;
		font-size: 14px;
		line-height: 1;
		width: 26px;
		height: 26px;
		color: var(--faint);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 7px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ink);
	}

	/* launch — the one announcement loud enough to spend gold on */
	.ann.launch {
		border-color: color-mix(in srgb, var(--gold) 45%, var(--line));
		background: linear-gradient(100deg, var(--gold-soft), transparent 70%), var(--panel);
	}
	.ann.launch .tx {
		font-weight: 700;
	}
	/* warn — molten, the existing accent for "something is wrong", not a new colour */
	.ann.warn {
		border-color: color-mix(in srgb, #ff5c2c 45%, var(--line));
	}
</style>
