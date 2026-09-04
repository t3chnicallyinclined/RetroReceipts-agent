<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page as appPage } from '$app/state'; // aliased — a local `page` (pagination) already lives below
	import { matchfeed, type FeedMode, type MatchResult } from '$lib/stores/matchfeed.svelte';
	import { wager } from '$lib/stores/wager.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import MatchBanner from '$lib/components/MatchBanner.svelte';
	import Masthead from '$lib/components/Masthead.svelte';
	import VersusCard from '$lib/components/VersusCard.svelte';
	import PlayerPlate from '$lib/components/PlayerPlate.svelte';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { hosts } from '$lib/stores/hosts.svelte';
	import MyMatch from '$lib/components/MyMatch.svelte';
	import WagerRail from '$lib/components/WagerRail.svelte';
	import Marquee from '$lib/components/Marquee.svelte';
	import RailPanel, { type RailMatch } from '$lib/components/RailPanel.svelte';
	import { apiGet } from '$lib/net.svelte';
	import { api } from '$lib/config';
	import SessionModal from '$lib/components/SessionModal.svelte';
	import BrowseMatches from '$lib/components/BrowseMatches.svelte';
	import ResultCheckBanner from '$lib/components/ResultCheckBanner.svelte';
	import HostBanner from '$lib/components/HostBanner.svelte';
	import ReplayEmbed, { type ReplayMeta, type State as EmbedState } from '$lib/components/ReplayEmbed.svelte';
	import { shortSetLink } from '$lib/share';
	import { timeAgo } from '$lib/format';
	import { motd } from '$lib/stores/motd.svelte';
	import {
		availability,
		gated,
		localTapes,
		resolveSource,
		seatsOf,
		sourceOfLocal,
		type LocalTape,
		type ReplayAvail,
		type ReplaySource
	} from '$lib/replay/source';

	// ▶ LIVE (route /match, nav label "Live" — LIVE-TAB-SPEC): live money matches, now playing, live results —
	// and a live result expands in place into a ReplayEmbed rendered from the match tape. Everything pushes off
	// the app-wide `matches` SSE channel (a mode-scoped seed fetch backs Live Results; a seed fetch for the
	// wager rail/marquee). onMount opens the streams and pauses them while the tab is hidden (CPU discipline).
	onMount(() => {
		matchfeed.connect();
		// ONE un-scoped limit=100 read for the day's crown (§1.6). The tab's own feed store stays mode-scoped at
		// 20 rows; the crown must consider matches the visitor's current scope filters out, so it reads wider.
		void motd.load();
		void wager.loadOpen();
		if (auth.steamid) void wager.loadMine(auth.steamid);
		const onVis = () => {
			if (document.hidden) {
				matchfeed.disconnect();
			} else {
				matchfeed.connect();
				void wager.loadOpen();
				if (auth.steamid) void wager.loadMine(auth.steamid);
			}
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			matchfeed.disconnect();
		};
	});

	// keep the rail bound to the signed-in user (covers a sign-in/out while this tab is open).
	$effect(() => {
		const sid = auth.steamid;
		if (sid) void wager.loadMine(sid);
		else wager.mine = null;
	});

	const nowPlaying = $derived(matchfeed.nowPlaying);

	// 🎟 the rail board — locked money matches (LIVE MONEY cards); 20s refresh while the tab is visible
	let railBoard = $state<RailMatch[]>([]);
	async function loadRail(): Promise<void> {
		try {
			const j = await apiGet<{ ok?: boolean; matches?: RailMatch[] }>('/rr/rail/board', { ttl: 15_000 });
			if (j?.ok) railBoard = j.matches ?? [];
		} catch {
			/* keep last-good */
		}
	}

	// 🕹 THE ARCADE — live cabinets anyone can WATCH (referee lobbies: host spectates, seats free by design).
	interface ArcadeCab {
		steamid: string;
		name?: string;
		city?: string;
		cc?: string;
		ft?: number;
		members?: number;
		active?: number;
		spectatable?: boolean;
		spectate_url?: string;
	}
	let cabs = $state<ArcadeCab[]>([]);
	async function loadCabs(): Promise<void> {
		try {
			const j = await apiGet<{ ok?: boolean; hosts?: ArcadeCab[] }>('/rr/arcade/hosts', { ttl: 15_000 });
			cabs = (j?.hosts ?? []).filter((h) => h.spectatable && h.spectate_url);
		} catch {
			/* keep last-good */
		}
	}
	onMount(() => {
		void loadRail();
		void loadCabs();
		const iv = setInterval(() => {
			if (!document.hidden) {
				void loadRail();
				void loadCabs();
			}
		}, 20_000);
		return () => clearInterval(iv);
	});
	const results = $derived(matchfeed.results);
	const mode = $derived(matchfeed.mode);
	const me = $derived(auth.steamid);

	// ── 🪙 one-tap accept funnel (share link → nobd.net/app/match?mm=<id>) — unchanged ────────────────────
	const mmId = $derived(appPage.url.searchParams.get('mm') ?? '');
	let inviteEl = $state<HTMLElement | null>(null);
	let inviteChecked = $state(false);
	let inviteActing = $state(false);
	let inviteNotice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
	const invite = $derived(
		mmId ? (wager.open.find((x) => x.id === mmId) ?? (wager.mine?.id === mmId ? wager.mine : null)) : null
	);
	const inviteOpen = $derived(!!invite && invite.status === 'open' && invite.challenger !== me);
	const inviteOwn = $derived(!!invite && invite.status === 'open' && invite.challenger === me);
	const inviteStake = $derived(invite?.stake ?? 0);
	const invitePot = $derived(invite ? (invite.pot ?? invite.stake * 2) : 0);
	const inviteChallenger = $derived(invite?.challenger_name || 'A challenger');

	async function acceptInvite() {
		if (!auth.authed) {
			auth.login(`/match?mm=${encodeURIComponent(mmId)}`);
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

	// ── Live Results scopes — 🪙 Money added (the server already filters it, routes.rs:1121-1132) ──
	const MODES: { id: FeedMode; label: string; icon: string }[] = [
		{ id: 'ranked', label: 'Ranked', icon: '⚔' },
		{ id: 'lobby', label: 'Lobby', icon: '🎮' },
		{ id: 'tourney', label: 'Tournament', icon: '🏆' },
		{ id: 'money', label: 'Money', icon: '🪙' }
	];
	const MODE_NAME: Record<FeedMode, string> = { ranked: 'ranked', lobby: 'lobby', tourney: 'tournament', money: 'money' };

	function selectMode(m: FeedMode) {
		if (m === matchfeed.mode) return;
		open = null; // a scope change collapses the open replay (§6.2)
		matchfeed.setMode(m);
		page = 0;
	}

	// ── Pagination — 5 per page, up to 20 rows (4 pages). ──
	const PER_PAGE = 5;
	let page = $state(0);
	const pageCount = $derived(Math.max(1, Math.ceil(results.length / PER_PAGE)));
	$effect(() => {
		if (page > pageCount - 1) page = pageCount - 1;
	});
	const pageResults = $derived(results.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE));
	function gotoPage(p: number) {
		open = null; // a page change collapses the open replay (§6.2)
		page = Math.max(0, Math.min(pageCount - 1, p));
	}

	// ── Session ("set") modal — a result OR live row opens the game-by-game set view for its session_id. ──
	let openSession = $state<string | null>(null);
	$effect(() => {
		const ids = [
			...nowPlaying.flatMap((p) => [p.a, p.b]),
			...results.flatMap((r) => [r.winner, r.loser])
		];
		if (ids.length) void loadouts.prime(ids);
	});
	function openSet(id: string) {
		openSession = id;
	}
	const openIsLive = $derived(!!openSession && nowPlaying.some((p) => p.session_id === openSession));

	// §1.4 — the SAME predicate MyMatch renders its in-match branch on (MyMatch.svelte: `isHost`/`mine`), so the
	// strip can never appear above the theatre in a state where it draws its idle body.
	const inMatch = $derived(!!me && !hosts.byId(me) && nowPlaying.some((p) => p.a === me || p.b === me));
	const isRanked = (m?: string) => m === 'ranked';
	const involvesMe = (a: string, b: string) => !!me && (a === me || b === me);
	const coldLoad = $derived(matchfeed.loading && results.length === 0);

	// ── Replay availability per result row (client-inferred until contract C1 lands, §7.11) ──
	let avail = $state<Record<string, ReplayAvail>>({});
	const asked = new Set<string>();
	$effect(() => {
		for (const r of pageResults) {
			if (asked.has(r.key)) continue;
			asked.add(r.key);
			void availability(r).then((a) => (avail = { ...avail, [r.key]: a }));
		}
	});

	// ── The expanded row → ReplayEmbed panel. ONE open per list; the same row again collapses. ──
	interface OpenPanel {
		key: string;
		meta: ReplayMeta;
		sessionId?: string;
		source: ReplaySource | null; // null while the resolver runs (the poster shows meanwhile)
		poster: string;
	}
	let open = $state<OpenPanel | null>(null);
	const slug = (k: string) => k.replace(/[^a-z0-9_-]/gi, '');
	// the interim poster is the OG fight card (§7.5); the embed falls back to the --board ground on a 404
	const posterFor = (sessionId?: string) => (sessionId ? api(`/rr/ogimg/${encodeURIComponent(sessionId)}.png`) : '');

	async function toggleRow(key: string, meta: ReplayMeta, sessionId: string | undefined, resolve: () => Promise<ReplaySource>) {
		if (open?.key === key) {
			open = null; // collapse; the embed disposes its player on unmount
			return;
		}
		open = { key, meta, sessionId, source: null, poster: posterFor(sessionId) };
		const src = await resolve();
		if (open?.key === key) open = { ...open, source: src };
		await tick();
		document.getElementById(`replay-${slug(key)}`)?.scrollIntoView({ block: 'nearest' });
	}

	function metaOf(r: MatchResult): ReplayMeta {
		const ranked = isRanked(r.mode);
		return {
			a: { steamid: r.winner, name: r.winner_name, rating: ranked ? (r.winner_rating ?? null) : null, team: r.winner_team },
			b: { steamid: r.loser, name: r.loser_name, rating: ranked ? (r.loser_rating ?? null) : null, team: r.loser_team },
			winner: 'a',
			mode: r.mode ?? '',
			ts: r.ts,
			durationS: r.duration_s,
			sessionId: r.session_id,
			key: r.match_key ?? r.key,
			...(seatsOf(r) ?? {})
		};
	}

	let copied = $state('');
	async function copyLink(sessionId: string) {
		try {
			await navigator.clipboard.writeText(shortSetLink(sessionId));
			copied = sessionId;
			setTimeout(() => (copied = ''), 1800);
		} catch {
			/* clipboard blocked — the receipt itself has the link */
		}
	}

	// ── DEV: TEST TAPES — the local packs as playable rows (dev build or ?dev=1) so the replay path can be
	// watched with an empty/stale feed. Packs are ROM-derived and served only from the gitignored dev folder.
	const dev = $derived(import.meta.env.DEV || appPage.url.searchParams.get('dev') === '1');
	let testTapes = $state<[string, LocalTape][]>([]);
	$effect(() => {
		if (!dev) return;
		void localTapes().then((t) => (testTapes = Object.entries(t)));
	});
	function metaOfLocal(id: string, t: LocalTape): ReplayMeta {
		return {
			a: { steamid: t.a.steamid, name: t.a.name, team: t.a.team },
			b: { steamid: t.b.steamid, name: t.b.name, team: t.b.team },
			winner: t.winner,
			mode: t.mode,
			ts: t.ts,
			stageId: t.stageId,
			durationS: t.frames ? Math.round(t.frames / 60) : undefined,
			sessionId: t.sessionId,
			key: t.matchKey ?? id,
			p1: t.p1 || undefined,
			p2: t.p2 || undefined
		};
	}

	// ── ▓▓▓ THE THEATRE (LIVE-TAB-V2-SPEC §1) ─────────────────────────────────────────────────────────────
	// The LIVE tab is "a room with a picture in it": the match most worth watching is ALREADY PLAYING when the
	// page opens, a result row swaps it, and a share link picks it. This is the LATEST TAPE hero grown up —
	// same resolver shape, same two guards, one priority list (§1.2):
	//
	//   1. the URL's pick — ?m=<match_key> (a share link, a row tapped here, or a row picked in BROWSE)
	//   2. MATCH OF THE DAY — the best replayable match of today, when the day earns a crown (§1.6)
	//   3. the latest tape — the newest row whose availability() is ready/saved (today's rule, unchanged)
	//   4. the newest result, unplayable — the poster + the honest state copy (never an empty box, §2.1)
	//   5. nothing at all
	//
	// The two guards outrank all of it and are UNCHANGED: a picture being watched is never yanked, and a share
	// link's ?m= beats the automatic pick. Live games are deliberately NOT a picture — join_link/spectate_url are
	// Steam host links, not frames (mvc-live-match-spectate is a TO-DO) — so games in progress get one quiet
	// marquee chip that SCROLLS to NOW PLAYING. It does not pretend to be a broadcast.
	//
	// ⚠ `data-test="hero"` and hookName="rrHero" are the SMOKE HARNESS's stable handles for this slot
	// (scripts/smoke-replay.mjs --hero/--overlay/--art). They are deliberately NOT renamed with the concept.
	interface Theatre {
		key: string;
		meta: ReplayMeta;
		sessionId?: string;
		source: ReplaySource | null; // null while the resolver runs
		poster: string;
		playable: boolean; // a `ready` tape (or a local test tape) — else the state copy
		/** the feed row behind the picture, when there is one — the marquee's sub-line reads it */
		row: MatchResult | null;
	}
	let theatre = $state<Theatre | null>(null);
	let theatreEmbed = $state<ReplayEmbed | null>(null);
	let theatreSt = $state<EmbedState | ''>('');
	let theatreEl = $state<HTMLElement | null>(null);
	let autoload = $state(true);
	let theatreSeq = 0;
	// phones / Save-Data: never auto-download a tape + pack (decided once, at mount)
	onMount(() => {
		const ua = navigator.userAgent;
		const phone = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 720);
		const saveData = !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
		autoload = !phone && !saveData;
	});

	const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

	// ?m=<match_key> — the share link's pick, and where a row tap records itself so the resolver's priority 1
	// re-selects it instead of fighting it. Seeded from the URL at load; held in local $state rather than read
	// back off `appPage.url` because we write it with raw history (no navigation, no remount).
	let picked = $state(appPage.url.searchParams.get('m') ?? '');
	/**
	 * The row behind the pick, kept alongside the key.
	 *
	 * The LIVE list holds 20 rows for ONE scope, so a picked match very often is not in it: a money match
	 * picked while the tab shows ranked, a row chosen from BROWSE's newest-100, or a share link to anything
	 * older than the current page. Without this, the resolver's priority 1 would fail to find the row and fall
	 * through — quietly yanking the theatre back to the automatic pick a moment after the viewer chose.
	 */
	let pickedRow = $state<MatchResult | null>(null);
	function rememberPick(key: string, row: MatchResult | null = null) {
		picked = key;
		pickedRow = row;
		// replaceState, NOT pushState (§1.5): the theatre's content is a VIEW state — ten row taps must not cost
		// ten back presses. The route stays /match, so every share link already in the wild keeps working.
		const u = new URL(location.href);
		u.searchParams.set('m', key);
		history.replaceState(history.state, '', u);
	}

	const watching = () => theatreSt === 'playing' || theatreSt === 'paused' || theatreSt === 'seeking';
	function setTheatre(
		key: string,
		meta: ReplayMeta,
		sessionId: string | undefined,
		resolve: () => Promise<ReplaySource>,
		playable: boolean,
		row: MatchResult | null = null
	) {
		if (theatre?.key === key) return; // same tape — never remount a picture
		const seq = ++theatreSeq;
		theatre = { key, meta, sessionId, source: null, poster: posterFor(sessionId), playable, row };
		void resolve().then((src) => {
			if (seq === theatreSeq && theatre?.key === key) theatre = { ...theatre, source: src };
		});
	}

	/**
	 * §1.5 — what tapping a LIVE RESULTS row does now.
	 *   ready / saved            → SWAP THE THEATRE (there is a picture to put up)
	 *   pending / archived / none → open THE TAPE (the set receipt), as today — there is no picture to swap in
	 * The in-place expansion panel is gone from this list: with a theatre on the page, expanding in place means
	 * two pictures and a permanent question about which one is "the" picture. The DEV Test Tapes section below
	 * keeps the panel — it is the render lane's bench, dev-only, and the smoke harness drives it.
	 */
	function rowTap(r: MatchResult) {
		const a = avail[r.key];
		if (a === 'ready' || a === 'saved') void showRow(r);
		else if (r.session_id) openSet(r.session_id);
	}

	/** A result row became the picture: swap, remember it in ?m=, and bring the theatre into view (§1.5). */
	async function showRow(r: MatchResult) {
		const key = r.match_key ?? r.key;
		rememberPick(key, r);
		setTheatre(key, metaOf(r), r.session_id, () => resolveSource(r), true, r);
		await tick();
		theatreEl?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
	}

	async function pickTheatre(rows: MatchResult[], tapes: [string, LocalTape][], isDev: boolean, pick: string) {
		// never yank a picture that is being watched; a newer tape takes over when this one is idle/ended/unplayable
		if (theatre && watching()) return;
		// 1 — the URL's pick. A share link must land on ITS match, so this outranks everything automatic.
		// Look in three places, widest last: the row the viewer just picked, the current scope's live rows, and
		// the un-scoped newest-100 the crown already loaded (which is how a share link to an out-of-scope or
		// older match still resolves without a new endpoint).
		if (pick) {
			const r =
				(pickedRow && (pickedRow.match_key ?? pickedRow.key) === pick ? pickedRow : null) ??
				rows.find((x) => (x.match_key ?? x.key) === pick) ??
				motd.rows.find((x) => (x.match_key ?? x.key) === pick);
			if (r) {
				const a = await availability(r);
				setTheatre(pick, metaOf(r), r.session_id, () => resolveSource(r), a === 'ready' || a === 'saved', r);
				return;
			}
		}
		// DEV: `?hero=<test tape id>` pins the picture to a LOCAL pack so a headless run is deterministic (a real prod
		// row now resolves `ready` on the dev server and would legitimately open the art panel instead of playing)
		if (isDev) {
			const pin = appPage.url.searchParams.get('hero');
			const t = pin ? tapes.find(([id]) => id === pin) : null;
			if (t) {
				setTheatre(t[0], metaOfLocal(t[0], t[1]), t[1].sessionId, async () => sourceOfLocal(t[1]), true);
				return;
			}
		}
		// 2 — MATCH OF THE DAY (§1.6): the day's best replayable match. It is the DEFAULT PICK, not a badge on the
		// latest match — "newest" was only ever a proxy for "most watchable". Falls through when the day has none.
		const crown = motd.pick;
		if (crown) {
			const r = rows.find((x) => (x.match_key ?? x.key) === crown.key);
			if (r) {
				setTheatre(crown.key, metaOf(r), r.session_id, () => resolveSource(r), true, r);
				return;
			}
		}
		// 3 — the latest tape: the newest row that is actually playable.
		for (const r of rows) {
			const a = await availability(r);
			if (a === 'ready' || a === 'saved') {
				if (theatre && watching()) return;
				setTheatre(r.match_key ?? r.key, metaOf(r), r.session_id, () => resolveSource(r), true, r);
				return;
			}
		}
		if (isDev && tapes.length) {
			const [id, t] = [...tapes].sort((x, y) => y[1].ts - x[1].ts)[0];
			setTheatre(id, metaOfLocal(id, t), t.sessionId, async () => sourceOfLocal(t), true);
			return;
		}
		// 4 — the newest result, unplayable: the poster and the honest state copy. Never an empty box.
		const r = rows[0];
		if (r) setTheatre(r.match_key ?? r.key, metaOf(r), r.session_id, () => resolveSource(r), false, r);
	}
	$effect(() => {
		const rows = results;
		const tapes = testTapes;
		const isDev = dev;
		const pick = picked;
		if (matchfeed.loading && rows.length === 0) return;
		void pickTheatre(rows, tapes, isDev, pick);
	});
	// one picture at a time: an expanded DEV row pauses the theatre
	$effect(() => {
		if (open) theatreEmbed?.pause();
	});

	// ── the marquee (§1.1, §1.6) ──────────────────────────────────────────────────────────────────────────
	// Three labels, each literally true: MATCH OF THE DAY only when the day earned a crown, otherwise TODAY,
	// otherwise today's LATEST TAPE wording unchanged. The shout-out REPLACES the sub-line, so the theatre
	// gains no extra row.
	const isPick = $derived(!!motd.pick && !!theatre?.row && (theatre.row.match_key ?? theatre.row.key) === motd.pick.key);
	const theatreLabel = $derived(isPick ? (motd.crowned ? 'Match of the Day' : 'Today') : 'Latest Tape');
	const theatreIcon = $derived(isPick && motd.crowned ? '★' : '▶');
	/** the sub-line: the day's shout-out when this IS the pick, else the plain record line. */
	const theatreSub = $derived.by(() => {
		const r = theatre?.row;
		if (!r) return '';
		if (isPick && motd.pick && motd.pick.reasons.length) return `${r.winner_name} over ${r.loser_name} — ${motd.pick.reasons.join(' · ')}`;
		return `${r.winner_name} vs ${r.loser_name} · ${(r.mode ?? 'ranked').toUpperCase()} · ${timeAgo(r.ts)}`;
	});
	/** a newer tape landed while this one is being watched — one marquee line, never a yank (§1.2) */
	const newerTape = $derived.by(() => {
		if (!theatre || !watching()) return null;
		const cur = theatre.key;
		return results.find((r) => r.replay?.state === 'ready' && (r.match_key ?? r.key) !== cur && r.ts > (theatre?.row?.ts ?? 0)) ?? null;
	});
	// ── ⌕ BROWSE MATCHES (§3) — a popup over the theatre, never a route ──────────────────────────────────
	let browseOpen = $state(false);
	function pickFromBrowse(r: MatchResult) {
		browseOpen = false;
		void showRow(r);
	}
	// `B` opens it. Ignored while typing, while a modifier is held, and while any dialog is already up — a
	// shortcut that fires inside a text field is a bug, not a feature.
	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'b' && e.key !== 'B') return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (browseOpen || openSession) return;
			const t = e.target as HTMLElement | null;
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
			e.preventDefault();
			browseOpen = true;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function scrollToNowPlaying() {
		document.getElementById('now-playing')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
	}
