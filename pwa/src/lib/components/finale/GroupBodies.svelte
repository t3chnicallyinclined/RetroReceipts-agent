<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from '$lib/components/Avatar.svelte';
	import Flag from '$lib/components/Flag.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import ColumnChart from './ColumnChart.svelte';
	import BarList from './BarList.svelte';
	import type { Bar, Col } from '$lib/finale/types';
	import SegmentedToggle from './SegmentedToggle.svelte';
	import PercentMeter from './PercentMeter.svelte';
	import PipRun from './PipRun.svelte';
	import RatingScale from './RatingScale.svelte';
	import CharGrid from './CharGrid.svelte';
	import TeamRow from './TeamRow.svelte';
	import RivalryCard from './RivalryCard.svelte';
	import SetLink from './SetLink.svelte';
	import MomentCard from './MomentCard.svelte';
	import { momentFigure, momentOf, momentWho } from '$lib/finale/moments';
	import PlayerChip from './PlayerChip.svelte';
	import CountUp from './CountUp.svelte';
	import type { GroupId } from '$lib/finale/derive';
	import { charName } from '$lib/chars';
	import { RANK_TIERS } from '$lib/ranks';
	import { TIER_COLOR, countryName, dateText, durText, featLeaders, localHourText, monthLong, monthShort, nf, nf1, streakLeaders, tierRows, tierSentence, WEEKDAYS, type TierRow } from '$lib/finale/derive';
	import type { Highlights, Valued } from '$lib/finale/highlights';
	import type { Summary } from '$lib/seasonFinale';

	// The five explore groups' bodies. A sub-section with no data is not rendered, a number that is zero or missing
	// is dropped (the data layer already guarantees that), and there is never a win rate or an OCV stat anywhere.
	let { group, s, h, season, label }: { group: GroupId; s: Summary | null; h: Highlights | null; season: string; label: string } = $props();

	// ── totals ──
	let growKey = $state<'games' | 'newPlayers' | 'activePlayers'>('games');
	const GROW: Record<string, [string, string]> = { games: ['Games', 'games'], newPlayers: ['New players', 'players played their first game'], activePlayers: ['Active players', 'players played'] };
	const monthCols = $derived<Col[]>(
		(h?.months ?? []).flatMap((m) => {
			const v = m[growKey];
			return v === undefined ? [] : [{ label: monthShort(m.m) + (m.partialThrough ? '*' : ''), value: v, partial: !!m.partialThrough, msg: `${monthLong(m.m)}${m.partialThrough ? ` (to ${dateText(m.partialThrough) ?? ''})` : ''}: ${nf(v)} ${GROW[growKey][1]}` }];
		})
	);
	const partial = $derived(h?.months.find((m) => m.partialThrough));
	const monthHint = $derived(`Tap a month.${partial ? ` * ${monthLong(partial.m)} runs to ${dateText(partial.partialThrough) ?? ''}, when the season closed.` : ''}`);
	const facts = $derived.by(() => {
		const f: [string, string][] = [];
		const busiest = s?.busiestDay ? dateText(s.busiestDay.date) : undefined;
		if (busiest && s?.busiestDay) f.push(['Busiest day', `${busiest} · ${nf(s.busiestDay.games)} games`]);
		if (h?.peak) f.push(['Busiest hour', `${String(h.peak.hourUtc).padStart(2, '0')}:00 UTC · about ${localHourText(h.peak.hourUtc)} your time`]);
		if (h?.peak) f.push(['Busiest day of the week', WEEKDAYS[h.peak.weekday] ?? '']);
		return f.filter((x) => x[1]);
	});
	const longest = $derived(momentOf(h?.moments, 'longest_game'));
	const bestPerfect = $derived(momentOf(h?.moments, 'perfect'));
	const bestComeback = $derived(momentOf(h?.moments, 'biggest_comeback'));
	const facts2 = $derived.by(() => {
		const f: [string, string][] = [];
		if (h?.time?.timedGames) f.push(['Timed games', nf(h.time.timedGames)]);
		if (h?.time?.medianS) f.push(['A typical game', durText(h.time.medianS)]);
		if (h?.time?.longestS) f.push(['Longest game', durText(h.time.longestS)]);
		if (h?.habits?.medianGames) f.push(['Games per player', `${nf(h.habits.medianGames)} median`]);
		else if (s?.medianGames && (s.players ?? 0) > 1) f.push(['Games per player', `${nf1(s.medianGames)} median`]);
		if (h?.habits?.players100) f.push(['Played 100 or more games', `${nf(h.habits.players100)} players`]);
		if (h?.habits?.days2) f.push(['Came back on 2 or more days', `${nf(h.habits.days2)} players`]);
		if (h?.habits?.days10) f.push(['Played on 10 or more days', `${nf(h.habits.days10)} players`]);
		if (!h?.days && s?.firstMs && s?.lastMs) f.push(['First game to last game', `${dateText(s.firstMs)} to ${dateText(s.lastMs)}`]);
		return f.filter((x) => x[1] && !x[1].includes('undefined'));
	});
	const modeMax = $derived(Math.max(1, ...(s?.modes ?? []).map((m) => m.value)));

	// ── tiers ──
	let tierMode = $state<'now' | 'reached'>('now');
	const trows = $derived(h ? tierRows(h, tierMode) : []);
	const tierBars = $derived<Bar[]>(trows.map((r: TierRow) => ({ key: r.slug, label: r.name, value: r.count, color: TIER_COLOR[r.slug], text: nf(r.count), sub: `${r.pct}%`, msg: tierSentence(r, tierMode, h?.tiers?.placed ?? 0) })));
	const tierHint = $derived(h?.tiers ? `${nf(h.tiers.placed)} players finished with a rank.${h.tiers.median ? ` The middle rating was ${h.tiers.median}; the ladder ran from ${h.tiers.min} to ${h.tiers.max}.` : ''}` : '');

	// ── streaks / feats / climbers ──
	const leaders = $derived(streakLeaders(s, h));
	const streakBars = $derived<Bar[]>(leaders.map((r, i) => ({ key: r.player.steamid + i, value: r.value, text: nf(r.value), color: 'var(--good)', ref: r.player })));
	const perf = $derived(featLeaders('perfects', s, h));
	const come = $derived(featLeaders('comebacks', s, h));
	const clRows = $derived(h?.climbers?.rows ?? []);
	const clFull = $derived(clRows.length > 0 && clRows.every((r) => r.from && r.to));
	const clLo = $derived(clFull ? Math.floor((Math.min(...clRows.map((r) => r.from!)) - 30) / 50) * 50 : 0);
	const clHi = $derived(clFull ? Math.ceil((Math.max(...clRows.map((r) => r.to!)) + 30) / 50) * 50 : 1);
	const cx = (v: number) => ((100 * (v - clLo)) / (clHi - clLo)).toFixed(1);

	// ── teams ──
	const teamMax = $derived(Math.max(0.1, ...(h?.teams?.top ?? []).map((t) => t.share ?? 0)));

	// ── sets ──
	const setCols = $derived<Col[]>((h?.sets?.scores ?? []).map((x) => ({ label: x.score.replace('-', '–'), value: x.sets, msg: `${x.score.replace('-', '–')}: ${nf(x.sets)} sets${h?.sets?.full ? `, ${Math.round((100 * x.sets) / h.sets.full)}% of the full 10-game sets` : ''}` })));
	const closeSets = $derived((h?.sets?.scores ?? []).filter((x) => x.score === '6-4' || x.score === '5-5').reduce((n, x) => n + x.sets, 0));
	const setHint = $derived(h?.sets?.full ? `${nf(h.sets.full)} sets went the full 10 games.${closeSets ? ` ${nf(closeSets)} of them finished 6–4 or level at 5–5.` : ''} Tap a score.` : 'Tap a score.');

	// ── world ──
	const worldBars = $derived<Bar[]>((h?.world?.top ?? []).map((c) => ({ key: c.cc, label: countryName(c.cc), value: c.players, text: nf(c.players), msg: `${countryName(c.cc)}: ${nf(c.players)} players${h?.world?.known ? `, ${Math.round((100 * c.players) / h.world.known)}% of players with a known country` : ''}` })));
	const worldHint = $derived.by(() => {
		const w = h?.world;
		if (!w?.countries) return 'Tap a country.';
		const more = w.countries - w.top.length;
		const rest = (w.known ?? 0) - w.top.reduce((n, c) => n + c.players, 0);
		return more > 0 && rest > 0 ? `Plus ${more} more countries with ${nf(rest)} players between them. Tap a country.` : 'Tap a country.';
	});
	const tierBadge = (slug: string) => (RANK_TIERS.find((t) => t.n.toLowerCase() === slug)?.lo ?? 1000) + 1;
