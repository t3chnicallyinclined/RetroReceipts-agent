<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { api } from '$lib/config';
	import { auth } from '$lib/stores/auth.svelte';
	import SetReceipt from '$lib/components/SetReceipt.svelte';
	import type { SetReceiptData } from '$lib/components/SetReceipt.svelte';
	import { shortSetLink } from '$lib/share';

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
	async function copyLink() {
		try {
			// SHORT form (nobd.net/s/<tail>), seat baked in so the recipient sees the slip the SHARER sees.
			await navigator.clipboard.writeText(shortSetLink(id, perspective));
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard blocked — the URL bar still has it */
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
		<button type="button" class="act" onclick={copyLink}>{copied ? '✓ Link copied' : 'Copy link'}</button>
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
