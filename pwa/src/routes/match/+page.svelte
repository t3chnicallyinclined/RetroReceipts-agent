<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page as appPage } from '$app/state'; // aliased — a local `page` (pagination) already lives below
	import { matchfeed, type FeedMode } from '$lib/stores/matchfeed.svelte';
	import { wager } from '$lib/stores/wager.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import MatchBanner from '$lib/components/MatchBanner.svelte';
	import MyMatch from '$lib/components/MyMatch.svelte';
	import WagerRail from '$lib/components/WagerRail.svelte';
	import Marquee from '$lib/components/Marquee.svelte';
	import SessionModal from '$lib/components/SessionModal.svelte';
	import ResultCheckBanner from '$lib/components/ResultCheckBanner.svelte';
	import HostBanner from '$lib/components/HostBanner.svelte';

	// Live match center + 🪙 quarter-match surfaces — all push off the app-wide `matches` SSE channel (a
	// mode-scoped seed fetch backs Live Results; a seed fetch for the wager rail/marquee). onMount opens the
	// streams and pauses them while the tab is hidden (CPU discipline — mirrors /ranks).
	onMount(() => {
		matchfeed.connect();
		wager.connect(auth.steamid);
		void wager.loadOpen();
		if (auth.steamid) void wager.loadMine(auth.steamid);
		const onVis = () => {
			if (document.hidden) {
				matchfeed.disconnect();
				wager.disconnect();
			} else {
				matchfeed.connect();
				wager.connect(auth.steamid);
				void wager.loadOpen();
				if (auth.steamid) void wager.loadMine(auth.steamid);
			}
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			matchfeed.disconnect();
			wager.disconnect();
		};
	});

	// keep the rail bound to the signed-in user (covers a sign-in/out while this tab is open).
	$effect(() => {
		const sid = auth.steamid;
		if (sid) void wager.loadMine(sid);
		else wager.mine = null;
	});

	const nowPlaying = $derived(matchfeed.nowPlaying);
	const results = $derived(matchfeed.results);
	const mode = $derived(matchfeed.mode);
	const me = $derived(auth.steamid);

	// ── 🪙 one-tap accept funnel (share link → nobd.net/app/match?mm=<id>) ──────────────────────────────
	// A first-time visitor opens the share link on the web, signs in with Steam, and is dropped straight onto
	// the accept button — no app download. We NEVER surface a join/lobby link here (acceptance stays behind the
	// quarter); the WagerRail below reveals the cabinet once the quarter is matched.
	const mmId = $derived(appPage.url.searchParams.get('mm') ?? '');
	let inviteEl = $state<HTMLElement | null>(null);
	let inviteChecked = $state(false); // we've refreshed the lists at least once for this id
	let inviteActing = $state(false);
	let inviteNotice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
	// resolve the invited wager: an OPEN marquee quarter (public read), or the viewer's own state row when the
	// challenge is directed at them (only visible once signed in).
	const invite = $derived(
		mmId ? (wager.open.find((x) => x.id === mmId) ?? (wager.mine?.id === mmId ? wager.mine : null)) : null
	);
	const inviteOpen = $derived(!!invite && invite.status === 'open' && invite.challenger !== me); // a taker can match it
	const inviteOwn = $derived(!!invite && invite.status === 'open' && invite.challenger === me); // my own quarter
	const inviteStake = $derived(invite?.stake ?? 0);
	const invitePot = $derived(invite ? (invite.pot ?? invite.stake * 2) : 0);
	const inviteChallenger = $derived(invite?.challenger_name || 'A challenger');

	async function acceptInvite() {
		if (!auth.authed) {
			auth.login(`/match?mm=${encodeURIComponent(mmId)}`); // round-trip the id back through Steam sign-in
			return;
		}
		if (inviteActing || !invite) return;
		inviteActing = true;
		inviteNotice = null;
		const r = await wager.respond(mmId, true);
		inviteActing = false;
		if (r.ok)
			inviteNotice = { kind: 'ok', text: '🪙 Matched — the machine holds the pot. Your cabinet is on the rail below.' };
		else inviteNotice = { kind: 'err', text: r.error ?? 'Could not match that quarter.' };
	}

	// Resolve + reveal the invited challenge whenever ?mm= is present (a cold share-link load or an in-app nav
	// to a new id). Refresh the open marquee (+ our own state when signed in) so the id resolves, then scroll
	// the card into view so the accept button is right there.
	$effect(() => {
		const id = mmId;
		if (!id) return;
		inviteChecked = false;
		void (async () => {
			await wager.loadOpen();
			if (auth.steamid) await wager.loadMine(auth.steamid);
			inviteChecked = true;
			await tick();
			inviteEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		})();
	});

	// ── Live Results mode filter (mirrors the /ranks scope tab-list) — Ranked is the default. ──
	const MODES: { id: FeedMode; label: string; icon: string }[] = [
		{ id: 'ranked', label: 'Ranked', icon: '⚔' },
		{ id: 'lobby', label: 'Lobby', icon: '🎮' },
		{ id: 'tourney', label: 'Tournament', icon: '🏆' }
	];
	const MODE_NAME: Record<FeedMode, string> = { ranked: 'ranked', lobby: 'lobby', tourney: 'tournament' };

	function selectMode(m: FeedMode) {
		if (m === matchfeed.mode) return;
		matchfeed.setMode(m);
		page = 0; // a fresh mode starts on page 1
	}

	// ── Pagination — 5 per page, up to 20 rows (4 pages). A live delta prepends to page 1 (store cap 20). ──
	const PER_PAGE = 5;
	let page = $state(0);
	const pageCount = $derived(Math.max(1, Math.ceil(results.length / PER_PAGE)));
	// Keep the page in range as the list shrinks (mode switch / cap eviction).
	$effect(() => {
		if (page > pageCount - 1) page = pageCount - 1;
	});
	const pageResults = $derived(results.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE));

	// ── Session ("set") modal — a result OR live row opens the game-by-game set view for its session_id. ──
	let openSession = $state<string | null>(null);
	function openSet(id: string) {
		openSession = id;
	}
	// live when the open session belongs to a Now Playing pair → the modal keeps refreshing the set as it plays.
	const openIsLive = $derived(!!openSession && nowPlaying.some((p) => p.session_id === openSession));

	const isRanked = (m?: string) => m === 'ranked';
	// A missing/short display name falls back to a shortened steamid rather than a raw 17-digit wall.
	const nameFor = (sid: string, names: Record<string, string>) =>
		(names && names[sid]) || (sid ? `…${sid.slice(-5)}` : 'Player');
	const involvesMe = (a: string, b: string) => !!me && (a === me || b === me);

	const coldLoad = $derived(matchfeed.loading && results.length === 0);
