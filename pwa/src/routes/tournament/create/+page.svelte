<script lang="ts">
	// Tournament CREATE / EDIT — the TO create flow (Phase 1). One route, two modes:
	//   • create  (no query)  → POST /rr/tourney/create → { id } → open the new event
	//   • edit    (?id=<slug>) → prefill from /tourney/get, POST /rr/tourney/update
	// Create is allowed for ANY signed-in user (a TO is a user who owns an event); edit is gated to the
	// organizer (to_steamid / co_tos). The acting SteamID is the bearer token server-side; we mirror identity
	// only to pick the right gate. Structural fields lock once the bracket is live — the server enforces it.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { api } from '$lib/config';
	import { auth } from '$lib/stores/auth.svelte';
	import Masthead from '$lib/components/Masthead.svelte';
	import { COUNTRIES, US_REGIONS, CC_NAME } from '$lib/represent';
	import { flagEmoji } from '$lib/format';
	import type { TournamentDoc } from '$lib/tourney';

	const editId = $derived(page.url.searchParams.get('id') ?? '');
	const isEdit = $derived(!!editId);

	const MVC2_RULES = [
		'# MvC2 Ruleset',
		'Format: Double elimination. FT2 (best of 3) through pools; FT3 (best of 5) for Top 8, Winners, Losers, and Grand Finals (Grand Finals may reset).',
		'Game: Marvel vs. Capcom 2 — default arcade settings, Damage Normal, Timer 99.',
		'Team select: All 56 characters legal. Full assist select allowed. You may change team and assists between games in a set.',
		'Conduct: No intentional pausing (a pause that affects the game is a game loss). No coaching during a set. Be at your lobby when your match is called.',
		'Disconnections (online): An accidental DC before first hit replays that game. Repeated DCs may be ruled a forfeit by the organizer.',
		'Reporting: Winner reports the set; the organizer confirms it on the bracket. Disputes go to the organizer.',
		'Check-in / DQ: Check in when the event opens. Not being ready within the DQ timer (5-7 min) after your match is called may result in a DQ.'
	].join('\n');

	const PRESETS = {
		std: { n: 'MVC2 STANDARD', d: 'FT2 · FT2 · FT3 GF', v: [2, 2, 3] as const },
		quick: { n: 'QUICK WEEKLY', d: 'FT1 · FT1 · FT2 GF', v: [1, 1, 2] as const },
		marathon: { n: 'MARATHON', d: 'FT3 · FT3 · FT5 GF', v: [3, 3, 5] as const },
		custom: { n: 'CUSTOM', d: 'edit anything ↓', v: null }
	};
	type PresetKey = keyof typeof PRESETS;

	const STAKES = [0, 1, 2, 4, 8]; // 🪙 quarters — 0 = free; ENTRY_COINS_MAX = 8 server-side

	let name = $state('');
	let format = $state<'double' | 'single'>('double');
	let online = $state(true);
	let cc = $state('');
	let city = $state('');
	let region = $state('');
	let starts = $state('');
	let regOpen = $state('');
	let regClose = $state('');
	let checkinOpen = $state('');
	let checkinClose = $state('');
	// Simple schedule: pick a Start + how long before it check-in opens; the reg/check-in windows derive from
	// those (reg open now → close at start; check-in `checkinLead` min before → close at start). `advanced`
	// reveals the raw datetime pickers for full control.
	let checkinLead = $state(60);
	let advancedSchedule = $state(false);
	let cap = $state(0);
	let waitlist = $state(true);
	let ftW = $state(2);
	let ftL = $state(2);
	let ftG = $state(3);
	let stake = $state(0);
	let rules = $state(MVC2_RULES);
	let banner = $state('');
	let bannerKb = $state(0);
	let streamUrl = $state('');
	let discordUrl = $state('');
	let hostMode = $state<'player' | 'stationed'>('stationed'); // hosted-only for now (self-hosted deferred)
	let preset = $state<PresetKey>('std');

	let busy = $state(false);
	let notice = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
	let loading = $state(false);
	let denied = $state(false);
	let locked = $state(false);

	let loadedId = '';
	$effect(() => {
		const id = editId;
		if (id && id !== loadedId) {
			loadedId = id;
			void loadDoc(id);
		}
	});
	onMount(() => {
		if (editId && !loadedId) {
			loadedId = editId;
			void loadDoc(editId);
		}
	});

	async function loadDoc(id: string): Promise<void> {
		loading = true;
		notice = null;
		try {
			const res = await fetch(api(`/rr/tourney/get?id=${encodeURIComponent(id)}`), {
				headers: { accept: 'application/json' }
			});
			if (res.ok) {
				const j = (await res.json()) as { tournament?: TournamentDoc };
				if (j.tournament) prefill(j.tournament);
			} else {
				notice = { kind: 'err', text: 'Could not load that event.' };
			}
		} catch {
			notice = { kind: 'err', text: 'Network error loading the event.' };
		}
		loading = false;
	}

	function prefill(t: TournamentDoc): void {
		const me = auth.steamid;
		const isTo = !!me && (t.to_steamid === me || (t.co_tos ?? []).includes(me));
		if (!isTo) {
			denied = true;
			return;
		}
		locked = t.status === 'running' || t.status === 'done';
		name = t.name ?? '';
		format = t.format === 'single' ? 'single' : 'double';
		online = t.online ?? true;
		cc = t.cc ?? '';
		city = t.city ?? '';
		region = t.region ?? '';
		starts = msToLocalInput(t.starts_ms);
		regOpen = msToLocalInput(t.reg_open_ms);
		regClose = msToLocalInput(t.reg_close_ms);
		checkinOpen = msToLocalInput(t.checkin_open_ms);
		checkinClose = msToLocalInput(t.checkin_close_ms);
		// derive the simple check-in lead from the stored window (snap to the nearest preset); default 1h.
		if (t.starts_ms && t.checkin_open_ms && t.checkin_open_ms < t.starts_ms) {
			const mins = Math.round((t.starts_ms - t.checkin_open_ms) / 60000);
			checkinLead = [0, 15, 30, 60, 120].reduce((a, b) => (Math.abs(b - mins) < Math.abs(a - mins) ? b : a), 60);
		} else if (t.starts_ms && !t.checkin_open_ms) {
			checkinLead = 0;
		}
		cap = t.cap ?? 0;
		waitlist = !!(t as { waitlist?: boolean }).waitlist;
		ftW = t.ft_winners || 2;
		ftL = t.ft_losers || 2;
		ftG = t.ft_grands || 3;
		stake = t.entry_coins ?? 0;
		rules = t.rules_md ?? '';
		banner = t.banner_url ?? '';
		streamUrl = t.stream_url ?? '';
		discordUrl = t.discord_url ?? '';
		hostMode = 'stationed'; // hosted-only for now — normalize any event to hosted on edit
		preset = 'custom';
	}

	function applyPreset(k: PresetKey): void {
		preset = k;
		const v = PRESETS[k].v;
		if (v) {
			ftW = v[0];
			ftL = v[1];
			ftG = v[2];
			rules = MVC2_RULES;
		}
	}
	function markCustom(): void {
		if (preset !== 'custom') preset = 'custom';
	}
	function resetRules(): void {
		rules = MVC2_RULES;
		markCustom();
	}

	function onCountry(e: Event & { currentTarget: HTMLSelectElement }): void {
		const v = e.currentTarget.value;
		const wasUS = cc === 'US';
		cc = v;
		if ((v === 'US') !== wasUS) region = '';
	}

	// banner: center-crop to 3:1, downscale to 600×200, JPEG q0.72 → data URI (ported from Tauri)
	function resizeBanner(file: File, W: number, H: number, q: number): Promise<string> {
		return new Promise((res, rej) => {
			const fr = new FileReader();
			fr.onload = () => {
				const img = new Image();
				img.onload = () => {
					try {
						const c = document.createElement('canvas');
						c.width = W;
						c.height = H;
						const ctx = c.getContext('2d');
						if (!ctx) return rej(new Error('no ctx'));
						const ar = img.width / img.height;
						const tar = W / H;
						let sw: number, sh: number, sx: number, sy: number;
						if (ar > tar) {
							sh = img.height;
							sw = sh * tar;
							sx = (img.width - sw) / 2;
							sy = 0;
						} else {
							sw = img.width;
							sh = sw / tar;
							sx = 0;
							sy = (img.height - sh) / 2;
						}
						ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
						res(c.toDataURL('image/jpeg', q));
					} catch (e) {
						rej(e);
					}
				};
				img.onerror = rej;
				img.src = String(fr.result);
			};
			fr.onerror = rej;
			fr.readAsDataURL(file);
		});
	}
	async function onBannerFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		try {
			const uri = await resizeBanner(file, 600, 200, 0.72);
			banner = uri;
			bannerKb = Math.round(uri.length / 1024);
		} catch {
			notice = { kind: 'err', text: 'Could not load that image — try a PNG or JPEG.' };
		}
	}
	function clearBanner(): void {
		banner = '';
		bannerKb = 0;
	}

	function msToLocalInput(ms?: number): string {
		if (!ms || ms <= 0) return '';
		const d = new Date(ms);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
	}
	function localInputToMs(s: string): number {
		if (!s) return 0;
		const t = new Date(s).getTime();
		return isNaN(t) ? 0 : t;
	}

	// Derive the reg/check-in window ms. Simple mode: registration opens immediately (0-gate) and closes at
	// start; check-in opens `checkinLead` min before start and closes at start (none when lead=0). Advanced
	// mode passes the raw pickers through verbatim.
	function scheduleMs(): Record<string, number> {
		if (advancedSchedule) {
			return {
				reg_open_ms: localInputToMs(regOpen),
				reg_close_ms: localInputToMs(regClose),
				checkin_open_ms: localInputToMs(checkinOpen),
				checkin_close_ms: localInputToMs(checkinClose)
			};
		}
		const startMs = localInputToMs(starts);
		const lead = Number(checkinLead) || 0;
		return {
			reg_open_ms: 0,
			reg_close_ms: startMs,
			checkin_open_ms: lead > 0 && startMs ? startMs - lead * 60000 : 0,
			checkin_close_ms: lead > 0 ? startMs : 0
		};
	}

	async function submit(): Promise<void> {
		if (busy) return;
		const nm = name.trim();
		if (!nm) {
			notice = { kind: 'err', text: 'A tournament name is required.' };
			return;
		}
		busy = true;
		notice = null;

		const body: Record<string, unknown> = {
			name: nm,
			banner_url: banner,
			rules_md: rules,
			stream_url: streamUrl.trim(),
			discord_url: discordUrl.trim()
		};
		if (!locked) {
			Object.assign(body, {
				format,
				online,
				cc: cc.trim().toUpperCase(),
				country: cc ? (CC_NAME[cc] ?? '') : '',
				region: region.trim(),
				city: city.trim(),
				starts_ms: localInputToMs(starts),
				...scheduleMs(),
				cap: Math.max(0, Math.min(256, Math.floor(cap || 0))),
				waitlist,
				ft_winners: ftW || 2,
				ft_losers: ftL || 2,
				ft_grands: ftG || 3,
				host_mode: hostMode
			});
			if (!isEdit) body.entry_coins = stake; // entry_coins is IMMUTABLE after create
		}

		if (isEdit) {
			body.id = editId;
			const res = await auth.post('/rr/tourney/update', body);
			busy = false;
			if (res.ok) {
				notice = { kind: 'ok', text: 'Saved.' };
				void goto(`${base}/tournament/${editId}`);
			} else {
				notice = { kind: 'err', text: res.error ?? 'Could not save the event.' };
			}
		} else {
			const res = await auth.post<{ id?: string }>('/rr/tourney/create', body);
			busy = false;
			if (res.ok && res.data?.id) {
				void goto(`${base}/tournament/${res.data.id}`);
			} else {
				notice = { kind: 'err', text: res.error ?? 'Could not create the event.' };
			}
		}
	}

	const scheduleHint = $derived(
		Number(checkinLead) === 0
			? 'Registration is open now → closes at start. No check-in — players are auto-ready at start.'
			: `Registration is open now → closes at start. Check-in opens ${Number(checkinLead) >= 60 ? Number(checkinLead) / 60 + 'h' : checkinLead + 'm'} before start → closes at start.`
	);
	const heading = $derived(isEdit ? 'EDIT EVENT' : 'CREATE EVENT');
	const submitLabel = $derived(
		busy ? (isEdit ? 'Saving…' : 'Creating…') : isEdit ? 'Save changes' : 'Create tournament'
	);
