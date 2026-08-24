<script lang="ts">
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import CharSprite from './CharSprite.svelte';
	import { charTag } from '$lib/chars';
	import { rankOf, RANK_TIERS } from '$lib/ranks';
	import { loadouts } from '$lib/stores/loadouts.svelte';
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

	// CUSTOM SKINS: each fighter renders in its OWNER's colors — the player's /skins loadout, fetched by
	// steamid (own = live today; opponents' arrive when the public loadout read ships server-side; until
	// then they stay stock, gracefully). null while loading → CharSprite paints stock, repaints on arrival.
	const lLoadout = $derived(loadouts.of(left?.steamid));
	const rLoadout = $derived(loadouts.of(right?.steamid));

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

	/**
	 * THE LINE — per-player totals, NEUTRAL by construction: one row per player, so the bottom of the
	 * receipt reads the same from either seat (the rows above keep the viewer's perspective; the totals
	 * are the record). Zero-sum sanity: TAKEN/GIVEN mirror and the NETs sum to zero.
	 */
	const lineFor = (sid: string | undefined) => {
		let w = 0, l = 0, taken = 0, given = 0;
		for (const g of games) {
			const e = g.elo ?? 0;
			if (g.winner === sid) {
				w++;
				taken += e;
			} else {
				l++;
				given += e;
			}
		}
		return { w, l, taken, given, net: taken - given };
	};
	const lLine = $derived(lineFor(left?.steamid));
	const rLine = $derived(lineFor(right?.steamid));

	/**
	 * THE RUN LINE — the set compressed the way tennis compresses a match (6-4 3-6 7-5), except the unit is
	 * the RUN, because "he ran four straight on me" is how sets are actually retold. Consecutive same-result
	 * games collapse into segments; segments print as `mine-theirs` pairs in play order. Zeros are
	 * load-bearing: opening `0-n` means you got run on from the jump, closing `n-0` means you closed it out.
	 * W LLLL W LLLL → "1-4 1-4". LLLL WWWWW → "0-4 5-0" (the reverse sweep, a whole story in 7 chars).
	 */
	const runsFor = (sid: string | undefined) => {
		const segs: { won: boolean; n: number }[] = [];
		for (const g of games) {
			const w = g.winner === sid;
			const last = segs[segs.length - 1];
			if (last && last.won === w) last.n++;
			else segs.push({ won: w, n: 1 });
		}
		return segs;
	};
	// the run BAR stays from the viewer's seat, like the rows above it
	const runs = $derived(runsFor(me ?? right?.steamid));

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
					{#each squads.l as id, i (i)}<span class="sbox"><CharSprite {id} eager={i === 0} palette={lLoadout?.[id] ?? null} /></span>{/each}
				</span>
				<span class="mid">TEAM</span>
				<span class="sq r">
					{#each squads.r as id, i (i)}<span class="sbox"><CharSprite {id} eager={i === 0} palette={rLoadout?.[id] ?? null} /></span>{/each}
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
		<div class="phd">
			<span>GAMES</span>
			<!-- discoverability: fighters wear their owners' custom skins — tell people it's a thing -->
			<a class="skhint" href="{base}/skins" title="Fighters wear their owners' custom skins — set yours in Skins">ⓘ CUSTOM SKINS ON · SET YOURS</a>
		</div>
		{#each games as g, i (g.match_index ?? i)}
			{@const won = g.winner === (me ?? right?.steamid)}
			{@const rw = rows[i]}
			{@const aThem = assistOf(g, left?.steamid ?? '')}
			{@const aMine = assistOf(g, right?.steamid ?? '')}
			<!-- each game is a full-width VS plate — the matchup IN SPRITES, teams flanking a center VS the
			     way the game's own versus screen does. Won rows carry a good edge + a wash from YOUR side;
			     losses stay quiet (never red). Static portraits here; the animated squads live in the tape. -->
			<div class="g" class:won>
				<span class="gi"><b>{pad((g.match_index ?? i) + 1)}</b><i>{hhmm(g.ts)}</i></span>
				<span class="tm them" class:changed={rw?.theirsNew}>
					{#each rw?.theirs ?? [] as id, k (k)}
						<span class="chip" title={charTag(id)}>
							<CharSprite {id} still palette={lLoadout?.[id] ?? null} alt={charTag(id)} />
							{#if ASSIST[aThem[k]]}<i class="as">{ASSIST[aThem[k]]}</i>{/if}
						</span>
					{/each}
				</span>
				<!-- the VS mark — the match screen's gold vs-hero, at row scale -->
				<span class="x" aria-hidden="true">VS</span>
				<span class="tm" class:changed={rw?.mineNew}>
					{#each rw?.mine ?? [] as id, k (k)}
						<span class="chip" title={charTag(id)}>
							<CharSprite {id} still palette={rLoadout?.[id] ?? null} alt={charTag(id)} />
							{#if ASSIST[aMine[k]]}<i class="as">{ASSIST[aMine[k]]}</i>{/if}
						</span>
					{/each}
				</span>
				<b class="wl" class:w={won}>{won ? 'W' : 'L'}</b>
				<!-- deck two: the game's stats. Combo is match-level (no owner in the payload) so it reads
				     neutral; an OCV/perfect/comeback is the winner's, so it reads directional. -->
				<span class="gs">
					{#if g.combo && g.combo > 1}<span class="st">{g.combo} HIT COMBO</span>{/if}
					{#if g.ocv}<span class="st fl ocv" class:mine={won}>{won ? 'OCV' : "OCV'D"}</span>{/if}
					{#if g.perfect}<span class="st fl" class:mine={won}>{won ? 'PERFECT' : "PERF'D"}</span>{/if}
					{#if g.comeback}<span class="st fl" class:mine={won}>{won ? 'COMEBACK' : 'REVERSED'}</span>{/if}
					<span class="st vf" class:ok={g.verified || g.confirmed}>{g.verified || g.confirmed ? '✓ VERIFIED' : 'UNVERIFIED'}</span>
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

	<!-- ── totals: THE LINE — one row per player, the same record from either seat ── -->
	<div class="tots">
		<table class="ln">
			<thead>
				<tr><th class="nm2">THE LINE</th><th>W</th><th>L</th><th>TAKEN</th><th>GIVEN</th><th class="netc">NET</th></tr>
			</thead>
			<tbody>
				<tr>
					<td class="nm2">{left?.name ?? 'Player'}</td>
					<td>{lLine.w}</td><td>{lLine.l}</td>
					<td>+{lLine.taken}</td><td>−{lLine.given}</td>
					<td class="netc" class:up={lLine.net > 0}>{lLine.net > 0 ? '+' : ''}{lLine.net}</td>
				</tr>
				<tr>
					<td class="nm2">{right?.name ?? 'Player'}</td>
					<td>{rLine.w}</td><td>{rLine.l}</td>
					<td>+{rLine.taken}</td><td>−{rLine.given}</td>
					<td class="netc" class:up={rLine.net > 0}>{rLine.net > 0 ? '+' : ''}{rLine.net}</td>
				</tr>
			</tbody>
		</table>
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
		gap: 6px;
	}
	.sq-row .sq {
		justify-content: flex-end;
	}
	.sq-row .sq.r {
		justify-content: flex-start;
	}
	.sbox {
		display: block;
		width: 46px;
		height: 46px;
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
		align-items: baseline;
		font-size: 8.5px;
		letter-spacing: 0.17em;
		color: var(--faint);
		margin-bottom: 5px;
	}
	.skhint {
		font-size: 8px;
		letter-spacing: 0.12em;
		color: var(--faint);
		text-decoration: none;
		white-space: nowrap;
	}
	.skhint:hover {
		color: var(--gold);
	}
	.g {
		display: grid;
		grid-template-columns: 40px 1fr 44px 1fr 46px;
		grid-template-rows: auto auto;
		align-items: center;
		margin-bottom: 5px;
		padding: 5px 8px 4px 9px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-left: 3px solid var(--line);
	}
	/* the win treatment: accent edge + a wash rising from YOUR side of the plate. Losses stay quiet. */
	.g.won {
		border-left-color: var(--good);
		background:
			linear-gradient(270deg, color-mix(in srgb, var(--good) 11%, transparent), transparent 58%),
			var(--panel);
	}
	.gi {
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.gi b {
		font-size: 11px;
		font-weight: 700;
		color: var(--dim);
	}
	.gi i {
		font-style: normal;
		font-size: 8.5px;
		color: var(--faint);
	}
	.tm {
		display: flex;
		align-items: flex-end;
		justify-content: flex-start;
		gap: 3px;
		min-width: 0;
	}
	.tm.them {
		justify-content: flex-end; /* both teams close on the center VS, like the versus screen */
	}
	/* sprite chip + (future) assist badge. Unchanged teams sit slightly dimmed so a counter-pick pops. */
	.chip {
		position: relative;
		display: block;
		width: 38px;
		height: 38px;
		opacity: 0.82;
	}
	.tm.changed .chip {
		opacity: 1;
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--ink) 40%, transparent));
	}
	/* assist type (α/β/γ) — renders only when the server sends wassist/lassist */
	.as {
		position: absolute;
		right: -2px;
		bottom: -1px;
		font-style: normal;
		font-size: 8px;
		line-height: 1;
		padding: 1px 2px;
		border-radius: 3px;
		background: var(--bg);
		border: 1px solid var(--line);
		color: var(--dim);
	}
	/* the VS mark — the match screen's gold vs-hero, shrunk to row scale (same gradient + glow) */
	.x {
		justify-self: center;
		font-size: 15px;
		font-weight: 900;
		font-style: italic;
		letter-spacing: -0.03em;
		line-height: 0.9;
		transform: skewX(-8deg);
		background: linear-gradient(175deg, #fff3c0 20%, var(--gold) 45%, #a3670a 80%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		filter: drop-shadow(0 2px 7px rgba(232, 185, 60, 0.28));
		user-select: none;
	}
	/* the result letter anchors the right edge and spans BOTH decks. ⚠ EXPLICIT column: an item with a
	   definite row but auto column is placed BEFORE the fully-auto items and would grab row 1 col 1. */
	.wl {
		grid-column: 5;
		grid-row: 1 / span 2;
		justify-self: end;
		align-self: center;
		font-size: 24px;
		font-weight: 900;
		font-style: italic;
		color: var(--faint);
	}
	.wl.w {
		color: var(--good);
	}
	/* deck two: the stats strip, under the teams, dashed off from deck one */
	.gs {
		grid-column: 1 / 5;
		grid-row: 2;
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin-top: 4px;
		padding-top: 3px;
		border-top: 1px dashed color-mix(in srgb, var(--line) 80%, transparent);
		font-size: 8.5px;
		letter-spacing: 0.11em;
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
	}
	.gs .vf {
		margin-left: auto;
		color: var(--faint);
	}
	.gs .vf.ok {
		color: color-mix(in srgb, var(--gold) 55%, var(--faint));
	}
	.fl {
		color: var(--faint);
	}
	.fl.mine {
		color: var(--ink);
	}
	/* OCV is the violence stat — it takes the molten accent, bright when yours, cooled when eaten */
	.fl.ocv {
		color: color-mix(in srgb, #ff5c2c 55%, var(--faint));
	}
	.fl.ocv.mine {
		color: #ff5c2c;
	}
	@media (max-width: 480px) {
		.g {
			grid-template-columns: 32px 1fr 30px 1fr 34px;
		}
		.chip {
			width: 30px;
			height: 30px;
		}
		.sbox {
			width: 36px;
			height: 36px;
		}
		.x {
			font-size: 12px;
		}
		.gs {
			gap: 8px;
		}
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

	/* ── totals: the box score. Columns foot (TAKEN/GIVEN mirror, NETs sum to zero) — checkable = trusted. ── */
	.tots {
		padding: 10px 16px 6px;
	}
	table.ln {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		font-size: 12px;
	}
	table.ln th {
		font-size: 8.5px;
		font-weight: 600;
		letter-spacing: 0.15em;
		color: var(--faint);
		text-align: right;
		padding: 0 0 5px 10px;
	}
	table.ln td {
		text-align: right;
		padding: 2px 0 2px 10px;
		color: var(--ink);
	}
	table.ln .nm2 {
		text-align: left;
		padding-left: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 0;
		width: 38%;
	}
	table.ln td.nm2 {
		font-weight: 800;
		font-style: italic;
		text-transform: uppercase;
		font-size: 13px;
	}
	/* NET is the finale column — bold and larger; positive earns good, negative stays quiet (never red) */
	table.ln .netc {
		font-weight: 900;
		font-size: 16px;
	}
	table.ln td.netc {
		color: var(--dim);
	}
	table.ln td.netc.up {
		color: var(--good);
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