</script>

<svelte:head><title>Match · Retro Receipts</title></svelte:head>

<!-- Masthead: title + ghost watermark + accent seam + description (matches /ranks · /regions) -->
<section class="mast" style="--acc:var(--live)">
	<div class="ghost" aria-hidden="true">LIVE</div>
	<div class="mrow">
		<h1 class="mtitle">MATCH</h1>
		<span class="pill live"><span class="dot" aria-hidden="true"></span>LIVE</span>
	</div>
	<div class="seam" aria-hidden="true"></div>
	<p class="mdesc">The live match center — games in progress and results as they land, pushed the moment they happen. Leave it open and watch the scene play out.</p>
</section>

<!-- Result Check honest-beta banner — the reserved amber surface (DESIGN §gold budget) -->
<ResultCheckBanner />

<!-- 🎛 Your cabinet — shows only when the signed-in viewer is an online host node (self-hides otherwise). -->
{#if me}<HostBanner steamid={me} self />{/if}

<!-- 🪙 one-tap accept funnel — arrived via a share link (?mm=). The hero accept target: challenger + pot +
     a single Accept button (Steam sign-in only, no app download). Never shows a join/lobby link. -->
{#if mmId}
	<section class="invite" bind:this={inviteEl} class:live={inviteOpen}>
		<span class="lab">🪙 You've been challenged</span>
		{#if inviteOpen}
			<p class="iline">
				<b>{inviteChallenger}</b> puts up 🪙 {inviteStake} · FT{invite?.ft ?? 2} — match it and the machine
				holds 🪙 {invitePot}.
			</p>
			<div class="iacts">
				{#if auth.authed}
					<button type="button" class="gold" disabled={inviteActing} onclick={acceptInvite}
						>⚔ {inviteActing ? '…' : `Accept — match 🪙 ${inviteStake}`}</button
					>
				{:else}
					<button type="button" class="steam" onclick={acceptInvite}>
						<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
							<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
							<circle cx="15" cy="9" r="2.4" fill="currentColor" />
							<path d="M6 15l4.5 1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
						</svg>
						<span>Sign in to accept</span>
					</button>
				{/if}
			</div>
		{:else if inviteOwn}
			<p class="iline dim">This is your quarter — it's up on the marquee below, waiting for a taker.</p>
		{:else if invite}
			<!-- resolved but not an open taker-able offer → I'm already a party to it (matched / underway) -->
			<p class="iline dim">You're in this set — the live rail is below.</p>
		{:else if !auth.authed}
			<!-- signed out + unresolved: it may be a directed challenge we can't see until sign-in -->
			<p class="iline dim">Sign in to see this challenge.</p>
			<div class="iacts">
				<button type="button" class="steam" onclick={acceptInvite}>
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
						<circle cx="15" cy="9" r="2.4" fill="currentColor" />
						<path d="M6 15l4.5 1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					</svg>
					<span>Sign in</span>
				</button>
			</div>
		{:else if inviteChecked}
			<p class="iline dim">This challenge is no longer open — the quarter already left the marquee.</p>
		{:else}
			<p class="iline dim">Looking for this challenge…</p>
		{/if}
		{#if inviteNotice}
			<div class="railnote {inviteNotice.kind}" role="status">{inviteNotice.text}</div>
		{/if}
	</section>
{/if}

<!-- 🆚 YOUR live match — the versus scoreboard + matchup intel (only while you're in a game, via the agent) -->
<MyMatch />

<!-- 🪙 Money Match: your wager rail + the open-challenge marquee (live off the same `matches` channel) -->
<WagerRail />
<Marquee />

<!-- 🟢 Now Playing — standardized live banners (same one-row family as Live Results) -->
<section class="sec">
	<h2 class="shead"><span class="ic on"><span class="dot" aria-hidden="true"></span></span> Now Playing {#if nowPlaying.length}<span class="cnt">{nowPlaying.length}</span>{/if}</h2>
	{#if nowPlaying.length === 0}
		<div class="empty">No games in progress right now.</div>
	{:else}
		<div class="panel">
			{#each nowPlaying as p (p.key)}
				<MatchBanner
					variant="live"
					left={{ sid: p.a, name: nameFor(p.a, p.names), rating: p.ratings?.[p.a], wins: p.wins?.[p.a] }}
					right={{ sid: p.b, name: nameFor(p.b, p.names), rating: p.ratings?.[p.b], wins: p.wins?.[p.b] }}
					mode={p.mode ?? ''}
					sessionId={p.session_id}
					joinLink={p.join_link ?? ''}
					mine={involvesMe(p.a, p.b)}
					onOpen={openSet}
				/>
			{/each}
		</div>
	{/if}
</section>

<!-- 🔴 Live Results — mode-scoped, paginated; same one-row banner family, winner-vs-loser framing -->
<section class="sec">
	<div class="sechd">
		<h2 class="shead"><span class="ic res" aria-hidden="true"></span> Live Results {#if results.length}<span class="cnt">{results.length}</span>{/if}</h2>
		<!-- Mode filter — same tab-list pattern as /ranks scope. Selecting refetches that mode's feed. -->
		<div class="scopes" role="tablist" aria-label="Results mode">
			{#each MODES as m (m.id)}
				<button
					class="scope"
					class:on={m.id === mode}
					role="tab"
					aria-selected={m.id === mode}
					title={m.label}
					onclick={() => selectMode(m.id)}
					><span class="sic" aria-hidden="true">{m.icon}</span><span class="slbl">{m.label}</span></button
				>
			{/each}
		</div>
	</div>

	{#if coldLoad}
		<div class="empty">LOADING…</div>
	{:else if results.length === 0}
		<div class="empty">No {MODE_NAME[mode]} results yet — they appear here the moment a set finishes.</div>
	{:else}
		<div class="panel">
			{#each pageResults as r (r.key)}
				{@const ranked = isRanked(r.mode)}
				<MatchBanner
					variant="result"
					left={{ sid: r.winner, name: r.winner_name, rating: ranked ? r.winner_rating : undefined, team: r.winner_team }}
					right={{ sid: r.loser, name: r.loser_name, rating: ranked ? r.loser_rating : undefined, team: r.loser_team }}
					{ranked}
					mode={r.mode ?? ''}
					elo={r.elo}
					ts={r.ts}
					ocv={r.ocv}
					perfect={r.perfect}
					comeback={r.comeback}
					combo={r.combo ?? 0}
					verified={r.verified}
					sessionId={r.session_id}
					mine={involvesMe(r.winner, r.loser)}
					onOpen={openSet}
				/>
			{/each}
		</div>

		{#if pageCount > 1}
			<nav class="pager" aria-label="Live Results pages">
				<button class="pg" disabled={page === 0} onclick={() => (page = Math.max(0, page - 1))}>‹ Prev</button>
				<div class="dots">
					{#each Array(pageCount) as _, i (i)}
						<button class="dot" class:on={i === page} onclick={() => (page = i)} aria-label="Page {i + 1}" aria-current={i === page}></button>
					{/each}
				</div>
				<button class="pg" disabled={page >= pageCount - 1} onclick={() => (page = Math.min(pageCount - 1, page + 1))}>Next ›</button>
			</nav>
		{/if}
	{/if}
</section>

{#if openSession}
	<SessionModal sessionId={openSession} live={openIsLive} onClose={() => (openSession = null)} />
{/if}

<style>
	.mast {
		position: relative;
		overflow: hidden;
		padding: 14px 4px 10px;
		margin-bottom: 4px;
	}
	.ghost {
		position: absolute;
		right: 0;
		top: -6px;
		font-size: clamp(46px, 12vw, 96px);
		font-style: italic;
		font-weight: 900;
		letter-spacing: -0.03em;
		color: var(--ink);
		opacity: 0.045;
		pointer-events: none;
		user-select: none;
		white-space: nowrap;
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.mtitle {
		font-size: clamp(20px, 5.5vw, 27px);
		font-weight: 900;
		font-style: italic;
		letter-spacing: 0.01em;
	}
	.seam {
		height: 3px;
		width: 120px;
		margin: 8px 0 9px;
		transform: skewX(-14deg);
		background: linear-gradient(90deg, var(--acc), transparent);
	}
	.mdesc {
		margin: 0;
		max-width: 720px;
		color: var(--dim);
		font-size: 12.5px;
		line-height: 1.5;
	}

	/* 🪙 one-tap accept funnel card — the share-link hero. Gold-cut arena panel, same button vocabulary as
	   the WagerRail so the two read as one system. */
	.invite {
		margin: 0 0 14px;
		padding: 14px 16px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: linear-gradient(120deg, var(--gold-soft), transparent 78%), var(--panel);
	}
	.invite.live {
		border-left: 3px solid var(--gold);
	}
	.invite .lab {
		display: block;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
		margin-bottom: 6px;
	}
	.iline {
		margin: 0;
		font-size: 14px;
		color: var(--ink);
		line-height: 1.45;
	}
	.iline.dim {
		color: var(--dim);
	}
	.iline b {
		font-weight: 800;
	}
	.iacts {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 10px;
	}
	.invite .gold,
	.invite .steam {
		font: inherit;
		font-size: 13px;
		font-weight: 800;
		border-radius: 9px;
		padding: 0 15px;
		min-height: 42px;
		cursor: pointer;
		white-space: nowrap;
	}
	.invite .gold {
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		font-style: italic;
		font-weight: 900;
	}
	.invite .gold:hover:not(:disabled) {
		filter: brightness(1.05);
	}
	.invite .gold:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.invite .steam {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: #dfe9f5;
		background: linear-gradient(180deg, #2a475e, #1b2838);
		border: 1px solid color-mix(in srgb, #66c0f4 35%, transparent);
	}
	.invite .steam:hover {
		border-color: #66c0f4;
		color: #fff;
	}
	.invite .railnote {
		margin-top: 10px;
		font-size: 12.5px;
		font-weight: 700;
	}
	.invite .railnote.ok {
		color: var(--good);
	}
	.invite .railnote.err {
		color: var(--live);
	}

	/* pulsing live dot inside the pill (motion-safe only) */
	.pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--live);
		flex: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.pill .dot {
			animation: pulse 1.6s ease-in-out infinite;
		}
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.35; }
	}

	.sec {
		margin-top: 16px;
	}
	/* Section header: title on the left, the mode tab-list on the right (wraps under it on phones). */
	.sechd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}
	.shead {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 800;
		letter-spacing: 0.02em;
		color: var(--ink);
	}
	.sechd .shead {
		margin: 0;
	}
	.shead .ic {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.shead .ic.on {
		background: color-mix(in srgb, var(--good) 20%, transparent);
	}
	.shead .ic.on .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--good);
	}
	@media (prefers-reduced-motion: no-preference) {
		.shead .ic.on .dot {
			animation: pulse 1.6s ease-in-out infinite;
		}
	}
	.shead .ic.res {
		width: 8px;
		height: 8px;
		background: var(--live);
	}
	.cnt {
		font-size: 11px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--faint);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 1px 7px;
	}

	/* Mode tab-list — a rounded segmented control, cloned from the /ranks scope switch. */
	.scopes {
		display: inline-flex;
		align-items: center;
		flex: none;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--panel);
	}
	.scope {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 0;
		background: transparent;
		color: var(--dim);
		border-radius: 999px;
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.15s, background 0.15s;
	}
	.scope:hover {
		color: var(--ink);
	}
	.scope.on {
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		color: var(--gold-ink);
		font-style: italic;
	}
	.sic {
		font-size: 12.5px;
		line-height: 1;
	}

	.panel {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
	}

	/* pager — arena-styled prev/next + page dots */
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		margin-top: 12px;
	}
	.pg {
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		color: var(--dim);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 6px 14px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.pg:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.pg:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.dots {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		width: 8px;
		height: 8px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--line);
		cursor: pointer;
		transition: background 0.15s, transform 0.15s;
	}
	.dot:hover {
		background: var(--faint);
	}
	.dot.on {
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		transform: scale(1.25);
	}

	@media (max-width: 560px) {
		.scopes {
			width: 100%;
			justify-content: space-between;
		}
		.scope {
			padding: 6px 10px;
		}
	}
</style>