</script>

<svelte:head><title>{isEdit ? 'Edit' : 'Create'} tournament · Retro Receipts</title></svelte:head>

<Masthead
	title={heading}
	ghost="ORGANIZE"
	accent="#8b6dff"
	desc={isEdit
		? 'Update your event. Structural settings lock once the bracket starts.'
		: 'Open a bracket that runs itself — seeded by real ELO, live on every phone.'}
>
	{#snippet pills()}
		<a class="pill back" href="{base}/tournament">← Tournaments</a>
	{/snippet}
</Masthead>

{#if !auth.authed}
	<div class="signin">
		<p>Sign in with Steam to create a tournament — your SteamID is the organizer key.</p>
		<button type="button" class="steam" onclick={() => auth.login()}>Sign in through Steam</button>
	</div>
{:else if denied}
	<div class="empty">You’re not the organizer of this event.</div>
{:else if loading}
	<div class="empty">LOADING…</div>
{:else}
	{#if locked}
		<div class="lockbar">This event is live — only the name, banner, rules and links can be edited now.</div>
	{/if}

	<form class="form" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
		<div class="frail">The basics</div>
		<div class="field">
			<label class="lbl" for="f-name">Tournament name</label>
			<input id="f-name" class="inp" maxlength="80" placeholder="NOBD Weekly #12" bind:value={name} />
		</div>

		{#if !locked}
			<div class="frow">
				<div class="field">
					<label class="lbl" for="f-format">Format</label>
					<select id="f-format" class="inp" bind:value={format}>
						<option value="double">Double elimination</option>
						<option value="single">Single elimination</option>
					</select>
				</div>
				<div class="field chk">
					<input type="checkbox" id="f-online" bind:checked={online} />
					<label for="f-online">Online event</label>
				</div>
				<div class="field">
					<label class="lbl" for="f-country">Country</label>
					<select id="f-country" class="inp" value={cc} onchange={onCountry}>
						<option value="">— none —</option>
						{#each COUNTRIES as [code, cname] (code)}
							<option value={code}>{flagEmoji(code)} {cname}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label class="lbl" for="f-city">City</label>
					<input id="f-city" class="inp" maxlength="56" placeholder="Los Angeles" bind:value={city} />
				</div>
				<div class="field">
					{#if cc === 'US'}
						<label class="lbl" for="f-region">Scene</label>
						<select id="f-region" class="inp" bind:value={region}>
							<option value="">— pick a scene —</option>
							{#each US_REGIONS as s (s)}<option value={s}>{s}</option>{/each}
						</select>
					{:else}
						<label class="lbl" for="f-region">State / region</label>
						<input id="f-region" class="inp" maxlength="56" placeholder="Optional" bind:value={region} />
					{/if}
				</div>
			</div>

			<div class="frail">Format &amp; rules</div>
			<div class="presets" role="group" aria-label="Ruleset preset">
				{#each Object.entries(PRESETS) as [k, p] (k)}
					<button type="button" class="preset" class:on={preset === k} onclick={() => applyPreset(k as PresetKey)}>
						<span class="pn">{p.n}</span><small>{p.d}</small>
					</button>
				{/each}
			</div>
			<div class="frow ft">
				<div class="field">
					<label class="lbl" for="f-ftw">FT winners</label>
					<input id="f-ftw" class="inp" type="number" min="1" max="9" bind:value={ftW} oninput={markCustom} />
				</div>
				<div class="field">
					<label class="lbl" for="f-ftl">FT losers</label>
					<input id="f-ftl" class="inp" type="number" min="1" max="9" bind:value={ftL} oninput={markCustom} />
				</div>
				<div class="field">
					<label class="lbl" for="f-ftg">FT grands</label>
					<input id="f-ftg" class="inp" type="number" min="1" max="9" bind:value={ftG} oninput={markCustom} />
				</div>
			</div>
		{/if}

		<div class="field">
			<label class="lbl" for="f-rules">
				Rules
				<button type="button" class="mini" onclick={resetRules}>Reset to MvC2 standard</button>
			</label>
			<textarea id="f-rules" class="inp ta" maxlength="8000" rows="7" bind:value={rules} oninput={markCustom}></textarea>
			<div class="micro">Markdown: <code>#</code> headings and <code>**bold**</code>. Players read this at registration.</div>
		</div>

		{#if !locked}
			<div class="frail">Schedule</div>
			<div class="frow">
				<div class="field">
					<label class="lbl" for="f-starts">Start time</label>
					<input id="f-starts" class="inp" type="datetime-local" bind:value={starts} />
				</div>
				<div class="field">
					<label class="lbl" for="f-ci">Check-in opens</label>
					<select id="f-ci" class="inp" bind:value={checkinLead}>
						<option value={120}>2 hours before start</option>
						<option value={60}>1 hour before start</option>
						<option value={30}>30 min before start</option>
						<option value={15}>15 min before start</option>
						<option value={0}>No check-in — auto-ready at start</option>
					</select>
				</div>
			</div>
			<div class="schedrow">
				<span class="micro">{scheduleHint}</span>
				<button type="button" class="mini" onclick={() => (advancedSchedule = !advancedSchedule)}>{advancedSchedule ? '↥ Simple' : 'Set exact times…'}</button>
			</div>
			{#if advancedSchedule}
				<div class="frow">
					<div class="field">
						<label class="lbl" for="f-ro">Registration opens</label>
						<input id="f-ro" class="inp" type="datetime-local" bind:value={regOpen} />
					</div>
					<div class="field">
						<label class="lbl" for="f-rc">Registration closes</label>
						<input id="f-rc" class="inp" type="datetime-local" bind:value={regClose} />
					</div>
					<div class="field">
						<label class="lbl" for="f-co">Check-in opens</label>
						<input id="f-co" class="inp" type="datetime-local" bind:value={checkinOpen} />
					</div>
					<div class="field">
						<label class="lbl" for="f-cclose">Check-in closes</label>
						<input id="f-cclose" class="inp" type="datetime-local" bind:value={checkinClose} />
					</div>
				</div>
			{/if}
			<div class="frow">
				<div class="field">
					<label class="lbl" for="f-cap">Entrant cap</label>
					<input id="f-cap" class="inp" type="number" min="0" max="256" bind:value={cap} />
					<div class="micro">0 = no cap (max 256). Beyond the cap, players waitlist automatically.</div>
				</div>
				<div class="field chk">
					<input type="checkbox" id="f-wl" bind:checked={waitlist} />
					<label for="f-wl">Allow waitlist past the cap</label>
				</div>
			</div>

			<div class="frail">Entry</div>
			<div class="field">
				<span class="lbl">Entry stake — 🪙 quarters {#if isEdit}<span class="lockhint">(locked after create)</span>{/if}</span>
				<div class="opts" role="group" aria-label="Entry stake">
					{#each STAKES as v (v)}
						<button
							type="button"
							class="opt"
							class:on={stake === v}
							disabled={isEdit}
							aria-pressed={stake === v}
							onclick={() => (stake = v)}>{v === 0 ? 'Free' : `🪙 ${v}`}</button
						>
					{/each}
				</div>
				<div class="micro">
					🪙 Quarters are Retro Receipts <b>play money</b> — everyone starts with a stack, nothing to buy or cash
					out. Entrants stake at registration; <b>the champion takes the pot</b>. Drops and no-shows are refunded.
				</div>
			</div>

			<div class="field">
				<span class="lbl">Hosting</span>
				<div class="hostnote">
					<b>Matches are hosted.</b> After you create the event, register or assign your <b>hosts</b> —
					machines that run the lobbies and auto-report results. <b>Add 2–3 hosts</b> so matches run in
					parallel and the bracket keeps moving. Anyone can volunteer their account (Bazzite/Linux for now).
					<i>Self-hosted — players running their own matches — is coming later.</i>
				</div>
			</div>
		{/if}

		<div class="frail">Presentation</div>
		<div class="field">
			<span class="lbl">Banner <span class="dimhint">— any image, auto-fit to 3:1 (≈1200×400 looks best)</span></span>
			<div class="banner">
				<div class="prev" class:has={!!banner} style={banner ? `background-image:url(${banner})` : ''}></div>
				<div class="bctl">
					<label class="filebtn">
						Browse image…
						<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange={onBannerFile} hidden />
					</label>
					{#if banner}
						<button type="button" class="mini" onclick={clearBanner}>Remove</button>
						{#if bannerKb}<span class="micro">{bannerKb} KB · ready</span>{/if}
					{/if}
				</div>
			</div>
		</div>
		<div class="frow">
			<div class="field">
				<label class="lbl" for="f-stream">Stream URL</label>
				<input id="f-stream" class="inp" maxlength="300" placeholder="https://twitch.tv/…" bind:value={streamUrl} />
			</div>
			<div class="field">
				<label class="lbl" for="f-discord">Discord</label>
				<input id="f-discord" class="inp" maxlength="300" placeholder="https://discord.gg/…" bind:value={discordUrl} />
			</div>
		</div>

		<div class="actions">
			<a class="ghost" href={isEdit ? `${base}/tournament/${editId}` : `${base}/tournament`}>Cancel</a>
			<button type="submit" class="submit" disabled={busy}><span>{submitLabel}</span></button>
		</div>

		{#if notice}<div class="notice {notice.kind}" role="status">{notice.text}</div>{/if}
	</form>
{/if}

<style>
	.pill.back {
		font-size: 10.5px;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-decoration: none;
		color: var(--dim);
		border: 1px solid var(--line);
		background: var(--panel-2);
		border-radius: 6px;
		padding: 4px 9px;
	}
	.pill.back:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.empty {
		margin: 14px 0;
		padding: 22px 16px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		text-align: center;
		color: var(--dim);
		font-size: 13px;
	}
	.signin {
		border: 1px dashed var(--line);
		border-radius: 14px;
		padding: 26px 18px;
		text-align: center;
		color: var(--dim);
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-items: center;
	}
	.steam {
		font: inherit;
		font-weight: 800;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: none;
		border-radius: 10px;
		padding: 10px 18px;
		cursor: pointer;
	}
	.lockbar {
		margin: 4px 0 12px;
		padding: 10px 14px;
		border: 1px solid color-mix(in srgb, var(--gold) 30%, var(--line));
		background: var(--gold-soft);
		border-radius: 11px;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--gold);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.frail {
		margin: 12px 2px 0;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.lbl {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.lbl .lockhint,
	.dimhint {
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
		color: var(--faint);
	}
	.inp {
		font: inherit;
		font-size: 16px; /* ≥16px so iOS never zooms on focus */
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 10px 11px;
		width: 100%;
		min-height: 44px;
		appearance: none;
		-webkit-appearance: none;
	}
	.inp:focus-visible {
		outline: none;
		border-color: var(--gold-soft);
	}
	.ta {
		min-height: 150px;
		line-height: 1.5;
		resize: vertical;
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 13px;
	}
	.frow {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 10px 12px;
	}
	.frow.ft {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.chk {
		flex-direction: row;
		align-items: center;
		gap: 9px;
		align-self: end;
		min-height: 44px;
	}
	.chk input {
		width: 20px;
		height: 20px;
		accent-color: var(--gold);
		flex: none;
	}
	.chk label {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink);
	}
	.mini {
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0;
		text-transform: none;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 7px;
		padding: 3px 9px;
		cursor: pointer;
	}
	.mini:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.micro {
		font-size: 11px;
		color: var(--faint);
		line-height: 1.5;
	}
	.micro code {
		font-family: ui-monospace, Consolas, monospace;
		color: var(--dim);
	}
	.hostnote {
		font-size: 12px;
		line-height: 1.55;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 10px 12px;
	}
	.hostnote b {
		color: var(--ink);
	}
	.hostnote i {
		color: var(--faint);
	}
	.schedrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}

	.presets {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.preset {
		display: flex;
		font: inherit;
		text-align: left;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 8px 12px;
		cursor: pointer;
		transform: skewX(-8deg);
	}
	.preset > .pn,
	.preset > small {
		display: block;
		transform: skewX(8deg);
	}
	.preset .pn {
		font-size: 11.5px;
		font-weight: 800;
	}
	.preset small {
		font-size: 10px;
		color: var(--faint);
	}
	.preset.on {
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-color: transparent;
		font-style: italic;
	}
	.preset.on small {
		color: color-mix(in srgb, var(--gold-ink) 70%, transparent);
	}

	.opts {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.opt {
		font: inherit;
		font-size: 12.5px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--dim);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0 12px;
		min-height: 34px;
		cursor: pointer;
		transform: skewX(-8deg);
		white-space: nowrap;
	}
	.opt.on {
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border-color: transparent;
		font-style: italic;
	}
	.opt:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.banner {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}
	.prev {
		width: 180px;
		aspect-ratio: 3 / 1;
		border: 1px dashed var(--line);
		border-radius: 10px;
		background: var(--panel-2) center / cover no-repeat;
		flex: none;
	}
	.prev.has {
		border-style: solid;
	}
	.bctl {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.filebtn {
		font-size: 12.5px;
		font-weight: 800;
		color: var(--ink);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 9px 14px;
		cursor: pointer;
	}
	.filebtn:hover {
		border-color: var(--gold-soft);
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 8px;
	}
	.ghost {
		font: inherit;
		font-size: 13px;
		font-weight: 800;
		color: var(--dim);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 0 16px;
		min-height: 42px;
		display: inline-flex;
		align-items: center;
		text-decoration: none;
	}
	.ghost:hover {
		color: var(--ink);
		border-color: var(--gold-soft);
	}
	.submit {
		font: inherit;
		font-size: 13.5px;
		font-weight: 900;
		font-style: italic;
		color: var(--gold-ink);
		background: linear-gradient(180deg, #ffe084, #c98f0e);
		border: 1px solid transparent;
		border-radius: 10px;
		padding: 0 20px;
		min-height: 44px;
		cursor: pointer;
		transform: skewX(-8deg);
		white-space: nowrap;
	}
	.submit > span {
		display: inline-block;
		transform: skewX(8deg);
	}
	.submit:hover:not(:disabled) {
		filter: brightness(1.05);
	}
	.submit:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.notice {
		font-size: 12.5px;
		font-weight: 700;
		text-align: right;
	}
	.notice.ok {
		color: var(--good);
	}
	.notice.err {
		color: var(--live);
	}
</style>
