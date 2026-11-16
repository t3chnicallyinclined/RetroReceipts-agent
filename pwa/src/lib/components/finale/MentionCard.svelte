<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import Flag from '$lib/components/Flag.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { ordinal, type MentionView } from '$lib/finale/derive';
	import { RANK_TIERS, tierOf } from '$lib/ranks';

	// A player who finished outside the top 8 but sits in the top three of two or more of the season's boards.
	let { view, season, only = false }: { view: MentionView; season: string; only?: boolean } = $props();
	const m = $derived(view.mention);
	// the tier comes from the server's slug when given; RankBadge takes a rating, so use the tier's floor rating
	const tierName = $derived(RANK_TIERS.find((t) => t.n.toLowerCase() === m.tier)?.n);
	const badgeRating = $derived(tierName ? (RANK_TIERS.find((t) => t.n === tierName)?.lo ?? 1000) + 1 : tierOf(1000).lo);
</script>

<div class="card ment rv" class:only>
	<div class="who">
		<Avatar url={m.player.avatar} size={56} alt="" />
		<div style="min-width:0">
			<span class="rail">On {view.chips.length} of the season’s boards</span>
			<a class="nm2" href="{base}/u/{encodeURIComponent(m.player.steamid)}?season={encodeURIComponent(season)}">{m.player.name}</a>
			<div class="tl" style="margin-top:3px;flex-wrap:wrap">
				{#if m.player.cc}<Flag cc={m.player.cc} w={16} />{/if}
				{#if tierName}<span class="tier"><RankBadge rating={badgeRating} size={18} /><span class="rk-{m.tier}">{tierName}</span></span>{/if}
				{#if m.place}<span class="dimp">Finished {ordinal(m.place)}</span>{/if}
			</div>
		</div>
	</div>
	<ul class="chips">
		{#each view.chips as c (c.key)}
			<li class:lead={c.rank === 1}><span class="cv2">{#if c.rank}<span class="rt2">#{c.rank}</span>{/if}{c.value}</span><span class="cl2">{c.label}</span></li>
		{/each}
	</ul>
</div>
