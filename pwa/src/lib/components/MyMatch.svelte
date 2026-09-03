<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { matchfeed } from '$lib/stores/matchfeed.svelte';
	import { apiGet } from '$lib/net.svelte';
	import type { Profile } from '$lib/stores/profile.svelte';
	import PlayerPlate from './PlayerPlate.svelte';
	import OpponentPlate from './OpponentPlate.svelte';
	import { agent } from '$lib/stores/agent.svelte';
	import { hosts } from '$lib/stores/hosts.svelte';

	// ▬ YOUR MATCH strip (LIVE-TAB-SPEC §3) — replaces the big-VS scoreboard. One 44 px row: you (tag
	// density) · set score · OpponentPlate (alias, a.k.a., rank, H2H win-rate) · state pill · THE TAPE ›.
	// The gold hero VS and the ghost VS watermark are RETIRED (UI-REDESIGN adjudication 3: "a second big VS
	// is the exact redundancy we're deleting"); team chips + the intel strip left this tab (they live on the
	// profile/matchup surfaces). Same data sources as before: presence + live score from the `nowPlaying`
	// feed (SSE); the opponent's avatar/flag/aliases from /rr/profile; H2H from /rr/matchup.
	let { onTape = null }: { onTape?: ((sessionId: string) => void) | null } = $props();

	interface Matchup {
		win_chance?: number;
		h2h?: { wins: number; losses: number };
	}

	const me = $derived(auth.steamid);
	// An online host node REFEREES (spectates) — it renders nothing here (the cabinet banner is its surface).
	const isHost = $derived(!!me && !!hosts.byId(me));
	// The live now-playing row that includes me (live wins/ratings/session). Undefined = idle.
	const mine = $derived(me ? matchfeed.nowPlaying.find((p) => p.a === me || p.b === me) : undefined);
	const oppId = $derived(mine ? (mine.a === me ? mine.b : mine.a) : '');

	let oppProfile = $state<Profile | null>(null);
	let mu = $state<Matchup | null>(null);
	let fetchedFor = $state('');
	let reqId = 0;

	// Pull just what the feed can't give us: the opponent's avatar/flag/aliases (profile) and the H2H tally.
	// Refetch when the opponent changes OR a game lands for this pair (the set-score total is the signal).
	$effect(() => {
		const opp = oppId;
		const my = me;
		if (!opp || !my) {
			oppProfile = null;
			mu = null;
			fetchedFor = '';
			return;
		}
		const stamp = `${opp}|${Object.values(mine?.wins ?? {}).reduce((a, b) => a + b, 0)}`;
		if (stamp === fetchedFor) return;
		const rq = ++reqId;
		Promise.all([
			apiGet<Profile>(`/rr/profile?steamid=${encodeURIComponent(opp)}`).catch(() => null),
			apiGet<Matchup>(`/rr/matchup?me=${encodeURIComponent(my)}&opp=${encodeURIComponent(opp)}`).catch(() => null)
		]).then(([op, m]) => {
			if (rq !== reqId) return;
			oppProfile = op;
			mu = m && !(m as { error?: unknown }).error ? m : null;
			fetchedFor = stamp;
		});
	});

	const games = (p: Profile | null) => (p ? (p.wins ?? 0) + (p.losses ?? 0) : 0);
	const shortId = (sid: string) => (sid ? `…${sid.slice(-5)}` : 'Player');
	const myName = $derived(auth.me?.name || (me ? shortId(me) : 'You'));
	// names — the live feed's name map, then profile, then a shortened id (server resolver = disp_name)
	const oppName = $derived(mine?.names?.[oppId] || oppProfile?.name || shortId(oppId));
	const oppAka = $derived(((oppProfile as { aliases?: string[] } | null)?.aliases ?? []) as string[]);
	const myRating = $derived(mine?.ratings?.[me ?? ''] ?? auth.me?.rating ?? 1000);
	const oppRating = $derived(mine?.ratings?.[oppId] ?? oppProfile?.rating ?? 1000);
	const myGames = $derived(games(auth.me as Profile | null));
	const oppGames = $derived(games(oppProfile));

	const myWins = $derived(mine?.wins?.[me ?? ''] ?? 0);
	const oppWins = $derived(mine?.wins?.[oppId] ?? 0);
	const hasScore = $derived(myWins > 0 || oppWins > 0);
	const gameNo = $derived(myWins + oppWins + 1);

	const inMatch = $derived(!!(me && mine));
	const agentReported = $derived(agent.reporting);
	const h2h = $derived(mu ? { wins: mu.h2h?.wins ?? 0, losses: mu.h2h?.losses ?? 0 } : null);
