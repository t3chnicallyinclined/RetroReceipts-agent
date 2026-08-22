<script lang="ts">
	import { base } from '$app/paths';
	import Flag from '$lib/components/Flag.svelte';
	import { winrateColor } from '$lib/ranks';

	// Full head-to-head grid — one card per opponent (profile.vs / playerstats.vs). Mirrors the old app's
	// .pfx-h2h cards: name+flag, W–L, a winrate bar, "pct% · N games"; each links to that opponent's profile.
	// Structurally typed so either a VsRow (profile) or a Rival (playerstats) is accepted.
	interface Vs {
		opp_id: string;
		name?: string;
		cc?: string;
		wins: number;
		losses: number;
		games?: number;
	}
	let { vs = [], limit = 12 }: { vs?: Vs[]; limit?: number } = $props();

	const cards = $derived(
		vs.slice(0, limit).map((v) => {
			const wins = v.wins || 0;
			const losses = v.losses || 0;
			const games = v.games ?? wins + losses;
			const wr = games ? Math.round((100 * wins) / games) : 0;
			return {
				id: v.opp_id,
				href: v.opp_id && String(v.opp_id).length === 17 ? `${base}/u/${v.opp_id}` : null,
				name: v.name || 'Player',
				cc: v.cc,
				wins,
				losses,
				games,
				wr,
				col: winrateColor(wr)
			};
		})
	);
</script>

<div class="h2h">
	{#each cards as c (c.id)}
		<svelte:element this={c.href ? 'a' : 'div'} class="card" href={c.href}>
			<b class="hn">{#if c.cc}<span class="hf"><Flag cc={c.cc} w={16} /></span> {/if}{c.name}</b>
			<span class="hr"><b class="w">{c.wins}</b><i>–</i><b class="l">{c.losses}</b></span>
			<span class="hb"><i style="width:{c.wr}%;background:{c.col}"></i></span>
			<span class="hg">{c.wr}% · {c.games} game{c.games === 1 ? '' : 's'}</span>
		</svelte:element>
	{/each}
</div>

<style>
	.h2h {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 8px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 10px 12px;
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 11px;
		text-decoration: none;
		color: inherit;
		min-width: 0;
		transition: border-color 0.14s, transform 0.14s;
	}
	a.card:hover {
		border-color: var(--gold-soft);
		transform: translateY(-1px);
	}
	.hn {
		font-size: 12.5px;
		font-weight: 800;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hn .hf {
		font-weight: 400;
	}
	a.card:hover .hn {
		color: var(--gold);
	}
	.hr {
		font-size: 17px;
		font-weight: 900;
		font-variant-numeric: tabular-nums;
	}
	.hr .w {
		color: #4ade80;
	}
	.hr .l {
		color: #f87171;
	}
	.hr i {
		font-style: normal;
		opacity: 0.4;
		padding: 0 4px;
		font-weight: 600;
	}
	.hb {
		display: block;
		height: 4px;
		border-radius: 3px;
		background: var(--panel);
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.hb i {
		display: block;
		height: 100%;
		border-radius: 3px;
	}
	.hg {
		font-size: 10.5px;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
</style>
