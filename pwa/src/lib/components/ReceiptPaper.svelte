<script lang="ts">
	import type { Snippet } from 'svelte';

	// 🧾 The shared receipt "paper" — thermal-slip ground, torn top/bottom edges, brand header and the
	// rule primitives every receipt is built from. Extracted so the match receipt, the session tab and any
	// future slip are ONE visual system rather than three drifting copies of the same CSS.
	//
	// Line items live in the CALLER, passed as a snippet: Svelte scopes styles to the component whose markup
	// owns an element, so the caller's own item styles still apply inside here while this component keeps
	// the paper. MoneyH2H predates this and still carries its own copy — deliberately left alone rather than
	// churned mid-flight; it can adopt this later.
	let {
		sub,
		meta,
		body,
		footer
	}: {
		/** the line under RETRO RECEIPTS, e.g. "· MONEY MATCH ·" */
		sub: string;
		meta?: Snippet;
		body: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<div class="receipt mono">
	<div class="rc-hd">
		<div class="brand">RETRO&nbsp;RECEIPTS</div>
		<div class="sub">{sub}</div>
	</div>
	<div class="rule dash"></div>
	{#if meta}
		{@render meta()}
		<div class="rule dbl"></div>
	{/if}
	{@render body()}
	{#if footer}
		<div class="rule dbl"></div>
		{@render footer()}
	{/if}
</div>

<style>
	.receipt {
		position: relative;
		width: 100%;
		max-width: 400px;
		padding: 18px 20px 20px;
		background:
			repeating-linear-gradient(
				0deg,
				transparent,
				transparent 26px,
				color-mix(in srgb, var(--ink) 3%, transparent) 26px,
				color-mix(in srgb, var(--ink) 3%, transparent) 27px
			),
			var(--panel);
		color: var(--ink);
		box-shadow: var(--shadow);
		font-size: 12px;
		line-height: 1.5;
	}
	/* torn edges — the slip is ripped off the roll, not a rounded card */
	.receipt::before,
	.receipt::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 9px;
		background-image:
			linear-gradient(135deg, var(--panel) 40%, transparent 41%),
			linear-gradient(225deg, var(--panel) 40%, transparent 41%);
		background-position: 0 0;
		background-size: 12px 9px;
		background-repeat: repeat-x;
	}
	.receipt::before {
		top: -9px;
		transform: scaleY(-1);
	}
	.receipt::after {
		bottom: -9px;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
		font-variant-numeric: tabular-nums;
	}
	.rc-hd {
		text-align: center;
	}
	.brand {
		font-size: 15px;
		font-weight: 800;
		letter-spacing: 0.18em;
		color: var(--ink);
	}
	.sub {
		margin-top: 2px;
		font-size: 10.5px;
		letter-spacing: 0.14em;
		color: var(--dim);
	}
	.rule {
		height: 0;
		margin: 9px 0;
	}
	.rule.dash {
		border-top: 1px dashed color-mix(in srgb, var(--faint) 70%, transparent);
	}
	.rule.dbl {
		border-top: 3px double color-mix(in srgb, var(--faint) 75%, transparent);
	}
</style>
