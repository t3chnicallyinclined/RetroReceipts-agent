<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { availability, gated, requestReplay, type ReplayAvail, type RowLike } from '$lib/replay/source';
	import { replayViewer } from '$lib/replay/viewer.svelte';
	import type { ReplayMeta } from './ReplayEmbed.svelte';

	// ▶ REPLAYAFFORDANCE — THE one way a replay's availability shows, everywhere a match or game row is
	// rendered (LIVE results, the set view's per-game rows, the share pages, profile history, receipts).
	// States: ▶ REPLAY (ready — loud, --stream) · ⏳ TAPE INCOMING (pending) · 📼 REQUEST REPLAY (archived — one
	// click pulls the tape from R2, then pending) · — (none). No sign-in state: a ready tape shows ▶ REPLAY to
	// everyone (Tris 2026-09-04); only the archive PULL still needs an account (it writes on the server).
	// Give it either a resolved `state` or a `row` (it resolves availability itself, cached in source.ts).
	// `as="span"` = decoration inside a row that is itself a <button> (the row's click opens the replay);
	// `as="button"` = standalone: clicking a ready one opens the app-wide ReplaySheet with `meta`.
	let {
		state: avail = null,
		row = null,
		meta = null,
		as = 'button',
		size = 'chip',
		onwatch = null
	}: {
		state?: ReplayAvail | null;
		row?: RowLike | null;
		/** chrome for the sheet (names, teams, ts…) — required for the default open; ignored with `onwatch` */
		meta?: ReplayMeta | null;
		as?: 'span' | 'button';
		size?: 'chip' | 'wide';
		/** override the ready click (e.g. expand in place) */
		onwatch?: (() => void) | null;
	} = $props();

	let resolved = $state<ReplayAvail | null>(null);
	let busy = $state(false);
	let note = $state('');
	let overridden = $state<ReplayAvail | null>(null); // after a successful REQUEST: pending, whatever the prop says
	let askedFor = '';
	$effect(() => {
		if (avail != null || !row) return;
		const key = `${row.match_key ?? ''}|${row.session_id ?? ''}|${row.ts}`;
		if (key === askedFor) return;
		askedFor = key;
		resolved = null;
		void availability(row).then((a) => {
			if (askedFor === key) resolved = a;
		});
	});
	// re-gate when the viewer signs in/out (auth.authed is reactive)
	const shown = $derived.by(() => {
		void auth.authed;
		const a = overridden ?? avail ?? resolved;
		return a ? gated(a) : null;
	});

	const LABEL: Record<ReplayAvail, string> = {
		ready: '▶ REPLAY',
		saved: '▶ REPLAY',
		pending: '⏳ TAPE INCOMING',
		archived: '📼 REQUEST REPLAY',
		none: '—',
		expired: '—'
	};
	const TITLE: Record<ReplayAvail, string> = {
		ready: 'Watch the replay',
		saved: 'Watch the replay (saved)',
		pending: 'Tape not in yet — the agent uploads it after the set',
		archived: 'In the archives — one click pulls it back',
		none: 'No tape for this one',
		expired: 'Tape gone'
	};

	async function click(e: MouseEvent) {
		e.stopPropagation();
		const s = shown;
		if (!s || busy) return;
		if (s === 'archived') {
			if (!row?.match_key) return;
			busy = true;
			const r = await requestReplay(row.match_key);
			busy = false;
			if (r.ok) overridden = 'pending';
			else note = r.error === 'signin' ? 'sign in first' : 'could not request — try again';
			return;
		}
		if (s === 'ready' || s === 'saved') {
			if (onwatch) return onwatch();
			if (row && meta) replayViewer.open({ row, meta });
		}
	}
</script>

{#if shown}
	{#if as === 'span' || shown === 'none' || shown === 'expired'}
		<span class="ra {shown} {size}" title={TITLE[shown]} aria-hidden={shown === 'none' || shown === 'expired' ? 'true' : undefined}>{LABEL[shown]}</span>
	{:else}
		<button type="button" class="ra {shown} {size}" class:busy title={note || TITLE[shown]} aria-label={LABEL[shown].replace(/^\S+\s/, '')} onclick={click} disabled={busy}>
			{busy ? '…' : LABEL[shown]}
		</button>
	{/if}
{/if}

<style>
	.ra {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		white-space: nowrap;
		padding: 2px 7px;
		border-radius: 6px;
		border: 1px solid var(--line);
		color: var(--faint);
		background: transparent;
		line-height: 1.5;
		cursor: default;
	}
	.ra.wide {
		font-size: 10.5px;
		padding: 5px 11px;
	}
	button.ra {
		cursor: pointer;
	}
	button.ra:disabled {
		cursor: default;
	}
	button.ra:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
	/* READY — loud: --stream marks replay availability (charter amendment, LIVE-TAB-SPEC §13.3) */
	.ra.ready,
	.ra.saved {
		color: #fff;
		background: color-mix(in srgb, var(--stream) 78%, #000);
		border-color: var(--stream);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--stream) 35%, transparent);
	}
	button.ra.ready:hover,
	button.ra.saved:hover {
		background: var(--stream);
	}
	.ra.pending {
		color: var(--dim);
		border-color: color-mix(in srgb, var(--stream) 30%, var(--line));
	}
	.ra.archived {
		color: var(--stream);
		border-color: color-mix(in srgb, var(--stream) 55%, var(--line));
		background: color-mix(in srgb, var(--stream) 10%, transparent);
	}
	button.ra.archived:hover {
		background: color-mix(in srgb, var(--stream) 22%, transparent);
	}
	.ra.none,
	.ra.expired {
		border: 0;
		padding: 0;
		color: var(--faint);
	}
</style>