</script>

<svelte:head><title>Live · Retro Receipts</title></svelte:head>

<!-- Masthead: LIVE · ghost ON AIR · the LIVE pill (LIVE-TAB-SPEC §10) -->
<Masthead
	title="LIVE"
	ghost="ON AIR"
	accent="var(--live)"
	desc="Money on the line, games in progress, results as they land — and the tape of every one."
>
	{#snippet pills()}
		<span class="pill live"><span class="dot" aria-hidden="true"></span>LIVE</span>
	{/snippet}
</Masthead>

<ResultCheckBanner />

{#if me}<HostBanner steamid={me} self />{/if}

<!-- 🪙 one-tap accept funnel — arrived via a share link (?mm=). Unchanged. -->
{#if mmId}
	<section class="invite" bind:this={inviteEl} class:live={inviteOpen}>
		<span class="lab">🪙 You've been challenged</span>
		{#if inviteOpen}
			<p class="iline">
				<b>{inviteChallenger}</b> puts up 🪙 {inviteStake} · FT{invite?.ft ?? 3} — play them for coins: put
				up yours and the winner takes the 🪙 {invitePot} pot.
			</p>
			<div class="iacts">
				{#if auth.authed}
					<button type="button" class="gold" disabled={inviteActing} onclick={acceptInvite}
						>⚔ {inviteActing ? '…' : `🪙 Put up ${inviteStake} & play`}</button
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
			<p class="iline dim">This is your quarter — it's up in the arcade below, waiting for a taker.</p>
		{:else if invite}
			<p class="iline dim">You're in this set — the live rail is below.</p>
		{:else if !auth.authed}
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
			<p class="iline dim">This challenge is no longer open — the quarter already left the arcade.</p>
		{:else}
			<p class="iline dim">Looking for this challenge…</p>
		{/if}
		{#if inviteNotice}
			<div class="railnote {inviteNotice.kind}" role="status">{inviteNotice.text}</div>
		{/if}
	</section>
{/if}

<!-- ▬ YOUR MATCH strip (§1.4). A replay is never more urgent than the game you are in the middle of, and an
     idle strip is never more urgent than the picture — so this sits ABOVE the theatre only while you are
     actually in a match; the idle / no-agent / signed-out states render below it. Same component either way. -->
{#if inMatch}<MyMatch onTape={openSet} />{/if}

<!-- ▓▓▓ THE THEATRE (LIVE-TAB-V2-SPEC §1) — the match most worth watching, already playing when the page opens.
     A result row swaps the picture; ?m= picks it; the three sections below keep their order and their internals.
     ⚠ data-test="hero" is the smoke harness's stable handle for this slot (scripts/smoke-replay.mjs). -->
<section class="sec theatre" data-test="hero" bind:this={theatreEl} aria-label="The theatre">
	<div class="sechd">
		<h2 class="shead">
			<span class="ic tape" aria-hidden="true">{theatreIcon}</span> {theatreLabel}
			{#if theatreSub}<span class="devnote shout">{theatreSub}</span>{/if}
		</h2>
		<div class="hacts">
			<!-- games in progress cannot be a picture yet (join_link is a Steam host link, not frames), so this
			     chip is honest about what it does: it SCROLLS to NOW PLAYING. -->
			{#if nowPlaying.length}
				<button type="button" class="onchip" onclick={scrollToNowPlaying}>
					<span class="dot" aria-hidden="true"></span>{nowPlaying.length} GAME{nowPlaying.length === 1 ? '' : 'S'} ON NOW ›
				</button>
			{/if}
			<button type="button" class="browse" onclick={() => (browseOpen = true)} title="Browse matches (B)">⌕ BROWSE MATCHES</button>
		</div>
	</div>

	<!-- a newer tape landed mid-watch: ONE line, never a yank (§1.2) -->
	{#if newerTape}
		<div class="newer" role="status">
			A newer match landed ·
			<button type="button" onclick={() => newerTape && showRow(newerTape)}>play it ›</button>
		</div>
	{/if}

	{#if theatre}
		{#if theatre.source}
			<ReplayEmbed
				bind:this={theatreEmbed}
				source={theatre.source}
				poster={theatre.poster}
				meta={theatre.meta}
				maxPicture={700}
				{autoload}
				autoart={autoload}
				hookName="rrHero"
				onstate={(st) => (theatreSt = st)}
			/>
		{:else}
			<div class="resolving"><span class="rail">Finding the tape</span></div>
		{/if}
		<!-- the actions live in the CHROME, never on the picture (§6 amendment 4) — so they still work in every
		     state the picture cannot play: no tape, no WebGPU, art not acknowledged, phone `closed`. -->
		<div class="acts">
			{#if theatre.sessionId}
				<button type="button" class="a" onclick={() => openSet(theatre?.sessionId ?? '')} title="THE TAPE — the set receipt"><span class="ico">🧾</span><span class="txt">THE TAPE ›</span></button>
				<button type="button" class="a" onclick={() => copyLink(theatre?.sessionId ?? '')} title="Copy link"><span class="ico">⧉</span><span class="txt">{copied === theatre.sessionId ? 'Copied' : 'Copy link'}</span></button>
			{/if}
			{#if theatre.playable}
				<button type="button" class="a" onclick={() => void theatreEmbed?.enterFullscreen()} title="Full screen (F)"><span class="ico">⛶</span><span class="txt">Full screen</span></button>
			{/if}
		</div>
	{:else if coldLoad}
		<div class="resolving"><span class="rail">Finding the last match</span></div>
	{:else}
		<div class="empty">No tapes yet — the next finished set lands here.</div>
	{/if}
</section>

{#if !inMatch}<MyMatch onTape={openSet} />{/if}

<!-- 🪙 LIVE MONEY (§5): your wager first (WagerRail self-manages: state rail or the quarter-up CTA), then one
     MoneyCard per locked wager on the rail board (RailPanel verbatim inside), then the arcade's open
     challenges folded into a collapsed disclosure (Tris Q1). Money leads because its clock is the shortest. -->
<section class="sec">
	<h2 class="shead"><span class="ic coin" aria-hidden="true">🪙</span> Live Money {#if railBoard.length}<span class="cnt">{railBoard.length}</span>{/if}</h2>
	<WagerRail />
	{#if railBoard.length}
		<p class="subnote">Bet on who wins — 1:1, winner takes 90%, <b>10% of every bet feeds the fighters' pot</b>. Betting closes when the match starts.</p>
		<div class="railboard">
			{#each railBoard as rm (rm.wager_id)}
				<div class="mc" class:on={rm.live}>
					<div class="mchd">
						<span class="mlab">🪙 MONEY MATCH · FT{rm.ft ?? 3}</span>
						<span class="pot">POT 🪙 {(rm.pot ?? rm.stake * 2) + (rm.rail?.pot_feed ?? 0)}</span>
					</div>
					<div class="mcvs">
						<PlayerPlate steamid={rm.challenger} name={rm.challenger_name} density="tag" />
						<span class="mcc">
							<i class="vsm" aria-hidden="true">VS</i>
							{#if rm.live || (rm.cw ?? 0) + (rm.aw ?? 0) > 0}<span class="sc">🔴 {rm.cw ?? 0} – {rm.aw ?? 0}</span>
							{:else}<span class="sc open">BETS OPEN</span>{/if}
						</span>
						<PlayerPlate steamid={rm.acceptor} name={rm.acceptor_name} density="tag" align="right" />
					</div>
					<RailPanel m={rm} />
				</div>
			{/each}
		</div>
	{/if}
	{#if wager.open.length}
		<details class="arcade">
			<summary><span>🪙 <b>{wager.open.length} quarter{wager.open.length === 1 ? '' : 's'}</b> up in the arcade — open challenges for coins</span><span class="chev" aria-hidden="true">▸</span></summary>
			<div class="arcin"><Marquee /></div>
		</details>
	{/if}
</section>

<!-- 🟢 NOW PLAYING (§4) — VersusCards unchanged, yours first via `mine`; THE ARCADE watch strip -->
<section class="sec" id="now-playing">
	<h2 class="shead"><span class="ic on"><span class="dot" aria-hidden="true"></span></span> Now Playing {#if nowPlaying.length}<span class="cnt">{nowPlaying.length}</span>{/if}</h2>
	{#if nowPlaying.length === 0}
		<div class="empty">No games in progress right now.</div>
	{:else}
		<div class="panel">
			{#each nowPlaying as p (p.key)}
				<VersusCard
					a={p.a}
					b={p.b}
					names={p.names}
					ratings={p.ratings}
					wins={p.wins}
					chars={p.chars}
					mode={p.mode ?? ''}
					joinLink={p.join_link ?? ''}
					mine={involvesMe(p.a, p.b)}
					onOpen={p.session_id ? () => openSet(p.session_id ?? '') : null}
				/>
			{/each}
		</div>
	{/if}

	{#if cabs.length}
		<div class="cabhd">THE ARCADE — WATCH A LIVE CABINET</div>
		{#each cabs as c (c.steamid)}
			<div class="cab">
				<span class="cabw">
					<b>{c.name || 'Cabinet'}</b>
					<span class="cabm mono">{c.city ? `${c.city} · ` : ''}FT{c.ft ?? 3}{(c.members ?? 0) > 1 ? ` · ${(c.members ?? 0) - 1} inside` : ''}</span>
					{#if c.active === 1}<span class="cablive">🔴 IN GAME</span>{/if}
				</span>
				<a class="cabbtn" href={c.spectate_url}>▶ WATCH</a>
			</div>
		{/each}
	{/if}
</section>

<!-- the expanded row's panel: ReplayEmbed + the actions row (THE TAPE › keeps commandment 5 through the panel) -->
{#snippet replayPanel(o: OpenPanel)}
	<section class="xp" id="replay-{slug(o.key)}" aria-label="Replay: {o.meta.a.name || 'Player'} vs {o.meta.b.name || 'Player'}">
		<div class="xpin">
			{#if o.source}
				<ReplayEmbed source={o.source} poster={o.poster} meta={o.meta} />
			{:else}
				<div class="resolving"><span class="rail">Finding the tape</span></div>
			{/if}
			<div class="acts">
				{#if o.sessionId}
					<button type="button" class="a" onclick={() => openSet(o.sessionId ?? '')} title="THE TAPE — the set receipt"><span class="ico">🧾</span><span class="txt">THE TAPE ›</span></button>
					<button type="button" class="a" onclick={() => copyLink(o.sessionId ?? '')} title="Copy link"><span class="ico">⧉</span><span class="txt">{copied === o.sessionId ? 'Copied' : 'Copy link'}</span></button>
				{/if}
				<!-- paid save (Tris Q2): affordance only, no price, disabled until the money lane wires it -->
				<button type="button" class="a gold" disabled title="coming soon"><span class="ico">💾</span><span class="txt">Save this tape</span></button>
			</div>
		</div>
	</section>
{/snippet}

<!-- 🔴 LIVE RESULTS (§6) — MatchBanner rows with the replay affordance; a row expands in place -->
<section class="sec">
	<div class="sechd">
		<h2 class="shead"><span class="ic res" aria-hidden="true"></span> Live Results {#if results.length}<span class="cnt">{results.length}</span>{/if}</h2>
		<button type="button" class="browseall" onclick={() => (browseOpen = true)}>Browse all ›</button>
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
				<div class="rrow">
					<MatchBanner
						a={{ steamid: r.winner, name: r.winner_name, rating: ranked ? (r.winner_rating ?? null) : null, team: r.winner_team ?? null }}
						b={{ steamid: r.loser, name: r.loser_name, rating: ranked ? (r.loser_rating ?? null) : null, team: r.loser_team ?? null }}
						winner="a"
						mode={r.mode ?? ''}
						ts={r.ts}
						delta={ranked && r.elo ? r.elo : null}
						dur={r.duration_s ?? null}
						ocv={r.ocv ?? false}
						perfect={r.perfect ?? false}
						comeback={r.comeback ?? false}
						verified={r.verified}
						replay={avail[r.key] ? gated(avail[r.key]) : null}
						onOpen={() => rowTap(r)}
					/>
				</div>
			{/each}
		</div>

		{#if pageCount > 1}
			<nav class="pager" aria-label="Live Results pages">
				<button class="pg" disabled={page === 0} onclick={() => gotoPage(page - 1)}>‹ Prev</button>
				<div class="dots">
					{#each Array(pageCount) as _, i (i)}
						<button class="dot" class:on={i === page} onclick={() => gotoPage(i)} aria-label="Page {i + 1}" aria-current={i === page}></button>
					{/each}
				</div>
				<button class="pg" disabled={page >= pageCount - 1} onclick={() => gotoPage(page + 1)}>Next ›</button>
			</nav>
		{/if}
	{/if}
</section>

<!-- 🧪 DEV ONLY: TEST TAPES — the local packs as playable rows (dev server or ?dev=1) -->
{#if dev && testTapes.length}
	<section class="sec" data-test="test-tapes">
		<h2 class="shead"><span class="ic dev" aria-hidden="true">🧪</span> Test Tapes <span class="cnt">{testTapes.length}</span> <span class="devnote">dev only · local packs, never committed</span></h2>
		<div class="panel">
			{#each testTapes as [id, t] (id)}
				<div class="rrow" class:open={open?.key === id} data-test="tape-row-{id}">
					<MatchBanner
						a={{ steamid: t.a.steamid, name: t.a.name, team: t.a.team ?? null }}
						b={{ steamid: t.b.steamid, name: t.b.name, team: t.b.team ?? null }}
						winner={t.winner}
						mode={t.mode}
						ts={t.ts}
						dur={t.frames ? Math.round(t.frames / 60) : null}
						replay="ready"
						expanded={open?.key === id}
						controls="replay-{slug(id)}"
						onOpen={() => toggleRow(id, metaOfLocal(id, t), t.sessionId, async () => sourceOfLocal(t))}
					/>
					{#if open?.key === id}{@render replayPanel(open)}{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

{#if openSession}
	<SessionModal sessionId={openSession} live={openIsLive} onClose={() => (openSession = null)} />
{/if}

{#if browseOpen}
	<BrowseMatches {mode} onClose={() => (browseOpen = false)} onPick={pickFromBrowse} />
{/if}

<style>
	/* 🪙 one-tap accept funnel card — unchanged */
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
	.sechd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}

	/* ── 🪙 LIVE MONEY — MoneyCard (the .rmatch family; RailPanel inside, unchanged) ── */
	.subnote {
		margin: 6px 0 10px;
		font-size: 12px;
		color: var(--dim);
	}
	.subnote b {
		color: var(--gold);
	}
	.ic.coin {
		font-size: 14px;
	}
	.railboard {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 10px;
	}
	.mc {
		border: 1px solid color-mix(in srgb, var(--gold) 26%, var(--line));
		border-radius: 12px;
		background: linear-gradient(120deg, var(--gold-soft), transparent 75%), var(--panel);
		padding: 11px 13px;
	}
	.mc.on {
		border-left: 3px solid var(--live);
	}
	.mchd {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}
	.mlab {
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		letter-spacing: 0.15em;
		color: var(--faint);
	}
	.pot {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--gold);
		font-weight: 700;
	}
	.mcvs {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 12px;
		margin: 8px 0 4px;
	}
	.mcvs > :global(.pp:last-child) {
		justify-self: end;
	}
	.mcc {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.vsm {
		font-style: italic;
		font-weight: 900;
		font-size: 14px;
		transform: skewX(-8deg);
		background: linear-gradient(175deg, #fff3c0 20%, var(--gold) 45%, #a3670a 80%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	/* the live score is the card's heavy-italic voice; BETS OPEN is record voice in --good */
	.sc {
		font-style: italic;
		font-weight: 900;
		font-size: 20px;
		color: var(--live);
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}
	.sc.open {
		font-family: ui-monospace, monospace;
		font-style: normal;
		font-weight: 600;
		font-size: 10px;
		letter-spacing: 0.14em;
		color: var(--good);
	}
	/* the arcade's open challenges — a collapsed disclosure (browse, not live) */
	.arcade {
		border: 1px dashed var(--line);
		border-radius: 10px;
		color: var(--dim);
		font-size: 12.5px;
		font-weight: 600;
		margin-top: 4px;
	}
	.arcade summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 9px 13px;
		cursor: pointer;
		list-style: none;
	}
	.arcade summary::-webkit-details-marker {
		display: none;
	}
	.arcade summary b {
		color: var(--gold);
	}
	.arcade[open] summary .chev {
		transform: rotate(90deg);
	}
	.arcade .chev {
		transition: transform 0.15s;
	}
	.arcin {
		padding: 0 6px 6px;
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
	.shead .ic.dev {
		font-size: 13px;
	}
	.devnote {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--faint);
		font-weight: 400;
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

	/* ── the expandable result row (§6.3-6.4) ── */
	.rrow {
		border-bottom: 1px solid var(--line-soft);
	}
	.rrow:last-child {
		border-bottom: 0;
	}
	.rrow > :global(.mb) {
		border-radius: 0;
		border-top: 0;
		border-right: 0;
		border-bottom: 0;
	}
	.xp {
		display: grid;
		grid-template-rows: 1fr;
		background: var(--panel);
		border-left: 3px solid var(--stream);
		padding: 0 12px 12px 12px;
	}
	.xpin {
		min-height: 0;
	}
	@media (prefers-reduced-motion: no-preference) {
		.xp {
			animation: xpgrow 0.18s ease-out;
		}
		.xpin {
			overflow: hidden;
		}
	}
	@keyframes xpgrow {
		from { grid-template-rows: 0fr; }
		to { grid-template-rows: 1fr; }
	}
	/* ▓▓▓ THE THEATRE (§1.1, §1.3): the embed is the page's subject, so its picture is capped at 700 rather than
	   640 (`maxPicture`) and the chrome — marquee above, actions below — never sits ON the picture (§6 amendment 4). */
	.theatre .ic.tape {
		display: inline-grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 4px;
		font-size: 9px;
		color: #fff;
		background: color-mix(in srgb, var(--stream) 78%, #000);
	}
	.hacts {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* the shout-out REPLACES the marquee's sub-line, so the theatre gains no extra row (§1.6) */
	.shout {
		color: var(--dim);
	}
	/* games in progress are not a picture (§1.2) — this chip only SCROLLS to NOW PLAYING, and says so with › */
	.onchip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--dim);
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		cursor: pointer;
		white-space: nowrap;
	}
	.onchip:hover {
		color: var(--ink);
		border-color: color-mix(in srgb, var(--live) 45%, var(--line));
	}
	.onchip .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--live);
		flex: none;
	}
	.browse,
	.browseall {
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--dim);
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		cursor: pointer;
		white-space: nowrap;
	}
	.browse:hover,
	.browseall:hover {
		color: var(--ink);
		border-color: color-mix(in srgb, var(--gold) 35%, var(--line));
	}
	.browseall {
		margin-left: auto;
		margin-right: 8px;
		border: 0;
		background: none;
		padding: 4px 2px;
	}
	/* a newer tape landed mid-watch — one line, never a yank (§1.2) */
	.newer {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 8px;
		font-size: 12px;
		color: var(--dim);
	}
	.newer button {
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		color: var(--stream);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline dotted;
	}
	.resolving {
		aspect-ratio: 4 / 3;
		max-width: 640px;
		margin: 0 auto;
		display: grid;
		place-items: center;
		background: var(--board);
		border: 1px solid color-mix(in srgb, var(--stream) 30%, var(--line));
		border-radius: 12px;
	}
	.theatre .resolving,
	.theatre .empty {
		max-width: 702px;
		margin-inline: auto;
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 10px;
	}
	/* the theatre's actions sit under its picture and share its width, so they read as one block */
	.theatre .acts {
		max-width: 702px;
		margin-inline: auto;
	}
	.acts .a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--dim);
		padding: 6px 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		cursor: pointer;
	}
	.acts .a:hover:not(:disabled) {
		color: var(--ink);
		border-color: color-mix(in srgb, var(--gold) 35%, var(--line));
	}
	.acts .a.gold {
		color: var(--gold);
		border-color: color-mix(in srgb, var(--gold) 40%, var(--line));
	}
	.acts .a:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.acts .ico {
		display: none;
	}

	/* pager */
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
			padding: 6px 8px;
		}
		.slbl {
			display: none;
		}
	}
	@media (max-width: 720px) {
		/* actions collapse to icons with labels on title (§6.3) */
		.acts .ico {
			display: inline;
		}
		.acts .txt {
			display: none;
		}
		.acts .a {
			min-width: 44px;
			min-height: 44px;
			justify-content: center;
		}
		.xp {
			padding: 0 8px 10px;
		}
	}
	/* 🕹 THE ARCADE watch strip */
	.cabhd {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.15em;
		color: var(--faint);
		margin: 12px 0 6px;
	}
	.cab {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 11px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		margin-bottom: 6px;
	}
	.cabw {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
		font-size: 12.5px;
	}
	.cabw b {
		font-weight: 800;
		color: var(--ink);
		white-space: nowrap;
	}
	.cabm {
		font-size: 10px;
		color: var(--faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cablive {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--live);
		white-space: nowrap;
	}
	.cabbtn {
		font-size: 11.5px;
		font-weight: 800;
		text-decoration: none;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-radius: 999px;
		padding: 6px 13px;
		white-space: nowrap;
	}
</style>
