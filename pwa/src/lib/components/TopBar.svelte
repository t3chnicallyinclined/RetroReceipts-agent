<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { NAV } from '$lib/nav';
	import WalletChip from './WalletChip.svelte';
	import ResultCheckBell from './ResultCheckBell.svelte';
	import AccountMenu from './AccountMenu.svelte';

	// The single global arena bar. Desktop: brand cab + calm text nav (the active tab is the ONLY skew + the
	// only nav gold — a thin tick), a "⋯ More" menu for secondary sections, then the status/account atoms.
	// Mobile: brand + atoms; the bottom TabBar carries nav. Quiet by design — gold is spent only on the active
	// tab tick + the wallet chip, so the molten challenge strip is the one loud thing when it fires.
	const path = $derived(page.url.pathname);
	const primary = $derived(NAV.filter((t) => t.primary));
	const more = $derived(NAV.filter((t) => !t.primary));
	function active(href: string): boolean {
		const full = base + href;
		if (href === '/ranks') return path === base + '/' || path.startsWith(full);
		return path.startsWith(full);
	}
	const moreActive = $derived(more.some((t) => active(t.href)));
	let moreOpen = $state(false);
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') moreOpen = false;
	}
</script>

<svelte:window onkeydown={onKey} />

<header class="bar">
	<a class="brand" href="{base}/ranks" aria-label="Retro Receipts — home">
		<span class="cab" aria-hidden="true">
			<svg viewBox="0 0 100 100">
				<defs><linearGradient id="rrcab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb020"/><stop offset="1" stop-color="#ff5c2c"/></linearGradient></defs>
				<path d="M2 10 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 l6 -6 6 6 L98 90 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 l-6 6 -6 -6 Z" fill="url(#rrcab)"/>
				<rect x="12" y="20" width="76" height="8" rx="4" fill="#0a0c12"/>
				<rect x="12" y="34" width="76" height="8" rx="4" fill="#0a0c12"/>
				<rect x="12" y="48" width="48" height="8" rx="4" fill="#0a0c12"/>
				<g fill="#0a0c12"><rect x="12" y="62" width="7" height="23"/><rect x="25" y="62" width="5" height="23"/><rect x="36" y="62" width="9" height="23"/><rect x="51" y="62" width="5" height="23"/><rect x="62" y="62" width="9" height="23"/><rect x="77" y="62" width="7" height="23"/></g>
			</svg>
		</span>
		<span class="wordmark">Retro Receipts</span>
	</a>

	<nav class="tabs">
		{#each primary as t (t.id)}
			<a class="lnk" class:on={active(t.href)} class:soon={!t.live} href="{base}{t.href}">{t.label}</a>
		{/each}
		{#if more.length}
			<div class="moreWrap" class:open={moreOpen}>
				<button
					class="lnk more"
					class:on={moreActive}
					onclick={() => (moreOpen = !moreOpen)}
					aria-haspopup="menu"
					aria-expanded={moreOpen}
				>⋯ More</button>
				{#if moreOpen}
					<button class="scrim" aria-label="Close menu" onclick={() => (moreOpen = false)}></button>
					<div class="menu" role="menu">
						{#each more as t (t.id)}
							<a
								class="mrow"
								class:on={active(t.href)}
								class:soon={!t.live}
								href="{base}{t.href}"
								role="menuitem"
								onclick={() => (moreOpen = false)}
							>
								<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
									><path d={t.d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg
								>
								<span>{t.label}</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
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
		gap: 20px;
		padding: 10px 6px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		text-decoration: none;
		color: var(--ink);
		flex: none;
	}
	.cab {
		width: 28px;
		height: 28px;
		flex: none;
		display: grid;
		place-items: center;
	}
	.cab svg {
		width: 28px;
		height: 28px;
		filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35));
	}
	.wordmark {
		font-size: 15px;
		font-weight: 800;
		letter-spacing: 0.01em;
		color: var(--ink);
	}

	.tabs {
		display: flex;
		align-items: center;
		gap: 18px;
		flex: 1;
	}
	/* calm nav — plain text; only the active tab earns weight (a single gold tick, the one skew on the bar) */
	.lnk {
		position: relative;
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		color: var(--dim);
		text-decoration: none;
		background: none;
		border: none;
		padding: 6px 2px;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.15s;
	}
	.lnk:hover {
		color: var(--ink);
	}
	.lnk.on {
		color: var(--ink);
		font-style: italic;
	}
	.lnk.on::after {
		content: '';
		position: absolute;
		left: 0;
		right: 4px;
		bottom: 0;
		height: 2px;
		border-radius: 2px;
		background: var(--gold);
		transform: skewX(-12deg);
	}
	.lnk.soon {
		color: var(--faint);
		font-weight: 600;
	}
	.lnk.soon:hover {
		color: var(--dim);
	}

	.moreWrap {
		position: relative;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		border: none;
		background: transparent;
		cursor: default;
	}
	.menu {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		z-index: 50;
		min-width: 168px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
		padding: 6px;
		animation: pop 0.13s ease-out;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		border-radius: 9px;
		text-decoration: none;
		color: var(--dim);
		font-size: 13.5px;
		font-weight: 700;
	}
	.mrow:hover {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		color: var(--ink);
	}
	.mrow.on {
		color: var(--gold);
	}
	.mrow.soon {
		color: var(--faint);
	}

	.authslot {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}

	@media (max-width: 720px) {
		/* the bottom TabBar carries navigation on mobile; the top bar keeps brand + the status/account atoms */
		.bar {
			gap: 10px;
		}
		.tabs {
			display: none;
		}
	}
</style>
