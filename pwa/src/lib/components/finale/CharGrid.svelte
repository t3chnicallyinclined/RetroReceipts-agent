<script lang="ts">
	import CharSprite from '$lib/components/CharSprite.svelte';
	import { charName } from '$lib/chars';
	import { shareText } from '$lib/finale/derive';
	import type { Highlights } from '$lib/finale/highlights';

	// All characters by pick rate. No win rate, ever. The detail panel sits ABOVE the grid so it stays in view on a
	// phone. Sprite art is CharSprite (a fitted three-letter code when the art is missing).
	let { chars }: { chars: Highlights['chars'] } = $props();
	let order = $state<'pick' | 'az'>('pick');
	let sel = $state<number | null>(null);
	const ranked = $derived(chars.map((c, i) => ({ ...c, rank: i + 1 })));
	const list = $derived(order === 'az' ? [...ranked].sort((a, b) => charName(a.charId).localeCompare(charName(b.charId))) : ranked);
	const cur = $derived(ranked.find((c) => c.charId === sel) ?? ranked[0]);
	const max = $derived(Math.max(0.1, ...ranked.map((c) => c.share)));
	const low = (s: number) => s < 0.05;
</script>

<div class="chd">
	<span class="rail">Pick rate, all {chars.length} characters</span>
	<div class="seg" role="group" aria-label="Order">
		<button type="button" aria-pressed={order === 'pick'} onclick={() => (order = 'pick')}>Most picked</button>
		<button type="button" aria-pressed={order === 'az'} onclick={() => (order = 'az')}>A to Z</button>
	</div>
</div>
{#if cur}
	<div class="cdet card" aria-live="polite">
		<span class="port"><CharSprite id={cur.charId} still /></span>
		<span class="cdt">
			<span class="cn">{charName(cur.charId)}</span>
			<span class="tr" aria-hidden="true"><i class="fl" style="--w:{low(cur.share) ? 0 : (100 * cur.share) / max}%"></i></span>
			<span class="cs">
				{#if low(cur.share)}Played this season, on fewer than 1 in 1,000 ranked teams.{:else}On <b>{shareText(cur.share)}</b> of ranked teams.{/if}
				{#if cur.players} Played by <b>{cur.players.toLocaleString('en-US')}</b> players.{/if}
				Number {cur.rank} of {chars.length} by picks.
			</span>
		</span>
	</div>
{/if}
<div class="cgrid" role="group" aria-label="Characters">
	{#each list as c (c.charId)}
		<button type="button" class="cc2" style="--m:{low(c.share) ? 0 : (100 * c.share) / max}%" aria-pressed={cur?.charId === c.charId} aria-label="{charName(c.charId)}, {shareText(c.share)} of ranked teams" onclick={() => (sel = c.charId)}>
			<span class="csp"><CharSprite id={c.charId} still /></span>
			<span class="ps">{shareText(c.share)}</span>
		</button>
	{/each}
</div>
