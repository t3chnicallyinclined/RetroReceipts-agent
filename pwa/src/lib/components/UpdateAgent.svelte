<script lang="ts">
	import { agent } from '$lib/stores/agent.svelte';
	import { api } from '$lib/config';

	// 🔔 "Your desktop app is outdated" banner. Shows only when an agent IS reporting for the signed-in
	// user AND the server says its build is behind (`update_available`, computed against LATEST_AGENT_VER).
	// Two intensities:
	//   • URGENT (red) — 0.1.x / 0.2.x: the legacy MetaSync generation. Its self-updater only offers what
	//     the legacy manifest advertises, so these users stay stuck until they act (or until the 0.2.7
	//     migration release lands). No dismiss: being a generation behind breaks receipts/money/skins.
	//   • NORMAL (gold) — an out-of-date rr-agent. Those self-update within the hour; the banner mentions
	//     that and offers the manual grab for the builds whose updater was broken (0.3.8-era dir move).
	// The download link resolves from the SAME manifest the tray self-updater reads (DownloadAgent's
	// pattern) so a renamed release asset never strands this button.
	const WIN_URL_FALLBACK =
		'https://github.com/t3chnicallyinclined/RetroReceipts-agent/releases/latest/download/rr-agent.exe';
	let winUrl = $state(WIN_URL_FALLBACK);

	// LEGACY MIGRATION INSTALLER — the retired MetaSync generation gets a real INSTALLER, not the bare
	// self-update exe: it uninstalls MetaSync, installs the new agent as a findable Windows citizen, and
	// launches it (zero manual steps). Modern stale agents keep the bare exe (their own updater swaps it).
	const MIGRATE_INSTALLER =
		'https://github.com/t3chnicallyinclined/RetroReceipts-agent/releases/download/v0.3.28/RetroReceipts-Setup.exe';
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
	// LEGACY = the retired MetaSync Tauri generation. Gate on the LAST-KNOWN agent version (not on
	// live reporting) — closing the old app must not dodge the wall; installing the new agent clears
	// it the moment the new build reports.
	const legacy = $derived(ver.startsWith('0.1.') || ver.startsWith('0.2.'));
	const show = $derived(!legacy && agent.reporting && agent.status?.update_available === true);
	$effect(() => {
		if (show || legacy) void resolveWinUrl();
	});
</script>

<!-- ⛔ THE WALL (Tris 2026-08-27): a signed-in user whose last agent is the retired MetaSync
     generation sees NOTHING but this — full-viewport takeover, no dismiss, one path forward.
     It clears itself the moment a modern agent reports for this account. -->
{#if legacy}
	<div class="wall" role="alertdialog" aria-modal="true" aria-label="Update required">
		<div class="wallbox">
			<div class="wk">RETRO RECEIPTS · REQUIRED UPDATE</div>
			<h1>MetaSync is retired.</h1>
			<p class="wp">
				Your desktop app (v{ver}) is a generation behind and no longer works right with the arcade —
				money matches, receipts, ranked tracking and skins have moved on. To keep playing, install
				the new <b>RETRO RECEIPTS agent</b>{latest ? ` (v${latest})` : ''}.
			</p>
			<a class="wbtn" href={MIGRATE_INSTALLER}>⬇ DOWNLOAD &amp; INSTALL</a>
			<ol class="wsteps">
				<li>Run the downloaded installer. It removes the old MetaSync app and installs the new one for you — no wizard, nothing to click through.</li>
				<li>Your sign-in and full match history carry over automatically (they're tied to your Steam account, not the app).</li>
				<li>This screen disappears on its own the moment the new agent checks in.</li>
			</ol>
			<p class="wfoot">Signed in as {agent.status ? 'this account' : ''} — wrong account? Sign out from the top bar.</p>
		</div>
	</div>
{/if}

{#if show}
	<div class="upd" class:urgent={legacy}>
		{#if legacy}
			<span class="txt"
				><b>Your desktop app is a generation behind (v{ver}).</b> MetaSync became RETRO RECEIPTS —
				money matches, receipts and skins need the new app. Install it, then MetaSync can be
				uninstalled.</span
			>
		{:else}
			<span class="txt"
				><b>Agent update available</b> — v{latest} (you're on v{ver}). It normally installs itself
				within the hour; if yours hasn't, grab it here.</span
			>
		{/if}
		<a class="get" href={winUrl}>⬇ GET v{latest || 'LATEST'}</a>
	</div>
{/if}

<style>
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
	.upd {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 8px 0;
		padding: 10px 13px;
		border: 1px solid color-mix(in srgb, var(--gold) 50%, var(--line));
		border-radius: 11px;
		background: var(--gold-soft);
	}
	.upd.urgent {
		border-color: color-mix(in srgb, var(--bad, #c33) 55%, var(--line));
		background: color-mix(in srgb, var(--bad, #c33) 9%, var(--panel));
	}
	.txt {
		font-size: 12.5px;
		color: var(--dim);
		min-width: 0;
	}
	.txt b {
		color: var(--ink);
	}
	.get {
		font-size: 11.5px;
		font-weight: 800;
		white-space: nowrap;
		text-decoration: none;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-radius: 999px;
		padding: 7px 13px;
	}
</style>
