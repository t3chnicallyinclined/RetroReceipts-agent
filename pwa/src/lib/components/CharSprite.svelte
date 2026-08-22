<script lang="ts">
	import { base } from '$app/paths';
	import { charName, charAbbr } from '$lib/chars';

	// A character sprite with a graceful, three-step fallback chain:
	//   1. idle-loop ANIMATION  → /chars-anim/<id>.webp (a horizontal frame strip) driven by
	//      /chars-anim/<id>.json (per-frame durations) on a tiny <canvas> player.
	//   2. static portrait      → /chars/<id>.webp (the single-frame image, always deployed).
	//   3. abbreviation tile    → the 2–3 letter char code, if even the static portrait 404s.
	// The static portrait shows first (SSR + instant), then upgrades to the animation once its
	// assets load — so a missing animation asset (or reduced-motion) simply stays on the portrait,
	// and a missing portrait falls through to the abbreviation. Sprites are pixel art, so both the
	// <img> and the <canvas> render with `image-rendering: pixelated` and nearest-neighbour scaling.
	// Fills its parent box (the caller sizes it, e.g. the 62×78 .cface); lazy by default — pass
	// `eager` for the point character(s) that should load up front.

	let {
		id,
		eager = false,
		accent = 'var(--dim)',
		alt: altProp
	}: { id: number; eager?: boolean; accent?: string; alt?: string } = $props();

	type Timing = { w: number; h: number; n: number; fps: number; durations: number[]; loop: boolean };

	const name = $derived(charName(id));
	const alt = $derived(altProp ?? name);

	let host = $state<HTMLElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let staticFailed = $state(false); // static portrait 404 → abbreviation
	let anim = $state<{ img: HTMLImageElement; t: Timing } | null>(null); // loaded animation
	let visible = $state(false); // in/near viewport (gates the animation fetch); eager → true at once

	// reset when the char id changes (MyMatch keys chips by slot index, so a chip's id can change
	// in place without a remount) — drop the old animation + failure state so the new id reloads.
	let prevId = $state<number | undefined>(undefined);
	$effect(() => {
		if (prevId !== id) {
			prevId = id;
			anim = null;
			staticFailed = false;
		}
	});

	// lazy: reveal when the element nears the viewport (eager skips straight to visible).
	$effect(() => {
		if (visible || !host) return;
		if (eager) {
			visible = true;
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					visible = true;
					io.disconnect();
				}
			},
			{ rootMargin: '200px' }
		);
		io.observe(host);
		return () => io.disconnect();
	});

	// load the animation assets once visible (never under prefers-reduced-motion or after a static
	// 404 — those stay on the portrait / abbreviation). Failure is silent: we just don't upgrade.
	$effect(() => {
		if (!visible || staticFailed) return;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		const cid = id;
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`${base}/chars-anim/${cid}.json`, {
					headers: { accept: 'application/json' }
				});
				if (!res.ok) return;
				const t = (await res.json()) as Timing;
				if (!t || !t.n || !Array.isArray(t.durations)) return;
				const img = new Image();
				img.decoding = 'async';
				await new Promise<void>((resolve, reject) => {
					img.onload = () => resolve();
					img.onerror = () => reject(new Error('sheet load failed'));
					img.src = `${base}/chars-anim/${cid}.webp`;
				});
				if (!cancelled && cid === id) anim = { img, t };
			} catch {
				/* stay on the static portrait */
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	// canvas player — draws the current frame contain-fit + centred, advancing on each frame's own
	// duration (game frames @ t.fps). Sizes the backing store to the box × dpr for crisp pixels.
	$effect(() => {
		if (!anim || !canvas) return;
		const cv = canvas;
		const ctx = cv.getContext('2d');
		if (!ctx) return;
		const { img, t } = anim;
		let frame = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const size = () => {
			const dpr = Math.min(window.devicePixelRatio || 1, 3);
			const r = cv.getBoundingClientRect();
			const cw = Math.max(1, Math.round(r.width * dpr));
			const ch = Math.max(1, Math.round(r.height * dpr));
			if (cv.width !== cw || cv.height !== ch) {
				cv.width = cw;
				cv.height = ch;
			}
		};
		const draw = () => {
			const cw = cv.width,
				ch = cv.height;
			ctx.clearRect(0, 0, cw, ch);
			ctx.imageSmoothingEnabled = false;
			const s = Math.min(cw / t.w, ch / t.h);
			const dw = t.w * s,
				dh = t.h * s;
			ctx.drawImage(img, frame * t.w, 0, t.w, t.h, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
		};
		const tick = () => {
			draw();
			const ms = Math.max(16, ((t.durations[frame] ?? 6) * 1000) / (t.fps || 60));
			frame = (frame + 1) % t.n;
			timer = setTimeout(tick, ms);
		};
		size();
		const ro = new ResizeObserver(() => {
			size();
			draw();
		});
		ro.observe(cv);
		tick();
		return () => {
			if (timer) clearTimeout(timer);
			ro.disconnect();
		};
	});
</script>

<span class="cs" bind:this={host}>
	{#if staticFailed}
		<span class="abbr" style="color:{accent}">{charAbbr(id)}</span>
	{:else if anim}
		<canvas bind:this={canvas} class="spr" aria-label={alt}></canvas>
	{:else}
		<img
			class="spr"
			src="{base}/chars/{id}.webp"
			{alt}
			draggable="false"
			loading={eager ? 'eager' : 'lazy'}
			onerror={() => (staticFailed = true)}
		/>
	{/if}
</span>

<style>
	.cs {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	.spr {
		width: 100%;
		height: 100%;
		object-fit: contain;
		image-rendering: pixelated; /* low-res pixel-art sprites */
		user-select: none;
	}
	.abbr {
		font-size: 15px;
		font-weight: 900;
		letter-spacing: 0.04em;
	}
</style>
