<script lang="ts" module>
	/** One credited skin on a wearer's character — the loadout's provenance (REPLAY-OVERLAY-SPEC §4.1, C13).
	 *  Today the loadout payload is `{cid, colors}` only, so every consumer passes an EMPTY list; the shape is
	 *  the spec's so the server can fill it without a PWA change. */
	export interface Credit {
		cid: number;
		/** SavedSkin.name at equip time — quoted in the line */
		name: string;
		/** the vault owner of the skin (a 17-digit SteamID) → the by-line links to their profile */
		author_steamid?: string;
		/** the name we hold when there is no SteamID (share code / community library) → plain text by-line */
		author_name?: string;
		/** the wearer made it (author_steamid === wearer): name only, no by-line (§3.4, Q1) */
		own?: boolean;
	}
</script>

<script lang="ts">
	import { base } from '$app/paths';
	import { charTag } from '$lib/chars';
	import CharSprite from './CharSprite.svelte';

	// ⬢ SKINCREDIT — suffix **Credit** (DESIGN-SYSTEM.md, REPLAY-OVERLAY-SPEC §3 + §8.1): ONE line of attribution,
	// `STORM · "NIGHTFALL" by Ruby`. Leaf, owns no fetches. Consumed by the replay overlay (Phase A, fed an
	// empty list until C13 ships provenance); later the rack, the locker and the profile (§3.5).
	// Rules (§3.2): stock = the CALLER renders nothing · own design = the name, no by-line · author with a
	// SteamID = linked name · author known only by name = plain text. Never an `@` (the app has no handles).
	// Truncation (§3.1): the skin name ellipses at 14ch; the author is never dropped — the author is the point.
	let {
		credit,
		form = 'line',
		align = 'left',
		palette = null
	}: {
		credit: Credit;
		/** line = `STORM · "NIGHTFALL" by Ruby` · icon = `[16 px sprite] "NIGHTFALL" by Ruby` (the replay overlay, spec §2.2 #2:
		 *  17 px per line) · short = `NIGHTFALL by Ruby` (the sprites are right above) */
		form?: 'line' | 'icon' | 'short';
		align?: 'left' | 'right';
		/** the wearer's palette for the icon form, so the 16 px sprite wears the credited skin (caller peeks; this leaf never fetches) */
		palette?: string[] | null;
	} = $props();

	const linked = $derived(!!credit.author_steamid && /^\d{17}$/.test(credit.author_steamid));
	const author = $derived(credit.author_name || (credit.author_steamid ? `…${credit.author_steamid.slice(-5)}` : ''));
	const byline = $derived(!credit.own && !!author);
</script>

<span class="credit {form}" class:r={align === 'right'} data-cid={credit.cid}>
	{#if form === 'line'}<span class="ch">{charTag(credit.cid)}</span><span class="sep" aria-hidden="true">·</span>
	{:else if form === 'icon'}<span class="spr" title={charTag(credit.cid)}><CharSprite id={credit.cid} still {palette} alt={charTag(credit.cid)} /></span>{/if}
	<span class="sn" title={credit.name}>{form === 'short' ? credit.name : `“${credit.name}”`}</span>
	{#if byline}
		<span class="by">by {#if linked}<a href="{base}/u/{credit.author_steamid}" aria-label="{author}'s profile">{author}</a>{:else}{author}{/if}</span>
	{/if}
</span>

<style>
	/* mono record voice (commandment 7): ids, counts, credits are record language */
	.credit {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
		min-width: 0;
		max-width: 100%;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.04em;
		line-height: 1.35;
		color: var(--dim);
		white-space: nowrap;
	}
	.credit.r {
		flex-direction: row-reverse;
	}
	/* the overlay form (spec §2.2 #2): 17 px line, 12 px mono, a 16 px sprite in place of the character name */
	.credit.icon {
		align-items: center;
		height: 17px;
		font-size: 12px;
		line-height: 1;
		letter-spacing: 0;
		color: var(--ink);
	}
	.spr {
		display: block;
		width: 16px;
		height: 16px;
		border-radius: 2px;
		overflow: hidden;
		flex: none;
	}
	.ch {
		letter-spacing: 0.1em;
	}
	.sep {
		opacity: 0.6;
	}
	.sn {
		color: var(--ink);
		font-weight: 700;
		max-width: 16ch; /* 14 chars + the quotes */
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* charter: --stream marks skins/worn — and a creator credit (§8.3) */
	.by,
	.by a {
		color: var(--stream);
		text-decoration: none;
	}
	/* author links are dotted-underlined (spec rev 2 §2.2) — the one interactive thing on a picture */
	.by a {
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}
	.by a:hover,
	.by a:focus-visible {
		color: var(--ink);
		outline: none;
	}
</style>
