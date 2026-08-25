<script lang="ts">
	import type { Snippet } from 'svelte';

	// 🏷 MASTHEAD — the page-head pattern (title + ghost watermark + accent seam + description) that the
	// audit found copy-pasted inline on TEN routes. One component; routes adopt as they're touched.
	let {
		title,
		ghost = '',
		accent = 'var(--gold)',
		desc = '',
		right = null,
		pills = null
	}: {
		title: string;
		/** the oversized watermark word (defaults to the title) */
		ghost?: string;
		accent?: string;
		desc?: string;
		/** optional right-aligned slot (counters, actions) */
		right?: Snippet | null;
		/** optional inline slot after the title (LIVE pill, scope chips) */
		pills?: Snippet | null;
	} = $props();
</script>

<section class="mast" style="--acc:{accent}">
	<div class="ghost" aria-hidden="true">{ghost || title}</div>
	<div class="mrow">
		<h1 class="mtitle">{title}</h1>
		{#if pills}{@render pills()}{/if}
		{#if right}<span class="right">{@render right()}</span>{/if}
	</div>
	<div class="seam" aria-hidden="true"></div>
	{#if desc}<p class="mdesc">{desc}</p>{/if}
</section>

<style>
	.mast {
		position: relative;
		overflow: hidden;
		padding: 14px 4px 10px;
		margin-bottom: 6px;
	}
	.ghost {
		position: absolute;
		right: 0;
		top: -6px;
		font-size: clamp(46px, 12vw, 96px);
		font-style: italic;
		font-weight: 900;
		letter-spacing: -0.03em;
		color: var(--ink);
		opacity: 0.045;
		pointer-events: none;
		user-select: none;
		text-transform: uppercase;
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.right {
		margin-left: auto;
	}
	.mtitle {
		font-size: clamp(20px, 5.5vw, 27px);
		font-weight: 900;
		font-style: italic;
		text-transform: uppercase;
		margin: 0;
	}
	.seam {
		height: 2px;
		width: 130px;
		margin: 8px 0 10px;
		background: linear-gradient(90deg, var(--acc), transparent);
	}
	.mdesc {
		max-width: 66ch;
		color: var(--dim);
		font-size: 13.5px;
		margin: 0;
	}
</style>
