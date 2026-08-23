<script lang="ts">
	import ReceiptPaper from './ReceiptPaper.svelte';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import { base } from '$app/paths';

	// 🧾 PER-MATCH RECEIPT — the atomic shareable unit. Renders GET /rr/receipt?id=<wager_id> as a printed
	// register slip: who played, the FT score, the money, and the escrow trail.
	//
	// The `ledger` + `verified` stamp are the point of the whole thing — a screenshot can be faked, an escrow
	// trail that shows both stakes in and the payout out cannot. So the ledger is rendered as literal line
	// items, not summarised away.
	type Person = {
		steamid: string;
		name?: string;
		avatar?: string;
		cc?: string;
		rating?: number;
		rank?: string;
		games_won?: number;
		is_winner?: boolean;
	};
	type Game = { n?: number; winner?: string; wname?: string; lname?: string; ocv?: boolean; perfect?: boolean; comeback?: boolean };
	type Entry = { kind?: string; from?: string; to?: string; amount?: number; memo?: string; ts?: number };
	export type MatchReceiptData = {
		id?: string;
		code?: string;
		status?: string;
		stake?: number;
		pot?: number;
		take?: number;
		fee?: number;
		ft?: number;
		arcade?: boolean;
		cabinet?: { steamid?: string; name?: string } | null;
		created_ms?: number;
		settled_ms?: number;
		winner?: string;
		challenger?: Person;
		acceptor?: Person | null;
		score?: { challenger?: number; acceptor?: number };
		games?: Game[];
		ledger?: Entry[];
		verified?: boolean;
	};

	let { r }: { r: MatchReceiptData } = $props();

	const ch = $derived(r.challenger);
	const ac = $derived(r.acceptor ?? null);
	const games = $derived(r.games ?? []);
	const ledger = $derived(r.ledger ?? []);

	const stamp = (ms?: number) => {
		if (!ms) return '—';
		const d = new Date(ms);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	};
	const who = (id?: string) => {
		if (!id) return '—';
		if (id.startsWith('mescrow:')) return 'ESCROW';
		if (ch && id === ch.steamid) return (ch.name || 'CHALLENGER').toUpperCase();
		if (ac && id === ac.steamid) return (ac.name || 'ACCEPTOR').toUpperCase();
		return `…${id.slice(-5)}`;
	};
	// A stake leaves a player; a payout arrives. Sign it from the player's side so the trail reads like a
	// bank statement rather than a raw double-entry dump.
	const sign = (e: Entry) => (e.kind === 'match-stake' ? '-' : '+');
</script>

