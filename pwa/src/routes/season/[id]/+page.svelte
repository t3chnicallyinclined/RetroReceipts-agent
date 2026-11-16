<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { seasons } from '$lib/stores/seasons.svelte';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import {
		finaleAvailability,
		shapeLadder,
		fetchLadder,
		fetchFinale,
		dayLabel,
		type Finale
	} from '$lib/seasonFinale';
	import { DISCORD_URL, SUPERGUN_URL } from '$lib/links';
	import type { Player } from '$lib/types';
	import Masthead from '$lib/components/Masthead.svelte';
	import PodiumPlate from '$lib/components/PodiumPlate.svelte';
	import Board from '$lib/components/Board.svelte';
	import SuggestModal from '$lib/components/SuggestModal.svelte';
	import { auth } from '$lib/stores/auth.svelte';

	// SEASON WRAP-UP: the finale page for a season the server marks finished. Everything shown comes from the
	// server (season table, the season's rating ladder, GET /rr/season/summary). Stats are optional: the
	// whole section hides on an older server, and an item with no honest number is simply left out.
	const id = $derived(page.params.id ?? '');

	// feedback: the callout under the lead jumps to this block; the in-app "suggest a stat" form needs a sign-in
	const FEEDBACK_ID = 'help-shape';
	let showSuggest = $state(false);
	function jumpToFeedback(e: MouseEvent) {
		e.preventDefault();
		const el = document.getElementById(FEEDBACK_ID);
		if (!el) return;
		const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
		el.focus({ preventScroll: true }); // keyboard + screen-reader users land on the heading
	}

	let tried = $state(false);
	onMount(() => {
		void seasons.load().finally(() => (tried = true));
	});

	const waiting = $derived(!tried && seasons.status !== 'ready' && seasons.status !== 'absent');
	const avail = $derived(finaleAvailability(seasons.table, id));
	const season = $derived(avail.state === 'ready' ? avail.season : null);
	const next = $derived(avail.state === 'ready' ? avail.next : null);

	let ladder = $state<Player[] | null>(null);
	let ladderFailed = $state(false);
	let finale = $state<Finale | null>(null);

	// Load once per season id. Selecting the season here makes the player links open THAT season's profile.
	let loadedId = '';
	$effect(() => {
		const s = season;
		if (!s || s.id === loadedId) return;
		loadedId = s.id;
		ladder = null;
		ladderFailed = false;
		finale = null;
		seasons.select(s.id);
		void fetchLadder(s.id)
			.then((p) => {
				if (loadedId === s.id) ladder = p;
			})
			.catch(() => {
				if (loadedId === s.id) ladderFailed = true;
			});
		void fetchFinale(s.id).then((f) => {
			if (loadedId === s.id) finale = f;
		});
	});

	const shaped = $derived(shapeLadder(ladder));
	// podium order on screen: 2nd, 1st, 3rd (same as Ranks)
	const items = $derived(
		shaped.rows.map((r) => ({ kind: 'row' as const, key: r.player.steamid, player: r.player, pos: r.pos }))
	);
	$effect(() => {
		const ids = shaped.podium.map((p) => p.steamid);
		if (ids.length) void loadouts.prime(ids);
	});

	const dateLine = $derived.by(() => {
		if (!season) return '';
		const a = dayLabel(new Date(season.start_ms).toISOString().slice(0, 10));
		// end_ms is the first instant AFTER the season, so the last day is one millisecond earlier
		const b = season.end_ms != null ? dayLabel(new Date(season.end_ms - 1).toISOString().slice(0, 10)) : undefined;
		// a season that starts at time 0 is the implicit "before seasons" period: it has no honest start date
		const from = season.start_ms > 0 ? a : undefined;
		return from && b ? `${from} to ${b}` : b ? `Ended ${b}` : '';
	});
	const title = $derived(season ? `${season.label} wrap-up` : 'Season wrap-up');
</script>

<svelte:head><title>{title} · Retro Receipts</title></svelte:head>

