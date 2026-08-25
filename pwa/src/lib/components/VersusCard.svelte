<script lang="ts">
	import PlayerPlate from './PlayerPlate.svelte';
	import CharSprite from './CharSprite.svelte';
	import { charTag } from '$lib/chars';
	import { loadouts } from '$lib/stores/loadouts.svelte';

	// 🟢 VERSUSCARD — a live pairing: a MatchBanner in the future tense. Same zone map
	// ([side A][center axis][side B][meta]) so the eventual settle reads as the same object becoming a
	// record. States are data-driven: no picks yet → PAIRED (silhouette slots, CHARACTER SELECT); picks
	// locked → IN-GAME (LIVE dot, set score center-stage). Charter: match liveness = --live broadcast dot
	// (a PERSON online is green; a MATCH on air is red); spectate rides --stream; stake/money rides gold.
	let {
		a,
		b,
		names = {},
		ratings = {},
		wins = {},
		chars = {},
		mode = '',
		joinLink = '',
		mine = false,
		onOpen = null
	}: {
		a: string;
		b: string;
		names?: Record<string, string>;
		ratings?: Record<string, number>;
		wins?: Record<string, number>;
		chars?: Record<string, number[]>;
		mode?: string;
		joinLink?: string;
		mine?: boolean;
		onOpen?: (() => void) | null;
	} = $props();

	const MODE_LABEL: Record<string, string> = { ranked: 'RANKED', lobby: 'LOBBY', money: 'MONEY', tourney: 'TOURNEY', tournament: 'TOURNEY' };
	const modeLabel = $derived(MODE_LABEL[mode] ?? (mode ? mode.toUpperCase() : ''));
	const teamA = $derived(chars[a] ?? []);
	const teamB = $derived(chars[b] ?? []);
	const loA = $derived(teamA.length ? loadouts.peek(a) : null);
	const loB = $derived(teamB.length ? loadouts.peek(b) : null);
	const wA = $derived(wins[a] ?? 0);
	const wB = $derived(wins[b] ?? 0);
	const picking = $derived(!teamA.length && !teamB.length);
	const scored = $derived(wA + wB > 0);
</script>

<svelte:element
	this={onOpen ? 'button' : 'div'}
	class="vc"
	class:mine
	class:tappable={!!onOpen}
	onclick={onOpen ?? undefined}
	type={onOpen ? 'button' : undefined}
	role={onOpen ? 'button' : undefined}
>
	<span class="metarail">
		{#if modeLabel}<span class="mode" class:money={mode === 'money'} class:tourney={modeLabel === 'TOURNEY'}>{mode === 'money' ? '🪙 ' : ''}{modeLabel}</span>{/if}
		<span class="ld" aria-hidden="true"></span><span class="livew">LIVE</span>
		{#if joinLink}<a class="spec" href={joinLink} onclick={(e) => e.stopPropagation()}>▶ SPECTATE</a>{/if}
	</span>

	<span class="plate">
		<PlayerPlate steamid={a} name={names[a]} rating={ratings[a] ?? null} density="plate" link={!onOpen} />
		{#if teamA.length}
			<span class="team">{#each teamA.slice(0, 3) as id, i (i)}<span class="chip" title={charTag(id)}><CharSprite {id} still palette={loA?.[id] ?? null} alt={charTag(id)} /></span>{/each}</span>
		{:else}
			<span class="team">{#each [0, 1, 2] as i (i)}<span class="sil"></span>{/each}</span>
		{/if}
	</span>

	<span class="center">
		{#if scored}<span class="setscore">{wA} – {wB}</span>{/if}
		<span class="vsm" class:small={scored}>VS</span>
		<span class="state">{picking ? 'CHARACTER SELECT' : scored ? `GAME ${wA + wB + 1}` : 'FIGHT'}</span>
	</span>

	<span class="plate r">
		<PlayerPlate steamid={b} name={names[b]} rating={ratings[b] ?? null} density="plate" align="right" link={!onOpen} />
		{#if teamB.length}
			<span class="team r">{#each teamB.slice(0, 3) as id, i (i)}<span class="chip" title={charTag(id)}><CharSprite {id} still palette={loB?.[id] ?? null} alt={charTag(id)} /></span>{/each}</span>
		{:else}
			<span class="team r">{#each [0, 1, 2] as i (i)}<span class="sil"></span>{/each}</span>
		{/if}
	</span>
</svelte:element>

<style>
	.vc {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 12px;
		width: 100%;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 26px 16px 12px;
		font: inherit;
		color: inherit;
		text-align: left;
	}
	.vc.tappable {
		cursor: pointer;
	}
	.vc.tappable:hover {
		border-color: color-mix(in srgb, var(--gold) 35%, var(--line));
	}
	.vc.mine {
		box-shadow: 0 0 0 1.5px var(--gold) inset;
		background: linear-gradient(90deg, color-mix(in srgb, var(--gold) 7%, transparent), transparent 45%), var(--panel);
	}
	.metarail {
		position: absolute;
		top: 8px;
		right: 12px;
		display: flex;
		gap: 8px;
		align-items: center;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		color: var(--faint);
	}
	.mode {
		font-size: 8.5px;
		letter-spacing: 0.12em;
		padding: 1px 6px;
		border-radius: 5px;
		border: 1px solid var(--line);
		color: var(--dim);
	}
	.mode.money {
		border-color: color-mix(in srgb, var(--gold) 55%, var(--line));
		color: var(--gold);
	}
	.mode.tourney {
		border-color: color-mix(in srgb, var(--stream) 45%, var(--line));
		color: var(--stream);
	}
	/* charter: a MATCH on air is the red broadcast dot */
	.ld {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--live);
		box-shadow: 0 0 7px var(--live);
		animation: pulse 1.8s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.ld {
			animation: none;
		}
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}
	.livew {
		color: var(--live);
		letter-spacing: 0.12em;
	}
	.spec {
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--stream);
		border: 1px solid color-mix(in srgb, var(--stream) 45%, var(--line));
		border-radius: 6px;
		padding: 2px 8px;
		text-decoration: none;
	}
	.spec:hover {
		border-color: var(--stream);
	}
	.plate {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
	}
	.plate.r {
		align-items: flex-end;
	}
	.team {
		display: flex;
		align-items: flex-end;
		gap: 3px;
	}
	.team.r {
		flex-direction: row-reverse;
	}
	.chip {
		display: block;
		width: 48px;
		height: 48px;
	}
	.sil {
		width: 40px;
		height: 40px;
		border: 1.5px dashed var(--line);
		border-radius: 8px;
	}
	.center {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.setscore {
		font-style: italic;
		font-weight: 900;
		font-size: 24px;
		letter-spacing: 0.02em;
		color: var(--gold);
		line-height: 1;
	}
	.vsm {
		font-style: italic;
		font-weight: 900;
		font-size: 26px;
		letter-spacing: -0.03em;
		transform: skewX(-8deg);
		background: linear-gradient(175deg, #fff3c0 20%, var(--gold) 45%, #a3670a 80%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		filter: drop-shadow(0 2px 7px rgba(232, 185, 60, 0.28));
		user-select: none;
		line-height: 1;
	}
	.vsm.small {
		font-size: 15px;
	}
	.state {
		font-family: ui-monospace, monospace;
		font-size: 8px;
		letter-spacing: 0.18em;
		color: var(--dim);
		margin-top: 2px;
	}
	@media (max-width: 640px) {
		.chip {
			width: 38px;
			height: 38px;
		}
		.sil {
			width: 32px;
			height: 32px;
		}
		.vc {
			gap: 8px;
		}
	}
</style>
