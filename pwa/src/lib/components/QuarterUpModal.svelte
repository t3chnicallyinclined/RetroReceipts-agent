<script lang="ts">
	import QuarterUpForm from './QuarterUpForm.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { base } from '$app/paths';

	// 🪙 "Put a quarter up" modal — the money-match entry point from an arcade cabinet card (and anywhere the
	// full offer flow belongs, not a pre-directed challenge). The challenger first chooses WHO can take it —
	// an OPEN call anyone can attempt, or a directed challenge to one SteamID — then sets the stake.
	// FT is fixed at 3 today (owner decision; QuarterUpForm owns the stake pickers + the wager.offer write).
	let {
		open = $bindable(false),
		host = null,
		returnTo = ''
	}: {
		open?: boolean;
		/** the cabinet this was opened from — shown for context (routing to it is a server concern). */
		host?: { name?: string; steamid?: string } | null;
		/** where Steam sign-in should return to (defaults to the current path). */
		returnTo?: string;
	} = $props();

	// any = open marquee call (opp omitted) · person = directed challenge to a pasted 17-digit SteamID.
	let target = $state<'any' | 'person'>('any');
	let oppInput = $state('');
	const oppValid = $derived(/^\d{17}$/.test(oppInput.trim()));
	// Only a VALID 17-digit id becomes a directed offer; until then the stake form stays hidden so we can
	// never silently post an OPEN wager while the user believes they're calling out one specific person.
	const opp = $derived(target === 'person' && oppValid ? oppInput.trim() : '');

	function close() {
		open = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
	function signin() {
		const here =
			returnTo ||
			(typeof location !== 'undefined' ? location.pathname + location.search : `${base}/hosts`);
		auth.login(here);
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="ov" role="dialog" aria-modal="true" aria-label="Put a quarter up">
		<button class="scrim" aria-label="Close" onclick={close}></button>
		<div class="card">
			<div class="hd">
				<span class="t"
					>🪙 Put a quarter up{#if host?.name}<span class="ctx"> · {host.name}</span>{/if}</span
				>
				<button class="x" aria-label="Close" onclick={close}>×</button>
			</div>

			{#if !auth.authed}
				<p class="lead">Sign in with Steam to put a quarter up.</p>
				<button class="signin" onclick={signin}>Sign in through Steam ▸</button>
			{:else}
				<!-- who can take this -->
				<div class="seg" role="group" aria-label="Who can take this">
					<button
						type="button"
						class="s"
						class:on={target === 'any'}
						aria-pressed={target === 'any'}
						onclick={() => (target = 'any')}>🎲 Any taker</button
					>
					<button
						type="button"
						class="s"
						class:on={target === 'person'}
						aria-pressed={target === 'person'}
						onclick={() => (target = 'person')}>🎯 Specific player</button
					>
				</div>

				{#if target === 'any'}
					<p class="lead">An open call on the arcade — anyone can match it. Winner takes the pot.</p>
					<QuarterUpForm />
				{:else}
					<label class="fld">
						<span class="fl">Their SteamID (17 digits)</span>
						<input
							class="sid"
							inputmode="numeric"
							autocomplete="off"
							placeholder="7656119…"
							bind:value={oppInput}
							aria-label="Opponent SteamID"
						/>
					</label>
					{#if oppValid}
						<QuarterUpForm {opp} />
					{:else}
						<p class="hint">
							Paste their 17-digit SteamID to send a direct challenge — or challenge anyone straight
							from their profile or a leaderboard row.
						</p>
					{/if}
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	/* modal chrome mirrors ChallengeButton.svelte so the two money-match surfaces feel identical */
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
		max-width: 400px;
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
		font-weight: 800;
	}
	.t .ctx {
		color: var(--gold);
		font-weight: 700;
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

	.lead {
		margin: 0 0 12px;
		font-size: 12.5px;
		color: var(--dim);
		line-height: 1.5;
	}
	.hint {
		margin: 10px 0 0;
		font-size: 11.5px;
		color: var(--dim);
		line-height: 1.5;
	}

	/* segmented "who takes it" control */
	.seg {
		display: flex;
		gap: 6px;
		margin-bottom: 12px;
	}
	.s {
		flex: 1 1 0;
		font: inherit;
		font-size: 12.5px;
		font-weight: 800;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 8px 6px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.12s,
			border-color 0.12s,
			background 0.12s;
	}
	.s.on {
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-color: transparent;
		font-style: italic;
	}

	.fld {
		display: block;
		margin-bottom: 4px;
	}
	.fl {
		display: block;
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
		margin-bottom: 5px;
	}
	.sid {
		width: 100%;
		box-sizing: border-box;
		/* 16px so iOS/iPadOS Safari doesn't auto-zoom the page on focus */
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--gold-soft);
		border-radius: 9px;
		padding: 8px 10px;
	}

	.signin {
		font: inherit;
		font-size: 13px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 10px;
		padding: 9px 16px;
		cursor: pointer;
	}
	.signin:hover {
		filter: brightness(1.05);
	}
</style>
