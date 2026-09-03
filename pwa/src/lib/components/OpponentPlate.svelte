<script lang="ts">
	import PlayerPlate from './PlayerPlate.svelte';
	import { winrateColor } from '$lib/ranks';

	// ⬢ OPPONENTPLATE — the small VS (LIVE-TAB-SPEC §3). One identity unit for the person you are playing:
	// PlayerPlate (alias · flag · tier · rating · badge) + the a.k.a. line (durable name history off their
	// SteamID) + the H2H line (counted games, win-rate colored by the data-viz ramp — permitted on percentage
	// readouts only, DESIGN-SYSTEM.md charter). Leaf component: it owns NO fetches — MyMatch passes what it
	// already resolves (feed name map, /rr/profile aliases, /rr/matchup h2h).
	let {
		steamid = '',
		name = '',
		aliases = [],
		avatar = '',
		cc = '',
		rating = null,
		games = null,
		h2h = null,
		link = true
	}: {
		steamid?: string;
		name?: string;
		/** name history, current name excluded (Profile.aliases) — up to 2 inline, the rest on title */
		aliases?: string[];
		avatar?: string;
		cc?: string;
		rating?: number | null;
		games?: number | null;
		/** counted head-to-head from /rr/matchup; null = not resolved yet; {0,0} = first meeting */
		h2h?: { wins: number; losses: number } | null;
		link?: boolean;
	} = $props();

	const akaShown = $derived(aliases.slice(0, 2));
	const akaAll = $derived(aliases.join(' · '));
	const w = $derived(h2h?.wins ?? 0);
	const l = $derived(h2h?.losses ?? 0);
	const met = $derived(w + l > 0);
	const pct = $derived(met ? Math.round((100 * w) / (w + l)) : 0);
</script>

<span class="op">
	<span class="extra">
		{#if akaShown.length}
			<span class="aka" title={akaAll}>a.k.a. {akaShown.join(' · ')}{#if aliases.length > 2} <span class="more">+{aliases.length - 2}</span>{/if}</span>
		{/if}
		{#if h2h}
			{#if met}
				<span class="rec" title="Counted (ranked) games against them">
					<span class="lbl">YOU</span> <b class="w">{w}</b><span class="d">–</span><b>{l}</b> <span class="lbl">THEM</span>
					<span class="bar" aria-hidden="true"><i style="width:{pct}%;background:{winrateColor(pct)}"></i></span>
					<span class="wr" style="color:{winrateColor(pct)}">{pct}%</span>
				</span>
			{:else}
				<span class="rec first">first meeting</span>
			{/if}
		{/if}
	</span>
	<PlayerPlate {steamid} {name} {avatar} {cc} {rating} {games} density="plate" align="right" {link} />
</span>

<style>
	.op {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		min-width: 0;
	}
	.extra {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		min-width: 0;
		text-align: right;
	}
	.aka {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		color: var(--faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.aka .more {
		opacity: 0.7;
	}
	.rec {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--dim);
		white-space: nowrap;
	}
	.rec .lbl {
		opacity: 0.7;
		font-size: 9.5px;
		letter-spacing: 0.06em;
	}
	.rec b {
		color: var(--ink);
		font-weight: 800;
	}
	.rec .w {
		color: var(--good);
	}
	.rec .d {
		opacity: 0.45;
	}
	.rec.first {
		font-style: italic;
		color: var(--faint);
	}
	.bar {
		width: 52px;
		height: 5px;
		border-radius: 99px;
		background: var(--panel-2);
		overflow: hidden;
		display: inline-block;
		margin-left: 4px;
	}
	.bar i {
		display: block;
		height: 100%;
	}
	.wr {
		font-weight: 800;
		font-size: 11px;
	}
	@media (max-width: 560px) {
		.bar {
			display: none;
		}
	}
</style>
