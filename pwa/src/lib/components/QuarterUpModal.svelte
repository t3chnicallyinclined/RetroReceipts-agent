<script lang="ts">
	import QuarterUpForm from './QuarterUpForm.svelte';
	import Avatar from './Avatar.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { leaderboard } from '$lib/stores/leaderboard.svelte';
	import { rankOf } from '$lib/ranks';
	import { base } from '$app/paths';
	import type { Player } from '$lib/types';

	// 🪙 "Put a quarter up" modal — the money-match entry point from an arcade cabinet card (and anywhere the
	// full offer flow belongs, not a pre-directed challenge). The challenger first chooses WHO can take it —
	// an OPEN call anyone can attempt, or a directed challenge to a specific player (pick from the top board,
	// search by name, or paste a SteamID) — then sets the stake. FT is fixed at 3 today (owner decision;
	// QuarterUpForm owns the stake pickers + the wager.offer write).
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

	// any = open marquee call (opp omitted) · person = a directed challenge to one chosen player.
	let target = $state<'any' | 'person'>('any');
	let query = $state('');
	let picked = $state<{ steamid: string; name: string; avatar?: string } | null>(null);
	let boardTried = $state(false); // one-shot guard so a failed board load doesn't retry-loop

	const qTrim = $derived(query.trim());
	const isId = $derived(/^\d{17}$/.test(qTrim));

	// The pick list = the ranked board (top ~50), minus yourself, name-filtered as you type, capped at 20.
	// No dedicated search endpoint exists, so this mirrors the /ranks search (client filter over the board);
	// anyone off the board is still reachable by pasting their 17-digit SteamID.
	const results = $derived.by(() => {
		const me = auth.steamid;
		const all = leaderboard.players.filter((p) => p.steamid && p.steamid !== me);
		const ql = qTrim.toLowerCase();
		const matched = ql ? all.filter((p) => (p.name ?? '').toLowerCase().includes(ql)) : all;
		return matched.slice(0, 20);
	});

	// Only a PICKED player becomes a directed offer — until then the stake form stays hidden so we can never
	// silently post an OPEN wager while the user believes they're calling out one specific person.
	const opp = $derived(picked?.steamid ?? '');

	function pick(p: { steamid: string; name: string; avatar?: string }) {
		picked = { steamid: p.steamid, name: p.name, avatar: p.avatar };
	}
	function pickId() {
		picked = { steamid: qTrim, name: `SteamID ${qTrim.slice(0, 4)}…${qTrim.slice(-3)}` };
	}
	function rankName(p: Player): string {
		return rankOf(p.rating, (p.wins ?? 0) + (p.losses ?? 0)).n;
	}

	// Lazily pull the board the first time the picker is shown (idempotent; no live sub needed in a modal).
	$effect(() => {
		if (
			open &&
			target === 'person' &&
			!boardTried &&
			leaderboard.players.length === 0 &&
			!leaderboard.loading
		) {
			boardTried = true;
			void leaderboard.load(true);
		}
	});

	function close() {
		open = false;
		// reset for a clean next-open
		target = 'any';
		query = '';
		picked = null;
		boardTried = false;
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
				{:else if picked}
					<div class="picked">
						<Avatar url={picked.avatar} size={30} alt={picked.name} />
						<span class="pn">{picked.name}</span>
						<button type="button" class="chg" onclick={() => (picked = null)}>change</button>
					</div>
					<QuarterUpForm {opp} oppName={picked.name} />
				{:else}
					<label class="fld">
						<span class="fl">Challenge a player — search by name, or paste a SteamID</span>
						<input
							class="sid"
							placeholder="type a name or a 17-digit ID…"
							bind:value={query}
							aria-label="Search player"
							autocomplete="off"
						/>
					</label>

					<div class="results" role="listbox" aria-label="Players">
						{#if isId}
							<button type="button" class="res idrow" onclick={pickId}>
								<span class="idlbl">🎯 Challenge SteamID <b>{qTrim}</b></span>
							</button>
						{/if}
						{#if leaderboard.loading && results.length === 0}
							<div class="rhint">Loading players…</div>
						{:else if results.length}
							{#if !qTrim}<div class="rlbl">Top players</div>{/if}
							{#each results as p (p.steamid)}
								<button type="button" class="res" onclick={() => pick(p)}>
									<Avatar url={p.avatar} size={26} alt={p.name} />
									<span class="rn">{p.name}</span>
									<span class="rr">{rankName(p)} · {p.rating}</span>
								</button>
							{/each}
						{:else if qTrim && !isId}
							<div class="rhint">
								No player found — paste their 17-digit SteamID to challenge them directly.
							</div>
						{:else}
							<div class="rhint">No players on the board yet.</div>
						{/if}
					</div>
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
		margin-bottom: 8px;
	}
	.fl {
		display: block;
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.1em;
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
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--gold-soft);
		border-radius: 9px;
		padding: 8px 10px;
	}

	/* results list — scrolls inside the modal so 20 rows never blow out the card height */
	.results {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 232px;
		overflow-y: auto;
		margin: 0 -4px;
		padding: 0 4px;
	}
	.rlbl {
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--faint);
		padding: 4px 4px 2px;
	}
	.res {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		font: inherit;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 10px;
		padding: 6px 8px;
		cursor: pointer;
	}
	.res:hover {
		background: var(--panel-2);
		border-color: var(--line);
	}
	.rn {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 13px;
		font-weight: 700;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rr {
		flex: none;
		font-size: 11px;
		font-weight: 700;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.idrow {
		border-color: var(--gold-soft);
	}
	.idlbl {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--ink);
	}
	.idlbl b {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}
	.rhint {
		font-size: 11.5px;
		color: var(--dim);
		line-height: 1.5;
		padding: 6px 4px;
	}

	/* chosen-player chip above the stake form */
	.picked {
		display: flex;
		align-items: center;
		gap: 9px;
		background: var(--panel-2);
		border: 1px solid var(--gold-soft);
		border-radius: 10px;
		padding: 6px 8px;
		margin-bottom: 12px;
	}
	.pn {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 13px;
		font-weight: 800;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chg {
		flex: none;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		color: var(--gold);
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--gold) 40%, var(--line));
		border-radius: 999px;
		padding: 3px 10px;
		cursor: pointer;
	}
	.chg:hover {
		border-color: var(--gold);
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
