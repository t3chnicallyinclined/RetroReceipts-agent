<script lang="ts">
	import { rankOf, RANK_TIERS, RANK_MIN_GAMES, RK_PLATE } from '$lib/ranks';

	// Rank-progress line under the profile hero — mirrors the old app's rkProgressHtml(). Three states:
	//   • Civilian   → placements countdown, fill = games / RANK_MIN_GAMES
	//   • mid-ladder → "(t.hi - rating) ELO to <NextTier>", fill = position within the current tier band
	//   • Galactus   → the apex line (no next tier)
	// All client-derived from rating + games (never a server rank string). The fill wears the tier plate color
	// so it reads as one unit with the hero plate above it; `pa` overrides to match the hero exactly.
	let {
		rating,
		games,
		pa
	}: { rating: number | null | undefined; games: number; pa?: string } = $props();

	const r = $derived(rankOf(rating, games));
	const rt = $derived(typeof rating === 'number' && isFinite(rating) ? rating : 1000);
	const accent = $derived(pa ?? RK_PLATE[r.s]?.[0] ?? RK_PLATE.civilian[0]);

	// One declarative descriptor so the markup never branches on raw numbers and nothing recomputes per tick.
	const bar = $derived.by(() => {
		const g = Math.max(0, games || 0);
		if (r.n === 'Civilian') {
			const left = Math.max(0, RANK_MIN_GAMES - g);
			return {
				kind: 'placements' as const,
				left,
				pct: Math.round((100 * Math.min(g, RANK_MIN_GAMES)) / RANK_MIN_GAMES)
			};
		}
		const t = r.t;
		if (!t) return { kind: 'apex' as const };
		const next = RANK_TIERS[RANK_TIERS.indexOf(t) + 1];
		if (!next) return { kind: 'apex' as const };
		return {
			kind: 'climb' as const,
			toNext: Math.max(0, t.hi - rt),
			next: next.n,
			nextSlug: next.n.toLowerCase(),
			pct: Math.max(4, Math.min(100, Math.round((100 * (rt - t.lo)) / (t.hi - t.lo))))
		};
	});
</script>

<div class="rp" style="--pa:{accent}">
	{#if bar.kind === 'apex'}
		<div class="line apex">🪐 <b class="rk-galactus">Galactus</b> — Devourer of the ladder</div>
	{:else if bar.kind === 'placements'}
		<div class="line">
			<span class="lbl">🎯 Placements — <b class="num">{bar.left}</b> more game{bar.left === 1 ? '' : 's'} to get ranked</span>
			<span class="track"><i style="width:{bar.pct}%"></i></span>
		</div>
	{:else}
		<div class="line">
			<span class="lbl"><b class="num">{bar.toNext}</b> ELO to <b class="rk-{bar.nextSlug}">{bar.next}</b></span>
			<span class="track"><i style="width:{bar.pct}%"></i></span>
		</div>
	{/if}
</div>

<style>
	.rp {
		margin: 0 0 12px;
	}
	.line {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 10px 13px;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--panel);
	}
	.line.apex {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 800;
		color: var(--dim);
	}
	.lbl {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--dim);
	}
	.lbl .num {
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
	.track {
		height: 8px;
		border-radius: 6px;
		background: var(--panel-2);
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.track i {
		display: block;
		height: 100%;
		border-radius: 6px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--pa) 65%, transparent), var(--pa));
	}
</style>
