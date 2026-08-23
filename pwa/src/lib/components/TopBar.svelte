<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { NAV } from '$lib/nav';
	import WalletChip from './WalletChip.svelte';
	import ResultCheckBell from './ResultCheckBell.svelte';
	import AccountMenu from './AccountMenu.svelte';

	// The single global arena bar. Desktop: brand cab + calm text nav (the active tab is the ONLY skew + the
	// only nav gold — a thin tick), then the status/account atoms. Nav is the competitive core only
	// (Match · Ranks · Tournament); Skins lives in the account menu, Fleet is folded into Match. Mobile:
	// brand + atoms; the bottom TabBar carries nav. Quiet by design — gold is spent only on the active tab
	// tick + the wallet, so the molten challenge strip is the one loud thing when it fires.
	const path = $derived(page.url.pathname);
	function active(href: string): boolean {
		const full = base + href;
		if (href === '/ranks') return path === base + '/' || path.startsWith(full);
		return path.startsWith(full);
	}
</script>

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
		{#each NAV as t (t.id)}
			<a class="lnk" class:on={active(t.href)} class:soon={!t.live} href="{base}{t.href}">{t.label}</a>
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
		font-size: 13px;
		font-weight: 700;
		color: var(--dim);
		text-decoration: none;
		padding: 6px 2px;
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
