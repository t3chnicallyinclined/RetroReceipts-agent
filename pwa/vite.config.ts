import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// ── Replay packs in DEV (LIVE tab, ReplayEmbed) ──────────────────────────────────────────────────────
// A pack (packs/<id>/manifest.json + files) is ROM-derived game pixels: NEVER committed, never in static/.
// In dev the ReplayEmbed fetches /replay/packs/<id>/… and this middleware streams those files straight
// out of the render lane's pack folder (d3dcap/replay/packs) — no copy, no second server. Override with
// RR_PACKS_DIR. If a gitignored pwa/static/replay/packs/ junction exists instead, Vite's public-dir
// handling serves it first and this middleware never sees the request. Production pack hosting is
// lane-1 contract C3 (LIVE-TAB-SPEC §11) — this is dev-only by construction (configureServer).
const PACKS_DIR =
	process.env.RR_PACKS_DIR ??
	path.resolve(__dirname, '../../mvc-live-skins-quarters/d3dcap/replay/packs');
const PACK_MIME: Record<string, string> = {
	'.json': 'application/json',
	'.png': 'image/png',
	'.gz': 'application/gzip', // tape.json.gz is handed to the wasm AS BYTES — never Content-Encoding it
	'.bin': 'application/octet-stream',
	'.BIN': 'application/octet-stream'
};
function replayPacksDev(): Plugin {
	return {
		name: 'rr-replay-packs-dev',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = (req.url ?? '').split('?')[0];
				if (!url.startsWith('/replay/packs/')) return next();
				// /replay/packs/<id>/<file…> → <PACKS_DIR>/<id>/<file…>; refuse anything that escapes the dir.
				const rel = decodeURIComponent(url.slice('/replay/packs/'.length));
				const file = path.resolve(PACKS_DIR, rel);
				if (!file.startsWith(PACKS_DIR + path.sep) || !existsSync(file) || statSync(file).isDirectory()) return next();
				res.setHeader('Content-Type', PACK_MIME[path.extname(file)] ?? 'application/octet-stream');
				res.setHeader('Content-Length', String(statSync(file).size));
				res.setHeader('Cache-Control', 'no-store');
				createReadStream(file).pipe(res);
			});
		}
	};
}

// Same BASE_PATH the SvelteKit config reads (svelte.config.js). Prod deploy at nobd.net/app
// sets BASE_PATH=/app; dev/bare build leave it '' (root). The PWA scope/start_url must match
// the served path or an installed app can't route offline, so derive them here — never hard-wire.
const BASE = process.env.BASE_PATH ?? '';
const SCOPE = `${BASE}/`; // scope + start_url want a trailing slash; SvelteKit's base does not.

// In prod the PWA is served same-origin at nobd.net/app, so API GETs hit /rr directly (the server also
// still accepts the legacy /skinsync prefix during the rename drain). In dev we proxy /rr (and /skinsync)
// → https://nobd.net so the browser never hits CORS. The API base is a config constant (PUBLIC_API_BASE,
// default '' = same-origin) so nothing here is hard-wired.
export default defineConfig({
	plugins: [
		sveltekit(),
		replayPacksDev(),
		SvelteKitPWA({
			strategies: 'generateSW',
			registerType: 'autoUpdate',
			scope: SCOPE,
			base: SCOPE,
			manifest: {
				name: 'Retro Receipts',
				short_name: 'RR',
				description: 'Marvel vs Capcom 2 — ranks, head-to-head, money matches & tournaments. Get that receipt!',
				theme_color: '#0a0c12',
				id: SCOPE,
					start_url: SCOPE,
					background_color: '#0a0c12',
				display: 'standalone',
				orientation: 'portrait',
				categories: ['games', 'sports'],
				// PNG FIRST, deliberately: Chrome will not use an SVG for an INSTALLED app/shortcut icon and
				// falls back to a generated letter tile, which is why an installed shortcut showed a letter
				// instead of the receipt. The SVGs stay last as the scalable option. Regenerate the PNGs with
				// `node scripts/build-icons.mjs` after editing the SVGs in static/.
				// ?v=2 forces browsers that cached the old MetaSync "M" mark to re-fetch — icon caches are
				// separate from the page cache and survive a hard refresh. Bump it when the art changes.
				icons: [
					{ src: 'icon-192.png?v=2', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: 'icon-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{ src: 'icon-maskable-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					{ src: 'icon.svg?v=2', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
					{ src: 'icon-maskable.svg?v=2', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
				]
			},
			workbox: {
				// App-shell precache only — deliberately not over-built (Phase 1).
				globPatterns: ['**/*.{js,css,html,svg,ico,png,woff,woff2}'],
				navigateFallback: SCOPE,
				runtimeCaching: [
					{
						// SSOT sweep fix (2026-08-24): LIVE endpoints get a 60s fallback ceiling. Under the old
						// single rule, any response >5s on a bad connection silently served a SIX-HOUR-old
						// leaderboard/presence/wager body as if live. The in-memory stores already keep-last-good,
						// so a long-lived SW fallback for these buys nothing online. Rule order matters: first
						// match wins, so this must precede the general /rr/ rule.
						urlPattern: ({ url, request }) =>
							/^\/(?:rr|skinsync)\/(?:leaderboard|presence|notifications|coins|wager|challenges|matches)/.test(
								url.pathname
							) &&
							!url.pathname.includes('/rt/') &&
							request.method === 'GET',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'rr-api-live',
							networkTimeoutSeconds: 5,
							expiration: { maxEntries: 32, maxAgeSeconds: 60 },
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						// NetworkFirst for the remaining API GETs; NEVER the SSE stream (/rt/) — that must stay
						// live. Prefix is /rr/ post-rename; also match the legacy /skinsync/ so a client that has
						// not yet re-cached the new shell still caches correctly during the drain window.
						urlPattern: ({ url, request }) =>
							(url.pathname.startsWith('/rr/') || url.pathname.startsWith('/skinsync/')) &&
							!url.pathname.includes('/rt/') &&
							request.method === 'GET',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'rr-api',
							networkTimeoutSeconds: 5,
							expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 6 },
							cacheableResponse: { statuses: [0, 200] }
						}
					}
				]
			},
			// SSE + a service worker in dev is a debugging footgun; keep the SW to production.
			devOptions: { enabled: false }
		})
	],
	server: {
		proxy: {
			// API prefix is /rr/ post-rename; keep /skinsync during the drain so old paths still proxy in dev.
			'/rr': {
				target: 'https://nobd.net',
				changeOrigin: true,
				secure: true
			},
			'/skinsync': {
				target: 'https://nobd.net',
				changeOrigin: true,
				secure: true
			}
		}
	}
});
