<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { base } from '$app/paths';
	import PlayerPlate from './PlayerPlate.svelte';
	import type { ReplaySource } from '$lib/replay/source';
	import { auth } from '$lib/stores/auth.svelte';
	import { page as appPage } from '$app/state';
	import { requestReplay } from '$lib/replay/source';
	import {
		loadEngine,
		gpuDevice,
		canvasFormat,
		displayOpts,
		disposePlayer,
		hasWebGPU,
		type TapePlayerLike,
		type GpuCanvasContextLike,
		type GpuDeviceLike
	} from '$lib/replay/engine';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import SkinCredit, { type Credit } from './SkinCredit.svelte';

	// ▶ REPLAYEMBED (LIVE-TAB-SPEC §7 + REPLAY-OVERLAY-SPEC) — a rendered media element: the game's OWN pixels,
	// re-rendered from the match tape by the proven tape engine (Web Worker + wasm emitter + WebGPU), with an
	// OBS-style OVERLAY drawn ON the picture (Tris 2026-09-03: "all metadata is inside the match replay") and
	// transport chrome below it (inline) / as a fading HUD over its bottom edge (fullscreen).
	// Suffix Embed (design-system amendment §13.1): never a Card, never carries actions beyond transport.
	// THE OVERLAY IS DOM, NEVER CANVAS (REPLAY-OVERLAY-SPEC rev 2 §2.3, supersedes LIVE-TAB-SPEC §1.6's "nothing
	// overlays the picture" per §8.1): `.ovl` is a 640×480 sibling of the canvas, CSS-scaled with the picture
	// (transform: scale(k), k = rendered width / 640) so it is pixel-identical inline, in fullscreen and on phones —
	// and the scene target underneath stays the game's exact pixels (the smoke test asserts `readback()` is
	// unchanged with the layer on/off). Placement = the spec's §2.2 table in picture pixels (`--ov-*`). Timing
	// (§2.5): full for the first 3 s of play, on pause/seek/end, on hover (+3 s) and the last 3 s; minimal (plates +
	// watermark) while playing after the same 2.5 s idle timer as the HUD; below k 0.75 minimal-only while playing;
	// `o` cycles auto → full → minimal → off. Only the game's real textures/geometry are drawn
	// (feedback-render-only-game-assets); the layer draws identity, record and credit — text, never art.

	export interface ReplaySide {
		steamid: string;
		name?: string;
		aliases?: string[];
		avatar?: string;
		cc?: string;
		rating?: number | null;
		games?: number | null;
		team?: number[];
	}
	export interface ReplayMeta {
		a: ReplaySide;
		b: ReplaySide;
		winner: 'a' | 'b';
		score?: { a: number; b: number };
		gameNo?: number;
		mode: string;
		ft?: number;
		ts: number;
		stageId?: number;
		durationS?: number;
		sessionId?: string;
		/** the server's tape handle (app.rs:970) */
		key: string;
		/** the SteamID in each PHYSICAL seat, when known (skins: P1's own loadout paints slots 0/2/4, P2's 1/3/5) */
		p1?: string;
		p2?: string;
		/** paid-saved tape (LIVE-TAB-SPEC §7.11 `saved`) → the gold SAVED pill; nothing sets it today (POST /rr/tape/save pending) */
		saved?: boolean;
	}
	export type Progress = { phase: 'pack' | 'tape' | 'open' | 'prime' | 'stream'; got: number; total: number };
	export type State = 'closed' | 'checking' | 'unsupported' | 'unavailable' | 'nopack' | 'loading' | 'error' | 'ready' | 'playing' | 'paused' | 'seeking' | 'ended';
	export type OverlayMode = 'full' | 'minimal' | 'off';
	/** skin credits per WEARER (steamid → one entry per credited character). EMPTY today: the public loadout
	 *  is `{cid, colors}` (REPLAY-OVERLAY-SPEC §0, C13) — the slot renders nothing until provenance ships. */
	export type SeatCredits = Record<string, Credit[]>;

	let {
		source,
		poster = '',
		meta,
		skins = null,
		credits = null,
		autoplay = 'auto',
		autoload = true,
		quality = 'high',
		hookName = 'rrEmbed',
		onready = null,
		onerror = null,
		onended = null,
		onprogress = null,
		onfullscreenchange = null,
		onstate = null
	}: {
		source: ReplaySource;
		/** a still for the closed/loading states — the OG fight card (interim, §7.5); '' = the --board ground */
		poster?: string;
		/** server-resolved identity — NEVER read from the tape (REPLAY-META-SKINS-SPEC §1-2) */
		meta: ReplayMeta;
		/** raw-int loadouts PER SEAT for the emitter ({p1:[{cid,colors}], p2:[…]}); null = build from loadouts + meta.p1/p2 */
		skins?: { p1?: { cid: number; colors: number[] }[]; p2?: { cid: number; colors: number[] }[] } | null;
		/** creator credit lines under each plate (REPLAY-OVERLAY-SPEC §3); null = none known (today: always) */
		credits?: SeatCredits | null;
		/** 'auto' = play when ready unless reduced-motion / Save-Data (Tris Q4: on) */
		autoplay?: 'auto' | 'never';
		/** false = sit `closed` on the poster until a tap (phones: a 20 MB pack + tape never auto-downloads on mobile data) */
		autoload?: boolean;
		/** the window global the test hook registers under (`window.__<hookName>`); the LIVE hero uses 'rrHero' so the
		 *  smoke test can drive it and an expanded row (default 'rrEmbed') at the same time */
		hookName?: string;
		/** high = internal res 4× + box filter into the 640×480 canvas; base = res 2× nearest (low-end / after a GPU error) */
		quality?: 'high' | 'base';
		onready?: ((e: { frames: number; openMs: number; ttffMs: number }) => void) | null;
		onerror?: ((e: { code: 'webgpu' | 'fetch' | 'open' | 'decode' | 'gpu'; message: string }) => void) | null;
		onended?: (() => void) | null;
		onprogress?: ((p: Progress) => void) | null;
		onfullscreenchange?: ((e: { fullscreen: boolean }) => void) | null;
		/** every state change (the LIVE hero uses it to keep a picture that is being watched) */
		onstate?: ((s: State) => void) | null;
	} = $props();

	// ── state ──
	// svelte-ignore state_referenced_locally
	let st = $state<State>(autoload ? 'checking' : 'closed');
	$effect(() => {
		onstate?.(st);
	});
	let reason = $state<'pending' | 'archived' | 'requested' | 'expired' | 'none' | 'unsupported' | 'signin'>('none');
	let requesting = $state(false);
	let requestNote = $state('');
	let err = $state<{ code: string; message: string } | null>(null);
	let prog = $state<{ pack: [number, number]; tape: [number, number]; phase: Progress['phase']; prime: [number, number] }>({
		pack: [0, 0],
		tape: [0, 0],
		phase: 'tape',
		prime: [0, 0]
	});
	let slow = $state(false); // loading > 20 s → the honesty line
	let frame = $state(0);
	let count = $state(0);
	let speed = $state(60); // game frames per second: 60 = real time
	let halfAuto = $state(false); // "playing at half speed" (worker can't keep up)
	let userSpeed = $state(false); // the user chose a speed: the auto half-speed never overrides it
	let seekTarget = $state(-1);
	let seekServed = $state(-1);
	let scrubPreview = $state<number | null>(null);
	let fs = $state(false); // real Fullscreen API
	let pseudo = $state(false); // iPhone-style overlay fullscreen
	let hud = $state(true);
	let hover = $state(false); // pointer inside the wrapper (inline: the overlay stays full while hovered)
	let intro = $state(false); // the first 3 s after play() — the overlay stays full
	let ovMode = $state<'auto' | OverlayMode>('auto'); // the viewer's `o` choice; auto = the timer decides
	let ovToast = $state(''); // "overlay · minimal" for 1.2 s after `o`
	let k = $state(1); // overlay scale = rendered picture width / 640 (ResizeObserver on .pic)
	let turnHint = $state(false);
	let portrait = $state(false);
	let fsScale = $state(1);
	let fsBy = $state(0); // fullscreen landscape: the letterbox band under the picture, px (the HUD anchors to the picture)
	let loadAsked = false; // `closed` → a tap asked for the load
	let liveText = $state('');
	let ttff = $state(0);
	let openMs = $state(0);
	// svelte-ignore state_referenced_locally
	let q = $state<'high' | 'base'>(quality); // the prop is the INITIAL quality; the embed downgrades on a GPU error
	let posterOk = $state(true); // the interim OG card can 404 (no session / not rendered yet) → the --board ground
	let retried = false;

	let wrap = $state<HTMLDivElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let playBtn = $state<HTMLButtonElement | null>(null);
	let ctx: GpuCanvasContextLike | null = null;
	let device: GpuDeviceLike | null = null;
	let player: TapePlayerLike | null = null;
	let tapeBlobUrl = '';
	let raf = 0;
	let playing = $state(false);
	let showSeq = 0;
	let disposed = false;
	let hudTimer: ReturnType<typeof setTimeout> | null = null;
	let introTimer: ReturnType<typeof setTimeout> | null = null;
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let liveAt = 0;
	let lastServed = -1;
	let pushedState = false;
	let prevOverflow = '';

	const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const saveData = () => !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
	const isPlayable = $derived(st === 'ready' || st === 'playing' || st === 'paused' || st === 'seeking' || st === 'ended');
	const fullscreen = $derived(fs || pseudo);
	const MODE_LABEL: Record<string, string> = { ranked: 'RANKED', lobby: 'LOBBY', money: 'MONEY', tourney: 'TOURNEY', tournament: 'TOURNEY' };
	const modeLabel = $derived(MODE_LABEL[meta.mode] ?? (meta.mode ? meta.mode.toUpperCase() : ''));
	const mmss = (f: number) => {
		const s = Math.floor(Math.max(0, f) / 60);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
	const mb = (n: number) => (n / 1048576).toFixed(1);
	const durText = $derived(meta.durationS ? mmss(meta.durationS * 60) : count ? mmss(count) : '');
	// the tape's ts in the VIEWER's local time (record voice: YYYY-MM-DD HH:MM)
	const pad2 = (n: number) => String(n).padStart(2, '0');
	const dateText = $derived.by(() => {
		if (!meta.ts) return '';
		const d = new Date(meta.ts);
		return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
	});
	const ariaPic = $derived(`Match replay, frame ${frame + 1} of ${count}`);
	// the `o` toast / the seek pill / the half-speed note share one slot
	const noteText = $derived(ovToast ? ovToast : st === 'seeking' ? 'skipping ahead…' : halfAuto && playing ? 'playing at half speed' : '');

	// ── sides (REPLAY-OVERLAY-SPEC §1.1-1.2): the game's sides when seats are known — P1's plate LEFT, P2's RIGHT,
	// the same sides as the health bars in the picture; unknown seats = the row's order (a left, b right), unlabelled,
	// the picture plays stock and the record line says `stock colors` (§5a). Sides never re-sort; gold marks the winner.
	const seatsKnown = $derived(!!(meta.p1 || meta.p2));
	const leftIsB = $derived(
		seatsKnown &&
			((!!meta.p1 && meta.p1 === meta.b.steamid && meta.p1 !== meta.a.steamid) ||
				(!!meta.p2 && meta.p2 === meta.a.steamid && meta.p2 !== meta.b.steamid))
	);
	const left = $derived(leftIsB ? meta.b : meta.a);
	const right = $derived(leftIsB ? meta.a : meta.b);
	const leftWon = $derived(meta.winner === (leftIsB ? 'b' : 'a'));
	const scoreL = $derived(meta.score ? (leftIsB ? meta.score.b : meta.score.a) : null);
	const scoreR = $derived(meta.score ? (leftIsB ? meta.score.a : meta.score.b) : null);
	const groupLabel = (side: ReplaySide, seat: 1 | 2) =>
		`${seatsKnown ? `Player ${seat}: ` : ''}${side.name || (side.steamid ? `…${side.steamid.slice(-5)}` : 'Player')}`;

	// ── the overlay mode (REPLAY-OVERLAY-SPEC, Tris 2026-09-03): full for the first 3 s of play, on pause/seek/end,
	// and while hovered inline; minimal (names + watermark) once the same 2.5 s idle timer as the HUD fires during play.
	const showOverlay = $derived.by((): OverlayMode => {
		if (ovMode !== 'auto') return ovMode;
		if (st !== 'playing') return 'full';
		// below k 0.75 (phone portrait: 8 px names) the timing tightens — minimal while playing, full on pause (mockup rev 2 §4)
		if (k < 0.75) return 'minimal';
		if (intro || hud || (hover && !fullscreen) || (count > 0 && frame >= count - 180)) return 'full';
		return 'minimal';
	});
	const palL = $derived(left.steamid ? loadouts.peek(left.steamid) : null);
	const palR = $derived(right.steamid ? loadouts.peek(right.steamid) : null);

	/**
	 * Credit lines for one wearer: the `credits` prop (steamid → Credit[]) — EMPTY today (the loadout carries no
	 * provenance, C13). DEV ONLY: `?devcredit=1` fakes three credited skins on the left side and one on the right
	 * (spec §3.3's sample) so the rendering can be seen before the server sends provenance.
	 */
	function creditsFor(side: ReplaySide, isLeft: boolean): Credit[] {
		const real = side.steamid && credits ? credits[side.steamid] : undefined;
		if (real?.length) return real.slice(0, 3);
		if (import.meta.env.DEV && appPage.url.searchParams.get('devcredit') === '1' && side.team?.length) {
			const t = side.team;
			return isLeft
				? [
						{ cid: t[0], name: 'NIGHTFALL', author_steamid: '76561197960287930', author_name: 'Ruby' },
						...(t[1] != null ? [{ cid: t[1], name: 'GOLDEN AGE', author_name: 'Ruby' }] : []),
						...(t[2] != null ? [{ cid: t[2], name: 'BLACKOUT', own: true }] : [])
					]
				: [{ cid: t[0], name: 'DUSK', author_steamid: '76561197960287930', author_name: 'Ruby' }];
		}
		return [];
	}
	const creditsL = $derived(creditsFor(left, true));
	const creditsR = $derived(creditsFor(right, false));

	// §5f: the readout during a forward seek is `served → target` — the served fraction IS the progress
	const roServed = $derived(st === 'seeking' ? mmss(Math.max(seekServed, 0)) : mmss(scrubPreview ?? frame));
	const percent = $derived(count > 1 ? (100 * (scrubPreview ?? frame)) / (count - 1) : 0);
	const seekPct = $derived(seekTarget >= 0 && count > 1 ? (100 * Math.max(seekServed, 0)) / (count - 1) : 0);

	// ── loading / progress ──
	function report(phase: Progress['phase'], got: number, total: number) {
		prog = { ...prog, phase, ...(phase === 'pack' ? { pack: [got, total] as [number, number] } : phase === 'tape' ? { tape: [got, total] as [number, number] } : phase === 'prime' ? { prime: [got, total] as [number, number] } : {}) };
		onprogress?.({ phase, got, total });
		const now = performance.now();
		if (now - liveAt > 2000) {
			liveAt = now;
			liveText = total ? `Loading the tape, ${Math.round((100 * got) / total)} percent` : 'Loading the tape';
		}
	}

	/** Fetch with byte progress (the tape); the engine fetches the pack itself and reports per file. */
	async function fetchProgress(url: string, on: (got: number, total: number) => void): Promise<Uint8Array> {
		const res = await fetch(url, { cache: 'no-store' });
		if (!res.ok) throw Object.assign(new Error(`${url}: HTTP ${res.status}`), { code: 'fetch' });
		const total = Number(res.headers.get('content-length')) || 0;
		if (!res.body) return new Uint8Array(await res.arrayBuffer());
		const chunks: Uint8Array[] = [];
		let got = 0;
		const reader = res.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			got += value.length;
			on(got, total);
		}
		const out = new Uint8Array(got);
		let at = 0;
		for (const c of chunks) {
			out.set(c, at);
			at += c.length;
		}
		return out;
	}

	/**
	 * Skins for the emitter (rr-render EmitOpts.skins): {p1:[{cid,colors:[16 × 0xRRGGBB]}], p2:[…]} — each seat's
	 * OWN loadout, applied by the feed only where the character id matches (slots 0/2/4 = P1, 1/3/5 = P2). The
	 * store keeps hex; the ints round-trip losslessly. Unknown seats (meta.p1/p2 absent) = stock.
	 * DEV ONLY: `?devskin=<rrggbb>` paints P1's first character with one flat colour — the smoke test's positive
	 * check (frame sha must DIFFER from stock).
	 */
	type SeatSkins = { p1?: { cid: number; colors: number[] }[]; p2?: { cid: number; colors: number[] }[] };
	function feedSkins(): SeatSkins {
		if (skins) return skins;
		const forSid = (sid?: string) => {
			const lo = sid ? loadouts.peek(sid) : null;
			if (!lo) return undefined;
			const list = Object.entries(lo).map(([cid, hex]) => ({ cid: Number(cid), colors: hex.map((h) => parseInt(h.slice(1), 16) & 0xffffff) }));
			return list.length ? list : undefined;
		};
		const out: SeatSkins = {};
		const p1 = forSid(meta.p1);
		const p2 = forSid(meta.p2);
		if (p1) out.p1 = p1;
		if (p2) out.p2 = p2;
		if (import.meta.env.DEV) {
			// `?devskin=none` = force stock (the smoke test's deterministic baseline — P1 may have a real cloud loadout)
			const dev = appPage.url.searchParams.get('devskin');
			if (dev === 'none') return {};
			const p1Team = meta.p1 && meta.b.steamid === meta.p1 ? meta.b.team : meta.a.team;
			if (dev && p1Team?.length) out.p1 = [{ cid: p1Team[0], colors: Array(16).fill(parseInt(dev, 16) & 0xffffff) }];
		}
		return out;
	}

	async function start() {
		if (disposed) return;
		if (!autoload && !loadAsked) {
			st = 'closed'; // the poster + a play button; nothing is fetched until asked (phones / Save-Data)
			return;
		}
		err = null;
		if (source.kind === 'none') {
			reason = source.reason;
			st = 'unavailable';
			return;
		}
		if (!hasWebGPU()) {
			st = 'unsupported';
			return;
		}
		if (source.kind === 'stream') {
			// C9 (phones, keyed frames) is not built — the tape path is tried on phones too (Tris Q5)
			reason = 'unsupported';
			st = 'unavailable';
			return;
		}
		if (!source.packUrl) {
			// the tape is hosted but this device has no asset pack for it (packs are ROM-derived, agent-side derivation pending)
			st = 'nopack';
			return;
		}
		st = 'loading';
		slow = false;
		const t0 = performance.now();
		const slowTimer = setTimeout(() => (slow = true), 20_000);
		try {
			// both seats' loadouts in ONE batch read (GET /rr/loadout?steamids=a,b) before the feed opens
			const [{ TapePlayer }, dev] = await Promise.all([
				loadEngine(),
				gpuDevice(),
				loadouts.prime([meta.p1, meta.p2, meta.a.steamid, meta.b.steamid])
			]);
			if (disposed) return;
			device = dev;
			const onGpuErr = (e: { error: { message: string } }) => fail('gpu', e.error.message);
			device.addEventListener('uncapturederror', onGpuErr);
			// the tape first (small, with byte progress) → a blob URL the engine fetches instantly
			const tape = await fetchProgress(source.tapeUrl, (g, t) => report('tape', g, t));
			if (disposed) return;
			report('tape', tape.byteLength, tape.byteLength);
			tapeBlobUrl = URL.createObjectURL(new Blob([tape as BlobPart]));
			if (!canvas) throw Object.assign(new Error('no canvas'), { code: 'gpu' });
			const format = canvasFormat();
			ctx = canvas.getContext('webgpu' as never) as unknown as GpuCanvasContextLike | null;
			if (!ctx) throw Object.assign(new Error('no WebGPU canvas context'), { code: 'webgpu' });
			ctx.configure({ device, format, alphaMode: 'opaque' });
			const p = new TapePlayer(device, format, displayOpts(q));
			player = p;
			// observe the worker's feed-order serve so a forward seek can show its catch-up (§7.8)
			const orig = p._onMessage.bind(p);
			p._onMessage = (m) => {
				if (m.type === 'frame' && typeof m.i === 'number') {
					lastServed = Math.max(lastServed, m.i - p.first);
					if (seekTarget >= 0) seekServed = lastServed;
				}
				orig(m);
			};
			await p.load(tapeBlobUrl, source.packUrl, {
				start: source.start ?? 0,
				count: source.count ?? Infinity,
				onProgress: (got, total, what) => {
					if (what === 'pack') report('pack', got, total);
					else if (what === 'tape') report('open', 0, 0);
				},
				opts: { skins: feedSkins() }
			});
			if (disposed) return;
			openMs = p.openMs ?? 0;
			count = p.count;
			await p.prepareAll((i, n) => report('prime', i, n));
			if (disposed) return;
			await show(0);
			ttff = performance.now() - t0;
			clearTimeout(slowTimer);
			st = 'ready';
			liveText = 'Ready';
			onready?.({ frames: count, openMs, ttffMs: ttff });
			exposeTestHook();
			await tick();
			playBtn?.focus({ preventScroll: true });
			if (autoplay === 'auto' && !reducedMotion() && !saveData()) play();
		} catch (e) {
			clearTimeout(slowTimer);
			const code = ((e as { code?: string })?.code ?? 'open') as 'webgpu' | 'fetch' | 'open' | 'decode' | 'gpu';
			// any WebGPU trouble at high quality → one retry at base (res 2, nearest)
			if (!retried && q === 'high' && (code === 'gpu' || code === 'open')) {
				retried = true;
				q = 'base';
				disposePlayer(player);
				player = null;
				return start();
			}
			fail(code, String((e as Error)?.message ?? e));
		}
	}

	/** `closed` → load now (a tap on the poster/play button, or the test hook). */
	export function load() {
		if (st !== 'closed') return;
		loadAsked = true;
		st = 'checking';
		void start();
	}

	async function requestPull() {
		if (requesting) return;
		requesting = true;
		requestNote = '';
		const r = await requestReplay(meta.key);
		requesting = false;
		if (r.ok) reason = 'requested';
		else requestNote = r.error === 'signin' ? 'sign in first' : 'could not request — try again';
	}

	function fail(code: 'webgpu' | 'fetch' | 'open' | 'decode' | 'gpu', message: string) {
		if (st === 'error') return;
		stop();
		st = 'error';
		err = { code, message };
		onerror?.({ code, message });
	}

	// ── drawing / transport (the pacer is player.html's, verbatim in spirit: wall clock, frame-debt drop) ──
	async function show(i: number): Promise<void> {
		if (!player || !ctx) return;
		const seq = ++showSeq;
		const j = await player.ready(i);
		if (disposed || seq !== showSeq || !player || !ctx) return;
		player.draw(j, ctx.getCurrentTexture().createView());
		frame = player.index;
	}

	export function play() {
		if (!isPlayable || playing) return;
		if (st === 'ended') {
			frame = 0; // restart: the pacer reads `frame`, so reset it before the first step lands
			void show(0);
		}
		playing = true;
		st = 'playing';
		intro = true; // the overlay stays full for the first 3 s of play
		if (introTimer) clearTimeout(introTimer);
		introTimer = setTimeout(() => (intro = false), 3000);
		poke();
		let last = performance.now();
		let acc = 0;
		// ⚠ PACE OFF THE WALL CLOCK, NOT OFF requestAnimationFrame's COUNT (player.html:194-227): the capture is
		// a fixed 60 fps of GAME time, so elapsed ms is the only correct pacing on 144 Hz and 30 Hz alike.
		const step = (now: number) => {
			if (!playing) return;
			const interval = 1000 / speed;
			acc += now - last;
			last = now;
			let advance = Math.floor(acc / interval);
			if (advance > 0) {
				acc -= advance * interval;
				if (advance > 4) {
					advance = 4;
					acc = 0;
				}
				const next = frame + advance;
				if (next >= count) {
					void show(count - 1);
					playing = false;
					st = 'ended';
					onended?.();
					return;
				}
				show(next).catch(() => {});
			}
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		watchWorker();
	}

	function stop() {
		playing = false;
		cancelAnimationFrame(raf);
	}
	export function pause() {
		if (!playing) return;
		stop();
		st = 'paused';
	}
	function toggle() {
		if (playing) pause();
		else play();
	}

	/** Seek to frame i. A forward jump past what the worker has served decodes the gap first (`seeking`). */
	export async function seek(i: number) {
		if (!player || !isPlayable) return;
		i = Math.max(0, Math.min(count - 1, Math.round(i)));
		const wasPlaying = playing;
		stop();
		if (i > lastServed + 1) {
			seekTarget = i;
			seekServed = lastServed;
			st = 'seeking';
		}
		await show(i);
		if (disposed) return;
		seekTarget = -1;
		if (st === 'seeking' || st === 'ended' || st === 'ready') st = 'paused';
		if (wasPlaying) play();
		else st = i >= count - 1 ? 'ended' : 'paused';
	}
	export function step(d: number) {
		void seek(frame + d);
	}
	export function dispose() {
		disposed = true;
		stop();
		disposePlayer(player);
		player = null;
		try {
			ctx?.unconfigure();
		} catch {
			/* not configured */
		}
		if (tapeBlobUrl) URL.revokeObjectURL(tapeBlobUrl);
		if (fullscreen) void exitFullscreen();
		const w = window as unknown as Record<string, unknown>;
		if (w[`__${hookName}`] === hook) delete w[`__${hookName}`];
	}

	// worker health: if the rolling average record time exceeds 16 ms for ~2 s, drop to half speed (§7.9)
	let watchIv: ReturnType<typeof setInterval> | null = null;
	function watchWorker() {
		if (watchIv) return;
		let over = 0;
		watchIv = setInterval(() => {
			if (!player || !playing) {
				if (watchIv) clearInterval(watchIv);
				watchIv = null;
				return;
			}
			const s = player.stats();
			if (s.frames > 30 && s.avgMs > 16) over++;
			else over = 0;
			// only drop to half speed once, and never after the user has picked a speed themselves
			if (over >= 2 && speed === 60 && !userSpeed && !halfAuto) {
				speed = 30;
				halfAuto = true;
			}
		}, 1000);
	}

	// ── scrub ──
	function onScrubInput(e: Event) {
		scrubPreview = Number((e.target as HTMLInputElement).value);
	}
	function onScrubChange(e: Event) {
		const v = Number((e.target as HTMLInputElement).value);
		scrubPreview = null;
		void seek(v);
	}

	// ── keyboard (§6.5) ──
	function onKey(e: KeyboardEvent) {
		if (!isPlayable) {
			if (e.key === 'Escape' && fullscreen) void exitFullscreen();
			return;
		}
		const t = e.target as HTMLElement;
		if (t && t.tagName === 'SELECT') return;
		switch (e.key) {
			case ' ':
				e.preventDefault();
				toggle();
				break;
			case 'ArrowLeft':
			case 'ArrowRight': {
				if (t && t.tagName === 'INPUT') return; // the range handles its own arrows
				e.preventDefault();
				const dir = e.key === 'ArrowRight' ? 1 : -1;
				const n = e.shiftKey ? 60 : playing ? 300 : 1;
				step(dir * n);
				break;
			}
			case 'Home':
				e.preventDefault();
				void seek(0);
				break;
			case 'End':
				e.preventDefault();
				void seek(count - 1);
				break;
			case 'f':
			case 'F':
				e.preventDefault();
				void toggleFullscreen();
				break;
			case 'o':
			case 'O':
				e.preventDefault();
				cycleOverlay();
				break;
			case 'Escape':
				if (fullscreen) {
					e.preventDefault();
					void exitFullscreen();
				}
				break;
		}
		poke();
	}

	/** `o`: auto (the timer) → full → minimal → off → auto. A 1.2 s toast names the mode. */
	function cycleOverlay() {
		const order: ('auto' | OverlayMode)[] = ['auto', 'full', 'minimal', 'off'];
		ovMode = order[(order.indexOf(ovMode) + 1) % order.length];
		ovToast = `overlay · ${ovMode}`;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (ovToast = ''), 1200);
	}
	/** Set the overlay mode outright (the test hook; 'auto' hands it back to the timer). */
	export function setOverlay(m: 'auto' | OverlayMode) {
		ovMode = m;
	}

	// ── fullscreen (§7.7): the wrapper (canvas + HUD), never the canvas alone ──
	async function toggleFullscreen() {
		if (fullscreen) return exitFullscreen();
		return enterFullscreen();
	}
	export async function enterFullscreen() {
		if (!wrap || fullscreen) return;
		const el = wrap as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> };
		try {
			if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
			else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
			else throw new Error('no element fullscreen');
			fs = true;
		} catch {
			// iPhone Safari has no element Fullscreen API — pseudo-fullscreen overlay, back gesture exits
			pseudo = true;
			history.pushState({ rrFs: true }, '');
			pushedState = true;
		}
		prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		onfullscreenchange?.({ fullscreen: true });
		layoutFs();
		poke();
		// landscape where the platform allows; otherwise the hint (2 s) in portrait
		const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
		try {
			if (so?.lock) await so.lock('landscape');
			else throw new Error('no lock');
		} catch {
			if (matchMedia('(orientation: portrait)').matches) {
				turnHint = true;
				setTimeout(() => (turnHint = false), 2000);
			}
		}
	}
	export async function exitFullscreen() {
		if (fs) {
			try {
				await document.exitFullscreen();
			} catch {
				/* already out */
			}
			fs = false;
		}
		if (pseudo) {
			pseudo = false;
			if (pushedState) {
				pushedState = false;
				history.back();
			}
		}
		try {
			(screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
		} catch {
			/* not locked */
		}
		document.body.style.overflow = prevOverflow;
		hud = true;
		onfullscreenchange?.({ fullscreen: false });
	}
	function onFsChange() {
		const on = !!document.fullscreenElement && document.fullscreenElement === wrap;
		if (!on && fs) {
			fs = false;
			document.body.style.overflow = prevOverflow;
			hud = true;
			onfullscreenchange?.({ fullscreen: false });
		}
		layoutFs();
	}
	function onPop() {
		if (pseudo) {
			pushedState = false;
			void exitFullscreen();
		}
	}
	/** Picture size in fullscreen: integer scale when the screen allows, else fit (§7.6). */
	function layoutFs() {
		if (!fullscreen) return;
		const W = window.innerWidth,
			H = window.innerHeight;
		portrait = H > W;
		const bandH = portrait ? 56 : 0; // portrait: the transport sits in the band under the picture (never fades)
		const fit = Math.min(W / 640, (H - bandH) / 480);
		let s = Math.floor(fit);
		if (s < 1 || (480 * s) / (H - bandH) < 0.75) s = fit;
		fsScale = s;
		// landscape: the picture is centred, so the letterbox under it is half the leftover — the HUD anchors there
		fsBy = portrait ? 0 : Math.max(0, Math.floor((H - 480 * s) / 2));
	}
	/** HUD reveal + the 2.5 s idle timer: fades the transport in fullscreen, drops the overlay to minimal anywhere (§7.7). */
	function poke() {
		hud = true;
		if (hudTimer) clearTimeout(hudTimer);
		hudTimer = setTimeout(() => (hud = false), 2500);
	}
	let lastTap = 0;
	function onPicTap() {
		if (st === 'closed') return load();
		if (!isPlayable) return;
		const now = performance.now();
		if (now - lastTap < 320) {
			void toggleFullscreen();
			lastTap = 0;
		} else toggle();
		lastTap = now;
		poke();
	}

	/** The wrapper's key + pointer surface (an action, so the group role keeps its semantics for AT). */
	function surface(node: HTMLElement) {
		let leaveTimer: ReturnType<typeof setTimeout> | null = null;
		const enter = () => {
			if (leaveTimer) clearTimeout(leaveTimer);
			hover = true;
			poke();
		};
		// §2.5: full while hovered, and for 3 s after the pointer leaves
		const leave = () => {
			if (leaveTimer) clearTimeout(leaveTimer);
			leaveTimer = setTimeout(() => (hover = false), 3000);
		};
		node.addEventListener('keydown', onKey);
		node.addEventListener('pointermove', poke);
		node.addEventListener('pointerenter', enter);
		node.addEventListener('pointerleave', leave);
		return {
			destroy() {
				if (leaveTimer) clearTimeout(leaveTimer);
				node.removeEventListener('keydown', onKey);
				node.removeEventListener('pointermove', poke);
				node.removeEventListener('pointerenter', enter);
				node.removeEventListener('pointerleave', leave);
			}
		};
	}

	/** The overlay's scale: the picture's rendered width over 640 — identical geometry inline, fullscreen, phones. */
	function fitOverlay(node: HTMLElement) {
		const measure = () => (k = node.clientWidth / 640 || 1);
		const ro = new ResizeObserver(measure);
		ro.observe(node);
		measure();
		return { destroy: () => ro.disconnect() };
	}

	// ── test hook (headless smoke test reads window.__rrEmbed) ──
	const hook = {
		get state() {
			return st;
		},
		get frame() {
			return frame;
		},
		get count() {
			return count;
		},
		get quality() {
			return q;
		},
		get ttffMs() {
			return ttff;
		},
		/** the tape handle this embed shows (meta.key) */
		get key() {
			return meta.key;
		},
		/** the EFFECTIVE overlay mode (what is on screen) */
		get overlay() {
			return showOverlay;
		},
		/** the viewer's choice ('auto' = the timer) */
		get overlayMode() {
			return ovMode;
		},
		get hud() {
			return hud;
		},
		get fullscreen() {
			return fullscreen;
		},
		get scale() {
			return k;
		},
		setOverlay: (m: 'auto' | OverlayMode) => setOverlay(m),
		load: () => load(),
		play: () => play(),
		pause: () => pause(),
		seek: (i: number) => seek(i),
		enterFullscreen: () => enterFullscreen(),
		exitFullscreen: () => exitFullscreen(),
		readback: async () => {
			if (!player) throw new Error('no player');
			const px = await player.readback();
			const h = await crypto.subtle.digest('SHA-256', px as BufferSource);
			return { sha: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''), bytes: px.byteLength };
		}
	};
	/** `window.__<hookName>` — registered at mount (so `closed` is observable) and again at ready (the LAST ready
	 *  embed wins the default name, as before). */
	function exposeTestHook() {
		(window as unknown as Record<string, unknown>)[`__${hookName}`] = hook;
	}

	onMount(() => {
		exposeTestHook();
		document.addEventListener('fullscreenchange', onFsChange);
		window.addEventListener('popstate', onPop);
		window.addEventListener('resize', layoutFs);
		const onVis = () => {
			if (document.hidden) pause();
		};
		document.addEventListener('visibilitychange', onVis);
		void start();
		return () => {
			document.removeEventListener('fullscreenchange', onFsChange);
			window.removeEventListener('popstate', onPop);
			window.removeEventListener('resize', layoutFs);
			document.removeEventListener('visibilitychange', onVis);
			if (watchIv) clearInterval(watchIv);
			if (hudTimer) clearTimeout(hudTimer);
			if (introTimer) clearTimeout(introTimer);
			if (toastTimer) clearTimeout(toastTimer);
			dispose();
		};
	});
