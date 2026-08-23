<script lang="ts">
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { wallet } from '$lib/stores/wallet.svelte';

	// 🪙 balance chip — pure render of the app-wide quarters balance. The wallet lifecycle (load / live / pause)
	// is owned centrally by AppLive in +layout, so this chip can appear or disappear per breakpoint without
	// killing the subscription. Links to Settings, where the full ledger lives.
	const show = $derived(auth.authed && wallet.balance != null);
</script>

{#if show}
	<a class="coin" href="{base}/settings" title="Your quarters — tap for your wallet">
		<span class="ic" aria-hidden="true">🪙</span>
		<span class="n">{wallet.balance}</span>
	</a>
{/if}

<style>
	.coin {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border: 1px solid color-mix(in srgb, var(--gold) 30%, var(--line));
		border-radius: 999px;
		background: var(--gold-soft);
		color: var(--gold);
		text-decoration: none;
		font-weight: 800;
		flex: none;
		min-height: 28px;
	}
	.coin:hover {
		border-color: var(--gold);
	}
	.ic {
		font-size: 12px;
		line-height: 1;
	}
	.n {
		font-size: 12.5px;
		font-variant-numeric: tabular-nums;
	}
</style>
