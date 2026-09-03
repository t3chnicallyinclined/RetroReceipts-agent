<script lang="ts">
	import ReceiptPaper from './ReceiptPaper.svelte';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import { base } from '$app/paths';
	import { apiGet } from '$lib/net.svelte';
	import ReplayAffordance from './ReplayAffordance.svelte';
	import type { ReplayMeta } from './ReplayEmbed.svelte';

	// 🧾 PER-MATCH RECEIPT — the atomic shareable unit, rendered as an ARENA slip: a stat-card head over a
	// printed register body. The head is the brag; everything under it is the proof.
	//
	// The escrow trail and the CHAIN OF CUSTODY block are the point of the artifact — a screenshot can be
	// faked; a ledger showing both stakes in and the payout out, plus a frame tape the server can
	// independently derive the winner from, cannot. Both are rendered as literal line items, not summarised.
	//
	// EVERY provenance field is OPTIONAL. The server exposes them incrementally, so each block renders only
	// when its data is actually present: the receipt is correct against today's payload and gets richer as
	// fields land, and it never prints a heading over nothing.
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
	type Game = { n?: number; winner?: string; wname?: string; ocv?: boolean; perfect?: boolean; comeback?: boolean };
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
		locked_ms?: number;
		settled_ms?: number;
		winner?: string;
		challenger?: Person;
		acceptor?: Person | null;
		score?: { challenger?: number; acceptor?: number };
		games?: Game[];
		ledger?: Entry[];
		verified?: boolean;
		// ── optional provenance, exposed incrementally server-side ──
		mid?: string;
		session_id?: string;
		match_index?: number;
		origin?: string;
		counted?: boolean;
		wside?: number;
		lside?: number;
		confirmed_by?: string[];
		attested?: boolean;
		contests?: number;
		tape?: {
			on_file?: boolean;
			frame_count?: number;
			synthetic_frames?: number;
			reporter?: string;
			side?: number;
			ver?: string;
			schema?: number | string;
			set_start?: [number, number] | null;
			set_end?: [number, number] | null;
			winner_matches?: boolean;
		} | null;
	};

	let { r }: { r: MatchReceiptData } = $props();

	const ch = $derived(r.challenger);
	const ac = $derived(r.acceptor ?? null);
	const games = $derived(r.games ?? []);
	// ▶ replays: /rr/session?id= carries each game's match_key (the money receipt's own game list doesn't) — one read
	let setKeys = $state<Record<number, { match_key?: string; ts?: number; winner?: string; wteam?: number[]; lteam?: number[] }>>({});
	let setFor = '';
	$effect(() => {
		const sid = r.session_id;
		if (!sid || sid === setFor) return;
		setFor = sid;
		void apiGet<{ games?: { match_index?: number; match_key?: string; ts?: number; winner?: string; wteam?: number[]; lteam?: number[] }[] }>(
			`/rr/session?id=${encodeURIComponent(sid)}`,
			{ ttl: 60_000 }
		)
			.then((j) => {
				const m: typeof setKeys = {};
				for (const g of j?.games ?? []) if (g.match_index != null) m[g.match_index] = g;
				setKeys = m;
			})
			.catch(() => (setKeys = {}));
	});
	const replayMeta = (n: number): ReplayMeta => {
		const g = setKeys[n];
		const ch: Partial<Person> = r.challenger ?? {};
		const ac: Partial<Person> = r.acceptor ?? {};
		const chWon = g?.winner ? g.winner === ch.steamid : false;
		const team = (won: boolean) => (won ? g?.wteam : g?.lteam) ?? [];
		return {
			a: { steamid: ch.steamid ?? '', name: ch.name, team: team(chWon) },
			b: { steamid: ac.steamid ?? '', name: ac.name, team: team(!chWon) },
			winner: chWon ? 'a' : 'b',
			gameNo: n + 1,
			mode: 'money',
			ts: g?.ts ?? r.settled_ms ?? 0,
			sessionId: r.session_id,
			key: g?.match_key ?? `${r.session_id ?? ''}#${n}`
		};
	};
	const ledger = $derived(r.ledger ?? []);
	const tape = $derived(r.tape ?? null);

	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = (ms?: number) => {
		if (!ms) return '';
		const d = new Date(ms);
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	};
	// Only meaningful with both ends: a set that never settled has no duration, not a zero one.
	const duration = $derived.by(() => {
		const a = r.locked_ms || r.created_ms;
		const b = r.settled_ms;
		if (!a || !b || b <= a) return '';
		const s = Math.round((b - a) / 1000);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
	});

	const who = (id?: string) => {
		if (!id) return '—';
		if (id.startsWith('mescrow:')) return 'ESCROW';
		if (ch && id === ch.steamid) return (ch.name || 'CHALLENGER').toUpperCase();
		if (ac && id === ac.steamid) return (ac.name || 'ACCEPTOR').toUpperCase();
		return `…${id.slice(-5)}`;
	};
	// A stake leaves a player, a payout arrives — signed from the player's side so it reads like a statement.
	const sign = (e: Entry) => (e.kind === 'match-stake' ? '-' : '+');
	const sideName = (n?: number) => (n === 1 ? 'P1' : n === 2 ? 'P2' : '');
	const setStr = (s?: [number, number] | null) => (s ? `${s[0]}–${s[1]}` : '');

	// wside+lside must resolve to {1,2}; a clash means a bad memory read, which is worth stating not hiding.
	const sidesClean = $derived(
		r.wside && r.lside ? (r.wside === 1 && r.lside === 2) || (r.wside === 2 && r.lside === 1) : null
	);
	const witnesses = $derived(r.confirmed_by?.length ?? 0);
	const hasCustody = $derived(!!tape || sidesClean !== null);
	const hasWitness = $derived(witnesses > 0 || r.attested === true || !!r.cabinet || (r.contests ?? 0) > 0);