{#if waiting}
	<div class="empty">LOADING…</div>
{:else if !season}
	<div class="empty" role="status">
		<p>This season’s wrap-up isn’t available yet.</p>
		<p><a class="plain" href="{base}/ranks">See the current ladder</a></p>
	</div>
{:else}
	<Masthead title={season.label} ghost="FINAL" accent="var(--dim)" desc={dateLine}>
		{#snippet pills()}<span class="pill">FINAL</span>{/snippet}
	</Masthead>

	<p class="lead">
		{season.label} has ended. Thank you to everyone who played. Here is how the final ladder finished.
	</p>
	<p class="ask">
		<a class="plain" href="#{FEEDBACK_ID}" onclick={jumpToFeedback}>Tell us what you’d like next season</a>{#if DISCORD_URL}{' '}·{' '}<a class="plain" href={DISCORD_URL} rel="noopener">Join the Discord</a>{/if}
	</p>

	<!-- Final ladder: top 3 on the podium, then places 4 to 8 -->
	<h2 class="rail hd">Final ladder</h2>
	{#if ladder === null && !ladderFailed}
		<div class="empty">LOADING…</div>
	{:else if ladderFailed}
		<div class="empty" role="status">The final standings can’t be loaded right now. Please try again later.</div>
	{:else if !shaped.podium.length && !shaped.rows.length}
		<div class="empty">No ranked players finished this season.</div>
	{:else}
		{#if shaped.podium.length}
			<div class="podium">
				<PodiumPlate player={shaped.podium[1]} place={2} tab="rating" />
				<PodiumPlate player={shaped.podium[0]} place={1} tab="rating" />
				<PodiumPlate player={shaped.podium[2]} place={3} tab="rating" />
			</div>
		{/if}
		{#if items.length}
			<Board {items} tab="rating" flashIds={new Set()} />
		{/if}
		<p class="foot">Ratings are as they stood when the season closed. Select a player to see their {season.label} profile.</p>
	{/if}

	<!-- The season in numbers: hidden entirely when the server has none to give -->
	{#if finale && (finale.tiles.length || finale.modes.length)}
		<h2 class="rail hd">{season.label} in numbers</h2>
		{#if finale.tiles.length}
			<dl class="tiles">
				{#each finale.tiles as t (t.key)}
					<div class="tile">
						<dd class="tv">{t.value}</dd>
						<dt class="tl">{t.label}</dt>
						{#if t.note}
							<dd class="tn">
								{#if t.steamid}<a class="plain" href="{base}/u/{t.steamid}">{t.note}</a>{:else}{t.note}{/if}
							</dd>
						{/if}
					</div>
				{/each}
			</dl>
		{/if}
		{#if finale.modes.length}
			<p class="modes">
				<span class="ml">Games by mode</span>
				{#each finale.modes as m (m.label)}<span class="mc">{m.label} <b>{m.value}</b></span>{/each}
			</p>
		{/if}
	{/if}

	{#if finale && finale.boards.length}
		<h2 class="rail hd">Other leaderboards</h2>
		<div class="boards">
			{#each finale.boards as b (b.key)}
				<section class="mini" aria-labelledby="mb-{b.key}">
					<h3 id="mb-{b.key}">{b.title}</h3>
					<ol>
						{#each b.rows as r, i (i)}
							<li>
								<span class="mn">{i + 1}</span>
								<span class="mname"
									>{#if r.steamid}<a class="plain" href="{base}/u/{r.steamid}">{r.label}</a>{:else}{r.label}{/if}</span
								>
								<span class="mval">{r.value}</span>
							</li>
						{/each}
					</ol>
				</section>
			{/each}
		</div>
	{/if}

	<!-- Thank you / what comes next -->
	<h2 class="rail hd">Thank you</h2>
	<section class="thanks">
		<p>
			Thank you to everyone who took part in {season.label}. This is a side project and it is still in
			testing, so we are grateful to everyone who gave it a go.
		</p>
		{#if next}
			<p>
				{next.label} is next. Everyone starts fresh, and {season.label} stays here to look back on. We plan to
				run more seasons after that.
			</p>
		{:else}
			<p>We plan to run more seasons, and {season.label} will stay here to look back on.</p>
		{/if}
		<p>
			We are also working on SUPERGUN, the planned successor to this app. It is early and still in testing.
			You can read more at <a class="plain" href={SUPERGUN_URL} rel="noopener">supergun.io</a>.
		</p>
		<div class="cta">
			<a class="btn ghost" href="{base}/ranks">See the current ladder</a>
		</div>
	</section>

	<!-- Feedback: prompts are about the page in general so they read correctly when a stat is hidden -->
	<h2 class="rail hd" id={FEEDBACK_ID} tabindex="-1">Help shape the next season</h2>
	<section class="thanks help" aria-labelledby={FEEDBACK_ID}>
		<p>
			This is a side project and it is still in testing, so we would really like to hear from you. We can’t
			promise what will be built, but your ideas help us decide what to try next.
		</p>
		<ul class="prompts">
			<li>Which of the numbers and leaderboards on this page did you care about, and what was missing?</li>
			<li>What should a season reward? Badges, titles, something else?</li>
			<li>How long should a season run?</li>
			<li>What would make ranked play better for you?</li>
		</ul>
		<p>
			{#if DISCORD_URL}Tell us on Discord{:else}Tell us{/if}{#if auth.authed}, or send a quick idea straight from here{/if}.
		</p>
		<div class="cta">
			{#if DISCORD_URL}<a class="btn" href={DISCORD_URL} rel="noopener">Join the Discord</a>{/if}
			{#if auth.authed}<button class="btn ghost" type="button" onclick={() => (showSuggest = true)}>Suggest a stat</button>{/if}
		</div>
	</section>
{/if}

{#if showSuggest}
	<SuggestModal onClose={() => (showSuggest = false)} />
{/if}

<style>
	.empty p {
		margin: 4px 0;
	}
	/* section headings: this page's own spacing (the shared .rail class is only a small caps label) */
	.hd {
		margin: 28px 0 10px;
	}
	.plain {
		color: var(--ink);
		text-decoration: underline;
	}
	.plain:focus-visible,
	.btn:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
	.lead {
		margin: 0 0 14px;
		font-size: 14px;
		line-height: 1.5;
		color: var(--ink);
		max-width: 62ch;
	}
	.podium {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.22fr) minmax(0, 1fr);
		gap: 12px;
		align-items: end;
		margin-bottom: 12px;
	}
	@media (max-width: 560px) {
		.podium {
			gap: 7px;
		}
	}
	.foot {
		padding: 8px 4px 0;
		font-size: 11.5px;
		color: var(--faint);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 10px;
		margin: 0;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		min-width: 0;
	}
	.tile dd,
	.tile dt {
		margin: 0;
	}
	.tv {
		order: 1;
		font-size: 22px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.tl {
		order: 2;
		font-size: 11.5px;
		color: var(--dim);
	}
	.tn {
		order: 3;
		font-size: 12px;
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	.modes {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px 14px;
		margin: 12px 0 0;
		font-size: 12.5px;
		color: var(--dim);
	}
	.ml {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.mc b {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.boards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
	}
	.mini {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 12px 14px;
		min-width: 0;
	}
	.mini h3 {
		margin: 0 0 8px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.mini ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.mini li {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) auto;
		gap: 8px;
		align-items: baseline;
		padding: 5px 0;
		font-size: 13px;
		border-top: 1px solid var(--line-soft);
	}
	.mini li:first-child {
		border-top: 0;
	}
	.mn {
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.mname {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.mval {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
	.thanks {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 14px 16px;
		font-size: 14px;
		line-height: 1.55;
	}
	.ask {
		margin: -6px 0 6px;
		font-size: 13px;
		color: var(--dim);
	}
	.prompts {
		margin: 0 0 12px;
		padding-left: 20px;
		max-width: 66ch;
	}
	.prompts li {
		margin: 0 0 6px;
	}
	.hd:focus {
		outline: none;
	}
	.hd:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 4px;
	}
	.thanks p {
		margin: 0 0 10px;
		max-width: 66ch;
	}
	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 4px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 16px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
		font-size: 13px;
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
		text-decoration: none;
	}
	.btn.ghost {
		background: transparent;
	}
</style>
