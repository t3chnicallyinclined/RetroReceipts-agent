<script lang="ts">
	// Country flag as a real IMAGE (cross-platform). Flag EMOJI don't render on Windows/Chrome — they
	// show the letter pair (e.g. "US") — so we use flagcdn.com SVGs, the same external-image class as the
	// Steam avatars this app already loads everywhere. Falls back to the uppercased country code (i.e. the
	// old behaviour) on any error or invalid code, so it never renders worse than before.
	let { cc = '', w = 18, title = '' }: { cc?: string; w?: number; title?: string } = $props();
	const code = $derived((cc ?? '').trim().toLowerCase());
	const valid = $derived(/^[a-z]{2}$/.test(code));
	let failed = $state(false);
</script>

{#if valid && !failed}
	<img
		class="flag"
		src={`https://flagcdn.com/${code}.svg`}
		alt={title || code.toUpperCase()}
		{title}
		style={`width:${w}px`}
		loading="lazy"
		onerror={() => (failed = true)}
	/>
{:else}
	<span class="flag-fb" {title}>{valid ? code.toUpperCase() : '🏳'}</span>
{/if}

<style>
	.flag {
		display: inline-block;
		height: auto;
		border-radius: 2px;
		vertical-align: middle;
		object-fit: cover;
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--line) 80%, transparent);
	}
	.flag-fb {
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--dim);
	}
</style>
