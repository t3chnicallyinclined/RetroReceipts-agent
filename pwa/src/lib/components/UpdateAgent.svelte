<script lang="ts">
	import { agent } from '$lib/stores/agent.svelte';
	import { api } from '$lib/config';

	// 🔔 "Your desktop app is outdated" banner. Shows only when an agent IS reporting for the signed-in
	// user AND the server says its build is behind (`update_available`, computed against LATEST_AGENT_VER).
	// Two intensities:
	//   • URGENT (red) — 0.1.x / 0.2.x: the legacy MetaSync generation. Its self-updater only offers what
	//     the legacy manifest advertises, so these users stay stuck until they act (or until the 0.2.7
	//     migration release lands). No dismiss: being a generation behind breaks receipts/money/skins.
	//   • NORMAL (gold) — an out-of-date rr-agent. Those self-update within the hour; the banner mentions
	//     that and offers the manual grab for the builds whose updater was broken (0.3.8-era dir move).
	// The download link resolves from the SAME manifest the tray self-updater reads (DownloadAgent's
	// pattern) so a renamed release asset never strands this button.
	const WIN_URL_FALLBACK =
		'https://github.com/t3chnicallyinclined/RetroReceipts-agent/releases/latest/download/rr-agent.exe';
	let winUrl = $state(WIN_URL_FALLBACK);
	async function resolveWinUrl() {
		try {
			const res = await fetch(api('/rr/update/agent-latest.json'), { cache: 'no-store' });
			if (!res.ok) return;
			const url = (await res.json())?.url;
			if (typeof url === 'string' && url.startsWith('https://')) winUrl = url;
		} catch {
			/* fallback already works */
		}
	}

	const show = $derived(agent.reporting && agent.status?.update_available === true);
	const ver = $derived(agent.status?.ver ?? '');
	const latest = $derived(agent.status?.latest ?? '');
	const legacy = $derived(ver.startsWith('0.1.') || ver.startsWith('0.2.'));
	$effect(() => {
		if (show) void resolveWinUrl();
	});
</script>

{#if show}
	<div class="upd" class:urgent={legacy}>
		{#if legacy}
			<span class="txt"
				><b>Your desktop app is a generation behind (v{ver}).</b> MetaSync became RETRO RECEIPTS —
				money matches, receipts and skins need the new app. Install it, then MetaSync can be
				uninstalled.</span
			>
		{:else}
			<span class="txt"
				><b>Agent update available</b> — v{latest} (you're on v{ver}). It normally installs itself
				within the hour; if yours hasn't, grab it here.</span
			>
		{/if}
		<a class="get" href={winUrl}>⬇ GET v{latest || 'LATEST'}</a>
	</div>
{/if}

<style>
	.upd {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 8px 0;
		padding: 10px 13px;
		border: 1px solid color-mix(in srgb, var(--gold) 50%, var(--line));
		border-radius: 11px;
		background: var(--gold-soft);
	}
	.upd.urgent {
		border-color: color-mix(in srgb, var(--bad, #c33) 55%, var(--line));
		background: color-mix(in srgb, var(--bad, #c33) 9%, var(--panel));
	}
	.txt {
		font-size: 12.5px;
		color: var(--dim);
		min-width: 0;
	}
	.txt b {
		color: var(--ink);
	}
	.get {
		font-size: 11.5px;
		font-weight: 800;
		white-space: nowrap;
		text-decoration: none;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-radius: 999px;
		padding: 7px 13px;
	}
</style>
