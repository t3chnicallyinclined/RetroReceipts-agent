<script lang="ts" module>
	// 🎟 THE RAIL — betting on one locked money match (design: "The Rail" artifact, decisions locked
	// 2026-08-26). 1:1 even-money: place a bet on a fighter; someone takes the other side; winner gets
	// 90% of the combined stake, 10% feeds the fighters' pot (the match winner takes it). Betting closes
	// at match start; unmatched bets refund in full. Fighters + the referee can't bet (server-enforced;
	// buttons hidden here too).
	export interface RailMatch {
		wager_id: string;
		challenger: string;
		challenger_name?: string;
		acceptor: string;
		acceptor_name?: string;
		stake: number;
		pot?: number;
		ft?: number;
		live?: boolean;
		cw?: number;
		aw?: number;
		betting_open?: boolean;
		rail?: { open: number; matched: number; riding: number; open_coins: number; pot_feed: number };
	}
</script>

<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { apiGet } from '$lib/net.svelte';
	interface RailBet {
		id: string;
		bettor: string;
		bettor_name?: string;
		pick: string;
		pick_name?: string;
		stake: number;
		taker?: string;
		status: string;
	}
	let { m }: { m: RailMatch } = $props();

	let bets = $state<RailBet[]>([]);
	// seeded from the board row inside the load effect (initial-capture rule), refined by /rr/rail
	let bettingOpen = $state(false);
	let rail = $state<RailMatch['rail'] | null>(null);
	let slipFor = $state(''); // steamid being backed in the open slip ('' = closed)
	let stake = $state(25);
	let custom = $state('');
	let busy = $state(false);
	let notice = $state<{ ok: boolean; text: string } | null>(null);

	const isFighter = $derived(auth.steamid === m.challenger || auth.steamid === m.acceptor);
	const chosen = $derived.by(() => {
		const c = parseInt(custom, 10);
		return Number.isFinite(c) && c > 0 ? c : stake;
	});
	const openBets = $derived(bets.filter((b) => b.status === 'open'));
	const sideTotal = (sid: string) =>
		openBets.filter((b) => b.pick === sid).reduce((n, b) => n + b.stake, 0);

	async function load(force = false): Promise<void> {
		try {
			const j = await apiGet<{ ok?: boolean; betting_open?: boolean; bets?: RailBet[]; rail?: RailMatch['rail'] }>(
				`/rr/rail?wager_id=${encodeURIComponent(m.wager_id)}`,
				{ ttl: force ? 0 : 10_000, force }
			);
			if (j?.ok) {
				bets = j.bets ?? [];
				bettingOpen = !!j.betting_open;
				rail = j.rail ?? rail;
			}
		} catch {
			/* board data stays */
		}
	}
	$effect(() => {
		void m.wager_id;
		bettingOpen = !!m.betting_open;
		rail = m.rail ?? null;
		void load();
	});

	async function act(path: string, body: Record<string, unknown>, okText: string): Promise<void> {
		if (busy) return;
		busy = true;
		notice = null;
		const r = await auth.post(path, body);
		busy = false;
		if (r.ok) {
			notice = { ok: true, text: okText };
			slipFor = '';
			custom = '';
			void load(true);
			setTimeout(() => (notice = null), 2500);
		} else {
			notice = { ok: false, text: r.error ?? 'That didn’t go through — try again.' };
		}
	}
	const place = () => act('/rr/rail/bet', { wager_id: m.wager_id, pick: slipFor, stake: chosen }, '🎟 Bet placed — it pays out when someone takes the other side.');
	const takeBet = (b: RailBet) => {
		const other = b.pick === m.challenger ? m.acceptor : m.challenger;
		void act('/rr/rail/take', { bet_id: b.id }, `🎟 Bet matched — you've got ${nameOf(other)}.`);
	};
	const cancelBet = (b: RailBet) => act('/rr/rail/cancel', { bet_id: b.id }, 'Bet cancelled — refunded in full.');
	const nameOf = (sid: string) => (sid === m.challenger ? m.challenger_name || 'Player 1' : m.acceptor_name || 'Player 2');
	const otherOf = (sid: string) => (sid === m.challenger ? m.acceptor : m.challenger);
</script>

