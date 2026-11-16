<script lang="ts">
	import CharSprite from '$lib/components/CharSprite.svelte';
	import { charName } from '$lib/chars';
	import { shareText, nf } from '$lib/finale/derive';
	import type { TeamRow } from '$lib/finale/highlights';

	// One most-played team: rank, three sprites, names, a bar relative to the most played team, and usage only.
	let { t, rank, max }: { t: TeamRow; rank: number; max: number } = $props();
	const names = $derived(t.team.map(charName).join(' / '));
</script>

<div class="team">
	<span class="rk2">{rank}</span>
	<span class="tms" role="img" aria-label={names}>
		{#each t.team as id, i (i)}<span class="tsp"><CharSprite {id} still /></span>{/each}
	</span>
	<span class="ts">{#if t.share}{shareText(t.share)}<small>of teams</small>{/if}</span>
	<span class="tn">{names}</span>
	<span class="tp">{#if t.players}Played by {nf(t.players)} players{/if}</span>
	{#if t.share}<span class="tr" style="grid-column:2/4" aria-hidden="true"><i class="fl" style="--w:{(100 * t.share) / max}%"></i></span>{/if}
</div>
