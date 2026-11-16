<script lang="ts">
	// Wide screens: a sticky chip row (the dock's replacement). `aria-current` follows scroll; "Have your say" is
	// pinned to the right.
	let { items, current, onjump }: { items: { id: string; title: string }[]; current: string; onjump: (id: string) => void } = $props();
</script>

<nav class="snav" aria-label="Sections">
	{#each items as it (it.id)}
		<a href="#{it.id}" aria-current={current === it.id ? 'true' : undefined} onclick={(e) => { e.preventDefault(); onjump(it.id); }}>{it.title}</a>
	{/each}
	<a class="fbk" href="#feedback" onclick={(e) => { e.preventDefault(); onjump('feedback'); }}>Have your say</a>
</nav>
