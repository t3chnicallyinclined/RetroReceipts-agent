<script lang="ts">
	import { countUp } from '$lib/finale/motion';
	// The true value is in a visually hidden span; the animated copy is aria-hidden.
	let { value, format = (n: number) => Math.round(n).toLocaleString('en-US') }: { value: number; format?: (n: number) => string } = $props();
</script>

<span class="sr">{format(value)}</span><span aria-hidden="true" use:countUp={{ value, format }}>{format(value)}</span>
