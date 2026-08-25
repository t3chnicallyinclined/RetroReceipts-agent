<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import RankBadge from './RankBadge.svelte';
	import CharSprite from './CharSprite.svelte';
	import { rankOf } from '$lib/ranks';
	import { loadouts } from '$lib/stores/loadouts.svelte';

	// ⬢ PLAYERPLATE — THE identity atom of the Arena Card System. Every surface that shows a player
	// renders through this (the audit found 14 hand-rolled clusters at 12 avatar sizes).
	//
	// Densities (fixed — a new size is a design-system change, not a per-surface choice):
	//   tag   → 20px avatar, inline: flag · name · rating          (mono contexts, seats, pickers)
	//   plate → 28px avatar, stacked: name / flag·tier·rating       (inside banners & cards)
	//   hero  → 56px avatar, + preferred-team sprites at 68px       (profile/tape heads, podium)
	//
	// Rules enforced here so surfaces can't drift: flag ALWAYS before the name; rating always bare mono
	// digits; tier derived client-side from rating+games (never a server string); team sprites wear the
	// OWNER's custom skins (loadouts store peek — prime()d by list surfaces); name links to the profile
	// when the id is a real SteamID.
	let {
		steamid = '',
		name = '',
		avatar = '',
		cc = '',
		rating = null,
		games = null,
		team = null,
		density = 'plate',
		link = true,
		won = false,
		align = 'left'
	}: {
		steamid?: string;
		name?: string;
		avatar?: string;
		cc?: string;
		rating?: number | null;
		games?: number | null;
		/** preferred/picked team as char ids — rendered at hero density (or when explicitly passed at plate) */
		team?: number[] | null;
		density?: 'tag' | 'plate' | 'hero';
		link?: boolean;
		/** winner emphasis — the name takes gold (charter: gold marks the winner) */
		won?: boolean;
		align?: 'left' | 'right';
	} = $props();

	const is17 = $derived(/^\d{17}$/.test(steamid));
	const shown = $derived(name || (is17 ? `…${steamid.slice(-5)}` : 'Player'));
	const tier = $derived(rating != null ? rankOf(rating, games ?? 999) : null);
	const lo = $derived(team?.length ? loadouts.peek(steamid) : null);
	const AV = { tag: 20, plate: 28, hero: 56 } as const;
	const SPR = { tag: 0, plate: 48, hero: 68 } as const;
</script>

{#snippet inner()}
	<Avatar url={avatar} size={AV[density]} alt={shown} />
	{#if density === 'tag'}
		{#if cc}<Flag {cc} w={12} />{/if}
		<span class="nm tagnm" class:won>{shown}</span>
		{#if rating != null}<span class="rt">{rating}</span>{/if}
	{:else}
		<span class="col" class:r={align === 'right'}>
			<span class="nm" class:won class:big={density === 'hero'}>{shown}</span>
			<span class="sub">
				{#if cc}<Flag {cc} w={density === 'hero' ? 14 : 12} />{/if}
				{#if tier}<span class="tiern">{tier.n.toUpperCase()}</span>{/if}
				{#if rating != null}<span class="rt">{rating}</span>{/if}
				{#if rating != null}<RankBadge {rating} games={games ?? 999} size={density === 'hero' ? 18 : 14} />{/if}
			</span>
			{#if team?.length}
				<span class="team" class:r={align === 'right'}>
					{#each team.slice(0, 3) as id, i (i)}
						<span class="sbox" style="width:{SPR[density]}px;height:{SPR[density]}px"><CharSprite {id} still palette={lo?.[id] ?? null} /></span>
					{/each}
				</span>
			{/if}
		</span>
	{/if}
{/snippet}

{#if link && is17}
	<a class="pp d-{density}" class:ra={align === 'right'} href="{base}/u/{steamid}">{@render inner()}</a>
{:else}
	<span class="pp d-{density}" class:ra={align === 'right'}>{@render inner()}</span>
{/if}

<style>
	.pp {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}
	.pp.ra {
		flex-direction: row-reverse;
	}
	.pp.d-hero {
		gap: 12px;
	}
	.col {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.col.r {
		align-items: flex-end;
		text-align: right;
	}
	.nm {
		font-style: italic;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 15px;
		line-height: 1.1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	a.pp:hover .nm {
		color: var(--gold);
	}
	.nm.big {
		font-size: 21px;
	}
	/* charter: gold marks the winner — never green names, never red losers */
	.nm.won {
		color: var(--gold);
	}
	.tagnm {
		font-size: 13px;
		font-weight: 800;
	}
	.sub {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 1px;
	}
	.tiern {
		font-family: ui-monospace, monospace;
		font-size: 8.5px;
		letter-spacing: 0.1em;
		color: var(--dim);
	}
	.rt {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.team {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		margin-top: 5px;
	}
	.team.r {
		flex-direction: row-reverse;
	}
	.sbox {
		display: block;
	}
</style>
