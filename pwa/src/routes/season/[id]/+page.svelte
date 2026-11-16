<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import '$lib/finale/finale.css';
	import { seasons } from '$lib/stores/seasons.svelte';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { finaleAvailability, shapeLadder, fetchLadder, fetchSummary, dayLabel, type Summary } from '$lib/seasonFinale';
	import { fetchHighlights, type Highlights } from '$lib/finale/highlights';
	import { fetchFeedback, type FeedbackView } from '$lib/finale/feedback';
	import { fetchRoster, type Roster } from '$lib/finale/players';
	import { fetchMine, type Mine } from '$lib/finale/mine';
	import { GROUPS, glanceTiles, groupSummary, mentionViews, nf, nf1, presentSubs, type GroupId } from '$lib/finale/derive';
	import { reveal, revealAll } from '$lib/finale/motion';
	import { DISCORD_URL } from '$lib/links';
	import { gamesOf, rankOf, winrateOf, winrateColor, RK_PLATE } from '$lib/ranks';
	import type { Player } from '$lib/types';
	import Avatar from '$lib/components/Avatar.svelte';
	import Flag from '$lib/components/Flag.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import CharSprite from '$lib/components/CharSprite.svelte';
	import PodiumPlate from '$lib/components/PodiumPlate.svelte';
	import FinaleBanner from '$lib/components/finale/FinaleBanner.svelte';
	import ChampionPlate from '$lib/components/finale/ChampionPlate.svelte';
	import MentionCard from '$lib/components/finale/MentionCard.svelte';
	import SeasonCard from '$lib/components/finale/SeasonCard.svelte';
	import GroupAccordion from '$lib/components/finale/GroupAccordion.svelte';
	import GroupBodies from '$lib/components/finale/GroupBodies.svelte';
	import SectionsSheet from '$lib/components/finale/SectionsSheet.svelte';
	import type { NavItem } from '$lib/finale/types';
	import SectionNav from '$lib/components/finale/SectionNav.svelte';
	import FinaleDock from '$lib/components/finale/FinaleDock.svelte';
	import FeedbackSection from '$lib/components/finale/FeedbackSection.svelte';
	import AlsoComing from '$lib/components/finale/AlsoComing.svelte';
	import SupergunBlock from '$lib/components/finale/SupergunBlock.svelte';
	import SpecialThanks from '$lib/components/finale/SpecialThanks.svelte';
	import CountUp from '$lib/components/finale/CountUp.svelte';

	// SEASON FINALE for a season the server marks finished. Every section is fed by its own endpoint and hides when
	// that endpoint is missing (older server): table, ladder, summary, highlights, feedback, players, profile.
	const id = $derived(page.params.id ?? '');
	let root: HTMLDivElement | undefined = $state();
	let sheet: HTMLDialogElement | undefined = $state();

	let tried = $state(false);
	const waiting = $derived(!tried && seasons.status !== 'ready' && seasons.status !== 'absent');
	const avail = $derived(finaleAvailability(seasons.table, id));
	const season = $derived(avail.state === 'ready' ? avail.season : null);
	const next = $derived(avail.state === 'ready' ? avail.next : null);

	// ── data ──
	let ladderRaw = $state<Player[] | null>(null);
	let ladderFailed = $state(false);
	let sum = $state<Summary | null>(null);
	let hl = $state<Highlights | null>(null);
	let fb = $state<FeedbackView | null>(null);
	let roster = $state<Roster | null>(null);
	let mine = $state<Mine | null>(null);
	let mineLoaded = $state(false);

	// each endpoint marks itself settled (even on a 404) so deep links wait for the content they point at
	let done = $state({ ladder: false, sum: false, hl: false, roster: false });
	let loadedId = '';
	$effect(() => {
		const s = season;
		if (!s || s.id === loadedId) return;
		loadedId = s.id;
		ladderRaw = null; ladderFailed = false; sum = null; hl = null; fb = null; roster = null;
		done = { ladder: false, sum: false, hl: false, roster: false };
		seasons.select(s.id); // player links on this page open THAT season's profile
		void fetchLadder(s.id).then((p) => { if (loadedId === s.id) ladderRaw = p; }).catch(() => { if (loadedId === s.id) ladderFailed = true; }).finally(() => { if (loadedId === s.id) done.ladder = true; });
		void fetchSummary(s.id).then((v) => { if (loadedId === s.id) { sum = v; done.sum = true; } });
		void fetchHighlights(s.id).then((v) => { if (loadedId === s.id) { hl = v; done.hl = true; } });
		void fetchRoster(s.id).then((v) => { if (loadedId === s.id) { roster = v; done.roster = true; } });
	});
	// feedback and the viewer's own season follow the sign-in
	$effect(() => {
		const s = season;
		const tok = auth.token;
		if (!s) return;
		void fetchFeedback(s.id, tok).then((v) => { if (season?.id === s.id) fb = v; });
	});
	$effect(() => {
		const s = season;
		const sid = auth.steamid;
		const tok = auth.token;
		if (!s || !sid) { mine = null; mineLoaded = false; return; }
		mineLoaded = false;
		void fetchMine(sid, s.id, tok).then((v) => { if (season?.id === s.id && auth.steamid === sid) { mine = v; mineLoaded = true; } });
	});

	const ladder = $derived(shapeLadder(ladderRaw));
	$effect(() => {
		const ids = [ladder.champion, ...ladder.side, ...ladder.rows.map((r) => r.player)].filter(Boolean).map((p) => p!.steamid);
		if (ids.length) void loadouts.prime(ids);
	});
	const label = $derived(season?.label ?? '');
	const mentions = $derived(mentionViews(hl));
	const glance = $derived(glanceTiles(sum, hl));
	const honours = $derived.by(() => {
		const c = ladder.champion;
		if (!c || !sum) return [] as string[];
		const out: string[] = [];
		const pick = (k: 'best_streak' | 'wins' | 'peak_rating' | 'perfects', f: (n: number) => string) => {
			const row = sum?.top[k]?.[0];
			if (row && row.player.steamid === c.steamid) out.push(f(row.value));
		};
		pick('best_streak', (n) => `Longest win streak: ${nf(n)}`);
		pick('wins', (n) => `Most wins: ${nf(n)}`);
		pick('peak_rating', (n) => `Highest rating reached: ${Math.round(n)}`);
		pick('perfects', (n) => `Most perfects: ${nf(n)}`);
		return out;
	});

	const dateLine = $derived.by(() => {
		if (!season) return '';
		const end = season.end_ms != null ? dayLabel(new Date(season.end_ms - 1).toISOString().slice(0, 10)) : undefined;
		const start = season.start_ms > 0 ? dayLabel(new Date(season.start_ms).toISOString().slice(0, 10)) : undefined;
		return start && end ? `${start} to ${end}` : end ? `Ended ${end}` : '';
	});
	const bits = $derived([
		...(sum?.games ? [{ n: sum.games, one: 'game', many: 'games' }] : []),
		...(sum?.sets ? [{ n: sum.sets, one: 'set', many: 'sets' }] : []),
		...(sum?.players ? [{ n: sum.players, one: 'player', many: 'players' }] : []),
		...(hl?.days ? [{ n: hl.days, one: 'day', many: 'days' }] : [])
	]);
	const pickList = $derived(
		[...(seasons.table?.seasons ?? [])].reverse().map((s) => ({ id: s.id, label: s.label, current: s.id === seasons.table?.current }))
	);
	function pickSeason(to: string) {
		void goto(to === seasons.table?.current ? `${base}/ranks` : `${base}/season/${encodeURIComponent(to)}`);
	}

	// ── groups: present ones, open state, one-open rule on phones ──
	const groups = $derived(
		GROUPS.flatMap((g) => {
			const subs = presentSubs(g.id, sum, hl);
			return subs.length ? [{ ...g, subs, summary: groupSummary(g.id, sum, hl) }] : [];
		})
	);
	let wide = $state(false);
	let open = $state<Record<string, boolean>>({});
	const subToGroup = $derived(Object.fromEntries(groups.flatMap((g) => g.subs.map((s) => [s.id, g.id]))));
	// wide screens start with every present group open
	let seededWide = false;
	$effect(() => {
		if (wide && groups.length && !seededWide) {
			seededWide = true;
			open = Object.fromEntries(groups.map((g) => [g.id, true]));
		}
	});

	function toggle(gid: string) {
		const was = !!open[gid];
		if (wide) open = { ...open, [gid]: !was };
		else open = was ? {} : { [gid]: true };
		persist();
		if (!was && !wide) void tick().then(() => document.getElementById(gid)?.scrollIntoView({ block: 'start' }));
	}

	// ── navigation: sections, groups, sub-sections ──
	const ids = $derived([
		'top', 'podium', ...(mentions.length ? ['mentions'] : []), ...(glance.length ? ['glance'] : []), 'you',
		...(groups.length ? ['explore', ...groups.map((g) => g.id)] : []), 'next', ...(roster ? ['thanks'] : []), 'feedback', 'close'
	]);
	const titleOf = $derived<Record<string, string>>({
		top: 'Sections', podium: 'Podium', mentions: 'Notable mentions', glance: 'At a glance', you: 'Your season', explore: 'Explore the season',
		...Object.fromEntries(groups.map((g) => [g.id, g.title])), next: 'What’s next', thanks: 'Special thanks', feedback: 'Have your say', close: 'Thank you'
	});
	const navItems = $derived<NavItem[]>([
		{ id: 'podium', title: 'The podium', summary: ladder.champion ? `${ladder.champion.name} finished first` : undefined },
		...(mentions.length ? [{ id: 'mentions', title: 'Notable mentions', summary: `${mentions.length} ${mentions.length === 1 ? 'player' : 'players'} outside the top 8` }] : []),
		...(glance.length ? [{ id: 'glance', title: 'At a glance', summary: `${label} in six figures` }] : []),
		{ id: 'you', title: 'Your season', summary: auth.authed ? 'Where you finished' : 'Sign in to see where you finished' },
		...groups.map((g) => ({ id: g.id, title: g.title, summary: g.summary, subs: g.subs })),
		{ id: 'next', title: 'What’s next', summary: next ? `${next.label} and SUPERGUN` : 'More seasons and SUPERGUN' },
		...(roster ? [{ id: 'thanks', title: 'Special thanks', summary: `${nf(roster.everyone.length || roster.regulars.length)} players` }] : []),
		{ id: 'feedback', title: 'Help shape the next season', summary: 'Polls, a note, and ideas' }
	]);
	const wideNav = $derived([
		...(ladder.champion ? [{ id: 'podium', title: 'Podium' }] : []),
		...(mentions.length ? [{ id: 'mentions', title: 'Notable mentions' }] : []),
		...(glance.length ? [{ id: 'glance', title: 'At a glance' }] : []),
		{ id: 'you', title: 'Your season' },
		...groups.map((g) => ({ id: g.id, title: g.title })),
		{ id: 'next', title: 'What’s next' },
		...(roster ? [{ id: 'thanks', title: 'Thank you' }] : [])
	]);

	let current = $state('top');
	const dockLabel = $derived(current === 'top' ? 'Sections' : (titleOf[subToGroup[current] ?? current] ?? 'Sections'));
	function trackScroll() {
		let cur = 'top';
		for (const i of ids) {
			const el = document.getElementById(i);
			if (el && el.getBoundingClientRect().top <= 150) cur = i;
		}
		current = cur;
	}

	async function goTo(target: string, opts: { quiet?: boolean } = {}) {
		const gid = subToGroup[target] ?? (groups.some((g) => g.id === target) ? target : '');
		if (gid && !open[gid]) {
			open = wide ? { ...open, [gid]: true } : { [gid]: true };
			persist();
		}
		await tick();
		const sub = !!subToGroup[target];
		const heading = sub ? document.getElementById(`${target}-h`) : groups.some((g) => g.id === target) ? document.getElementById(`${target}-b`) : (document.getElementById(`${target}-h`) ?? document.getElementById(target));
		const box = document.getElementById(target);
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		(box ?? heading)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
		heading?.focus({ preventScroll: true });
		if (!opts.quiet) history.replaceState(history.state, '', `#${target}`);
		trackScroll();
	}
	function copyLink(anchor: string) {
		const url = `${location.origin}${location.pathname}#${anchor}`;
		void navigator.clipboard?.writeText(url).catch(() => {});
	}

	// ── remembered position: open groups and scroll, per season, in sessionStorage (works without it) ──
	const memKey = $derived(`rr:finale:${id}`);
	function persist() {
		try {
			sessionStorage.setItem(memKey, JSON.stringify({ open, y: Math.round(scrollY) }));
		} catch {
			/* storage blocked: the page works without it */
		}
	}
	let restored = false;
	$effect(() => {
		// once the page content has arrived: a hash wins over the remembered position
		if (restored || !season || !(done.ladder && done.sum && done.hl && done.roster)) return;
		restored = true;
		untrack(() => {
			void tick().then(async () => {
				if (location.hash.length > 1) {
					await goTo(decodeURIComponent(location.hash.slice(1)), { quiet: true });
					return;
				}
				try {
					const m = JSON.parse(sessionStorage.getItem(memKey) ?? 'null');
					if (m && typeof m === 'object') {
						if (m.open && typeof m.open === 'object') open = Object.fromEntries(Object.entries(m.open as Record<string, unknown>).filter(([k, v]) => v === true && groups.some((g) => g.id === k))) as Record<string, boolean>;
						if (typeof m.y === 'number' && m.y > 0) {
							await tick();
							scrollTo({ top: m.y, behavior: 'auto' });
						}
					}
				} catch {
					/* nothing remembered */
				}
			});
		});
	});

	onMount(() => {
		void seasons.load().finally(() => (tried = true));
		const calm = matchMedia('(prefers-reduced-motion: reduce)');
		let stopReveal = () => {};
		if (!calm.matches && root) {
			root.classList.add('anim');
			stopReveal = revealAll(root);
		}
		const mq = matchMedia('(min-width: 900px)');
		wide = mq.matches;
		const onMq = (e: MediaQueryListEvent) => {
			wide = e.matches;
			if (e.matches) open = Object.fromEntries(groups.map((g) => [g.id, true]));
			else open = {};
		};
		mq.addEventListener('change', onMq);
		// the real TabBar height (it is hidden on wide screens, so 0 there)
		const setTab = () => root?.style.setProperty('--tabbar-h', `${document.querySelector<HTMLElement>('.tabbar')?.offsetHeight ?? 0}px`);
		setTab();
		const tb = document.querySelector('.tabbar');
		const ro = tb && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(setTab) : null;
		if (tb) ro?.observe(tb);
		let raf = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(() => { raf = 0; trackScroll(); });
			clearTimeout(timer);
			timer = setTimeout(persist, 400);
		};
		addEventListener('scroll', onScroll, { passive: true });
		addEventListener('resize', setTab);
		return () => {
			mq.removeEventListener('change', onMq);
			stopReveal();
			ro?.disconnect();
			removeEventListener('scroll', onScroll);
			removeEventListener('resize', setTab);
			clearTimeout(timer);
		};
	});

	const title = $derived(season ? `${season.label} wrap-up` : 'Season wrap-up');
	let shareStatus = $state('');
	async function sharePage() {
		const url = `${location.origin}${location.pathname}`;
		try {
			if (typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches) {
				await navigator.share({ url, title });
				shareStatus = '';
			} else {
				await navigator.clipboard.writeText(url);
				shareStatus = 'Link copied.';
			}
		} catch {
			shareStatus = `Copy this link: ${url}`;
		}
	}
	const showRows = $derived(ladder.rows.length > 0);
