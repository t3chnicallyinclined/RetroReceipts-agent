<script lang="ts">
	import ReceiptPaper from './ReceiptPaper.svelte';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import { base } from '$app/paths';

	// 🧾 SESSION TAB — "close out your tab". GET /rr/receipt/session?steamid=… rendered as the running bar
	// tab: what you staked, what you walked away with, and who you won it from. Where the match receipt is
	// the atomic shareable unit, this is the day's summary.
	type Opp = { opp: string; name?: string; cc?: string; avatar?: string; net?: number; won?: number; lost?: number; games?: number };
	type Line = {
		id: string;
		opp?: string;
		opp_name?: string;
		stake?: number;
		result?: string;
		me_wins?: number;
		opp_wins?: number;
		arcade?: boolean;
		settled_ms?: number;
	};
	export type SessionReceiptData = {
		steamid?: string;
		name?: string;
		code?: string;
		since_ms?: number;
		totals?: { matches?: number; won?: number; lost?: number; staked?: number; net?: number; house_fees?: number };
		opponents?: Opp[];
		matches?: Line[];
	};

	let { r }: { r: SessionReceiptData } = $props();

	const t = $derived(r.totals ?? {});
	const opps = $derived(r.opponents ?? []);
	const lines = $derived(r.matches ?? []);
	const net = $derived(t.net ?? 0);

	const stamp = (ms?: number) => {
		if (!ms) return 'ALL TIME';
		const d = new Date(ms);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	};
	const money = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n)}`;
	const hhmm = (ms?: number) => {
		if (!ms) return '--:--';
		const d = new Date(ms);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	};
</script>

<ReceiptPaper sub="· SESSION TAB ·">
	{#snippet meta()}
		<div class="meta">
			<div class="mrow"><span>CUSTOMER</span><span class="mv">{r.name ?? 'PLAYER'}</span></div>
			<div class="mrow"><span>RECEIPT</span><span class="mv">#{r.code ?? '—'}</span></div>
			<div class="mrow"><span>SINCE</span><span class="mv">{stamp(r.since_ms)}</span></div>
			<div class="mrow"><span>ITEMS</span><span class="mv">{t.matches ?? 0} matches · {opps.length} opp</span></div>
		</div>
	{/snippet}

	{#snippet body()}
		{#if (t.matches ?? 0) === 0}
			<div class="void">
				<div class="void-lg">TAB IS CLEAN</div>
				<div class="void-sm">No money matches yet. Put a quarter up to open one.</div>
			</div>
		{:else}
			<div class="sec">LINE ITEMS</div>
			{#each lines as m (m.id)}
				<a class="li" href="{base}/r/{m.id}">
					<span class="lt">{hhmm(m.settled_ms)}</span>
					<span class="lo">
						{(m.opp_name ?? 'Player').slice(0, 14)}{#if m.arcade}<span class="cab" title="Played on an arcade cabinet">🕹</span>{/if}
					</span>
					<span class="ls">{m.me_wins ?? 0}–{m.opp_wins ?? 0}</span>
					<span class="lv" class:won={m.result === 'won'} class:lost={m.result !== 'won'}>
						{m.result === 'won' ? '+' : '-'}{m.stake ?? 0}
					</span>
				</a>
			{/each}

			<div class="rule dash"></div>
			<div class="sec">BY OPPONENT</div>
			{#each opps as o (o.opp)}
				<a class="oi" href="{base}/u/{o.opp}">
					<Avatar url={o.avatar} size={20} alt={o.name ?? 'Player'} />
					<span class="on">
						{#if o.cc}<Flag cc={o.cc} w={12} />{/if}
						{(o.name ?? 'Player').slice(0, 14)}
					</span>
					<span class="ow">{o.won ?? 0}W–{o.lost ?? 0}L</span>
					<span class="ov" class:won={(o.net ?? 0) > 0} class:lost={(o.net ?? 0) < 0}>{money(o.net ?? 0)}</span>
				</a>
			{/each}
		{/if}
	{/snippet}

	{#snippet footer()}
		<div class="tot">
			<div class="trow"><span>MATCHES</span><span class="tv">{t.matches ?? 0} ({t.won ?? 0}W–{t.lost ?? 0}L)</span></div>
			<div class="trow"><span>STAKED</span><span class="tv">🪙 {t.staked ?? 0}</span></div>
			{#if (t.house_fees ?? 0) > 0}
				<div class="trow"><span>HOUSE FEES</span><span class="tv dim">🪙 {t.house_fees}</span></div>
			{/if}
			<div class="trow big">
				<span>NET</span>
				<span class="tv" class:won={net > 0} class:lost={net < 0}>🪙 {money(net)}</span>
			</div>
		</div>
		<div class="thanks">{net >= 0 ? 'GET THAT RECEIPT!' : 'RUN IT BACK.'}</div>
	{/snippet}
</ReceiptPaper>

<style>
	.meta {
		display: grid;
		gap: 1px;
	}
	.mrow,
	.trow {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
	.mrow > span:first-child,
	.sec {
		color: var(--dim);
		letter-spacing: 0.1em;
		font-size: 10.5px;
	}
	.mv {
		color: var(--ink);
	}
	.dim {
		color: var(--dim);
	}
	.sec {
		margin: 6px 0 3px;
	}

	.li,
	.oi {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 2px;
		text-decoration: none;
		color: var(--ink);
		border-radius: 4px;
	}
	.li:hover,
	.oi:hover {
		background: color-mix(in srgb, var(--ink) 5%, transparent);
	}
	.lt {
		flex: none;
		color: var(--faint);
		font-size: 10.5px;
	}
	.lo,
	.on {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cab {
		font-size: 10px;
		opacity: 0.8;
	}
	.ls,
	.ow {
		flex: none;
		color: var(--dim);
		font-size: 10.5px;
	}
	.lv,
	.ov {
		flex: none;
		font-weight: 800;
		min-width: 34px;
		text-align: right;
	}
	.won {
		color: var(--gold);
	}
	.lost {
		color: var(--dim);
	}

	.void {
		text-align: center;
		padding: 14px 0 10px;
	}
	.void-lg {
		font-size: 13px;
		font-weight: 800;
		letter-spacing: 0.16em;
		color: var(--dim);
	}
	.void-sm {
		margin-top: 4px;
		font-size: 11px;
		color: var(--faint);
	}

	.tot {
		display: grid;
		gap: 2px;
	}
	.tot .trow > span:first-child {
		color: var(--dim);
		font-size: 10.5px;
		letter-spacing: 0.1em;
	}
	.tv {
		font-weight: 700;
	}
	.trow.big .tv {
		font-size: 15px;
		font-weight: 900;
	}
	.thanks {
		margin-top: 9px;
		text-align: center;
		font-size: 10.5px;
		letter-spacing: 0.2em;
		color: var(--dim);
	}
</style>
