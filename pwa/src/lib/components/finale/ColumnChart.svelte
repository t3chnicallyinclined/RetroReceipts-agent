<script lang="ts">
	// Columns with the value on every column. Every mark is a button: tap, focus or hover writes its sentence into
	// the read-out below (aria-live), so nothing depends on hover. A partial column is hatched and footnoted.
	import type { Col } from '$lib/finale/types';
	let { cols, aria, hint, mini = false, format = (n: number) => Math.round(n).toLocaleString('en-US') }: { cols: Col[]; aria: string; hint: string; mini?: boolean; format?: (n: number) => string } = $props();
	let pick = $state<number | null>(null);
	const max = $derived(Math.max(1, ...cols.map((c) => c.value)));
	const readout = $derived(pick !== null && cols[pick] ? cols[pick].msg : hint);
</script>

<div class="cols" class:mini role="group" aria-label={aria}>
	{#each cols as c, i (i)}
		<button type="button" class="col" class:partial={c.partial} aria-pressed={pick === i} aria-label={c.msg} onclick={() => (pick = i)} onfocus={() => (pick = i)} onmouseenter={() => (pick = i)}>
			<span class="cv">{format(c.value)}</span><span class="cb" style="--h:{(100 * c.value) / max}%"></span>
		</button>
	{/each}
</div>
<div class="colx" aria-hidden="true">{#each cols as c, i (i)}<span>{c.label}</span>{/each}</div>
<p class="readout" aria-live="polite">{readout}</p>