</script>

{#snippet plate(side: ReplaySide, won: boolean, right: boolean)}
	<PlayerPlate
		steamid={side.steamid}
		name={side.name}
		avatar={side.avatar}
		cc={side.cc}
		rating={side.rating ?? null}
		games={side.games ?? null}
		density="tag"
		align={right ? 'right' : 'left'}
		{won}
		rankHref="{base}/ranks"
	/>
{/snippet}

{#snippet record()}
	{#if modeLabel}<span class="mode" class:money={meta.mode === 'money'}>{meta.mode === 'money' ? '🪙 ' : ''}{modeLabel}</span>{/if}
	{#if meta.ft || meta.gameNo}<span>{meta.ft ? `FT${meta.ft}` : ''}{meta.ft && meta.gameNo ? ' · ' : ''}{meta.gameNo ? `GAME ${meta.gameNo}` : ''}</span>{/if}
	{#if dateText}<span>{dateText}</span>{/if}
	{#if meta.stageId != null}<span>Stage {meta.stageId}</span>{/if}
	{#if durText}<span>{durText}</span>{/if}
	{#if !seatsKnown}<span class="stock" title="Seats unknown for this tape — colors are the game's own">stock colors</span>{/if}
{/snippet}

{#snippet transport(big: boolean)}
	<div class="tr" class:big>
		<button type="button" class="btn play" bind:this={playBtn} disabled={!isPlayable} aria-label={playing ? 'Pause' : st === 'ended' ? 'Watch again' : 'Play'} onclick={toggle}>{playing ? '⏸' : '▶'}</button>
		<button type="button" class="btn sm" disabled={!isPlayable} title="−5 s" aria-label="Back 5 seconds" onclick={() => step(-300)}>«5</button>
		<div class="scrubw" class:seeking={st === 'seeking'}>
			<input
				type="range"
				class="scrub"
				min="0"
				max={Math.max(0, count - 1)}
				value={scrubPreview ?? frame}
				disabled={!isPlayable}
				aria-label="Scrub"
				aria-valuetext="{mmss(scrubPreview ?? frame)} of {mmss(count)}"
				title="frame {(scrubPreview ?? frame) + 1} / {count}"
				style="--pct:{percent}%;--seek:{seekPct}%"
				oninput={onScrubInput}
				onchange={onScrubChange}
			/>
			{#if scrubPreview != null}<span class="tip" style="left:{percent}%">{mmss(scrubPreview)}</span>{/if}
		</div>
		<button type="button" class="btn sm" disabled={!isPlayable} title="+5 s" aria-label="Forward 5 seconds" onclick={() => step(300)}>5»</button>
		<!-- §5f: while seeking the readout is `served → target`; the served fraction is the progress, no estimate -->
		{#if st === 'seeking'}
			<span class="ro" aria-live="polite"><b>{roServed}</b> → {mmss(seekTarget)}</span>
		{:else}
			<span class="ro"><b>{roServed}</b> / {mmss(count)}</span>
		{/if}
		<select class="spd" bind:value={speed} disabled={!isPlayable} title="speed" aria-label="Playback speed" onchange={() => { halfAuto = false; userSpeed = true; }}>
			<option value={60}>1×</option>
			<option value={30}>½×</option>
			<option value={15}>¼×</option>
		</select>
		<button type="button" class="btn" title="Overlay (O): {ovMode}" aria-label="Overlay: {ovMode}" onclick={cycleOverlay}>◱</button>
		<button type="button" class="btn" title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen (F)'} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onclick={() => void toggleFullscreen()}>{fullscreen ? '✕' : '⛶'}</button>
	</div>
{/snippet}

<!-- the wrapper is the keyboard surface (space/arrows/Home/End/F/O/Esc, §6.5) and the fullscreen element -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="emb"
	role="group"
	aria-label="Replay player"
	class:fs={fullscreen}
	class:pseudo
	class:portrait
	class:hudoff={fullscreen && !hud}
	class:seeking={st === 'seeking'}
	bind:this={wrap}
	tabindex="-1"
	use:surface
	data-hook={hookName}
	style="--fsw:{Math.round(640 * fsScale)}px;--fsby:{fsBy}px"
>
	<!-- inline chrome-top = ONE 28 px record row (mockup rev 2 §1); the plates live on the picture now. Hidden in fullscreen. -->
	<div class="metarow" aria-label="Match record">{@render record()}</div>

	<!-- the picture: 4:3, the game's own pixels + THE OVERLAY (DOM, 640×480 space, scaled with the picture).
	     Tap = play/pause, double-tap = fullscreen (§6.5); keyboard equivalents live on the wrapper + the transport. -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
	<div class="pic" role="presentation" use:fitOverlay class:dim={st === 'loading' || st === 'unavailable' || st === 'nopack' || st === 'unsupported' || st === 'error'} onclick={onPicTap}>
		{#if poster && posterOk && !isPlayable}
			<img class="poster" src={poster} alt="" onerror={() => (posterOk = false)} />
		{:else if !isPlayable}
			<span class="ground">{#if st !== 'closed'}<span class="mode big">{meta.mode === 'money' ? '🪙 ' : ''}{modeLabel}</span>{/if}</span>
		{/if}
		<canvas bind:this={canvas} width="640" height="480" class:hidden={!isPlayable} aria-label={ariaPic}></canvas>

		{#if st === 'closed'}
			<div class="ov closed">
				<button type="button" class="again" onclick={(e) => { e.stopPropagation(); load(); }}>▶ Watch the tape</button>
				<span class="s">Loads the tape and its art on tap — nothing downloads until you ask.</span>
			</div>
		{:else if st === 'loading'}
			<div class="ov">
				<span class="rail lbl">{prog.phase === 'open' ? 'Opening' : prog.phase === 'prime' ? `Priming ${prog.prime[0]} / ${prog.prime[1]}` : 'Loading the tape'}</span>
				<div class="lbar" class:indet={prog.phase === 'open' || prog.phase === 'prime'}>
					<div><i style="width:{prog.pack[1] ? (100 * prog.pack[0]) / prog.pack[1] : prog.phase === 'tape' ? 0 : 100}%"></i></div>
					<div><i style="width:{prog.tape[1] ? (100 * prog.tape[0]) / prog.tape[1] : 0}%"></i></div>
					<small>
						<span>PACK {prog.pack[1] ? `${mb(prog.pack[0])} / ${mb(prog.pack[1])} MB` : '…'}</span>
						<span>TAPE {prog.tape[1] ? `${mb(prog.tape[0])} / ${mb(prog.tape[1])} MB` : '…'}</span>
					</small>
				</div>
				{#if slow}<span class="s">Big tape — this can take a moment on first watch.</span>{/if}
			</div>
		{:else if st === 'unavailable'}
			<div class="ov">
				{#if reason === 'pending'}
					<span class="big">⏳</span><span class="h">Tape not in yet.</span><span class="s">The agent uploads it after the set — check back in a minute.</span>
				{:else if reason === 'archived'}
					<span class="big">📼</span><span class="h">In the archives.</span><span class="s">This tape is in cold storage — request it and it's pulled back within a minute.</span>
					<button type="button" class="signin" onclick={(e) => { e.stopPropagation(); void requestPull(); }} disabled={requesting}>{requesting ? '…' : '📼 Request replay'}</button>
					{#if requestNote}<span class="s">{requestNote}</span>{/if}
				{:else if reason === 'requested'}
					<span class="big">⏳</span><span class="h">Tape incoming.</span><span class="s">Pulled from the archives — usually under a minute.</span>
				{:else if reason === 'expired'}
					<span class="h">Tape gone.</span><span class="s">Only the last 100 live results keep a replay.</span>
				{:else if reason === 'unsupported'}
					<span class="big">⛔</span><span class="h">This browser can't play tapes yet.</span><span class="s">Needs WebGPU — Chrome, Edge, or Safari 26+.</span>
				{:else if reason === 'signin'}
					<span class="h">Sign in to watch the tape.</span><span class="s">Replays are for players with an account.</span>
					<button class="signin" onclick={(e) => { e.stopPropagation(); auth.login(); }}>Sign in through Steam</button>
				{:else}
					<span class="h">No tape for this one.</span><span class="s">Neither player's agent recorded it.</span>
				{/if}
			</div>
		{:else if st === 'nopack'}
			<!-- §5c: the tape exists, this device has no ROM-derived pack. No agent action until C12 exists. -->
			<div class="ov"><span class="big">📦</span><span class="h">Tape's in. Art isn't.</span><span class="s">Replays draw with the game's own art, packed from a copy of MvC2. This browser has no pack for this one.</span><span class="s">Watch on a PC with MvC2 and Retro Receipts</span></div>
		{:else if st === 'unsupported'}
			<div class="ov"><span class="big">⛔</span><span class="h">This browser can't play tapes yet.</span><span class="s">Needs WebGPU — Chrome, Edge, or Safari 26+.</span></div>
		{:else if st === 'error'}
			<div class="ov"><span class="h">The tape didn't play.</span><span class="s mono">{err?.code}: {err?.message}</span></div>
		{:else if st === 'ended'}
			<div class="ov end"><button type="button" class="again" onclick={(e) => { e.stopPropagation(); play(); }}>▶ Watch again</button></div>
		{/if}

		<!-- ═══ THE OVERLAY (REPLAY-OVERLAY-SPEC rev 2, on-picture): a 640×480 box scaled with the picture. DOM only —
		     the game's pixels underneath are untouched (readback sha unchanged). pointer-events: none except links.
		     Placement = the designer's 640-space table (docs/mockups/replay-overlay.html §1), measured on the game's HUD:
		       plates    — lower thirds, bottom y 430 (4 px above the LEVEL pods), P1 LEFT x 8 / P2 RIGHT edge x 632,
		                   2 px --p1/--p2 side bar when seats are known; credits stacked ABOVE, 17 px per line
		       stamp     — the dead gap under the timer (x 269–374, y 56–98): mode·FT·G / date / stage (+ stock colors)
		       watermark — bottom-centre y 437–449, between the LEVEL pods, above the hyper bars
		     minimal = plates + watermark; the credits and the stamp go. -->
		{#if isPlayable}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="ovl {showOverlay}" class:seats={seatsKnown} style="transform:scale({k})" aria-hidden={showOverlay === 'off'} data-mode={showOverlay} onclick={(e) => e.stopPropagation()}>
			<div class="plate p1" role="group" aria-label={groupLabel(left, 1)}>
				{#if creditsL.length}
					<div class="cr">
						{#each creditsL as c (c.cid)}<SkinCredit credit={c} form="icon" palette={palL?.[c.cid] ?? null} />{/each}
					</div>
				{/if}
				<div class="id">
					{@render plate(left, leftWon, false)}
					{#if scoreL != null}<span class="sc" class:w={leftWon}>{scoreL}</span>{/if}
				</div>
			</div>
			<div class="plate p2" role="group" aria-label={groupLabel(right, 2)}>
				{#if creditsR.length}
					<div class="cr">
						{#each creditsR as c (c.cid)}<SkinCredit credit={c} form="icon" align="right" palette={palR?.[c.cid] ?? null} />{/each}
					</div>
				{/if}
				<div class="id">
					{@render plate(right, !leftWon, true)}
					{#if scoreR != null}<span class="sc" class:w={!leftWon}>{scoreR}</span>{/if}
				</div>
			</div>
			<div class="stamp" aria-label="Match record">
				{#if modeLabel || meta.ft || meta.gameNo}
					<span class:money={meta.mode === 'money'}>{meta.mode === 'money' ? '🪙 ' : ''}{[modeLabel, meta.ft ? `FT${meta.ft}` : '', meta.gameNo ? `G${meta.gameNo}` : ''].filter(Boolean).join(' · ')}</span>
				{/if}
				{#if dateText}<span>{dateText}</span>{/if}
				{#if meta.stageId != null}<span>STAGE {meta.stageId}</span>{/if}
				{#if !seatsKnown}<span class="stock" title="Seats unknown for this tape — colors are the game's own">stock colors</span>{/if}
			</div>
			{#if meta.saved}<span class="saved" title="Saved — this tape never leaves the archive">SAVED</span>{/if}
			<div class="wm"><span aria-hidden="true">RETRO RECEIPTS</span><span class="sep" aria-hidden="true">·</span><a href="{base}/ranks" title="The Marvel ladder">nobd.net/app/ranks</a></div>
		</div>
		{/if}
		{#if turnHint}<div class="hint">📱↻ Turn your phone</div>{/if}
	</div>

	<!-- transport: inline below the picture; fullscreen = the fade-out HUD over the picture's bottom edge (landscape)
	     / the band under it (portrait, never fades). The only chrome that ever sits on the picture besides the overlay. -->
	{@render transport(fullscreen)}
	{#if noteText}<div class="note" class:toast={!!ovToast}>{noteText}</div>{/if}
	<span class="sr" aria-live="polite">{liveText}</span>
</div>

<style>
	.emb {
		position: relative;
		border: 1px solid color-mix(in srgb, var(--stream) 30%, var(--line));
		border-radius: 12px;
		overflow: hidden;
		background: var(--board);
		outline: none;
		/* inline: the card IS the picture + its transport — COMPACT (Tris 2026-09-03): capped at 1× (640 px) and centred,
		   so an expanded result row stays a card, not a screen; fullscreen is where it gets big */
		max-width: calc(640px + 2px); /* the picture is exactly 640 inside the 1 px border → k = 1 inline */
		margin: 0 auto;
	}
	.emb:focus-visible {
		box-shadow: 0 0 0 2px var(--gold);
	}
	.mode {
		font-size: 8.5px;
		letter-spacing: 0.12em;
		padding: 1px 6px;
		border-radius: 5px;
		border: 1px solid var(--line);
		color: var(--dim);
	}
	.mode.money {
		border-color: color-mix(in srgb, var(--gold) 55%, var(--line));
		color: var(--gold);
	}
	.mode.big {
		font-size: 11px;
		padding: 4px 10px;
	}
	/* the picture — 640×480 CSS-scaled, pixelated */
	.pic {
		position: relative;
		width: 100%;
		max-width: 640px;
		margin: 0 auto;
		aspect-ratio: 4 / 3;
		background: #000;
		display: grid;
		place-items: center;
		overflow: hidden;
		cursor: pointer;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
		background: #000;
	}
	canvas.hidden {
		visibility: hidden;
		position: absolute;
	}
	.poster {
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: var(--board);
		display: block;
	}
	.pic.dim .poster {
		opacity: 0.4;
	}
	.ground {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		background: var(--board);
	}
	.ov {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		text-align: center;
		padding: 14px;
		color: var(--ink);
	}
	.ov.end,
	.ov.closed {
		background: rgba(0, 0, 0, 0.35);
	}
	.ov .lbl {
		color: var(--dim);
	}
	.ov .h {
		font-weight: 800;
		font-size: 14px;
	}
	.ov .signin { margin-top: 6px; font: inherit; font-weight: 800; font-size: 12px; color: var(--gold-ink, #241700); background: linear-gradient(180deg, #ffe084, #c98f0e); border: 0; border-radius: 999px; padding: 8px 14px; cursor: pointer; }
	.ov .s {
		font-size: 11.5px;
		color: var(--dim);
		max-width: 30ch;
	}
	.ov.closed .s {
		color: #cfd3e0;
		text-shadow: 0 1px 2px #000;
	}
	.ov .s.mono {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		max-width: 60ch;
		word-break: break-word;
	}
	.ov .big {
		font-size: 26px;
		line-height: 1;
	}
	.again {
		font: inherit;
		font-size: 13px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 0;
		border-radius: 999px;
		padding: 9px 18px;
		cursor: pointer;
	}
	/* two-segment loading bar: PACK · TAPE with byte counts — the numbers are the honesty, never a spinner */
	.lbar {
		width: min(80%, 420px);
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}
	.lbar div {
		height: 6px;
		border-radius: 99px;
		background: var(--panel-2);
		overflow: hidden;
		position: relative;
	}
	.lbar div i {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		background: var(--stream);
		transition: width 0.2s linear;
	}
	.lbar small {
		grid-column: 1 / 3;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		color: var(--dim);
		letter-spacing: 0.06em;
		display: flex;
		justify-content: space-between;
	}
	@media (prefers-reduced-motion: no-preference) {
		.lbar.indet div i {
			animation: indet 1.1s ease-in-out infinite;
		}
	}
	@keyframes indet {
		0% { opacity: 1; }
		50% { opacity: 0.35; }
		100% { opacity: 1; }
	}
	.hint {
		position: absolute;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
		font-weight: 800;
		font-size: 14px;
		padding: 8px 14px;
		border-radius: 10px;
	}

	/* the inline record row (28 px, mono) — chrome-top after rev 2; fullscreen hides it (pillars and bands are plain #000) */
	.metarow {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 10px;
		min-height: 28px;
		padding: 2px 12px;
		background: var(--panel);
		border-bottom: 1px solid var(--line-soft);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--faint);
	}
	.metarow .stock,
	.stamp .stock {
		color: var(--faint);
		cursor: help;
		pointer-events: auto;
	}
	.metarow .stock {
		border: 1px dashed var(--line);
		padding: 0 5px;
		border-radius: 4px;
	}

	/* ═══ THE OVERLAY — 640×480 coordinate space, scaled with the picture (transform: scale(k), origin 0 0).
	   Every length below is in PICTURE pixels (the designer's table, mockup rev 2 §1): at 2× fullscreen it is exactly
	   twice as big, on a phone exactly the fit scale — pixel-identical geometry everywhere. Colors are pinned
	   dark-on-picture (the picture is the game's, not the app theme's): the plate tokens are re-declared here. ═══ */
	.ovl {
		position: absolute;
		left: 0;
		top: 0;
		width: 640px;
		height: 480px;
		transform-origin: 0 0;
		pointer-events: none;
		z-index: 2;
		font-family: Inter, 'Segoe UI', system-ui, sans-serif;
		/* 640-space placement (mockup rev 2 table #1-6) */
		--ov-plate-bottom: 50px; /* plate bottom edge y 430 — 4 px above the LEVEL pods (y 434), clear of the hyper bars (y 453) */
		--ov-plate-side: 8px; /* P1 x 8 · P2 right edge x 632 */
		--ov-plate-max: 220px;
		--ov-stamp-top: 56px; /* the dead gap under the timer: x 269–374, y 56–98 */
		--ov-stamp-max: 104px;
		--ov-wm-top: 437px; /* y 437–449, between the pods, above the hyper bars */
		/* dark-on-picture tokens, theme-independent (--ovl-dim = 4.5:1 over .65 black, spec §6) */
		--ink: #eef1f8;
		--dim: #c9cedd;
		--faint: #8a91a8;
		--line: rgba(255, 255, 255, 0.18);
		--line-soft: rgba(255, 255, 255, 0.1);
		--panel: rgba(0, 0, 0, 0.65);
		--panel-2: rgba(0, 0, 0, 0.65);
		color: var(--ink);
	}
	.ovl.off {
		display: none;
	}
	.ovl a {
		pointer-events: auto;
	}
	/* #1/#3 the plates: lower thirds, one box = credits (above) + the id row; 2 px side bar in the seat colour when seats are known */
	.plate {
		position: absolute;
		bottom: var(--ov-plate-bottom);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		max-width: var(--ov-plate-max);
		min-width: 0;
		padding: 3px;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.65);
	}
	.plate.p1 {
		left: var(--ov-plate-side);
	}
	.plate.p2 {
		right: var(--ov-plate-side);
		align-items: flex-end;
	}
	.ovl.seats .plate.p1 {
		border-left: 2px solid var(--p1);
	}
	.ovl.seats .plate.p2 {
		border-right: 2px solid var(--p2);
	}
	.plate .id {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		white-space: nowrap;
		max-width: 100%;
	}
	.plate.p2 .id {
		flex-direction: row-reverse;
	}
	/* the set score rides in the plate (a scorebug puts it next to the name) — condensed italic, gold for the winner */
	.plate .sc {
		font-style: italic;
		font-weight: 900;
		font-size: 18px;
		line-height: 1;
		margin: 0 2px 0 4px;
		font-variant-numeric: tabular-nums;
	}
	.plate.p2 .sc {
		margin: 0 4px 0 2px;
	}
	.plate .sc.w {
		color: var(--gold);
	}
	/* #2/#4 the credits: stacked above the id row, 17 px per line, slot order top → bottom */
	.plate .cr {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		max-width: 100%; /* 17 px per line: 3 lines → the box top sits at y 353 (430 − 26 − 51) */
	}
	.plate.p2 .cr {
		align-items: flex-end;
	}
	/* #5 the record stamp: three mono lines in the dead gap under the timer */
	.stamp {
		position: absolute;
		left: 50%;
		top: var(--ov-stamp-top);
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		max-width: var(--ov-stamp-max);
		padding: 0 4px; /* h = 3 × 14 = 42 → y 56–98, inside the dead gap (y 55–101) */
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.65);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 12px;
		line-height: 14px;
		color: var(--dim);
		white-space: nowrap;
	}
	.stamp .money {
		color: var(--gold);
	}
	/* §5a: seats unknown → the picture is stock; a truthful status, not a design choice */
	.stamp .stock {
		border-top: 1px dotted var(--faint);
	}
	/* #6 the watermark: bottom-centre, decorative except the link */
	.wm {
		position: absolute;
		left: 50%;
		top: var(--ov-wm-top);
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		height: 12px;
		padding: 0 6px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.5);
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 11px;
		line-height: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.7);
	}
	.wm a {
		color: inherit;
		text-decoration: none;
	}
	.wm a:hover,
	.wm a:focus-visible {
		color: #fff;
		text-decoration: underline dotted;
		outline: none;
	}
	.wm .sep {
		opacity: 0.5;
		margin: 0 3px;
	}
	/* #7 the SAVED pill (paid save): gold = trust seal per the charter */
	.saved {
		position: absolute;
		left: 378px;
		top: 58px;
		height: 12px;
		padding: 0 5px;
		border-radius: 3px;
		background: var(--gold);
		color: var(--gold-ink);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 9px;
		line-height: 12px;
		font-weight: 700;
		letter-spacing: 0.1em;
	}
	/* minimal = plates + watermark: the credits, the stamp and the pill go — a 300 ms fade OUT then out of flow (so the
	   plate box collapses to its 26 px id row: `display` transitions with allow-discrete); back to full is instant —
	   credits never animate in (§6). Reduced motion = cut. */
	.ovl .cr,
	.ovl .stamp,
	.ovl .saved {
		transition: opacity 0.3s, display 0.3s allow-discrete;
	}
	.ovl.minimal .cr,
	.ovl.minimal .stamp,
	.ovl.minimal .saved {
		opacity: 0;
		display: none;
	}

	/* transport */
	.tr {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 12px;
		min-height: 44px;
		background: var(--panel);
		border-top: 1px solid var(--line-soft);
	}
	.btn {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		font: inherit;
		font-size: 12px;
		color: var(--ink);
		cursor: pointer;
		flex: none;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.btn.play {
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		color: var(--gold-ink);
		border-color: transparent;
		font-weight: 900;
	}
	.btn:focus-visible,
	.scrub:focus-visible,
	.spd:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
	.scrubw {
		flex: 1;
		position: relative;
		display: flex;
		align-items: center;
		min-width: 60px;
	}
	.scrub {
		width: 100%;
		height: 24px;
		margin: 0;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		cursor: pointer;
	}
	.scrub::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 99px;
		background: linear-gradient(90deg, var(--stream) var(--pct), var(--panel-2) var(--pct));
	}
	.scrubw.seeking .scrub::-webkit-slider-runnable-track {
		background: linear-gradient(90deg, var(--stream) var(--seek), color-mix(in srgb, var(--stream) 35%, var(--panel-2)) var(--seek), color-mix(in srgb, var(--stream) 35%, var(--panel-2)) var(--pct), var(--panel-2) var(--pct));
	}
	.scrub::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -4px;
		border-radius: 50%;
		background: var(--ink);
		box-shadow: 0 0 0 2px var(--stream);
	}
	.scrub::-moz-range-track {
		height: 6px;
		border-radius: 99px;
		background: var(--panel-2);
	}
	.scrub::-moz-range-progress {
		height: 6px;
		border-radius: 99px;
		background: var(--stream);
	}
	.scrub::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border: 0;
		border-radius: 50%;
		background: var(--ink);
		box-shadow: 0 0 0 2px var(--stream);
	}
	.tip {
		position: absolute;
		bottom: 100%;
		transform: translateX(-50%);
		font-family: ui-monospace, monospace;
		font-size: 10px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 2px 6px;
		pointer-events: none;
		white-space: nowrap;
	}
	.ro {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: var(--dim);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.ro b {
		color: var(--ink);
		font-weight: 600;
	}
	.spd {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: var(--dim);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 4px 4px;
		background: var(--panel-2);
		cursor: pointer;
	}
	.note {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--dim);
		padding: 0 12px 6px;
		background: var(--panel);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* ── FULLSCREEN (§7.6-7.7): #000 ground, the picture centred at an integer scale (or fit); the overlay scales with
	   it; landscape = the transport is a fading HUD over the picture's bottom 56 px (anchored to the picture's edge,
	   --fsby = the letterbox under it); portrait = the transport in the band under the picture, never fades. ── */
	.emb.fs {
		border: 0;
		border-radius: 0;
		background: #000;
		display: grid;
		place-items: center;
		align-content: center;
		width: 100%;
		max-width: none;
		height: 100%;
		margin: 0;
	}
	.emb.fs.pseudo {
		position: fixed;
		inset: 0;
		height: 100dvh;
		z-index: 100;
	}
	.emb.fs .metarow {
		display: none;
	}
	.emb.fs .pic {
		width: var(--fsw);
		max-width: 100vw;
		margin: 0;
		cursor: none;
	}
	.emb.fs:not(.hudoff) .pic {
		cursor: pointer;
	}
	.emb.fs .tr {
		position: absolute;
		left: 50%;
		bottom: var(--fsby);
		transform: translateX(-50%);
		width: var(--fsw);
		max-width: 100vw;
		height: 56px;
		background: rgba(0, 0, 0, 0.6);
		border: 0;
		color: #fff;
		transition: opacity 0.25s;
	}
	.emb.fs .tr .ro,
	.emb.fs .tr .ro b {
		color: #fff;
	}
	.emb.fs .note {
		position: absolute;
		left: 50%;
		bottom: calc(var(--fsby) + 60px);
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		border-radius: 6px;
		padding: 3px 8px;
	}
	/* §5f: the `skipping ahead…` pill is the only sign of progress — it never fades while seeking */
	.emb.fs.hudoff .tr,
	.emb.fs.hudoff:not(.seeking) .note:not(.toast) {
		opacity: 0;
		pointer-events: none;
	}
	/* portrait fullscreen: picture / transport band — nothing over the picture but the overlay */
	.emb.fs.portrait {
		grid-template-rows: auto auto;
	}
	.emb.fs.portrait .pic {
		width: 100%;
		max-width: 100vw;
	}
	.emb.fs.portrait .tr {
		position: static;
		transform: none;
		width: 100%;
		background: transparent;
	}
	.emb.fs.portrait.hudoff .tr {
		opacity: 1;
		pointer-events: auto;
	}
	.emb.fs.portrait .note {
		position: static;
		transform: none;
	}

	@media (max-width: 720px) {
		.tr {
			min-height: 48px;
			gap: 6px;
			padding: 0 8px;
		}
		.btn {
			width: 36px;
			height: 36px;
		}
		.btn.sm,
		.spd {
			display: none;
		}
		.scrub {
			height: 48px;
		}
		.scrub::-webkit-slider-thumb {
			width: 18px;
			height: 18px;
			margin-top: -6px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.lbar div i,
		.emb.fs .tr,
		.ovl .cr,
		.ovl .stamp,
		.ovl .saved {
			transition: none;
		}
	}
</style>
