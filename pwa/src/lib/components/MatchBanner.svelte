<script lang="ts">
	import PlayerPlate from './PlayerPlate.svelte';
	import CharSprite from './CharSprite.svelte';
	import { charTag } from '$lib/chars';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { timeAgo } from '$lib/format';

	// ⬛ MATCHBANNER — the Arena Card System's atom: a finished match, ANYWHERE results are listed.
	// Zone map (frozen): [chip A][team A][plate A] — [VS axis] — [plate B][team B][chip B] — [meta rail].
	// Density and POV vary; the structure never does. Charter: outcome = two-channel chips (losses never
	// red), winner's name gold, teams as sprites wearing the owners' skins, flair molten, trust gold,
	// the whole banner is the tap target to its receipt/set.
	export interface BannerSide {
		steamid?: string;
		name?: string;
		avatar?: string;
		cc?: string;
		rating?: number | null;
		games?: number | null;
		team?: number[] | null;
	}
	let {
		a,
		b,
		winner = null,
		mode = '',
		ts = 0,
		delta = null,
		ocv = false,
		perfect = false,
		comeback = false,
		verified = false,
		confirmed = false,
		dur = null,
		gameNo = null,
		onOpen = null
	}: {
		/** side A — the POV player on POV surfaces (profile: the viewed player) */
		a: BannerSide;
		b: BannerSide;
		winner?: 'a' | 'b' | null;
		mode?: string;
		ts?: number;
		/** rating delta from side A's perspective (signed) */
		delta?: number | null;
		ocv?: boolean;
		perfect?: boolean;
		comeback?: boolean;
		verified?: boolean;
		confirmed?: boolean;
		/** match length in seconds (tape-derived) — renders m:ss in the meta rail */
		dur?: number | null;
		/** receipt density: game number replaces the timestamp */
		gameNo?: number | null;
		onOpen?: (() => void) | null;
	} = $props();

	const MODE_LABEL: Record<string, string> = { ranked: 'RANKED', lobby: 'LOBBY', money: 'MONEY', tourney: 'TOURNEY', tournament: 'TOURNEY' };
	const modeLabel = $derived(MODE_LABEL[mode] ?? (mode ? mode.toUpperCase() : ''));
	const loA = $derived(a.team?.length ? loadouts.peek(a.steamid ?? '') : null);
	const loB = $derived(b.team?.length ? loadouts.peek(b.steamid ?? '') : null);
	// flair reads from the WINNER's side (an OCV is performed by the winner): A's seat sees OCV or OCV'D
	const flairWon = $derived(winner === 'a');
	const flair = $derived(
		ocv ? (flairWon ? 'OCV' : "OCV'D") : perfect ? (flairWon ? 'PERFECT' : "PERF'D") : comeback ? (flairWon ? 'COMEBACK' : 'REVERSED') : ''
	);
</script>

<svelte:element
	this={onOpen ? 'button' : 'div'}
	class="mb"
	class:won={winner === 'a'}
	class:tappable={!!onOpen}
	onclick={onOpen ?? undefined}
	type={onOpen ? 'button' : undefined}
	role={onOpen ? 'button' : undefined}
