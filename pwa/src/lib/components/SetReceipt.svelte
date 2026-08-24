<script lang="ts">
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import CharSprite from './CharSprite.svelte';
	import { charTag } from '$lib/chars';
	import { rankOf, RANK_TIERS } from '$lib/ranks';
	import { base } from '$app/paths';

	// 🧾 THE TAPE — the one way a ranked set displays, everywhere. Renders GET /rr/session?id=<session_id>
	// as a fight card: tale-of-the-tape head (score, squads, ratings), one line per game (time · result ·
	// both teams), the run bar, set totals, and the cert band. The share page mounts it directly and
	// SessionModal wraps it in an overlay — SAME component, so the modal and the receipt can never drift.
	//
	// Design decisions (2026-08-24, "the tape" review):
	//   • NO per-game stat columns — the per-game elo grid read as a referee's scorecard and the combo count
	//     carries no owner in the payload; both cut. Rating lives at SET level only (the totals), where
	//     "went 2-8 for −3" is the story worth telling.
	//   • Gold budget: the winner's score digit (only once the set is SETTLED — never mid-live, never on a
	//     tie), the underdog line, and the verified seal. Losses are never red.
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

	let {
		r,
		me = null,
		live = false // an in-progress set: no gold, no crown — nothing is won yet
	}: { r: SetReceiptData; me?: string | null; live?: boolean } = $props();

	const games = $derived((r.games ?? []).slice().sort((a, b) => (a.match_index ?? 0) - (b.match_index ?? 0)));
	const players = $derived(r.players ?? []);

	// Set score is DERIVED from the games rather than trusted from a field — the payload has no set-score
	// total, and counting wins is the same thing the scoreboard does.
	const tally = $derived.by(() => {
		const t: Record<string, number> = {};
		for (const g of games) if (g.winner) t[g.winner] = (t[g.winner] ?? 0) + 1;
		return t;
	});
	// Put the viewer (or the set winner) on the right, mirroring the app's winner-reads-last layout.
	const ordered = $derived.by(() => {
		if (players.length < 2) return players;
		const [a, b] = players;
		if (me) return a.steamid === me ? [b, a] : [a, b];
		return (tally[a.steamid] ?? 0) > (tally[b.steamid] ?? 0) ? [b, a] : [a, b];
	});
	const left = $derived(ordered[0]);
	const right = $derived(ordered[1]);
	const lScore = $derived(tally[left?.steamid ?? ''] ?? 0);
	const rScore = $derived(tally[right?.steamid ?? ''] ?? 0);
	// Gold appears ONLY when settled: a decided, finished set. Mid-live or tied, both digits stay on ink.
	const settled = $derived(!live && lScore !== rScore);

	// Net ELO across the set, from the viewer's side when known.
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

	// The standing matchup — game 1's squads, rendered as sprites in the tape. Teams CAN change per game
	// (the rows below track that); the tape shows how the set opened.
	const squads = $derived.by(() => ({
		l: games.length ? teamOf(games[0], left?.steamid ?? '') : [],
		r: games.length ? teamOf(games[0], right?.steamid ?? '') : []
	}));

	// Per game: BOTH teams as char-id triples, plus whether each side changed from the previous game — an
	// unchanged team prints dimmed, a counter-pick comes up to full strength the moment it happens.
	const rows = $derived.by(() => {
		let pm = '', po = '';
		return games.map((g) => {
			const mine = teamOf(g, right?.steamid ?? '');
			const theirs = teamOf(g, left?.steamid ?? '');
			const km = mine.join(), ko = theirs.join();
			const row = { mine, theirs, mineNew: pm !== '' && km !== pm, theirsNew: po !== '' && ko !== po };
			pm = km; po = ko;
			return row;
		});
	});

	// Assist type per slot (α/β/γ), IF the server ever sends it. wassist/lassist are speculative fields —
	// the agent doesn't capture assist selection yet (it's a memory-read away at char select); the badge
	// slot is wired so the receipt lights up the moment the data exists, with zero cost until then.
	const ASSIST = ['α', 'β', 'γ'];
	const assistOf = (g: Game, sid: string): number[] => {
		const raw = g.winner === sid ? (g as { wassist?: number[] }).wassist : (g as { lassist?: number[] }).lassist;
		return Array.isArray(raw) ? raw : [];
	};

	// Wins/losses split so the totals can build to a NET, the way a receipt builds to a TOTAL.
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
	// Ladder distance in TIERS — "4 TIERS UP" lands harder than "260". Civilian (unplaced) isn't in
	// RANK_TIERS, so findIndex misses → 0 → the tier count simply doesn't print.
	const tierSteps = $derived.by(() => {
		if (!lRank || !rRank) return 0;
		const a = RANK_TIERS.findIndex((t) => t.n === lRank.n);
		const b = RANK_TIERS.findIndex((t) => t.n === rRank.n);
		return a < 0 || b < 0 ? 0 : Math.abs(a - b);
	});
	const underdog = $derived(
		right?.rating != null && left?.rating != null && right.rating < left.rating && gap >= 100
	);

	const is17 = (sid?: string) => !!sid && /^\d{17}$/.test(sid);
