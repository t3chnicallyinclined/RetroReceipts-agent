import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

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
				icons: [
					{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{ src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
					{ src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
				]
			},
			workbox: {
				// App-shell precache only — deliberately not over-built (Phase 1).
				globPatterns: ['**/*.{js,css,html,svg,ico,png,woff,woff2}'],
				navigateFallback: SCOPE,
				runtimeCaching: [
					{
						// NetworkFirst for API GETs; NEVER the SSE stream (/rt/) — that must stay live.
						// Prefix is /rr/ post-rename; also match the legacy /skinsync/ so a client that has not
						// yet re-cached the new shell still caches correctly during the drain window.
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
