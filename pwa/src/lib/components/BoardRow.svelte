<script lang="ts">
	import { base } from '$app/paths';
	import RankBadge from './RankBadge.svelte';
	import Avatar from './Avatar.svelte';
	import CharSprite from './CharSprite.svelte';
	import ChallengeButton from './ChallengeButton.svelte';
	import { charTag } from '$lib/chars';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { rankOf, gamesOf, winrateOf, winrateColor } from '$lib/ranks';
	import { rankTitle } from '$lib/stores/rankinfo.svelte';
	import { statValue } from '$lib/boards';
	import Flag from '$lib/components/Flag.svelte';
	import type { Player, LeaderboardTab } from '$lib/types';

	let {
		player,
		pos,
		tab,
		me = false,
		flash = false,
		scoped = false
	}: {
		player: Player;
		pos: number | null;
		tab: LeaderboardTab;
		me?: boolean;
		flash?: boolean;
		// Lobby/Tournament scope: no rating/rank on the row → the tier cell is omitted.
		scoped?: boolean;
	} = $props();

	const r = $derived(rankOf(player.rating, gamesOf(player)));
	const w = $derived(winrateOf(player));
	const val = $derived(statValue(player, tab));
	// CONFIRMED-wins badge on the Wins board. Deliberately says "confirmed", not "verified": the number
	// IS confirmed_wins (both participants agreed, or an admin settled it). `verified` is a much stricter,
	// much rarer flag — both players' AGENTS independently reporting the same match — so it sits near zero for
	// anyone whose opponents don't run the agent. Labelling this count "verified" overstated it.
	const cw = $derived(player.confirmed_wins == null ? null : Number(player.confirmed_wins));
	const showVerified = $derived(tab === 'wins' && cw != null && cw < val);

	// Preferred team — the server's career most-played triple. Desktop: its own column; phones: under the
	// name (the column would crowd exactly the rows the mobile font fix exists for). Sprites wear the
	// owner's custom skins via the board-level batch prime (peek NEVER fetches — Board primes).
	const team = $derived(Array.isArray(player.top_team) ? player.top_team.slice(0, 3) : []);
	const lo = $derived(loadouts.peek(player.steamid));
</script>

<div class="bd-row" class:me class:flash>
	<div class="bd-rank">{pos == null ? '—' : pos}</div>
	<div class="bd-name">
		{#if player.steamid}
			<a class="lnk" href="{base}/u/{player.steamid}">
				<Avatar url={player.avatar} size={20} alt={player.name} />
				{#if player.cc}<span class="flag"><Flag cc={player.cc} w={16} /></span>{/if}
				<span class="nm">{player.name || 'Player'}</span>
			</a>
		{:else}
			<Avatar url={player.avatar} size={20} alt={player.name} />
			{#if player.cc}<span class="flag"><Flag cc={player.cc} w={16} /></span>{/if}
			<span class="nm">{player.name || 'Player'}</span>
		{/if}
		{#if me}<span class="me-tag">YOU</span>{/if}
		{#if team.length}
			<span class="subteam" aria-hidden="true">
				{#each team as id, k (k)}<span class="tchip s"><CharSprite {id} still palette={lo?.[id] ?? null} alt={charTag(id)} /></span>{/each}
			</span>
		{/if}
	</div>
	<div class="bd-team">
		{#each team as id, k (k)}<span class="tchip"><CharSprite {id} still palette={lo?.[id] ?? null} alt={charTag(id)} /></span>{/each}
	</div>
	{#if !scoped}
		<div class="bd-tier">
			<RankBadge rating={player.rating} games={gamesOf(player)} size={16} />
			<span class="rk-{r.s}" use:rankTitle={r.s}>{r.n}</span>
		</div>
	{/if}
	<div class="bd-num">
		{val}{#if showVerified}<span class="verified" title="{cw} of {val} wins confirmed by both players">✓{cw}</span>{/if}
	</div>
	<div class="bd-num dim col-wl">{player.wins ?? 0} – {player.losses ?? 0}</div>
	<div class="bd-num col-wr" style="color:{winrateColor(w)}">{w}%</div>
	<div class="bd-ch">
		{#if player.steamid}<ChallengeButton steamid={player.steamid} name={player.name || 'this player'} compact />{/if}
	</div>
</div>

<style>
	.bd-row {
		display: grid;
		grid-template-columns: var(--bd-cols);
		align-items: center;
		gap: 10px;
		padding: 0 14px;
		height: 44px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
		content-visibility: auto;
		contain-intrinsic-size: auto 44px;
	}
	.bd-row.me {
		box-shadow: 0 0 0 1.5px var(--gold) inset;
		background: linear-gradient(90deg, var(--gold-soft), transparent 45%);
	}
	.bd-rank {
		font-weight: 800;
		font-size: 13.5px;
		color: var(--gold);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.bd-name {
		font-weight: 700;
		font-size: 13.5px;
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
	}
	/* preferred team — desktop column of sprite chips; phones use .subteam under the name instead */
	.bd-team {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 3px;
	}
	.tchip {
		display: block;
		width: 24px;
		height: 24px;
	}
	.tchip.s {
		width: 15px;
		height: 15px;
	}
	.subteam {
		display: none; /* phones only */
		align-items: flex-end;
		gap: 2px;
		flex: none;
	}
	.bd-ch {
		display: flex;
		justify-content: flex-end;
	}
	.bd-name .lnk {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		overflow: hidden;
		color: inherit;
		text-decoration: none;
	}
	.bd-name .lnk:hover .nm {
		color: var(--gold);
	}
	.bd-name .nm {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.flag {
		flex: none;
	}
	.me-tag {
		font-size: 10px;
		color: var(--gold);
		font-weight: 800;
		margin-left: 6px;
		letter-spacing: 0.06em;
	}
	.bd-tier {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
		font-size: 12.5px;
	}
	.bd-num {
		font-variant-numeric: tabular-nums;
		text-align: right;
		font-size: 13px;
		font-weight: 700;
	}
	.bd-num.dim {
		color: var(--dim);
		font-size: 12px;
		font-weight: 500;
	}
	.verified {
		margin-left: 5px;
		font-size: 10px;
		font-weight: 800;
		color: var(--good);
	}
	/* one-shot flash on a row whose value changed live — ≤900ms, motion-safe only */
	.flash {
		animation: rowflash 0.85s ease-out 1;
	}
	@keyframes rowflash {
		0% {
			background: color-mix(in srgb, var(--gold) 26%, transparent);
		}
		100% {
			background: transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flash {
			animation: none;
		}
	}
	/* Match Board's mobile collapse: drop team-column · tier · W–L · win% so rank · name · stat · ⚔ stay
	   aligned — and SHRINK the typography: at 13.5px long names clipped into unreadability on phones. */
	@media (max-width: 640px) {
		.bd-row {
			gap: 8px;
			padding: 0 12px;
			height: 56px; /* two-line rows: name + team-under-name (Board mirrors via ROW_NARROW) */
			contain-intrinsic-size: auto 56px;
		}
		.bd-tier,
		.bd-team,
		.col-wl,
		.col-wr {
			display: none;
		}
		.bd-rank {
			font-size: 11px;
		}
		.bd-name {
			font-size: 11.5px;
			gap: 5px;
			flex-wrap: wrap; /* the subteam line wraps under the name */
			align-content: center;
		}
		.bd-name .lnk {
			gap: 5px;
		}
		.bd-num {
			font-size: 12px;
		}
		.subteam {
			display: flex;
			width: 100%;
			padding-left: 25px; /* align under the name, past the 20px avatar + gap */
		}
	}
</style>
