// ── The replay overlay TEMPLATE layer (Tris 2026-09-04: "the tape overlay should ship separate — something we apply
// and change over the rendered tape, so it is easier to change at a higher level if we want to change the template /
// fonts / metadata"). Design of record: docs/REPLAY-OVERLAY-SPEC.md rev 3; format: docs/REPLAY-OVERLAY-TEMPLATE.md.
//
//   template  — a versioned JSON document (`OverlayTemplate`) that FULLY describes what is drawn and where, in 640×480
//               picture units: fonts, tokens, named styles, and a tree of elements with a mustache-like binding over
//               the metadata. The rev 3 layout is the built-in default: static/replay/overlay/default.json.
//   meta      — ONE binding schema for both producers (`OverlayMeta`): the server may ship it with the tape read
//               (HANDOFF-LANE1-REPLAY-DATA.md STEP 4b, `GET /rr/tape?key=` → `overlay: {template, version, meta}`); when
//               the block is absent the embed assembles the same shape client-side (feed row + loadouts + profile).
//   renderer  — ReplayOverlay.svelte turns template elements into positioned DOM nodes (never canvas): the game's pixels
//               underneath stay exact. The poster/export composite (REPLAY-OVERLAY-PLAN-PWA.md Phase D) binds the SAME
//               template to the SAME meta.
//   load order (`loadOverlayTemplate`): `?overlay=<url>` (dev preview) → the tape's `overlay.template` → the server's
//               /rr/update/overlay-template.json (24 h cache, same posture as changelog.json; 404 → next) → the built-in
//               default.json → an inline last-resort (names only) so the layer never disappears.
import { base } from '$app/paths';
import { api } from '$lib/config';

// ── the binding schema (server block STEP 4b ≡ client assembly) ─────────────────────────────────────────────────
export interface OverlayCredit {
	cid: number;
	name: string;
	author_steamid?: string;
	author_name?: string;
	/** the wearer made it — contributes nothing to `Skin by:` (also implied by author_steamid === wearer) */
	own?: boolean;
}
export interface OverlaySide {
	steamid?: string;
	name?: string;
	/** a server-resolved tier NAME (display only; the badge derives the tier from rating+games — commandment 6) */
	rank?: string;
	rating?: number | null;
	games?: number | null;
	avatar?: string;
	won?: boolean;
	team?: number[];
	/** the set score for this side, when the set carries one */
	score?: number | null;
	credits?: OverlayCredit[];
}
export interface OverlayMeta {
	mode?: string;
	ft?: number;
	game?: number;
	date_ms?: number;
	stage_id?: number;
	/** a stage NAME when the producer has one (C8); the stamp shows `STAGE <id>` otherwise */
	stage_name?: string;
	duration_s?: number;
	/** false = the row's order, unlabelled, `stock colors` on the stamp (spec §5a); absent = known (the server's p1/p2 ARE the seats) */
	seats_known?: boolean;
	/**
	 * The tape carries no world sections, so the replay draws the fighters with NO stage and NO HUD (no health bars,
	 * timer or portraits). MEASURED on prod 2026-09-04: agents before 0.3.34 never captured them (of the newest 40
	 * tapes, 26 were 0.3.31 = fighters only, 14 were 0.3.50 = full), and tapes before 0.3.36 also have no trustworthy
	 * stage id (the server returns `stage_id: null`). The overlay says so plainly — we never fake a HUD or a stage.
	 */
	limited?: boolean;
	saved?: boolean;
	/** `RETRO RECEIPTS · nobd.net/app/ranks` — the part after ` · ` is the link text */
	watermark?: string;
	p1: OverlaySide;
	p2: OverlaySide;
}
/** the `overlay` block on a tape read / a dev-manifest entry */
export interface TapeOverlay {
	template?: string | null;
	version?: number;
	meta?: OverlayMeta;
}

