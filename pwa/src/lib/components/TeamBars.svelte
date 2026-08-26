<script lang="ts">
	import CharSprite from './CharSprite.svelte';
	import { charTag } from '$lib/chars';
	import { winrateColor } from '$lib/ranks';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import type { TeamRecord } from '$lib/stores/profile.svelte';

	// Per-team records — the player's most-used squads, IN SPRITES wearing the owner's custom skins
	// (Tris 2026-08-25: the green %-bars became sprite rows — commandment 1: teams are always sprites).
	// winrateColor stays on the percentage readout (charter: it's a data-viz ramp, not an outcome color).
	// `steamid` = the profile owner; the page's loadout prime covers it (peek never fetches).
	let {
		teams = [],
		steamid = '',
		limit = 8
	}: { teams?: TeamRecord[]; steamid?: string; limit?: number } = $props();

	const lo = $derived(loadouts.peek(steamid));
	const rows = $derived(
		teams.slice(0, limit).map((t) => {
			const games = t.games || 0;
			const wins = t.wins || 0;
			const wr = games ? Math.round((100 * wins) / games) : 0;
			const ids = t.team.split(',').filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
			return { key: t.team, ids, games, wins, losses: games - wins, wr, col: winrateColor(wr) };
		})
	);
</script>

<div class="teams">
	{#each rows as t (t.key)}
		<div class="team">
			<span class="squad">
				{#each t.ids.slice(0, 3) as id, k (k)}
					<span class="chip" title={charTag(id)}><CharSprite {id} palette={lo?.[id] ?? null} alt={charTag(id)} /></span>
				{/each}
			</span>
			<span class="tr">
				<b class="num">{t.wins}</b><i>–</i><b class="num">{t.losses}</b>
				· <b class="pct" style="color:{t.col}">{t.wr}%</b>
				<span class="gp">{t.games} games</span>
			</span>
		</div>
	{/each}
</div>

<style>
	.teams {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
	}
	.team {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 7px 13px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
	}
	.team:last-child {
		border-bottom: none;
	}
	.squad {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		min-width: 0;
	}
	.chip {
		display: block;
		width: 44px;
		height: 44px;
	}
	.tr {
		font-size: 12px;
		font-weight: 700;
		color: var(--dim);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.tr i {
		font-style: normal;
		color: var(--faint);
		margin: 0 1px;
	}
	.tr .pct {
		font-weight: 900;
	}
	.tr .gp {
		display: block;
		font-size: 10px;
		font-weight: 600;
		color: var(--faint);
		margin-top: 2px;
	}
	@media (max-width: 480px) {
		.chip {
			width: 36px;
			height: 36px;
		}
	}
</style>
