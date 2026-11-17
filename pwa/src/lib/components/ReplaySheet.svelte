<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { replayViewer } from '$lib/replay/viewer.svelte';
	import { resolveSource, type ReplaySource } from '$lib/replay/source';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { api } from '$lib/config';
	import { onNavigate } from '$app/navigation';
	import ReplayEmbed from './ReplayEmbed.svelte';

	// ▶ REPLAYSHEET — the app-wide replay overlay: one instance in +layout, opened by any ReplayAffordance that
	// lives outside an in-place-expanding list (the set view's game rows, share pages, profile history,
	// receipts). Owns only the sheet mechanics (resolve → embed, Esc/backdrop close, scroll lock); the picture
	// is ReplayEmbed, the same component the LIVE tab expands inline. Sits above SessionModal (z 90).
	// Dialog behaviour: focus moves in and is TRAPPED (Tab cycles inside), Escape and the close button close it, focus
	// returns to the link that opened it, the page behind cannot scroll, phones get a full-screen sheet and desktops a
	// large centred player. Closing unmounts the embed, which disposes its worker and GPU buffers (the one WebGPU device
	// is shared and kept). A request with a `hash` is a finale link: Back closes the sheet.
	const req = $derived(replayViewer.current);
	let source = $state<ReplaySource | null>(null);
	let dlg = $state<HTMLDivElement | null>(null);
	let prevOverflow = '';
	let prevFocus: HTMLElement | null = null;

	$effect(() => {
		const r = req;
		source = null;
		if (!r) return;
		let live = true;
		void (async () => {
			// both seats' loadouts in one batch read before the embed opens (the embed primes again; this dedups)
			await loadouts.prime([r.meta.p1, r.meta.p2, r.meta.a.steamid, r.meta.b.steamid]);
			const src = await resolveSource(r.row);
			if (live) source = src;
			await tick();
			dlg?.focus();
		})();
		return () => {
			live = false;
		};
	});

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!replayViewer.current) return;
			if (e.key === 'Escape' && !document.fullscreenElement) {
				e.preventDefault();
				replayViewer.close();
			} else if (e.key === 'Tab' && dlg) trapTab(e, dlg);
		};
		const onPop = () => replayViewer.onPop(location.hash);
		document.addEventListener('keydown', onKey);
		window.addEventListener('popstate', onPop);
		return () => {
			document.removeEventListener('keydown', onKey);
			window.removeEventListener('popstate', onPop);
		};
	});
	$effect(() => {
		if (req) {
			prevFocus = document.activeElement as HTMLElement | null;
			prevOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prevOverflow;
				prevFocus?.focus?.();
			};
		}
	});
	// leaving the page (the full-set link, any navigation) closes the sheet
	onNavigate(() => {
		if (replayViewer.current) replayViewer.dismiss();
	});

	const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
	/** Tab and Shift+Tab stay inside the dialog; the embed's own controls come and go, so the list is read each time */
	function trapTab(e: KeyboardEvent, root: HTMLElement) {
		const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
		if (!items.length) {
			e.preventDefault();
			root.focus();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const at = document.activeElement as HTMLElement | null;
		if (e.shiftKey && (at === first || at === root || !root.contains(at))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (at === last || !root.contains(at))) {
			e.preventDefault();
			first.focus();
		}
	}
	const poster = $derived(req?.meta.sessionId ? api(`/rr/ogimg/${encodeURIComponent(req.meta.sessionId)}.png`) : '');
</script>

{#if req}
	<!-- backdrop closes only on a click landing on the overlay itself -->
	<div
		class="ovl"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) replayViewer.close();
		}}
	>
		<div class="dlg" bind:this={dlg} role="dialog" aria-modal="true" aria-label="Replay: {req.meta.a.name || 'Player'} vs {req.meta.b.name || 'Player'}" tabindex="-1">
			<button type="button" class="x" onclick={() => replayViewer.close()} aria-label="Close">✕</button>
			{#if source}
				<ReplayEmbed {source} {poster} meta={req.meta} autoart={!!req.autoart} />
			{:else}
				<div class="resolving"><span class="rail">Finding the tape</span></div>
			{/if}
			{#if req.fullSet}<a class="full" href={req.fullSet}>Open the full set</a>{/if}
		</div>
	</div>
{/if}

<style>
	.ovl {
		position: fixed;
		inset: 0;
		z-index: 95;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 26px 12px 40px;
		overflow-y: auto;
		background: color-mix(in srgb, var(--bg) 80%, transparent);
		backdrop-filter: blur(3px);
	}
	.dlg {
		position: relative;
		width: min(100%, 680px);
		outline: none;
	}
	.full {
		display: inline-block;
		margin-top: 10px;
		font-size: 13px;
		color: var(--ink);
		text-underline-offset: 2px;
	}
	.full:focus-visible,
	.x:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
	/* desktop: a large centred player */
	@media (min-width: 900px) {
		.ovl {
			align-items: center;
		}
		.dlg {
			width: min(100%, 860px);
		}
	}
	.x {
		position: absolute;
		top: -10px;
		right: -6px;
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
	.resolving {
		aspect-ratio: 4 / 3;
		display: grid;
		place-items: center;
		background: var(--board);
		border: 1px solid color-mix(in srgb, var(--stream) 30%, var(--line));
		border-radius: 12px;
	}
	/* phones: a full-screen sheet */
	@media (max-width: 720px) {
		.ovl {
			padding: 0;
			align-items: stretch;
			background: var(--bg);
		}
		.dlg {
			width: 100%;
			padding: 44px 8px 24px;
		}
		.x {
			top: 8px;
			right: 8px;
			width: 36px;
			height: 36px;
		}
	}
</style>
