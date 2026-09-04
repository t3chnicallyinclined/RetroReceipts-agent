<script lang="ts">
	import RankBadge from './RankBadge.svelte';
	import { bind, colorOf, cond, getPath, OUTLINE, type Ctx, type OverlayMode, type OverlayTemplate, type TplEl, type TplStyle } from '$lib/replay/overlay';

	// ▶ REPLAYOVERLAY — the template renderer (docs/REPLAY-OVERLAY-TEMPLATE.md). A 640×480 DOM layer, a sibling of the
	// canvas, CSS-scaled with the picture (`transform: scale(k)`); every element is a template node bound to `ctx` —
	// there are NO hard-coded plates here: a template change needs no code change. DOM only, never canvas: the game's
	// pixels underneath stay exact. pointer-events: none except links. Full-only elements (`visibility: 'full'`) fade
	// out over 300 ms and leave the flow (display transitions with allow-discrete) when the mode is minimal; they come
	// back instantly. `role`/`label` make the plate groups readable ("Player 1: Tris").
	let {
		tpl,
		ctx,
		mode,
		k = 1,
		seats = true,
		onclick = null
	}: {
		tpl: OverlayTemplate;
		ctx: Ctx;
		/** the effective overlay mode (ReplayEmbed's `showOverlay`) */
		mode: OverlayMode;
		/** picture CSS width / 640 */
		k?: number;
		/** seats known → the `.seats` hook (templates may key a style on it via `{{seatsKnown ? … : …}}`) */
		seats?: boolean;
		onclick?: ((e: MouseEvent) => void) | null;
	} = $props();

	const tokens = $derived(tpl.tokens ?? {});
	const px = (n: number | undefined) => (n == null ? '' : `${n}px`);
	/** a numeric template field that may also be a binding (`"{{p1.creators ? 11 : 20}}"`) — see TplEl */
	const numOf = (v: number | string | undefined, scope: Ctx): number | undefined => {
		if (v == null) return undefined;
		if (typeof v === 'number') return v;
		const n = Number(bind(v, scope, tokens));
		return Number.isFinite(n) ? n : undefined;
	};
	const tok = (s: string | undefined, scope: Ctx) => (s == null ? '' : colorOf(s, scope, tokens));

	/** the element's inline style: named style + overrides, box, layout, placement (top-level = absolute in 640×480) */
	function styleOf(e: TplEl, scope: Ctx, top: boolean): string {
		const base: TplStyle = (e.style && tpl.styles?.[e.style]) || {};
		const s: TplStyle & TplEl = { ...base, ...e };
		const out: string[] = [];
		if (s.font) out.push(`font-family:${s.font}`);
		const size = numOf(s.size, scope);
		if (size != null) out.push(`font-size:${size}px`);
		if (s.weight != null) out.push(`font-weight:${s.weight}`);
		if (s.italic) out.push('font-style:italic');
		const lh = numOf(s.lineHeight, scope);
		if (lh != null) out.push(`line-height:${lh}px`);
		if (s.letterSpacing != null) out.push(`letter-spacing:${typeof s.letterSpacing === 'number' ? `${s.letterSpacing}px` : s.letterSpacing}`);
		if (s.uppercase) out.push('text-transform:uppercase');
		if (s.outline) out.push(e.kind === 'rank' ? 'filter:drop-shadow(0 0 1px #000)' : `text-shadow:${OUTLINE}`);
		if (s.color) out.push(`color:${tok(s.color, scope)}`);
		if (s.opacity != null) out.push(`opacity:${s.opacity}`);
		if (s.underline) out.push(s.underline === 'none' ? 'text-decoration:none' : `text-decoration:underline ${s.underline};text-underline-offset:2px`);
		if (s.ellipsis) out.push('overflow:hidden;text-overflow:ellipsis');
		const eh = numOf(e.h, scope);
		if (eh != null) out.push(`height:${eh}px`);
		if (e.w != null) out.push(`max-width:${e.w}px`);
		const emt = numOf(e.mt, scope);
		if (emt != null) out.push(`margin-top:${emt}px`);
		if (e.ml != null) out.push(`margin-left:${e.ml}px`);
		if (e.mr != null) out.push(`margin-right:${e.mr}px`);
		if (e.borderTop) out.push(`border-top:${e.borderTop.replace(/\b[a-zA-Z]\w*\b/g, (w) => tokens[w] ?? w)}`);
		if (e.box) {
			if (e.box.fill) out.push(`background:${tok(e.box.fill, scope)}`);
			if (e.box.radius != null) out.push(`border-radius:${e.box.radius}px`);
			if (e.box.padding != null) out.push(`padding:${Array.isArray(e.box.padding) ? `${e.box.padding[0]}px ${e.box.padding[1]}px` : `${e.box.padding}px`}`);
		}
		if (e.children || e.layout) {
			// `display` is NEVER inline (the .group class sets flex) so the minimal/full visibility rules can hide the node
			const col = e.layout === 'column';
			out.push(`flex-direction:${col ? 'column' : 'row'}${e.reverse ? '-reverse' : ''}`);
			if (e.gap != null) out.push(`gap:${e.gap}px`);
			// column: `align` picks the cross-axis edge; row: items centre on the cross axis and `justify` packs them
			if (col) out.push(`align-items:${e.align === 'right' ? 'flex-end' : e.align === 'center' ? 'center' : 'flex-start'}`);
			else {
				out.push('align-items:center');
				if (e.justify) out.push(`justify-content:${e.justify === 'end' ? 'flex-end' : e.justify === 'center' ? 'center' : 'flex-start'}`);
			}
		}
		if (top) {
			out.push('position:absolute');
			const a = e.anchor ?? 'top-left';
			const x = px(e.x ?? 0), y = px(e.y ?? 0);
			if (a === 'top-left') out.push(`left:${x};top:${y}`);
			else if (a === 'top-right') out.push(`right:${x};top:${y}`);
			else if (a === 'top-center') out.push(`left:50%;top:${y};transform:translateX(-50%)`);
			else if (a === 'bottom-left') out.push(`left:${x};bottom:${y}`);
			else if (a === 'bottom-right') out.push(`right:${x};bottom:${y}`);
			else if (a === 'bottom-center') out.push(`left:50%;bottom:${y};transform:translateX(-50%)`);
			else out.push('left:50%;top:50%;transform:translate(-50%,-50%)');
		} else out.push('max-width:100%');
		return out.join(';');
	}
	const classOf = (e: TplEl, scope: Ctx) =>
		`el ${e.kind ?? (e.children ? 'group' : 'text')}${e.class ? ` ${bind(e.class, scope, tokens)}` : ''}${e.visibility === 'full' ? ' fo' : e.visibility === 'minimal' ? ' mo' : ''}`.trim();
	const sepOf = (e: TplEl) => (typeof e.separator === 'string' ? { text: e.separator, ml: 0, mr: 0 } : e.separator ? { ml: 0, mr: 0, ...e.separator } : null);
	const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
