<script lang="ts">
	import { onDestroy } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { flagEmoji } from '$lib/format';
	import Flag from '$lib/components/Flag.svelte';
	import { COUNTRIES, US_REGIONS, CC_NAME, searchCities, type CityHit } from '$lib/represent';

	// Owner-only "Represent" editor: set your country / city / region so a flag shows by your name and your
	// city/country lands on the Regions board. Signed-in only (render behind auth.authed). Writes ride the
	// shared owner-write path (auth.post → POST /skinsync/location), then refresh auth.me app-wide. `onsaved`
	// lets a host (e.g. the profile page) refetch its own view after a change.
	let { onsaved }: { onsaved?: () => void } = $props();

	// Working copy — seeded ONCE from auth.me (a live $derived would clobber typing). `seeded` is a plain
	// local so writing it never re-triggers the effect (mirrors the profile page's `loadedSid` guard).
	let cc = $state('');
	let country = $state('');
	let region = $state('');
	let city = $state('');
	let seeded = false;
	$effect(() => {
		const me = auth.me;
		if (!seeded && me) {
			cc = me.cc ?? '';
			country = me.country ?? '';
			region = me.region ?? '';
			city = me.city ?? '';
			seeded = true;
		}
	});

	// City typeahead. `cityTimer`/`cityReq` are plain locals (not $state) — the timer must not re-trigger
	// reactivity, and the request-id drops stale responses (a slow fetch can't overwrite a newer query).
	let citySuggestions = $state<CityHit[]>([]);
	let cityOpen = $state(false);
	let cityTimer: ReturnType<typeof setTimeout> | null = null;
	let cityReq = 0;

	function onCityInput(v: string) {
		city = v;
		cityOpen = true;
		if (cityTimer) clearTimeout(cityTimer);
		const q = v.trim();
		if (q.length < 2) {
			citySuggestions = [];
			return;
		}
		const mine = ++cityReq;
		cityTimer = setTimeout(async () => {
			const hits = await searchCities(cc, q, 8);
			if (mine !== cityReq) return; // superseded by a newer keystroke
			citySuggestions = hits;
		}, 250);
	}

	function pickCity(h: CityHit) {
		city = h.name;
		if (!cc && h.cc) {
			cc = h.cc; // improvement over Tauri: a city pick can fill the country
			country = CC_NAME[h.cc] ?? country;
		}
		if (cc !== 'US') region = h.region ?? region; // US uses a scene, not the auto state
		citySuggestions = [];
		cityOpen = false;
	}

	function onCountryChange(e: Event & { currentTarget: HTMLSelectElement }) {
		const v = e.currentTarget.value;
		const wasUS = cc === 'US';
		cc = v;
		country = v ? (CC_NAME[v] ?? '') : '';
		if ((v === 'US') !== wasUS) region = ''; // scene ↔ state are incompatible — reset on the boundary
		citySuggestions = [];
		cityOpen = false;
	}

	onDestroy(() => {
		if (cityTimer) clearTimeout(cityTimer);
	});

	const repPreview = $derived([city, region].filter(Boolean).join(', ') || country);
	const dirty = $derived(
		!!auth.me &&
			(cc !== (auth.me.cc ?? '') ||
				country !== (auth.me.country ?? '') ||
				region !== (auth.me.region ?? '') ||
				city !== (auth.me.city ?? ''))
	);

	let busy = $state(false);
	let notice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

	async function save() {
		if (busy || !dirty) return;
		busy = true;
		notice = null;
		const res = await auth.post('/skinsync/location', {
			steamid: auth.steamid,
			cc,
			country,
			region,
			city
		});
		busy = false;
		if (res.ok) {
			notice = { kind: 'ok', text: `Saved — you’re repping ${repPreview || 'your location'}.` };
			await auth.loadMe(); // refresh the flag everywhere (top bar, settings, this preview baseline)
			onsaved?.();
		} else {
			notice = { kind: 'err', text: res.error ?? 'Could not save your location.' };
		}
	}

	async function clearLoc() {
		if (busy) return;
		cc = '';
		country = '';
		region = '';
		city = '';
		citySuggestions = [];
		cityOpen = false;
		busy = true;
		notice = null;
		const res = await auth.post('/skinsync/location', {
			steamid: auth.steamid,
			cc: '',
			country: '',
			region: '',
			city: ''
		});
		busy = false;
		if (res.ok) {
			notice = { kind: 'ok', text: 'Location cleared.' };
			await auth.loadMe();
			onsaved?.();
		} else {
			notice = { kind: 'err', text: res.error ?? 'Could not clear your location.' };
		}
	}
</script>