// ── the template document ───────────────────────────────────────────────────────────────────────────────────
export interface TplStyle {
	/** a CSS font-family stack */
	font?: string;
	size?: number;
	weight?: number;
	italic?: boolean;
	lineHeight?: number;
	letterSpacing?: string | number;
	uppercase?: boolean;
	/** the 1 px dark outline (text) / a 1 px drop shadow (rank badge) that carries text over any game pixel */
	outline?: boolean;
	/** a token name, a CSS colour, or a binding (`{{p1.won ? gold : ink}}`) */
	color?: string;
	opacity?: number;
	underline?: 'dotted' | 'solid' | 'none';
	ellipsis?: boolean;
}
export interface TplBox {
	/** a token name or a CSS colour */
	fill?: string;
	radius?: number;
	/** [vertical, horizontal] in picture px, or one number */
	padding?: [number, number] | number;
}
export interface TplEl extends TplStyle {
	id?: string;
	/** text (default) · rank (the tier badge) · list (one node per item of `items`) · group (children) */
	kind?: 'text' | 'rank' | 'list' | 'group';
	/** DOM classes (bindable) — smoke-test hooks and nothing else; styling comes from the template */
	class?: string;
	role?: string;
	/** aria-label (bindable) */
	label?: string;
	ariaLabel?: string;
	title?: string;
	aria?: 'hidden';
	/** top-level placement in 640×480 units; children flow inside their parent's layout */
	anchor?: 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right' | 'bottom-center' | 'center';
	x?: number;
	y?: number;
	/** max-width */
	w?: number;
	h?: number;
	mt?: number;
	ml?: number;
	mr?: number;
	gap?: number;
	layout?: 'row' | 'column';
	align?: 'left' | 'right' | 'center';
	justify?: 'start' | 'end' | 'center';
	reverse?: boolean;
	/** a named style from `styles` (element fields override it) */
	style?: string;
	box?: TplBox;
	borderTop?: string;
	/** always (default) · full (only in the full form; fades out in minimal) · minimal (only in the minimal form) */
	visibility?: 'always' | 'full' | 'minimal';
	/** a binding path that must be truthy (`p1.creators`, `!seatsKnown`) — else the element is not rendered */
	when?: string;
	/** mustache text: `{{path}}`, `{{path ? A : B}}` (A/B = a token name, a 'quoted' literal, or a path) */
	content?: string;
	href?: string;
	/** rank: the paths of the rating / games to derive the tier from, and the badge size */
	rating?: string;
	games?: string;
	badge?: number;
	/** list: the path of the array; each item binds as `item.*` */
	items?: string;
	separator?: string | { text: string; ml?: number; mr?: number };
	children?: TplEl[];
}
export interface OverlayTemplate {
	version: 1;
	name: string;
	fonts?: { family: string; url?: string | null }[];
	tokens: Record<string, string>;
	styles?: Record<string, TplStyle>;
	elements: TplEl[];
}

/** the four-direction 1 px outline + 2 px glow used by `outline: true` */
export const OUTLINE = '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 0 0 2px #000';

// ── bindings ────────────────────────────────────────────────────────────────────────────────────────────────
export type OverlayMode = 'full' | 'minimal' | 'off';
export type Ctx = Record<string, unknown>;
export function getPath(ctx: Ctx, path: string): unknown {
	let cur: unknown = ctx;
	for (const k of path.split('.')) {
		if (cur == null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[k];
	}
	return cur;
}
/** arrays: non-empty · strings: non-empty · numbers: not NaN (0 counts — a score of 0 is shown) · else !! */
export function truthy(v: unknown): boolean {
	if (v == null) return false;
	if (Array.isArray(v)) return v.length > 0;
	if (typeof v === 'string') return v.length > 0;
	if (typeof v === 'number') return !Number.isNaN(v);
	return !!v;
}
export function cond(ctx: Ctx, expr: string): boolean {
	const e = expr.trim();
	const neg = e.startsWith('!');
	const v = truthy(getPath(ctx, neg ? e.slice(1).trim() : e));
	return neg ? !v : v;
}
function pick(ctx: Ctx, tokens: Record<string, string>, s: string): string {
	s = s.trim();
	const q = s.match(/^'(.*)'$|^"(.*)"$/);
	if (q) return q[1] ?? q[2] ?? '';
	if (s in tokens) return tokens[s];
	const v = getPath(ctx, s);
	return v == null ? s : String(v);
}
/** `{{path}}` → the value ('' when absent); `{{path ? A : B}}` → A or B through `pick` (token → value, quoted → literal, path → value, else the word itself) */
export function bind(str: string | undefined, ctx: Ctx, tokens: Record<string, string>): string {
	if (!str) return '';
	return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
		const t = expr.match(/^(!?[\w.]+)\s*\?\s*(.+?)\s*:\s*(.+)$/);
		if (t) return pick(ctx, tokens, cond(ctx, t[1]) ? t[2] : t[3]);
		const v = getPath(ctx, expr.trim());
		return v == null ? '' : String(v);
	});
}
/** a colour field: binding first, then a token name → its value */
export function colorOf(str: string | undefined, ctx: Ctx, tokens: Record<string, string>): string {
	const s = bind(str, ctx, tokens).trim();
	return tokens[s] ?? s;
}

