// ── The tape engine, loaded at runtime (LIVE-TAB-SPEC §5, §7.9) ──────────────────────────────────────
// The PROVEN dev player (mvc-live-skins-quarters/d3dcap/replay: player.mjs / tape-player.mjs /
// tape-worker.mjs / replay.mjs / resources.mjs / state.mjs / sprite.wgsl + the wasm-bindgen glue) is
// copied VERBATIM into static/replay/engine/ and imported here as a plain ES module URL — NOT through
// Vite's module graph — so the worker (`new Worker(new URL('./tape-worker.mjs', import.meta.url))`),
// the shader fetch (`new URL('./sprite.wgsl', import.meta.url)`) and the wasm fetch keep resolving
// exactly as they do in the dev player. Port, don't rewrite: nothing in the engine is patched here.
//
// The engine has no game data in it (the wasm is the emitter; pixels come from the pack at runtime).
import { base } from '$app/paths';

// lib.dom in this toolchain has no WebGPU declarations and @webgpu/types is not a dependency, so the few
// GPU objects the wrapper touches are typed structurally here (the engine itself is untyped JS).
export interface GpuBufferLike {
	destroy(): void;
}
export interface GpuTextureViewLike {
	readonly __gpuView?: true;
}
export interface GpuTextureLike {
	createView(): GpuTextureViewLike;
}
export interface GpuDeviceLike {
	lost: Promise<unknown>;
	destroy(): void;
	addEventListener(type: 'uncapturederror', cb: (e: { error: { message: string } }) => void): void;
	removeEventListener(type: 'uncapturederror', cb: (e: { error: { message: string } }) => void): void;
}
export interface GpuCanvasContextLike {
	configure(o: { device: GpuDeviceLike; format: string; alphaMode: 'opaque' | 'premultiplied' }): void;
	unconfigure(): void;
	getCurrentTexture(): GpuTextureLike;
}
interface GpuAdapterLike {
	requestDevice(): Promise<GpuDeviceLike>;
}
export interface NavigatorGpuLike {
	gpu?: {
		requestAdapter(): Promise<GpuAdapterLike | null>;
		getPreferredCanvasFormat(): string;
	};
}

/** Synchronous WebGPU feature test (player.html:95) — the `checking` state of the embed. */
export function hasWebGPU(): boolean {
	return typeof navigator !== 'undefined' && !!(navigator as NavigatorGpuLike).gpu;
}

/** The shape of tape-player.mjs's TapePlayer we drive (see that file for the contract). */
export interface TapePlayerLike {
	load(
		tapeUrl: string,
		/** a pack directory URL (dev) or an already-assembled pack (lib/replay/pack.ts — the server path) */
		pack: string | { packIndex: { name: string; off: number; len: number }[]; packBlob: Uint8Array },
		o: {
			start?: number;
			count?: number;
			onProgress?: (got: number, total: number, what?: string) => void;
			opts?: Record<string, unknown>;
		}
	): Promise<TapePlayerLike>;
	prepareAll(onProgress?: (i: number, n: number) => void): Promise<{ bytes: number; textures: number; prepared: number }>;
	ready(i: number): Promise<number>;
	draw(i: number, view: GpuTextureViewLike): { ms: number; drawn: number; ready: number };
	readback(): Promise<Uint8Array>;
	stats(): { frames: number; avgMs: number; maxMs: number; openMs: number };
	evict(i: number): void;
	readonly count: number;
	readonly frameNumber: number;
	index: number;
	first: number;
	openMs: number;
	info: { frames: number; agent?: string; tape_ver?: number; stage_id?: number; world?: unknown };
	worker?: Worker;
	cache: Map<number, { res: { vertexBuffer: GpuBufferLike; indexBuffer: GpuBufferLike; uniformBuffer: GpuBufferLike } }>;
	decoded: Map<number, unknown>;
	_onMessage(m: { type: string; i?: number; fill?: boolean }): void;
	/** re-target the display (scale / canvas) without reloading the tape — PWA engine addition (player.mjs) */
	setDisplay(o: { scale?: number; filter?: 'box' | 'nearest'; canvas?: { w: number; h: number } }): boolean;
	/** the scene render target's size (replayer.width/height = sceneRT × scale) */
	replayer?: { width: number; height: number; scale: number };
	blitTaps?: [number, number];
}

interface EngineModule {
	TapePlayer: new (
		device: GpuDeviceLike,
		format: string,
		opts: { scale: number; filter: 'box' | 'nearest'; canvas: { w: number; h: number } | null }
	) => TapePlayerLike;
}

/** Bumped by the release: the engine files are static, so their URL must change when they do. */
const ENGINE_BUILD = '20260904e';

let mod: Promise<EngineModule> | null = null;

