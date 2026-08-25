<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { timeAgo } from '$lib/format';
	import { resultcheck, type RcMine, type RcHeadsUp } from '$lib/stores/resultcheck.svelte';

	// The Result Check panel — opened from the 🔔 bell. Two sections, mirroring the Tauri renderRcPanel:
	//   1. "Confirm your results" — matches you're in that couldn't be auto-confirmed (confirmed===false).
	//      Each offers ✓ Confirm result / ⚑ Contest, or "✓ You confirmed" once you've agreed.
	//   2. "Your contests" — the contests YOU filed, with pending / resolved status.
	// Uses the SessionModal overlay recipe. Writes go through the store (auth.post under the hood).
	let { onClose }: { onClose: () => void } = $props();

	let notice = $state<string | null>(null);

	const confirmItems = $derived.by(() => {
		const seen = new Set<string>();
		const out: { key: string; label: string; ts?: number }[] = [];
		for (const m of [...resultcheck.headsUp, ...resultcheck.mine]) {
			if (m.confirmed !== false) continue; // absent/true → not an action item
			const key = String(m.match_key ?? m.mid ?? '');
			if (!key || seen.has(key)) continue;
			seen.add(key);
			const name = (m as RcMine).opponent?.name ?? (m as RcHeadsUp).contester?.name ?? 'Opponent';
			out.push({ key, label: name, ts: m.ts });
		}
		return out;
	});

	const busy = (key: string) => resultcheck.inflight.has(key);

	async function onConfirm(key: string) {
		notice = null;
		const r = await resultcheck.confirm(key);
		if (!r.ok) notice = r.error === 'busy' ? null : "Couldn't confirm — try again.";
		else if (r.confirmed) notice = 'Result confirmed — thanks!';
		else notice = 'Confirmed on your side — waiting for your opponent.';
	}
	async function onContest(key: string) {
		notice = null;
		if (!window.confirm("Contest this result? This flags it for review — you're saying you should be the winner.")) return;
		const r = await resultcheck.contest(key);
		if (!r.ok) notice = r.error?.includes('participant') ? 'Only a player in that match can contest it.' : "Couldn't submit the contest — try again.";
		else notice = "Contest submitted — you'll see it under Your contests.";
	}

	// ── overlay a11y: focus-trap + ESC + scroll-lock (SessionModal recipe) ──
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

<div
	class="ovl"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	onkeydown={onKeydown}
>
	<div class="dlg" bind:this={dlg} role="dialog" aria-modal="true" aria-label="Result Check" tabindex="-1">
		<header class="dhd">
			<span class="rail">Result Check</span>
			<button class="x" bind:this={closeBtn} onclick={onClose} aria-label="Close">✕</button>
		</header>

		<div class="body">
			{#if notice}<p class="notice">{notice}</p>{/if}

			{#if confirmItems.length}
				<h3 class="sh">Confirm your results</h3>
				<p class="lead">These couldn't be auto-confirmed. Confirm the ones that look right — once both players confirm, the result is locked in.</p>
				<div class="list">
					{#each confirmItems as it (it.key)}
						<div class="row">
							<div class="main">
								<div class="opp">vs {it.label}</div>
								{#if timeAgo(it.ts)}<div class="ts">{timeAgo(it.ts)}</div>{/if}
							</div>
							<span class="tag unc" title="Result couldn't be auto-confirmed">? unconfirmed</span>
							<div class="acts">
								{#if resultcheck.haveConfirmed(it.key)}
									<span class="st pend" title="Waiting for your opponent to confirm">✓ You confirmed</span>
								{:else}
									<button class="act confirm" disabled={busy(it.key)} onclick={() => onConfirm(it.key)}>✓ Confirm</button>
									<button class="act contest" disabled={busy(it.key)} onclick={() => onContest(it.key)}>⚑ Contest</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<h3 class="sh">Your contests</h3>
			<p class="lead">Contest a wrong win/loss and it goes to review — every match is saved as a full replay, so records settle to the truth.</p>
			{#if resultcheck.mine.length === 0}
				<div class="empty">No contested results. If a win/loss looks wrong, open your profile and tap Contest on the match.</div>
			{:else}
				<div class="list">
					{#each resultcheck.mine as m (m.match_key)}
						{@const done = m.status === 'resolved' || m.resolved}
						<div class="row">
							<div class="main">
								<div class="opp">vs {m.opponent?.name ?? 'Opponent'}</div>
								{#if timeAgo(m.ts)}<div class="ts">{timeAgo(m.ts)}</div>{/if}
							</div>
							{#if done && m.i_won}
								<span class="st won">✓ Resolved — you won</span>
							{:else if done}
								<span class="st lost">✓ Resolved — you lost</span>
							{:else}
								<span class="st pend">⏳ Pending review</span>
							{/if}
						</div>
					{/each}
				</div>
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
		max-width: 460px;
		max-height: min(86dvh, 800px);
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
	.body {
		padding: 14px 16px 18px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.notice {
		margin: 0 0 12px;
		padding: 9px 12px;
		border-radius: 9px;
		border: 1px solid color-mix(in srgb, var(--good) 34%, var(--line));
		background: color-mix(in srgb, var(--good) 12%, transparent);
		color: var(--ink);
		font-size: 12.5px;
	}
	.sh {
		margin: 6px 0 4px;
		font-size: 12.5px;
		font-weight: 800;
		color: var(--ink);
	}
	.lead {
		margin: 0 0 10px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--dim);
	}
	.list {
		margin-bottom: 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 2px;
		border-top: 1px solid var(--line-soft);
		flex-wrap: wrap;
	}
	.row:first-of-type {
		border-top: none;
	}
	.main {
		flex: 1 1 auto;
		min-width: 0;
	}
	.opp {
		font-weight: 700;
		font-size: 13px;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ts {
		margin-top: 2px;
		font-size: 11px;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.tag {
		flex: none;
		font-size: 9px;
		font-weight: 800;
		line-height: 1.5;
		padding: 1px 6px;
		border-radius: 999px;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}
	.tag.unc {
		color: var(--gold);
		background: var(--gold-soft);
		border: 1px solid color-mix(in srgb, var(--gold) 34%, var(--line));
	}
	.acts {
		display: flex;
		gap: 6px;
		flex: none;
		align-items: center;
	}
	.act {
		font: inherit;
		cursor: pointer;
		font-size: 10.5px;
		font-weight: 700;
		padding: 4px 9px;
		border-radius: 7px;
		background: transparent;
		white-space: nowrap;
		transition: filter 0.15s, border-color 0.15s;
	}
	.act:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.act.confirm {
		color: var(--good);
		border: 1px solid color-mix(in srgb, var(--good) 45%, var(--line));
	}
	.act.confirm:hover:not(:disabled) {
		filter: brightness(1.1);
		border-color: var(--good);
	}
	.act.contest {
		color: var(--p1);
		border: 1px solid var(--p1-line);
	}
	.act.contest:hover:not(:disabled) {
		filter: brightness(1.1);
		border-color: var(--p1);
	}
	.st {
		flex: none;
		font-size: 11.5px;
		font-weight: 700;
		padding: 3px 9px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.st.pend {
		color: var(--gold-ink);
		background: var(--gold);
	}
	.st.won {
		color: #08110a;
		background: var(--good);
	}
	.st.lost {
		color: #fff;
		background: transparent;
		border: 1px solid var(--line);
	}
	.empty {
		border: 1px dashed var(--line);
		border-radius: 12px;
		padding: 18px 14px;
		text-align: center;
		color: var(--dim);
		font-size: 12.5px;
	}
</style>
