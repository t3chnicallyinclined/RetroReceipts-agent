<script lang="ts">
	import { agent } from '$lib/stores/agent.svelte';
	import { api } from '$lib/config';

	// 🔔 THE UPGRADE NOTICE — Tris 2026-08-28: "big and loud and BROAD".
	// Shown to EVERY signed-in user whose desktop agent is behind the latest release, tied to the
	// thing that visibly breaks without it: match replays. 0.3.28 shipped a broken effects/objs
	// tape column; 0.3.29 fixes it — an out-of-date agent records replays that don't play back right.
	//
	// The forced full-viewport LEGACY WALL (a takeover for the retired MetaSync 0.1.x/0.2.x
	// generation) is HELD until the truly-final tape (0.3.30 / the oracle build) so those users
	// migrate ONCE, not onto an interim. Until then legacy users get THIS same broad banner — a loud
	// nudge, not a lockout — pointing at the migration installer. Flip LEGACY_WALL_ENABLED to true
	// when the final tape ships to turn the forced wall back on.
	const LEGACY_WALL_ENABLED = true; // Tris 2026-08-29: forced ON — migrate the retired MetaSync generation ahead of the replay-system launch (stable tape settled: reader.rs 0.3.29 == 0.3.31; installer uninstalls MetaSync → no boot-loop; migrate-once, then auto-updates ride agent-latest.json)

	const WIN_URL_FALLBACK =
		'https://github.com/t3chnicallyinclined/RetroReceipts-agent/releases/latest/download/rr-agent.exe';
	let winUrl = $state(WIN_URL_FALLBACK);

	// Legacy MetaSync users get the real INSTALLER (uninstalls MetaSync, installs the agent as a
	// findable Windows app, launches it — zero manual steps). Modern stale agents get the bare exe
	// their own updater swaps in.
	const MIGRATE_INSTALLER =
		'https://github.com/t3chnicallyinclined/RetroReceipts-agent/releases/download/v0.3.29/RetroReceipts-Setup.exe';
	async function resolveWinUrl() {
		try {
			const res = await fetch(api('/rr/update/agent-latest.json'), { cache: 'no-store' });
			if (!res.ok) return;
			const url = (await res.json())?.url;
			if (typeof url === 'string' && url.startsWith('https://')) winUrl = url;
		} catch {
			/* fallback already works */
		}
	}

	const ver = $derived(agent.status?.ver ?? '');
	const latest = $derived(agent.status?.latest ?? '');
	// LEGACY = the retired MetaSync Tauri generation (gate on last-known version, not live reporting,
	// so closing the old app can't dodge the notice).
	const legacy = $derived(ver.startsWith('0.1.') || ver.startsWith('0.2.'));
	// BROAD: any signed-in user whose agent is behind the latest release — legacy OR a stale rr-agent.
	const behind = $derived(agent.reporting && (legacy || agent.status?.update_available === true));
	const showWall = $derived(LEGACY_WALL_ENABLED && legacy);
	// Legacy → the installer; everyone else → the bare self-update exe.
	const dl = $derived(legacy ? MIGRATE_INSTALLER : winUrl);
	$effect(() => {
		if (behind || showWall) void resolveWinUrl();
	});
</script>

