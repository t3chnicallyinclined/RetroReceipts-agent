<script lang="ts">
	// The phone "Jump to" sheet: a modal <dialog> (native focus trap and Escape), one row per section and group with
	// a one-line summary, chips for a group's sub-sections. Tapping anything closes the sheet and jumps there.
	import type { NavItem } from '$lib/finale/types';
	let { items, current, onjump, dialog = $bindable() }: { items: NavItem[]; current: string; onjump: (id: string) => void; dialog?: HTMLDialogElement } = $props();

	function go(e: Event, id: string) {
		e.preventDefault();
		dialog?.close();
		onjump(id);
	}
</script>

<dialog class="menu" bind:this={dialog} aria-labelledby="menu-t" onclick={(e) => { if (e.target === dialog) dialog?.close(); }}>
	<div class="mhd">
		<h3 id="menu-t">Jump to</h3>
		<button type="button" class="btn sm" onclick={() => dialog?.close()}>Close</button>
	</div>
	<ul>
		{#each items as it (it.id)}
			<li>
				<a class="mi" href="#{it.id}" aria-current={current === it.id ? 'true' : undefined} onclick={(e) => go(e, it.id)}>
					<b>{it.title}</b>{#if it.summary}<span>{it.summary}</span>{/if}
				</a>
				{#if it.subs && it.subs.length > 1}
					<div class="msub">{#each it.subs as s (s.id)}<a href="#{s.id}" onclick={(e) => go(e, s.id)}>{s.title}</a>{/each}</div>
				{/if}
			</li>
		{/each}
	</ul>
</dialog>