</script>

<svelte:head><title>{title} · Retro Receipts</title></svelte:head>

{#snippet hd(hid: string, text: string)}
	<div class="shd"><h2 id="{hid}-h" tabindex="-1">{text}</h2><button type="button" class="hdlink" aria-label="Copy a link to {text}" onclick={() => copyLink(hid)}># link</button></div>
{/snippet}

<div class="fin" bind:this={root}>
	{#if waiting}
		<div class="empty">LOADING…</div>
	{:else if !season}
		<div class="empty" role="status">
			<p>This season’s wrap-up isn’t available yet.</p>
			<p><a class="plain" href="{base}/ranks">See the current ladder</a></p>
		</div>
	{:else}
		{#if wide}<SectionNav items={wideNav} {current} onjump={(t) => goTo(t)} />{/if}

		<FinaleBanner {label} date={dateLine} {bits} hasChampion={!!ladder.champion} seasons={pickList} current={season.id} onpick={pickSeason} onjump={(t) => goTo(t)} />

		<!-- the podium -->
		<section class="sec" id="podium" aria-labelledby="podium-h">
			{@render hd('podium', ladder.count || ladderFailed ? 'The podium' : 'Final ladder')}
			{#if ladderRaw === null && !ladderFailed}
				<div class="empty">LOADING…</div>
			{:else if ladderFailed}
				<div class="empty" role="status">The final standings can’t be loaded right now. Please try again later.</div>
			{:else if !ladder.champion}
				<div class="empty">No ranked players finished this season.</div>
			{:else}
				<p class="ssub">The {label} ladder is closed. Ratings are as they stood when the season ended.</p>
				<ChampionPlate player={ladder.champion} season={season.id} {label} {honours} />
				{#if ladder.side.length}
					<div class="pods" class:one={ladder.side.length === 1}>
						{#each ladder.side as p, i (p.steamid)}<PodiumPlate player={p} place={(i + 2) as 2 | 3} tab="rating" challenge={false} />{/each}
					</div>
				{/if}
				{#if ladder.count === 1}<p class="note">One player finished {label} with ranked games.</p>{/if}
				{#if showRows}
					<h3 class="rail subh" style="margin:18px 2px 8px">Places 4 to {ladder.count}</h3>
					<div class="board">
						<div class="bd-hd rail" aria-hidden="true"><span>#</span><span>Player</span><span class="r">Team</span><span>Tier</span><span class="r">Rating</span><span class="r">Win %</span></div>
						{#each ladder.rows as { player: p, pos } (p.steamid)}
							{@const r = rankOf(p.rating, gamesOf(p))}
							{@const w = winrateOf(p)}
							<a class="bd-row" href="{base}/u/{encodeURIComponent(p.steamid)}?season={encodeURIComponent(season.id)}">
								<span class="bd-rank">{pos}</span>
								<span class="bd-name">
									<Avatar url={p.avatar} size={30} alt="" />
									<span class="l1">{#if p.cc}<Flag cc={p.cc} w={16} />{/if}<span class="nm" title={p.name}>{p.name || 'Player'}</span></span>
									<span class="l2 dsk-hide"><RankBadge rating={p.rating} games={gamesOf(p)} size={13} /><span class="rk-{r.s}">{r.n}</span></span>
								</span>
								<span class="bd-team">{#each (p.top_team ?? []).slice(0, 3) as cid, i (i)}<span class="sq1"><CharSprite id={cid} still /></span>{/each}</span>
								<span class="col-wr" style="text-align:left"><RankBadge rating={p.rating} games={gamesOf(p)} size={16} /> <span class="rk-{r.s}">{r.n}</span></span>
								<span class="bd-num mono">{Math.round(p.rating)}<small>{nf(p.wins ?? 0)} – {nf(p.losses ?? 0)}</small></span>
								<span class="col-wr" style="color:{winrateColor(w)}">{w}%</span>
							</a>
						{/each}
					</div>
				{/if}
				<p class="note">Select a player to see their {label} profile. <a class="plain" href="{base}/ranks?season={encodeURIComponent(season.id)}">See the full {label} ladder</a></p>
			{/if}
		</section>

		<!-- notable mentions -->
		{#if mentions.length}
			<section class="sec" id="mentions" aria-labelledby="mentions-h">
				{@render hd('mentions', 'Notable mentions')}
				<p class="ssub">Outside the final top {ladder.count || 8}, and all over the season’s leaderboards.</p>
				<div class="grid2">{#each mentions as v (v.mention.player.steamid)}<MentionCard view={v} season={season.id} only={mentions.length === 1} />{/each}</div>
			</section>
		{/if}

		<!-- at a glance -->
		{#if glance.length}
			<section class="sec" id="glance" aria-labelledby="glance-h">
				<h2 class="rail subh" id="glance-h" tabindex="-1" style="margin:0 0 8px">{label} at a glance</h2>
				<dl class="glance" use:reveal>
					{#each glance as g (g.key)}<div><dt>{g.label}</dt><dd>{#if g.pre}<span class="pre">{g.pre}</span>{/if}<CountUp value={g.n} format={(x) => (g.dec ? nf1(x) : nf(x))} /></dd></div>{/each}
				</dl>
			</section>
		{/if}

		<!-- your season -->
		<section class="sec" id="you" aria-labelledby="you-h">
			{@render hd('you', 'Your season')}
			<SeasonCard {mine} loading={auth.authed && !mineLoaded} loaded={mineLoaded || !auth.authed} season={season.id} {label} nextLabel={next?.label} />
		</section>

		<!-- explore the season -->
		{#if groups.length}
			<section class="sec" id="explore" aria-labelledby="explore-h">
				{@render hd('explore', 'Explore the season')}
				<p class="ssub">Pick a part of the season to open it.</p>
				<div class="grps">
					{#each groups as g, gi (g.id)}
						<GroupAccordion id={g.id} title={g.title} summary={g.summary} subs={g.subs} open={!!open[g.id]} next={groups[gi + 1]?.title ?? 'What’s next'} ontoggle={() => toggle(g.id)} onjump={(t) => goTo(t)} onnext={() => goTo(groups[gi + 1]?.id ?? 'next')}>
							<GroupBodies group={g.id as GroupId} s={sum} h={hl} season={season.id} {label} />
						</GroupAccordion>
					{/each}
				</div>
			</section>
		{/if}

		<!-- what's next -->
		<section class="sec" id="next" aria-labelledby="next-h">
			{@render hd('next', 'What’s next')}
			<div class="next">
				<div class="nl">
				{#if next}
					<div class="card">
						<span class="rail">Open now</span>
						<h3>{next.label}</h3>
						<p>Everyone starts fresh at the same rating. Register to take part, play your first five ranked games to get a rank, and {label} stays here to look back on.</p>
						<div class="cta"><a class="btn pri" href="{base}/settings">Register for {next.label}</a><a class="btn" href="{base}/ranks">See the current ladder</a></div>
						<p class="dimp">We plan to run more seasons after that.</p>
					</div>
				{:else}
					<div class="card">
						<span class="rail">Later</span>
						<h3>More seasons</h3>
						<p>We plan to run more seasons, and {label} will stay here to look back on.</p>
						<div class="cta"><a class="btn" href="{base}/ranks">See the current ladder</a></div>
					</div>
				{/if}
				<AlsoComing nextLabel={next?.label} />
				</div>
				<SupergunBlock />
			</div>
		</section>

		<!-- special thanks -->
		{#if roster}
			<section class="sec" id="thanks" aria-labelledby="thanks-h">
				{@render hd('thanks', 'Special thanks')}
				<SpecialThanks {roster} season={season.id} {label} />
			</section>
		{/if}

		<!-- help shape the next season -->
		<section class="sec" id="feedback" aria-labelledby="feedback-h">
			{@render hd('feedback', 'Help shape the next season')}
			<FeedbackSection {fb} season={season.id} {label} days={hl?.days} onview={(v) => (fb = v)} />
		</section>

		<!-- close -->
		<section class="close" id="close" aria-labelledby="close-h">
			<h2 id="close-h" tabindex="-1">Thank you for playing {label}</h2>
			<p>This is a side project and it is still in testing. We are grateful to everyone who gave it a go.{next ? ` See you in ${next.label}.` : ''}</p>
			<div class="cta">
				<a class="btn pri" href="{base}/ranks">See the current ladder</a>
				{#if DISCORD_URL}<a class="btn" href={DISCORD_URL} rel="noopener">Join the NOBD Discord</a>{/if}
				<button type="button" class="btn" onclick={sharePage}>Share this page</button>
			</div>
			<p class="status" role="status" aria-live="polite">{shareStatus}</p>
		</section>

		{#if !wide}
			<FinaleDock label={dockLabel} onmenu={() => sheet?.showModal()} onfeedback={() => goTo('feedback')} />
			<SectionsSheet items={navItems} {current} onjump={(t) => goTo(t)} bind:dialog={sheet} />
		{/if}
	{/if}
</div>

<style>
	/* the wide sticky nav sits flush with the page padding */
	:global(.fin .snav) {
		margin-left: -18px;
		margin-right: -18px;
		padding-left: 18px;
		padding-right: 18px;
	}
</style>