</script>

{#if isHost || !me}
	<!-- host nodes referee; signed-out viewers get the masthead + LIVE RESULTS (the sign-in door is the top bar) -->
{:else if inMatch}
	<section class="ym" aria-label="Your current match">
		<span class="you">
			<span class="lab">Your match</span>
			<PlayerPlate steamid={me ?? ''} name={myName} avatar={auth.me?.avatar as string | undefined} cc={auth.me?.cc} rating={myRating} games={myGames || null} density="tag" link={false} />
		</span>
		<span class="score" title="Set score (live)">
			{#if hasScore}
				<span class="lbl">set</span><b>{myWins}</b><span class="d">–</span><b class="them">{oppWins}</b>
			{/if}
			<span class="lbl gm">game {gameNo}</span>
		</span>
		<OpponentPlate steamid={oppId} name={oppName} aliases={oppAka} avatar={oppProfile?.avatar} cc={oppProfile?.cc} rating={oppRating} games={oppGames || null} {h2h} />
		<span class="state">
			<span class="pill live"><span class="dot" aria-hidden="true"></span>In match</span>
			{#if onTape && mine?.session_id}
				<button type="button" class="tape" onclick={() => onTape?.(mine?.session_id ?? '')}>THE TAPE ›</button>
			{/if}
		</span>
	</section>
{:else}
	<!-- idle: one quiet line (agent-aware — the web can't read game memory; "in a match" comes from the feed) -->
	<section class="ym idle" class:off={!agentReported} aria-label="Your current match">
		<span class="lab">Your match</span>
		<span class="idot" aria-hidden="true"></span>
		<span class="itxt">{agentReported ? 'looking for opponent' : 'start Retro Receipts to sync your match'}</span>
	</section>
{/if}

<style>
	.ym {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.4fr) auto;
		align-items: center;
		gap: 14px;
		min-height: 44px;
		padding: 0 14px;
		margin: 10px 0;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: linear-gradient(90deg, var(--p1-soft), transparent 30%, transparent 70%, var(--p2-soft)), var(--panel);
	}
	.lab {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
		white-space: nowrap;
	}
	.you {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	/* the set score is the strip's only heavy-italic voice (commandment 7) */
	.score {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		color: var(--dim);
		white-space: nowrap;
	}
	.score .lbl {
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.score .gm {
		margin-left: 4px;
	}
	.score b {
		font-style: italic;
		font-weight: 900;
		font-size: 24px;
		line-height: 1;
		color: var(--gold);
		font-variant-numeric: tabular-nums;
	}
	.score b.them {
		color: var(--ink);
	}
	.score .d {
		opacity: 0.5;
		font-size: 16px;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--live);
		box-shadow: 0 0 8px var(--live);
	}
	.tape {
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		color: var(--dim);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 5px 9px;
		background: var(--panel-2);
		cursor: pointer;
		white-space: nowrap;
	}
	.tape:hover {
		color: var(--ink);
		border-color: color-mix(in srgb, var(--gold) 35%, var(--line));
	}
	/* idle line — 36 px, gold dot while the agent is looking, dim when there is no agent */
	.ym.idle {
		display: flex;
		min-height: 36px;
		gap: 10px;
		background: var(--panel);
	}
	.idot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--gold);
		box-shadow: 0 0 8px var(--gold);
		flex: none;
	}
	.ym.idle.off .idot {
		background: var(--faint);
		box-shadow: none;
	}
	.itxt {
		font-size: 12.5px;
		color: var(--dim);
		font-style: italic;
	}
	.ym.idle.off .itxt {
		color: var(--faint);
	}
	@media (prefers-reduced-motion: no-preference) {
		.pill .dot,
		.ym.idle:not(.off) .idot {
			animation: ympulse 1.4s ease-in-out infinite;
		}
	}
	@keyframes ympulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
	/* phones: 64 px, the score stacks between the two plates, the pill hangs on its own row */
	@media (max-width: 720px) {
		.ym {
			grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
			grid-template-areas:
				'you score opp'
				'state state state';
			min-height: 64px;
			padding: 8px 12px;
			row-gap: 6px;
		}
		.you {
			grid-area: you;
			flex-direction: column;
			align-items: flex-start;
			gap: 3px;
		}
		.score {
			grid-area: score;
			flex-direction: column;
			align-items: center;
			gap: 2px;
		}
		.ym > :global(.op) {
			grid-area: opp;
		}
		.state {
			grid-area: state;
			justify-content: space-between;
		}
	}
</style>
