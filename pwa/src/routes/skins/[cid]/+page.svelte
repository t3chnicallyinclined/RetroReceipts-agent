<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import CharSprite from '$lib/components/CharSprite.svelte';
	import DyeStation from '$lib/components/DyeStation.svelte';
	import { CHAR_NAME } from '$lib/chars';
	import { STOCK_PALETTES } from '$lib/stockPalettes';
	import { auth } from '$lib/stores/auth.svelte';
	import { vault, type VaultSkin } from '$lib/stores/vault.svelte';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { encodeSkin, decodeSkin } from '$lib/skincodes';
	import { paletteKey } from '$lib/palette';

	// 🎨 THE RACK — one character's shelf of hanging skins. Tap any card and the stage sprite wears it
	// instantly (try-on is free); WEAR IT commits it to the loadout — the agent paints it live in-game and
	// every surface on the platform mirrors it. Editing launches from here (+ NEW / EDIT / REMIX) into the
	// Dye Station. Cards: your vault saves for this character, the stock palette, and any imported code.
	const cid = $derived(Number(page.params.cid));
	const name = $derived(CHAR_NAME[cid] ?? `#${page.params.cid}`);
	const stock = $derived(STOCK_PALETTES[cid] ?? []);

	$effect(() => {
		if (auth.authed) void vault.load();
	});
	const mine = $derived(loadouts.of(auth.steamid));
	const equipped = $derived(mine?.[cid] ?? null); // null = stock

	// an incoming share code for THIS character hangs as a card
	const codeSkin = $derived.by(() => {
		const c = page.url.searchParams.get('code');
		if (!c) return null;
		const d = decodeSkin(c);
		return d && d.cid === cid ? d : null;
	});

	// ── try-on state: what the stage wears right now ──
	type Trying = { pal: string[]; name: string; by: string; vaultId: string | null };
	let trying = $state<Trying | null>(null);
	$effect(() => {
		void cid;
		trying = null; // navigating characters resets the fitting room
	});
	const stagePal = $derived(trying?.pal ?? equipped ?? null);
	const stageName = $derived.by(() => {
		if (trying) return trying.name;
		if (!equipped) return 'Stock';
		const v = vault.forChar(cid).find((s) => paletteKey(s.palette) === paletteKey(equipped));
		return v?.name ?? 'Custom';
	});
	const isWearingStage = $derived(
		paletteKey(stagePal ?? stock) === paletteKey(equipped ?? stock)
	);

	function tryOn(pal: string[], nm: string, by: string, vaultId: string | null = null) {
		trying = { pal: pal.slice(), name: nm, by, vaultId };
	}
	let busy = $state(false);
	let toast = $state('');
	let wornPulse = $state(false);
	function flash(m: string) {
		toast = m;
		setTimeout(() => { if (toast === m) toast = ''; }, 2400);
	}
	async function wear() {
		if (busy || !auth.authed) return;
		busy = true;
		const pal = stagePal ?? stock;
		const isStock = paletteKey(pal) === paletteKey(stock);
		const ok = isStock ? await loadouts.resetOwn(cid) : await loadouts.equipOwn(cid, pal);
		busy = false;
		if (ok) {
			wornPulse = true;
			setTimeout(() => (wornPulse = false), 700);
			flash(`⚔ ${name} wears “${stageName}” — live in-game · receipts · boards`);
			trying = null;
		} else flash('⚠ could not equip — signed in with the agent running?');
	}

	async function delSkin(v: VaultSkin) {
		if (await vault.remove(v.id)) flash(`🗑 “${v.name}” deleted`);
	}
	function copyCode(v: { cid: number; name: string; palette: string[] }, by = '') {
		void navigator.clipboard?.writeText(encodeSkin({ cid: v.cid, name: v.name, author: by, palette: v.palette }));
		flash('📋 share code copied — paste it anywhere');
	}

	// ── COMMUNITY LIBRARY — the legacy studio's 8,936-skin collection, per character, with the creator
	// credited under every palette (the PalMod-scene tradition, structural). Static per-char JSON
	// ({a: author, p: [16 ints]}), lazy-fetched when the rack opens. Tap = the same free try-on as any card.
	type CommunitySkin = { a: string; p: number[] };
	let community = $state<CommunitySkin[]>([]);
	let commQ = $state('');
	let commShow = $state(24);
	$effect(() => {
		const c = cid;
		community = [];
		commQ = '';
		commShow = 24;
		void fetch(`${base}/community/${c}.json`)
			.then((r) => (r.ok ? r.json() : []))
			.then((j) => {
				if (c === cid && Array.isArray(j)) community = j;
			})
			.catch(() => {});
	});
	const commHex = (p: number[]): string[] =>
		p.slice(0, 16).map((n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0'));
	const commFiltered = $derived.by(() => {
		const q = commQ.trim().toLowerCase();
		return q ? community.filter((s) => s.a.toLowerCase().includes(q)) : community;
	});

	// ── editor launch ──
	let editing = $state<{ seed: string[]; name: string; vaultId: string | null } | null>(null);
	const openNew = () => (editing = { seed: (stagePal ?? stock).slice(), name: '', vaultId: null });
	const openEdit = (v: VaultSkin) => (editing = { seed: v.palette.slice(), name: v.name, vaultId: v.id });
	const openRemix = (pal: string[], nm: string) => (editing = { seed: pal.slice(), name: nm ? `${nm} remix` : '', vaultId: null });
</script>

<svelte:head><title>{name} · Skins · Retro Receipts</title></svelte:head>

<div class="rk">
	<div class="stage-col">
		<a class="back" href="{base}/skins">← LOCKER</a>
		<div class="stage" class:pulse={wornPulse}>
			<CharSprite id={cid} eager palette={stagePal} />
		</div>
		<div class="meta">
			<div class="snm">“{stageName}”</div>
			{#if trying}
				<div class="prov trying-b">TRYING{trying.by ? ` · by ${trying.by}` : ''} — not equipped yet</div>
			{:else if isWearingStage}
				<div class="prov worn-b">● WORN — this is what the arena sees</div>
			{/if}
		</div>
		{#if auth.authed}
			<button class="wear" onclick={wear} disabled={busy || (!trying && isWearingStage)}>
				{!trying && isWearingStage ? '● WORN' : 'WEAR IT'}
			</button>
		{:else}
			<button class="wear" onclick={() => auth.login()}>Sign in to wear skins</button>
		{/if}
	</div>

	<div class="rack-col">
		<div class="hd"><span>THE RACK · {name}</span><span>{vault.forChar(cid).length} SAVED</span></div>

		{#if codeSkin}
			<div class="card code">
				<span class="face"><CharSprite id={cid} still palette={codeSkin.palette} /></span>
				<span class="inf">
					<span class="cnm">{codeSkin.name || 'Shared skin'}</span>
					<span class="by">shared code{codeSkin.author ? ` · by ${codeSkin.author}` : ''}</span>
					<span class="strip">{#each codeSkin.palette.slice(0, 12) as c, i (i)}<i style="background:{c}"></i>{/each}</span>
				</span>
				<span class="acts">
					<button class="a try" onclick={() => tryOn(codeSkin.palette, codeSkin.name || 'Shared skin', codeSkin.author)}>TRY ON</button>
					{#if auth.authed}<button class="a" onclick={() => vault.save(cid, codeSkin.name || 'Shared skin', codeSkin.palette).then((id) => flash(id != null ? '🗂 saved to your vault' : '⚠ vault save failed'))}>SAVE</button>{/if}
				</span>
			</div>
		{/if}

		{#each vault.forChar(cid) as v (v.id)}
			{@const isWorn = equipped != null && paletteKey(v.palette) === paletteKey(equipped)}
			<div class="card" class:worn={isWorn}>
				<span class="face"><CharSprite id={cid} still palette={v.palette} /></span>
				<span class="inf">
					<span class="cnm">{v.name || 'Unnamed'}</span>
					<span class="by">by you</span>
					<span class="strip">{#each v.palette.slice(0, 12) as c, i (i)}<i style="background:{c}"></i>{/each}</span>
				</span>
				<span class="acts">
					{#if isWorn}<span class="wb">● WORN</span>{:else}<button class="a try" onclick={() => tryOn(v.palette, v.name, 'you', v.id)}>TRY ON</button>{/if}
					<button class="a" onclick={() => openEdit(v)}>EDIT</button>
					<button class="a" onclick={() => copyCode(v)}>CODE</button>
					<button class="a del" onclick={() => delSkin(v)}>✕</button>
				</span>
			</div>
		{/each}

		<div class="card" class:worn={equipped == null}>
			<span class="face"><CharSprite id={cid} still /></span>
			<span class="inf">
				<span class="cnm">Stock</span>
				<span class="by">CAPCOM · 2000</span>
				<span class="strip">{#each stock.slice(0, 12) as c, i (i)}<i style="background:{c}"></i>{/each}</span>
			</span>
			<span class="acts">
				{#if equipped == null}<span class="wb">● WORN</span>{:else}<button class="a try" onclick={() => tryOn(stock, 'Stock', 'CAPCOM')}>TRY ON</button>{/if}
				<button class="a" onclick={() => openRemix(stock, '')}>REMIX</button>
			</span>
		</div>

		{#if auth.authed}
			<button class="newbtn" onclick={openNew}>+ NEW SKIN — open the dye station</button>
		{/if}

		{#if community.length}
			<div class="chd">
				<span>COMMUNITY · {community.length} SKINS — after the PalMod scene</span>
				<input class="cq" type="search" placeholder="search creators…" bind:value={commQ} />
			</div>
			<div class="cgrid">
				{#each commFiltered.slice(0, commShow) as cs, i (i)}
					{@const pal = commHex(cs.p)}
					<button class="ck" onclick={() => tryOn(pal, cs.a ? `by ${cs.a}` : 'Community skin', cs.a)} title={cs.a}>
						<span class="cbar">{#each pal.slice(1) as c, k (k)}<i style="background:{c}"></i>{/each}</span>
						<span class="cby">{cs.a || 'unknown'}</span>
					</button>
				{/each}
			</div>
			{#if commFiltered.length > commShow}
				<button class="more" onclick={() => (commShow += 48)}>show more · {commFiltered.length - commShow} left</button>
			{/if}
		{/if}

		<p class="note">Try-on is free — only WEAR IT changes what the arena sees. Share codes carry your name with the colors. Community palettes are credited to their creators.</p>
	</div>
</div>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

{#if editing}
	<DyeStation
		{cid}
		seed={editing.seed}
		seedName={editing.name}
		vaultId={editing.vaultId}
		onClose={() => {
			editing = null;
			if (auth.authed) void vault.load(true);
		}}
	/>
{/if}

<style>
	.rk {
		display: grid;
		grid-template-columns: 1fr 1.2fr;
		gap: 0;
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		margin: 10px 0 30px;
		background: var(--panel);
	}
	.stage-col {
		position: relative;
		padding: 16px;
		background: radial-gradient(110% 90% at 50% 20%, #141826 0%, var(--bg) 70%);
		display: flex;
		flex-direction: column;
		align-items: center;
		border-right: 1px solid var(--line);
	}
	.back {
		align-self: flex-start;
		font-family: ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.14em;
		color: var(--faint);
		text-decoration: none;
	}
	.back:hover {
		color: var(--ink);
	}
	.stage {
		width: min(100%, 280px);
		height: 280px;
		margin-top: 8px;
	}
	.stage.pulse {
		animation: wearpulse 0.65s ease-out 1;
	}
	@keyframes wearpulse {
		0% {
			transform: scale(1);
			filter: drop-shadow(0 0 0 rgba(139, 109, 255, 0));
		}
		35% {
			transform: scale(1.06);
			filter: drop-shadow(0 0 22px rgba(139, 109, 255, 0.55));
		}
		100% {
			transform: scale(1);
			filter: drop-shadow(0 0 0 rgba(139, 109, 255, 0));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.stage.pulse {
			animation: none;
		}
	}
	.meta {
		text-align: center;
		margin-top: 10px;
	}
	.snm {
		font-style: italic;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 19px;
	}
	.prov {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		margin-top: 4px;
	}
	.worn-b {
		color: var(--stream);
	}
	.trying-b {
		color: var(--dim);
	}
	.wear {
		font: inherit;
		font-style: italic;
		font-weight: 900;
		font-size: 16px;
		letter-spacing: 0.05em;
		margin-top: 14px;
		padding: 10px 38px;
		border: none;
		border-radius: 10px;
		color: #241700;
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		cursor: pointer;
	}
	.wear:disabled {
		background: var(--panel-2);
		color: var(--stream);
		border: 1px solid color-mix(in srgb, var(--stream) 45%, var(--line));
		cursor: default;
	}
	.rack-col {
		padding: 14px 16px;
	}
	.hd {
		display: flex;
		justify-content: space-between;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		letter-spacing: 0.18em;
		color: var(--faint);
		margin-bottom: 10px;
	}
	.card {
		display: flex;
		align-items: center;
		gap: 11px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel-2);
		padding: 9px 12px;
		margin-bottom: 8px;
	}
	.card.worn {
		border-color: color-mix(in srgb, var(--stream) 60%, var(--line));
		background: linear-gradient(90deg, color-mix(in srgb, var(--stream) 9%, transparent), transparent 60%), var(--panel-2);
	}
	.card.code {
		border-style: dashed;
		border-color: color-mix(in srgb, var(--stream) 50%, var(--line));
	}
	.face {
		flex: none;
		width: 44px;
		height: 44px;
	}
	.inf {
		flex: 1;
		min-width: 0;
	}
	.cnm {
		display: block;
		font-weight: 800;
		font-size: 14px;
		text-transform: uppercase;
		font-style: italic;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.by {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		color: var(--dim);
	}
	.strip {
		display: flex;
		gap: 1px;
		margin-top: 4px;
	}
	.strip i {
		width: 9px;
		height: 9px;
		border-radius: 2px;
	}
	.acts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}
	.a {
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 8.5px;
		letter-spacing: 0.08em;
		padding: 4px 9px;
		border: 1px solid var(--line);
		border-radius: 7px;
		background: transparent;
		color: var(--dim);
		cursor: pointer;
	}
	.a.try {
		color: var(--stream);
		border-color: color-mix(in srgb, var(--stream) 45%, var(--line));
	}
	.a.del {
		color: var(--molten, #ff5c2c);
	}
	.a:hover {
		color: var(--ink);
	}
	.wb {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--stream);
	}
	.newbtn {
		font: inherit;
		width: 100%;
		font-family: ui-monospace, monospace;
		font-size: 10.5px;
		letter-spacing: 0.08em;
		padding: 11px 0;
		margin-top: 6px;
		border: 1px dashed color-mix(in srgb, var(--stream) 45%, var(--line));
		border-radius: 10px;
		background: transparent;
		color: var(--stream);
		cursor: pointer;
	}
	.note {
		font-size: 11.5px;
		color: var(--faint);
		margin-top: 10px;
	}
	.chd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.16em;
		color: var(--faint);
		margin: 16px 0 8px;
	}
	.cq {
		font: inherit;
		font-size: 11px;
		letter-spacing: 0.02em;
		padding: 5px 10px;
		width: 150px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
	}
	.cq:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--stream) 55%, var(--line));
	}
	.cgrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
		gap: 7px;
	}
	.ck {
		font: inherit;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		padding: 7px 8px 6px;
		cursor: pointer;
		text-align: left;
	}
	.ck:hover {
		border-color: color-mix(in srgb, var(--stream) 55%, var(--line));
		transform: translateY(-1px);
	}
	.cbar {
		display: flex;
		height: 16px;
		border-radius: 4px;
		overflow: hidden;
		border: 1px solid rgba(0, 0, 0, 0.35);
	}
	.cbar i {
		flex: 1;
	}
	.cby {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 8.5px;
		color: var(--dim);
		margin-top: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.more {
		font: inherit;
		width: 100%;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		letter-spacing: 0.1em;
		padding: 9px 0;
		margin-top: 8px;
		border: 1px dashed var(--line);
		border-radius: 9px;
		background: transparent;
		color: var(--dim);
		cursor: pointer;
	}
	.more:hover {
		color: var(--stream);
		border-color: color-mix(in srgb, var(--stream) 45%, var(--line));
	}
	.toast {
		position: fixed;
		left: 50%;
		bottom: 76px;
		transform: translateX(-50%);
		z-index: 95;
		padding: 9px 16px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
		font-size: 12.5px;
		font-weight: 600;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		white-space: nowrap;
	}
	@media (max-width: 700px) {
		.rk {
			grid-template-columns: 1fr;
		}
		.stage-col {
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
		.stage {
			height: 40vh;
		}
	}
</style>
