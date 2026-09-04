<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { api } from '$lib/config';
	import MatchBanner from './MatchBanner.svelte';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { toResultRow, type FeedMode, type MatchResult } from '$lib/stores/matchfeed.svelte';
	import { gated, type ReplayAvail } from '$lib/replay/source';

	// ⌕ BROWSE MATCHES (LIVE-TAB-V2-SPEC §3) — a popup OVER the theatre, deliberately NOT a route: the theatre
	// stays mounted behind it, so picking a row is a content swap rather than a navigation. Desktop gets a centred
	// dialog; a phone gets a bottom sheet so the picture stays visible above it — you are choosing what to replace
	// it with, and you should be able to see what you are replacing.
	//
	// It reads the SAME endpoint the LIVE tab already uses, one un-scoped-per-scope fetch of the newest 100
	// (`routes.rs` clamps the limit to 100), and pages it 10 at a time client-side. There is deliberately no
	// search and no cursor: the feed has no offset (`app.rs`) and there is no player-search endpoint, so either
	// would mean inventing a contract. Both are §7 DEFERRED.

	// No `open` prop: the parent mounts this conditionally, so being alive IS being open. An `open` flag on top
	// of that is a second source of truth that can (and did) sit false while the popup is on screen.
	let {
		mode = 'ranked' as FeedMode,
		onClose,
		onPick
	}: {
		/** the scope the LIVE tab is currently showing — BROWSE opens on the same one */
		mode?: FeedMode;
		onClose: () => void;
		/** the picked row: the caller swaps the theatre, sets ?m= and scrolls (§3 "Picking a row") */
		onPick: (r: MatchResult) => void;
	} = $props();

	const MODES: { id: FeedMode; label: string; icon: string }[] = [
		{ id: 'ranked', label: 'Ranked', icon: '⚔' },
		{ id: 'lobby', label: 'Lobby', icon: '🎮' },
		{ id: 'tourney', label: 'Tournament', icon: '🏆' },
		{ id: 'money', label: 'Money', icon: '🪙' }
	];
	const PER_PAGE = 10;

	// SEEDED, not bound: BROWSE opens on whatever scope the LIVE tab is showing and then moves independently —
	// changing the scope in here must not reach back and re-filter the list behind the popup. `untrack` says
	// that on purpose rather than leaving it to look like a missed reactive dependency.
	let scope = $state<FeedMode>(untrack(() => mode));
	let replayableOnly = $state(false);
	let page = $state(0);
	let loading = $state(false);
	let cursor = $state(0);
	/** one fetch per scope, kept for the life of the popup */
	const cache = new Map<FeedMode, MatchResult[]>();
	let rows = $state<MatchResult[]>([]);

	async function loadScope(m: FeedMode) {
		const hit = cache.get(m);
		if (hit) {
			rows = hit;
			return;
		}
		loading = true;
		try {
			const res = await fetch(api(`/rr/matches/feed?mode=${m}&limit=100`), { headers: { accept: 'application/json' } });
			if (!res.ok) return;
			const snap = (await res.json()) as { results?: Parameters<typeof toResultRow>[0][] };
			const list = (Array.isArray(snap.results) ? snap.results : [])
				.map((d) => toResultRow(d))
				.filter((r): r is MatchResult => r != null);
			cache.set(m, list);
			rows = list;
			// skins on the rows: prime the loadouts the same way the LIVE list does
			void loadouts.prime(list.flatMap((r) => [r.winner, r.loser]));
		} catch {
			/* keep-last-good; the empty state below says so honestly */
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void loadScope(scope);
	});

	/** the row's availability comes off the row itself (P0) — BROWSE never probes, so 100 rows cost 0 requests */
	const availOf = (r: MatchResult): ReplayAvail | null => (r.replay ? gated(r.replay.state) : null);

	const shown = $derived(replayableOnly ? rows.filter((r) => r.replay?.state === 'ready') : rows);
	const pageCount = $derived(Math.max(1, Math.ceil(shown.length / PER_PAGE)));
	const pageRows = $derived(shown.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE));
	$effect(() => {
		if (page > pageCount - 1) page = pageCount - 1;
	});
	/**
	 * §3: the last page tells you where the list ends rather than implying there is more. The spec's line is
	 * "That's the newest 100." — but that sentence is only TRUE when the server actually returned 100 (its
	 * limit clamp). On a quieter scope it returned everything there is, and saying "the newest 100" would be
	 * a fabricated number. So the wording follows the data.
	 */
	const atEnd = $derived(page >= pageCount - 1 && rows.length > 0);
	const endText = $derived(rows.length >= 100 ? "That's the newest 100." : `That's all ${rows.length} of them.`);

	function setScope(m: FeedMode) {
		if (m === scope) return;
		scope = m;
		page = 0;
		cursor = 0;
	}

	// ── the dialog shell: history, scroll lock, focus ───────────────────────────────────────────────────────
	// pushState on open + history.back() on close, so the PHONE BACK GESTURE dismisses the sheet instead of
	// leaving the tab. Same pattern ReplayEmbed's pseudo-fullscreen already uses.
	let dlg = $state<HTMLDivElement | null>(null);
	let closeBtn = $state<HTMLButtonElement | null>(null);
	let listEl = $state<HTMLElement | null>(null);
	let pushed = false;

	onMount(() => {
		const prevFocus = document.activeElement as HTMLElement | null;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		history.pushState({ rrBrowse: true }, '');
		pushed = true;
		const onPop = () => {
			pushed = false; // the entry is already gone; closing must not pop a second one
			onClose();
		};
		window.addEventListener('popstate', onPop);
		void tick().then(() => closeBtn?.focus());
		return () => {
			window.removeEventListener('popstate', onPop);
			document.body.style.overflow = prevOverflow;
			if (pushed) history.back();
			prevFocus?.focus?.();
		};
	});

	function focusables(): HTMLElement[] {
		if (!dlg) return [];
		return Array.from(dlg.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(
			(el) => el.offsetParent !== null
		);
	}

	/** move the row cursor and take focus with it, so a screen reader announces the row it lands on */
	async function moveCursor(d: number) {
		const n = pageRows.length;
		if (!n) return;
		cursor = Math.max(0, Math.min(n - 1, cursor + d));
		await tick();
		listEl?.querySelectorAll<HTMLElement>('.brow .mb')[cursor]?.focus();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			void moveCursor(1);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			void moveCursor(-1);
			return;
		}
		if (e.key !== 'Tab') return;
		const f = focusables();
		if (!f.length) return;
		const first = f[0];
		const last = f[f.length - 1];
		const act = document.activeElement as HTMLElement | null;
		if (e.shiftKey && act === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && act === last) {
			e.preventDefault();
			first.focus();
		}
	}

	/**
	 * Picking is NOT the same as dismissing.
	 *
	 * Dismissing unwinds the history entry this popup pushed (that is what makes the phone back gesture close
	 * the sheet). Picking must NOT: the caller is about to `replaceState` `?m=<key>` onto the current entry,
	 * and popping it afterwards would throw that away — which is exactly what it did, silently, until the P3
	 * gate caught `?m=null`. So the pushed entry is handed over: it stops being "the popup is open" and becomes
	 * "this match is in the theatre", and one back press still returns to where the viewer was before browsing.
	 */
	function pick(r: MatchResult) {
		pushed = false;
		onPick(r);
	}

	const isRanked = (m?: string) => m === 'ranked';
