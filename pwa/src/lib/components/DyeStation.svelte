<script lang="ts">
	import { base } from '$app/paths';
	import CharSprite from './CharSprite.svelte';
	import { CHAR_NAME } from '$lib/chars';
	import { STOCK_PALETTES } from '$lib/stockPalettes';
	import {
		rampsOf, analyzeRamps, rampAtPoint, hueShift, applyTone, invert, retargetRamp, shuffle,
		applyTheme, THEMES, rgbToHsl, hexToRgb, type Tone
	} from '$lib/ramps';
	import { encodeSkin, decodeSkin } from '$lib/skincodes';
	import { vault } from '$lib/stores/vault.svelte';
	import { loadouts } from '$lib/stores/loadouts.svelte';
	import { auth } from '$lib/stores/auth.svelte';

	// 🎨 THE DYE STATION — "paint the fighter, not the palette". The sprite is the control surface: tap the
	// armor to select the armor (portrait pixel → stock slot → material ramp), everything else drops toward
	// grey so you always know what you're editing. The hue dial retargets a whole ramp with the STOCK
	// lightness ladder preserved, so the original artist's shading survives every edit. Novice path: tap a
	// theme mini (a tiny sprite already wearing it) → EQUIP. Power path: the PRO drawer's raw 16 slots + hex
	// + share-code import/export.
	let {
		cid,
		seed,
		seedName = '',
		vaultId = null,
		onClose
	}: {
		cid: number;
		seed: string[];
		seedName?: string;
		vaultId?: string | null;
		onClose: () => void;
	} = $props();

	const stock = $derived(STOCK_PALETTES[cid] ?? []);
	const name = $derived(CHAR_NAME[cid] ?? `#${cid}`);

	// ── palette state + history ──
	let pal = $state<string[]>([]);
	let undoStack = $state<string[][]>([]);
	let redoStack = $state<string[][]>([]);
	$effect(() => {
		// reseed when the character or seed identity changes
		void cid;
		pal = seed.slice();
		saveName = seedName;
		undoStack = [];
		redoStack = [];
	});
	function commit(next: string[]) {
		undoStack = [...undoStack.slice(-49), pal];
		redoStack = [];
		pal = next;
	}
	function undo() {
		const prev = undoStack.at(-1);
		if (!prev) return;
		undoStack = undoStack.slice(0, -1);
		redoStack = [...redoStack, pal];
		pal = prev;
	}
	function redo() {
		const next = redoStack.at(-1);
		if (!next) return;
		redoStack = redoStack.slice(0, -1);
		undoStack = [...undoStack, pal];
		pal = next;
	}

	// ── materials (ramps) ──
	let ramps = $state<ReturnType<typeof rampsOf>>([]);
	let selected = $state(0);
	let locks = $state<boolean[]>([]);
	$effect(() => {
		const c = cid;
		// ⚠ work on a LOCAL: writing `ramps` then reading it back inside the same effect registers the
		// write as a dependency → effect_update_depth_exceeded loop.
		const r0 = rampsOf(c);
		ramps = r0;
		locks = r0.map(() => false);
		selected = 0;
		void analyzeRamps(c, `${base}/chars/${c}.webp`).then((r) => {
			if (c === cid) {
				ramps = [...r];
				locks = r.map(() => false);
			}
		});
	});
	const selSlots = $derived(ramps[selected]?.slots ?? []);
	// a low-saturation stock ramp is usually skin/greys — locked by default would be nice, but explicit is
	// clearer: everything starts unlocked and the user locks what they love.

	// ── stage: still portrait (tap-enabled, exact hit-test) vs animated preview ──
	let animate = $state(false);
	let holdStock = $state(false);
	// isolation: when a material is selected (and not animating), non-selected slots fade toward grey so
	// the selection is visible ON THE FIGHTER — rendered through the same remap that powers everything.
	const stagePal = $derived.by(() => {
		if (holdStock) return stock.slice();
		if (animate) return pal.slice();
		return pal.map((c, i) => {
			if (selSlots.includes(i)) return c;
			const [h, s, l] = rgbToHsl(...hexToRgb(c));
			const [r, g, b] = ((): [number, number, number] => {
				// desaturate + dim, done inline to avoid extra imports
				const gr = Math.round(l * 210);
				return [gr, gr, gr];
			})();
			void h; void s;
			return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
		});
	});
	let stageEl = $state<HTMLDivElement | null>(null);
	async function onStageTap(e: MouseEvent) {
		if (animate || !stageEl) return;
		const r = stageEl.getBoundingClientRect();
		const idx = await rampAtPoint(cid, `${base}/chars/${cid}.webp`, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
		if (idx >= 0) selected = idx;
	}

	// ── transforms ──
	const HUE_SAT_DEFAULT = 0.65;
	let hue = $state(0);
	function onHue(h: number) {
		hue = h;
		commit(retargetRamp(stock, pal, selSlots, '#' + hslHex(h, HUE_SAT_DEFAULT, 0.5)));
	}
	function hslHex(h: number, s: number, l: number): string {
		// tiny local: hsl → hex without extra imports
		const a = s * Math.min(l, 1 - l);
		const f = (n: number) => {
			const k = (n + h / 30) % 12;
			const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
			return Math.round(255 * c).toString(16).padStart(2, '0');
		};
		return f(0) + f(8) + f(4);
	}
	function onTone(t: Tone) {
		commit(applyTone(pal, selSlots, t));
	}
	function onShuffle() {
		const unlocked = ramps.filter((_, i) => !locks[i]).map((r) => r.slots);
		if (!unlocked.length) return;
		commit(shuffle(stock, pal, unlocked));
	}
	function onInvert() {
		commit(invert(pal, pal.map((_, i) => i)));
	}
	function onTheme(id: string) {
		commit(applyTheme(cid, id));
	}

	// ── PRO drawer ──
	let pro = $state(false);
	let codeIn = $state('');
	let codeMsg = $state('');
	function setSlot(i: number, hex: string) {
		const next = pal.slice();
		next[i] = hex;
		commit(next);
	}
	const myCode = $derived(encodeSkin({ cid, name: seedName || 'custom', author: '', palette: pal }));
	function importCode() {
		const d = decodeSkin(codeIn);
		if (!d) { codeMsg = 'bad code'; return; }
		if (d.cid !== cid) { codeMsg = `that code is for ${CHAR_NAME[d.cid] ?? 'another character'}`; return; }
		codeMsg = d.name ? `imported “${d.name}”${d.author ? ` by ${d.author}` : ''}` : 'imported';
		commit(d.palette);
	}

	// ── save / equip ──
	let saveName = $state('');
	let busy = $state(false);
	let done = $state('');
	async function saveVault() {
		if (busy) return;
		busy = true;
		const nm = saveName.trim() || `${name} custom`;
		const id = await vault.save(cid, nm, pal, vaultId ?? undefined);
		done = id != null ? `🗂 “${nm}” saved to your vault` : '⚠ could not save';
		busy = false;
	}
	async function equip() {
		if (busy) return;
		busy = true;
		const ok = await loadouts.equipOwn(cid, pal);
		if (ok && saveName.trim()) void vault.save(cid, saveName.trim(), pal, vaultId ?? undefined);
		done = ok ? `⚔ ${name} wears it — live in-game, receipts and boards` : '⚠ could not equip';
		busy = false;
		if (ok) setTimeout(onClose, 900);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
		else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
		else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="ovl" role="presentation">
	<div class="ed" role="dialog" aria-modal="true" aria-label="{name} dye station">
		<header class="hd">
			<div class="t"><span class="rail">DYE STATION</span><b>{name}</b></div>
			<div class="hist">
				<button class="ib" onclick={undo} disabled={!undoStack.length} title="Undo (Ctrl+Z)">↶</button>
				<button class="ib" onclick={redo} disabled={!redoStack.length} title="Redo (Ctrl+Y)">↷</button>
				<button class="ib" onclick={() => commit(stock.slice())} title="Reset to stock">⟲</button>
				<button class="ib x" onclick={onClose} aria-label="Close">✕</button>
			</div>
		</header>

		<div class="body">
			<!-- ── the stage ── -->
			<div class="stagewrap">
				<div
					class="stage"
					bind:this={stageEl}
					onclick={onStageTap}
					role="button"
					tabindex="0"
					onkeydown={(e) => e.key === 'Enter' && undefined}
					title={animate ? '' : 'tap a region to select its material'}
				>
					{#key animate}
						<CharSprite id={cid} eager still={!animate} palette={stagePal} />
					{/key}
				</div>
				<div class="stagectl">
					<button class="sc" class:on={animate} onclick={() => (animate = !animate)}>{animate ? '⏸ still' : '▶ animate'}</button>
					<button
						class="sc"
						onpointerdown={() => (holdStock = true)}
						onpointerup={() => (holdStock = false)}
						onpointerleave={() => (holdStock = false)}
					>hold: VS STOCK</button>
				</div>
				{#if !animate}<div class="hint">tap the fighter to select a material</div>{/if}
			</div>

			<!-- ── the dock ── -->
			<div class="dock">
				<div class="sec">THEMES — tap to wear</div>
				<div class="themes">
					{#each THEMES as t (t.id)}
						<button class="thumb" onclick={() => onTheme(t.id)} title={t.name}>
							<span class="tspr"><CharSprite id={cid} still palette={applyTheme(cid, t.id)} /></span>
							<span class="tn">{t.name}</span>
						</button>
					{/each}
				</div>

				<div class="sec">MATERIALS — tap the fighter or a card</div>
				{#each ramps as r, i (i)}
					<button class="mat" class:on={selected === i} onclick={() => (selected = i)}>
						<span class="ramp">{#each r.slots as s (s)}<i style="background:{pal[s]}"></i>{/each}</span>
						<span class="pc">{r.coverage > 0 ? `${Math.round(r.coverage * 100)}% of pixels` : `${r.slots.length} slots`}</span>
						<span
							class="lock"
							class:locked={locks[i]}
							role="button"
							tabindex="0"
							onclick={(e) => { e.stopPropagation(); locks[i] = !locks[i]; }}
							onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); locks[i] = !locks[i]; } }}
							title={locks[i] ? 'locked — shuffle keeps it' : 'unlocked — shuffle rerolls it'}
						>{locks[i] ? '🔒' : '○'}</span>
					</button>
				{/each}

				<div class="sec">DYE — selected material</div>
				<input class="huedial" type="range" min="0" max="360" step="1" value={hue} oninput={(e) => onHue(Number((e.currentTarget as HTMLInputElement).value))} aria-label="Hue" />
				<div class="tones">
					{#each ['pastel', 'deep', 'neon', 'mute'] as t (t)}
						<button class="tone" onclick={() => onTone(t as Tone)}>{t.toUpperCase()}</button>
					{/each}
				</div>

				<div class="row">
					<button class="shf" onclick={onShuffle}>⟳ SHUFFLE — respects locks</button>
					<button class="inv" onclick={onInvert}>INVERT</button>
				</div>

				<button class="proT" onclick={() => (pro = !pro)}>{pro ? '▾' : '▸'} PRO — 16 slots · hex · share code</button>
				{#if pro}
					<div class="proBox">
						<div class="wells">
							{#each pal as c, i (i)}
								<label class="well" title="slot {i + 1}">
									<input type="color" value={c} oninput={(e) => setSlot(i, (e.currentTarget as HTMLInputElement).value)} />
									<span>{i + 1}</span>
								</label>
							{/each}
						</div>
						<div class="codeRow">
							<input class="codeIn" type="text" placeholder="paste a RR1- share code…" bind:value={codeIn} />
							<button class="sc" onclick={importCode}>IMPORT</button>
							<button class="sc" onclick={() => navigator.clipboard?.writeText(myCode)}>COPY MINE</button>
						</div>
						{#if codeMsg}<div class="codeMsg">{codeMsg}</div>{/if}
					</div>
				{/if}
			</div>
		</div>

		<footer class="ft">
			<input class="nm" type="text" placeholder="Name this skin…" bind:value={saveName} maxlength="40" />
			<button class="ghostb" onclick={saveVault} disabled={busy || !auth.authed}>🗂 Save to Vault</button>
			<button class="equip" onclick={equip} disabled={busy || !auth.authed}>EQUIP</button>
		</footer>
		{#if done}<div class="toast">{done}</div>{/if}
	</div>
</div>

<style>
	.ovl {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: 12px;
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		backdrop-filter: blur(4px);
		overflow-y: auto;
	}
	.ed {
		width: min(100%, 860px);
		max-height: calc(100dvh - 24px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
	}
	.hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
		background: var(--panel-2);
	}
	.t .rail {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.2em;
		color: var(--stream);
		margin-right: 10px;
	}
	.t b {
		font-style: italic;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 17px;
	}
	.hist {
		display: flex;
		gap: 6px;
	}
	.ib {
		font: inherit;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--dim);
		cursor: pointer;
	}
	.ib:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.ib:not(:disabled):hover {
		color: var(--ink);
	}
	.body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1.02fr 1fr;
		overflow-y: auto;
	}
	.stagewrap {
		padding: 16px;
		background: radial-gradient(110% 90% at 50% 25%, #141826 0%, var(--bg) 72%);
		display: flex;
		flex-direction: column;
		align-items: center;
		border-right: 1px solid var(--line);
	}
	.stage {
		width: min(100%, 300px);
		height: 300px;
		cursor: crosshair;
	}
	.stagectl {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.sc {
		font: inherit;
		font-size: 10.5px;
		font-family: ui-monospace, monospace;
		letter-spacing: 0.06em;
		padding: 6px 11px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--dim);
		cursor: pointer;
	}
	.sc.on,
	.sc:hover {
		color: var(--stream);
		border-color: color-mix(in srgb, var(--stream) 45%, var(--line));
	}
	.hint {
		margin-top: 8px;
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.12em;
		color: var(--faint);
	}
	.dock {
		padding: 12px 16px;
		overflow-y: auto;
	}
	.sec {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.2em;
		color: var(--faint);
		margin: 12px 0 7px;
	}
	.sec:first-child {
		margin-top: 0;
	}
	.themes {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
	}
	.thumb {
		font: inherit;
		width: 56px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		padding: 5px 3px 4px;
		cursor: pointer;
	}
	.thumb:hover {
		border-color: color-mix(in srgb, var(--stream) 55%, var(--line));
	}
	.tspr {
		display: block;
		width: 100%;
		height: 40px;
	}
	.tn {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 7.5px;
		color: var(--dim);
		margin-top: 2px;
		text-align: center;
	}
	.mat {
		font: inherit;
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--panel-2);
		padding: 8px 12px;
		margin-bottom: 7px;
		cursor: pointer;
		color: var(--dim);
	}
	.mat.on {
		border-color: color-mix(in srgb, var(--stream) 60%, var(--line));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--stream) 35%, transparent);
	}
	.mat .ramp {
		display: flex;
		gap: 1px;
	}
	.mat .ramp i {
		width: 15px;
		height: 15px;
		border-radius: 3px;
	}
	.mat .pc {
		margin-left: auto;
		font-family: ui-monospace, monospace;
		font-size: 8.5px;
		color: var(--faint);
	}
	.mat .lock {
		font-size: 12px;
		color: var(--faint);
	}
	.mat .lock.locked {
		color: var(--stream);
	}
	.huedial {
		width: 100%;
		height: 14px;
		appearance: none;
		border-radius: 999px;
		background: linear-gradient(90deg, #f33, #ff8c00, #ffd400, #3ad04d, #2bb8ff, #7a5cff, #f33);
		outline: none;
	}
	.huedial::-webkit-slider-thumb {
		appearance: none;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--ink);
		border: 3px solid var(--stream);
		cursor: pointer;
	}
	.tones {
		display: flex;
		gap: 7px;
		margin-top: 8px;
	}
	.tone {
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		padding: 5px 11px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		color: var(--dim);
		cursor: pointer;
	}
	.tone:hover {
		color: var(--stream);
		border-color: color-mix(in srgb, var(--stream) 50%, var(--line));
	}
	.row {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.shf {
		flex: 1;
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 10.5px;
		letter-spacing: 0.08em;
		padding: 9px 0;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--panel-2);
		color: var(--ink);
		cursor: pointer;
	}
	.shf:hover {
		border-color: color-mix(in srgb, var(--stream) 50%, var(--line));
	}
	.inv {
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 10.5px;
		padding: 9px 14px;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: transparent;
		color: var(--dim);
		cursor: pointer;
	}
	.proT {
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		letter-spacing: 0.1em;
		margin-top: 12px;
		padding: 7px 0;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		border-top: 1px dashed var(--line);
		color: var(--faint);
		cursor: pointer;
	}
	.proBox {
		padding-top: 4px;
	}
	.wells {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 6px;
	}
	.well {
		position: relative;
	}
	.well input {
		width: 100%;
		height: 30px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: none;
		padding: 0;
		cursor: pointer;
	}
	.well span {
		position: absolute;
		right: 3px;
		bottom: 2px;
		font-family: ui-monospace, monospace;
		font-size: 7.5px;
		color: rgba(255, 255, 255, 0.75);
		text-shadow: 0 1px 2px #000;
		pointer-events: none;
	}
	.codeRow {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}
	.codeIn {
		flex: 1;
		min-width: 0;
		font-family: ui-monospace, monospace;
		font-size: 10px;
		padding: 7px 10px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
	}
	.codeMsg {
		margin-top: 6px;
		font-family: ui-monospace, monospace;
		font-size: 9.5px;
		color: var(--dim);
	}
	.ft {
		display: flex;
		gap: 8px;
		padding: 11px 14px;
		border-top: 1px solid var(--line);
		background: var(--panel-2);
	}
	.nm {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 12.5px;
		padding: 8px 12px;
		border-radius: 9px;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--ink);
	}
	.nm:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--stream) 55%, var(--line));
	}
	.ghostb {
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		padding: 8px 13px;
		border-radius: 9px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink);
		cursor: pointer;
		white-space: nowrap;
	}
	.equip {
		font: inherit;
		font-family: inherit;
		font-style: italic;
		font-weight: 900;
		font-size: 15px;
		letter-spacing: 0.04em;
		padding: 8px 26px;
		border: none;
		border-radius: 9px;
		color: #241700;
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		cursor: pointer;
	}
	.equip:disabled,
	.ghostb:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.toast {
		position: absolute;
		left: 50%;
		bottom: 70px;
		transform: translateX(-50%);
		padding: 8px 15px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--panel-2);
		color: var(--ink);
		font-size: 12px;
		white-space: nowrap;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
	}
	@media (max-width: 700px) {
		.body {
			grid-template-columns: 1fr;
		}
		.stagewrap {
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
		.stage {
			height: 42vh;
		}
		.tone,
		.sc {
			padding: 8px 13px;
		}
	}
</style>
