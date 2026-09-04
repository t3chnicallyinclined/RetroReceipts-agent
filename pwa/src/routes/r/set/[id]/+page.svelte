<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { api } from '$lib/config';
	import { auth } from '$lib/stores/auth.svelte';
	import SetReceipt from '$lib/components/SetReceipt.svelte';
	import type { SetReceiptData } from '$lib/components/SetReceipt.svelte';
	import ReportModal from '$lib/components/ReportModal.svelte';
	import { shortSetLink, copyText, COPIED_MS } from '$lib/share';

	// 🧾 /r/set/<session_id> — the RANKED counterpart to /r/<wager_id>. Public + read-only so a set is
	// shareable to anyone, same as the money slip. Reads the same /rr/session?id= payload SessionModal uses,
	// so it needs nothing new from the server.
	const id = $derived(page.params.id ?? '');

	// ⚠ WHOSE SEAT THE SLIP IS READ FROM, pinned in the URL — this is the difference between sharing YOUR
	// receipt and sharing your opponent's. Without it `me` fell back to auth.steamid, so the author saw
	// "2-8, net -3, my wins highlighted" and every logged-out stranger who opened the same link saw the
	// OPPONENT's receipt: their 8-2, their +3, their W chips. You'd post your underdog run and the internet
	// would receive the other guy's victory lap.
	// Precedence: ?p= (baked in by Copy link) → the signed-in viewer → null (component falls back to winner).
	const perspective = $derived(page.url.searchParams.get('p') || auth.steamid || null);

	let data = $state<SetReceiptData | null>(null);
	let error = $state('');
	let loading = $state(true);

	let loadedId = '';
	$effect(() => {
		const want = id;
		if (!want || want === loadedId) return;
		loadedId = want;
		loading = true;
		error = '';
		data = null;
		void (async () => {
			try {
				const res = await fetch(api(`/rr/session?id=${encodeURIComponent(want)}`));
				if (res.status === 404) throw new Error('No set with that id.');
				if (!res.ok) throw new Error(`Server returned ${res.status}.`);
				const j = await res.json();
				if (j?.ok === false || !(j?.games?.length || j?.players?.length)) throw new Error('No set with that id.');
				if (loadedId === want) data = j as SetReceiptData;
			} catch (e) {
				if (loadedId === want) error = e instanceof Error ? e.message : 'Could not load that set.';
			} finally {
				if (loadedId === want) loading = false;
			}
		})();
	});

	let copied = $state(false);
	let repOpen = $state(false);
	let copyFallback = $state('');
	async function copyLink() {
		// SHORT form (nobd.net/s/<tail>) — clean, identical to the address-bar link (no seat param).
		const url = shortSetLink(id);
		if (await copyText(url)) {
			copyFallback = '';
			copied = true;
			setTimeout(() => (copied = false), COPIED_MS);
		} else {
			copyFallback = url;
		}
	}
</script>

<svelte:head><title>Set receipt · Retro Receipts</title></svelte:head>

<div class="page">
	{#if loading}
		<p class="note">Printing…</p>
	{:else if error}
		<div class="err">
			<p>{error}</p>
			<a class="back" href="{base}/match">← Back to the arcade</a>
		</div>
	{:else if data}
		<SetReceipt r={data} me={perspective} />
		{@const opp = auth.steamid && (data.players ?? []).some((pl) => pl.steamid === auth.steamid)
			? (data.players ?? []).find((pl) => pl.steamid !== auth.steamid)
			: null}
		<div class="actrow">
			<button type="button" class="act" onclick={copyLink}>{copied ? '✓ Link copied' : 'Copy link'}</button>
			{#if copyFallback}
				<!-- the clipboard refused: show the link so it can still be selected by hand (§5) -->
				<input class="cfb" readonly value={copyFallback} aria-label="Share link — copy it manually" onfocus={(e) => e.currentTarget.select()} />
			{/if}
			{#if opp}
				<!-- report lives ON the receipt — you report the player you just faced (the server enforces
				     the recent-match rule anyway; this surface makes the honest path the obvious one) -->
				<button type="button" class="act" onclick={() => (repOpen = true)}>⚑ Report {opp.name || 'opponent'}</button>
			{/if}
		</div>
		{#if opp}<ReportModal target={opp.steamid} name={opp.name || 'opponent'} bind:open={repOpen} />{/if}
	{/if}
</div>

<style>
	.cfb {
		display: block;
		width: 100%;
		margin-top: 8px;
		font: inherit;
		font-size: 12px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid color-mix(in srgb, var(--gold) 35%, var(--line));
		border-radius: 8px;
		padding: 7px 10px;
	}
	.page {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		padding: 22px 0 40px;
	}
	.note,
	.err {
		color: var(--dim);
		font-size: 13px;
		text-align: center;
	}
	.err .back {
		display: inline-block;
		margin-top: 8px;
		color: var(--gold);
		text-decoration: none;
	}
	.actrow {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
		justify-content: center;
	}
	.act {
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		padding: 7px 14px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
		cursor: pointer;
	}
	.act:hover {
		border-color: var(--gold);
		color: var(--gold);
	}
</style>