</script>

<!-- backdrop closes only on a click landing on the overlay itself (not on the dialog within) -->
<div
	class="ovl"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	onkeydown={onKeydown}
>
	<div class="dlg" bind:this={dlg} role="dialog" aria-modal="true" aria-label="Browse matches" tabindex="-1">
		<div class="grip" aria-hidden="true"></div>
		<header class="hd">
			<h2>⌕ Browse matches</h2>
			<button type="button" class="x" bind:this={closeBtn} onclick={onClose} aria-label="Close">✕</button>
		</header>

		<div class="ctrls">
			<div class="scopes" role="tablist" aria-label="Match scope">
				{#each MODES as m (m.id)}
					<button class="scope" class:on={m.id === scope} role="tab" aria-selected={m.id === scope} title={m.label} onclick={() => setScope(m.id)}>
						<span class="sic" aria-hidden="true">{m.icon}</span><span class="slbl">{m.label}</span>
					</button>
				{/each}
			</div>
			<!-- free, client-side: `replay.state` is already on every row (P0), so this filters without a request -->
			<label class="only"><input type="checkbox" bind:checked={replayableOnly} onchange={() => (page = 0)} /><span>Replayable only</span></label>
		</div>

		<div class="list" bind:this={listEl}>
			{#if loading && !rows.length}
				<p class="note">Looking through the tapes…</p>
			{:else if !shown.length}
				<p class="note">{replayableOnly ? 'No replayable matches in this scope yet.' : 'No matches in this scope yet.'}</p>
			{:else}
				{#each pageRows as r (r.key)}
					{@const ranked = isRanked(r.mode)}
					<div class="brow">
						<MatchBanner
							a={{ steamid: r.winner, name: r.winner_name, rating: ranked ? (r.winner_rating ?? null) : null, team: r.winner_team ?? null }}
							b={{ steamid: r.loser, name: r.loser_name, rating: ranked ? (r.loser_rating ?? null) : null, team: r.loser_team ?? null }}
							winner="a"
							mode={r.mode ?? ''}
							ts={r.ts}
							delta={ranked && r.elo ? r.elo : null}
							dur={r.duration_s ?? null}
							ocv={r.ocv ?? false}
							perfect={r.perfect ?? false}
							comeback={r.comeback ?? false}
							verified={r.verified}
							replay={availOf(r)}
							onOpen={() => pick(r)}
						/>
					</div>
				{/each}
			{/if}
		</div>

		<nav class="pager" aria-label="Browse pages">
			<button class="pg" disabled={page === 0} onclick={() => (page = Math.max(0, page - 1))}>‹ Prev</button>
			<span class="cnt">{shown.length ? `${page * PER_PAGE + 1}–${Math.min(shown.length, (page + 1) * PER_PAGE)} of ${shown.length}` : '—'}</span>
			<button class="pg" disabled={page >= pageCount - 1} onclick={() => (page = Math.min(pageCount - 1, page + 1))}>Next ›</button>
		</nav>
		{#if atEnd}<p class="end">{endText}</p>{/if}
	</div>
</div>

<style>
	.ovl {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: color-mix(in srgb, #000 68%, transparent);
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.dlg {
		width: min(1040px, 92vw);
		height: min(78vh, 760px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		outline: none;
	}
	.grip {
		display: none;
	}
	.hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--line);
	}
	.hd h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink);
	}
	.x {
		font: inherit;
		font-size: 15px;
		line-height: 1;
		color: var(--dim);
		background: none;
		border: 1px solid var(--line);
		border-radius: 8px;
		width: 32px;
		height: 32px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ink);
	}
	.ctrls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
	}
	.scopes {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.scope {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--dim);
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		cursor: pointer;
	}
	.scope.on {
		color: var(--ink);
		border-color: color-mix(in srgb, var(--gold) 45%, var(--line));
	}
	.only {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--dim);
		cursor: pointer;
	}
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 8px 14px;
	}
	.brow {
		margin-bottom: 6px;
	}
	.note {
		margin: 18px 0;
		text-align: center;
		font-size: 13px;
		color: var(--dim);
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 14px;
		border-top: 1px solid var(--line);
	}
	.pg {
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		color: var(--dim);
		padding: 7px 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		cursor: pointer;
	}
	.pg:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.pager .cnt {
		font-size: 11px;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.end {
		margin: 0;
		padding: 0 14px 10px;
		text-align: center;
		font-size: 11px;
		color: var(--faint);
	}

	/* PHONE: a bottom sheet, so the picture stays visible above it — you are choosing what to replace it with */
	@media (max-width: 720px) {
		.ovl {
			place-items: end stretch;
			padding: 0;
		}
		.dlg {
			width: 100%;
			height: 88dvh;
			border-radius: 14px 14px 0 0;
			border-bottom: 0;
		}
		.grip {
			display: block;
			width: 36px;
			height: 4px;
			margin: 8px auto 0;
			border-radius: 2px;
			background: var(--line);
		}
		/* a row is a touch target before it is a layout element */
		.brow :global(.mb) {
			min-height: 56px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ovl,
		.dlg {
			animation: none;
		}
	}
</style>
