// release-app.mjs — the PWA release pipeline: build → headless render-check GATE → deploy.
// The deploy runs ONLY if the render-check passes, so a build-clean-but-runtime-broken change (Svelte
// hydration crash, undefined access) is caught before it ever reaches an environment. That is the exact
// class of bug that took prod down once; this script exists so it can't again.
//
//   node scripts/release-app.mjs staging   # → nobd.net/app-staging   (I push here; you test)
//   node scripts/release-app.mjs prod       # → nobd.net/app           (promote once staging looks right)
//
// staging and prod are built from the SAME working tree; they differ only in BASE_PATH (asset-url prefix +
// service-worker scope) so the two PWAs never cache-collide on one machine. Component code is identical, so
// what the gate validates on staging is what ships to prod.
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

// Async child runner — MUST be used for the render-check while the in-process server is up: spawnSync would
// block this process's event loop, so the server couldn't answer the child's requests and goto() would hang.
function run(cmd, args, extraEnv) {
	return new Promise((resolve) => {
		const c = spawn(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...extraEnv } });
		c.on('close', (code) => resolve(code ?? 1));
		c.on('error', () => resolve(1));
	});
}

const ENVS = {
	staging: { base: '/app-staging', dir: '/var/www/metasync-app/app-staging' },
	prod: { base: '/app', dir: '/var/www/metasync-app/app' }
};
const envName = process.argv[2];
const cfg = ENVS[envName];
if (!cfg) {
	console.error('usage: node scripts/release-app.mjs <staging|prod>');
	process.exit(2);
}

// ── 1) build ──────────────────────────────────────────────────────────────────────────────────────
console.log(`\n▶ build (BASE_PATH=${cfg.base})`);
const build = spawnSync('npm', ['run', 'build'], {
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, BASE_PATH: cfg.base, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }
});
if (build.status !== 0) {
	console.error('✗ build failed — aborting');
	process.exit(1);
}

// ── 2) serve build/ in-process (static + SPA fallback under the base) so the render-check has a target ──
const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
	'.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.png': 'image/png',
	'.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
	'.txt': 'text/plain', '.map': 'application/json'
};
const ROOT = 'build';
const base = cfg.base;
const server = http.createServer(async (req, res) => {
	try {
		let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (base && p.startsWith(base)) p = p.slice(base.length);
		if (p === '' || p === '/') p = '/index.html';
		let file = join(ROOT, p);
		try {
			const s = await stat(file);
			if (s.isDirectory()) file = join(file, 'index.html');
		} catch {
			file = join(ROOT, 'index.html'); // SPA fallback for client routes (/ranks, /profile, …)
		}
		let body;
		try {
			body = await readFile(file);
		} catch {
			body = await readFile(join(ROOT, 'index.html'));
			file = 'index.html';
		}
		res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
		res.end(body);
	} catch {
		res.statusCode = 500;
		res.end('err');
	}
});
const PORT = 4188;
await new Promise((r) => server.listen(PORT, r));
const url = `http://localhost:${PORT}${base}/`;
console.log(`▶ serving build at ${url}`);

// ── 3) render-check GATE (signed-out shell + signed-in idle — both must pass) ────────────────────────
// Signed-out exercises the empty/marketing states; signed-in exercises the live branches (MyMatch on
// /match, profile on /u/…, settings) — that's where runtime bugs actually hide, so it gets full coverage.
const outURLs = ['', 'match', 'ranks', 'hosts', 'tournament'].map((p) => url + p);
const inURLs = ['', 'match', 'ranks', 'regions', 'hosts', 'settings', 'tournament', 'tournament/create', 'tournament/0/manage', 'u/76561197960287930'].map((p) => url + p);
const codeOut = await run('node', ['scripts/render-check.mjs', ...outURLs]);
const codeIn = await run('node', ['scripts/render-check.mjs', ...inURLs], { SIGNED_IN: '1' });
server.close();
if (codeOut !== 0 || codeIn !== 0) {
	console.error('\n✗ RENDER-CHECK FAILED — NOT deploying. Fix the errors above and re-run.');
	process.exit(1);
}
console.log('\n✅ render-check passed');

// ── 4) deploy (only reached when the gate is green) ──────────────────────────────────────────────────
console.log(`▶ deploy → ${envName} (${cfg.dir})`);
const deploy = spawnSync(
	'bash',
	['-lc', `tar czf - -C build . 2>/dev/null | ssh -o StrictHostKeyChecking=no root@nobd.net 'mkdir -p ${cfg.dir} && tar xzf - -C ${cfg.dir}'`],
	{ stdio: 'inherit' }
);
if (deploy.status !== 0) {
	console.error('✗ deploy failed');
	process.exit(1);
}

// ── 5) stamp an env marker so "what's live" + rollback are a git ref away. Tags (not global branches) fit
// this multi-surface monorepo — each deployable surface gets its own marker. Local-only; promote/rollback
// is `git checkout app-prod` → re-run this script. ──
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || '';
if (sha) {
	spawnSync('git', ['tag', '-f', `app-${envName}`, sha], { stdio: 'ignore' });
	console.log(`▶ marker app-${envName} → ${sha.slice(0, 9)}`);
}
console.log(`\n✅ ${envName} live → https://nobd.net${base}/`);
