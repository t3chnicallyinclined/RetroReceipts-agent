<script lang="ts">
	// A view switch for a chart: buttons with aria-pressed; focus stays on the pressed button after the redraw.
	let { options, value, onpick, label = 'View' }: { options: [string, string][]; value: string; onpick: (v: string) => void; label?: string } = $props();
</script>

<div class="seg" role="group" aria-label={label}>
	{#each options as [v, l] (v)}
		<button type="button" aria-pressed={value === v} onclick={() => onpick(v)}>{l}</button>
	{/each}
</div>