</script>

<ReceiptPaper sub="· MONEY MATCH ·">
	{#snippet meta()}
		<div class="meta">
			<div class="kv"><span>RECEIPT</span><span class="v">#{r.code ?? '—'}</span></div>
			{#if r.mid}<div class="kv"><span>MATCH ID</span><span class="v">{r.mid.slice(0, 18)}</span></div>{/if}
			{#if r.session_id}
				<div class="kv">
					<span>SET</span>
					<span class="v"
						>{r.origin || 'set'}{#if r.match_index != null} · game {r.match_index + 1}{/if}</span
					>
				</div>
			{/if}
			<div class="kv"><span>STATUS</span><span class="v gold">{(r.status ?? '—').toUpperCase()}</span></div>
			{#if r.counted === false}
				<div class="kv"><span>RANKED</span><span class="v faint">not counted</span></div>
			{/if}
		</div>
	{/snippet}

	{#snippet body()}
		<!-- ── ARENA HEAD: the result as a stat card; the receipt proper starts below it. ── -->
		<div class="ahead">
			{#if r.ft}<div class="ftbadge"><span>FT{r.ft}</span></div>{/if}
			<div class="vs">
				<div class="fighter" class:win={ch?.is_winner}>
					<div class="nm">{ch?.name ?? 'Challenger'}</div>
					<div class="tier">{[ch?.rank, ch?.rating].filter(Boolean).join(' · ')}</div>
				</div>
				<div class="score">
					<span class={ch?.is_winner ? 'w' : 'l'}>{r.score?.challenger ?? 0}</span>
					<span class="d">–</span>
					<span class={ac?.is_winner ? 'w' : 'l'}>{r.score?.acceptor ?? 0}</span>
				</div>
				<div class="fighter r" class:win={ac?.is_winner}>
					<div class="nm">{ac?.name ?? '— open —'}</div>
					<div class="tier">{[ac?.rank, ac?.rating].filter(Boolean).join(' · ')}</div>
				</div>
			</div>
			<div class="faces">
				<a class="fa" href="{base}/u/{ch?.steamid ?? ''}">
					<Avatar url={ch?.avatar} size={20} alt={ch?.name ?? 'Player'} />
					{#if ch?.cc}<Flag cc={ch.cc} w={12} />{/if}
				</a>
				{#if ac}
					<a class="fa" href="{base}/u/{ac.steamid}">
						{#if ac.cc}<Flag cc={ac.cc} w={12} />{/if}
						<Avatar url={ac.avatar} size={20} alt={ac.name ?? 'Player'} />
					</a>
				{/if}
			</div>
		</div>

		{#if r.created_ms || r.settled_ms}
			<div class="sec">TIMELINE</div>
			{#if r.created_ms}<div class="kv"><span>OPENED</span><span class="v">{stamp(r.created_ms)}</span></div>{/if}
			{#if r.locked_ms}<div class="kv"><span>LOCKED</span><span class="v">{stamp(r.locked_ms)}</span></div>{/if}
			{#if r.settled_ms}<div class="kv"><span>SETTLED</span><span class="v">{stamp(r.settled_ms)}</span></div>{/if}
			{#if duration}<div class="kv"><span>DURATION</span><span class="v">{duration}</span></div>{/if}
			<div class="rule dash"></div>
		{/if}

		<!-- per-game rows exist only for wager-stamped sets; otherwise the FT score stands on its own -->
		{#if games.length}
			<div class="sec">GAMES</div>
			{#each games as g, i (i)}
				<div class="li">
					<span class="k">{pad(g.n ?? i + 1)}</span>
					<span class="p">{(g.wname ?? who(g.winner)).slice(0, 16)}</span>
					<span class="fl">
						{#if g.ocv}OCV{/if}{#if g.perfect}{' '}PERFECT{/if}{#if g.comeback}{' '}COMEBACK{/if}
					</span>
					{#if r.session_id}
						{@const n = (g.n ?? i + 1) - 1}
						<span class="rep"><ReplayAffordance row={{ match_key: setKeys[n]?.match_key, session_id: r.session_id, ts: setKeys[n]?.ts ?? r.settled_ms ?? 0 }} meta={replayMeta(n)} /></span>
					{/if}
				</div>
			{/each}
			<div class="rule dash"></div>
		{/if}

		<!-- ── CHAIN OF CUSTODY — what the server can independently stand behind ── -->
		{#if hasCustody}
			<div class="sec sp">
				<span>CHAIN OF CUSTODY</span>
				{#if tape?.on_file}<b>TAPE ON FILE</b>{/if}
			</div>
			{#if tape?.frame_count != null}
				<div class="kv">
					<span>FRAMES</span>
					<span class="v"
						>{tape.frame_count.toLocaleString()}{#if tape.synthetic_frames != null} · {tape.synthetic_frames} synthetic{/if}</span
					>
				</div>
			{/if}
			{#if tape?.reporter}
				<div class="kv"><span>RECORDED BY</span><span class="v">{who(tape.reporter)} {sideName(tape.side)}</span></div>
			{/if}
			{#if tape?.ver}
				<div class="kv">
					<span>AGENT BUILD</span>
					<span class="v"
						>{tape.ver}{#if tape.schema != null} · schema {tape.schema}{/if}</span
					>
				</div>
			{/if}
			{#if tape?.set_end}
				<div class="kv"><span>SET DELTA</span><span class="v">{setStr(tape.set_start)} → {setStr(tape.set_end)}</span></div>
			{/if}
			{#if tape?.winner_matches != null}
				<div class="kv">
					<span>TAPE WINNER</span>
					<span class="v {tape.winner_matches ? 'gold' : 'warn'}">
						{tape.winner_matches ? 'matches reported ✓' : '⚠ DISAGREES WITH REPORT'}
					</span>
				</div>
			{/if}
			{#if sidesClean !== null}
				<div class="kv">
					<span>SIDES</span>
					<span class="v {sidesClean ? 'gold' : 'warn'}">
						{sidesClean ? `${sideName(r.wside)}/${sideName(r.lside)} clean ✓` : '⚠ SIDE CLASH — BAD READ'}
					</span>
				</div>
			{/if}
			<div class="rule dash"></div>
		{/if}

		{#if hasWitness}
			<div class="sec">WITNESSES</div>
			{#if witnesses > 0}
				<div class="kv">
					<span>AGREED</span>
					<span class="v gold">{witnesses >= 2 ? 'both players ✓' : `${witnesses} of 2`}</span>
				</div>
			{/if}
			{#if r.cabinet}
				<div class="kv"><span>CABINET</span><span class="v">{r.cabinet.name ?? 'ARCADE'}</span></div>
			{:else if r.arcade === false}
				<div class="kv"><span>CABINET</span><span class="v faint">— p2p, no host —</span></div>
			{/if}
			{#if r.attested}<div class="kv"><span>ATTESTED</span><span class="v">settled by an admin</span></div>{/if}
			{#if (r.contests ?? 0) > 0}
				<div class="kv"><span>DISPUTES</span><span class="v warn">{r.contests} filed</span></div>
			{/if}
			<div class="rule dash"></div>
		{/if}

		<!-- ── THE PROOF: the actual escrow movements ── -->
		<div class="sec">ESCROW TRAIL</div>
		{#if ledger.length}
			{#each ledger as e, i (e.ts ?? i)}
				<div class="li">
					<span class="k">{(e.kind ?? '').replace('match-', '').toUpperCase()}</span>
					<span class="p">{who(e.from)} → {who(e.to)}</span>
					<span class="amt" class:out={sign(e) === '-'}>{sign(e)}{e.amount ?? 0}</span>
				</div>
			{/each}
		{:else}
			<div class="none">No ledger entries recorded.</div>
		{/if}

		<div class="rule dash"></div>
		<div class="kv"><span>STAKE (EACH)</span><span class="v">🪙 {r.stake ?? 0}</span></div>
		<div class="kv"><span>POT</span><span class="v">🪙 {r.pot ?? 0}</span></div>
		{#if (r.fee ?? 0) > 0}<div class="kv"><span>HOUSE FEE</span><span class="v faint">🪙 {r.fee}</span></div>{/if}
		<div class="kv"><span>TAKE</span><span class="v big gold">🪙 {r.take ?? 0}</span></div>
	{/snippet}

	{#snippet footer()}
		<div class="stampwrap">
			{#if r.verified && tape?.on_file}
				<div class="stamp ok">✓ TAPE + LEDGER · PROVABLY REAL</div>
			{:else if r.verified}
				<div class="stamp ok">✓ STAKES AND PAYOUT ON THE LEDGER</div>
			{:else}
				<div class="stamp pend">PENDING · NOT YET SETTLED ON THE LEDGER</div>
			{/if}
		</div>
		<div class="thanks">GET THAT RECEIPT!</div>
	{/snippet}
</ReceiptPaper>

<style>
	/* ReceiptPaper's .rule is scoped to ITS markup, so a rule rendered inside these snippets needs its own
	   declaration — Svelte scopes CSS to the component that owns the element. Only .dash is used here. */
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
	.gold {
		color: var(--gold);
	}
	.faint {
		color: var(--faint);
	}
	.warn {
		color: var(--molten);
		font-weight: 700;
	}
	.big {
		font-size: 15px;
		font-weight: 900;
	}
	.sec {
		color: var(--dim);
		letter-spacing: 0.1em;
		font-size: 9.5px;
		margin: 7px 0 3px;
	}
	.sec.sp {
		display: flex;
		justify-content: space-between;
	}
	.sec b {
		color: var(--gold);
		font-weight: 600;
	}

	/* ── arena head ── */
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
		font-weight: 700;
		font-size: 14px;
		line-height: 1.1;
		color: var(--dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fighter.win .nm {
		color: var(--ink);
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
	.ftbadge {
		position: absolute;
		top: 0;
		right: 0;
		transform: skewX(-8deg) translate(6px, -1px);
		background: var(--gold);
		color: var(--gold-ink);
		font-weight: 800;
		font-size: 9.5px;
		letter-spacing: 0.12em;
		padding: 3px 12px 2px;
	}
	.ftbadge span {
		display: block;
		transform: skewX(8deg);
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

	/* ── line items ── */
	.rep {
		display: inline-flex;
		margin-left: auto;
	}
	.li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		font-size: 10.5px;
	}
	.li .k {
		flex: none;
		width: 56px;
		color: var(--dim);
		font-size: 9.5px;
	}
	.li .p {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.li .fl {
		flex: none;
		color: var(--gold);
		font-size: 10px;
		letter-spacing: 0.08em;
	}
	.amt {
		flex: none;
		font-weight: 800;
		color: var(--gold);
	}
	.amt.out {
		color: var(--dim);
	}
	.none {
		color: var(--faint);
		font-size: 11px;
		font-style: italic;
	}

	.stampwrap {
		display: flex;
		justify-content: center;
	}
	.stamp {
		font-size: 9px;
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
		font-size: 10px;
		letter-spacing: 0.2em;
		color: var(--dim);
	}
</style>