<ReceiptPaper sub="· MONEY MATCH ·">
	{#snippet meta()}
		<div class="meta">
			<div class="mrow"><span>RECEIPT</span><span class="mv">#{r.code ?? '—'}</span></div>
			<div class="mrow"><span>DATE</span><span class="mv">{stamp(r.settled_ms || r.created_ms)}</span></div>
			<div class="mrow"><span>STATUS</span><span class="mv up">{(r.status ?? '—').toUpperCase()}</span></div>
			{#if r.arcade}
				<div class="mrow"><span>CABINET</span><span class="mv">{r.cabinet?.name ?? 'ARCADE'}</span></div>
			{/if}
		</div>
	{/snippet}

	{#snippet body()}
		<!-- the two players; the winner's plate is the one that reads first -->
		<div class="players">
			{#each [ch, ac] as p, i (p?.steamid ?? i)}
				{#if p}
					<a class="pl" class:win={p.is_winner} href="{base}/u/{p.steamid}">
						<Avatar url={p.avatar} size={26} alt={p.name ?? 'Player'} />
						<span class="pn">
							{#if p.cc}<Flag cc={p.cc} w={13} />{/if}
							{p.name ?? 'Player'}
						</span>
						<span class="pg">{p.games_won ?? 0}</span>
					</a>
				{:else}
					<div class="pl open"><span class="pn dim">— waiting for a taker —</span><span class="pg">0</span></div>
				{/if}
			{/each}
		</div>
		<div class="ftline">FIRST TO {r.ft ?? '—'}</div>

		<div class="rule dash"></div>

		<!-- per-game itemization. Only wager-stamped games carry this, so it collapses to the FT score
		     (always present) rather than showing an empty section. -->
		{#if games.length}
			<div class="sec">GAMES</div>
			{#each games as g, i (i)}
				<div class="li">
					<span class="ln">{String(g.n ?? i + 1).padStart(2, '0')}</span>
					<span class="lw">{(g.wname ?? who(g.winner)).slice(0, 16)}</span>
					<span class="lf">
						{#if g.ocv}OCV{/if}{#if g.perfect}{' '}PERFECT{/if}{#if g.comeback}{' '}COMEBACK{/if}
					</span>
				</div>
			{/each}
		{:else}
			<div class="sec">GAMES</div>
			<div class="nogames">Per-game breakdown not recorded for this set — final score below.</div>
		{/if}

		<div class="scoreline">
			<span>FINAL</span>
			<span class="sv">{r.score?.challenger ?? 0} – {r.score?.acceptor ?? 0}</span>
		</div>

		<div class="rule dash"></div>

		<!-- THE PROOF: the actual escrow movements -->
		<div class="sec">ESCROW TRAIL</div>
		{#if ledger.length}
			{#each ledger as e, i (e.ts ?? i)}
				<div class="li led">
					<span class="lk">{(e.kind ?? '').replace('match-', '').toUpperCase()}</span>
					<span class="lp">{who(e.from)} → {who(e.to)}</span>
					<span class="la" class:out={sign(e) === '-'}>{sign(e)}{e.amount ?? 0}</span>
				</div>
			{/each}
		{:else}
			<div class="nogames">No ledger entries recorded.</div>
		{/if}

		<div class="rule dash"></div>
		<div class="tot">
			<div class="trow"><span>STAKE (EACH)</span><span class="tv">🪙 {r.stake ?? 0}</span></div>
			<div class="trow"><span>POT</span><span class="tv">🪙 {r.pot ?? 0}</span></div>
			{#if (r.fee ?? 0) > 0}
				<div class="trow"><span>HOUSE FEE</span><span class="tv dim">🪙 {r.fee}</span></div>
			{/if}
			<div class="trow big"><span>TAKE</span><span class="tv up">🪙 {r.take ?? 0}</span></div>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="stampwrap">
			{#if r.verified}
				<div class="stamp ok">✓ VERIFIED · STAKES AND PAYOUT ON THE LEDGER</div>
			{:else}
				<div class="stamp pend">PENDING · NOT YET SETTLED ON THE LEDGER</div>
			{/if}
		</div>
		<div class="thanks">GET THAT RECEIPT!</div>
	{/snippet}
</ReceiptPaper>

<style>
	.meta {
		display: grid;
		gap: 1px;
	}
	.mrow,
	.trow,
	.scoreline {
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
	.up {
		color: var(--gold);
	}
	.dim {
		color: var(--dim);
	}
	.sec {
		margin: 6px 0 3px;
	}

	.players {
		display: grid;
		gap: 4px;
	}
	.pl {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 7px;
		border: 1px dashed transparent;
		border-radius: 6px;
		text-decoration: none;
		color: var(--ink);
	}
	.pl.win {
		border-color: color-mix(in srgb, var(--gold) 55%, transparent);
		background: color-mix(in srgb, var(--gold) 8%, transparent);
	}
	.pl.open {
		opacity: 0.75;
	}
	.pn {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pg {
		font-weight: 800;
		font-size: 15px;
	}
	.pl.win .pg {
		color: var(--gold);
	}
	.ftline {
		margin-top: 4px;
		text-align: center;
		font-size: 10.5px;
		letter-spacing: 0.14em;
		color: var(--dim);
	}

	.li {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.ln {
		color: var(--faint);
		flex: none;
	}
	.lw {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lf {
		color: var(--gold);
		font-size: 10px;
		letter-spacing: 0.08em;
		flex: none;
	}
	.led .lk {
		flex: none;
		width: 62px;
		color: var(--dim);
		font-size: 10px;
	}
	.led .lp {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 10.5px;
	}
	.la {
		flex: none;
		font-weight: 800;
		color: var(--gold);
	}
	.la.out {
		color: var(--dim);
	}
	.nogames {
		color: var(--faint);
		font-size: 11px;
		font-style: italic;
	}

	.scoreline {
		margin-top: 6px;
		font-size: 11px;
		letter-spacing: 0.1em;
		color: var(--dim);
	}
	.sv {
		font-weight: 800;
		font-size: 15px;
		color: var(--ink);
		letter-spacing: 0;
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

	.stampwrap {
		display: flex;
		justify-content: center;
	}
	.stamp {
		font-size: 10px;
		letter-spacing: 0.1em;
		padding: 4px 10px;
		border: 1px dashed currentColor;
		border-radius: 4px;
		text-align: center;
	}
	.stamp.ok {
		color: var(--gold);
	}
	.stamp.pend {
		color: var(--faint);
	}
	.thanks {
		margin-top: 9px;
		text-align: center;
		font-size: 10.5px;
		letter-spacing: 0.2em;
		color: var(--dim);
	}
</style>
