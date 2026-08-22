<script lang="ts">
	import { base } from '$app/paths';
	import { api } from '$lib/config';
	import { flagEmoji } from '$lib/format';

	// 🪙 MONEY-MATCH RECEIPT — "RETRO RECEIPTS" treatment of a player's money-match head-to-head. Who they've
	// made the most coins from and lost the most to, rendered as a literal dark-theme receipt: monospace,
	// perforated edges, dashed section rules, itemized line-items (name left · net right), subtotals, and a
	// bold TOTAL NET. Reads GET /skinsync/wager/h2h?steamid=… → [{ opp, net, won, lost, games }] where `opp`
	// is a SteamID and `net` is the SIGNED coin total vs that opponent (positive = this player profited).
	// The endpoint is being built server-side and MAY NOT EXIST YET, so every non-2xx / parse blip becomes a
	// graceful "NO TRANSACTIONS YET" receipt — never an error screen. Opponent SteamIDs resolve to a name the
	// same way the rest of the profile does: from the pre-resolved `names` map the profile hands down (built
	// from its head-to-head / recent lists), plus any enrichment the row itself carries, else a short id.
	// Coins use the app's 🪙 brand mark; a small stacked earned/lost bar + a faux barcode are hand-authored
	// inline SVG (no chart libs — CSP-safe).

	interface H2HRow {
		opp: string;
		net: number; // signed coin total (positive = profited)
		won: number;
		lost: number;
		games: number;
		// enrichments the server MIGHT include (mirrors the /profile `vs` rows); optional, never relied on.
		name?: string;
		cc?: string;
		avatar?: string;
	}
	type NameInfo = { name?: string; cc?: string; avatar?: string };

	let {
		steamid,
		handle = '',
		names = {},
		limit = 8
	}: { steamid: string; handle?: string; names?: Record<string, NameInfo>; limit?: number } = $props();

	let rows = $state<H2HRow[]>([]);
	// `served` is true ONLY after a genuine 200 that parsed. A 404 / any non-2xx / network / parse failure
	// (= the endpoint isn't live yet) leaves it false → the whole section renders NOTHING, so every profile is
	// unchanged until the server ships /wager/h2h. The receipt (incl. the "NO TRANSACTIONS YET" empty state
	// for a 200 that returns []) appears automatically the moment the endpoint deploys — it already fetches live.
	let served = $state(false);
	let reqId = 0;

	const short = (sid: string) => (sid ? `…${sid.slice(-5)}` : 'PLAYER');

	// Faux receipt meta — captured once at mount so it reads like a printed slip (not a live clock).
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

	/** Coerce one raw row into a clean H2HRow (coins are integers). */
	function normalize(x: unknown): H2HRow {
		const r = (x ?? {}) as Record<string, unknown>;
		const won = Math.max(0, Math.round(Number(r.won ?? r.wins ?? 0)) || 0);
		const lost = Math.max(0, Math.round(Number(r.lost ?? r.losses ?? 0)) || 0);
		const gamesRaw = Math.round(Number(r.games));
		return {
			opp: String(r.opp ?? r.opp_id ?? r.steamid ?? ''),
			net: Math.round(Number(r.net ?? 0)) || 0,
			won,
			lost,
			games: Number.isFinite(gamesRaw) && gamesRaw > 0 ? gamesRaw : won + lost,
			name: r.name ? String(r.name) : undefined,
			cc: r.cc ? String(r.cc) : undefined,
			avatar: r.avatar ? String(r.avatar) : undefined
		};
	}

	async function load(sid: string): Promise<void> {
		const myReq = ++reqId;
		try {
			const res = await fetch(api(`/skinsync/wager/h2h?steamid=${encodeURIComponent(sid)}`), {
				headers: { accept: 'application/json' }
			});
			// 404 (endpoint not built yet) / any non-2xx → hide the section entirely (served stays false).
			if (!res.ok) {
				if (myReq === reqId) {
					rows = [];
					served = false;
				}
				return;
			}
			const j: unknown = await res.json();
			// Accept the documented bare array, or a common envelope shape, defensively.
			const arr: unknown[] = Array.isArray(j)
				? j
				: Array.isArray((j as { h2h?: unknown[] })?.h2h)
					? (j as { h2h: unknown[] }).h2h
					: Array.isArray((j as { rows?: unknown[] })?.rows)
						? (j as { rows: unknown[] }).rows
						: Array.isArray((j as { opponents?: unknown[] })?.opponents)
							? (j as { opponents: unknown[] }).opponents
							: [];
			if (myReq !== reqId) return;
			rows = arr.map(normalize).filter((r) => r.opp);
			served = true; // genuine 200 → show the receipt (empty array → the empty state below)
		} catch {
			if (myReq === reqId) {
				rows = []; // network / parse failure (endpoint absent) → hide the section, never an error screen
				served = false;
			}
		}
	}

	// Refetch whenever the profile changes. `lastSid` is a plain local so writing rows/served never re-runs this.
	let lastSid = '';
	$effect(() => {
		const s = steamid;
		if (s && s !== lastSid) {
			lastSid = s;
			rows = [];
			served = false;
			void load(s);
		}
	});

	// ── derived breakdown ──
	const nonZero = $derived(rows.filter((r) => r.net !== 0));
	const earned = $derived([...nonZero].filter((r) => r.net > 0).sort((a, b) => b.net - a.net));
	const losses = $derived([...nonZero].filter((r) => r.net < 0).sort((a, b) => a.net - b.net)); // most-negative first
	const earnedTop = $derived(earned.slice(0, limit));
	const lossesTop = $derived(losses.slice(0, limit));
	const earnedMore = $derived(earned.length - earnedTop.length);
	const lossesMore = $derived(losses.length - lossesTop.length);

	const subEarned = $derived(earned.reduce((s, r) => s + r.net, 0)); // ≥ 0
	const subLost = $derived(losses.reduce((s, r) => s + r.net, 0)); // ≤ 0
	const totalNet = $derived(rows.reduce((s, r) => s + r.net, 0));
	const totalGames = $derived(rows.reduce((s, r) => s + r.games, 0));

	const totalDir = $derived(totalNet > 0 ? 'up' : totalNet < 0 ? 'down' : 'flat');
	const custname = $derived(handle || (steamid ? short(steamid) : 'PLAYER'));
	const receiptNo = $derived(steamid ? steamid.slice(-6) : '------');

	// stacked earned/lost split bar (secondary accent) — proportional green vs red of gross coins moved.
	const gross = $derived(subEarned - subLost); // subLost ≤ 0 → this is |earned|+|lost|
	const earnedPct = $derived(gross > 0 ? Math.round((100 * subEarned) / gross) : 0);

	// faux barcode — deterministic per player so the same slip reprints the same code. Pure decoration.
	const barcode = $derived.by(() => {
		const seed = `${steamid}${receiptNo}` || '000000';
		const bars: { x: number; w: number }[] = [];
		let x = 0;
		for (let i = 0; i < seed.length; i++) {
			const d = seed.charCodeAt(i);
			const w = 0.7 + (d % 4) * 0.5; // 0.7 .. 2.2
			bars.push({ x, w });
			x += w + (0.6 + (d % 3) * 0.5); // gap 0.6 .. 1.6
		}
		return { bars, width: Math.max(1, x) };
	});

	function resolve(row: H2HRow): NameInfo & { href: string | null } {
		const ext = names[row.opp] ?? {};
		return {
			name: row.name || ext.name || short(row.opp),
			cc: row.cc || ext.cc,
			avatar: row.avatar || ext.avatar,
			href: /^\d{17}$/.test(row.opp) ? `${base}/u/${row.opp}` : null
		};
	}
	const money = (n: number) => `🪙 ${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
	const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
</script>

{#snippet lineItem(r: H2HRow, dir: 'up' | 'down')}
	{@const info = resolve(r)}
	<svelte:element this={info.href ? 'a' : 'div'} class="li" href={info.href}>
		<div class="li-main">
			<span class="li-nm">{#if info.cc}<span class="cf">{flagEmoji(info.cc)}</span> {/if}{info.name}</span>
			<span class="lead" aria-hidden="true"></span>
			<span class="li-amt {dir}">{signed(r.net)}</span>
		</div>
		<div class="li-det">QTY {r.games} · {r.won}W-{r.lost}L</div>
	</svelte:element>
{/snippet}

{#if served}
	<section class="wrap" aria-label="Money-match receipt">
		<div class="receipt mono">
			<!-- header -->
			<div class="rc-hd">
				<div class="brand">RETRO&nbsp;RECEIPTS</div>
				<div class="sub">· MONEY MATCH LEDGER ·</div>
			</div>
			<div class="rule dash"></div>
			<div class="meta">
				<div class="mrow"><span>CUSTOMER</span><span class="mv">{custname}</span></div>
				<div class="mrow"><span>DATE</span><span class="mv">{dateStr}</span></div>
				<div class="mrow"><span>RECEIPT</span><span class="mv">#{receiptNo}</span></div>
				<div class="mrow"><span>ITEMS</span><span class="mv">{rows.length} opp · {totalGames} txns</span></div>
			</div>
			<div class="rule dbl"></div>

			{#if rows.length === 0}
				<div class="void">
					<div class="void-lg">NO TRANSACTIONS YET</div>
					<div class="void-sm">Put a quarter on a set to start a rivalry.</div>
				</div>
				<div class="rule dbl"></div>
			{:else}
				<div class="unit">AMOUNTS IN 🪙 COINS</div>

				{#if earnedTop.length}
					<div class="sec">EARNED FROM</div>
					{#each earnedTop as r (r.opp)}{@render lineItem(r, 'up')}{/each}
					{#if earnedMore > 0}<div class="more">… +{earnedMore} more</div>{/if}
				{/if}

				{#if lossesTop.length}
					<div class="sec">PAID OUT TO</div>
					{#each lossesTop as r (r.opp)}{@render lineItem(r, 'down')}{/each}
					{#if lossesMore > 0}<div class="more">… +{lossesMore} more</div>{/if}
				{/if}

				{#if nonZero.length === 0}
					<div class="void"><div class="void-sm">All square — no net coins won or lost yet.</div></div>
				{/if}

				<div class="rule dash"></div>
				<div class="tot">
					<div class="trow"><span>SUBTOTAL EARNED</span><span class="tv up">{money(subEarned)}</span></div>
					<div class="trow"><span>SUBTOTAL LOST</span><span class="tv down">{money(subLost)}</span></div>
				</div>
				<div class="rule dbl"></div>
				<div class="grand {totalDir}">
					<span class="glabel">TOTAL NET</span>
					<span class="gval">{money(totalNet)}</span>
				</div>

				<!-- secondary accent: proportional earned vs lost split -->
				{#if gross > 0}
					<div class="split" title="{earnedPct}% of coins moved were earned">
						<svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
							<rect class="s-lost" x="0" width="100" height="6"></rect>
							<rect class="s-earn" x="0" width={earnedPct} height="6"></rect>
						</svg>
						<div class="split-lbl"><span class="up">{earnedPct}% earned</span><span class="down">{100 - earnedPct}% lost</span></div>
					</div>
				{/if}
				<div class="rule dbl"></div>
			{/if}

			<!-- footer -->
			<div class="foot">{rows.length ? 'THANK YOU FOR PLAYING' : 'NO PURCHASE NECESSARY'}</div>
			<svg class="barcode" viewBox="0 0 {barcode.width} 26" preserveAspectRatio="none" aria-hidden="true">
				{#each barcode.bars as b (b.x)}<rect x={b.x} y="0" width={b.w} height="26"></rect>{/each}
			</svg>
			<div class="code">*{receiptNo}*</div>
		</div>
	</section>
{/if}

<style>
	.wrap {
		margin-top: 18px;
		display: flex;
		justify-content: center;
	}
	/* dark "receipt paper" — token-driven so it lives inside the arena palette, not stark thermal white */
	.receipt {
		position: relative;
		width: 100%;
		max-width: 400px;
		padding: 18px 20px 20px;
		background:
			repeating-linear-gradient(
				0deg,
				transparent,
				transparent 26px,
				color-mix(in srgb, var(--ink) 3%, transparent) 26px,
				color-mix(in srgb, var(--ink) 3%, transparent) 27px
			),
			var(--panel);
		color: var(--ink);
		box-shadow: var(--shadow);
		font-size: 12px;
		line-height: 1.5;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
		font-variant-numeric: tabular-nums;
	}
	/* perforated top & bottom edges (triangular tear) — the receipt-paper cue, drawn in paper color over --bg */
	.receipt::before,
	.receipt::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 9px;
		background-image:
			linear-gradient(135deg, var(--panel) 40%, transparent 41%),
			linear-gradient(225deg, var(--panel) 40%, transparent 41%);
		background-position: 0 0;
		background-size: 12px 9px;
		background-repeat: repeat-x;
	}
	.receipt::before {
		top: -9px;
		transform: scaleY(-1);
	}
	.receipt::after {
		bottom: -9px;
	}

	.rc-hd {
		text-align: center;
	}
	.brand {
		font-size: 15px;
		font-weight: 800;
		letter-spacing: 0.18em;
		color: var(--ink);
	}
	.rc-hd .sub {
		margin-top: 2px;
		font-size: 10.5px;
		letter-spacing: 0.14em;
		color: var(--dim);
	}

	/* dividers: dashed = light rule (----), double = heavy rule (====) */
	.rule {
		height: 0;
		margin: 9px 0;
	}
	.rule.dash {
		border-top: 1px dashed color-mix(in srgb, var(--faint) 70%, transparent);
	}
	.rule.dbl {
		border-top: 3px double color-mix(in srgb, var(--faint) 75%, transparent);
	}

	.meta,
	.tot {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.mrow,
	.trow {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.mrow > span:first-child,
	.trow > span:first-child {
		color: var(--faint);
		letter-spacing: 0.08em;
		font-size: 10.5px;
	}
	.mv {
		color: var(--dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		text-align: right;
	}

	.unit {
		text-align: center;
		font-size: 9.5px;
		letter-spacing: 0.14em;
		color: var(--faint);
		margin-bottom: 8px;
	}
	.sec {
		font-size: 10.5px;
		font-weight: 800;
		letter-spacing: 0.14em;
		color: var(--dim);
		margin: 10px 0 4px;
	}

	/* line item — name · dotted leader · net; a receipt "qty/detail" sub-line beneath */
	.li {
		display: block;
		padding: 3px 0;
		text-decoration: none;
		color: inherit;
	}
	.li-main {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: baseline;
	}
	.li-nm {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		color: var(--ink);
		font-weight: 700;
	}
	.li-nm .cf {
		font-weight: 400;
	}
	a.li:hover .li-nm {
		color: var(--gold);
		text-decoration: underline;
	}
	.lead {
		border-bottom: 1px dotted color-mix(in srgb, var(--faint) 55%, transparent);
		transform: translateY(-4px);
		margin: 0 7px;
	}
	.li-amt {
		flex: none;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.li-amt.up {
		color: var(--good);
	}
	.li-amt.down {
		color: var(--loss);
	}
	.li-det {
		font-size: 9.5px;
		letter-spacing: 0.04em;
		color: var(--faint);
	}
	.more {
		font-size: 10px;
		color: var(--faint);
		padding: 3px 0;
	}

	.tv {
		font-weight: 800;
	}
	.tv.up {
		color: var(--good);
	}
	.tv.down {
		color: var(--loss);
	}

	/* TOTAL NET — the receipt's emphasis line (colored by direction; gold stays reserved elsewhere) */
	.grand {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.glabel {
		font-size: 13px;
		font-weight: 800;
		letter-spacing: 0.1em;
		color: var(--ink);
	}
	.gval {
		font-size: 18px;
		font-weight: 900;
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.grand.up .gval {
		color: var(--good);
	}
	.grand.down .gval {
		color: var(--loss);
	}

	/* secondary accent — earned/lost split (inline SVG, no libs) */
	.split {
		margin-top: 12px;
	}
	.split svg {
		display: block;
		width: 100%;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
	}
	.s-lost {
		fill: color-mix(in srgb, var(--loss) 85%, transparent);
	}
	.s-earn {
		fill: var(--good);
	}
	.split-lbl {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: 9.5px;
		letter-spacing: 0.06em;
	}
	.split-lbl .up {
		color: var(--good);
	}
	.split-lbl .down {
		color: var(--loss);
	}

	.void {
		text-align: center;
		padding: 14px 6px;
	}
	.void-lg {
		font-size: 13px;
		font-weight: 800;
		letter-spacing: 0.16em;
		color: var(--dim);
	}
	.void-sm {
		margin-top: 6px;
		font-size: 10.5px;
		color: var(--faint);
	}

	.foot {
		text-align: center;
		font-size: 10px;
		letter-spacing: 0.2em;
		color: var(--faint);
		margin-top: 4px;
	}
	.barcode {
		display: block;
		width: 100%;
		height: 26px;
		margin: 8px 0 4px;
	}
	.barcode rect {
		fill: color-mix(in srgb, var(--ink) 78%, transparent);
	}
	.code {
		text-align: center;
		font-size: 11px;
		letter-spacing: 0.32em;
		color: var(--dim);
	}
</style>
