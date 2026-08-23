<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';

	// Suggest-a-stat — ports the Tauri "💡 Suggest a leaderboard stat" modal. Writes via the shared authed POST
	// to the EXISTING endpoint POST /rr/suggest (token-bound SteamID server-side; body = {text, name?}).
	// Signed-in only (the endpoint 401s otherwise). Fetch-on-submit only → tick-safe.
	let { onClose }: { onClose: () => void } = $props();

	const MAX = 600;
	const MIN = 4; // server rejects text < 4 chars ("empty suggestion")

	let text = $state('');
	let busy = $state(false);
	let notice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

	const count = $derived(text.length);
	const tooShort = $derived(text.trim().length < MIN);

	async function submit() {
		if (busy || tooShort) return;
		busy = true;
		notice = null;
		const res = await auth.post('/rr/suggest', {
			text: text.trim(),
			name: auth.me?.name ?? ''
		});
		busy = false;
		if (res.ok) {
			notice = { kind: 'ok', text: 'Thanks — your idea is in. Good ones become boards.' };
			text = '';
		} else {
			notice = { kind: 'err', text: res.error ?? 'Could not send that — try again.' };
		}
	}

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
			dlg.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')
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
	<div class="dlg" bind:this={dlg} role="dialog" aria-modal="true" aria-label="Suggest a stat" tabindex="-1">
		<header class="dhd">
			<span class="rail">Feedback</span>
			<button class="x" bind:this={closeBtn} onclick={onClose} aria-label="Close">✕</button>
		</header>

		<div class="scroll">
			<h3 class="stitle">💡 Suggest a stat</h3>

			{#if !auth.authed}
				<p class="lede">Sign in with Steam to suggest a stat — that way we can follow up if we build it.</p>
				<button class="put" onclick={() => auth.login()}>
					<span>Sign in through Steam ▸</span>
				</button>
			{:else}
				<p class="lede">
					Think a stat is worth tracking? Tell us what to rank and how you’d score it — good ideas get added
					to the boards.
				</p>
				<div class="hintbox">
					<b>Data we can rank on:</b> match wins/losses, teams &amp; characters used, per-round outcomes, health
					&amp; comeback situations, combo hit-counts, OCVs, perfects, and head-to-head matchups.
					<div class="ex">
						<b>Example:</b>
						<i>“Anchor Clutch — win-rate when you’re down to your last character.”</i>
					</div>
				</div>

				<textarea
					bind:value={text}
					maxlength={MAX}
					rows="4"
					placeholder="Name your stat, say what it ranks, and how it should be scored…"
					disabled={busy}
				></textarea>

				<div class="foot">
					<span class="count" class:warn={count > MAX - 40}>{count} / {MAX}</span>
					<button class="ghost" onclick={onClose}>Cancel</button>
					<button class="put" disabled={busy || tooShort} onclick={submit}>
						<span>{busy ? 'Sending…' : 'Send suggestion ▸'}</span>
					</button>
				</div>

				{#if notice}
					<div class="notice {notice.kind}" role="status">{notice.text}</div>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.ovl {
		position: fixed;
		inset: 0;
		z-index: 100;
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
		max-width: 520px;
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
		padding: 14px 16px 18px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.stitle {
		margin: 0 0 8px;
		font-size: 16px;
		font-weight: 800;
		color: var(--ink);
	}
	.lede {
		margin: 0 0 12px;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--dim);
	}
	.hintbox {
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 10px 12px;
		margin: 0 0 12px;
	}
	.hintbox b {
		color: var(--ink);
	}
	.ex {
		margin-top: 8px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		min-height: 96px;
		padding: 10px 12px;
		border-radius: 9px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
		font: inherit;
		font-size: 12.5px;
		line-height: 1.5;
	}
	textarea:focus {
		outline: none;
		border-color: var(--gold-soft);
	}
	textarea:disabled {
		opacity: 0.6;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 12px;
	}
	.count {
		margin-right: auto;
		font-size: 11px;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.count.warn {
		color: var(--dim);
	}
	.ghost {
		font: inherit;
		font-weight: 700;
		font-size: 13px;
		color: var(--dim);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 9px 15px;
		cursor: pointer;
		min-height: 40px;
	}
	.ghost:hover {
		color: var(--ink);
		border-color: var(--faint);
	}
	/* the one primary action — gold Cut button (QuarterUpForm .put vocabulary) */
	.put {
		font: inherit;
		font-size: 12.5px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 9px;
		padding: 0 16px;
		min-height: 40px;
		cursor: pointer;
		transform: skewX(-8deg);
		white-space: nowrap;
	}
	.put > :global(span) {
		display: inline-block;
		transform: skewX(8deg);
	}
	.put:hover:not(:disabled) {
		filter: brightness(1.05);
	}
	.put:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.notice {
		margin-top: 12px;
		font-size: 12.5px;
		font-weight: 700;
	}
	.notice.ok {
		color: var(--good);
	}
	.notice.err {
		color: var(--live);
	}
</style>