<!-- ⛔ THE WALL (held): full-viewport takeover for the retired generation. Off until the final tape;
     see LEGACY_WALL_ENABLED. Kept intact so re-enabling it is a one-line flip. -->
{#if showWall}
	<div class="wall" role="alertdialog" aria-modal="true" aria-label="Update required">
		<div class="wallbox">
			<div class="wk">RETRO RECEIPTS · ONE QUICK UPDATE</div>
			<h1>Match replays are coming.</h1>
			<p class="wp">
				We're about to launch full <b>match replays</b> — watch any game back and study it, round by round. Your
				desktop app (v{ver}) is a generation behind and can't record them. Install the new <b>Retro Receipts agent</b>{latest ? ` (v${latest})` : ''} now, so
				every match you play from here is ready to replay the day it goes live. Your history carries over — tied to your Steam account, not the app.
			</p>
			<a class="wbtn" href={MIGRATE_INSTALLER}>⬇ INSTALL THE NEW AGENT</a>
			<ol class="wsteps">
				<li>Run the installer — it removes the old <b>MetaSync</b> app and sets up the new one for you. No wizard, nothing to click through.</li>
				<li>Your account, stats and match history carry over automatically.</li>
				<li>This screen clears itself the moment the new agent checks in.</li>
			</ol>
			<p class="wfoot">Wrong account? Sign out from the top bar.</p>
		</div>
	</div>
{/if}

<!-- 📣 BIG · LOUD · BROAD upgrade notice — every signed-in user behind the latest release. -->
{#if behind && !showWall}
	<div class="notice" class:legacy role="alert" aria-label="Update your desktop app">
		<span class="nbolt" aria-hidden="true">⚠</span>
		<div class="ncore">
			<div class="nk">UPDATE REQUIRED{ver ? ` · YOU'RE ON v${ver}` : ''}</div>
			<h2 class="nh">Upgrade now — your replays won't work until you do.</h2>
			<p class="np">
				{#if legacy}
					Your desktop app is a generation behind. Match replays and receipts need the new
					<b>RETRO RECEIPTS agent</b>{latest ? ` (v${latest})` : ''} — the installer swaps it in and your
					history carries over.
				{:else}
					A newer agent{latest ? ` (v${latest})` : ''} fixes match replays — recordings from an older
					build don't play back right. It self-installs within the hour; grab it now to skip the wait.
				{/if}
			</p>
		</div>
		<a class="nbtn" href={dl}>⬇ {legacy ? 'DOWNLOAD & INSTALL' : `GET v${latest || 'LATEST'}`}</a>
	</div>
{/if}

<style>
	/* ── held wall ─────────────────────────────────────────────────────────── */
	.wall {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--gold) 8%, transparent), transparent 55%), var(--bg);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		overflow-y: auto;
	}
	.wallbox {
		max-width: 480px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--r, 14px);
		padding: 26px 28px;
	}
	.wk {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.2em;
		color: var(--gold);
	}
	.wallbox h1 {
		font-size: 26px;
		font-weight: 900;
		font-style: italic;
		margin: 8px 0 10px;
	}
	.wp {
		color: var(--dim);
		font-size: 13.5px;
		line-height: 1.55;
		margin: 0 0 16px;
	}
	.wp b {
		color: var(--ink);
	}
	.wbtn {
		display: block;
		text-align: center;
		text-decoration: none;
		font-weight: 900;
		font-style: italic;
		font-size: 14px;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-radius: 10px;
		padding: 12px 0;
		margin-bottom: 16px;
	}
	.wsteps {
		margin: 0;
		padding-left: 20px;
		color: var(--dim);
		font-size: 12px;
		line-height: 1.6;
	}
	.wsteps li {
		margin: 4px 0;
	}
	.wfoot {
		margin: 14px 0 0;
		font-size: 10.5px;
		color: var(--faint);
	}

	/* ── big · loud · broad notice ─────────────────────────────────────────── */
	.notice {
		display: flex;
		align-items: center;
		gap: 18px;
		margin: 12px 0 18px;
		padding: 18px 22px;
		border: 2px solid color-mix(in srgb, var(--bad, #e0483d) 60%, transparent);
		border-left-width: 8px;
		border-radius: 14px;
		background:
			radial-gradient(140% 120% at 0% 0%, color-mix(in srgb, var(--bad, #e0483d) 16%, transparent), transparent 60%),
			var(--card);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--bad, #e0483d) 22%, transparent), 0 10px 34px rgba(0, 0, 0, 0.35);
		animation: notice-pulse 2.6s ease-in-out infinite;
	}
	.notice.legacy {
		border-color: color-mix(in srgb, var(--bad, #e0483d) 80%, transparent);
	}
	.nbolt {
		flex: none;
		font-size: 34px;
		line-height: 1;
		filter: drop-shadow(0 0 10px color-mix(in srgb, var(--bad, #e0483d) 55%, transparent));
	}
	.ncore {
		min-width: 0;
		flex: 1;
	}
	.nk {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.18em;
		color: var(--bad, #e0483d);
	}
	.nh {
		margin: 5px 0 7px;
		font-size: clamp(18px, 3.4vw, 25px);
		font-weight: 900;
		font-style: italic;
		line-height: 1.12;
		color: var(--ink);
		text-wrap: balance;
	}
	.np {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--dim);
	}
	.np b {
		color: var(--ink);
	}
	.nbtn {
		flex: none;
		align-self: center;
		text-decoration: none;
		white-space: nowrap;
		font-weight: 900;
		font-style: italic;
		font-size: 15px;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-radius: 12px;
		padding: 14px 22px;
		box-shadow: 0 6px 18px color-mix(in srgb, var(--gold) 30%, transparent);
	}
	@keyframes notice-pulse {
		0%, 100% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--bad, #e0483d) 22%, transparent), 0 10px 34px rgba(0, 0, 0, 0.35); }
		50% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--bad, #e0483d) 45%, transparent), 0 10px 40px color-mix(in srgb, var(--bad, #e0483d) 22%, transparent); }
	}
	@media (prefers-reduced-motion: reduce) {
		.notice { animation: none; }
	}
	@media (max-width: 560px) {
		.notice { flex-wrap: wrap; gap: 12px; padding: 16px; }
		.nbtn { width: 100%; text-align: center; }
	}
</style>
