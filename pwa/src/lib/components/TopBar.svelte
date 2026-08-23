<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { NAV } from '$lib/nav';
	import WalletChip from './WalletChip.svelte';
	import ResultCheckBell from './ResultCheckBell.svelte';
	import AccountMenu from './AccountMenu.svelte';

	// The single global arena bar (DESIGN-SYSTEM.md hard-rule #1): brand cab + cut-tabs + gold seam.
	// Desktop only — mobile uses the bottom TabBar.
	const path = $derived(page.url.pathname);
	function active(href: string): boolean {
		const full = base + href;
		if (href === '/ranks') return path === base + '/' || path.startsWith(full);
		return path.startsWith(full);
	}
</script>

<header class="bar">
	<a class="brand" href="{base}/ranks">
		<span class="cab" aria-hidden="true">
			<svg viewBox="0 0 100 100">
				<defs><linearGradient id="rrcab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb020"/><stop offset="1" stop-color="#ff5c2c"/></linearGradient></defs>
				<!-- full-bleed: the paper spans 96 of 100 units with the tear teeth cut out of the edges, so
				     the mark fills its 30px slot instead of floating at half size inside it -->
				<path d="M2 10 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 L98 90 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 Z" fill="url(#rrcab)"/>
				<rect x="12" y="20" width="76" height="8" rx="4" fill="#0a0c12"/>
				<rect x="12" y="34" width="76" height="8" rx="4" fill="#0a0c12"/>
				<rect x="12" y="48" width="48" height="8" rx="4" fill="#0a0c12"/>
				<g fill="#0a0c12"><rect x="12" y="62" width="7" height="23"/><rect x="25" y="62" width="5" height="23"/><rect x="36" y="62" width="9" height="23"/><rect x="51" y="62" width="5" height="23"/><rect x="62" y="62" width="9" height="23"/><rect x="77" y="62" width="7" height="23"/></g>
			</svg>
		</span>
		<span class="wordmark">Retro <span class="g">Receipts</span></span>
	</a>
	<span class="seam" aria-hidden="true"></span>
	<nav class="tabs">
		{#each NAV as t (t.id)}
			<a class="cut" class:on={active(t.href)} class:soon={!t.live} href="{base}{t.href}">
				<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
					><path
						d={t.d}
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
				<span>{t.label}</span>
			</a>
		{/each}
	</nav>
	<div class="authslot">
		<WalletChip />
		<ResultCheckBell />
		<AccountMenu />
	</div>
</header>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 4px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: var(--ink);
	}
	.cab {
		width: 30px;
		height: 30px;
		flex: none;
		display: grid;
		place-items: center;
	}
	.cab svg {
		width: 30px;
		height: 30px;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
	}
	.wordmark {
		font-size: 15.5px;
		font-weight: 800;
		letter-spacing: 0.02em;
	}
	.wordmark .g {
		color: var(--gold);
	}
	.seam {
		width: 2px;
		height: 26px;
		transform: skewX(-14deg);
		background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--gold) 60%, var(--line)), transparent);
	}
	.tabs {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.cut {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		transform: skewX(-12deg);
		padding: 7px 13px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: transparent;
		color: var(--dim);
		font-size: 12.5px;
		font-weight: 700;
		text-decoration: none;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.cut > :global(*) {
		transform: skewX(12deg);
	}
	.cut:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.cut.on {
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-color: transparent;
		color: var(--gold-ink);
		font-style: italic;
	}
	.cut.soon {
		opacity: 0.72;
	}
	.authslot {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	@media (max-width: 720px) {
		/* the bottom TabBar carries navigation on mobile; the identity chip stays */
		.bar {
			gap: 10px;
		}
		.seam,
		.tabs {
			display: none;
		}
	}
</style>