</script>

<div class="tape">
	<!-- ── the rail ── -->
	<div class="rail">
		<span>RETRO RECEIPTS · THE TAPE</span>
		<span class="rr">
			{#if live}<span class="lv">● LIVE</span>{/if}
			No. {r.session_id?.slice(-11).toUpperCase() ?? '—'}
		</span>
	</div>

	<!-- ── the hero: nothing competes with the score ── -->
	<div class="hero">
		<div class="score">
			<span class:gld={settled && lScore > rScore}>{lScore}</span><em>—</em><span class:gld={settled && rScore > lScore}>{rScore}</span>
		</div>
		<div class="slug">
			{[stamp(started), duration, `${games.length} ${games.length === 1 ? 'GAME' : 'GAMES'}`].filter(Boolean).join(' · ')}
		</div>
		{#if underdog}
			<!-- the line that makes a losing set postable: two wins off someone four tiers up -->
			<div class="dog">UNDERDOG · {gap} RATING GAP{tierSteps > 0 ? ` · ${tierSteps} TIERS UP` : ''}</div>
		{/if}
	</div>

	<!-- ── tale of the tape ── -->
	<div class="tot">
		<div class="nms">
			<span class="side">
				<Avatar url={left?.avatar} size={22} alt={left?.name ?? 'Player'} />
				{#if is17(left?.steamid)}<a class="nm" href="{base}/u/{left?.steamid}">{left?.name ?? 'Player'}</a>{:else}<span class="nm">{left?.name ?? 'Player'}</span>{/if}
				{#if left?.cc}<Flag cc={left.cc} w={13} />{/if}
			</span>
			<span class="side r">
				{#if right?.cc}<Flag cc={right.cc} w={13} />{/if}
				{#if is17(right?.steamid)}<a class="nm" href="{base}/u/{right?.steamid}">{right?.name ?? 'Player'}</a>{:else}<span class="nm">{right?.name ?? 'Player'}</span>{/if}
				<Avatar url={right?.avatar} size={22} alt={right?.name ?? 'Player'} />
			</span>
		</div>
		{#if squads.l.length || squads.r.length}
			<div class="cmp sq-row">
				<span class="sq">
					{#each squads.l as id, i (i)}<span class="sbox"><CharSprite {id} eager={i === 0} /></span>{/each}
				</span>
				<span class="mid">TEAM</span>
				<span class="sq r">
					{#each squads.r as id, i (i)}<span class="sbox"><CharSprite {id} eager={i === 0} /></span>{/each}
				</span>
			</div>
		{/if}
		{#if left?.rating != null || right?.rating != null}
			<div class="cmp">
				<span class="cv">{left?.rating ?? '—'} <i>{lRank?.n ?? ''}</i></span>
				<span class="mid">RATING</span>
				<span class="cv r"><i>{rRank?.n ?? ''}</i> {right?.rating ?? '—'}</span>
			</div>
		{/if}
		{#if left?.games != null || right?.games != null}
			<div class="cmp">
				<span class="cv fnt">{left?.games ?? '—'} GP</span>
				<span class="mid">CAREER</span>
				<span class="cv fnt r">{right?.games ?? '—'} GP</span>
			</div>
		{/if}
	</div>

	<!-- ── the games plate: one line per game — time · result · matchup, nothing else ── -->
	<div class="plate">
		<div class="phd"><span>GAMES</span><span class="hd">TIME · W/L · THEM vs YOU</span></div>
		{#each games as g, i (g.match_index ?? i)}
			{@const won = g.winner === (me ?? right?.steamid)}
			{@const rw = rows[i]}
			{@const aThem = assistOf(g, left?.steamid ?? '')}
			{@const aMine = assistOf(g, right?.steamid ?? '')}
			<!-- each game is the matchup IN SPRITES — P1 squad vs P2 squad, the way the game itself shows a
			     pick. Static portraits here (cheap; 6 per row × N rows), the animated ones live in the tape. -->
			<div class="g">
				<span class="n">{pad((g.match_index ?? i) + 1)}</span>
				<span class="t">{hhmm(g.ts)}</span>
				<span class="wl" class:won>{won ? 'W' : 'L'}</span>
				<span class="tm them" class:changed={rw?.theirsNew}>
					{#each rw?.theirs ?? [] as id, k (k)}
						<span class="cs" title={charTag(id)}>
							<img class="ci" src="{base}/chars/{id}.webp" alt={charTag(id)} loading="lazy" />
							{#if ASSIST[aThem[k]]}<i class="as">{ASSIST[aThem[k]]}</i>{/if}
						</span>
					{/each}
				</span>
				<span class="x">vs</span>
				<span class="tm" class:changed={rw?.mineNew}>
					{#each rw?.mine ?? [] as id, k (k)}
						<span class="cs" title={charTag(id)}>
							<img class="ci" src="{base}/chars/{id}.webp" alt={charTag(id)} loading="lazy" />
							{#if ASSIST[aMine[k]]}<i class="as">{ASSIST[aMine[k]]}</i>{/if}
						</span>
					{/each}
				</span>
				<!-- An OCV/perfect/comeback is performed by the WINNER, so it's attributable: you did it, or
				     it was done to you. One flag per row, OCV first — it's the loud one. -->
				<span class="fl" class:mine={won}>
					{g.ocv ? (won ? 'OCV' : "OCV'D") : g.perfect ? (won ? 'PERF' : "PERF'D") : g.comeback ? (won ? 'CMBK' : 'RVRSD') : ''}
				</span>
			</div>
		{:else}
			<div class="none">No games recorded for this set{live ? ' yet' : ''}.</div>
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
	</div>

	<!-- ── totals: a receipt builds to one number ── -->
	<div class="tots">
		{#if wins.length}<div class="kv"><span>{wins.length} WON</span><span class="v">+{winPts}</span></div>{/if}
		{#if losses.length}<div class="kv"><span>{losses.length} LOST</span><span class="v dim">−{lossPts}</span></div>{/if}
		{#if runLine}<div class="kv"><span>RUN</span><span class="v">{runLine}</span></div>{/if}
		<div class="dbl"></div>
		<div class="kv total">
			<span>NET RATING</span>
			<span class="tv" class:up={(netElo ?? 0) > 0}>{(netElo ?? 0) > 0 ? '+' : ''}{netElo ?? 0}</span>
		</div>
	</div>

	<!-- ── the cert band ── -->
	<div class="foot">
		{#if games.length}
			<div class="cert" class:sealed={allVerified}>⬤ {confirmedCt}/{games.length} VERIFIED</div>
		{/if}
		<div class="thanks">GET THAT RECEIPT!</div>
	</div>
</div>

<style>
	/* ── the card. NOT ReceiptPaper: the tape is a fight card with slab bands, not a torn slip. ── */
	.tape {
		width: 100%;
		max-width: 560px;
		background: var(--panel);
		border: 1px solid var(--line);
		color: var(--ink);
		font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
		font-variant-numeric: tabular-nums;
		font-size: 12px;
		line-height: 1.5;
		box-shadow: var(--shadow);
	}

	/* ── rail ── */
	.rail {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 14px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		font-size: 9px;
		letter-spacing: 0.18em;
		color: var(--faint);
		white-space: nowrap;
	}
	.rail .rr {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lv {
		color: var(--loss);
		letter-spacing: 0.12em;
		margin-right: 6px;
	}

	/* ── hero ── */
	.hero {
		padding: 14px 16px 6px;
		text-align: center;
	}
	.score {
		display: flex;
		justify-content: center;
		align-items: baseline;
		gap: 8px;
		font-size: 52px;
		font-weight: 900;
		font-style: italic;
		line-height: 0.9;
		font-family: inherit;
	}
	.score em {
		font-style: italic;
		font-size: 28px;
		color: var(--faint);
	}
	/* gold ONLY when settled — a live or tied set has no winner yet, so nothing is gold */
	.score .gld {
		color: var(--gold);
	}
	.slug {
		margin-top: 7px;
		font-size: 9.5px;
		letter-spacing: 0.18em;
		color: var(--dim);
	}
	.dog {
		margin-top: 4px;
		font-size: 9px;
		letter-spacing: 0.16em;
		color: var(--gold);
	}

	/* ── tale of the tape ── */
	.tot {
		padding: 10px 16px 12px;
	}
	.nms {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	.side {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.side.r {
		justify-content: flex-end;
	}
	.nm {
		font-weight: 800;
		font-style: italic;
		text-transform: uppercase;
		font-size: 15px;
		line-height: 1.1;
		color: var(--ink);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	a.nm:hover {
		color: var(--gold);
	}
	/* compare rows: values out, dotted centre label in — the boxing tale-of-the-tape column */
	.cmp {
		display: grid;
		grid-template-columns: 1fr 86px 1fr;
		align-items: center;
		padding: 3px 0;
		font-size: 12px;
	}
	.cmp .mid {
		text-align: center;
		font-size: 8.5px;
		letter-spacing: 0.19em;
		color: var(--faint);
		border-bottom: 1px dotted var(--line);
		line-height: 1;
		padding-bottom: 3px;
		align-self: end;
		margin-bottom: 4px;
	}
	.cmp .cv {
		text-align: right;
		font-weight: 700;
	}
	.cmp .cv.r {
		text-align: left;
	}
	.cmp .cv i {
		font-style: normal;
		font-weight: 400;
		font-size: 9.5px;
		letter-spacing: 0.08em;
		color: var(--dim);
	}
	.cmp .cv.fnt {
		font-weight: 400;
		font-size: 10.5px;
		color: var(--faint);
	}
	.sq-row {
		padding: 6px 0 3px;
	}
	.sq {
		display: flex;
		align-items: flex-end; /* pixel-art frames vary in height — plant everyone on one floor */
		gap: 4px;
	}
	.sq-row .sq {
		justify-content: flex-end;
	}
	.sq-row .sq.r {
		justify-content: flex-start;
	}
	.sbox {
		display: block;
		width: 30px;
		height: 30px;
	}

	/* ── games plate — box scores print on a tinted band ── */
	.plate {
		background: var(--panel-2);
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		padding: 9px 14px 11px;
	}
	.phd {
		display: flex;
		justify-content: space-between;
		font-size: 8.5px;
		letter-spacing: 0.17em;
		color: var(--faint);
		margin-bottom: 5px;
	}
	.g {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10.5px;
		margin-bottom: 3px;
	}
	.g .n {
		flex: none;
		width: 16px;
		color: var(--faint);
	}
	.g .t {
		flex: none;
		width: 34px;
		color: var(--faint);
	}
	/* W/L: TWO channels on purpose — colour AND fill. A filled-vs-hollow shape survives greyscale, a
	   screenshot re-encode, and a phone in sunlight. Losses are deliberately NOT red: eight red L's turns
	   the thing you're meant to be proud of into a wall of shame. */
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
	.tm {
		flex: none;
		display: flex;
		align-items: flex-end;
		gap: 3px;
	}
	/* sprite chip + (future) assist badge. Unchanged teams sit slightly dimmed so a counter-pick pops. */
	.cs {
		position: relative;
		display: block;
		width: 24px;
		height: 24px;
	}
	.ci {
		width: 100%;
		height: 100%;
		object-fit: contain;
		object-position: bottom;
		image-rendering: pixelated;
		display: block;
		opacity: 0.62;
	}
	.tm.changed .ci {
		opacity: 1;
	}
	.tm.them .ci {
		opacity: 0.5;
	}
	.tm.them.changed .ci {
		opacity: 0.85;
	}
	/* assist type (α/β/γ) — renders only when the server sends wassist/lassist */
	.as {
		position: absolute;
		right: -3px;
		bottom: -2px;
		font-style: normal;
		font-size: 7.5px;
		line-height: 1;
		padding: 1px 2px;
		border-radius: 3px;
		background: var(--bg);
		border: 1px solid var(--line);
		color: var(--dim);
	}
	.x {
		flex: none;
		color: var(--faint);
		font-size: 8.5px;
		letter-spacing: 0.05em;
	}
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
	.none {
		color: var(--faint);
		font-size: 11px;
		font-style: italic;
	}
	.runbar {
		display: flex;
		height: 9px;
		margin-top: 8px;
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
	.tots {
		padding: 10px 16px 4px;
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
	.dim {
		color: var(--dim);
	}
	.dbl {
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

	/* ── cert band ── */
	.foot {
		padding: 8px 14px 10px;
		background: var(--bg);
		border-top: 1px solid var(--line);
		text-align: center;
	}
	.cert {
		font-size: 9.5px;
		letter-spacing: 0.14em;
		color: var(--dim);
	}
	.cert.sealed {
		color: var(--gold);
	}
	.thanks {
		margin-top: 3px;
		font-size: 9px;
		letter-spacing: 0.2em;
		color: var(--faint);
	}
</style>
