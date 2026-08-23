<script lang="ts">
	import QuarterUpForm from './QuarterUpForm.svelte';
	import { auth } from '$lib/stores/auth.svelte';

	// Reusable "⚔ Challenge / 🔄 Run it back" affordance for ANY card that shows a player — profile, leaderboard
	// row, session/match card, head-to-head. Opens the directed quarter-up form (QuarterUpForm opp=steamid) in a
	// centered modal (robust from inside table rows — no clip/overflow). Self-hides unless you're signed in, it's
	// not your own card, and it's a real 17-digit SteamID.
	let {
		steamid,
		name = 'this player',
		runback = false,
		compact = false
	}: { steamid: string; name?: string; runback?: boolean; compact?: boolean } = $props();

	const can = $derived(
		auth.authed && !!auth.steamid && auth.steamid !== steamid && /^\d{17}$/.test(steamid)
	);
	let open = $state(false);
	function close() {
		open = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if can}
	<button
		class="trg"
		class:compact
		class:runback
		onclick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			open = true;
		}}
		title={runback ? `Run it back vs ${name}` : `Challenge ${name} for quarters`}
	>
		{#if runback}🔄{#if !compact}<span> Run it back</span>{/if}
		{:else}⚔{#if !compact}<span> Challenge</span>{/if}{/if}
	</button>

	{#if open}
		<div class="ov" role="dialog" aria-modal="true" aria-label="Challenge {name}">
			<button class="scrim" aria-label="Close" onclick={close}></button>
			<div class="card">
				<div class="hd">
					<span class="t">{runback ? '🔄 Run it back vs' : '🪙 Challenge'} <b>{name}</b></span>
					<button class="x" aria-label="Close" onclick={close}>×</button>
				</div>
				<QuarterUpForm opp={steamid} oppName={name} />
				<p class="fine">They'll get it as a challenge on their bar — and you'll get a share link to send them directly.</p>
			</div>
		</div>
	{/if}
{/if}

<style>
	.trg {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font: inherit;
		font-size: 12px;
		font-weight: 800;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 5px 11px;
		min-height: 30px;
		cursor: pointer;
		white-space: nowrap;
		font-style: italic;
	}
	.trg:hover {
		filter: brightness(1.05);
	}
	.trg.runback {
		color: var(--gold);
		background: transparent;
		border-color: color-mix(in srgb, var(--gold) 40%, var(--line));
		font-style: normal;
	}
	.trg.runback:hover {
		border-color: var(--gold);
		filter: none;
	}
	.trg.compact {
		padding: 4px 8px;
		min-height: 26px;
		font-size: 13px;
	}

	.ov {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.scrim {
		position: absolute;
		inset: 0;
		border: none;
		background: rgba(4, 6, 10, 0.66);
		cursor: default;
	}
	.card {
		position: relative;
		width: 100%;
		max-width: 380px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: 16px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
		animation: pop 0.14s ease-out;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.98);
		}
	}
	.hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
	}
	.t {
		font-size: 14.5px;
		font-weight: 700;
	}
	.t b {
		color: var(--gold);
	}
	.x {
		font: inherit;
		font-size: 20px;
		line-height: 1;
		color: var(--dim);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0 4px;
	}
	.x:hover {
		color: var(--ink);
	}
	.fine {
		margin: 12px 0 0;
		font-size: 11.5px;
		color: var(--dim);
		line-height: 1.5;
	}
</style>
