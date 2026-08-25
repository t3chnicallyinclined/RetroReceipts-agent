<script lang="ts">
	import { base } from '$app/paths';
	import { timeAgo } from '$lib/format';
	import { teamAbbr } from '$lib/chars';
	import type { RecentMatch } from '$lib/stores/profile.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { resultcheck } from '$lib/stores/resultcheck.svelte';

	let { match, onOpen }: { match: RecentMatch; onOpen?: (sessionId: string) => void } = $props();

	const won = $derived(!!match.won);
	const myTeam = $derived(teamAbbr(match.my_team));
	const oppTeam = $derived(teamAbbr(match.opp_team));
	const combo = $derived(Number(match.combo ?? 0));
	const elo = $derived(typeof match.elo === 'number' ? match.elo : 0);
	const when = $derived(timeAgo(match.ts));
	// trust hint: ✓✓ = both AGENTS independently reported it (rare), ✓ = both players agreed, · = neither.
	const seal = $derived(match.verified ? '✓✓' : match.confirmed ? '✓' : '');
	const oppHref = $derived(
		match.opp_id && String(match.opp_id).length === 17 ? `${base}/u/${match.opp_id}` : null
	);
	// Game-mode tag — only for non-ranked rows (ranked is the default, no chip needed to avoid clutter).
	const MODE_LABEL: Record<string, string> = { lobby: 'LOBBY', tourney: 'EVENT', money: 'MONEY' };
	const mode = $derived(match.mode && match.mode !== 'ranked' ? match.mode : '');

	// SET link — opens the game-by-game set breakdown (shared SessionModal) when this row carries a
	// session_id AND the parent wired an opener. Read-only + public (a set is shareable).
	const sessionId = $derived(match.session_id ?? '');
	const canOpenSet = $derived(!!sessionId && !!onOpen);
	const setShort = $derived(sessionId ? sessionId.slice(-4) : '');

	// ⚑ Contest — only on the signed-in user's OWN matches that carry a key and aren't confirmed yet.
	const contestKey = $derived(match.match_key ?? '');
	const mine = $derived(!!auth.steamid && (auth.steamid === match.winner || auth.steamid === match.loser));
	const contestable = $derived(mine && !!contestKey && !match.confirmed);
	async function contest() {
		if (!window.confirm("Contest this result? This flags it for review — you're saying you should be the winner.")) return;
		await resultcheck.contest(contestKey);
	}
</script>

