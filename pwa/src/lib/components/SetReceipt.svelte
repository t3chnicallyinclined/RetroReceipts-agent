<script lang="ts">
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import CharSprite from './CharSprite.svelte';
	import { charTag } from '$lib/chars';
	import { rankOf, RANK_TIERS } from '$lib/ranks';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { base } from '$app/paths';
	import ReplayAffordance from './ReplayAffordance.svelte';
	import type { ReplayMeta } from './ReplayEmbed.svelte';

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
	type GameStats = {
		wchipd?: number;
		lchipd?: number;
		wkos?: number;
		lkos?: number;
		wmeter?: number;
		lmeter?: number;
		first_hit?: string; // "w" | "l" | ""
		deaths?: number[]; // per-slot, interleaved (P1=0/2/4, P2=1/3/5)
		bc_slot?: number; // slot that DEALT the biggest combo (0-5)
		bc_hits?: number;
		swing?: number[]; // ≤48-pt P1−P2 team-health momentum line
	};
	type Game = {
		match_index?: number;
		/** the server's tape handle for THIS game (stats.rs session payload) — drives the per-game replay affordance */
		match_key?: string;
		ts?: number;
		winner?: string;
		loser?: string;
		wname?: string;
		lname?: string;
		wteam?: number[];
		lteam?: number[];
		elo?: number;
		combo?: number;
		duration_s?: number;
		wdmg?: number;
		ldmg?: number;
		stats?: GameStats | null;
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

	// ⚠ THE SEAT MUST BELONG TO A PARTICIPANT. `me` arrives as ?p= or the signed-in viewer — but a
	// spectator opening someone else's set is NOT in it, and comparing every game's winner against a
	// non-participant made all nine rows of a 9–0 sweep render L (seen live: Maddrooo's clean sweep
	// showed no W anywhere). A non-participant seat collapses to null → winner-reads-right default.
	const seat = $derived(me && players.some((p) => p.steamid === me) ? me : null);

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
		if (seat) return a.steamid === seat ? [b, a] : [a, b];
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
		const who = seat ?? right?.steamid;
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
	const runs = $derived(runsFor(seat ?? right?.steamid));

	// ── gs-110 STATS LAYER (agent 0.3.13+ games; older games gracefully keep the legacy combo line) ──
	// Most stats are winner/loser-keyed and re-key to the row's left/right seats through g.winner. The
	// P1/P2-keyed pieces (deaths/swing/bc_slot) need the winner's PHYSICAL side, which the payload doesn't
	// carry — but the deaths array yields it: a game ends when a team's three characters die, so the side
	// whose interleaved slots sum to 3 deaths is the LOSER (timeout games don't sum to 3 → unknown → those
	// pieces just don't render). Self-checking: the sample game's loser-side sum matched wkos exactly.
	const wsideOf = (s?: GameStats | null): 0 | 1 | 2 => {
		const d = s?.deaths;
		if (!Array.isArray(d) || d.length !== 6) return 0;
		const p1 = (d[0] ?? 0) + (d[2] ?? 0) + (d[4] ?? 0);
		const p2 = (d[1] ?? 0) + (d[3] ?? 0) + (d[5] ?? 0);
		if (p1 >= 3 && p2 < 3) return 2; // P1's team wiped → P2 won
		if (p2 >= 3 && p1 < 3) return 1;
		return 0;
	};
	// One resolved bundle per game, in ROW orientation (left = `them`, right = the viewer's seat).
	const statOf = (g: Game) => {
		const s = g.stats;
		const rightWon = g.winner === right?.steamid;
		const pick = <T,>(w: T, l: T): { l: T; r: T } => (rightWon ? { l, r: w } : { l: w, r: l });
		const dmg = g.wdmg || g.ldmg ? pick(g.wdmg ?? 0, g.ldmg ?? 0) : null;
		const chip = s && (s.wchipd || s.lchipd) ? pick(s.wchipd ?? 0, s.lchipd ?? 0) : null;
		const kos = s && (s.wkos || s.lkos) ? pick(s.wkos ?? 0, s.lkos ?? 0) : null;
		// first blood: "w"/"l" → which SEAT drew it
		const fb = s?.first_hit === 'w' ? (rightWon ? 'r' : 'l') : s?.first_hit === 'l' ? (rightWon ? 'l' : 'r') : '';
		// biggest combo + its owner: slot parity gives the dealer's physical side; wside maps that to
		// winner/loser, the seat map finishes the job; the char comes from the dealer's team in slot order.
		const wside = wsideOf(s);
		let combo: { hits: number; seat: 'l' | 'r' | ''; char: number } | null = null;
		if (s?.bc_hits && s.bc_hits > 1) {
			let seatSide: 'l' | 'r' | '' = '';
			let char = -1;
			if (wside && s.bc_slot != null && s.bc_slot >= 0) {
				const dealerP1 = s.bc_slot % 2 === 0;
				const dealerWon = (wside === 1) === dealerP1;
				seatSide = dealerWon === rightWon ? 'r' : 'l';
				const team = dealerWon ? (g.wteam ?? []) : (g.lteam ?? []);
				char = team[Math.floor(s.bc_slot / 2)] ?? -1;
			}
			combo = { hits: s.bc_hits, seat: seatSide, char };
		} else if (g.combo && g.combo > 1) {
			combo = { hits: g.combo, seat: '', char: -1 };
		}
		// momentum, re-signed so UP = the RIGHT seat (the viewer) ahead; unknown side → no line.
		let spark: number[] | null = null;
		if (s?.swing && s.swing.length >= 8 && wside) {
			const rightP1 = (wside === 1) === rightWon;
			spark = rightP1 ? s.swing : s.swing.map((v) => -v);
		}
		return { dmg, chip, kos, fb, combo, spark, dur: g.duration_s ?? 0, has: !!(dmg || chip || kos || s) };
	};
	const gstats = $derived(games.map(statOf));
	const mss = (sec: number) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
	// sparkline path: swing spans ±432 (3 chars × 144hp); midline = even, up = viewer ahead
	const sparkPts = (sw: number[]) =>
		sw.map((v, i) => `${((i / (sw.length - 1)) * 64).toFixed(1)},${(8 - (Math.max(-432, Math.min(432, v)) / 432) * 7).toFixed(1)}`).join(' ');

	// THE LINE's stat totals — each column appears only when it has REAL data (an all-zero DMG column
	// reads as broken, not as zero; damage only flows on 0.3.13+ tapes)
	const lineStats = (sid: string | undefined) => {
		let dmg = 0, kos = 0;
		for (const g of games) {
			const won = g.winner === sid;
			dmg += (won ? g.wdmg : g.ldmg) ?? 0;
			kos += (won ? g.stats?.wkos : g.stats?.lkos) ?? 0;
		}
		return { dmg, kos };
	};
	const lStat = $derived(lineStats(left?.steamid));
	const rStat = $derived(lineStats(right?.steamid));
	const showDmg = $derived(lStat.dmg + rStat.dmg > 0);
	const showKos = $derived(lStat.kos + rStat.kos > 0);

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

	// ▶ per-game replay: the row for the resolver + the chrome for the sheet (server-resolved names/ratings/teams —
	// never read from the tape). Seats (P1/P2) are UNKNOWN in the session payload → skins stay stock until the
	// server exposes the reporter's side per game.
	const replayRow = (g: Game) => ({ match_key: g.match_key, session_id: r.session_id, ts: g.ts ?? 0 });
	const replayMeta = (g: Game, i: number): ReplayMeta => {
		const rightWon = g.winner === right?.steamid;
		const side = (p: Player | undefined, team: number[]) => ({
			steamid: p?.steamid ?? '',
			name: p?.name,
			avatar: p?.avatar,
			cc: p?.cc,
			rating: p?.rating ?? null,
			games: p?.games ?? null,
			team
		});
		return {
			a: side(left, teamOf(g, left?.steamid ?? '')),
			b: side(right, teamOf(g, right?.steamid ?? '')),
			winner: rightWon ? 'b' : 'a',
			gameNo: (g.match_index ?? i) + 1,
			mode: '',
			ts: g.ts ?? 0,
			durationS: g.duration_s,
			sessionId: r.session_id,
			key: g.match_key ?? `${r.session_id ?? ''}#${i}`
		};
	};
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
			{@const won = g.winner === (seat ?? right?.steamid)}
			{@const rw = rows[i]}
			{@const aThem = assistOf(g, left?.steamid ?? '')}
			{@const aMine = assistOf(g, right?.steamid ?? '')}
			{@const gs2 = gstats[i]}
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
					{#if gs2?.fb === 'l'}<i class="fb" title="First blood">⚡</i>{/if}
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
					{#if gs2?.fb === 'r'}<i class="fb" title="First blood">⚡</i>{/if}
				</span>
				<b class="wl" class:w={won}>{won ? 'W' : 'L'}</b>
				<!-- ▶ the replay for THIS game (opens the app-wide ReplaySheet) -->
				<span class="rep"><ReplayAffordance row={replayRow(g)} meta={replayMeta(g, i)} /></span>
				<!-- deck two: the game's TRUE stats (tape-derived, agent 0.3.13+), left–right in row order;
				     older games keep the legacy neutral combo line. Flair is the winner's, so it reads
				     directional; the momentum line is re-signed so UP = the viewer's seat ahead. -->
				<span class="gs">
					{#if gs2?.dur}<span class="st">{mss(gs2.dur)}</span>{/if}
					{#if gs2?.dmg}<span class="st">DMG {gs2.dmg.l}–{gs2.dmg.r}</span>{/if}
					{#if gs2?.chip}<span class="st dim2">CHIP {gs2.chip.l}–{gs2.chip.r}</span>{/if}
					{#if gs2?.kos}<span class="st dim2">KO {gs2.kos.l}–{gs2.kos.r}</span>{/if}
					{#if gs2?.combo}
						<span class="st">{gs2.combo.hits} HIT{gs2.combo.char >= 0 ? ` · ${charTag(gs2.combo.char)}` : ' COMBO'}</span>
					{/if}
					{#if g.ocv}<span class="st fl ocv" class:mine={won}>{won ? 'OCV' : "OCV'D"}</span>{/if}
					{#if g.perfect}<span class="st fl" class:mine={won}>{won ? 'PERFECT' : "PERF'D"}</span>{/if}
					{#if g.comeback}<span class="st fl" class:mine={won}>{won ? 'COMEBACK' : 'REVERSED'}</span>{/if}
					{#if gs2?.spark}
						<svg class="spark" viewBox="0 0 64 16" aria-hidden="true">
							<line x1="0" y1="8" x2="64" y2="8" class="mid" />
							<polyline points={sparkPts(gs2.spark)} class="ln2" />
							<circle cx="64" cy={8 - (Math.max(-432, Math.min(432, gs2.spark[gs2.spark.length - 1])) / 432) * 7} r="1.6" class="dot" class:w={won} />
						</svg>
					{/if}
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
				<tr><th class="nm2">THE LINE</th><th>W</th><th>L</th>{#if showDmg}<th>DMG</th>{/if}{#if showKos}<th>KOs</th>{/if}<th>TAKEN</th><th>GIVEN</th><th class="netc">NET</th></tr>
			</thead>
			<tbody>
				<tr>
					<td class="nm2">{left?.name ?? 'Player'}</td>
					<td>{lLine.w}</td><td>{lLine.l}</td>
					{#if showDmg}<td>{lStat.dmg}</td>{/if}{#if showKos}<td>{lStat.kos}</td>{/if}
					<td>+{lLine.taken}</td><td>−{lLine.given}</td>
					<td class="netc" class:up={lLine.net > 0}>{lLine.net > 0 ? '+' : ''}{lLine.net}</td>
				</tr>
				<tr>
					<td class="nm2">{right?.name ?? 'Player'}</td>
					<td>{rLine.w}</td><td>{rLine.l}</td>
					{#if showDmg}<td>{rStat.dmg}</td>{/if}{#if showKos}<td>{rStat.kos}</td>{/if}
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
		color: var(--live);
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
	/* names are standard modern text — real names run long; the italic voice stays on scores/marks */
	.nm {
		font-weight: 700;
		font-size: 15px;
		line-height: 1.2;
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
	.rep {
		display: inline-flex;
		align-items: center;
		margin-left: 6px;
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
		flex-wrap: wrap; /* a full stat strip wraps rather than hard-clipping mid-word ("23 HIT · STOR") */
		align-items: baseline;
		gap: 2px 12px;
		margin-top: 4px;
		padding-top: 3px;
		border-top: 1px dashed color-mix(in srgb, var(--line) 80%, transparent);
		font-size: 8.5px;
		letter-spacing: 0.11em;
		color: var(--dim);
		white-space: nowrap;
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
		color: color-mix(in srgb, var(--molten) 55%, var(--faint));
	}
	.fl.ocv.mine {
		color: var(--molten);
	}
	/* secondary stats sit a step quieter than DMG/combo so the strip keeps a reading order */
	.st.dim2 {
		color: var(--faint);
	}
	/* first blood — a bolt at the trailing edge of the side that drew it (molten: it's a violence marker) */
	.fb {
		font-style: normal;
		font-size: 10px;
		align-self: center;
		color: var(--molten);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--molten) 50%, transparent));
	}
	/* momentum sparkline — the game's health swing; midline = even, UP = the viewer's seat ahead */
	.spark {
		width: 64px;
		height: 16px;
		flex: none;
		align-self: center;
	}
	.spark .mid {
		stroke: color-mix(in srgb, var(--line) 70%, transparent);
		stroke-width: 0.5;
		stroke-dasharray: 2 2;
	}
	.spark .ln2 {
		fill: none;
		stroke: var(--dim);
		stroke-width: 1;
		stroke-linejoin: round;
	}
	.spark .dot {
		fill: var(--faint);
	}
	.spark .dot.w {
		fill: var(--good);
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
		/* tight phones: shed the quiet stats from the edges inward; DMG + combo + spark keep the story */
		.st.dim2 {
			display: none;
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
