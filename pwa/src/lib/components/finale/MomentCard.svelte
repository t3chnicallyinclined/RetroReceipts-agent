<script lang="ts">
	import CharSprite from '$lib/components/CharSprite.svelte';
	import { charName } from '$lib/chars';
	import { momentFigure, momentTitle, momentWho, type Moment } from '$lib/finale/moments';
	import SetLink from './SetLink.svelte';

	// One game behind one of the season's records: the figure, who, the teams, and ONE action (SetLink decides which,
	// from the tape state). Plain text and sprites only: names are user text.
	let { m }: { m: Moment } = $props();
	const who = $derived(momentWho(m));
	const win = $derived(m.wteam.map(charName).join(' / '));
	const lose = $derived(m.lteam.map(charName).join(' / '));
</script>

<div class="card rv mcard" data-kind={m.kind}>
	<span class="rail">{momentTitle(m)}</span>
	<b class="big">{momentFigure(m)}</b>
	{#if who}<p class="mwho">{who}</p>{/if}
	{#if m.wteam.length}
		<div class="mteams">
			<span class="mtm" role="img" aria-label={win}>{#each m.wteam as id, i (i)}<span class="tsp"><CharSprite {id} still /></span>{/each}</span>
			{#if m.loser && m.lteam.length}<span class="mvs" aria-hidden="true">vs</span><span class="mtm" role="img" aria-label={lose}>{#each m.lteam as id, i (i)}<span class="tsp"><CharSprite {id} still /></span>{/each}</span>{/if}
		</div>
	{/if}
	<SetLink sessionId={m.sessionId} matchKey={m.matchKey} tapeState={m.tape} winner={m.winner?.steamid} who={who} info={{ ts: m.ts, durationS: m.durationS, winner: m.winner, loser: m.loser, wteam: m.wteam, lteam: m.lteam }} />
</div>
