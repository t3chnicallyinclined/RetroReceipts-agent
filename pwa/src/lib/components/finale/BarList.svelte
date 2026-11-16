<script lang="ts">
	// Horizontal bars. With `readout` each row is a button that writes its sentence into the read-out; without it
	// the rows are plain. Every value is printed beside its bar.
	import type { Snippet } from 'svelte';
	import type { Bar } from '$lib/finale/types';
	let { rows, lw = 112, hint, row }: { rows: Bar[]; lw?: number; hint?: string; row?: Snippet<[Bar]> } = $props();
	let pick = $state<string | null>(null);
	const max = $derived(Math.max(1, ...rows.map((r) => r.value)));
	const sel = $derived(rows.find((r) => r.key === pick));
</script>

<div class="hbars" style="--lw:{lw}px">
	{#each rows as r (r.key)}
		{#if hint !== undefined}
			<button type="button" class="hb" aria-pressed={pick === r.key} aria-label={r.msg} onclick={() => (pick = r.key)} onfocus={() => (pick = r.key)} onmouseenter={() => (pick = r.key)}>
				<span class="hl">{#if row}{@render row(r)}{:else}<span>{r.label}</span>{/if}</span>
				<span class="tr" aria-hidden="true"><i class="fl" style="--w:{(100 * r.value) / max}%;--bc:{r.color ?? 'var(--dim)'}"></i></span>
				<b class:up={r.tone === 'up'}>{r.text}{#if r.sub} <small>{r.sub}</small>{/if}</b>
			</button>
		{:else}
			<div class="hb">
				<span class="hl">{#if row}{@render row(r)}{:else}<span>{r.label}</span>{/if}</span>
				<span class="tr" aria-hidden="true"><i class="fl" style="--w:{(100 * r.value) / max}%;--bc:{r.color ?? 'var(--dim)'}"></i></span>
				<b class:up={r.tone === 'up'}>{r.text}{#if r.sub} <small>{r.sub}</small>{/if}</b>
			</div>
		{/if}
	{/each}
</div>
{#if hint !== undefined}<p class="readout" aria-live="polite">{sel?.msg ?? hint}</p>{/if}
