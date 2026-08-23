<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { resultcheck } from '$lib/stores/resultcheck.svelte';
	import ResultCheckPanel from './ResultCheckPanel.svelte';

	// 🔔 Result Check bell — pure render of the global "a result needs your check" indicator. The Result Check
	// lifecycle is owned centrally by AppLive in +layout. Opens the Result Check panel.
	let open = $state(false);
	const show = $derived(auth.authed);
	const count = $derived(resultcheck.unread);
</script>

{#if show}
	<button
		class="bell"
		class:has={count > 0}
		onclick={() => (open = true)}
		aria-label={count > 0 ? `Result Check — ${count} need your attention` : 'Result Check'}
		title="Result Check — contest a wrong win/loss and track your contests"
	>
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</svg>
		{#if count > 0}<span class="badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>{/if}
	</button>
{/if}

{#if open}
	<ResultCheckPanel onClose={() => (open = false)} />
{/if}

<style>
	.bell {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--dim);
		background: var(--panel);
		cursor: pointer;
		flex: none;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.bell:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.bell:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--gold-soft);
	}
	/* attention: amber ring when something needs the user's check — Result Check owns the app's amber budget */
	.bell.has {
		color: var(--gold);
		border-color: color-mix(in srgb, var(--gold) 45%, var(--line));
		background: color-mix(in srgb, var(--gold) 12%, transparent);
	}
	.badge {
		position: absolute;
		top: -5px;
		right: -5px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 999px;
		background: var(--live);
		color: #fff;
		font-size: 10px;
		font-weight: 800;
		line-height: 16px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
</style>
