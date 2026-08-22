<script lang="ts">
	import { RANK_TIERS, RANK_MIN_GAMES, rankRange } from '$lib/ranks';
	import RankBadge from './RankBadge.svelte';

	// The Marvel Ladder — a compact, always-visible legend on the Ranks page. Descending (Galactus → Iron)
	// so it reads the same direction as the ranked board above it. Each row taps through to the rank-info
	// modal. The viewer's own tier is gold-inset (mirrors the board .me row). Pure client-derived from
	// RANK_TIERS — nothing rebuilds on a data tick.
	let { mySlug = null, onOpen }: { mySlug?: string | null; onOpen: (slug: string) => void } = $props();

	// `rating` = the tier floor so RankBadge derives the exact tier badge (tierOf(floor) === this tier).
	const tiers = $derived(
		RANK_TIERS.slice()
			.reverse()
			.map((t) => ({
				slug: t.n.toLowerCase(),
				name: t.n,
				range: rankRange(t),
				rating: t.hi === Infinity ? 1500 : t.lo
			}))
	);
</script>

<section class="tl" aria-label="The Marvel ladder">
	<div class="tl-head">
		<span class="rail">The Marvel Ladder</span>
		<span class="rail hint">Tap a tier</span>
	</div>
	<ol class="tl-list">
		{#each tiers as t (t.slug)}
			<li>
				<button
					class="tl-row"
					class:mine={t.slug === mySlug}
					onclick={() => onOpen(t.slug)}
					title="{t.name} · {t.range} ELO — what this rank means"
				>
					<RankBadge rating={t.rating} games={null} size={22} />
					<span class="tl-name rk-{t.slug}">{t.name}</span>
					{#if t.slug === mySlug}<span class="tl-you">YOU</span>{/if}
					<span class="tl-range">{t.range}</span>
				</button>
			</li>
		{/each}
	</ol>
	<p class="tl-foot">
		Civilian — your first {RANK_MIN_GAMES} games are placements before you join the ladder.
	</p>
</section>

<style>
	.tl {
		margin-top: 14px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
	}
	.tl-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 0 14px;
		height: 32px;
		border-bottom: 1px solid var(--line);
	}
	.rail {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.rail.hint {
		letter-spacing: 0.1em;
		opacity: 0.75;
	}
	.tl-list {
		list-style: none;
		margin: 0;
		padding: 4px 0;
	}
	.tl-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 14px;
		border: 0;
		background: transparent;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		border-left: 2px solid transparent;
		transition: background 0.15s, border-color 0.15s;
	}
	.tl-row:hover {
		background: var(--panel-2);
		border-left-color: var(--gold-soft);
	}
	/* the viewer's own tier — gold inset, echoing the board .me row */
	.tl-row.mine {
		border-left-color: var(--gold);
		background: linear-gradient(90deg, var(--gold-soft), transparent 60%);
	}
	.tl-name {
		font-weight: 800;
		font-size: 13.5px;
		font-style: italic;
	}
	.tl-you {
		font-size: 8.5px;
		font-weight: 900;
		letter-spacing: 0.1em;
		color: var(--gold);
	}
	.tl-range {
		margin-left: auto;
		font-size: 12px;
		font-weight: 700;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tl-foot {
		margin: 0;
		padding: 8px 14px 12px;
		border-top: 1px solid var(--line-soft);
		font-size: 11px;
		color: var(--faint);
	}
</style>
