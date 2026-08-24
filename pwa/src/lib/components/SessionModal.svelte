<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { base } from '$app/paths';
	import { api } from '$lib/config';
	import { auth } from '$lib/stores/auth.svelte';
	import SetReceipt from './SetReceipt.svelte';
	import type { SetReceiptData } from './SetReceipt.svelte';

	// The SET modal — an overlay around THE TAPE (SetReceipt). Opened with a session_id from a result OR a
	// Now Playing card. This component owns ONLY the modal mechanics: fetch + live re-poll, focus trap,
	// scroll lock, close. The set itself renders through SetReceipt — the SAME component the share page
	// mounts — so the modal and the receipt are one thing and can never drift apart (merged 2026-08-24;
	// this file previously carried its own 700-line game-by-game rendering of the same payload).
	let {
		sessionId,
		onClose,
		live = false // on when the open set belongs to a Now Playing pair → silent live polling below.
	}: { sessionId: string; onClose: () => void; live?: boolean } = $props();

	const LIVE_POLL_MS = 5000; // silent refresh cadence while a live set is open

	let loading = $state(false);
	let error = $state<string | null>(null);
	let data = $state<SetReceiptData | null>(null);
	let reqId = 0;

	// Fetch the set. `silent` (a live re-poll) keeps the current view on screen — no spinner, no data
	// clear, and a transient failure keeps last-good rather than flashing an error over live content.
	async function fetchSession(silent: boolean): Promise<void> {
		const id = sessionId;
		if (!id) return;
		const myReq = ++reqId;
		if (!silent) {
			loading = true;
			error = null;
			data = null;
		}
		try {
			const res = await fetch(api(`/rr/session?id=${encodeURIComponent(id)}`), {
				headers: { accept: 'application/json' }
			});
			if (!res.ok) throw new Error(`session ${res.status}`);
			const j = (await res.json()) as SetReceiptData & { ok?: boolean };
			if (myReq !== reqId) return;
			if (!j || j.ok === false) throw new Error('That set could not be found.');
			data = j;
			error = null;
		} catch (e: unknown) {
			if (myReq !== reqId) return;
			if (!silent) error = e instanceof Error ? e.message : 'error'; // silent poll: keep last-good
		} finally {
			if (myReq === reqId && !silent) loading = false;
		}
	}

	// ── full fetch on open (and whenever the id changes) ──
	$effect(() => {
		void sessionId; // track the id so a change re-fetches
		void fetchSession(false);
	});

	// ── live: silently re-poll while the set is in progress; cleaned up when it closes or live turns off ──
	$effect(() => {
		if (!live) return;
		const iv = setInterval(() => void fetchSession(true), LIVE_POLL_MS);
		return () => clearInterval(iv);
	});

	// ── focus management + body scroll lock (mount → move focus in, cleanup → restore) ──
	let dlg = $state<HTMLDivElement | null>(null);
	let closeBtn = $state<HTMLButtonElement | null>(null);
	onMount(() => {
		const prev = document.activeElement as HTMLElement | null;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		void tick().then(() => closeBtn?.focus());
		return () => {
			document.body.style.overflow = prevOverflow;
			prev?.focus?.();
		};
	});

	function focusables(): HTMLElement[] {
		if (!dlg) return [];
		return Array.from(
			dlg.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((el) => el.offsetParent !== null);
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
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
	<div
		class="dlg"
		bind:this={dlg}
		role="dialog"
		aria-modal="true"
		aria-label="Set details"
		tabindex="-1"
	>
		<button type="button" class="x" bind:this={closeBtn} onclick={onClose} aria-label="Close">✕</button>

		{#if loading}
			<p class="note">Printing…</p>
		{:else if error}
			<p class="note err">{error}</p>
		{:else if data}
			<!-- the viewer reads the tape from THEIR seat, exactly like the share page -->
			<SetReceipt r={data} me={auth.steamid ?? null} {live} />
			<a class="open" href="{base}/r/set/{encodeURIComponent(sessionId)}">Open receipt page →</a>
		{/if}
	</div>
</div>

<style>
	.ovl {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 26px 12px 40px;
		overflow-y: auto;
		background: color-mix(in srgb, var(--bg) 78%, transparent);
		backdrop-filter: blur(3px);
	}
	.dlg {
		position: relative;
		width: min(100%, 600px);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		outline: none;
	}
	.x {
		position: absolute;
		top: -8px;
		right: -4px;
		z-index: 2;
		font: inherit;
		font-size: 13px;
		line-height: 1;
		width: 28px;
		height: 28px;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 8px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ink);
		border-color: var(--gold);
	}
	.note {
		color: var(--dim);
		font-size: 13px;
		text-align: center;
		padding: 30px 0;
	}
	.note.err {
		color: var(--loss);
	}
	.open {
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--dim);
		text-decoration: none;
		padding: 6px 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
	}
	.open:hover {
		color: var(--gold);
		border-color: var(--gold);
	}
</style>
