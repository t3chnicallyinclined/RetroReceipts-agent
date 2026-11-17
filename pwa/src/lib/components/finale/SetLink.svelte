<script lang="ts">
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { gameLink, momentAction, type TapeState, type WatchLabel } from '$lib/finale/moments';
	import { openWatch, watchHash, type WatchInfo } from '$lib/finale/watch';

	// The link from a highlight to its game. With the game's key and tape state (a server that sends them) it is ONE
	// honest action: when the tape is ready it OPENS THE REPLAY RIGHT HERE (the app-wide replay sheet, with a
	// `#watch=<key>` hash), otherwise "See the set" at that game with a quiet line saying why there is no replay button.
	// Without a key and state (an older server) it is the plain "See the set" link, with no claim about replays. The link
	// keeps its href, so a middle-click, a new-tab click or a browser without script lands on the set page's own deep link.
	// The sign-in and ownership rules are the replay sheet's / set page's; nothing here changes them.
	let {
		sessionId,
		matchKey,
		tapeState,
		tape = false,
		winner,
		watchLabel,
		inline = false,
		who = '',
		info
	}: {
		sessionId?: string;
		matchKey?: string;
		tapeState?: TapeState;
		tape?: boolean;
		winner?: string;
		/** the wording of the watch action ("Watch the replay" by default; "Watch it", "Watch one", ...) */
		watchLabel?: WatchLabel;
		/** a small text link inside a stat instead of a button */
		inline?: boolean;
		/** the players, put in the accessible name ("Watch one: A beat B") */
		who?: string;
		/** extra facts for the sheet's chrome (names, teams, time); the server's own overlay wins when it has them */
		info?: Partial<WatchInfo>;
	} = $props();
	const act = $derived(matchKey && tapeState ? momentAction(tapeState, auth.authed, watchLabel) : null);
	const href = $derived(sessionId ? gameLink(base, sessionId, matchKey, winner) : '');
	const watching = $derived(!!act && act.kind === 'watch' && !!matchKey);

	function click(e: MouseEvent) {
		if (!watching || !matchKey) return;
		// let the browser handle modified clicks (new tab / window / download)
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		void openWatch({ ...info, matchKey, sessionId }, base);
	}
</script>

{#if sessionId || (watching && matchKey)}
	<div class="setlink" class:inl={inline} data-tape={tape || tapeState === 'ready' ? '1' : undefined} data-state={tapeState}>
		<a
			class={inline ? 'wlink' : 'btn sm'}
			class:pri={!inline && watching}
			href={href || (matchKey ? watchHash(matchKey) : undefined)}
			aria-label={act && who ? `${act.label}: ${who}` : undefined}
			onclick={click}>{act ? act.label : 'See the set'}</a
		>
		{#if act?.reason}<p class="why dimp">{act.reason}</p>{/if}
	</div>
{/if}
