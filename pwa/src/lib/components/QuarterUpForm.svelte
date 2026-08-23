<script lang="ts">
	import { wallet } from '$lib/stores/wallet.svelte';
	import { wager } from '$lib/stores/wager.svelte';

	// 🪙 Quarter-up form — put a quarter up (open marquee challenge) or challenge a specific player.
	// Format is First-to-3 for now (owner decision). Stake: preset 🪙10 or 🪙25, or a custom amount — from
	// the floor up to what you have, capped at the server max (100/side). All writes ride wager.offer.
	let {
		opp = '',
		oppName = ''
	}: { opp?: string; oppName?: string } = $props();

	// Keep in lockstep with the server (config.rs): wager_floor(FT3)=10, WAGER_STAKE_MAX=100 per side.
	const FT = 3;
	const FLOOR = 10;
	const STAKE_MAX = 100;
	const PRESETS = [10, 25];

	let mode = $state<'preset' | 'custom'>('preset');
	let presetStake = $state(10);
	let customVal = $state<number | null>(null);
	let busy = $state(false);
	let notice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

	const bal = $derived(wallet.balance);
	// "as much as you have" — the ceiling is your balance, but never past the server cap.
	const capMax = $derived(bal != null ? Math.min(bal, STAKE_MAX) : STAKE_MAX);
	// The effective stake: the chosen preset, or the custom amount (0 when the custom box is empty).
	const stake = $derived(mode === 'custom' ? (customVal ?? 0) : presetStake);
	const tooLow = $derived(stake < FLOOR);
	const tooRich = $derived(bal != null && stake > bal);
	const tooBig = $derived(stake > STAKE_MAX);
	const invalid = $derived(!Number.isInteger(stake) || tooLow || tooRich || tooBig);

	function pickPreset(v: number) {
		mode = 'preset';
		presetStake = v;
	}
	// A preset is offerable only if it clears the cap and your balance (both presets already clear the floor).
	function presetOk(v: number): boolean {
		return v <= STAKE_MAX && (bal == null || v <= bal);
	}

	async function submit() {
		if (busy || invalid) return;
		busy = true;
		notice = null;
		const body: { stake: number; ft: number; opp?: string } = { stake, ft: FT };
		if (opp) body.opp = opp;
		const res = await wager.offer(body);
		busy = false;
		if (res.ok) {
			notice = {
				kind: 'ok',
				text: opp
					? `Challenge sent to ${oppName || 'them'} — 🪙 ${stake}, first to ${FT}.`
					: `🪙 ${stake} in the arcade (first to ${FT}) — waiting for a taker.`
			};
		} else {
			notice = { kind: 'err', text: res.error ?? 'Could not put your quarter up.' };
		}
	}
</script>

<div class="qform">
	<div class="controls">
		<div class="pickers">
			<div class="pk">
				<span class="pk-l">Stake · FT{FT}</span>
				<div class="opts" role="group" aria-label="Stake">
					{#each PRESETS as v (v)}
						<button
							type="button"
							class="opt"
							class:on={mode === 'preset' && presetStake === v}
							disabled={busy || !presetOk(v)}
							aria-pressed={mode === 'preset' && presetStake === v}
							onclick={() => pickPreset(v)}>🪙 {v}</button
						>
					{/each}
					<button
						type="button"
						class="opt"
						class:on={mode === 'custom'}
						disabled={busy || (bal != null && bal < FLOOR)}
						aria-pressed={mode === 'custom'}
						onclick={() => (mode = 'custom')}>Custom</button
					>
					{#if mode === 'custom'}
						<input
							class="custom"
							type="number"
							inputmode="numeric"
							min={FLOOR}
							max={capMax}
							step="1"
							placeholder="{FLOOR}–{capMax}"
							bind:value={customVal}
							aria-label="Custom stake (quarters)"
						/>
					{/if}
				</div>
			</div>
		</div>

		<div class="foot">
			{#if bal != null}<span class="echo">you have 🪙 {bal}</span>{/if}
			<button type="button" class="put" disabled={busy || invalid} onclick={submit}>
				{#if busy}
					Putting it up…
				{:else if opp}
					Challenge {oppName || 'player'} ▸
				{:else}
					Put it up ▸
				{/if}
			</button>
		</div>
	</div>

	{#if !busy}
		{#if tooRich}
			<div class="hint">Not enough quarters — you have 🪙 {bal}.</div>
		{:else if mode === 'custom' && tooLow}
			<div class="hint">Minimum 🪙 {FLOOR} for first to {FT}.</div>
		{:else if mode === 'custom' && tooBig}
			<div class="hint">Max 🪙 {STAKE_MAX} per side.</div>
		{:else}
			<div class="hint">First to {FT} · 🪙 {FLOOR} min · up to 🪙 {capMax}.</div>
		{/if}
	{/if}
	{#if notice}
		<div class="notice {notice.kind}" role="status">{notice.text}</div>
	{/if}
</div>

<style>
	.qform {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	/* pickers + action share ONE row (wraps on narrow) so the card stays a slim bar, not a stacked panel */
	.controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 18px;
	}
	.pickers {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
	}
	.pk {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.pk-l {
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
		flex: none;
	}
	.opts {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		align-items: center;
	}
	.opt {
		font: inherit;
		font-size: 12px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0 10px;
		min-height: 30px;
		cursor: pointer;
		transform: skewX(-8deg);
		white-space: nowrap;
	}
	.opt > :global(*),
	.opt {
		transition: color 0.12s, border-color 0.12s, background 0.12s;
	}
	.opt.on {
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-color: transparent;
		font-style: italic;
	}
	.opt:disabled {
		opacity: 0.42;
		cursor: default;
	}
	.custom {
		font: inherit;
		/* 16px so iOS/iPadOS Safari doesn't auto-zoom the page on focus */
		font-size: 16px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		width: 82px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--gold-soft);
		border-radius: 8px;
		padding: 0 8px;
		min-height: 30px;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-left: auto;
	}
	.echo {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.put {
		font: inherit;
		font-size: 12.5px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 9px;
		padding: 0 14px;
		min-height: 32px;
		cursor: pointer;
		transform: skewX(-8deg);
		white-space: nowrap;
	}
	.put > :global(*) {
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
	.hint {
		font-size: 11.5px;
		color: var(--dim);
	}
	.notice {
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