/** Import the engine once per session. Throws (code 'open') when the module URL can't load. */
export function loadEngine(): Promise<EngineModule> {
	if (!mod) {
		// ?v=<build> is a CACHE KEY, not decoration: a browser that once cached these modules under a wrong
		// Content-Type (rise3 had no .mjs MIME mapping until 2026-09-04) keeps refusing them as module scripts
		// forever, and no server header fixes an entry that is already stored. A new query per release makes a
		// stale entry unreachable. The worker and the wasm glue resolve relative to this URL, so the query rides
		// along to every engine file (import.meta.url carries the search string).
		const url = `${base}/replay/engine/tape-player.mjs?v=${ENGINE_BUILD}`;
		mod = import(/* @vite-ignore */ url).catch((e) => {
			mod = null;
			throw Object.assign(new Error(`engine: ${e?.message ?? e}`), { code: 'open' });
		});
	}
	return mod;
}

/**
 * The display plan for a picture drawn `cssW` CSS px wide (Tris 2026-09-04: "keep the correct render/pixel ratios so
 * the quality does not stretch to the canvas — render at the highest internal resolution and display at half").
 *   backing  = the canvas in DEVICE pixels: 4·floor(cssW·dpr/4) wide, exactly ¾ of that tall (4:3 by construction,
 *              never stretched — the CSS box is 4:3 too, `.pic { aspect-ratio: 4/3 }`)
 *   res      = the internal resolution as a multiple of 640×480: the smallest even r ∈ {2, 4, 6} with r·640 ≥ 2·backingW
 *              (cap res 6 = 3840×2880); even so the engine's `scale` (= r/2, relative to the capture's own 2×) stays an
 *              INTEGER and every per-draw viewport stays exact
 *   taps     = round(r·640 / backingW) — integer by construction whenever the backing is a multiple of 640 (inline 1×,
 *              1080p fullscreen 2×, 1440p 3×); at other widths (phones, the 4K cap) the box filter averages a rounded
 *              tap count — accepted
 *   base quality (after a GPU error) = res 2, nearest — the same backing, no supersampling.
 */
export function displayPlan(quality: 'high' | 'base', cssW: number, dpr = 1) {
	const bw = Math.max(4, 4 * Math.floor((Math.max(1, cssW) * Math.max(1, dpr)) / 4));
	const bh = (bw * 3) / 4;
	const res = quality === 'base' ? 2 : ([2, 4, 6].find((r) => r * 640 >= 2 * bw) ?? 6);
	const taps = Math.max(1, Math.round((res * 640) / bw));
	return {
		scale: res / 2,
		filter: quality === 'high' ? ('box' as const) : ('nearest' as const),
		canvas: { w: bw, h: bh },
		res,
		taps
	};
}

/** Display quality → the dev player's `?res=&filter=` (player.html) at a fixed 640×480 canvas (legacy; the embed uses displayPlan). */
export function displayOpts(quality: 'high' | 'base') {
	// scale is relative to the capture's own 2× of native (SequencePlayer.opts.scale semantics)
	return quality === 'high'
		? { scale: 2, filter: 'box' as const, canvas: { w: 640, h: 480 } }
		: { scale: 1, filter: 'nearest' as const, canvas: { w: 640, h: 480 } };
}

let device: Promise<GpuDeviceLike> | null = null;

/** One WebGPU device per session, shared by every embed (§7.9). Rejects with code 'webgpu' when absent. */
export function gpuDevice(): Promise<GpuDeviceLike> {
	if (!device) {
		device = (async () => {
			const gpu = (navigator as NavigatorGpuLike).gpu;
			if (!gpu) throw Object.assign(new Error('WebGPU unavailable'), { code: 'webgpu' });
			const adapter = await gpu.requestAdapter();
			if (!adapter) throw Object.assign(new Error('no WebGPU adapter'), { code: 'webgpu' });
			const d = await adapter.requestDevice();
			d.lost.then(() => {
				device = null; // the next embed re-requests
			});
			return d;
		})().catch((e) => {
			device = null;
			throw e;
		});
	}
	return device;
}

/** The canvas format WebGPU prefers on this platform (player.html:101). */
export function canvasFormat(): string {
	return (navigator as NavigatorGpuLike).gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm';
}

/** Release everything an embed holds: the worker, the prepared GPU buffers, the decode window. */
export function disposePlayer(p: TapePlayerLike | null): void {
	if (!p) return;
	try {
		p.worker?.postMessage({ type: 'close' });
		p.worker?.terminate();
	} catch {
		/* already gone */
	}
	try {
		for (const e of p.cache.values()) {
			e.res.vertexBuffer.destroy();
			e.res.indexBuffer.destroy();
			e.res.uniformBuffer.destroy();
		}
		p.cache.clear();
		p.decoded.clear();
	} catch {
		/* best effort */
	}
}
