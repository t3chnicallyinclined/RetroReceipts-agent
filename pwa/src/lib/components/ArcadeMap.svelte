<script lang="ts">
	import { hosts as hostsStore, hostStatus, type Host } from '$lib/stores/hosts.svelte';

	// ArcadeMap — the "hosting side" world view for the Fleet/Arcades page (the maplecast-style node map,
	// reborn for THE ARENA). An equirectangular SVG world (viewBox 0 0 360 180) where every geo maps
	// straight onto the canvas via x = lng + 180, y = 90 - lat — so the FGC regions and the live host
	// cabinets ("arcades") drop into place without a projection library. Pure inline SVG + CSS: the app
	// runs a strict CSP, so there are no map tiles, no external art, no runtime deps.
	//
	// It reads the shared `hosts` store itself (the only prop is an optional compact mode) and degrades
	// gracefully as the server's geo enrichment lands:
	//   (a) host has lat/lng      → an exact glowing pin at the projected point (molten if in a match)
	//   (b) else host has `cc`     → bucketed into a region via a country→region table
	//   (c) else host has geo      → bucketed into its nearest region node
	//   (d) else the coarse `region` text is fuzzy-matched to a region
	//   (e) else it's counted as "locating…" so nothing is ever silently dropped.
	// Each region shows a node whose glow/size scales with how many arcades sit in it (0 = a faint empty
	// marker), its label, and its arcade count. See HostCard.svelte for the shared runes/token vocabulary.

	let { compact = false }: { compact?: boolean } = $props();

	// The store's Host type doesn't yet carry geo (the server ships cc/city/lat/lng "soon"); read them
	// through a local widening so this compiles today and lights up the instant the fields arrive. Nothing
	// here writes the store — this is a read-only projection of the same shape HostCard consumes.
	interface GeoHost extends Host {
		cc?: string;
		city?: string;
		lat?: number;
		lng?: number;
	}

	type RegionKey = 'na-w' | 'na-e' | 'latam' | 'eu' | 'mena' | 'ea' | 'sea' | 'oce';

	interface RegionDef {
		key: RegionKey;
		label: string;
		x: number; // approx equirect x (= lng + 180)
		y: number; // approx equirect y (= 90 - lat)
	}

	// The major FGC regions, positioned in equirect space (the x,y the spec fixes). These double as both
	// the drawn region node AND the drop target for any host we can only place coarsely.
	const REGIONS: RegionDef[] = [
		{ key: 'na-w', label: 'NA West', x: 60, y: 52 },
		{ key: 'na-e', label: 'NA East', x: 100, y: 52 },
		{ key: 'latam', label: 'Latin America', x: 115, y: 108 },
		{ key: 'eu', label: 'Europe', x: 190, y: 42 },
		{ key: 'mena', label: 'MENA', x: 210, y: 78 },
		{ key: 'ea', label: 'East Asia', x: 300, y: 56 },
		{ key: 'sea', label: 'SE Asia', x: 290, y: 88 },
		{ key: 'oce', label: 'Oceania', x: 325, y: 122 }
	];

	// ISO-2 country → region. The FGC-common set from the brief, plus a handful of obvious neighbours so a
	// real country code rarely falls through to "locating". US can't be split W/E from a code alone, so it
	// buckets to NA East (the spec's fallback); a US host WITH lat/lng still gets an exact pin regardless.
	const CC_REGION: Record<string, RegionKey> = {
		US: 'na-e', CA: 'na-e',
		MX: 'latam', BR: 'latam', AR: 'latam', CL: 'latam', PE: 'latam', CO: 'latam', EC: 'latam',
		VE: 'latam', UY: 'latam', PY: 'latam', BO: 'latam', CR: 'latam', PA: 'latam', GT: 'latam', DO: 'latam',
		GB: 'eu', FR: 'eu', DE: 'eu', ES: 'eu', IT: 'eu', SE: 'eu', NL: 'eu', PL: 'eu', PT: 'eu', BE: 'eu',
		CH: 'eu', AT: 'eu', NO: 'eu', DK: 'eu', FI: 'eu', IE: 'eu', GR: 'eu', CZ: 'eu', RO: 'eu', HU: 'eu',
		UA: 'eu', RU: 'eu',
		JP: 'ea', KR: 'ea', CN: 'ea', HK: 'ea', TW: 'ea', MO: 'ea',
		PH: 'sea', SG: 'sea', MY: 'sea', TH: 'sea', ID: 'sea', VN: 'sea', MM: 'sea', KH: 'sea', LA: 'sea',
		AU: 'oce', NZ: 'oce',
		SA: 'mena', AE: 'mena', EG: 'mena', QA: 'mena', KW: 'mena', BH: 'mena', OM: 'mena', JO: 'mena',
		IL: 'mena', IR: 'mena', IQ: 'mena', TR: 'mena', LB: 'mena', MA: 'mena', DZ: 'mena', TN: 'mena'
	};

	// Fuzzy keyword buckets for the coarse free-text `region` we have TODAY (e.g. "NA East", "EU", "SEA").
	// Order matters — more specific first (SE Asia before East Asia; the NA split before generic "north
	// america") — and short tokens are space-padded so " na "/" eu "/" sea " don't match inside other words.
	const TEXT_KEYS: { key: RegionKey; keys: string[] }[] = [
		{ key: 'na-w', keys: ['na west', 'us west', 'west coast', 'california', 'norcal', 'socal', 'pacific northwest'] },
		{ key: 'na-e', keys: ['na east', 'us east', 'east coast', 'north america', 'united states', ' usa ', 'canada', 'texas', 'midwest', ' na '] },
		{ key: 'latam', keys: ['latin', 'south america', 'sudam', 'latam', 'mexico', 'brazil', 'brasil', 'argentin', 'chile', 'peru', 'colombia'] },
		{ key: 'sea', keys: ['se asia', 'southeast asia', 'south east asia', ' sea ', 'philippin', 'singapore', 'malaysia', 'thailand', 'indonesia', 'vietnam'] },
		{ key: 'ea', keys: ['east asia', ' asia ', 'japan', 'korea', 'china', 'taiwan', 'hong kong', 'asia'] },
		{ key: 'mena', keys: ['mena', 'middle east', 'arab', 'saudi', 'emirates', 'egypt', 'africa', 'gulf'] },
		{ key: 'eu', keys: ['europe', ' eu ', 'united kingdom', ' uk ', 'britain', 'german', 'france', 'french', 'spain', 'italy', 'nordic', 'scandinav'] },
		{ key: 'oce', keys: ['oceania', 'australia', 'new zealand', 'aussie', ' nz ', ' oce '] }
	];

	function matchRegionText(region: string | undefined): RegionKey | null {
		if (!region) return null;
		// Normalize punctuation to spaces and pad both ends so word-boundary tokens (" na ") work by substring.
		const t = ` ${region.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
		for (const { key, keys } of TEXT_KEYS) {
			for (const k of keys) if (t.includes(k)) return key;
		}
		return null;
	}

	// For a host we DO know precisely (lat/lng) but that has no country code, tie it to the closest region
	// node so it still contributes to a per-region tally (its exact pin is drawn separately).
	function nearestRegion(x: number, y: number): RegionKey {
		let best: RegionDef = REGIONS[0];
		let bd = Infinity;
		for (const r of REGIONS) {
			const d = (r.x - x) ** 2 + (r.y - y) ** 2;
			if (d < bd) {
				bd = d;
				best = r;
			}
		}
		return best.key;
	}

	// Node geometry — the core radius grows with the arcade count (capped) and the glow is a fixed multiple
	// of it, so a busy region reads "hotter" at a glance without ever swamping the map.
	const coreR = (n: number): number => 2.3 + Math.min(n, 8) * 0.34;
	const glowR = (n: number): number => coreR(n) * 2.7;

	interface RegionState extends RegionDef {
		count: number;
		match: boolean; // at least one host in this region is in a live match
	}
	interface Pin {
		host: Host;
		x: number;
		y: number;
		match: boolean;
		sub: string; // tooltip subtitle (city → region text → generic)
	}

	// The whole placement pass in one derived: bucket every host, tally per region, collect exact pins, and
	// count the ones we can't place yet. Recomputes whenever the polled store changes.
	const model = $derived.by(() => {
		const list = hostsStore.hosts;
		const counts = new Map<RegionKey, { count: number; match: boolean }>();
		for (const r of REGIONS) counts.set(r.key, { count: 0, match: false });
		const pins: Pin[] = [];
		let locating = 0;

		for (const h of list) {
			const g = h as GeoHost;
			const isMatch = hostStatus(h) === 'match';

			// (a) exact geo → a precise pin. Guard the ranges so a bad payload can't fling a dot off-map.
			let px = 0,
				py = 0,
				hasGeo = false;
			const lat = g.lat,
				lng = g.lng;
			if (
				typeof lat === 'number' &&
				typeof lng === 'number' &&
				Number.isFinite(lat) &&
				Number.isFinite(lng) &&
				lat >= -90 &&
				lat <= 90 &&
				lng >= -180 &&
				lng <= 180
			) {
				hasGeo = true;
				px = lng + 180; // x = lng + 180
				py = 90 - lat; // y = 90 - lat
			}

			// Region bucket for the tally: (b) country code → (c) nearest node for geo → (d) fuzzy text.
			const cc = (g.cc || '').trim().toUpperCase();
			let key: RegionKey | null = cc && CC_REGION[cc] ? CC_REGION[cc] : null;
			if (!key && hasGeo) key = nearestRegion(px, py);
			if (!key) key = matchRegionText(h.region);

			if (hasGeo) {
				pins.push({ host: h, x: px, y: py, match: isMatch, sub: g.city || h.region || 'live arcade' });
			}
			if (key) {
				const c = counts.get(key)!;
				c.count += 1;
				if (isMatch) c.match = true;
			} else {
				// (e) no geo, no known country, no recognizable region text → can't be placed yet.
				locating += 1;
			}
		}

		const regions: RegionState[] = REGIONS.map((r) => {
			const c = counts.get(r.key)!;
			return { ...r, count: c.count, match: c.match };
		});
		const activeRegions = regions.reduce((n, r) => n + (r.count > 0 ? 1 : 0), 0);

		return { total: list.length, activeRegions, locating, regions, pins };
	});

	const ariaLabel = $derived(
		model.total === 0
			? 'World map: no live arcades right now'
			: `World map of ${model.total} live ${model.total === 1 ? 'arcade' : 'arcades'} across ${model.activeRegions} ${model.activeRegions === 1 ? 'region' : 'regions'}`
	);

	// Refcounted poll — safe to add another consumer even if the Fleet page already started it; this keeps
	// the map live when it's dropped in standalone. Browser-only ($effect never runs during SSR).
	$effect(() => {
		hostsStore.start();
		return () => hostsStore.stop();
	});

	// ── Static world backdrop (decorative) ──────────────────────────────────────────────────────────────
	// Graticule: meridians + parallels every 30°. The equator (y=90) and prime meridian (x=180) read a hair
	// stronger so the world orients itself.
	const MERIDIANS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
	const PARALLELS = [0, 30, 60, 90, 120, 150, 180];

	// Simplified continent silhouettes as equirect polygon point-strings (x = lng+180, y = 90-lat). Low
	// detail on purpose — a backdrop, not a basemap; the pins are the focus.
	const CONTINENTS: string[] = [
		// North America
		'20,26 50,20 85,18 105,22 120,34 118,44 104,50 100,58 99,66 90,64 83,64 74,67 66,58 58,52 50,44 42,38 32,32 24,29',
		// Greenland
		'120,15 135,12 141,20 134,30 123,27 117,20',
		// South America
		'105,80 118,82 130,86 145,98 139,108 133,116 123,127 116,131 112,145 109,129 106,113 103,102 101,92',
		// Africa
		'174,56 190,53 201,55 212,60 216,67 231,80 224,89 220,92 214,106 206,120 199,124 193,116 189,104 184,92 182,85 174,84 164,76 166,68 168,63 171,59',
		// Europe
		'171,50 168,44 174,40 178,35 182,29 190,25 198,27 203,35 205,43 200,49 194,49 188,47 182,45 176,47',
		// Asia (incl. Middle East + India)
		'210,51 216,44 224,40 240,30 260,22 285,17 310,21 335,26 330,34 316,44 308,52 302,58 292,66 287,73 283,86 279,79 276,70 268,74 258,82 252,72 248,64 244,62 236,66 232,76 226,72 220,66 216,58 212,54',
		// Australia
		'295,122 301,113 306,106 312,102 320,102 324,101 330,110 333,118 331,125 325,128 318,126 309,123 301,122',
		// New Zealand
		'340,132 344,130 346,136 343,142 339,138'
	];
</script>

<figure class="arcade-map" class:compact>
	<figcaption class="head">
		{#if model.total === 0}
			<span class="sum"><b>0</b> arcades live</span>
		{:else}
			<span class="sum">
				<b>{model.total}</b>
				{model.total === 1 ? 'arcade' : 'arcades'} live <span class="acr">across</span>
				<b>{model.activeRegions}</b>
				{model.activeRegions === 1 ? 'region' : 'regions'}{#if model.locating > 0}<span class="loc"
						> · {model.locating} locating…</span
					>{/if}
			</span>
		{/if}
		{#if !compact}
			<span class="legend" aria-hidden="true">
				<span class="lg"><span class="dot gold"></span> arcades here</span>
				<span class="lg"><span class="dot hot"></span> match live</span>
			</span>
		{/if}
	</figcaption>

	<div class="canvas">
		<svg class="map" viewBox="0 0 360 180" preserveAspectRatio="xMidYMid meet" role="img" aria-label={ariaLabel}>
			<!-- graticule -->
			<g class="grat" aria-hidden="true">
				{#each MERIDIANS as mx (mx)}
					<line x1={mx} y1="0" x2={mx} y2="180" class:axis={mx === 180} />
				{/each}
				{#each PARALLELS as py (py)}
					<line x1="0" y1={py} x2="360" y2={py} class:axis={py === 90} />
				{/each}
			</g>

			<!-- simplified continents (backdrop) -->
			<g class="land-group" aria-hidden="true">
				{#each CONTINENTS as pts, i (i)}
					<polygon class="land" points={pts} />
				{/each}
			</g>

			<!-- region nodes: glow scales with arcade count; 0 = a faint empty marker -->
			<g class="regions">
				{#each model.regions as r (r.key)}
					<g class="region" class:hot={r.match}>
						<title
							>{r.label} — {r.count}
							{r.count === 1 ? 'arcade' : 'arcades'}{r.match ? ' · match live' : ''}</title
						>
						{#if r.count > 0}
							<circle class="rglow" class:hot={r.match} cx={r.x} cy={r.y} r={glowR(r.count)} />
							<circle class="rcore" class:hot={r.match} cx={r.x} cy={r.y} r={coreR(r.count)} />
						{:else}
							<circle class="rempty" cx={r.x} cy={r.y} r="2" />
						{/if}
						<text
							class="rlabel"
							x={r.x}
							y={r.y + coreR(Math.max(r.count, 1)) + 4.6}
							text-anchor="middle"
						>
							<tspan class="rname" class:on={r.count > 0}>{r.label}</tspan>{#if r.count > 0}<tspan
									class="rcnt"
									dx="1.4">{r.count}</tspan
								>{/if}
						</text>
					</g>
				{/each}
			</g>

			<!-- exact pins for hosts with real lat/lng (drawn over the region aggregates) -->
			<g class="pins">
				{#each model.pins as p, i (p.host.steamid + ':' + i)}
					<g class="pin" class:hot={p.match}>
						<title>{p.host.name} — {p.sub}</title>
						<circle class="pglow" cx={p.x} cy={p.y} r="3" />
						<circle class="pcore" cx={p.x} cy={p.y} r="1.4" />
					</g>
				{/each}
			</g>

			{#if model.total === 0}
				<text class="emptymsg" x="180" y="96" text-anchor="middle">No arcades online right now.</text>
			{/if}
		</svg>
	</div>
</figure>

<style>
	/* --hot is the "molten" match accent. app.css doesn't define --molten yet (the fleet UI uses --live
	   for match), so reference it with the spec's exact fallback: if the design system later ships
	   --molten this picks it up, otherwise it renders the intended #ff5c2c. No new global palette. */
	.arcade-map {
		--hot: var(--molten, #ff5c2c);
		display: block;
		margin: 0;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px 14px;
		margin-bottom: 10px;
	}
	.sum {
		font-size: 13px;
		color: var(--dim);
		font-variant-numeric: tabular-nums;
	}
	.sum b {
		color: var(--ink);
		font-weight: 900;
		font-size: 15px;
	}
	.sum .acr {
		color: var(--faint);
	}
	.sum .loc {
		color: var(--faint);
	}
	.compact .sum {
		font-size: 12px;
	}

	.legend {
		display: inline-flex;
		align-items: center;
		gap: 14px;
		font-size: 11px;
		color: var(--dim);
	}
	.lg {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.legend .dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
	.legend .dot.gold {
		background: var(--gold);
		box-shadow: 0 0 6px color-mix(in srgb, var(--gold) 70%, transparent);
	}
	.legend .dot.hot {
		background: var(--hot);
		box-shadow: 0 0 6px color-mix(in srgb, var(--hot) 70%, transparent);
	}

	/* overflow-x:auto is the safety net — the map never breaks the page on a very narrow screen. */
	.canvas {
		overflow-x: auto;
		overflow-y: hidden;
		border: 1px solid var(--line);
		border-radius: 14px;
		background:
			radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--gold) 5%, transparent), transparent 60%),
			var(--board);
		padding: 8px;
		box-shadow: var(--shadow);
	}
	svg.map {
		display: block;
		width: 100%;
		min-width: 300px;
		max-width: 720px;
		height: auto;
		margin: 0 auto;
	}
	.compact svg.map {
		max-width: 480px;
	}

	/* graticule — subtle world grid */
	.grat line {
		stroke: var(--line);
		stroke-width: 0.3;
		opacity: 0.5;
	}
	.grat line.axis {
		opacity: 0.8;
	}

	/* continents — low-detail filled blobs, a shade above the board so they read as land but stay backdrop */
	.land {
		fill: var(--panel-2);
		fill-opacity: 0.6;
		stroke: var(--line);
		stroke-width: 0.3;
		stroke-opacity: 0.6;
	}

	/* region nodes */
	.rempty {
		fill: none;
		stroke: var(--faint);
		stroke-width: 0.5;
		opacity: 0.55;
	}
	.rglow {
		fill: var(--gold);
		opacity: 0.16;
	}
	.rglow.hot {
		fill: var(--hot);
		opacity: 0.2;
	}
	.rcore {
		fill: var(--gold);
		stroke: color-mix(in srgb, var(--gold) 40%, #fff);
		stroke-width: 0.3;
	}
	.rcore.hot {
		fill: var(--hot);
	}

	.rlabel {
		/* dark halo so labels stay legible over the grid/continents */
		paint-order: stroke fill;
		stroke: var(--bg);
		stroke-width: 0.8;
		stroke-linejoin: round;
	}
	.rname {
		fill: var(--faint);
		font-size: 4px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}
	.rname.on {
		fill: var(--dim);
	}
	.rcnt {
		fill: var(--gold);
		font-size: 4.2px;
		font-weight: 900;
		font-variant-numeric: tabular-nums;
	}
	.region.hot .rcnt {
		fill: var(--hot);
	}

	/* exact pins */
	.pglow {
		fill: var(--gold);
		opacity: 0.22;
	}
	.pin.hot .pglow {
		fill: var(--hot);
	}
	.pcore {
		fill: var(--gold);
		stroke: color-mix(in srgb, #fff 55%, var(--gold));
		stroke-width: 0.25;
	}
	.pin.hot .pcore {
		fill: var(--hot);
	}
	.region,
	.pin {
		cursor: default;
	}

	.emptymsg {
		fill: var(--faint);
		font-size: 5px;
		font-weight: 700;
		letter-spacing: 0.03em;
		paint-order: stroke fill;
		stroke: var(--bg);
		stroke-width: 1;
	}

	/* Motion only when the viewer allows it — a gentle breathe on live nodes, a stronger pulse for matches. */
	@media (prefers-reduced-motion: no-preference) {
		.rcore.hot,
		.pin.hot .pcore {
			animation: rr-pulse 1.7s ease-in-out infinite;
			transform-box: fill-box;
			transform-origin: center;
		}
		.rglow.hot,
		.pin.hot .pglow {
			animation: rr-glow 1.7s ease-in-out infinite;
			transform-box: fill-box;
			transform-origin: center;
		}
		.rcore {
			animation: rr-breathe 3.2s ease-in-out infinite;
		}
	}
	@keyframes rr-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
	@keyframes rr-glow {
		0%,
		100% {
			opacity: 0.2;
			transform: scale(1);
		}
		50% {
			opacity: 0.34;
			transform: scale(1.18);
		}
	}
	@keyframes rr-breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.82;
		}
	}
</style>
