<script lang="ts">
	import ReceiptPaper from './ReceiptPaper.svelte';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import { charTag } from '$lib/chars';
	import { rankOf } from '$lib/ranks';
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
	const allVerified = $derived(games.length > 0 && games.every((g) => g.verified));

	// Team for a given side of a given game, as 4-char tags. wteam/lteam are keyed by WHO WON, so this has
	// to resolve through the winner — reading `wteam` for "my team" is only right on games I won.
	const teamOf = (g: Game, sid: string): number[] => (g.winner === sid ? (g.wteam ?? []) : (g.lteam ?? []));
	const tags = (ids: number[]) => ids.map(charTag);

	// Teams are SET-level data with occasional game-level overrides: most players don't switch, so printing
	// them per row prints the same string N times and crowds out everything that actually varies. Print the
	// standing matchup once, then a sub-line ONLY on the game where a side's team changes.
	const standing = $derived.by(() => ({
		l: games.length ? tags(teamOf(games[0], left?.steamid ?? '')) : [],
		r: games.length ? tags(teamOf(games[0], right?.steamid ?? '')) : []
	}));
	/** Per game: which side (if any) changed team vs the previous game — drives the change-only sub-line. */
	const switches = $derived.by(() => {
		const out: { l?: string[]; r?: string[] }[] = [];
		let pl = standing.l.join(), pr = standing.r.join();
		games.forEach((g, i) => {
			const l = tags(teamOf(g, left?.steamid ?? '')), r = tags(teamOf(g, right?.steamid ?? ''));
			const row: { l?: string[]; r?: string[] } = {};
			if (i > 0 && l.join() !== pl) row.l = l;
			if (i > 0 && r.join() !== pr) row.r = r;
			pl = l.join(); pr = r.join();
			out.push(row);
		});
		return out;
	});

	// Wins/losses split so the total can show its own subtotals, the way a receipt builds to a TOTAL.
	const wins = $derived(games.filter((g) => g.winner === (me ?? right?.steamid)));
	const losses = $derived(games.filter((g) => g.winner !== (me ?? right?.steamid)));
	const sum = (a: Game[]) => a.reduce((n, g) => n + (g.elo ?? 0), 0);
	const winPts = $derived(sum(wins));
	const lossPts = $derived(sum(losses));

	// Rank tiers + the gap — this is what turns "I lost 2-8" into "I took two off an Adamantium".
	const lRank = $derived(left?.rating != null ? rankOf(left.rating, left.games ?? 999) : null);
	const rRank = $derived(right?.rating != null ? rankOf(right.rating, right.games ?? 999) : null);
	const gap = $derived(
		left?.rating != null && right?.rating != null ? Math.abs(left.rating - right.rating) : 0
	);
	const underdog = $derived(
		right?.rating != null && left?.rating != null && right.rating < left.rating && gap >= 100
	);
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
					<div class="tier">{[lRank?.n, left?.rating].filter(Boolean).join(' ')}</div>
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
					<div class="tier">{[rRank?.n, right?.rating].filter(Boolean).join(' ')}</div>
				</div>
			</div>
			{#if underdog}
				<!-- the line that makes a losing set postable: two wins off someone three tiers up -->
				<div class="dog">· UNDERDOG · {gap} RATING GAP ·</div>
			{/if}
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

		<!-- MATCHUP printed ONCE. Teams barely change within a set, so per-row teams print the same string
		     ten times and crowd out the fields that do vary. -->
		{#if games.length}
			<div class="sec">MATCHUP</div>
			<div class="mu">
				<span class="who">{(left?.name ?? 'Player').slice(0, 14)}</span>
				<span class="tm">{#each standing.l as t (t)}<span class="tg">{t}</span>{/each}</span>
			</div>
			<div class="mu">
				<span class="who me">{(right?.name ?? 'Player').slice(0, 14)}</span>
				<span class="tm">{#each standing.r as t (t)}<span class="tg">{t}</span>{/each}</span>
			</div>
			<div class="rule dash"></div>
		{/if}

		<div class="sec sp"><span>GAMES</span><span class="hd">COMBO · RATING</span></div>
		{#each games as g, i (g.match_index ?? i)}
			{@const won = g.winner === (me ?? right?.steamid)}
			<div class="g">
				<span class="n">{pad((g.match_index ?? i) + 1)}</span>
				<span class="wl" class:won>{won ? 'W' : 'L'}</span>
				<span class="bg">
					<!-- An OCV/perfect/comeback is BY DEFINITION performed by the winner, so we can attribute it:
					     you did it, or it was done to you. Four identical flag rows become four stories. -->
					{#if g.ocv}<span class="fl" class:mine={won}>{won ? 'OCV' : "OCV'D"}</span>{/if}
					{#if g.perfect}<span class="fl" class:mine={won}>{won ? 'PERFECT' : "PERF'D"}</span>{/if}
					{#if g.comeback}<span class="fl" class:mine={won}>{won ? 'COMEBACK' : 'REVERSED'}</span>{/if}
				</span>
				{#if g.combo}
					<span class="cb" class:best={g.combo === bestCombo}>{g.combo === bestCombo ? '★' : ''}{g.combo}</span>
				{:else}<span class="cb"></span>{/if}
				<span class="e">{g.elo ? (won ? '+' : '−') + g.elo : ''}</span>
			</div>
			<!-- change-only team line: a switch mid-set is an EVENT worth seeing, not noise to repeat -->
			{#if switches[i]?.l}
				<div class="sw"><span class="swn">{(left?.name ?? 'P1').slice(0, 12)} →</span>{#each switches[i].l ?? [] as t (t)}<span class="tg">{t}</span>{/each}</div>
			{/if}
			{#if switches[i]?.r}
				<div class="sw"><span class="swn">{(right?.name ?? 'P2').slice(0, 12)} →</span>{#each switches[i].r ?? [] as t (t)}<span class="tg">{t}</span>{/each}</div>
			{/if}
		{:else}
			<div class="none">No games recorded for this set.</div>
		{/each}

		<div class="rule dash"></div>
		{#if wins.length}
			<div class="kv"><span>{wins.length} WON</span><span class="v">+{winPts}</span></div>
		{/if}
		{#if losses.length}
			<div class="kv"><span>{losses.length} LOST</span><span class="v dim">−{lossPts}</span></div>
		{/if}
		{#if bestCombo > 0}
			<!-- ⚠ `combo` carries no owner in the payload, so this is deliberately NOT claimed as yours. -->
			<div class="kv"><span>LONGEST COMBO</span><span class="v">{bestCombo} hits</span></div>
		{/if}
		<div class="rule dbl2"></div>
		<div class="kv total">
			<span>NET RATING</span>
			<span class="tv" class:up={(netElo ?? 0) > 0}>{(netElo ?? 0) > 0 ? '+' : ''}{netElo ?? 0}</span>
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="thanks">GET THAT RECEIPT!</div>
	{/snippet}
</ReceiptPaper>

<style>
	/* ── matchup block: printed once, not per row ── */
	.mu {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 10.5px;
	}
	.mu .who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
	}
	.mu .who.me {
		color: var(--ink);
		font-weight: 700;
	}
	.tm {
		flex: none;
		display: flex;
		gap: 4px;
	}
	/* 4ch by LAYOUT — short tags (RYU, ICE, DAN) must not be padded with literal spaces, which HTML collapses */
	.tg {
		display: inline-block;
		width: 4ch;
		text-align: center;
		color: var(--dim);
		font-size: 10px;
		letter-spacing: 0.02em;
	}

	/* ── game rows ── */
	.g {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 10.5px;
	}
	.g .n {
		flex: none;
		width: 16px;
		color: var(--faint);
	}
	/* W/L: TWO channels on purpose — colour AND fill. Red/green is the worst colour-blind pair, and a
	   filled-vs-hollow shape survives greyscale, a screenshot re-encode, and a phone in sunlight.
	   Losses are deliberately NOT red: eight red L's turns the thing you're meant to be proud of into a
	   wall of shame, and the wins pop harder against quiet grey than against a second hot hue. */
	.wl {
		flex: none;
		width: 17px;
		text-align: center;
		font-weight: 900;
		font-size: 10px;
		border-radius: 3px;
		border: 1px solid var(--line);
		color: var(--dim);
	}
	.wl.won {
		background: var(--good);
		border-color: var(--good);
		color: var(--bg);
	}
	.bg {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 5px;
		overflow: hidden;
	}
	/* badges are monochrome: gold is reserved for the winner, the money and the seal (DESIGN-SYSTEM budget) */
	.fl {
		font-size: 8.5px;
		letter-spacing: 0.1em;
		color: var(--faint);
		white-space: nowrap;
	}
	.fl.mine {
		color: var(--ink);
	}
	.cb {
		flex: none;
		width: 34px;
		text-align: right;
		color: var(--dim);
		font-size: 10px;
	}
	.cb.best {
		color: var(--ink);
	}
	.g .e {
		flex: none;
		width: 32px;
		text-align: right;
		color: var(--ink);
	}
	.sw {
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin: 0 0 2px 23px;
	}
	.swn {
		font-size: 9px;
		color: var(--faint);
	}
	.sec.sp {
		display: flex;
		justify-content: space-between;
	}
	.sec .hd {
		color: var(--faint);
		letter-spacing: 0.06em;
	}
	.dog {
		margin-top: 5px;
		text-align: center;
		font-size: 9px;
		letter-spacing: 0.16em;
		color: var(--gold);
	}
	/* the TOTAL — a receipt builds to one */
	.rule.dbl2 {
		height: 0;
		margin: 8px 0;
		border-top: 3px double color-mix(in srgb, var(--faint) 75%, transparent);
	}
	.total > span:first-child {
		font-size: 10.5px;
		letter-spacing: 0.12em;
		color: var(--dim);
	}
	.tv {
		font-size: 21px;
		font-weight: 900;
		color: var(--ink);
	}
	.tv.up {
		color: var(--gold);
	}
	.dim {
		color: var(--dim);
	}

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
	.g .e {
		flex: none;
		width: 30px;
		text-align: right;
		color: var(--dim);
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
