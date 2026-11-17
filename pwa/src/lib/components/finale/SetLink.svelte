<script lang="ts">
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { gameLink, momentAction, type TapeState } from '$lib/finale/moments';

	// The link from a highlight to its game. With the game's key and tape state (a server that sends them) it is ONE
	// honest action: "Watch the replay" when the tape is ready (the set page opens that game's replay), otherwise "See
	// the set" at that game with a quiet line saying why there is no replay button. Without them (an older server) it
	// is the plain "See the set" link, with no claim about replays. The sign-in and ownership rules are the set page's;
	// nothing here changes them.
	let { sessionId, matchKey, tapeState, tape = false, winner }: { sessionId?: string; matchKey?: string; tapeState?: TapeState; tape?: boolean; winner?: string } = $props();
	const act = $derived(matchKey && tapeState ? momentAction(tapeState, auth.authed) : null);
	const href = $derived(sessionId ? gameLink(base, sessionId, matchKey, winner) : '');
</script>

{#if sessionId}
	<div class="setlink" data-tape={tape || tapeState === 'ready' ? '1' : undefined} data-state={tapeState}>
		<a class="btn sm" class:pri={act?.kind === 'watch'} href={href}>{act ? act.label : 'See the set'}</a>
		{#if act?.reason}<p class="why dimp">{act.reason}</p>{/if}
	</div>
{/if}
