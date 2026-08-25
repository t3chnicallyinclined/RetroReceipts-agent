<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import CharSprite from '$lib/components/CharSprite.svelte';
	import { CHAR_NAME } from '$lib/chars';
	import { STOCK_PALETTES } from '$lib/stockPalettes';
	import { auth } from '$lib/stores/auth.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { teams } from '$lib/stores/teams.svelte';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { apiGet } from '$lib/net.svelte';
	import { decodeSkin } from '$lib/skincodes';
	import { paletteKey } from '$lib/palette';

	// 🎨 THE LOCKER — your persistent character-select screen. Your three mains stand center-stage wearing
	// exactly what the whole arena sees (the stage renders from the SAME live loadout as receipts, boards
	// and live cards — a mirror, not a mockup). The roster is a shelf below; each character opens their
	// RACK (/skins/<cid>). A pasted ?code= lands here and routes to the right character's rack.
	// STOCK_PALETTES carries a few non-playable palette banks (ids 24–26) — the roster is the NAMED cast
	const roster = Object.keys(STOCK_PALETTES).map(Number).filter((c) => CHAR_NAME[c]).sort((a, b) =>
		CHAR_NAME[a].localeCompare(CHAR_NAME[b])
	);

	$effect(() => {
		if (auth.authed) {
			void vault.load();
			void teams.load();
		}
	});
	let teamName = $state('');
	let teamMsg = $state('');
	function tflash(m: string) {
		teamMsg = m;
		setTimeout(() => { if (teamMsg === m) teamMsg = ''; }, 2600);
	}
	async function saveTeam() {
		const nm = teamName.trim();
		if (!nm) { tflash('name your team first'); return; }
		tflash((await teams.saveCurrent(nm)) ? `🗂 “${nm}” saved — your whole current loadout` : '⚠ could not save (dress someone first?)');
		teamName = '';
	}
	async function wearTeam(id: string) {
		const t = teams.teams.find((x) => x.id === id);
		if (!t) return;
		const n = await teams.apply(t);
		tflash(n ? `⚔ “${t.name}” — ${n} fighter${n === 1 ? '' : 's'} dressed` : '⚠ could not apply');
	}
	const mine = $derived(loadouts.of(auth.steamid));
	const dressed = $derived(mine ? Object.keys(mine).length : 0);

	// mains: the most-played team from MY profile (profile.teams[0].team = "42,44,50"), fallback to my
	// customized characters, fallback to a classic trio — the stage must never be empty.
	let mains = $state<number[]>([44, 42, 8]);
	$effect(() => {
		const sid = auth.steamid;
		if (!sid) return;
		void apiGet<{ teams?: { team?: string; games?: number }[] }>(`/rr/profile?steamid=${sid}`, { ttl: 30_000 })
			.then((j) => {
				const top = j?.teams?.[0]?.team;
				const ids = top ? top.split(',').map(Number).filter((n) => Number.isFinite(n) && CHAR_NAME[n]) : [];
				if (ids.length === 3) mains = ids;
				else {
					const custom = Object.keys(loadouts.peek(sid) ?? {}).map(Number).slice(0, 3);
					if (custom.length) mains = [...custom, 44, 42, 8].slice(0, 3);
				}
			})
			.catch(() => {});
	});
	const ROLES = ['POINT', 'SECOND', 'ANCHOR'];

	/** the equipped skin's display name for a character (matched against the vault), or null when stock */
	function skinLabel(cid: number): string | null {
		const pal = mine?.[cid];
		if (!pal) return null;
		const v = vault.forChar(cid).find((s) => paletteKey(s.palette) === paletteKey(pal));
		return v?.name ?? 'Custom';
	}

	// customized characters shelf-sort: dressed first, then alphabetical
	const shelf = $derived(
		[...roster].sort((a, b) => {
			const da = mine?.[a] ? 0 : 1, db = mine?.[b] ? 0 : 1;
			return da - db || (CHAR_NAME[a] ?? '').localeCompare(CHAR_NAME[b] ?? '');
		})
	);

	// a pasted share link lands here — route it to the right character's rack
	$effect(() => {
		const code = page.url.searchParams.get('code');
		if (!code) return;
		const d = decodeSkin(code);
		if (d) void goto(`${base}/skins/${d.cid}?code=${encodeURIComponent(code)}`, { replaceState: true });
	});
</script>

