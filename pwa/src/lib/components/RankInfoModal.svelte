<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { RANK_TIERS, RANK_MIN_GAMES, RANK_LORE, rankRange, RK_TEXT } from '$lib/ranks';
	import RankBadge from './RankBadge.svelte';

	// Rank-info modal — the Marvel-ladder explainer (ports web/index.html openRankInfo). Opened by tapping a
	// tier in TierLadder (or any rank badge wired to it). Shows a hero for the focused tier (badge + name +
	// ELO range + lore), the full ladder with the focused tier highlighted and the viewer's own tier tagged
	// YOU, then "how the rating works". Ladder rows are tappable so the modal is an explorable legend — `sel`
	// (seeded from the tapped slug) drives the hero.
	let {
		slug,
		mySlug = null,
		onClose
	}: { slug: string; mySlug?: string | null; onClose: () => void } = $props();

	// Seeds the focused tier from the tapped one, then user-driven. Intentional initial-value capture — the
	// modal remounts per open ({#if openTier}), so each open re-seeds; slug never changes within one instance.
	// svelte-ignore state_referenced_locally
	let sel = $state(slug);

	// Full ladder rows: apex-first tiers + a Civilian row. `rating` = tier floor so RankBadge derives the
	// exact badge (Galactus floor = 1500; Civilian uses games<MIN → the civilian sprite).
	const rows = $derived.by(() => {
		const list = RANK_TIERS.slice()
			.reverse()
			.map((t) => ({
				slug: t.n.toLowerCase(),
				name: t.n,
				range: rankRange(t),
				lore: RANK_LORE[t.n.toLowerCase()] ?? '',
				rating: t.hi === Infinity ? 1500 : t.lo,
				games: null as number | null
			}));
		list.push({
			slug: 'civilian',
			name: 'Civilian',
			range: `< ${RANK_MIN_GAMES} games`,
			lore: RANK_LORE.civilian,
			rating: 1000,
			games: 0
		});
		return list;
	});
	const focus = $derived(rows.find((r) => r.slug === sel) ?? rows[0]);
	const acc = $derived(RK_TEXT[focus.slug] ?? 'var(--dim)');

	// ── focus management + body scroll lock (verbatim from SessionModal) ──
	let dlg = $state<HTMLDivElement | null>(null);
	let closeBtn = $state<HTMLButtonElement | null>(null);
	onMount(() => {
		const prev = document.activeElement as HTMLElement | null;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		void tick().then(() => closeBtn?.focus());
		return () => {
			document.body.style.overflow = prevOverflow;
			prev?.focus?.();
		};
	});
	function focusables(): HTMLElement[] {
		if (!dlg) return [];
		return Array.from(
			dlg.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
		).filter((el) => el.offsetParent !== null);
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			return;
		}
		if (e.key !== 'Tab') return;
		const f = focusables();
		if (!f.length) return;
		const first = f[0];
		const last = f[f.length - 1];
		const activeEl = document.activeElement as HTMLElement | null;
		if (e.shiftKey && activeEl === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && activeEl === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<!-- backdrop closes only on a click landing on the overlay itself (not the dialog) -->
<div
	class="ovl"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	onkeydown={onKeydown}
>
	<div class="dlg" bind:this={dlg} role="dialog" aria-modal="true" aria-label="The Marvel ladder" tabindex="-1">
		<header class="dhd">
			<span class="rail">Rank</span>
			<button class="x" bind:this={closeBtn} onclick={onClose} aria-label="Close">✕</button>
		</header>

		<!-- HERO: the focused tier — badge + name + ELO range + lore -->
		<div class="hero" style="--acc:{acc}">
			<RankBadge rating={focus.rating} games={focus.games} size={46} />
			<div class="hcol">
				<div class="htop">
					<b class="hname rk-{focus.slug}">{focus.name}</b>
					<span class="hrange">{focus.range}{focus.slug === 'civilian' ? '' : ' ELO'}</span>
				</div>
				{#if focus.lore}<p class="hlore">{focus.lore}</p>{/if}
			</div>
		</div>

		<div class="scroll">
			<p class="intro">
				Nine tiers that climb Marvel’s own hierarchy — the metals, then the legendary metals, then cosmic
				power. Your rank is attached to your <b>SteamID</b> and follows you everywhere: leaderboards,
				profiles, tournaments, and live matches.
			</p>

			<div class="rail sec">The ladder</div>
			<ol class="ladder">
				{#each rows as t (t.slug)}
					<li>
						<button class="lrow" class:on={t.slug === sel} onclick={() => (sel = t.slug)} title="{t.name} · {t.range}">
							<RankBadge rating={t.rating} games={t.games} size={22} />
							<span class="lname rk-{t.slug}">{t.name}</span>
							{#if t.slug === mySlug}<span class="lyou">YOU</span>{/if}
							<span class="lrange">{t.range}</span>
						</button>
					</li>
				{/each}
			</ol>

			<div class="rail sec">How the rating works</div>
			<p class="explain">
				Every ranked game moves ELO between you and your opponent — win and you take points, lose and you
				give them up (zero-sum, K=32). Everyone starts at <b>1000</b>, mid-Silver. Beating a higher-rated
				player pays more; farming lower-rated players pays almost nothing. Your first {RANK_MIN_GAMES} games
				are placements: you’re a Civilian until they’re done, and Civilians don’t appear on the Ranked
				board. There’s no rating cap — Galactus (1500+) has to be taken, not given.
			</p>
		</div>
	</div>
</div>

<style>
	.ovl {
		position: fixed;
		inset: 0;
		z-index: 100; /* above the fixed TabBar (z-40) */
		display: flex;
		align-items: center;
		justify-content: center;
		padding: max(16px, env(safe-area-inset-top)) 14px calc(16px + env(safe-area-inset-bottom));
		background: color-mix(in srgb, #05070c 72%, transparent);
		backdrop-filter: blur(3px);
	}
	.dlg {
		position: relative;
		width: 100%;
		max-width: 480px;
		max-height: min(86vh, 860px);
		max-height: min(86dvh, 860px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 16px;
		box-shadow: var(--shadow);
	}
	.dhd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--line);
	}
	.rail {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.x {
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--dim);
		font-size: 13px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.x:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}

	/* HERO — focused tier; accent seam + badge, matches the arena plate register without stealing gold */
	.hero {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 18px 16px;
		border-bottom: 1px solid var(--line-soft);
		background: linear-gradient(120deg, color-mix(in srgb, var(--acc) 14%, transparent), transparent 70%),
			var(--panel-2);
		border-top: 3px solid var(--acc);
	}
	.hcol {
		min-width: 0;
	}
	.htop {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}
	.hname {
		font-size: 20px;
		font-weight: 900;
		font-style: italic;
	}
	.hrange {
		font-size: 12.5px;
		font-weight: 800;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.hlore {
		margin: 5px 0 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--dim);
	}

	.scroll {
		padding: 6px 0 14px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.intro {
		margin: 10px 0 4px;
		padding: 0 16px;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--dim);
	}
	.intro b {
		color: var(--ink);
	}
	.sec {
		padding: 14px 16px 6px;
	}
	.ladder {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lrow {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 16px;
		border: 0;
		background: transparent;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		border-left: 2px solid transparent;
		transition: background 0.15s, border-color 0.15s;
	}
	.lrow:hover {
		background: var(--panel-2);
	}
	.lrow.on {
		background: var(--panel-2);
		border-left-color: var(--gold-soft);
	}
	.lname {
		font-weight: 800;
		font-size: 13.5px;
		font-style: italic;
	}
	.lyou {
		font-size: 8.5px;
		font-weight: 900;
		letter-spacing: 0.1em;
		color: var(--gold);
	}
	.lrange {
		margin-left: auto;
		font-size: 12px;
		font-weight: 700;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.explain {
		margin: 6px 0 0;
		padding: 0 16px;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--dim);
	}
	.explain b {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
</style>
