<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { api } from '$lib/config';
	import { copyText, COPIED_MS } from '$lib/share';
	import MatchReceipt from '$lib/components/MatchReceipt.svelte';
	import type { MatchReceiptData } from '$lib/components/MatchReceipt.svelte';

	// 🧾 /r/<wager_id> — the shareable per-match receipt. Public + read-only: no token, so a link works for
	// anyone the players send it to. That is the whole point of the receipt as a shareable object.
	const id = $derived(page.params.id ?? '');

	let data = $state<MatchReceiptData | null>(null);
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
				const res = await fetch(api(`/rr/receipt?id=${encodeURIComponent(want)}`));
				if (res.status === 404) throw new Error('No receipt with that number.');
				if (!res.ok) throw new Error(`Server returned ${res.status}.`);
				const j = await res.json();
				if (j?.ok === false) throw new Error('No receipt with that number.');
				if (loadedId === want) data = j as MatchReceiptData;
			} catch (e) {
				if (loadedId === want) error = e instanceof Error ? e.message : 'Could not load that receipt.';
			} finally {
				if (loadedId === want) loading = false;
			}
		})();
	});

	let copied = $state(false);
	async function copyLink() {
		// this page's own URL is already in the address bar, so a refusal here genuinely does leave the user a
		// way to get the link — no reveal needed, but the timing still matches every other surface
		if (await copyText(location.href)) {
			copied = true;
			setTimeout(() => (copied = false), COPIED_MS);
		}
	}
</script>

<svelte:head><title>{data?.code ? `Receipt ${data.code}` : 'Receipt'} · Retro Receipts</title></svelte:head>

<div class="page">
	{#if loading}
		<p class="note">Printing…</p>
	{:else if error}
		<div class="err">
			<p>{error}</p>
			<a class="back" href="{base}/match">← Back to the arcade</a>
		</div>
	{:else if data}
		<MatchReceipt r={data} />
		<div class="acts">
			<button type="button" class="act" onclick={copyLink}>{copied ? '✓ Link copied' : 'Copy link'}</button>
			<a class="act ghost" href="{base}/r/session/{data.winner ?? ''}">Session tab →</a>
		</div>
	{/if}
</div>

<style>
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
	.acts {
		display: flex;
		gap: 10px;
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
		text-decoration: none;
	}
	.act:hover {
		border-color: var(--gold);
		color: var(--gold);
	}
	.act.ghost {
		color: var(--dim);
	}
</style>