</script>

{#snippet who(p: Valued['player'], size?: number)}<PlayerChip {p} {season} {size} />{/snippet}

{#if group === 'season'}
	{#if (s?.modes.length ?? 0) > 1 || facts.length || facts2.length || monthCols.length > 1}
		<div class="sub" id="totals">
			<div class="shd"><h4 id="totals-h" tabindex="-1">Games, time and growth</h4></div>
			{#if s?.sets}<p class="ssub">A set is one session of up to 10 games between two players.</p>{/if}
			<div class="grid2">
				{#if monthCols.length > 1}
					<div class="card rv full">
						<div class="chd"><span class="rail">Month by month</span>
							<SegmentedToggle label="Month by month" value={growKey} onpick={(v) => (growKey = v as typeof growKey)} options={[['games', 'Games'], ['newPlayers', 'New players'], ['activePlayers', 'Active players']]} /></div>
						<ColumnChart cols={monthCols} aria={`${GROW[growKey][0]} by month`} hint={monthHint} />
					</div>
				{/if}
				{#if s && s.modes.length > 1}
					<div class="card rv"><span class="rail">Games by mode</span>
						<ul class="modes" style="margin:0" aria-label="Games by mode">
							{#each s.modes as m (m.key)}<li><span>{m.label}</span><span class="tr" aria-hidden="true"><i class="fl" style="--w:{(100 * m.value) / modeMax}%"></i></span><b>{nf(m.value)}</b></li>{/each}
						</ul></div>
				{/if}
				{#if facts.length}<dl class="facts rv">{#each facts as f (f[0])}<div><dt>{f[0]}</dt><dd>{f[1]}</dd></div>{/each}</dl>{/if}
				{#if facts2.length}<dl class="facts rv full">{#each facts2 as f (f[0])}<div><dt>{f[0]}</dt><dd>{f[1]}</dd></div>{/each}</dl>{/if}
				{#if longest}<div class="full rv"><p class="dimp" style="margin:0 0 6px">The longest game, {momentFigure(longest)}{momentWho(longest) ? `: ${momentWho(longest)}` : ''}.</p><SetLink sessionId={longest.sessionId} matchKey={longest.matchKey} tapeState={longest.tape} winner={longest.winner?.steamid} /></div>{/if}
			</div>
		</div>
	{/if}
{:else if group === 'ladder'}
	{#if h?.tiers && trows.length}
		<div class="sub" id="tiers">
			<div class="shd"><h4 id="tiers-h" tabindex="-1">The shape of the ladder</h4></div>
			<p class="ssub">A rank takes 5 ranked games. Tap a tier.</p>
			<div class="card rv">
				<div class="chd"><span class="rail">{tierMode === 'now' ? 'Where players finished' : 'How high players climbed'}</span>
					<SegmentedToggle label="Tier view" value={tierMode} onpick={(v) => (tierMode = v as typeof tierMode)} options={[['now', 'Final tier'], ['reached', 'Highest tier reached']]} /></div>
				{#key tierMode}
					<BarList rows={tierBars} lw={124} hint={tierHint}>
						{#snippet row(r)}<RankBadge rating={tierBadge(r.key)} size={16} /><span class="rk" style="--tc:{TIER_COLOR[r.key]}">{r.label}</span>{/snippet}
					</BarList>
				{/key}
			</div>
		</div>
	{/if}
	{#if leaders.length}
		<div class="sub" id="streaks">
			<div class="shd"><h4 id="streaks-h" tabindex="-1">The longest run</h4></div>
			<div class="grid2">
				<div class="card rv"><span class="rail">Longest win streak</span>
					<b class="big"><CountUp value={leaders[0].value} /> <small>{leaders[0].value === 1 ? 'win' : 'wins'} in a row</small></b>
					<PipRun count={leaders[0].value} label="{nf(leaders[0].value)} wins in a row, drawn as a run of marks" />
					{#if leaders[0].value <= 600}<p class="dimp">One mark for every win.</p>{/if}
					{@render who(leaders[0].player, 28)}
				</div>
				{#if leaders.length > 1 || h?.streaks?.reached10}
					<div class="card rv d1"><span class="rail">The longest runs</span>
						{#if leaders.length > 1}
							<BarList rows={streakBars} lw={150}>{#snippet row(r)}{#if r.ref}{@render who(r.ref, 22)}{/if}{/snippet}</BarList>
						{/if}
						{#if h?.streaks?.reached10}<p class="dimp"><b style="color:var(--ink)">{nf(h.streaks.reached10)} players</b> put together a streak of 10 or more.</p>{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if clRows.length}
		<div class="sub" id="climbers">
			<div class="shd"><h4 id="climbers-h" tabindex="-1">Biggest climbers</h4></div>
			{#if h?.climbers?.since}<p class="ssub">Rating gained between {dateText(h.climbers.since) ?? h.climbers.since} and the end of the season.</p>{/if}
			<div class="card rv">
				{#if clFull}
					<div>
						{#each clRows as r (r.player.steamid)}
							<div class="climb">
								<span class="hl">{@render who(r.player, 22)}</span>
								<span class="ln" role="img" aria-label="From {r.from} to {r.to}"><i class="s2" style="left:{cx(r.from!)}%;width:{(Number(cx(r.to!)) - Number(cx(r.from!))).toFixed(1)}%"></i><i class="d0" style="left:{cx(r.from!)}%"></i><i class="d1" style="left:{cx(r.to!)}%"></i></span>
								<b class="up">+{nf(r.delta)}</b>
								<small>{r.from} to {r.to}</small>
							</div>
						{/each}
					</div>
					<p class="dimp">Each line runs from the rating on {dateText(h?.climbers?.since) ?? 'the start date'} to the final rating, on a scale of {clLo} to {clHi}.</p>
				{:else}
					<BarList rows={clRows.map((r) => ({ key: r.player.steamid, value: r.delta, text: `+${nf(r.delta)}`, tone: 'up', color: 'var(--good)', ref: r.player }))} lw={150}>
						{#snippet row(r)}{#if r.ref}{@render who(r.ref, 22)}{/if}{/snippet}
					</BarList>
				{/if}
			</div>
		</div>
	{/if}
{:else if group === 'played'}
	{#if h && h.chars.length}
		<div class="sub" id="characters">
			<div class="shd"><h4 id="characters-h" tabindex="-1">Who got played</h4></div>
			<p class="ssub">{h.chars.every((c) => c.share > 0) ? `Every one of the ${h.chars.length} characters was played. ` : ''}The figure is the share of ranked teams that included the character. Tap one for detail.</p>
			<div class="card rv"><CharGrid chars={h.chars} /></div>
		</div>
	{/if}
	{#if h?.teams && (h.teams.top.length || h.teams.distinct)}
		{@const t = h.teams}
		<div class="sub" id="teams">
			<div class="shd"><h4 id="teams-h" tabindex="-1">The teams</h4></div>
			<p class="ssub">Share of all ranked teams fielded, and how many players used each one.</p>
			<div class="grid2">
				{#if t.top.length}
					<div class="card rv"><span class="rail">Most played teams</span>
						{#each t.top as tm, i (i)}<TeamRow t={tm} rank={i + 1} max={teamMax} />{/each}
					</div>
				{/if}
				{#if t.distinct}
					<div class="card rv d1"><span class="rail">Team make-up</span>
						<b class="big"><CountUp value={t.distinct} /> <small>different teams</small></b>
						{#if t.once}
							<p class="dimp"><b style="color:var(--ink)">{nf(t.once)}</b> fielded exactly once</p>
							<div class="split" role="img" aria-label="{nf(t.once)} of {nf(t.distinct)} teams were fielded once"><i style="width:{(100 * t.once) / t.distinct}%"></i><i></i></div>
						{/if}
						<ul class="lines">
							{#if t.top10Share && t.distinct > 10}<li><b>{Math.round(t.top10Share)}%</b> of teams fielded were one of the ten most played. The other {nf(t.distinct - 10)} teams shared the rest.</li>{/if}
							{#if t.pair?.share}<li><b>{charName(t.pair.a)}</b> and <b>{charName(t.pair.b)}</b> shared a team on <b>{Math.round(t.pair.share)}%</b> of teams.</li>{/if}
							{#if t.ordered}<li><b>{nf(t.ordered)}</b> line-ups, counting the order the characters were picked in.</li>{/if}
							{#if t.mirrors}<li><b>{nf(t.mirrors)}</b> games were mirror matches: the same three characters on both sides.</li>{/if}
						</ul>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{:else if group === 'moments'}
	{#if h?.moments?.length}
		<div class="sub" id="moment-replays">
			<div class="shd"><h4 id="moment-replays-h" tabindex="-1">The moments, with replays</h4></div>
			<p class="ssub">The games behind the season’s records. A replay is the recorded match redrawn in your browser.</p>
			<div class="moments">{#each h.moments as m (m.kind)}<MomentCard {m} />{/each}</div>
		</div>
	{/if}
	{#if h?.upset || h?.texture?.higherRatedWin || h?.texture?.firstHitWin}
		<div class="sub" id="upsets">
			<div class="shd"><h4 id="upsets-h" tabindex="-1">Favourites and giant-killers</h4></div>
			<div class="grid2">
				{#if h.upset}
					<div class="card rv"><span class="rail">Biggest upset of the season</span>
						<b class="big"><CountUp value={h.upset.gap} /> <small>rating points apart</small></b>
						<RatingScale winner={h.upset.winnerRating} opponent={h.upset.oppRating} />
						{@render who(h.upset.winner, 28)}
						<p class="dimp">Rated {h.upset.winnerRating}, beat a player rated {h.upset.oppRating}{h.upset.date ? ` on ${dateText(h.upset.date) ?? ''}` : ''}.{h.upset.over300 ? ` ${nf(h.upset.over300)} ranked wins this season came against a player rated 300 or more points higher.` : ''}</p>
						<SetLink sessionId={h.upset.sessionId} matchKey={h.upset.matchKey} tapeState={h.upset.tapeState} tape={h.upset.tape} winner={h.upset.winner.steamid} />
					</div>
				{/if}
				{#if h.texture?.higherRatedWin || h.texture?.firstHitWin}
					<div class="card rv d1"><span class="rail">Most games went to form</span>
						{#if h.texture.higherRatedWin}<PercentMeter value={h.texture.higherRatedWin} label="of ranked games were won by the higher-rated player" />{/if}
						{#if h.texture.firstHitWin}<PercentMeter value={h.texture.firstHitWin} label="were won by the player who landed the first hit" />{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if h?.rivalries && (h.rivalries.most || h.rivalries.even || setCols.length)}
		{@const rv = h.rivalries}
		<div class="sub" id="rivalries">
			<div class="shd"><h4 id="rivalries-h" tabindex="-1">Rivalries and sets</h4></div>
			{#if rv.pairs}<p class="ssub">{nf(rv.pairs)} pairs of players met this season{rv.pairs10 ? `, and ${nf(rv.pairs10)} of those pairs played 10 or more games` : ''}.</p>{/if}
			<div class="grid2">
				{#if rv.most}
					<div class="card rv"><span class="rail">Most played rivalry</span>
						<RivalryCard a={rv.most.a} b={rv.most.b} {season}>{#snippet mid()}<b>{nf(rv.most!.games)}</b><span>games</span>{/snippet}</RivalryCard>
						<div class="blocks" role="img" aria-label="{nf(rv.most.games)} games, one block for every 10">{#each Array(Math.ceil(rv.most.games / 10)) as _, i (i)}<i></i>{/each}</div>
						<p class="dimp">Each block is 10 games.</p>
						<SetLink sessionId={rv.most.sessionId} tape={rv.most.tape} />
					</div>
				{/if}
				{#if rv.even}
					<div class="card rv d1"><span class="rail">Most even rivalry</span>
						<RivalryCard a={rv.even.a} b={rv.even.b} {season}>{#snippet mid()}<b>{rv.even!.aWins}–{rv.even!.bWins}</b><span>after {nf(rv.even!.aWins + rv.even!.bWins)} games</span>{/snippet}</RivalryCard>
						<div class="h2h" role="img" aria-label="{rv.even.aWins} wins to {rv.even.bWins}"><i style="flex:{rv.even.aWins}"></i><i style="flex:{rv.even.bWins}"></i></div>
						<SetLink sessionId={rv.even.sessionId} tape={rv.even.tape} />
					</div>
				{/if}
				{#if setCols.length}
					<div class="card rv full"><span class="rail">Sets that went the full 10 games, by final score</span>
						<ColumnChart cols={setCols} aria="Sets by final score" hint={setHint} />
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if perf.length || come.length || h?.combo}
		<div class="sub" id="feats">
			<div class="shd"><h4 id="feats-h" tabindex="-1">Perfects, comebacks and combos</h4></div>
			<div class="grid2 three">
				{#if perf.length}
					<div class="card mol rv"><span class="rail flair">Perfects</span>
						{#if h?.perfects?.total}<b class="big flair"><CountUp value={h.perfects.total} /></b><p class="dimp">ranked games won without taking a hit{h.perfects.players ? `, by ${nf(h.perfects.players)} players` : ''}</p>
						{:else}<b class="big flair">{nf(perf[0].value)}</b><p class="dimp">the season’s most, by {perf[0].player.name}</p>{/if}
						<BarList rows={perf.map((r, i) => ({ key: r.player.steamid + i, value: r.value, text: nf(r.value), color: 'var(--molten)', ref: r.player }))} lw={130}>{#snippet row(r)}{#if r.ref}{@render who(r.ref, 22)}{/if}{/snippet}</BarList>
						{#if bestPerfect}<p class="dimp" style="margin:8px 0 6px">Best one: {momentWho(bestPerfect)}, a perfect {momentFigure(bestPerfect)}.</p><SetLink sessionId={bestPerfect.sessionId} matchKey={bestPerfect.matchKey} tapeState={bestPerfect.tape} winner={bestPerfect.winner?.steamid} />{/if}
					</div>
				{/if}
				{#if come.length}
					<div class="card mol rv d1"><span class="rail flair">Comebacks</span>
						{#if h?.comebacks?.total}<b class="big flair"><CountUp value={h.comebacks.total} /></b><p class="dimp">comeback wins{h.comebacks.players ? `, by ${nf(h.comebacks.players)} players` : ''}</p>
						{:else}<b class="big flair">{nf(come[0].value)}</b><p class="dimp">the season’s most, by {come[0].player.name}</p>{/if}
						<BarList rows={come.map((r, i) => ({ key: r.player.steamid + i, value: r.value, text: nf(r.value), color: 'var(--molten)', ref: r.player }))} lw={130}>{#snippet row(r)}{#if r.ref}{@render who(r.ref, 22)}{/if}{/snippet}</BarList>
						{#if bestComeback}<p class="dimp" style="margin:8px 0 6px">Biggest one: {momentWho(bestComeback)}, {momentFigure(bestComeback)}.</p><SetLink sessionId={bestComeback.sessionId} matchKey={bestComeback.matchKey} tapeState={bestComeback.tape} winner={bestComeback.winner?.steamid} />{/if}
					</div>
				{/if}
				{#if h?.combo}
					<div class="card mol rv"><span class="rail flair">Biggest combo</span>
						<b class="big flair"><CountUp value={h.combo.hits} /> <small>hits</small></b>
						<PipRun count={h.combo.hits} tone="mol" cap={400} label="{h.combo.hits} hits, one mark for every hit" />
						<p class="dimp">{h.combo.date ? `Landed on ${dateText(h.combo.date) ?? ''}. ` : ''}{h.combo.over100 ? `${nf(h.combo.over100)} games had a combo of 100 hits or more.` : ''}</p>
						<SetLink sessionId={h.combo.sessionId} matchKey={h.combo.matchKey} tapeState={h.combo.tapeState} tape={h.combo.tape} />
					</div>
				{/if}
			</div>
		</div>
	{/if}
	{#if h?.trust}
		<div class="sub" id="replays">
			<div class="shd"><h4 id="replays-h" tabindex="-1">Where to find replays</h4></div>
			<p class="ssub">A replay here is the recorded match redrawn in your browser, not a video.</p>
			<div class="grid2">
				<div class="card rv">
					<p>On a set page. Each highlight above that is a single game has a “Watch the replay” or “See the set” link.</p>
					<p>In the LIVE tab, next to results as they land.</p>
					<p>In match history on any player’s profile.</p>
					<p class="dimp">Recent replays play without signing in. Older ones are in the archive: sign in to request one. Where a match has no tape, the set page still shows the result.</p>
					<div class="cta"><a class="btn" href="{base}/match">Open the LIVE tab</a>{#if !auth.authed}<button type="button" class="btn" onclick={() => auth.login()}>Sign in through Steam</button>{/if}</div>
				</div>
				{#if h.trust.confirmedShare}
					<div class="card rv d1"><PercentMeter value={h.trust.confirmedShare} label="of ranked games were confirmed" />
						{#if h.trust.taped}<p class="dimp"><b style="color:var(--ink)">{nf(h.trust.taped)}</b> of those confirmed games have a tape.</p>{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{:else if group === 'world'}
	{#if h?.world && worldBars.length}
		{@const w = h.world}
		<div class="sub" id="countries">
			<div class="shd"><h4 id="countries-h" tabindex="-1">Players by country</h4></div>
			{#if w.known && s?.players}<p class="ssub">Country is known for {nf(w.known)} of the {nf(s.players)} players, so this is a partial picture.</p>{/if}
			<div class="grid2">
				<div class="card rv"><span class="rail">Where players are</span>
					{#if w.countries}<b class="big"><CountUp value={w.countries} /> <small>countries</small></b>{/if}
					<BarList rows={worldBars} lw={150} hint={worldHint}>
						{#snippet row(r)}<Flag cc={r.key} w={18} /><span>{r.label}</span>{/snippet}
					</BarList>
				</div>
				{#if w.crossShare}
					<div class="card rv d1"><span class="rail">Across borders</span>
						<PercentMeter value={w.crossShare} label="of games where both countries are known were played between two different countries" />
						{#if w.topPair}<p class="dimp">The most common pairing was {countryName(w.topPair[0])} and {countryName(w.topPair[1])}.</p>{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
