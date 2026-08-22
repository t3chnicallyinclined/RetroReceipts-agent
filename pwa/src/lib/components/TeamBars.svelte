<script lang="ts">
	import { charName } from '$lib/chars';
	import { winrateColor } from '$lib/ranks';
	import type { TeamRecord } from '$lib/stores/profile.svelte';

	// Per-team win-rate bars — the player's most-used teams (profile.teams, pre-sorted by games desc). Mirrors
	// the old app's .pfx-team list; bar + pct colored by the Board win% rule (winrateColor). Derived once/load.
	let { teams = [], limit = 8 }: { teams?: TeamRecord[]; limit?: number } = $props();

	const rows = $derived(
		teams.slice(0, limit).map((t) => {
			const games = t.games || 0;
			const wins = t.wins || 0;
			const wr = games ? Math.round((100 * wins) / games) : 0;
			return {
				key: t.team,
				label: t.team
					.split(',')
					.filter(Boolean)
					.map((c) => charName(Number(c)))
					.join(' / '),
				wins,
				losses: games - wins,
				wr,
				col: winrateColor(wr)
			};
		})
	);
</script>

<div class="teams">
	{#each rows as t (t.key)}
		<div class="team">
			<span class="tn" title={t.label}>{t.label}</span>
			<span class="tr"><b class="num">{t.wins}</b><i>–</i><b class="num">{t.losses}</b> · <b class="pct" style="color:{t.col}">{t.wr}%</b></span>
			<span class="tb"><i style="width:{t.wr}%;background:{t.col}"></i></span>
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
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		column-gap: 12px;
		row-gap: 7px;
		align-items: baseline;
		padding: 10px 13px;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 55%, transparent);
	}
	.team:last-child {
		border-bottom: none;
	}
	.tn {
		grid-column: 1;
		min-width: 0;
		font-size: 12.5px;
		font-weight: 800;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tr {
		grid-column: 2;
		justify-self: end;
		font-size: 12px;
		font-weight: 700;
		color: var(--dim);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.tr i {
		font-style: normal;
		color: var(--faint);
		margin: 0 1px;
	}
	.tr .pct {
		font-weight: 900;
	}
	.tb {
		grid-column: 1 / -1;
		height: 6px;
		border-radius: 4px;
		background: var(--panel-2);
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.tb i {
		display: block;
		height: 100%;
		border-radius: 4px;
	}
</style>
