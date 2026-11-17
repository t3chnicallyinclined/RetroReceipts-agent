<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { rankOf, RANK_MIN_GAMES } from '$lib/ranks';
	import { nf } from '$lib/finale/derive';
	import { ELO_EXPLAINER, PROPS_LEAD, overallText, propsCards } from '$lib/finale/unlisted';
	import type { Unlisted } from '$lib/finale/highlights';

	// "Made rank without the app": props to the players who never ran the app and still finished high. A celebration,
	// not a call-out: it names strong results only. Cards: name, tier, rating, record, "would have finished Nth
	// overall". Then the short Elo explainer (why it is possible). Names are plain text.
	let { u, label, season }: { u: Unlisted; label: string; season: string } = $props();
	const SHOWN = 6;
	let all = $state(false);
	const cards = $derived(propsCards(u));
	const list = $derived(all ? cards : cards.slice(0, SHOWN));
</script>

<p class="ssub">{PROPS_LEAD(label)}</p>
<div class="grid2">
	{#each list as r (r.player.steamid)}
		{@const t = rankOf(r.rating, r.games ?? RANK_MIN_GAMES)}
		<div class="card ment rv">
			<div class="who">
				<Avatar url={r.player.avatar} size={48} alt="" />
				<div style="min-width:0">
					<a class="nm2" href="{base}/u/{encodeURIComponent(r.player.steamid)}?season={encodeURIComponent(season)}">{r.player.name}</a>
					<div class="tl" style="margin-top:3px;flex-wrap:wrap">
						<span class="tier"><RankBadge rating={r.rating} games={r.games ?? RANK_MIN_GAMES} size={18} /><span class="rk-{t.s}">{t.n}</span></span>
						<span class="mono" style="font-weight:800">{Math.round(r.rating)}</span>
					</div>
				</div>
			</div>
			<p class="dimp">
				{#if r.wins !== undefined && r.losses !== undefined}{nf(r.wins)} – {nf(r.losses)}{#if r.games}{' · '}{nf(r.games)} games{/if}{:else if r.games}{nf(r.games)} games{/if}
			</p>
			{#if overallText(r)}<p class="ov">{overallText(r)}</p>{/if}
		</div>
	{/each}
</div>
{#if cards.length > SHOWN && !all}
	<div class="cta" style="margin-top:10px"><button type="button" class="btn" onclick={() => (all = true)}>Show all {cards.length}</button></div>
{/if}
<div class="card elo">
	<span class="rail">Why this works</span>
	<p>{ELO_EXPLAINER}</p>
</div>