<div class="mr" class:won class:lost={!won}>
	<span class="wl" aria-label={won ? 'Win' : 'Loss'}>{won ? 'W' : 'L'}</span>

	<div class="mid">
		<div class="line1">
			{#if oppHref}
				<a class="opp" href={oppHref}>{match.opp || 'Opponent'}</a>
			{:else}
				<span class="opp">{match.opp || 'Opponent'}</span>
			{/if}
			{#if seal}<span class="seal" title={match.verified
						? 'Both agents reported this result independently'
						: 'Both players agreed on this result'}>{seal}</span>{/if}
			{#if mode}<span class="mode m-{mode}" title="Game mode">{MODE_LABEL[mode] ?? mode}</span>{/if}
		</div>
		{#if myTeam || oppTeam}
			<div class="teams" title="{myTeam || '—'} vs {oppTeam || '—'}">
				<span class="tm">{myTeam || '—'}</span>
				<i>vs</i>
				<span class="tm dim">{oppTeam || '—'}</span>
			</div>
		{/if}
	</div>

	<div class="flair">
		{#if match.ocv}<span class="chip ocv" title="One-Character Victory">OCV</span>{/if}
		{#if match.perfect}<span class="chip perf" title="Perfect">PERF</span>{/if}
		{#if match.comeback}<span class="chip cb" title="Comeback">CB</span>{/if}
		{#if combo > 0}<span class="chip combo" title="Max combo this match">🎯 {combo}</span>{/if}
	</div>

	<div class="right">
		<b class="elo" class:up={elo >= 0} class:down={elo < 0}>{elo > 0 ? '+' : ''}{elo}</b>
		{#if when}<span class="ago">{when}</span>{/if}
	</div>

	{#if canOpenSet}
		<button type="button" class="setbtn" title="View this set's full breakdown" onclick={() => onOpen?.(sessionId)}>
			<span class="sk">SET<i>#{setShort}</i></span>
		</button>
	{/if}
	{#if contestable}
		<button type="button" class="contestbtn" disabled={resultcheck.inflight.has(contestKey)} onclick={contest} title="This result is wrong — contest it">⚑</button>
	{/if}
</div>

<style>
	.mr {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto auto auto auto;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
	}
	.mr:last-child {
		border-bottom: none;
	}
	.wl {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 900;
		color: #0b0d12;
	}
	.won .wl {
		background: var(--good);
	}
	.lost .wl {
		background: transparent;
		border: 1.5px solid var(--line);
		color: var(--dim);
	}
	.mid {
		min-width: 0;
	}
	.line1 {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.opp {
		font-weight: 700;
		font-size: 13.5px;
		color: var(--ink);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	a.opp:hover {
		color: var(--gold);
	}
	.seal {
		flex: none;
		font-size: 10px;
		font-weight: 800;
		color: var(--good);
	}
	.mode {
		flex: none;
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.05em;
		padding: 1px 5px;
		border-radius: 5px;
		border: 1px solid var(--line);
		color: var(--dim);
	}
	.mode.m-tourney {
		color: var(--stream);
		border-color: color-mix(in srgb, var(--stream) 40%, var(--line));
		background: color-mix(in srgb, var(--stream) 12%, transparent);
	}
	.mode.m-money {
		color: var(--good);
		border-color: color-mix(in srgb, var(--good) 40%, var(--line));
		background: color-mix(in srgb, var(--good) 12%, transparent);
	}
	.teams {
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin-top: 1px;
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--dim);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.teams i {
		font-style: normal;
		color: var(--faint);
		font-weight: 600;
	}
	.teams .tm {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.teams .tm.dim {
		color: var(--faint);
	}
	.flair {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: none;
	}
	.chip {
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.04em;
		padding: 2px 5px;
		border-radius: 5px;
		white-space: nowrap;
		border: 1px solid var(--line);
		color: var(--dim);
	}
	.chip.ocv {
		color: var(--molten);
		border-color: color-mix(in srgb, var(--molten) 40%, var(--line));
		background: color-mix(in srgb, var(--molten) 12%, transparent);
	}
	.chip.perf {
		color: var(--molten);
		border-color: color-mix(in srgb, var(--molten) 40%, var(--line));
		background: color-mix(in srgb, var(--molten) 12%, transparent);
	}
	.chip.cb {
		color: var(--molten);
		border-color: color-mix(in srgb, var(--molten) 40%, var(--line));
		background: color-mix(in srgb, var(--molten) 12%, transparent);
	}
	.chip.combo {
		color: var(--gold);
		border-color: color-mix(in srgb, var(--gold) 34%, var(--line));
	}
	.right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		flex: none;
	}
	.elo {
		font-size: 13px;
		font-weight: 900;
		font-variant-numeric: tabular-nums;
	}
	.elo.up {
		color: var(--gold);
	}
	.elo.down {
		color: var(--dim);
	}
	.ago {
		font-size: 10px;
		color: var(--faint);
		white-space: nowrap;
	}
	/* SET button — a Cut (skewX, counter-skewed child); dim/ghost until hover (an invitation, not primary). */
	.setbtn {
		flex: none;
		font: inherit;
		padding: 5px 10px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--dim);
		border-radius: 6px;
		cursor: pointer;
		transform: skewX(-12deg);
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.setbtn .sk {
		display: inline-flex;
		align-items: baseline;
		gap: 3px;
		transform: skewX(12deg);
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.06em;
	}
	.setbtn .sk i {
		font-style: normal;
		font-size: 9px;
		font-weight: 700;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.setbtn:hover {
		color: var(--gold);
		border-color: var(--gold-soft);
		background: var(--gold-soft);
	}
	.setbtn:hover .sk i {
		color: var(--gold);
	}
	.setbtn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--gold-soft);
	}
	@media (max-width: 400px) {
		.setbtn .sk i {
			display: none;
		}
	}
	/* ⚑ Contest — icon-only Cut with the P1 (contest) accent; only on your own unconfirmed rows. */
	.contestbtn {
		flex: none;
		font: inherit;
		font-size: 12px;
		line-height: 1;
		padding: 5px 8px;
		border: 1px solid var(--p1-line);
		background: transparent;
		color: var(--p1);
		border-radius: 6px;
		cursor: pointer;
		transition: filter 0.15s, border-color 0.15s;
	}
	.contestbtn:hover:not(:disabled) {
		filter: brightness(1.1);
		border-color: var(--p1);
	}
	.contestbtn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	/* Phones: the flair chips are the first to go so the opponent name + result + ELO always fit. */
	@media (max-width: 480px) {
		.mr {
			grid-template-columns: 24px minmax(0, 1fr) auto auto auto;
			gap: 8px;
			padding: 8px 10px;
		}
		.flair {
			display: none;
		}
	}
</style>