</script>

{#snippet el(e: TplEl, scope: Ctx, top: boolean)}
	{#if !e.when || cond(scope, e.when)}
		{@const cls = classOf(e, scope)}
		{@const st = styleOf(e, scope, top)}
		{#if e.kind === 'rank'}
			{@const rating = num(getPath(scope, e.rating ?? 'p1.rating'))}
			{@const games = num(getPath(scope, e.games ?? 'p1.games'))}
			{@const h = bind(e.href, scope, tokens)}
			{#if h}<a class={cls} style={st} href={h} title={e.title ?? 'Marvel ladder'}><RankBadge {rating} games={games ?? 999} size={numOf(e.badge, scope) ?? 10} /></a>
			{:else}<span class={cls} style={st} title={e.title}><RankBadge {rating} games={games ?? 999} size={numOf(e.badge, scope) ?? 10} /></span>{/if}
		{:else if e.kind === 'list'}
			{@const items = (getPath(scope, e.items ?? '') as unknown[] | undefined) ?? []}
			{@const sep = sepOf(e)}
			{#each items as item, i (i)}
				{@const s2 = { ...scope, item }}
				{@const h = bind(e.href, s2, tokens)}
				{#if i && sep}<span class="el sep" style="margin-left:{sep.ml}px;margin-right:{sep.mr}px">{sep.text}</span>{/if}
				{#if h}<a class={cls} style={st} href={h} aria-label={e.ariaLabel ? bind(e.ariaLabel, s2, tokens) : undefined}>{bind(e.content, s2, tokens)}</a>
				{:else}<span class={cls} style={st}>{bind(e.content, s2, tokens)}</span>{/if}
			{/each}
		{:else if e.children}
			<div class={cls} style={st} role={e.role} aria-label={e.label ? bind(e.label, scope, tokens) : undefined} title={e.title}>
				{#each e.children as c, i (c.id ?? i)}{@render el(c, scope, false)}{/each}
			</div>
		{:else}
			{@const h = bind(e.href, scope, tokens)}
			{#if h}<a class={cls} style={st} href={h} title={e.title} aria-label={e.ariaLabel ? bind(e.ariaLabel, scope, tokens) : undefined}>{bind(e.content, scope, tokens)}</a>
			{:else}<span class={cls} style={st} title={e.title} aria-hidden={e.aria === 'hidden' ? 'true' : undefined}>{bind(e.content, scope, tokens)}</span>{/if}
		{/if}
	{/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="ovl {mode}" class:seats style="transform:scale({k})" aria-hidden={mode === 'off'} data-mode={mode} data-template={tpl.name} onclick={onclick ?? undefined}>
	{#each tpl.elements as e, i (e.id ?? i)}{@render el(e, ctx, true)}{/each}
</div>

<style>
	/* the layer: 640×480 picture units, scaled with the picture; the picture is the game's, so the layer pins its own dark-on-picture palette */
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
		color: #eef1f8;
	}
	.ovl.off {
		display: none;
	}
	.ovl :global(a) {
		pointer-events: auto;
		color: inherit;
		text-decoration: none;
	}
	.ovl :global(a:hover),
	.ovl :global(a:focus-visible) {
		text-decoration: underline dotted;
		text-underline-offset: 2px;
		outline: none;
	}
	.ovl :global(.el) {
		box-sizing: border-box;
		min-width: 0;
		white-space: nowrap;
	}
	.ovl :global(.el.group),
	.ovl :global(.el.text[style*='flex-direction']) {
		display: flex;
	}
	.ovl :global(.el.rank) {
		display: inline-flex;
		line-height: 0;
	}
	/* full-only elements: a 300 ms fade OUT then out of flow in minimal (`display` transitions with allow-discrete); back is instant */
	.ovl :global(.fo) {
		transition: opacity 0.3s, display 0.3s allow-discrete;
	}
	/* .el.fo outranks .el.group's display:flex */
	.ovl.minimal :global(.el.fo) {
		opacity: 0;
		display: none;
	}
	.ovl.full :global(.el.mo) {
		display: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.ovl :global(.fo) {
			transition: none;
		}
	}
</style>
