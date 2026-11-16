<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import Flag from '$lib/components/Flag.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import CharSprite from '$lib/components/CharSprite.svelte';
	import CountUp from './CountUp.svelte';
	import { rankOf, gamesOf, winrateOf, RK_PLATE } from '$lib/ranks';
	import { charName } from '$lib/chars';
	import { rankTitle } from '$lib/stores/rankinfo.svelte';
	import { nf } from '$lib/finale/derive';
	import type { Player } from '$lib/types';

	// The champion: the gold of the page lives here (name, crown, rating). Honour chips only when the champion also
	// led that list. Gold marks nothing else.
	let { player, season, label, honours = [] }: { player: Player; season: string; label: string; honours?: string[] } = $props();
	const r = $derived(rankOf(player.rating, gamesOf(player)));
	const pa = $derived((RK_PLATE[r.s] ?? RK_PLATE.civilian)[0]);
	const team = $derived((Array.isArray(player.top_team) ? player.top_team : []).slice(0, 3));
</script>

<div class="champ rv" style="--pa:{pa}">
	<div class="who">
		<Avatar url={player.avatar} size={72} alt="" />
		<div style="min-width:0">
			<span class="crown"><span aria-hidden="true">👑</span> {label} champion</span>
			<a class="nm" href="{base}/u/{encodeURIComponent(player.steamid)}?season={encodeURIComponent(season)}">{player.name || 'Player'}</a>
			<div class="meta">
				{#if player.cc}<Flag cc={player.cc} w={18} />{/if}
				<span class="tier"><RankBadge rating={player.rating} games={gamesOf(player)} size={20} /><span class="rk-{r.s}" use:rankTitle={r.s}>{r.n}</span></span>
				{#if team.length}
					<span class="sqs" role="img" aria-label={team.map(charName).join(', ')}>{#each team as id, i (i)}<span class="sq1"><CharSprite {id} still /></span>{/each}</span>
				{/if}
			</div>
		</div>
	</div>
	<div class="score">
		<span class="rt"><span class="sr">Final rating </span><CountUp value={player.rating} format={(n) => String(Math.round(n))} /></span>
		<span class="rec"><b>{nf(player.wins ?? 0)}</b>W · <b>{nf(player.losses ?? 0)}</b>L · {winrateOf(player)}%</span>
	</div>
	{#if honours.length}
		<ul class="honours" aria-label="Also led the season in">{#each honours as h (h)}<li>{h}</li>{/each}</ul>
	{/if}
</div>
