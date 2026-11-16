<script lang="ts">
	// One mark per win (or hit). Above 600 marks, one mark per 10. `tone` colours the marks (good = streak, mol = molten).
	let { count, tone = 'good', label, cap = 600 }: { count: number; tone?: 'good' | 'mol'; label: string; cap?: number } = $props();
	const per = $derived(count > cap ? 10 : 1);
	const marks = $derived(Math.ceil(count / per));
</script>

<div class="pips" class:mol={tone === 'mol'} role="img" aria-label={label}>
	{#each Array(marks) as _, i (i)}<i></i>{/each}
</div>
{#if per > 1}<p class="dimp">Each mark is {per} {tone === 'mol' ? 'hits' : 'wins'}.</p>{/if}
