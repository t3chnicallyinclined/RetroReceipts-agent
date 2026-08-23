<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { api } from '$lib/config';
	import SessionReceipt from '$lib/components/SessionReceipt.svelte';
	import type { SessionReceiptData } from '$lib/components/SessionReceipt.svelte';

	// 🧾 /r/session/<steamid> — "close out your tab". Public + read-only like the match receipt, so a tab is
	// shareable too. `since` narrows the window; default is the server's own (all-time).
	const sid = $derived(page.params.steamid ?? '');

	const WINDOWS = [
		{ id: 'all', label: 'All time', ms: 0 },
		{ id: 'today', label: 'Today', ms: 24 * 60 * 60 * 1000 },
		{ id: 'week', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 }
	] as const;
	let win = $state<(typeof WINDOWS)[number]['id']>('all');

	let data = $state<SessionReceiptData | null>(null);
	let error = $state('');
	let loading = $state(true);

	let loadedKey = '';
	$effect(() => {
		const key = `${sid}|${win}`;
		if (!sid || key === loadedKey) return;
		loadedKey = key;
		loading = true;
		error = '';
		void (async () => {
			try {
				const w = WINDOWS.find((x) => x.id === win)!;
				// since_ms is computed at request time on purpose — a tab is "the last N hours from now",
				// not a fixed instant captured at mount.
				const since = w.ms ? `&since_ms=${Date.now() - w.ms}` : '';
				const res = await fetch(api(`/rr/receipt/session?steamid=${encodeURIComponent(sid)}${since}`));
				if (!res.ok) throw new Error(`Server returned ${res.status}.`);
				const j = await res.json();
				if (j?.ok === false) throw new Error('No tab for that player.');
				if (loadedKey === key) data = j as SessionReceiptData;
			} catch (e) {
				if (loadedKey === key) error = e instanceof Error ? e.message : 'Could not load that tab.';
			} finally {
				if (loadedKey === key) loading = false;
			}
		})();
	});
</script>

<svelte:head><title>{data?.name ? `${data.name}'s tab` : 'Session tab'} · Retro Receipts</title></svelte:head>

<div class="page">
	<div class="wins" role="group" aria-label="Tab window">
		{#each WINDOWS as w (w.id)}
			<button type="button" class="w" class:on={win === w.id} onclick={() => (win = w.id)}>{w.label}</button>
		{/each}
	</div>

	{#if loading && !data}
		<p class="note">Printing…</p>
	{:else if error}
		<div class="err">
			<p>{error}</p>
			<a class="back" href="{base}/match">← Back to the arcade</a>
		</div>
	{:else if data}
		<SessionReceipt r={data} />
		<a class="act ghost" href="{base}/u/{sid}">Full profile →</a>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 18px 0 40px;
	}
	.wins {
		display: flex;
		gap: 6px;
	}
	.w {
		font: inherit;
		font-size: 11.5px;
		font-weight: 700;
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--dim);
		cursor: pointer;
	}
	.w.on {
		border-color: var(--gold);
		color: var(--gold);
		background: color-mix(in srgb, var(--gold) 10%, transparent);
	}
	.note,
	.err {
		color: var(--dim);
		font-size: 13px;
		text-align: center;
	}
	.err .back,
	.act.ghost {
		color: var(--gold);
		text-decoration: none;
		font-size: 12px;
	}
	.act.ghost {
		color: var(--dim);
	}
	.act.ghost:hover {
		color: var(--gold);
	}
</style>
