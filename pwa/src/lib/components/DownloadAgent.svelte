<script lang="ts">
	import { browser } from '$app/environment';
	import { agent } from '$lib/stores/agent.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { api } from '$lib/config';

	// 📥 "Get the desktop agent" prompt. The web app only fills up once the tray agent is running (it reads
	// the game and reports matches/ranks/money), so nudge anyone who doesn't have one. AUTO-HIDES the moment
	// an agent is detected reporting for the signed-in user — that's `agent.reporting` (false when signed-out
	// OR when no agent has reported a build; true only once one has). The AgentChip owns the load lifecycle
	// app-wide, so this just reads the same signal.
	// The Windows link resolves from the SAME manifest the tray's self-updater reads, so a renamed or moved
	// release asset needs no edit here — that held through the metasync-agent -> rr-agent rename in 0.3.8,
	// which the button picked up with no deploy. This URL is only the fallback for when that fetch can't
	// happen (offline, blocked, malformed manifest); it floats to the newest release so only a further
	// FILENAME change would strand it.
	// Linux needs no equivalent: it installs through install-bazzite.sh, which resolves the binary itself.
	const WIN_URL_FALLBACK =
		'https://github.com/t3chnicallyinclined/RetroReceipts-agent/releases/latest/download/rr-agent.exe';
	const LINUX_CMD = 'curl -fsSL https://nobd.net/rr/update/install-bazzite.sh | bash';

	let winUrl = $state(WIN_URL_FALLBACK);

	async function resolveWinUrl() {
		try {
			const res = await fetch(api('/rr/update/agent-latest.json'), { cache: 'no-store' });
			if (!res.ok) return; // keep the fallback
			const url = (await res.json())?.url;
			// Only trust an absolute https URL — never let a bad manifest point the button somewhere odd.
			if (typeof url === 'string' && url.startsWith('https://')) winUrl = url;
		} catch {
			/* offline / blocked / unparseable — the fallback URL already works */
		}
	}

	// Lead with the visitor's platform (both are always reachable once expanded).
	const isLinux = browser && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);

	let expanded = $state(false);
	let copied = $state(false);
	let dismissed = $state(false);

	// Session-dismiss so it isn't naggy within a visit; it returns next session until an agent is detected.
	if (browser) {
		try {
			dismissed = sessionStorage.getItem('rr_dl_dismissed') === '1';
		} catch {
			/* private mode / blocked storage — just show it */
		}
	}
	function dismiss() {
		dismissed = true;
		try {
			sessionStorage.setItem('rr_dl_dismissed', '1');
		} catch {
			/* ignore */
		}
	}
	async function copyLinux() {
		try {
			await navigator.clipboard.writeText(LINUX_CMD);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard blocked — the command is visible to select manually */
		}
	}

	const show = $derived(browser && !agent.reporting && !dismissed);

	// Resolve once, as soon as the prompt is actually shown — not on every page load, and early enough that
	// the href is correct well before anyone expands the options and clicks.
	let resolving = false;
	$effect(() => {
		if (show && !resolving) {
			resolving = true;
			resolveWinUrl();
		}
	});
</script>

{#if show}
	<div class="dl">
		<div class="row">
			<span class="ic" aria-hidden="true">📥</span>
			<span class="msg"><b>Get the desktop agent</b> — it auto-tracks your matches, ranks & money games.</span>
			<button type="button" class="get" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
				{expanded ? 'Hide' : 'Download ▸'}
			</button>
			<button type="button" class="x" aria-label="Dismiss" title="Dismiss" onclick={dismiss}>×</button>
		</div>

		{#if expanded}
			<div class="opts">
				<a class="plat win" class:lead={!isLinux} href={winUrl}>
					<span class="pi" aria-hidden="true">🪟</span> Download for Windows
				</a>
				<div class="plat lin" class:lead={isLinux}>
					<span class="pi" aria-hidden="true">🐧</span>
					<span class="lnl">Linux / Steam Deck — run this:</span>
					<code class="cmd">{LINUX_CMD}</code>
					<button type="button" class="copy" onclick={copyLinux}>{copied ? '✓ Copied' : 'Copy'}</button>
				</div>
				{#if !auth.authed}
					<p class="note">After installing, sign in with Steam here so your stats link up.</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.dl {
		margin: 6px 0 2px;
		border: 1px solid color-mix(in srgb, var(--gold) 30%, var(--line));
		border-radius: 12px;
		background: linear-gradient(100deg, var(--gold-soft), transparent 70%), var(--panel);
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
	}
	.ic {
		font-size: 15px;
		line-height: 1;
		flex: none;
	}
	.msg {
		font-size: 12.5px;
		color: var(--dim);
		min-width: 0;
		flex: 1;
	}
	.msg b {
		color: var(--ink);
		font-weight: 800;
	}
	.get {
		flex: none;
		font: inherit;
		font-size: 12px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 6px 12px;
		cursor: pointer;
		white-space: nowrap;
		transform: skewX(-8deg);
	}
	.get:hover {
		filter: brightness(1.05);
	}
	.x {
		flex: none;
		font: inherit;
		font-size: 16px;
		line-height: 1;
		color: var(--faint);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 8px;
		width: 30px;
		height: 30px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.opts {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0 12px 11px;
	}
	.plat {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		padding: 9px 11px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel-2);
		font-size: 12.5px;
		color: var(--ink);
		text-decoration: none;
	}
	.plat.lead {
		border-color: var(--gold-soft);
	}
	a.plat.win {
		font-weight: 800;
	}
	a.plat.win:hover {
		border-color: var(--gold);
		color: var(--gold);
	}
	.pi {
		font-size: 14px;
		flex: none;
	}
	.lnl {
		color: var(--dim);
		flex: none;
	}
	.cmd {
		font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
		font-size: 11.5px;
		color: var(--gold);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 4px 8px;
		overflow-x: auto;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
	.copy {
		flex: none;
		font: inherit;
		font-size: 11px;
		font-weight: 800;
		color: var(--dim);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 7px;
		padding: 5px 10px;
		cursor: pointer;
	}
	.copy:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.note {
		margin: 2px 0 0;
		font-size: 11.5px;
		color: var(--faint);
	}
	@media (max-width: 520px) {
		.msg {
			font-size: 12px;
		}
	}
</style>
