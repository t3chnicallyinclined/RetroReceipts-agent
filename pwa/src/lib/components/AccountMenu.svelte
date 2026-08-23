<script lang="ts">
	import { base } from '$app/paths';
	import Avatar from './Avatar.svelte';
	import Flag from './Flag.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { agent } from '$lib/stores/agent.svelte';
	import { wallet } from '$lib/stores/wallet.svelte';
	import { rankOf } from '$lib/ranks';

	// Top-bar account atom (redesign step 2) — the single entry point for everything account-scoped. Replaces
	// the old standalone AgentChip + settings gear + AuthChip cluster: signed-out = the Steam sign-in button;
	// signed-in = avatar (carrying an agent presence DOT) + name, opening a menu (desktop dropdown / mobile
	// bottom sheet) of wallet · desktop agent · profile · settings · sign out. Live data (wallet balance, agent
	// status) is owned by AppLive; this is pure render + navigation.
	let open = $state(false);

	const me = $derived(auth.me);
	const sid = $derived(auth.steamid);
	const games = $derived((me?.wins ?? 0) + (me?.losses ?? 0));
	const rank = $derived(me ? rankOf(me.rating ?? 0, games) : null);
	// presence dot: green = agent connected, amber = an update is available, dim = no agent reporting.
	const presence = $derived(!agent.reporting ? 'none' : agent.status?.update_available ? 'upd' : 'ok');

	function close() {
		open = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if auth.authed}
	<div class="acct" class:open>
		<button
			class="trigger"
			onclick={() => (open = !open)}
			aria-haspopup="menu"
			aria-expanded={open}
			title="Account"
		>
			<span class="pic">
				<Avatar url={me?.avatar} size={26} alt={me?.name ?? 'You'} />
				<span class="pres {presence}" aria-hidden="true"></span>
			</span>
			<span class="nm">{me?.name || 'You'}</span>
			<span class="car" aria-hidden="true">▾</span>
		</button>

		{#if open}
			<!-- scrim: click-away on desktop, dim backdrop behind the bottom sheet on mobile -->
			<button class="scrim" aria-label="Close menu" onclick={close}></button>
			<div class="menu" role="menu">
				<div class="grab" aria-hidden="true"></div>
				<a class="head" href="{base}/u/{sid}" role="menuitem" onclick={close}>
					<Avatar url={me?.avatar} size={38} alt={me?.name ?? 'You'} />
					<span class="hmeta">
						<span class="hn">{#if me?.cc}<Flag cc={me.cc} w={16} /> {/if}{me?.name || 'You'}</span>
						{#if rank}<span class="hr">{rank.n}</span>{/if}
					</span>
					<span class="hgo" aria-hidden="true">›</span>
				</a>
				<div class="rows">
					<a class="row" href="{base}/settings" role="menuitem" onclick={close}>
						<span class="ri">🪙</span><span class="rl">Wallet</span>
						{#if wallet.balance != null}<span class="rv gold">{wallet.balance}</span>{:else}<span class="rv dim">›</span>{/if}
					</a>
					<a class="row" href="{base}/settings" role="menuitem" onclick={close}>
						<span class="ri">⬢</span><span class="rl">Desktop agent</span>
						{#if presence === 'upd'}<span class="rv amber">update →</span>
						{:else if presence === 'ok'}<span class="rv good">v{agent.status?.ver} · online</span>
						{:else}<span class="rv dim">offline</span>{/if}
					</a>
					<a class="row" href="{base}/skins" role="menuitem" onclick={close}>
						<span class="ri">🎨</span><span class="rl">My Skins</span><span class="rv dim">›</span>
					</a>
					<a class="row" href="{base}/hosts" role="menuitem" onclick={close}>
						<span class="ri">🕹</span><span class="rl">Arcades map</span><span class="rv dim">›</span>
					</a>
					<a class="row" href="{base}/u/{sid}" role="menuitem" onclick={close}>
						<span class="ri">👤</span><span class="rl">Profile</span><span class="rv dim">›</span>
					</a>
					<a class="row" href="{base}/settings" role="menuitem" onclick={close}>
						<span class="ri">⚙</span><span class="rl">Settings</span><span class="rv dim">›</span>
					</a>
					<button class="row out" role="menuitem" onclick={() => { close(); auth.logout(); }}>
						<span class="ri">⎋</span><span class="rl">Sign out</span>
					</button>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<button class="steam" onclick={() => auth.login()}>
		<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
			<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
			<circle cx="15" cy="9" r="2.4" fill="currentColor" />
			<path d="M6 15l4.5 1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		</svg>
		<span class="lbl">Sign in</span>
	</button>
{/if}

<style>
	.acct {
		position: relative;
		flex: none;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 3px 9px 3px 3px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--panel);
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	.trigger:hover,
	.acct.open .trigger {
		border-color: var(--gold-soft);
	}
	.pic {
		position: relative;
		width: 26px;
		height: 26px;
		flex: none;
		display: grid;
		place-items: center;
	}
	.pres {
		position: absolute;
		right: -1px;
		bottom: -1px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 2px solid var(--panel);
	}
	.pres.ok {
		background: var(--good);
	}
	.pres.upd {
		background: var(--gold);
	}
	.pres.none {
		background: var(--faint);
	}
	.nm {
		font-size: 12.5px;
		font-weight: 700;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.car {
		font-size: 10px;
		color: var(--dim);
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		border: none;
		background: transparent;
		cursor: default;
	}
	.menu {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 50;
		width: 264px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
		overflow: hidden;
		animation: pop 0.13s ease-out;
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.grab {
		display: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 14px;
		text-decoration: none;
		color: var(--ink);
		border-bottom: 1px solid var(--line);
		background: linear-gradient(180deg, var(--gold-soft), transparent);
	}
	.head:hover {
		background: linear-gradient(180deg, color-mix(in srgb, var(--gold) 18%, transparent), transparent);
	}
	.hmeta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.hn {
		font-family: var(--disp, inherit);
		font-size: 14.5px;
		font-weight: 800;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hr {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--gold);
		letter-spacing: 0.02em;
	}
	.hgo {
		color: var(--dim);
		font-size: 15px;
	}
	.rows {
		display: flex;
		flex-direction: column;
		padding: 6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 10px 10px;
		border-radius: 9px;
		text-decoration: none;
		color: var(--ink);
		font: inherit;
		font-size: 13.5px;
		font-weight: 600;
		background: transparent;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
	}
	.row:hover {
		background: var(--panel2, color-mix(in srgb, var(--ink) 6%, transparent));
	}
	.ri {
		width: 20px;
		text-align: center;
		font-size: 14px;
		flex: none;
	}
	.rl {
		flex: 1;
	}
	.rv {
		font-size: 12px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.rv.gold {
		color: var(--gold);
	}
	.rv.good {
		color: var(--good);
	}
	.rv.amber {
		color: var(--gold);
	}
	.rv.dim {
		color: var(--dim);
	}
	.row.out {
		color: var(--dim);
	}
	.row.out:hover {
		color: var(--live, #ff3d68);
	}

	.steam {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font: inherit;
		font-size: 12.5px;
		font-weight: 800;
		color: #dfe9f5;
		background: linear-gradient(180deg, #2a475e, #1b2838);
		border: 1px solid color-mix(in srgb, #66c0f4 35%, transparent);
		border-radius: 999px;
		padding: 7px 13px;
		cursor: pointer;
		white-space: nowrap;
		flex: none;
	}
	.steam:hover {
		border-color: #66c0f4;
		color: #fff;
	}

	/* Mobile: the menu becomes a bottom sheet in the thumb zone; the scrim dims behind it. */
	@media (max-width: 720px) {
		.nm,
		.car {
			display: none;
		}
		.trigger {
			padding: 2px;
		}
		.scrim {
			background: rgba(4, 6, 10, 0.6);
		}
		.menu {
			position: fixed;
			top: auto;
			bottom: 0;
			left: 0;
			right: 0;
			width: auto;
			border-radius: 16px 16px 0 0;
			border-bottom: none;
			padding-bottom: max(8px, env(safe-area-inset-bottom));
			animation: slideup 0.16s ease-out;
		}
		@keyframes slideup {
			from {
				transform: translateY(100%);
			}
		}
		.grab {
			display: block;
			width: 40px;
			height: 4px;
			border-radius: 3px;
			background: var(--faint);
			margin: 8px auto 2px;
			opacity: 0.7;
		}
		.row {
			padding: 13px 12px;
			font-size: 15px;
		}
	}
</style>
