<script lang="ts">
	import { base } from '$app/paths';
	import { charName, charAbbr } from '$lib/chars';
	import { isCustomPalette, remappedImage } from '$lib/palette';

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
	//
	// CUSTOM SKINS: pass `palette` (the owner's 16-colour loadout entry) and the sprite renders in the
	// owner's colors — the baked assets are remapped stock→custom pixel-for-pixel (see lib/palette.ts),
	// animation strip included. No palette (or a stock one) costs nothing. `still` pins the chip to the
	// static portrait — for dense surfaces (receipt rows, boards) where dozens of animated canvases
	// would be wasteful.

	let {
		id,
		eager = false,
		still = false,
		palette = null,
		accent = 'var(--dim)',
		alt: altProp
	}: {
		id: number;
		eager?: boolean;
		still?: boolean;
		palette?: string[] | null;
		accent?: string;
		alt?: string;
	} = $props();

	type Timing = { w: number; h: number; n: number; fps: number; durations: number[]; loop: boolean };

	const name = $derived(charName(id));
	const alt = $derived(altProp ?? name);
	const skinned = $derived(isCustomPalette(id, palette));

	let host = $state<HTMLElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let staticFailed = $state(false); // static portrait 404 → abbreviation
	let anim = $state<{ img: CanvasImageSource; t: Timing } | null>(null); // loaded (maybe remapped) animation
	let tintedSrc = $state<string | null>(null); // remapped static portrait, as a data URL
	let visible = $state(false); // in/near viewport (gates the animation fetch); eager → true at once

	// reset when the char id or palette changes (MyMatch keys chips by slot index, so a chip's id can
	// change in place without a remount) — drop the old art + failure state so the new look reloads.
	let prevKey = $state('');
	$effect(() => {
		const key = `${id}|${skinned ? (palette ?? []).join(',') : ''}`;
		if (prevKey !== key) {
			prevKey = key;
			anim = null;
			tintedSrc = null;
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

	// custom skin on the static portrait: remap once (module-cached), swap in as a data URL. The stock
	// portrait stays on screen until the remap lands, so a slow first remap never blanks the chip.
	$effect(() => {
		if (!skinned || !visible || staticFailed) return;
		const cid = id;
		const pal = (palette ?? []).slice();
		let cancelled = false;
		void remappedImage(`${base}/chars/${cid}.webp`, cid, pal).then((cv) => {
			if (cancelled || cid !== id || !cv) return;
			try {
				tintedSrc = cv.toDataURL();
			} catch {
				/* stock look survives */
			}
		});
		return () => {
			cancelled = true;
		};
	});

	// load the animation assets once visible (never in `still` mode, under prefers-reduced-motion, or
	// after a static 404 — those stay on the portrait / abbreviation). Failure is silent: no upgrade.
	$effect(() => {
		if (still || !visible || staticFailed) return;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		const cid = id;
		const pal = skinned ? (palette ?? []).slice() : null;
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`${base}/chars-anim/${cid}.json`, {
					headers: { accept: 'application/json' }
				});
				if (!res.ok) return;
				const t = (await res.json()) as Timing;
				if (!t || !t.n || !Array.isArray(t.durations)) return;
				const url = `${base}/chars-anim/${cid}.webp`;
				let src: CanvasImageSource;
				if (pal) {
					// remap the WHOLE strip once — the player then draws frames from the recolored atlas
					const cv = await remappedImage(url, cid, pal);
					if (cv) src = cv;
					else {
						const img = new Image();
						img.decoding = 'async';
						await new Promise<void>((resolve, reject) => {
							img.onload = () => resolve();
							img.onerror = () => reject(new Error('sheet load failed'));
							img.src = url;
						});
						src = img;
					}
				} else {
					const img = new Image();
					img.decoding = 'async';
					await new Promise<void>((resolve, reject) => {
						img.onload = () => resolve();
						img.onerror = () => reject(new Error('sheet load failed'));
						img.src = url;
					});
					src = img;
				}
				if (!cancelled && cid === id) anim = { img: src, t };
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
			src={tintedSrc ?? `${base}/chars/${id}.webp`}
			{alt}
			draggable="false"
			loading={eager ? 'eager' : 'lazy'}
			onerror={() => (staticFailed = true)}
		/>
	{/if}
</span>

<style>
	.cs {
		position: relative; /* the sprite pins to this box — see .spr */
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	/* absolutely pinned to the host box: percentage heights on replaced grid items silently lose to the
	   image's natural aspect (measured: a 38px box rendering its img at 38×52), so the sprite takes the
	   box via inset instead — object-fit does the containing. */
	.spr {
		position: absolute;
		inset: 0;
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