// ── the binding context from the meta (the derived/presentation fields both producers get for free) ──────────
const MODE_LABEL: Record<string, string> = { ranked: 'RANKED', lobby: 'LOBBY', money: 'MONEY', tourney: 'TOURNEY', tournament: 'TOURNEY' };
const is17 = (s?: string) => !!s && /^\d{17}$/.test(s);
const pad2 = (n: number) => String(n).padStart(2, '0');
export interface Creator {
	name: string;
	steamid?: string;
	href: string;
}
/** the UNIQUE creators of a side's credited skins, in slot order; own design and stock contribute nothing */
export function uniqueCreators(credits: OverlayCredit[] | undefined, wearer: string | undefined, basePath: string): Creator[] {
	const out: Creator[] = [];
	for (const c of credits ?? []) {
		if (c.own || (is17(c.author_steamid) && c.author_steamid === wearer)) continue;
		const name = c.author_name || (c.author_steamid ? `…${c.author_steamid.slice(-5)}` : '');
		if (!name) continue;
		const sid = is17(c.author_steamid) ? c.author_steamid : undefined;
		const hit = out.find((o) => o.name === name);
		if (hit) {
			if (!hit.steamid && sid) {
				hit.steamid = sid;
				hit.href = `${basePath}/u/${sid}`;
			}
			continue;
		}
		out.push({ name, steamid: sid, href: sid ? `${basePath}/u/${sid}` : '' });
	}
	return out;
}
export function bindCtx(m: OverlayMeta, basePath: string = base): Ctx {
	const seatsKnown = m.seats_known !== false;
	const side = (s: OverlaySide | undefined, seat: 1 | 2) => {
		const sd = s ?? {};
		const name = sd.name || (sd.steamid ? `…${sd.steamid.slice(-5)}` : 'Player');
		const creators = uniqueCreators(sd.credits, sd.steamid, basePath);
		return {
			...sd,
			name,
			profile: is17(sd.steamid) ? `${basePath}/u/${sd.steamid}` : '',
			won: !!sd.won,
			rating: sd.rating ?? null,
			games: sd.games ?? null,
			score: sd.score ?? null,
			credits: sd.credits ?? [],
			creators,
			creditsText: creators.map((c) => c.name).join(', '),
			label: `${seatsKnown ? `Player ${seat}: ` : ''}${name}`
		};
	};
	const modeLabel = m.mode ? (MODE_LABEL[m.mode] ?? m.mode.toUpperCase()) : '';
	const money = m.mode === 'money';
	const recordParts = [modeLabel, m.ft ? `FT${m.ft}` : '', m.game ? `G${m.game}` : ''].filter(Boolean);
	const record = recordParts.length ? `${money ? '🪙 ' : ''}${recordParts.join(' · ')}` : '';
	let date = '';
	if (m.date_ms) {
		const d = new Date(m.date_ms);
		date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
	}
	const duration = m.duration_s ? `${Math.floor(m.duration_s / 60)}:${pad2(m.duration_s % 60)}` : '';
	const wm = (m.watermark ?? 'RETRO RECEIPTS · nobd.net/app/ranks').split(' · ');
	return {
		p1: side(m.p1, 1),
		p2: side(m.p2, 2),
		mode: m.mode ?? '',
		modeLabel,
		money,
		ft: m.ft ?? null,
		game: m.game ?? null,
		record,
		date,
		stageId: m.stage_id ?? null,
		stageText: m.stage_name ? m.stage_name.toUpperCase() : m.stage_id != null ? `STAGE ${m.stage_id}` : '',
		duration,
		seatsKnown,
		limited: !!m.limited,
		saved: !!m.saved,
		watermark: { text: wm[0] ?? '', link: wm.slice(1).join(' · ') },
		ranksHref: `${basePath}/ranks`,
		base: basePath
	};
}

// ── the loader ──────────────────────────────────────────────────────────────────────────────────────────────
export const OVERLAY_TEMPLATE_PATH = '/rr/update/overlay-template.json';
const CACHE_KEY = 'rr.overlay.template.v1';
const TTL_MS = 24 * 3600_000;
const MISS_TTL_MS = 3600_000;
export type TemplateFrom = 'preview' | 'tape' | 'server' | 'builtin' | 'inline';

