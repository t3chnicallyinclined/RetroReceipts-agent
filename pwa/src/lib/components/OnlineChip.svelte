<script lang="ts">
	import { base } from '$app/paths';
	import { presence } from '$lib/stores/presence.svelte';

	// ● N ONLINE — how many players are on the collection right now, on every page, signed-in or not.
	// Lives beside the wallet chip; links to /match where the live activity actually is. The dot is
	// --good (presence = the app's "alive" colour) — no gold: the budget stays winner/money/seal.
	$effect(() => presence.start());
	const n = $derived(presence.online);
	const who = $derived(
		presence.players.length ? `On now: ${presence.players.slice(0, 12).join(', ')}` : 'Players on Marvel Collection right now'
	);
</script>

{#if n != null}
	<a class="chip" href="{base}/match" title={who}>
		<span class="dot" aria-hidden="true"></span>
		<span class="n">{n}</span>
		<span class="word">online</span>
	</a>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border: 1px solid color-mix(in srgb, var(--good) 30%, var(--line));
		border-radius: 999px;
		background: color-mix(in srgb, var(--good) 7%, var(--panel));
		color: var(--ink);
		text-decoration: none;
		font-size: 12px;
		font-weight: 700;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.chip:hover {
		border-color: color-mix(in srgb, var(--good) 55%, var(--line));
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--good);
		box-shadow: 0 0 7px var(--good);
		animation: breathe 2.4s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
	.word {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--dim);
	}
	@media (max-width: 640px) {
		.word {
			display: none; /* phones: the dot + count say it */
		}
		.chip {
			padding: 5px 8px;
		}
	}
</style>
