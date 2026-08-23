<script lang="ts">
	import ReceiptPaper from './ReceiptPaper.svelte';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import { charName } from '$lib/chars';
	import { base } from '$app/paths';

	// 🧾 SET RECEIPT — the ranked counterpart to the money-match slip. Renders GET /rr/session?id=<session_id>
	// (the same payload SessionModal uses) as a printed slip: who played, the set score, and every game
	// itemized with its teams, ELO swing and highlights.
	//
	// Why this exists separately from MatchReceipt: that one is keyed by WAGER id, so it only ever covers
	// money matches. Ranked sets are the majority of what people actually play and had no receipt at all.
	// It's also the RICHER slip — a money receipt's games[] is only populated for wager-stamped games and is
	// usually empty, whereas a set always carries its full game list.
	type Player = {
		steamid: string;
		name?: string;
		avatar?: string;
		cc?: string;
		rating?: number;
		elo?: number;
		wins?: number;
		losses?: number;
		games?: number;
	};
	type Game = {
		match_index?: number;
		ts?: number;
		winner?: string;
		loser?: string;
		wname?: string;
		lname?: string;
		wteam?: number[];
		lteam?: number[];
		elo?: number;
		combo?: number;
		ocv?: boolean;
		perfect?: boolean;
		comeback?: boolean;
		verified?: boolean;
		confirmed?: boolean;
	};
	export type SetReceiptData = {
		session_id?: string;
		count?: number;
		players?: Player[];
		games?: Game[];
	};

	let { r, me = null }: { r: SetReceiptData; me?: string | null } = $props();

	const games = $derived((r.games ?? []).slice().sort((a, b) => (a.match_index ?? 0) - (b.match_index ?? 0)));
	const players = $derived(r.players ?? []);

	// Set score is DERIVED from the games rather than trusted from a field — the payload has no set-score
	// total, and counting wins is the same thing the scoreboard does.
	const tally = $derived.by(() => {
		const t: Record<string, number> = {};
		for (const g of games) if (g.winner) t[g.winner] = (t[g.winner] ?? 0) + 1;
		return t;
	});
	// Put the viewer (or the set winner) on the right, mirroring the match receipt's winner-reads-last layout.
	const ordered = $derived.by(() => {
		if (players.length < 2) return players;
		const [a, b] = players;
		if (me) return a.steamid === me ? [b, a] : [a, b];
		return (tally[a.steamid] ?? 0) > (tally[b.steamid] ?? 0) ? [b, a] : [a, b];
	});
	const left = $derived(ordered[0]);
	const right = $derived(ordered[1]);

	// Net ELO across the set, from the viewer's side when known — a set's headline number the way the pot is
	// the money match's.
	const netElo = $derived.by(() => {
		const who = me ?? right?.steamid;
		if (!who) return null;
		let n = 0;
		let any = false;
		for (const g of games) {
			const e = g.elo ?? 0;
			if (!e) continue;
			any = true;
			n += g.winner === who ? e : -e;
		}
		return any ? n : null;
	});

	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = (ms?: number) => {
		if (!ms) return '';
		const d = new Date(ms);
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	};
	const hhmm = (ms?: number) => (ms ? `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}` : '--:--');
	const started = $derived(games.length ? games[0].ts : undefined);
	const ended = $derived(games.length ? games[games.length - 1].ts : undefined);
	const duration = $derived.by(() => {
		if (!started || !ended || ended <= started) return '';
		const s = Math.round((ended - started) / 1000);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
	});
	// Per-game trust: how many of the set's games the server can stand behind.
	const confirmedCt = $derived(games.filter((g) => g.confirmed || g.verified).length);
	const bestCombo = $derived(games.reduce((m, g) => Math.max(m, g.combo ?? 0), 0));
</script>

