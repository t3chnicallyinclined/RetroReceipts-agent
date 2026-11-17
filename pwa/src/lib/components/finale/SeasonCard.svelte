<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import Flag from '$lib/components/Flag.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import CharSprite from '$lib/components/CharSprite.svelte';
	import ColumnChart from './ColumnChart.svelte';
	import SetLink from './SetLink.svelte';
	import GetTheApp from '$lib/components/GetTheApp.svelte';
	import { NOT_LISTED_NOTE, NO_GAMES_LINE } from '$lib/finale/unlisted';
	import { auth } from '$lib/stores/auth.svelte';
	import { rankOf, gamesOf } from '$lib/ranks';
	import { charName } from '$lib/chars';
	import { nf, ordinal, monthLong, monthShort, dateText } from '$lib/finale/derive';
	import { mineUnranked, type Mine } from '$lib/finale/mine';

	// "Your season": signed out -> a prompt; signed in with no games -> a short note; otherwise the card. Without a
	// season_card (older server) the tier stands in for the place and opponent / best win / months are omitted.
	let { mine, loading, season, label, nextLabel, loaded }: { mine: Mine | null; loading: boolean; season: string; label: string; nextLabel?: string; loaded: boolean } = $props();
	let status = $state('');

	const r = $derived(mine ? rankOf(mine.rating, gamesOf(mine)) : null);
	const unranked = $derived(mine ? mineUnranked(mine) : false);
	const card = $derived(mine?.card ?? null);
	const shareUrl = $derived(typeof location === 'undefined' || !mine ? '' : `${location.origin}${base}/u/${encodeURIComponent(auth.steamid ?? '')}?season=${encodeURIComponent(season)}`);

	async function share() {
		const url = shareUrl;
		try {
			if (typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches) {
				await navigator.share({ url, title: `My ${label}` });
				status = '';
				return;
			}
			await navigator.clipboard.writeText(url);
			status = 'Link copied.';
		} catch {
			status = `Copy this link: ${url}`;
		}
	}
</script>

{#if !auth.authed}
	<!-- the merged "Your record" section draws the signed-out view; this card is for a signed-in viewer -->
{:else if loading || !loaded}
	<div class="empty">LOADING…</div>
{:else if !mine || !mine.found}
	<div class="card">
		<h3 class="plainh">{NO_GAMES_LINE(label)}</h3>
		<p class="dimp">{nextLabel ? `${nextLabel} is open and everyone starts fresh.` : 'More seasons are planned.'}</p>
		<GetTheApp showSignin={false} line="Download the app and just play." />
	</div>
{:else}
	<div class="you">
		<div class="who full">
			<Avatar url={mine.avatar} size={56} alt="" />
			<div style="min-width:0">
				<span class="rail">Your {label}</span>
				<div class="nm2">{mine.name}</div>
				<div class="tl" style="margin-top:3px">
					{#if mine.cc}<Flag cc={mine.cc} w={16} />{/if}
					{#if r && !unranked}<span class="tier"><RankBadge rating={mine.rating} games={gamesOf(mine)} size={16} /><span class="rk-{r.s}">{r.n}</span></span>{/if}
				</div>
			</div>
		</div>
		<div class="place">
			{#if unranked}
				Unranked<small>{gamesOf(mine)} ranked {gamesOf(mine) === 1 ? 'game' : 'games'} played, 5 needed for a rank</small>
			{:else if mine.onRoster === false && card?.overallPlace}
				{ordinal(card.overallPlace)} overall<small>You would have finished {ordinal(card.overallPlace)} overall. {NOT_LISTED_NOTE(nextLabel)}</small>
			{:else if card?.place}
				{ordinal(card.place)} place<small>of {nf(card.of ?? 0)} ranked players{card.topPct ? ` · top ${card.topPct}%` : ''}{card.place === 1 ? ' · champion' : ''}</small>
			{:else if r}
				{r.n}<small>your final tier</small>
			{/if}
		</div>
		<dl class="kv full">
			<div><dt>Final rating</dt><dd>{Math.round(mine.rating)}</dd></div>
			<div><dt>Record</dt><dd>{nf(mine.wins)} – {nf(mine.losses)}</dd></div>
			{#if mine.bestStreak}<div><dt>Best streak</dt><dd>{nf(mine.bestStreak)}</dd></div>{/if}
			{#if mine.peak}<div><dt>Highest rating</dt><dd>{Math.round(mine.peak)}</dd></div>{/if}
		</dl>
		{#if mine.team}
			<div class="full"><span class="rail">Favourite team</span>
				<div class="tl" style="margin-top:6px;flex-wrap:wrap">
					<span class="sqs" role="img" aria-label={mine.team.map(charName).join(', ')}>{#each mine.team.slice(0, 3) as id, i (i)}<span class="sq1"><CharSprite {id} still /></span>{/each}</span>
					<span class="dimp">{mine.team.slice(0, 3).map(charName).join(' / ')}</span>
				</div>
			</div>
		{/if}
		{#if card?.opponent}
			<div><span class="rail">Most played opponent</span><p style="margin-top:4px;font-weight:700">{card.opponent.name} <span class="dimp">· {nf(card.opponent.games)} games</span></p></div>
		{/if}
		{#if card?.bestWin}
			<div><span class="rail">Best win</span>
				<p style="margin-top:4px">Beat a player rated {card.bestWin.oppRating}, {card.bestWin.gap} points above you{card.bestWin.date ? `, on ${card.bestWin.date}` : ''}.</p>
				<SetLink sessionId={card.bestWin.sessionId} matchKey={card.bestWin.matchKey} tapeState={card.bestWin.tapeState} tape={card.bestWin.tape} winner={auth.steamid ?? undefined} />
			</div>
		{/if}
		{#if card && card.months.length > 1}
			<div class="full"><span class="rail">Your games by month</span>
				<ColumnChart mini aria="Your games by month" hint="Tap a month."
					cols={card.months.map((m) => ({ label: monthShort(m.m), value: m.games, msg: `${monthLong(m.m)}: ${nf(m.games)} games` }))} />
			</div>
		{/if}
		<div class="cta full">
			<button type="button" class="btn pri" onclick={share}>Share my season</button>
			<a class="btn" href="{base}/u/{encodeURIComponent(auth.steamid ?? '')}?season={encodeURIComponent(season)}">My {label} profile</a>
		</div>
		<p class="status full" role="status" aria-live="polite">{status}</p>
		{#if mine.onRoster === false}<div class="full"><GetTheApp showSignin={false} line="Download the app and just play." /></div>{/if}
	</div>
{/if}
