<script lang="ts">
	import { BADGE_LEGEND, badgeTitle, collapseBadges, isGold, type Badge } from '$lib/finale/badges';
	import { TIER_COLOR } from '$lib/finale/derive';

	// A row of season badges, strongest first. Each carries its meaning as a tooltip and as visible text on request
	// ("What do these mean?"). On a phone it shows `phone` badges and a "+N" button that opens the rest. Gold marks the
	// champion badge only; every other badge is neutral, the tier badge in its tier colour. Plain text only.
	let { badges, phone = 3, desktop = 6, legend = true }: { badges: Badge[]; phone?: number; desktop?: number; legend?: boolean } = $props();
	let all = $state(false);
	let wide = $state(typeof matchMedia === 'undefined' ? true : matchMedia('(min-width: 720px)').matches);
	$effect(() => {
		if (typeof matchMedia === 'undefined') return;
		const mq = matchMedia('(min-width: 720px)');
		const f = () => (wide = mq.matches);
		mq.addEventListener('change', f);
		return () => mq.removeEventListener('change', f);
	});
	const view = $derived(all ? { shown: badges, more: 0 } : collapseBadges(badges, wide ? desktop : phone));
	let showLegend = $state(false);
	const kinds = $derived([...new Set(badges.map((b) => b.kind))]);
</script>

{#if badges.length}
	<div class="brow">
		<ul class="bl" aria-label="Season badges">
			{#each view.shown as b (b.season + b.kind + b.label)}
				<li class="bd" class:gold={isGold(b)} class:tier={b.kind === 'tier'} style={b.kind === 'tier' ? `--tc:${TIER_COLOR[b.label.toLowerCase()] ?? 'var(--dim)'}` : undefined} title={badgeTitle(b)}>{b.label}</li>
			{/each}
			{#if view.more > 0}<li><button type="button" class="more" aria-label="Show {view.more} more badges" onclick={() => (all = true)}>+{view.more}</button></li>{/if}
		</ul>
		{#if legend}
			<button type="button" class="lg" aria-expanded={showLegend} onclick={() => (showLegend = !showLegend)}>{showLegend ? 'Hide' : 'What do these mean?'}</button>
			{#if showLegend}<ul class="lgd">{#each kinds as k (k)}<li>{BADGE_LEGEND[k]}</li>{/each}</ul>{/if}
		{/if}
	</div>
{/if}

<style>
	.brow {
		display: grid;
		gap: 6px;
		justify-items: start;
		min-width: 0;
	}
	.bl {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.bd,
	.more {
		font: inherit;
		font-size: 11.5px;
		font-weight: 800;
		line-height: 1.2;
		padding: 5px 10px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.bd.tier {
		border-color: var(--tc);
		color: var(--tc);
		background: transparent;
	}
	.bd.gold {
		border-color: var(--gold);
		background: var(--gold-soft);
		color: var(--ink);
	}
	.more {
		cursor: pointer;
		min-height: 28px;
	}
	.lg {
		font: inherit;
		font-size: 12px;
		color: var(--dim);
		background: none;
		border: 0;
		padding: 4px 0;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.lgd {
		margin: 0;
		padding-left: 18px;
		font-size: 12px;
		color: var(--dim);
		display: grid;
		gap: 2px;
	}
	.more:focus-visible,
	.lg:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: 2px;
	}
</style>
