<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { wallet } from '$lib/stores/wallet.svelte';
	import { wager } from '$lib/stores/wager.svelte';

	// 🪙 Quarter-up form — pick a stake + a first-to target, then put a quarter up. Reused for BOTH an
	// OPEN marquee challenge (no opp) and a directed "challenge this player" (opp set). Stakes mirror the
	// desktop's 🪙 1/2/4/8 denominations; FT the arcade 2/3/5. All writes ride wager.offer → auth.post.
	let {
		opp = '',
		oppName = ''
	}: { opp?: string; oppName?: string } = $props();

	const STAKES = [1, 2, 4, 8];
	let stake = $state(2);
	const ft = 2; // fixed to first-to-2 for now — single option, so no picker is shown
	let busy = $state(false);
	let notice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

	const bal = $derived(wallet.balance);
	const tooRich = $derived(bal != null && stake > bal);

	async function submit() {
		if (busy || tooRich) return;
		busy = true;
		notice = null;
		const body: { stake: number; ft: number; opp?: string } = { stake, ft };
		if (opp) body.opp = opp;
		const res = await wager.offer(body);
		busy = false;
		if (res.ok) {
			notice = {
				kind: 'ok',
				text: opp
					? `Challenge sent to ${oppName || 'them'} — 🪙 ${stake} on the line.`
					: `🪙 ${stake} is on the marquee — waiting for a taker.`
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
			<span class="pk-l">Stake</span>
			<div class="opts" role="group" aria-label="Stake">
				{#each STAKES as v (v)}
					<button
						type="button"
						class="opt"
						class:on={stake === v}
						disabled={busy || (bal != null && v > bal)}
						aria-pressed={stake === v}
						onclick={() => (stake = v)}>🪙 {v}</button
					>
				{/each}
			</div>
		</div>
	</div>

	<div class="foot">
		{#if bal != null}<span class="echo">you have 🪙 {bal}</span>{/if}
		<button type="button" class="put" disabled={busy || tooRich} onclick={submit}>
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

	{#if tooRich && !busy}
		<div class="hint">Not enough quarters for that stake — pick a lower one.</div>
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
