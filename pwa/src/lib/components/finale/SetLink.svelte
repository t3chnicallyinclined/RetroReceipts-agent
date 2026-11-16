<script lang="ts">
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';

	// "See the set" for a highlight that is one match or set. There is no per-game deep link: it lands on the set
	// page. "Watch the replay" is NOT offered yet: whether hosted replays render for ordinary players is unverified
	// (BUILD-SPEC 2.2), so the tape flag is accepted but only the set link is shown.
	let { sessionId, tape = false }: { sessionId?: string; tape?: boolean } = $props();
</script>

{#if sessionId}
	<div class="setlink" data-tape={tape ? '1' : undefined}><a class="btn sm" href="{base}/r/set/{encodeURIComponent(sessionId)}">See the set</a></div>
{/if}
