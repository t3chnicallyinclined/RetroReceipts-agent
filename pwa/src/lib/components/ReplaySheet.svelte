<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { replayViewer } from '$lib/replay/viewer.svelte';
	import { resolveSource, type ReplaySource } from '$lib/replay/source';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { api } from '$lib/config';
	import ReplayEmbed from './ReplayEmbed.svelte';

	// ▶ REPLAYSHEET — the app-wide replay overlay: one instance in +layout, opened by any ReplayAffordance that
	// lives outside an in-place-expanding list (the set view's game rows, share pages, profile history,
	// receipts). Owns only the sheet mechanics (resolve → embed, Esc/backdrop close, scroll lock); the picture
	// is ReplayEmbed, the same component the LIVE tab expands inline. Sits above SessionModal (z 90).
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
			if (e.key === 'Escape' && replayViewer.current && !document.fullscreenElement) {
				e.preventDefault();
				replayViewer.close();
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
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
				<ReplayEmbed {source} {poster} meta={req.meta} />
			{:else}
				<div class="resolving"><span class="rail">Finding the tape</span></div>
			{/if}
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
	@media (max-width: 720px) {
		.ovl {
			padding: 12px 6px 40px;
		}
	}
</style>