<ReceiptPaper sub="· RANKED SET ·">
	{#snippet meta()}
		<div class="meta">
			<div class="kv"><span>SET</span><span class="v">{r.session_id?.slice(-12) ?? '—'}</span></div>
			{#if started}<div class="kv"><span>PLAYED</span><span class="v">{stamp(started)}</span></div>{/if}
			{#if duration}<div class="kv"><span>DURATION</span><span class="v">{duration}</span></div>{/if}
			<div class="kv"><span>GAMES</span><span class="v">{games.length}</span></div>
		</div>
	{/snippet}

	{#snippet body()}
		<div class="ahead">
			<div class="vs">
				<div class="fighter">
					<div class="nm">{left?.name ?? 'Player'}</div>
					<div class="tier">{left?.rating ?? ''}</div>
				</div>
				<div class="score">
					<span class={(tally[left?.steamid ?? ''] ?? 0) >= (tally[right?.steamid ?? ''] ?? 0) ? 'w' : 'l'}>
						{tally[left?.steamid ?? ''] ?? 0}
					</span>
					<span class="d">–</span>
					<span class={(tally[right?.steamid ?? ''] ?? 0) >= (tally[left?.steamid ?? ''] ?? 0) ? 'w' : 'l'}>
						{tally[right?.steamid ?? ''] ?? 0}
					</span>
				</div>
				<div class="fighter r">
					<div class="nm">{right?.name ?? 'Player'}</div>
					<div class="tier">{right?.rating ?? ''}</div>
				</div>
			</div>
			<div class="faces">
				<a class="fa" href="{base}/u/{left?.steamid ?? ''}">
					<Avatar url={left?.avatar} size={20} alt={left?.name ?? 'Player'} />
					{#if left?.cc}<Flag cc={left.cc} w={12} />{/if}
				</a>
				<a class="fa" href="{base}/u/{right?.steamid ?? ''}">
					{#if right?.cc}<Flag cc={right.cc} w={12} />{/if}
					<Avatar url={right?.avatar} size={20} alt={right?.name ?? 'Player'} />
				</a>
			</div>
		</div>

		<!-- Every game, itemized. This is the part the money receipt usually can't show. -->
		<div class="sec">GAMES</div>
		{#each games as g, i (g.match_index ?? i)}
			{@const rightWon = g.winner === right?.steamid}
			<div class="g">
				<span class="n">{pad((g.match_index ?? i) + 1)}</span>
				<span class="t">{hhmm(g.ts)}</span>
				<!-- team as NAMES, not sprites: a printed slip is text, and three tiny sprites at this size read
				     as mush. Abbreviated so a full team fits one line at receipt width. -->
				<span class="teams">{((rightWon ? g.wteam : g.lteam) ?? []).map((c) => charName(c).slice(0, 4).toUpperCase()).join(' / ')}</span>
				<span class="won" class:r={rightWon}>{rightWon ? '▸' : '◂'}</span>
				{#if g.elo}<span class="e">{rightWon ? '+' : '−'}{g.elo}</span>{/if}
			</div>
			{#if g.ocv || g.perfect || g.comeback}
				<div class="flags">
					{#if g.ocv}<span class="fl">OCV</span>{/if}
					{#if g.perfect}<span class="fl">PERFECT</span>{/if}
					{#if g.comeback}<span class="fl">COMEBACK</span>{/if}
				</div>
			{/if}
		{:else}
			<div class="none">No games recorded for this set.</div>
		{/each}

		<div class="rule dash"></div>
		{#if bestCombo > 0}<div class="kv"><span>BIGGEST COMBO</span><span class="v">{bestCombo} hits</span></div>{/if}
		<div class="kv">
			<span>CONFIRMED</span>
			<span class="v">{confirmedCt} of {games.length} games</span>
		</div>
		{#if netElo !== null}
			<div class="kv">
				<span>NET RATING</span>
				<span class="v big" class:up={netElo > 0} class:down={netElo < 0}>
					{netElo > 0 ? '+' : ''}{netElo}
				</span>
			</div>
		{/if}
	{/snippet}

	{#snippet footer()}
		<div class="thanks">GET THAT RECEIPT!</div>
	{/snippet}
</ReceiptPaper>

<style>
	/* ReceiptPaper scopes its own .rule to its markup; a rule inside these snippets needs its own rule. */
	.rule {
		height: 0;
		margin: 9px 0;
	}
	.rule.dash {
		border-top: 1px dashed color-mix(in srgb, var(--faint) 70%, transparent);
	}
	.meta {
		display: grid;
		gap: 1px;
	}
	.kv {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
	.kv > span:first-child {
		color: var(--dim);
		letter-spacing: 0.1em;
		font-size: 9.5px;
		flex: none;
	}
	.v {
		text-align: right;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.big {
		font-size: 15px;
		font-weight: 900;
	}
	.up {
		color: var(--gold);
	}
	.down {
		color: var(--dim);
	}
	.sec {
		color: var(--dim);
		letter-spacing: 0.1em;
		font-size: 9.5px;
		margin: 8px 0 3px;
	}

	.ahead {
		position: relative;
		margin: -18px -20px 10px;
		padding: 13px 16px 10px;
		overflow: hidden;
		background:
			linear-gradient(118deg, color-mix(in srgb, var(--gold) 16%, transparent), transparent 72%),
			var(--panel-2);
		border-bottom: 1px solid var(--line);
	}
	.vs {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 10px;
	}
	.fighter {
		min-width: 0;
	}
	.fighter.r {
		text-align: right;
	}
	.fighter .nm {
		font-weight: 800;
		font-style: italic;
		text-transform: uppercase;
		font-size: 14px;
		line-height: 1.1;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fighter .tier {
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--faint);
		margin-top: 1px;
	}
	.score {
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 30px;
		font-weight: 900;
		font-style: italic;
		line-height: 1;
	}
	.score .l {
		color: var(--faint);
	}
	.score .w {
		color: var(--gold);
	}
	.score .d {
		color: var(--line);
		font-size: 20px;
	}
	.faces {
		display: flex;
		justify-content: space-between;
		margin-top: 7px;
	}
	.fa {
		display: flex;
		align-items: center;
		gap: 5px;
		text-decoration: none;
	}

	.g {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 10.5px;
	}
	.g .n {
		flex: none;
		color: var(--faint);
		width: 16px;
	}
	.g .t {
		flex: none;
		color: var(--faint);
		font-size: 9.5px;
	}
	.g .teams {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
		font-size: 9.5px;
		letter-spacing: 0.04em;
	}
	.g .won {
		flex: none;
		color: var(--faint);
		font-weight: 800;
	}
	.g .won.r {
		color: var(--gold);
	}
	.g .e {
		flex: none;
		width: 30px;
		text-align: right;
		color: var(--dim);
	}
	.flags {
		display: flex;
		gap: 5px;
		margin: 0 0 2px 23px;
	}
	.fl {
		font-size: 8.5px;
		letter-spacing: 0.1em;
		color: var(--gold);
	}
	.none {
		color: var(--faint);
		font-size: 11px;
		font-style: italic;
	}
	.thanks {
		margin-top: 9px;
		text-align: center;
		font-size: 10px;
		letter-spacing: 0.2em;
		color: var(--dim);
	}
</style>
