<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import Avatar from './Avatar.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { wager } from '$lib/stores/wager.svelte';
	import { wallet } from '$lib/stores/wallet.svelte';

	// The molten "you've been challenged" surface (redesign step 3) — app-wide, mounted in +layout under the
	// TopBar. Fires ONLY on a directed summons to the viewer (mine.opp === me, someone ELSE's open challenge).
	// Desktop: a sticky strip under the bar. Mobile: a thumb-zone bottom sheet. Zero chrome when idle.
	//   • Accept is armed (tap → confirm) so a stray tap can't commit a wager; on confirm → escrow → /match.
	//   • Decline is one-tap (a "block" flag rides once ae ships decline-can-block).
	// wager.mine is single-valued today (a 2nd summons overwrites); the "N waiting" pager arrives with ae's
	// GET /wager/challenges. Countdown renders from expires_ms once the server stamps it — no countdown until then.
	const me = $derived(auth.steamid);
	const c = $derived(wager.mine);
	const isSummons = $derived(!!c && c.status === 'open' && !!me && c.opp === me && c.challenger !== me);

	const stake = $derived(c?.stake ?? 0);
	const pot = $derived(c?.pot ?? stake * 2);
	const ft = $derived(c?.ft ?? 3);
	const name = $derived(
		c?.challenger_name || (c?.challenger ? `…${c.challenger.slice(-5)}` : 'A challenger')
	);
	const covers = $derived(wallet.balance == null || wallet.balance >= stake);

	// live countdown from the server-stamped expiry (absent until ae ships it → no countdown)
	let now = $state(0);
	const expMs = $derived(c ? ((c as unknown as { expires_ms?: number }).expires_ms ?? null) : null);
	const remain = $derived(expMs != null && now ? Math.max(0, expMs - now) : null);
	const expired = $derived(remain != null && remain <= 0);
	const mmss = $derived(() => {
		if (remain == null) return '';
		const s = Math.ceil(remain / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	$effect(() => {
		if (!isSummons || expMs == null) return;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	let confirming = $state(false);
	let acting = $state(false);
	let err = $state('');

	// reset the arm/error whenever the live summons identity changes
	$effect(() => {
		void c?.id;
		confirming = false;
		err = '';
	});

	async function accept() {
		if (acting || !c || expired) return;
		if (!confirming) {
			confirming = true; // arm — a second tap commits
			return;
		}
		acting = true;
		err = '';
		const r = await wager.respond(c.id, true);
		acting = false;
		confirming = false;
		if (r.ok) await goto(`${base}/match`);
		else err = r.error ?? 'Could not accept that challenge.';
	}
	async function decline() {
		if (acting || !c) return;
		acting = true;
		err = '';
		await wager.respond(c.id, false); // TODO: pass block:true once ae ships decline-can-block
		acting = false;
		confirming = false;
	}
</script>

{#if isSummons && c}
	<section class="cs" class:expired role="alert" aria-label="You've been challenged to a money match">
		<span class="rail" aria-hidden="true"></span>
		<span class="grab" aria-hidden="true"></span>

		<div class="lead">
			<span class="kick">⚔ CHALLENGE</span>
			<span class="who">
				<Avatar url={undefined} size={26} alt={name} />
				<span class="wt"><b>{name}</b> <span class="dim">challenged you</span></span>
			</span>
		</div>

		<div class="terms">
			<span class="ft">FT{ft}</span><i>·</i><span class="stk">🪙 {stake}</span><i>·</i><span class="pot">pot 🪙 {pot}</span>
			<span class="cov" class:short={!covers}>{covers ? `🪙 ${wallet.balance ?? ''} ✓` : `need 🪙 ${stake}`}</span>
		</div>

		{#if remain != null}
			<div class="cd" class:low={remain <= 10000}>
				<span class="clock">⏳ {expired ? 'expired' : mmss()}</span>
			</div>
		{/if}

		<div class="act">
			{#if err}<span class="err" role="status">{err}</span>{/if}
			{#if confirming}
				<button class="btn cancel" onclick={() => (confirming = false)} disabled={acting}>Cancel</button>
				<button class="btn accept confirm" onclick={accept} disabled={acting || expired || !covers}>
					{acting ? '…' : `Confirm — 🪙${stake} to escrow`}
				</button>
			{:else}
				<button class="btn decline" onclick={decline} disabled={acting}>Decline</button>
				<button class="btn accept" onclick={accept} disabled={acting || expired || !covers} title={covers ? '' : 'Not enough quarters'}>
					⚔ {expired ? 'Expired' : covers ? `Accept — match 🪙${stake}` : 'Need quarters'}
				</button>
			{/if}
		</div>
	</section>
{/if}

<style>
	.cs {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 4px 0 8px;
		padding: 11px 16px;
		border: 1px solid color-mix(in srgb, var(--molten) 45%, var(--line));
		border-radius: 12px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--molten) 16%, transparent), transparent 62%), var(--panel);
		box-shadow: 0 0 26px color-mix(in srgb, var(--molten) 18%, transparent);
		animation: drop 0.18s ease-out;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
	}
	.cs.expired {
		filter: saturate(0.5);
		opacity: 0.8;
	}
	.rail {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		border-radius: 12px 0 0 12px;
		background: var(--molten);
	}
	.grab {
		display: none;
	}
	.lead {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: none;
	}
	.kick {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.14em;
		color: var(--molten);
		white-space: nowrap;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.wt {
		font-size: 13.5px;
		white-space: nowrap;
	}
	.wt .dim,
	.dim {
		color: var(--dim);
	}
	.terms {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 800;
		color: var(--gold);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.terms i {
		font-style: normal;
		color: var(--faint);
	}
	.terms .pot {
		color: var(--dim);
		font-weight: 700;
	}
	.terms .cov {
		margin-left: 4px;
		font-size: 11.5px;
		font-weight: 700;
		color: var(--good);
	}
	.terms .cov.short {
		color: var(--live, #ff3d68);
	}
	.cd {
		flex: 1;
		display: flex;
		justify-content: flex-end;
		min-width: 40px;
	}
	.clock {
		font-size: 12px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--dim);
		white-space: nowrap;
	}
	.cd.low .clock {
		color: var(--live, #ff3d68);
	}
	.act {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
		flex: none;
	}
	.err {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--live, #ff3d68);
		max-width: 200px;
	}
	.btn {
		height: 36px;
		padding: 0 14px;
		border-radius: 9px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 800;
		border: 1px solid transparent;
		cursor: pointer;
		white-space: nowrap;
		flex: none;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.accept {
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		font-style: italic;
		font-weight: 900;
	}
	.btn.accept:hover:not(:disabled) {
		filter: brightness(1.05);
	}
	.btn.decline,
	.btn.cancel {
		color: var(--dim);
		background: transparent;
		border-color: var(--line);
	}
	.btn.decline:hover:not(:disabled) {
		color: var(--live, #ff3d68);
		border-color: color-mix(in srgb, var(--live, #ff3d68) 45%, var(--line));
	}

	/* Mobile: a thumb-zone bottom sheet instead of the under-bar strip. */
	@media (max-width: 720px) {
		.cs {
			position: fixed;
			top: auto;
			bottom: 0;
			left: 0;
			right: 0;
			z-index: 60;
			margin: 0;
			flex-wrap: wrap;
			gap: 8px 12px;
			border-radius: 16px 16px 0 0;
			border-bottom: none;
			padding: 8px 16px max(14px, env(safe-area-inset-bottom));
			box-shadow: 0 -12px 34px rgba(0, 0, 0, 0.5);
			animation: slideup 0.18s ease-out;
		}
		@keyframes slideup {
			from {
				transform: translateY(100%);
			}
		}
		.rail {
			display: none;
		}
		.grab {
			display: block;
			width: 40px;
			height: 4px;
			border-radius: 3px;
			background: var(--molten);
			opacity: 0.7;
			position: absolute;
			top: 6px;
			left: 50%;
			transform: translateX(-50%);
		}
		.lead {
			width: 100%;
			margin-top: 8px;
		}
		.cd {
			flex: none;
		}
		.act {
			width: 100%;
			margin-left: 0;
		}
		.act .btn {
			flex: 1;
			height: 44px;
		}
	}
</style>