>
	<span class="wl ca" class:w={winner === 'a'}>{winner === 'a' ? 'W' : 'L'}</span>
	<span class="side sa">
		{#if a.team?.length}
			<span class="team">
				{#each a.team.slice(0, 3) as id, i (i)}
					<span class="chip" title={charTag(id)}><CharSprite {id} still palette={loA?.[id] ?? null} alt={charTag(id)} /></span>
				{/each}
			</span>
		{/if}
		<PlayerPlate steamid={a.steamid} name={a.name} avatar={a.avatar} cc={a.cc} rating={a.rating} games={a.games} density="plate" won={winner === 'a'} link={!onOpen} />
	</span>
	<span class="vsm" aria-hidden="true">VS</span>
	<span class="side r sb">
		{#if b.team?.length}
			<span class="team">
				{#each b.team.slice(0, 3) as id, i (i)}
					<span class="chip" title={charTag(id)}><CharSprite {id} still palette={loB?.[id] ?? null} alt={charTag(id)} /></span>
				{/each}
			</span>
		{/if}
		<PlayerPlate steamid={b.steamid} name={b.name} avatar={b.avatar} cc={b.cc} rating={b.rating} games={b.games} density="plate" won={winner === 'b'} align="right" link={!onOpen} />
	</span>
	<span class="wl cb" class:w={winner === 'b'}>{winner === 'b' ? 'W' : 'L'}</span>
	<span class="meta">
		<span class="r1">
			{#if modeLabel}<span class="mode" class:money={mode === 'money'} class:tourney={modeLabel === 'TOURNEY'}>{mode === 'money' ? '🪙 ' : ''}{modeLabel}</span>{/if}
			{#if flair}<span class="fl" class:mine={flairWon}>{flair}</span>{/if}
			{#if verified}<span class="seal" title="Verified by both agents">✓✓</span>
			{:else if confirmed}<span class="seal" title="Confirmed by both players">✓</span>{/if}
		</span>
		<span class="r2">
			{#if delta != null && delta !== 0}<span class="delta" class:neg={delta < 0}>{delta > 0 ? '+' : ''}{delta}</span>{/if}
			{#if dur}<span>{Math.floor(dur / 60)}:{String(dur % 60).padStart(2, '0')}</span>{/if}{#if gameNo != null}<span>G{gameNo}</span>{:else if ts}<span>{timeAgo(ts)}</span>{/if}
			<span class="chev">›</span>
		</span>
	</span>
</svelte:element>

<style>
	.mb {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 40px minmax(0, 1fr) 24px 128px;
		align-items: center;
		gap: 9px;
		width: 100%;
		background: var(--panel);
		border: 1px solid var(--line);
		border-left: 3px solid var(--line);
		border-radius: 10px;
		padding: 9px 12px;
		font: inherit;
		color: inherit;
		text-align: left;
	}
	.mb.tappable {
		cursor: pointer;
	}
	.mb.tappable:hover {
		border-color: color-mix(in srgb, var(--gold) 35%, var(--line));
	}
	/* the win treatment: accent edge + a wash from the POV side. Losses stay quiet — never red. */
	.mb.won {
		border-left-color: var(--good);
		background: linear-gradient(90deg, color-mix(in srgb, var(--good) 8%, transparent), transparent 45%), var(--panel);
	}
	/* two-channel outcome chip: fill + hue for W, hollow + dim for L */
	.wl {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 5px;
		font-style: italic;
		font-weight: 900;
		font-size: 12px;
		border: 1.5px solid var(--line);
		color: var(--dim);
	}
	.wl.w {
		background: var(--good);
		border-color: var(--good);
		color: #06281a;
	}
	.side {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}
	.side.r {
		flex-direction: row-reverse;
	}
	.team {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		flex: none;
	}
	.chip {
		display: block;
		width: 48px;
		height: 48px;
	}
	.vsm {
		justify-self: center;
		font-style: italic;
		font-weight: 900;
		font-size: 14px;
		letter-spacing: -0.03em;
		transform: skewX(-8deg);
		background: linear-gradient(175deg, #fff3c0 20%, var(--gold) 45%, #a3670a 80%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		filter: drop-shadow(0 2px 6px rgba(232, 185, 60, 0.25));
		user-select: none;
	}
	.meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		color: var(--faint);
	}
	.r1,
	.r2 {
		display: flex;
		gap: 6px;
		align-items: center;
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
	.fl {
		font-size: 8px;
		letter-spacing: 0.1em;
		padding: 1px 6px;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--molten) 45%, var(--line));
		color: color-mix(in srgb, var(--molten) 60%, var(--faint));
	}
	.fl.mine {
		color: var(--molten);
	}
	.seal {
		color: var(--gold);
		font-size: 9px;
		letter-spacing: 0.06em;
	}
	.delta {
		color: var(--good);
		font-weight: 600;
	}
	.delta.neg {
		color: var(--dim);
	}
	.chev {
		color: var(--faint);
	}
	/* mobile: fold at the VS axis — explicit grid areas; zone order preserved, never re-laid-out */
	@media (max-width: 640px) {
		.mb {
			grid-template-columns: 20px minmax(0, 1fr) 84px;
			grid-template-areas:
				'ca sa meta'
				'cb sb meta';
			row-gap: 6px;
		}
		.vsm {
			display: none;
		}
		.wl {
			width: 18px;
			height: 18px;
			font-size: 10px;
		}
		.ca {
			grid-area: ca;
		}
		.cb {
			grid-area: cb;
		}
		.sa {
			grid-area: sa;
		}
		.sb {
			grid-area: sb;
		}
		.meta {
			grid-area: meta;
		}
		.chip {
			width: 36px;
			height: 36px;
		}
	}
</style>
