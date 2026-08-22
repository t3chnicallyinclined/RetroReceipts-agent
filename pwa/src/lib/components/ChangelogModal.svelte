<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { api, APP_VERSION } from '$lib/config';

	// Changelog / "What's new" — ports the Tauri desktop app's changelog modal. Source of truth is the CENTRAL,
	// server-served changelog.json (same file the desktop app reads), so notes update without shipping the PWA.
	// A tiny bundled list is the offline fallback. Entries are { v, t, items[] } — version, title, note bullets
	// (no dates in the data). Fetch-once on mount → tick-safe.
	let { onClose, highlight = null }: { onClose: () => void; highlight?: string | null } = $props();

	interface ClEntry {
		v: string;
		t?: string;
		items: string[];
	}

	// Offline fallback ONLY — the remote is authoritative. (⚠ ops: append PWA releases to the central
	// nobd.net/skinsync/update/changelog.json when the PWA ships — see DEPLOY-RELEASE.)
	const FALLBACK: ClEntry[] = [
		{
			v: APP_VERSION,
			t: 'This release',
			items: ['Release notes load from the server — you appear to be offline right now.']
		}
	];

	let entries = $state<ClEntry[]>(FALLBACK);
	let loading = $state(true);

	/** Coerce a raw remote row into a clean entry (the JSON is external → validate defensively). */
	function normalize(x: unknown): ClEntry | null {
		const e = x as Record<string, unknown>;
		const v = typeof e?.v === 'string' ? e.v : '';
		if (!v) return null;
		const items = Array.isArray(e?.items) ? e.items.map(String).filter(Boolean) : [];
		return { v, t: typeof e?.t === 'string' ? e.t : undefined, items };
	}

	const title = $derived(highlight ? `What’s new in v${highlight}` : 'Changelog');

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(api('/skinsync/update/changelog.json'), {
					headers: { accept: 'application/json' }
				});
				if (!res.ok) throw new Error(String(res.status));
				const raw = (await res.json()) as unknown;
				const list = Array.isArray(raw) ? raw.map(normalize).filter((e): e is ClEntry => e != null) : [];
				if (!cancelled && list.length) entries = list;
			} catch {
				/* keep the bundled fallback — never a scary error over release notes */
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	// ── focus management + body scroll lock (verbatim from SessionModal / RankInfoModal) ──
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
			dlg.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
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

<!-- backdrop closes only on a click landing on the overlay itself (not the dialog within) -->
<div
	class="ovl"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	onkeydown={onKeydown}
>
	<div class="dlg" bind:this={dlg} role="dialog" aria-modal="true" aria-label="Changelog" tabindex="-1">
		<header class="dhd">
			<span class="rail">What’s new</span>
			<button class="x" bind:this={closeBtn} onclick={onClose} aria-label="Close">✕</button>
		</header>

		<div class="scroll">
			<h3 class="ctitle">{title}</h3>
			{#if loading && entries === FALLBACK}
				<div class="empty">Loading release notes…</div>
			{:else}
				<ol class="log">
					{#each entries as e (e.v)}
						{@const cur = e.v === APP_VERSION}
						<li class="entry" class:cur class:hi={highlight === e.v}>
							<div class="ev">
								<span class="v">v{e.v}</span>
								{#if e.t}<b class="t">{e.t}</b>{/if}
								{#if cur}<span class="here">you’re on this</span>{/if}
							</div>
							{#if e.items.length}
								<ul class="items">
									{#each e.items as it, i (i)}<li>{it}</li>{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	</div>
</div>

<style>
	.ovl {
		position: fixed;
		inset: 0;
		z-index: 100; /* above the fixed TabBar (z-40) */
		display: flex;
		align-items: center;
		justify-content: center;
		padding: max(16px, env(safe-area-inset-top)) 14px calc(16px + env(safe-area-inset-bottom));
		background: color-mix(in srgb, #05070c 72%, transparent);
		backdrop-filter: blur(3px);
	}
	.dlg {
		position: relative;
		width: 100%;
		max-width: 480px;
		max-height: min(86vh, 860px);
		max-height: min(86dvh, 860px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 16px;
		box-shadow: var(--shadow);
	}
	.dhd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--line);
	}
	.rail {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.x {
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--dim);
		font-size: 13px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.x:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.scroll {
		padding: 4px 16px 16px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.ctitle {
		margin: 14px 0 6px;
		font-size: 16px;
		font-weight: 800;
		color: var(--ink);
	}
	.empty {
		border: 1px dashed var(--line);
		border-radius: 12px;
		padding: 22px 16px;
		text-align: center;
		color: var(--dim);
		font-size: 12.5px;
	}
	.log {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* neutral register — versions are NOT gold; the changelog carries no primary action */
	.entry {
		padding: 12px 0;
		border-top: 1px solid var(--line-soft);
	}
	.entry:first-child {
		border-top: none;
	}
	/* the entry you're currently on (or an explicit highlight) — a calm panel, never gold */
	.entry.cur,
	.entry.hi {
		background: var(--panel-2);
		margin: 0 -12px;
		padding: 12px;
		border-radius: 10px;
		border-top: none;
		border-left: 2px solid color-mix(in srgb, var(--good) 55%, var(--line));
	}
	.ev {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 6px;
	}
	.v {
		font-size: 13px;
		font-weight: 800;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.t {
		font-size: 13px;
		font-weight: 800;
		color: var(--ink);
	}
	/* current-version marker — green "current" pill (keeps the gold budget for yours/first/primary) */
	.here {
		font-size: 8.5px;
		font-weight: 900;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--good);
		background: color-mix(in srgb, var(--good) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--good) 40%, var(--line));
		border-radius: 99px;
		padding: 1px 7px;
	}
	.items {
		margin: 0;
		padding-left: 18px;
	}
	.items li {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--dim);
		margin: 4px 0;
	}
</style>