<svelte:head><title>The Locker · Retro Receipts</title></svelte:head>

<section class="mast" style="--acc:#8b6dff">
	<div class="ghost" aria-hidden="true">LOCKER</div>
	<div class="mrow">
		<h1 class="mtitle">THE LOCKER</h1>
		<span class="pill">SKINS</span>
		{#if auth.authed}<span class="dressed">DRESSED {dressed}/{roster.length}</span>{/if}
	</div>
	<div class="seam" aria-hidden="true"></div>
	<p class="mdesc">Your fighters, your colors — painted live in the real game and worn on every receipt, board and live card. Tap a character to open their rack: try skins on free, wear one in one tap, or make your own in the dye station.</p>
</section>

{#if !auth.authed}
	<div class="signin">
		<p>Sign in with Steam to open your locker — your skins follow your SteamID, and your running agent paints them live in your matches.</p>
		<button class="steam" onclick={() => auth.login()}>Sign in through Steam</button>
	</div>
{:else}
	<!-- ── the stage: your mains, dressed — the mirror of what the arena sees ── -->
	<div class="stagebox">
		<div class="stage">
			{#each mains as cid, i (cid)}
				<a class="slot" href="{base}/skins/{cid}">
					<span class="spr"><CharSprite id={cid} eager={i === 0} palette={mine?.[cid] ?? null} /></span>
					<span class="plinth" aria-hidden="true"></span>
					<span class="nm">{CHAR_NAME[cid]}</span>
					{#if skinLabel(cid)}<span class="skn">“{skinLabel(cid)}” · ● WORN</span>{:else}<span class="skn stock">stock</span>{/if}
					<span class="role">{ROLES[i] ?? ''}</span>
				</a>
			{/each}
		</div>
		<div class="mirror">this is what the arena sees — live cards · receipts · boards render from this exact view</div>
		{#if teams.available}
			<!-- TEAMS: whole-loadout presets, MvC2's team-naming ritual as one-tap wardrobe swaps -->
			<div class="teams">
				{#each teams.teams as t (t.id)}
					<span class="tp">
						<button class="tpn" onclick={() => wearTeam(t.id)} disabled={teams.busy} title="{t.entries.length} fighters">● {t.name}</button>
						<button class="tpx" onclick={() => teams.remove(t.id)} aria-label="Delete {t.name}">✕</button>
					</span>
				{/each}
				<span class="tsave">
					<input class="tin" type="text" placeholder="save team as…" bind:value={teamName} maxlength="40" />
					<button class="tgo" onclick={saveTeam} disabled={teams.busy}>+ SAVE TEAM</button>
				</span>
			</div>
			{#if teamMsg}<div class="tmsg">{teamMsg}</div>{/if}
		{/if}
	</div>

	<!-- ── the roster shelf ── -->
	<div class="shelfhd"><span>YOUR ROSTER</span><span>DRESSED FIRST · A–Z</span></div>
	<div class="grid">
		{#each shelf as cid (cid)}
			<a class="cc" class:custom={!!mine?.[cid]} href="{base}/skins/{cid}" title={CHAR_NAME[cid]}>
				<span class="face"><CharSprite id={cid} palette={mine?.[cid] ?? null} /></span>
				<span class="cnm">{CHAR_NAME[cid]}</span>
				{#if mine?.[cid]}<span class="csk">{skinLabel(cid)}</span>{:else}<span class="csk stock">stock</span>{/if}
			</a>
		{/each}
	</div>
{/if}

<style>
	.mast {
		position: relative;
		overflow: hidden;
		padding: 14px 4px 10px;
		margin-bottom: 6px;
	}
	.ghost {
		position: absolute;
		right: 0;
		top: -6px;
		font-size: clamp(46px, 12vw, 96px);
		font-style: italic;
		font-weight: 900;
		letter-spacing: -0.03em;
		color: var(--ink);
		opacity: 0.045;
		pointer-events: none;
		user-select: none;
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.mtitle {
		font-size: clamp(20px, 5.5vw, 27px);
		font-weight: 900;
		font-style: italic;
	}
	.pill {
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.08em;
		padding: 3px 8px;
		border-radius: 6px;
		color: var(--stream);
		background: color-mix(in srgb, var(--stream) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--stream) 34%, var(--line));
	}
	.dressed {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.14em;
		color: var(--dim);
	}
	.seam {
		height: 2px;
		width: 130px;
		margin: 8px 0 10px;
		background: linear-gradient(90deg, var(--acc), transparent);
	}
	.mdesc {
		max-width: 66ch;
		color: var(--dim);
		font-size: 13.5px;
	}
	.signin {
		border: 1px dashed var(--line);
		border-radius: 14px;
		padding: 34px 18px;
		text-align: center;
		color: var(--dim);
	}
	.steam {
		font: inherit;
		font-weight: 800;
		margin-top: 14px;
		padding: 10px 22px;
		border: none;
		border-radius: 10px;
		color: #241700;
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		cursor: pointer;
	}

	/* ── the stage ── */
	.stagebox {
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		background: radial-gradient(120% 100% at 50% 0%, var(--panel-2) 0%, var(--bg) 74%);
		margin-bottom: 18px;
	}
	.stage {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		gap: clamp(18px, 6vw, 64px);
		padding: 26px 14px 10px;
	}
	.slot {
		text-align: center;
		text-decoration: none;
		color: inherit;
	}
	.slot .spr {
		display: block;
		width: clamp(84px, 15vw, 128px);
		height: clamp(84px, 15vw, 128px);
		margin: 0 auto;
		transition: transform 0.15s ease;
	}
	.slot:hover .spr {
		transform: translateY(-4px) scale(1.04);
	}
	.plinth {
		display: block;
		width: 74%;
		height: 8px;
		margin: 6px auto 8px;
		border-radius: 50%;
		background: radial-gradient(50% 100% at 50% 50%, color-mix(in srgb, var(--stream) 35%, transparent), transparent 72%);
	}
	.slot .nm {
		display: block;
		font-style: italic;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 16px;
		line-height: 1.1;
	}
	.skn {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--stream);
		margin-top: 2px;
	}
	.skn.stock {
		color: var(--faint);
	}
	.role {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 8px;
		letter-spacing: 0.24em;
		color: var(--faint);
		margin-top: 3px;
	}
	.teams {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 8px;
		padding: 4px 12px 10px;
		font-family: ui-monospace, monospace;
		font-size: 10px;
	}
	.tp {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--line);
		border-radius: 999px;
		overflow: hidden;
	}
	.tpn {
		font: inherit;
		padding: 5px 6px 5px 12px;
		background: transparent;
		border: none;
		color: var(--dim);
		cursor: pointer;
	}
	.tpn:hover {
		color: var(--stream);
	}
	.tpx {
		font: inherit;
		font-size: 9px;
		padding: 5px 9px 5px 4px;
		background: transparent;
		border: none;
		color: var(--faint);
		cursor: pointer;
	}
	.tpx:hover {
		color: var(--molten, #ff5c2c);
	}
	.tsave {
		display: inline-flex;
		gap: 6px;
	}
	.tin {
		font: inherit;
		width: 130px;
		padding: 5px 10px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
	}
	.tin:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--stream) 50%, var(--line));
	}
	.tgo {
		font: inherit;
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--stream) 45%, var(--line));
		background: transparent;
		color: var(--stream);
		cursor: pointer;
		white-space: nowrap;
	}
	.tmsg {
		text-align: center;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		color: var(--dim);
		padding-bottom: 8px;
	}
	.mirror {
		text-align: center;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--faint);
		padding: 8px 12px 12px;
	}

	/* ── shelf ── */
	.shelfhd {
		display: flex;
		justify-content: space-between;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		letter-spacing: 0.18em;
		color: var(--faint);
		margin: 4px 2px 8px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
		gap: 9px;
		margin-bottom: 34px;
	}
	.cc {
		text-decoration: none;
		color: inherit;
		border: 1px solid var(--line);
		border-radius: 11px;
		background: var(--panel);
		padding: 9px 6px 8px;
		text-align: center;
		transition: transform 0.12s ease, border-color 0.12s ease;
	}
	.cc:hover {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--stream) 50%, var(--line));
	}
	.cc.custom {
		border-color: color-mix(in srgb, var(--stream) 40%, var(--line));
	}
	.face {
		display: block;
		width: 62px;
		height: 62px;
		margin: 0 auto;
	}
	.cnm {
		display: block;
		font-weight: 700;
		font-size: 11.5px;
		margin-top: 5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.csk {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 8px;
		letter-spacing: 0.06em;
		color: var(--stream);
		margin-top: 1px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.csk.stock {
		color: var(--faint);
	}
</style>