export function validTemplate(t: unknown): t is OverlayTemplate {
	const o = t as Partial<OverlayTemplate> | null;
	return !!o && o.version === 1 && typeof o.name === 'string' && Array.isArray(o.elements) && !!o.tokens && typeof o.tokens === 'object';
}
async function fetchTemplate(url: string, opts: RequestInit = {}): Promise<OverlayTemplate | null> {
	try {
		const res = await fetch(url, { headers: { accept: 'application/json' }, ...opts });
		if (!res.ok) return null;
		const j = (await res.json()) as unknown;
		return validTemplate(j) ? j : null;
	} catch {
		return null;
	}
}
let serverP: Promise<OverlayTemplate | null> | null = null;
/** the server's template with a 24 h localStorage cache (misses cached 1 h) — one fetch per session */
function serverTemplate(): Promise<OverlayTemplate | null> {
	if (serverP) return serverP;
	serverP = (async () => {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (raw) {
				const c = JSON.parse(raw) as { at: number; tpl: OverlayTemplate | null };
				if (Date.now() - c.at < (c.tpl ? TTL_MS : MISS_TTL_MS)) return validTemplate(c.tpl) ? c.tpl : null;
			}
		} catch {
			/* no storage */
		}
		const tpl = await fetchTemplate(api(OVERLAY_TEMPLATE_PATH));
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tpl }));
		} catch {
			/* no storage */
		}
		return tpl;
	})();
	return serverP;
}
let builtinP: Promise<OverlayTemplate> | null = null;
function builtinTemplate(): Promise<OverlayTemplate> {
	if (!builtinP) builtinP = fetchTemplate(`${base}/replay/overlay/default.json`, { cache: 'force-cache' }).then((t) => t ?? INLINE);
	return builtinP;
}
/** Forget the cached server template (settings / a dev button) */
export function dropOverlayTemplateCache(): void {
	serverP = null;
	try {
		localStorage.removeItem(CACHE_KEY);
	} catch {
		/* no storage */
	}
}
/**
 * Resolve the template to render, in order: `?overlay=<url>` (dev builds or ?dev=1) → the tape's own `overlay.template`
 * → the server's static template (24 h cache) → the built-in default → the inline last resort.
 */
export async function loadOverlayTemplate(tapeUrl?: string | null): Promise<{ tpl: OverlayTemplate; from: TemplateFrom }> {
	if (typeof location !== 'undefined') {
		const q = new URLSearchParams(location.search);
		if (import.meta.env.DEV || q.get('dev') === '1') {
			const preview = q.get('overlay');
			if (preview) {
				const t = await fetchTemplate(preview, { cache: 'no-store' });
				if (t) return { tpl: t, from: 'preview' };
			}
		}
	}
	if (tapeUrl) {
		const t = await fetchTemplate(tapeUrl);
		if (t) return { tpl: t, from: 'tape' };
	}
	const s = await serverTemplate();
	if (s) return { tpl: s, from: 'server' };
	const b = await builtinTemplate();
	return { tpl: b, from: b === INLINE ? 'inline' : 'builtin' };
}

/** the last resort when even the built-in file is unreachable: the two name rows and the watermark, nothing else */
export const INLINE: OverlayTemplate = {
	version: 1,
	name: 'inline-fallback',
	tokens: { ink: '#eef1f8', gold: '#ffb020', wmInk: 'rgba(255,255,255,.7)', wmScrim: 'rgba(0,0,0,.5)' },
	styles: { display: { font: "'Barlow Condensed', Inter, 'Segoe UI', system-ui, sans-serif", size: 12, weight: 900, italic: true, lineHeight: 11, outline: true } },
	elements: [
		{ id: 'p1', class: 'pid p1', role: 'group', label: '{{p1.label}}', anchor: 'top-left', x: 8, y: 1, w: 250, h: 11, layout: 'row', children: [{ kind: 'text', class: 'nm', style: 'display', color: '{{p1.won ? gold : ink}}', content: '{{p1.name}}', href: '{{p1.profile}}' }] },
		{ id: 'p2', class: 'pid p2', role: 'group', label: '{{p2.label}}', anchor: 'top-right', x: 8, y: 1, w: 250, h: 11, layout: 'row', children: [{ kind: 'text', class: 'nm', style: 'display', color: '{{p2.won ? gold : ink}}', content: '{{p2.name}}', href: '{{p2.profile}}' }] },
		{ id: 'wm', class: 'wm', anchor: 'top-center', y: 437, h: 12, layout: 'row', gap: 6, box: { fill: 'wmScrim', radius: 2, padding: [0, 6] }, font: "'JetBrains Mono', ui-monospace, monospace", size: 11, lineHeight: 12, letterSpacing: '0.1em', uppercase: true, color: 'wmInk', children: [{ kind: 'text', content: '{{watermark.text}}', aria: 'hidden' }, { kind: 'text', class: 'sep', content: '·', opacity: 0.5, aria: 'hidden' }, { kind: 'text', content: '{{watermark.link}}', href: '{{ranksHref}}', title: 'The Marvel ladder' }] }
	]
};
