<script lang="ts">
	import type { Snippet } from 'svelte';

	// One "explore" group. Header: <h3><button aria-expanded aria-controls>. The panel is a labelled region and uses
	// `hidden` when closed. On phones the page keeps ONE group open at a time; on wide screens all start open.
	// The panel starts with a chip row of its sub-sections (when there is more than one) and, on phones, ends
	// with Close and "Next: ...".
	let {
		id,
		title,
		summary,
		subs,
		open,
		next,
		ontoggle,
		onjump,
		onnext,
		children
	}: {
		id: string;
		title: string;
		summary?: string;
		subs: { id: string; title: string }[];
		open: boolean;
		next: string;
		ontoggle: () => void;
		onjump: (id: string) => void;
		onnext: () => void;
		children: Snippet;
	} = $props();
</script>

<section class="grp" {id}>
	<h3 class="gh">
		<button type="button" class="gbtn" id="{id}-b" aria-expanded={open} aria-controls="{id}-p" onclick={ontoggle}>
			<span class="gt">{title}</span>
			{#if summary}<span class="gs">{summary}</span>{/if}
			<span class="chev" aria-hidden="true">▾</span>
		</button>
	</h3>
	<div class="gp" id="{id}-p" role="region" aria-labelledby="{id}-b" hidden={!open}>
		{#if subs.length > 1}
			<nav class="subnav" aria-label="In {title}">
				{#each subs as s (s.id)}<a href="#{s.id}" onclick={(e) => { e.preventDefault(); onjump(s.id); }}>{s.title}</a>{/each}
			</nav>
		{/if}
		{@render children()}
		<div class="gfoot">
			<button type="button" class="btn" onclick={ontoggle}>Close</button>
			<button type="button" class="btn" onclick={onnext}>Next: {next}</button>
		</div>
	</div>
</section>