<div class="rep">
	<div class="intro">Shows as a flag by your name on the boards &amp; profile — and puts your city on the Regions board. All optional.</div>

	<div class="field">
		<label class="lbl" for="rep-country">Country</label>
		<select id="rep-country" class="inp" value={cc} onchange={onCountryChange}>
			<option value="">— select country —</option>
			{#each COUNTRIES as [code, name] (code)}
				<option value={code}>{flagEmoji(code)} {name}</option>
			{/each}
		</select>
	</div>

	<div class="field">
		<label class="lbl" for="rep-city">City</label>
		<div class="cwrap">
			<input
				id="rep-city"
				class="inp"
				value={city}
				autocomplete="off"
				placeholder="Type the start of your city"
				oninput={(e) => onCityInput(e.currentTarget.value)}
			/>
			{#if cityOpen && citySuggestions.length}
				<div class="cbox" role="listbox" aria-label="City suggestions">
					{#each citySuggestions as h (h.cc + '|' + h.name + '|' + h.region)}
						<button type="button" class="copt" role="option" aria-selected="false" onclick={() => pickCity(h)}>
							<span class="cn">{h.name}</span>
							<span class="cr">{h.region}{#if h.cc}&nbsp;<Flag cc={h.cc} w={16} />{/if}</span>
						</button>
					{/each}
				</div>
			{:else if cityOpen && city.trim().length >= 2}
				<div class="cbox"><div class="cnone">No match — type the start of a real city.</div></div>
			{/if}
		</div>
	</div>

	<div class="field">
		{#if cc === 'US'}
			<label class="lbl" for="rep-scene">Your scene</label>
			<select id="rep-scene" class="inp" value={region} onchange={(e) => (region = e.currentTarget.value)}>
				<option value="">— pick your scene —</option>
				{#each US_REGIONS as s (s)}<option value={s}>{s}</option>{/each}
			</select>
		{:else}
			<label class="lbl" for="rep-region">State / region</label>
			<input
				id="rep-region"
				class="inp"
				value={region}
				placeholder="Auto-fills when you pick a city"
				oninput={(e) => (region = e.currentTarget.value)}
			/>
		{/if}
	</div>

	<div class="preview">
		{#if repPreview}
			Representing {#if cc}<span class="pf"><Flag cc={cc} w={16} /></span> {/if}<b>{repPreview}</b>
		{:else}
			Pick a country + city to appear on the Regions board.
		{/if}
	</div>

	<div class="actions">
		<button type="button" class="save" disabled={busy || !dirty} onclick={save}
			><span>{busy ? 'Saving…' : 'Save'}</span></button
		>
		<button type="button" class="ghost" disabled={busy} onclick={clearLoc}>Clear</button>
	</div>

	{#if notice}<div class="notice {notice.kind}" role="status">{notice.text}</div>{/if}
</div>

<style>
	.rep {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.intro {
		font-size: 12px;
		color: var(--dim);
		line-height: 1.5;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.lbl {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.inp {
		font: inherit;
		font-size: 14px;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 9px 11px;
		width: 100%;
		min-height: 42px;
		appearance: none;
	}
	.inp:focus {
		outline: none;
		border-color: var(--gold-soft);
	}
	/* city typeahead */
	.cwrap {
		position: relative;
		min-width: 0;
	}
	.cbox {
		position: absolute;
		z-index: 5;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 200px;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		box-shadow: var(--shadow);
	}
	.copt {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		text-align: left;
		font: inherit;
		font-size: 13px;
		color: var(--ink);
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--line);
		padding: 9px 11px;
		min-height: 40px;
		cursor: pointer;
	}
	.copt:last-child {
		border-bottom: 0;
	}
	.copt:hover {
		background: color-mix(in srgb, var(--gold) 8%, transparent);
	}
	.cn {
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.cr {
		flex: none;
		font-size: 11px;
		color: var(--dim);
		white-space: nowrap;
	}
	.cnone {
		padding: 9px 11px;
		font-size: 12px;
		color: var(--dim);
	}
	/* preview + actions */
	.preview {
		font-size: 12.5px;
		color: var(--dim);
	}
	.preview b {
		color: var(--ink);
		font-weight: 800;
	}
	.preview .pf {
		font-size: 14px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.save {
		font: inherit;
		font-size: 13px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 9px;
		padding: 0 18px;
		min-height: 40px;
		cursor: pointer;
		transform: skewX(-8deg);
		white-space: nowrap;
	}
	.save > span {
		display: inline-block;
		transform: skewX(8deg);
	}
	.save:hover:not(:disabled) {
		filter: brightness(1.05);
	}
	.save:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.ghost {
		font: inherit;
		font-size: 13px;
		font-weight: 800;
		color: var(--dim);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 0 15px;
		min-height: 40px;
		cursor: pointer;
	}
	.ghost:hover:not(:disabled) {
		color: var(--live);
		border-color: color-mix(in srgb, var(--live) 45%, transparent);
	}
	.ghost:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.notice {
		font-size: 12.5px;
		font-weight: 700;
	}
	.notice.ok {
		color: var(--good);
	}
	.notice.err {
		color: var(--live);
	}
</style>
