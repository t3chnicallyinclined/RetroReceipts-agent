<script lang="ts">
	import ReceiptPaper from './ReceiptPaper.svelte';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import CharSprite from './CharSprite.svelte';
	import { charTag } from '$lib/chars';
	import { rankOf, RANK_TIERS } from '$lib/ranks';
	import { base } from '$app/paths';

	// 🧾 SET RECEIPT — the ranked counterpart to the money-match slip. Renders GET /rr/session?id=<session_id>
	// (the same payload SessionModal uses) as a printed slip, laid out as a TALE OF THE TAPE: the two squads
	// face off at the top, then every game itemized as time · result · matchup, then the run bar and totals.
	//
	// Design decision (2026-08-24, "the tape" review): NO per-game stat columns. The per-game elo grid read
	// as a referee's scorecard and the combo count carried no owner in the payload — both cut. A game line is
	// when it happened, who won, and what both sides ran. Rating lives at SET level only (the totals), where
	// "went 2-8 for −3" is the story worth telling.
	//
	// Why this exists separately from MatchReceipt: that one is keyed by WAGER id, so it only ever covers
	// money matches. Ranked sets are the majority of what people actually play and had no receipt at all.
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

	// Team for a given side of a given game. wteam/lteam are keyed by WHO WON, so this has to resolve
	// through the winner — reading `wteam` for "my team" is only right on games I won.
	const teamOf = (g: Game, sid: string): number[] => (g.winner === sid ? (g.wteam ?? []) : (g.lteam ?? []));
	const tags = (ids: number[]) => ids.map(charTag);

	// The standing matchup — game 1's squads, rendered as sprites in the head. Teams CAN change per game
	// (the rows below track that); the head shows how the set opened.
	const squads = $derived.by(() => ({
		l: games.length ? teamOf(games[0], left?.steamid ?? '') : [],
		r: games.length ? teamOf(games[0], right?.steamid ?? '') : []
	}));

	/**
	 * Per game: BOTH teams, plus whether each side changed from the previous game.
	 *
	 * Teams are per-game data — you pick at character select before each one. An UNCHANGED team is rendered
	 * faintly and a CHANGED one at full strength, so a static set reads as quiet repetition rather than a
	 * wall, and a counter-pick pops the moment it happens.
	 */
	const rows = $derived.by(() => {
		let pm = '', po = '';
		return games.map((g) => {
			const mine = tags(teamOf(g, right?.steamid ?? ''));
			const theirs = tags(teamOf(g, left?.steamid ?? ''));
			const km = mine.join(), ko = theirs.join();
			const row = { mine, theirs, mineNew: pm !== '' && km !== pm, theirsNew: po !== '' && ko !== po };
			pm = km; po = ko;
			return row;
		});
	});

	// Wins/losses split so the total can show its own subtotals, the way a receipt builds to a TOTAL.
	const wins = $derived(games.filter((g) => g.winner === (me ?? right?.steamid)));
	const losses = $derived(games.filter((g) => g.winner !== (me ?? right?.steamid)));
	const sum = (a: Game[]) => a.reduce((n, g) => n + (g.elo ?? 0), 0);
	const winPts = $derived(sum(wins));
	const lossPts = $derived(sum(losses));

	/**
	 * THE RUN LINE — the set compressed the way tennis compresses a match (6-4 3-6 7-5), except the unit is
	 * the RUN, because "he ran four straight on me" is how sets are actually retold. Consecutive same-result
	 * games collapse into segments; segments print as `mine-theirs` pairs in play order. Zeros are
	 * load-bearing: opening `0-n` means you got run on from the jump, closing `n-0` means you closed it out.
	 * W LLLL W LLLL → "1-4 1-4". LLLL WWWWW → "0-4 5-0" (the reverse sweep, a whole story in 7 chars).
	 */
	const runs = $derived.by(() => {
		const who = me ?? right?.steamid;
		const segs: { won: boolean; n: number }[] = [];
		for (const g of games) {
			const w = g.winner === who;
			const last = segs[segs.length - 1];
			if (last && last.won === w) last.n++;
			else segs.push({ won: w, n: 1 });
		}
		return segs;
	});
	const runLine = $derived.by(() => {
		if (!runs.length) return '';
		const out: string[] = [];
		let i = 0;
		if (!runs[0].won) {
			out.push(`0-${runs[0].n}`);
			i = 1;
		}
		// from here segments strictly alternate won/lost, so [i] is always a win-run
		for (; i < runs.length; i += 2) out.push(`${runs[i].n}-${runs[i + 1]?.n ?? 0}`);
		return out.join(' ');
	});

	// Rank tiers + the gap — this is what turns "I lost 2-8" into "I took two off an Adamantium".
	const lRank = $derived(left?.rating != null ? rankOf(left.rating, left.games ?? 999) : null);
	const rRank = $derived(right?.rating != null ? rankOf(right.rating, right.games ?? 999) : null);
	const gap = $derived(
		left?.rating != null && right?.rating != null ? Math.abs(left.rating - right.rating) : 0
	);
	// Ladder distance in TIERS, not just points — "4 TIERS UP" lands harder than "260". Civilian (unplaced)
	// isn't in RANK_TIERS, so findIndex misses → 0 → the tier count simply doesn't print.
	const tierSteps = $derived.by(() => {
		if (!lRank || !rRank) return 0;
		const a = RANK_TIERS.findIndex((t) => t.n === lRank.n);
		const b = RANK_TIERS.findIndex((t) => t.n === rRank.n);
		return a < 0 || b < 0 ? 0 : Math.abs(a - b);
	});
	const underdog = $derived(
		right?.rating != null && left?.rating != null && right.rating < left.rating && gap >= 100
	);
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
			<!-- the tale of the tape: both squads face off under their names. This is the matchup — the thing
			     a set is remembered as — and the sprites make the slip identifiable as MvC2 at a glance. -->
			{#if squads.l.length || squads.r.length}
				<div class="squads">
					<div class="sq">
						{#each squads.l as id, i (i)}<span class="sbox"><CharSprite {id} eager={i === 0} /></span>{/each}
					</div>
					<div class="sq r">
						{#each squads.r as id, i (i)}<span class="sbox"><CharSprite {id} eager={i === 0} /></span>{/each}
					</div>
				</div>
			{/if}
			{#if underdog}
				<!-- the line that makes a losing set postable: two wins off someone four tiers up -->
				<div class="dog">· UNDERDOG · {gap} RATING GAP{tierSteps > 0 ? ` · ${tierSteps} TIERS UP` : ''} ·</div>
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

		<div class="sec sp">
			<span>GAMES</span><span class="hd">TIME · W/L · THEM vs YOU</span>
		</div>
		{#each games as g, i (g.match_index ?? i)}
			{@const won = g.winner === (me ?? right?.steamid)}
			{@const rw = rows[i]}
			<!-- one line per game: when · result · what both sides ran. No stat columns — see header comment. -->
			<div class="g">
				<span class="n">{pad((g.match_index ?? i) + 1)}</span>
				<span class="t">{hhmm(g.ts)}</span>
				<span class="wl" class:won>{won ? 'W' : 'L'}</span>
				<span class="tm them" class:changed={rw?.theirsNew}>
					{#each rw?.theirs ?? [] as t, k (k)}<span class="tg">{t}</span>{/each}
				</span>
				<span class="x">·</span>
				<span class="tm" class:changed={rw?.mineNew}>
					{#each rw?.mine ?? [] as t, k (k)}<span class="tg">{t}</span>{/each}
				</span>
				<!-- An OCV/perfect/comeback is by definition performed by the WINNER, so it's attributable:
				     you did it, or it was done to you. One flag per row, OCV first — it's the loud one. -->
				<span class="fl" class:mine={won}>
					{g.ocv ? (won ? 'OCV' : "OCV'D") : g.perfect ? (won ? 'PERF' : "PERF'D") : g.comeback ? (won ? 'CMBK' : 'RVRSD') : ''}
				</span>
			</div>
		{:else}
			<div class="none">No games recorded for this set.</div>
		{/each}

		{#if games.length}
			<!-- the run bar: the set's shape at a glance. Solid = your wins, hatched = theirs; segment width
			     is proportional to run length, so a war and a wash look different before you read a digit. -->
			<div class="runbar" aria-hidden="true">
				{#each runs as s, i (i)}
					<span class="seg" class:w={s.won} style="width:{(s.n / games.length) * 100}%"></span>
				{/each}
			</div>
		{/if}

		<div class="rule dash"></div>
		{#if wins.length}
			<div class="kv"><span>{wins.length} WON</span><span class="v">+{winPts}</span></div>
		{/if}
		{#if losses.length}
			<div class="kv"><span>{losses.length} LOST</span><span class="v dim">−{lossPts}</span></div>
		{/if}
		{#if runLine}
			<div class="kv"><span>RUN</span><span class="v">{runLine}</span></div>
		{/if}
		<div class="rule dbl2"></div>
		<div class="kv total">
			<span>NET RATING</span>
			<span class="tv" class:up={(netElo ?? 0) > 0}>{(netElo ?? 0) > 0 ? '+' : ''}{netElo ?? 0}</span>
		</div>
	{/snippet}

	{#snippet footer()}
		{#if games.length}
			<!-- the seal — gold budget: winner, money, VERIFIED. Partial verification stays quiet grey. -->
			<div class="cert" class:sealed={allVerified}>⬤ {confirmedCt}/{games.length} VERIFIED</div>
		{/if}
		<div class="thanks">GET THAT RECEIPT!</div>
	{/snippet}
</ReceiptPaper>

<style>
	/* ── the arena head: tale of the tape ── */
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
		font-size: 34px;
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
	/* the two squads, facing off. CharSprite fills its parent box — .sbox sets the size. */
	.squads {
		display: flex;
		justify-content: space-between;
		margin-top: 7px;
	}
	.sq {
		display: flex;
		align-items: flex-end; /* pixel-art frames vary in height — plant everyone on one floor */
		gap: 4px;
	}
	.sbox {
		display: block;
		width: 30px;
		height: 30px;
	}
	.dog {
		margin-top: 6px;
		text-align: center;
		font-size: 9px;
		letter-spacing: 0.16em;
		color: var(--gold);
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

	/* ── game rows: time · result · matchup, nothing else ── */
	.g {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		margin-bottom: 1px;
	}
	.g .n {
		flex: none;
		width: 15px;
		color: var(--faint);
	}
	.g .t {
		flex: none;
		width: 32px;
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
	/* teams are per-GAME: unchanged stays faint (quiet repetition), changed comes up to full ink so a
	   counter-pick pops the moment it happens. Left column is THEM (matches the head's seating). */
	.tm {
		flex: none;
		display: flex;
		gap: 3px;
	}
	/* 4ch by LAYOUT — short tags (RYU, ICE, DAN) must not be padded with literal spaces, which HTML collapses */
	.tg {
		display: inline-block;
		width: 4ch;
		text-align: center;
		color: var(--faint);
		font-size: 9.5px;
		letter-spacing: 0.02em;
	}
	.tm.changed .tg {
		color: var(--ink);
		font-weight: 700;
	}
	.tm.them .tg {
		color: color-mix(in srgb, var(--faint) 80%, transparent);
	}
	.tm.them.changed .tg {
		color: var(--dim);
		font-weight: 700;
	}
	.x {
		flex: none;
		color: var(--line);
	}
	/* badges are monochrome: gold is reserved for the winner, the money and the seal (DESIGN-SYSTEM budget) */
	.fl {
		flex: 1;
		min-width: 0;
		text-align: right;
		font-size: 8.5px;
		letter-spacing: 0.08em;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
	}
	.fl.mine {
		color: var(--ink);
	}

	/* ── the run bar ── */
	.runbar {
		display: flex;
		height: 8px;
		margin: 7px 0 2px;
		border: 1px solid var(--line);
	}
	.seg {
		display: block;
		background: repeating-linear-gradient(90deg, var(--line) 0 2px, transparent 2px 5px);
	}
	.seg.w {
		background: var(--good);
	}

	/* ── totals ── */
	.sec.sp {
		display: flex;
		justify-content: space-between;
	}
	.sec .hd {
		color: var(--faint);
		letter-spacing: 0.06em;
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
	.none {
		color: var(--faint);
		font-size: 11px;
		font-style: italic;
	}

	/* ── footer: the seal + the sign-off ── */
	.cert {
		margin-top: 9px;
		text-align: center;
		font-size: 9.5px;
		letter-spacing: 0.14em;
		color: var(--dim);
	}
	.cert.sealed {
		color: var(--gold);
	}
	.thanks {
		margin-top: 5px;
		text-align: center;
		font-size: 10px;
		letter-spacing: 0.2em;
		color: var(--dim);
	}
</style>