<div class="railp">
	<div class="rhd">
		<span>THE RAIL{rail?.matched ? ` · ${rail.matched} BET${rail.matched === 1 ? '' : 'S'} MATCHED` : ''}</span>
		<span class="ract">{rail?.riding ? `🪙 ${rail.riding} riding · +${rail.pot_feed} to the pot` : bettingOpen ? 'no bets yet — be first' : ''}</span>
	</div>

	{#if bettingOpen}
		{#if !auth.authed}
			<p class="rnote">Sign in with Steam to bet on this match.</p>
		{:else if isFighter}
			<p class="rnote">You're IN this match — win the pot, the rail's 10% rides on it. 🎟</p>
		{:else}
			<div class="pickrow">
				<button type="button" class="pick" class:sel={slipFor === m.challenger} onclick={() => (slipFor = slipFor === m.challenger ? '' : m.challenger)}>
					🎟 Bet on {m.challenger_name || 'Player 1'}
					<span>{sideTotal(m.challenger) ? `🪙 ${sideTotal(m.challenger)} waiting` : ''}</span>
				</button>
				<button type="button" class="pick" class:sel={slipFor === m.acceptor} onclick={() => (slipFor = slipFor === m.acceptor ? '' : m.acceptor)}>
					🎟 Bet on {m.acceptor_name || 'Player 2'}
					<span>{sideTotal(m.acceptor) ? `🪙 ${sideTotal(m.acceptor)} waiting` : ''}</span>
				</button>
			</div>
			{#if slipFor}
				<div class="slip">
					<div class="sline">Your bet: <b>{nameOf(slipFor)}</b> wins the match</div>
					<div class="chips">
						{#each [5, 10, 25, 50] as c (c)}
							<button type="button" class="chip" class:sel={stake === c && !custom} onclick={() => { stake = c; custom = ''; }}>{c}</button>
						{/each}
						<input class="cust" type="number" min="1" placeholder="custom" bind:value={custom} />
					</div>
					<div class="math"><span>You win if {nameOf(slipFor)} wins</span><b class="good">🪙 {chosen * 2 - Math.floor((chosen * 2) / 10)}</b></div>
					<div class="math"><span>Goes to the fighters' pot (win or lose)</span><b class="gold">🪙 {Math.floor((chosen * 2) / 10)}</b></div>
					<div class="math dim"><span>Nobody matches it before the match starts?</span><b>full refund</b></div>
					<button type="button" class="placebtn" disabled={busy || chosen < 1} onclick={place}>{busy ? '…' : `🎟 PLACE BET — 🪙 ${chosen}`}</button>
				</div>
			{/if}
		{/if}

		{#if openBets.length}
			<div class="obhd">WAITING FOR THE OTHER SIDE</div>
			{#each openBets as b (b.id)}
				<div class="ob">
					<span class="obw"><b>{b.bettor_name || '…'}</b> bet 🪙 {b.stake} on <b>{b.pick_name || nameOf(b.pick)}</b></span>
					{#if auth.authed && b.bettor === auth.steamid}
						<button type="button" class="obbtn ghost" disabled={busy} onclick={() => cancelBet(b)}>Cancel</button>
					{:else if auth.authed && !isFighter}
						<button type="button" class="obbtn" disabled={busy} onclick={() => takeBet(b)}>Bet {b.stake} on {nameOf(otherOf(b.pick))}</button>
					{/if}
				</div>
			{/each}
		{/if}
	{:else}
		<p class="rnote">{(m.cw ?? 0) + (m.aw ?? 0) > 0 || m.live ? '🔒 Betting closed — the match is on.' : 'Betting closed.'}
			{#if rail?.riding}&nbsp;🪙 {rail.riding} riding.{/if}</p>
	{/if}

	{#if notice}<p class="rmsg" class:bad={!notice.ok}>{notice.text}</p>{/if}
</div>

<style>
	.railp {
		border-top: 1px dashed var(--line);
		margin-top: 10px;
		padding-top: 9px;
	}
	.rhd {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		letter-spacing: 0.15em;
		color: var(--faint);
		margin-bottom: 8px;
	}
	.ract {
		color: var(--gold);
	}
	.rnote {
		margin: 0;
		font-size: 12px;
		color: var(--dim);
	}
	.pickrow {
		display: flex;
		gap: 8px;
	}
	.pick {
		flex: 1;
		font: inherit;
		font-size: 12.5px;
		font-weight: 800;
		color: var(--ink);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 9px 8px;
		cursor: pointer;
		text-align: center;
	}
	.pick span {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--faint);
		font-weight: 400;
		margin-top: 2px;
		min-height: 11px;
	}
	.pick:hover,
	.pick.sel {
		border-color: var(--gold);
	}
	.pick.sel {
		background: var(--gold-soft);
	}
	.slip {
		margin-top: 9px;
		border: 1px solid var(--line);
		border-radius: 11px;
		background: var(--panel);
		padding: 11px 12px;
	}
	.sline {
		font-size: 13px;
		margin-bottom: 8px;
	}
	.sline b {
		font-weight: 900;
	}
	.chips {
		display: flex;
		gap: 7px;
		margin-bottom: 9px;
	}
	.chip {
		flex: 1;
		font: inherit;
		font-weight: 800;
		font-size: 13px;
		color: var(--dim);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 7px 0;
		cursor: pointer;
	}
	.chip.sel {
		color: var(--gold);
		border-color: var(--gold);
		background: var(--gold-soft);
	}
	.cust {
		flex: 1.2;
		font: inherit;
		font-size: 12px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0 8px;
		min-width: 0;
	}
	.math {
		display: flex;
		justify-content: space-between;
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: var(--dim);
		padding: 2px 0;
	}
	.math b.good {
		color: var(--good);
	}
	.math b.gold {
		color: var(--gold);
	}
	.math.dim {
		color: var(--faint);
	}
	.placebtn {
		width: 100%;
		margin-top: 9px;
		font: inherit;
		font-style: italic;
		font-weight: 900;
		font-size: 13.5px;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: none;
		border-radius: 9px;
		padding: 10px 0;
		cursor: pointer;
	}
	.placebtn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.obhd {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.15em;
		color: var(--faint);
		margin: 10px 0 6px;
	}
	.ob {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 9px;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--panel);
		margin-bottom: 6px;
	}
	.obw {
		font-size: 12px;
		color: var(--dim);
		min-width: 0;
	}
	.obw b {
		color: var(--ink);
	}
	.obbtn {
		font: inherit;
		font-size: 11.5px;
		font-weight: 800;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 999px;
		padding: 6px 12px;
		cursor: pointer;
		white-space: nowrap;
	}
	.obbtn.ghost {
		color: var(--dim);
		background: transparent;
		border-color: var(--line);
	}
	.rmsg {
		margin: 8px 0 0;
		font-size: 11.5px;
		color: var(--good);
	}
	.rmsg.bad {
		color: var(--dim);
	}
</style>
