<script lang="ts">
	import CountUp from './CountUp.svelte';
	let { value, label }: { value: number; label: string } = $props();
	const fmt = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`;
</script>

<div class="meter">
	<p class="mt"><b><CountUp {value} format={fmt} /></b><span>{label}</span></p>
	<div class="tr" aria-hidden="true"><i class="fl" style="--w:{value}%"></i></div>
</div>
