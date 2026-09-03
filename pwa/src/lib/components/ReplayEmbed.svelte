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

	// ▶ REPLAYEMBED (LIVE-TAB-SPEC §7) — a rendered media element: the game's OWN pixels, re-rendered from
	// the match tape by the proven tape engine (Web Worker + wasm emitter + WebGPU), with transport chrome.
	// Suffix Embed (design-system amendment §13.1): never a Card, never carries actions beyond transport.
	// The picture is sacred: nothing overlays the 640×480 canvas while it plays — chrome lives above/below
	// inline, and in fullscreen in the pillar/letterbox bands + a HUD that fades after 2.5 s idle.
	// Only the game's real textures/geometry are drawn (feedback-render-only-game-assets).

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
	}
	export type Progress = { phase: 'pack' | 'tape' | 'open' | 'prime' | 'stream'; got: number; total: number };
	type State = 'checking' | 'unsupported' | 'unavailable' | 'nopack' | 'loading' | 'error' | 'ready' | 'playing' | 'paused' | 'seeking' | 'ended';

	let {
		source,
		poster = '',
		meta,
		skins = null,
		autoplay = 'auto',
		quality = 'high',
		onready = null,
		onerror = null,
		onended = null,
		onprogress = null,
		onfullscreenchange = null
	}: {
		source: ReplaySource;
		/** a still for the closed/loading states — the OG fight card (interim, §7.5); '' = the --board ground */
		poster?: string;
		/** server-resolved identity — NEVER read from the tape (REPLAY-META-SKINS-SPEC §1-2) */
		meta: ReplayMeta;
		/** raw-int loadouts PER SEAT for the emitter ({p1:[{cid,colors}], p2:[…]}); null = build from loadouts + meta.p1/p2 */
		skins?: { p1?: { cid: number; colors: number[] }[]; p2?: { cid: number; colors: number[] }[] } | null;
		/** 'auto' = play when ready unless reduced-motion / Save-Data (Tris Q4: on) */
		autoplay?: 'auto' | 'never';
		/** high = internal res 4× + box filter into the 640×480 canvas; base = res 2× nearest (low-end / after a GPU error) */
		quality?: 'high' | 'base';
		onready?: ((e: { frames: number; openMs: number; ttffMs: number }) => void) | null;
		onerror?: ((e: { code: 'webgpu' | 'fetch' | 'open' | 'decode' | 'gpu'; message: string }) => void) | null;
		onended?: (() => void) | null;
		onprogress?: ((p: Progress) => void) | null;
		onfullscreenchange?: ((e: { fullscreen: boolean }) => void) | null;
	} = $props();

	// ── state ──
	let st = $state<State>('checking');
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
	let turnHint = $state(false);
	let portrait = $state(false);
	let fsScale = $state(1);
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
		if ((window as { __rrEmbed?: unknown }).__rrEmbed === hook) delete (window as { __rrEmbed?: unknown }).__rrEmbed;
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
			case 'Escape':
				if (fullscreen) {
					e.preventDefault();
					void exitFullscreen();
				}
				break;
		}
		poke();
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
		const bandH = portrait ? 96 : 0; // portrait: plates + transport in the letterbox bands
		const fit = Math.min(W / 640, (H - bandH) / 480);
		let s = Math.floor(fit);
		if (s < 1 || (480 * s) / (H - bandH) < 0.75) s = fit;
		fsScale = s;
	}
	/** HUD reveal + 2.5 s idle fade in fullscreen (§7.7). */
	function poke() {
		hud = true;
		if (hudTimer) clearTimeout(hudTimer);
		if (fullscreen) hudTimer = setTimeout(() => (hud = false), 2500);
	}
	let lastTap = 0;
	function onPicTap() {
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
		node.addEventListener('keydown', onKey);
		node.addEventListener('pointermove', poke);
		return {
			destroy() {
				node.removeEventListener('keydown', onKey);
				node.removeEventListener('pointermove', poke);
			}
		};
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
		play: () => play(),
		pause: () => pause(),
		seek: (i: number) => seek(i),
		readback: async () => {
			if (!player) throw new Error('no player');
			const px = await player.readback();
			const h = await crypto.subtle.digest('SHA-256', px as BufferSource);
			return { sha: [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''), bytes: px.byteLength };
		}
	};
	function exposeTestHook() {
		(window as { __rrEmbed?: unknown }).__rrEmbed = hook;
	}

	onMount(() => {
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
		team={side.team ?? null}
		density="plate"
		align={right ? 'right' : 'left'}
		{won}
		rankHref="{base}/ranks"
	/>
{/snippet}

{#snippet mrail()}
	<span class="mrail">
		{#if modeLabel}<span class="mode" class:money={meta.mode === 'money'}>{meta.mode === 'money' ? '🪙 ' : ''}{modeLabel}</span>{/if}
		{#if meta.ft || meta.gameNo}<span>{meta.ft ? `FT${meta.ft}` : ''}{meta.ft && meta.gameNo ? ' · ' : ''}{meta.gameNo ? `GAME ${meta.gameNo}` : ''}</span>{/if}
		{#if dateText}<span>{dateText}</span>{/if}
		{#if meta.stageId != null}<span>Stage {meta.stageId}</span>{/if}
		{#if durText}<span>{durText}</span>{/if}
	</span>
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
		<span class="ro"><b>{mmss(scrubPreview ?? frame)}</b> / {mmss(count)}</span>
		<select class="spd" bind:value={speed} disabled={!isPlayable} title="speed" aria-label="Playback speed" onchange={() => { halfAuto = false; userSpeed = true; }}>
			<option value={60}>1×</option>
			<option value={30}>½×</option>
			<option value={15}>¼×</option>
		</select>
		<button type="button" class="btn" title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen (F)'} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onclick={() => void toggleFullscreen()}>{fullscreen ? '✕' : '⛶'}</button>
	</div>
{/snippet}

<!-- the wrapper is the keyboard surface (space/arrows/Home/End/F/Esc, §6.5) and the fullscreen element -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="emb"
	role="group"
	aria-label="Replay player"
	class:fs={fullscreen}
	class:pseudo
	class:portrait
	class:hudoff={fullscreen && !hud}
	bind:this={wrap}
	tabindex="-1"
	use:surface
	style="--fsw:{Math.round(640 * fsScale)}px"
>
	<!-- chrome-top: the tale of the tape. Inline: above the picture. Fullscreen: in the pillar/letterbox bands. -->
	<div class="ctop">
		<div class="cplate">{@render plate(meta.a, meta.winner === 'a', false)}</div>
		<div class="mid">
			{#if meta.score}
				<div class="gs"><span class:w={meta.winner === 'a'}>{meta.score.a}</span><span class="d">–</span><span class:w={meta.winner === 'b'}>{meta.score.b}</span></div>
			{:else}
				<div class="gs small"><span class:w={meta.winner === 'a'}>{meta.winner === 'a' ? 'W' : 'L'}</span><span class="d">–</span><span class:w={meta.winner === 'b'}>{meta.winner === 'b' ? 'W' : 'L'}</span></div>
			{/if}
			{@render mrail()}
		</div>
		<div class="cplate r">{@render plate(meta.b, meta.winner === 'b', true)}</div>
	</div>

	<!-- the picture: 4:3, the game's own pixels; nothing overlays it while it plays. Tap = play/pause,
	     double-tap = fullscreen (§6.5); the keyboard equivalents live on the wrapper + the transport buttons. -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
	<div class="pic" role="presentation" class:dim={st === 'loading' || st === 'unavailable' || st === 'nopack' || st === 'unsupported' || st === 'error'} onclick={onPicTap}>
		{#if poster && posterOk && !isPlayable}
			<img class="poster" src={poster} alt="" onerror={() => (posterOk = false)} />
		{:else if !isPlayable}
			<span class="ground"><span class="mode big">{meta.mode === 'money' ? '🪙 ' : ''}{modeLabel}</span></span>
		{/if}
		<canvas bind:this={canvas} width="640" height="480" class:hidden={!isPlayable} aria-label={ariaPic}></canvas>

		{#if st === 'loading'}
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
					<button type="button" class="signin" onclick={requestPull} disabled={requesting}>{requesting ? '…' : '📼 Request replay'}</button>
					{#if requestNote}<span class="s">{requestNote}</span>{/if}
				{:else if reason === 'requested'}
					<span class="big">⏳</span><span class="h">Tape incoming.</span><span class="s">Pulled from the archives — check back in a minute.</span>
				{:else if reason === 'expired'}
					<span class="h">Tape gone.</span><span class="s">Only the last 100 live results keep a replay.</span>
				{:else if reason === 'unsupported'}
					<span class="big">⛔</span><span class="h">This browser can't play tapes yet.</span><span class="s">Needs WebGPU — Chrome, Edge, or Safari 26+.</span>
				{:else if reason === 'signin'}
					<span class="h">Sign in to watch the tape.</span><span class="s">Replays are for players with an account.</span>
					<button class="signin" onclick={() => auth.login()}>Sign in through Steam</button>
				{:else}
					<span class="h">No tape for this one.</span><span class="s">Neither player's agent recorded it.</span>
				{/if}
			</div>
		{:else if st === 'nopack'}
			<div class="ov"><span class="big">📦</span><span class="h">Asset pack not on this device yet.</span><span class="s">The tape is in — the sprites and stage it needs haven't been packed for this browser.</span></div>
		{:else if st === 'unsupported'}
			<div class="ov"><span class="big">⛔</span><span class="h">This browser can't play tapes yet.</span><span class="s">Needs WebGPU — Chrome, Edge, or Safari 26+.</span></div>
		{:else if st === 'error'}
			<div class="ov"><span class="h">The tape didn't play.</span><span class="s mono">{err?.code}: {err?.message}</span></div>
		{:else if st === 'ended'}
			<div class="ov end"><button type="button" class="again" onclick={play}>▶ Watch again</button></div>
		{/if}
		{#if turnHint}<div class="hint">📱↻ Turn your phone</div>{/if}
	</div>

	<!-- transport: inline below the picture; fullscreen = the fade-out HUD (landscape) / bottom band (portrait) -->
	{@render transport(fullscreen)}
	{#if st === 'seeking'}
		<div class="note">skipping ahead…</div>
	{:else if halfAuto && playing}
		<div class="note">playing at half speed</div>
	{/if}
	<!-- watermark: the chrome band under the picture (inline) / the pillar band (fullscreen) — NEVER over the picture -->
	<div class="wm"><span>RETRO RECEIPTS</span><span class="sep">·</span><a href="{base}/ranks" title="The Marvel ladder">nobd.net/app/ranks</a>{#if dateText}<span class="sep">·</span><span>{dateText}</span>{/if}</div>
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
	}
	.emb:focus-visible {
		box-shadow: 0 0 0 2px var(--gold);
	}
	/* chrome-top */
	.ctop {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: var(--panel);
		border-bottom: 1px solid var(--line-soft);
		min-height: 56px;
	}
	.cplate {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.cplate.r {
		justify-content: flex-end;
	}
	.mid {
		text-align: center;
	}
	.gs {
		font-style: italic;
		font-weight: 900;
		font-size: 26px;
		line-height: 1;
		letter-spacing: 0.02em;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.gs.small {
		font-size: 18px;
	}
	.gs .w {
		color: var(--gold);
	}
	.gs .d {
		opacity: 0.45;
		margin: 0 4px;
	}
	.mrail {
		display: flex;
		gap: 8px;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--faint);
		margin-top: 3px;
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
	/* the picture — 640×480 CSS-scaled, pixelated; COMPACT inline (Tris 2026-09-03): capped at 1× (640 px) and
	   centered, so an expanded result row stays a card, not a screen; fullscreen is where it gets big */
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
	.ov.end {
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
	.wm {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 4px 12px 6px;
		background: var(--panel);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
		white-space: nowrap;
	}
	.wm a {
		color: var(--faint);
		text-decoration: none;
	}
	.wm a:hover {
		color: var(--dim);
		text-decoration: underline dotted;
	}
	.wm .sep {
		opacity: 0.5;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* ── FULLSCREEN (§7.6-7.7): #000 ground; landscape = plates in the pillar bands, transport = a fading HUD
	   over the bottom 56 px on a 60% scrim; portrait = chrome in the letterbox bands above/below. ── */
	.emb.fs {
		border: 0;
		border-radius: 0;
		background: #000;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		grid-template-areas: 'a pic b';
		align-items: center;
		width: 100%;
		height: 100%;
	}
	.emb.fs.pseudo {
		position: fixed;
		inset: 0;
		height: 100dvh;
		z-index: 100;
	}
	.emb.fs .ctop {
		display: contents;
	}
	.emb.fs .cplate {
		grid-area: a;
		justify-content: center;
		padding: 0 10px;
		min-width: 0;
	}
	.emb.fs .cplate.r {
		grid-area: b;
	}
	.emb.fs .mid {
		display: none;
	}
	.emb.fs .pic {
		grid-area: pic;
		width: var(--fsw);
		max-width: 100vw;
		margin: 0;
		align-self: center;
		cursor: none;
	}
	.emb.fs:not(.hudoff) .pic {
		cursor: pointer;
	}
	.emb.fs .tr {
		position: absolute;
		left: 50%;
		bottom: 0;
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
		bottom: 60px;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		border-radius: 6px;
		padding: 3px 8px;
	}
	/* fullscreen: the watermark sits at the bottom of the right pillar band, never over the picture */
	.emb.fs .wm {
		grid-area: b;
		align-self: end;
		justify-self: center;
		background: transparent;
		padding-bottom: 12px;
		color: color-mix(in srgb, #fff 45%, transparent);
	}
	.emb.fs .wm a {
		color: inherit;
	}
	.emb.fs.hudoff .tr,
	.emb.fs.hudoff .note {
		opacity: 0;
		pointer-events: none;
	}
	/* portrait fullscreen: rows — band (plates) / picture / band (transport); nothing over the picture */
	.emb.fs.portrait {
		grid-template-columns: 1fr;
		grid-template-rows: auto 1fr auto;
		grid-template-areas: 'a' 'pic' 'b';
		align-content: center;
	}
	.emb.fs.portrait .cplate,
	.emb.fs.portrait .cplate.r {
		grid-area: a;
		padding: 8px 12px;
		justify-content: flex-start;
	}
	.emb.fs.portrait .cplate.r {
		justify-content: flex-end;
		padding-top: 0;
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
		grid-area: b;
	}
	.emb.fs.portrait.hudoff .tr {
		opacity: 1;
		pointer-events: auto;
	}
	.emb.fs.portrait .wm {
		grid-area: b;
		align-self: end;
		padding-top: 44px;
	}

	@media (max-width: 720px) {
		.ctop {
			grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
			gap: 8px;
			padding: 8px 10px;
		}
		.gs {
			font-size: 20px;
		}
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
		.emb.fs .tr {
			transition: none;
		}
	}
</style>
