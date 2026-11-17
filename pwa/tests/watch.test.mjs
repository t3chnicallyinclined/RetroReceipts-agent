// Replay links on the finale: the new moment kinds, the inline player (sheet, hash, focus), and the background art warm-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('$lib/finale/moments');
const W = await import('$lib/finale/watch');
const P = await import('$lib/replay/preload');
const PK = await import('$lib/replay/pack');
const H = await import('$lib/finale/highlights');
const { replayViewer } = await import('$lib/replay/viewer.svelte');

const SRC = new URL('../src/', import.meta.url);
const rd = (p) => readFileSync(new URL(p, SRC), 'utf8').replace(/\r/g, '');
const who = (n, name) => ({ steamid: `7656119800000000${n}`.slice(0, 17), name, avatar: '', cc: 'US' });
const mk = (kind, o = {}) => ({ kind, label: kind, value: 100, unit: 'x', match_key: `k_${kind}`, session_id: `s_${kind}`, match_index: 3, ts: 1700000000000, duration_s: 94, tape: 'ready', winner: who(1, 'Ana'), loser: null, wteam: [23, 49, 52], lteam: [], ...o });

// ── the new kinds ──────────────────────────────────────────────────────────────────────────────
test('the four new kinds are shaped (longest_replay, typical_game, streak_win, peak_game) and keep their time stamp', () => {
	const out = M.normalizeMoments([mk('peak_game', { value: 1823 }), mk('streak_win', { value: 413 }), mk('typical_game', { value: 94, loser: who(2, 'Bo') }), mk('longest_replay', { value: 301, loser: who(2, 'Bo') })]);
	assert.deepEqual(out.map((m) => m.kind), ['typical_game', 'longest_replay', 'streak_win', 'peak_game']);
	assert.equal(out[0].ts, 1700000000000);
	assert.equal(M.momentFigure(out[0]), '1 min 34 s');
	assert.equal(M.momentFigure(out[1]), '5 min 1 s');
	assert.equal(M.momentFigure(out[2]), '413 wins in a row');
	assert.equal(M.momentFigure(out[3]), 'rating 1,823');
	assert.equal(M.momentWho(out[0]), 'Ana beat Bo');
	assert.equal(M.momentWho(out[2]), 'Ana', 'winner-only kinds never name a loser');
	// a server that sends none of them: nothing appears
	assert.deepEqual(M.normalizeMoments([mk('longest_game')]).map((m) => m.kind), ['longest_game']);
	const h = H.normalizeHighlights({ ok: true });
	assert.equal(M.momentOf(h?.moments, 'typical_game'), undefined);
});

test('every link follows one rule per state, with the verb the stat asked for', () => {
	for (const [label, verb] of [['replay', 'Watch the replay'], ['it', 'Watch it'], ['one', 'Watch one'], ['win', 'Watch the win that finished it'], ['game', 'Watch the game that set it']]) {
		assert.equal(M.WATCH_LABELS[label], verb);
		assert.deepEqual(M.momentAction('ready', false, M.WATCH_LABELS[label]), { kind: 'watch', label: verb, reason: '' });
		for (const state of ['archived', 'pending', 'none', 'legacy']) {
			const a = M.momentAction(state, false, M.WATCH_LABELS[label]);
			assert.equal(a.kind, 'set', `${state} never offers ${verb}`);
			assert.equal(a.label, 'See the set');
			assert.ok(a.reason.length > 0);
		}
		assert.equal(M.momentAction(undefined, true, M.WATCH_LABELS[label]).label, 'See the set', 'no state sent: no claim');
	}
	assert.equal(M.momentAction('archived', false).reason, 'In the archive. Sign in to request it.');
	assert.equal(M.momentAction('none', false).reason, 'No replay was recorded for this game.');
	assert.ok(M.momentAction('legacy', false).reason.startsWith('Recorded by an older version of the app'));
});

test('the strip keeps the five records and adds typical_game / longest_replay only while it stays at six or fewer', () => {
	const five = ['longest_game', 'biggest_combo', 'biggest_comeback', 'biggest_upset', 'perfect'].map((k) => mk(k));
	const extras = [mk('typical_game', { loser: who(2, 'Bo') }), mk('longest_replay', { loser: who(2, 'Bo') }), mk('streak_win'), mk('peak_game')];
	const all = M.normalizeMoments([...five, ...extras]);
	assert.deepEqual(M.stripMoments(all).map((m) => m.kind), ['longest_game', 'biggest_combo', 'biggest_comeback', 'biggest_upset', 'perfect', 'typical_game'], 'six at most; nothing existing dropped');
	// fewer records: both extras fit (still six or fewer)
	const some = M.normalizeMoments([mk('longest_game'), mk('biggest_combo'), mk('typical_game'), mk('longest_replay'), mk('streak_win'), mk('peak_game')]);
	assert.deepEqual(M.stripMoments(some).map((m) => m.kind), ['longest_game', 'biggest_combo', 'typical_game', 'longest_replay']);
	assert.deepEqual(M.stripMoments(undefined), []);
	assert.ok(M.stripMoments(all).length <= M.STRIP_MAX);
});

test('wiring: the inline links sit where the stat lives and hide without the new kinds', () => {
	const g = rd('lib/components/finale/GroupBodies.svelte');
	assert.ok(g.includes("f[0] === 'A typical game' && typical") && g.includes('watchLabel="Watch one"'));
	assert.ok(g.includes("f[0] === 'Longest game' && longest") && g.includes('{#if extraReplay}') && g.includes('Longest game with a replay:') && g.includes('watchLabel="Watch it"'));
	assert.ok(g.includes('longestReplay.matchKey !== longest.matchKey'), 'a second line only when it is a different game');
	assert.ok(g.includes('{#if streakWin}') && g.includes('watchLabel="Watch the win that finished it"'));
	assert.ok(g.includes("f[0] === 'Played 100 or more games'") && g.includes('See the players'));
	for (const aggregate of ['Timed games', 'Games per player', 'Came back on 2 or more days', 'Played on 10 or more days']) assert.ok(!g.includes(`f[0] === '${aggregate}'`), `${aggregate} gets no replay link`);
	const page = rd('routes/season/[id]/+page.svelte');
	assert.ok(page.includes('{#if peakGame}') && page.includes('watchLabel="Watch the game that set it"'));
});

// ── the inline player ──────────────────────────────────────────────────────────────────────────
test('#watch= hash: only a plain match key is accepted', () => {
	assert.equal(W.parseWatchHash('#watch=7656_1_2_59591734'), '7656_1_2_59591734');
	assert.equal(W.watchHash('a b'), '#watch=a%20b');
	for (const bad of ['', '#', '#watch=', '#watch=a/b', '#watch=<x>', '#watch=' + 'a'.repeat(81), '#watch=%E0%A4%A', '#next', null, undefined]) assert.equal(W.parseWatchHash(bad), null, String(bad));
	assert.equal(W.parseWatchHash(W.watchHash('k_1-2')), 'k_1-2');
});

test('the request: row and chrome from the moment, a link to the full set, art only when allowed', () => {
	const r = W.watchRequest({ matchKey: 'k1', sessionId: 's 1', ts: 5, durationS: 94, winner: who(1, 'Ana'), loser: who(2, 'Bo'), wteam: [1, 2, 3], lteam: [4, 5, 6] }, '/app', { autoart: true });
	assert.deepEqual(r.row, { match_key: 'k1', session_id: 's 1', ts: 5 });
	assert.equal(r.meta.key, 'k1');
	assert.equal(r.meta.a.name, 'Ana');
	assert.equal(r.meta.b.name, 'Bo');
	assert.equal(r.fullSet, '/app/r/set/s%201?game=k1');
	assert.equal(r.hash, '#watch=k1');
	assert.equal(r.autoart, true);
	assert.equal(W.watchRequest({ matchKey: 'k1' }, '/app').autoart, false, 'never on by default');
	assert.equal(W.watchRequest({ matchKey: 'k1' }, '/app').fullSet, undefined, 'no set known: no link');
});

test('the viewer: open pushes the hash, close goes Back, Back closes, a shared link clears its hash, dismiss never touches history', () => {
	const calls = [];
	const loc = { hash: '', pathname: '/app/season/season0', search: '' };
	globalThis.location = loc;
	globalThis.history = {
		state: null,
		pushState: (_s, _t, h) => { calls.push(['push', h]); loc.hash = h; },
		replaceState: (_s, _t, u) => { calls.push(['replace', u]); loc.hash = ''; },
		back: () => { calls.push(['back']); loc.hash = ''; }
	};
	const req = W.watchRequest({ matchKey: 'k9', sessionId: 's' }, '');
	replayViewer.open(req);
	assert.equal(replayViewer.current?.meta.key, 'k9');
	assert.deepEqual(calls, [['push', '#watch=k9']]);
	replayViewer.close(); // Escape / the close button / the backdrop
	assert.equal(replayViewer.current, null);
	assert.deepEqual(calls.at(-1), ['back']);
	// Back button: popstate with the hash gone closes the open sheet
	calls.length = 0;
	replayViewer.open(req);
	loc.hash = '';
	replayViewer.onPop(loc.hash);
	assert.equal(replayViewer.current, null);
	// a shared #watch= link: already on the hash, nothing pushed; closing clears the stale hash
	calls.length = 0;
	loc.hash = '#watch=k9';
	replayViewer.open(req);
	assert.deepEqual(calls, []);
	replayViewer.close();
	assert.deepEqual(calls, [['replace', '/app/season/season0']]);
	// a navigation leaving the page: no history call
	calls.length = 0;
	replayViewer.open(req);
	calls.length = 0;
	replayViewer.dismiss();
	assert.deepEqual(calls, []);
	assert.equal(replayViewer.current, null);
	// every other surface (no hash) is unchanged: open and close touch nothing
	calls.length = 0;
	replayViewer.open({ ...req, hash: undefined });
	replayViewer.close();
	assert.deepEqual(calls, []);
});

test('the sheet is a real dialog: focus trap, Escape, close button, focus returns, scroll lock, full-screen phones, full-set link', () => {
	const s = rd('lib/components/ReplaySheet.svelte');
	assert.ok(s.includes('role="dialog" aria-modal="true"'));
	assert.ok(s.includes("e.key === 'Tab' && dlg") && s.includes('function trapTab') && s.includes('last.focus()') && s.includes('first.focus()'));
	assert.ok(s.includes("e.key === 'Escape' && !document.fullscreenElement"), 'Escape closes, but not out of fullscreen');
	assert.ok(s.includes('aria-label="Close"'));
	assert.ok(s.includes("document.body.style.overflow = 'hidden'") && s.includes('prevFocus?.focus?.()') && s.includes('document.body.style.overflow = prevOverflow'));
	assert.ok(s.includes('Open the full set') && s.includes('href={req.fullSet}'));
	assert.ok(s.includes('autoart={!!req.autoart}'));
	assert.ok(s.includes("window.addEventListener('popstate'") && s.includes('replayViewer.onPop(location.hash)'));
	assert.ok(s.includes('onNavigate(') && s.includes('replayViewer.dismiss()'));
	assert.ok(/@media \(max-width: 720px\)[\s\S]*background: var\(--bg\)/.test(s), 'a full-screen sheet on phones');
	assert.ok(/@media \(min-width: 900px\)[\s\S]*width: min\(100%, 860px\)/.test(s), 'a large centred player on desktop');
});

test('closing disposes the player: the embed lives only inside the open sheet and tears down its worker and GPU buffers', () => {
	const s = rd('lib/components/ReplaySheet.svelte');
	assert.ok(/\{#if req\}[\s\S]*<ReplayEmbed /.test(s) && s.indexOf('<ReplayEmbed') > s.indexOf('{#if req}'), 'unmounted when the request clears');
	const e = rd('lib/components/ReplayEmbed.svelte');
	assert.ok(/return \(\) => \{[\s\S]{0,700}dispose\(\);\s*\};\s*\}\);/.test(e), 'the embed disposes on unmount');
	const eng = rd('lib/replay/engine.ts');
	assert.ok(eng.includes('worker?.terminate()') && eng.includes('vertexBuffer.destroy()') && eng.includes('device = null; // the next embed re-requests'), 'worker and buffers freed; one shared device');
	// a WebGPU-less browser gets the embed's own honest message inside the dialog
	assert.ok(e.includes("st = 'unsupported'") && e.includes("Needs WebGPU"));
});

test('the finale links open the sheet, keep their href, and the page opens a shared #watch= link', () => {
	const l = rd('lib/components/finale/SetLink.svelte');
	assert.ok(l.includes('void openWatch(') && l.includes('e.preventDefault()') && l.includes('e.metaKey || e.ctrlKey || e.shiftKey'), 'modified clicks keep the browser behaviour');
	assert.ok(l.includes('aria-label={act && who ?'), 'the players are in the accessible name');
	const p = rd('routes/season/[id]/+page.svelte');
	assert.ok(p.includes('parseWatchHash(location.hash)') && p.includes('openWatch({ matchKey: wk'));
});

// ── the background art warm-up ─────────────────────────────────────────────────────────────────
const env = (o = {}) => ({ authed: true, attested: true, saveData: false, effectiveType: '4g', hidden: false, ...o });

test('preload gating: signed out, unattested, Save-Data, slow connections and a hidden page never warm', () => {
	assert.equal(P.preloadVerdict(env()), 'ok');
	assert.equal(P.preloadVerdict(env({ authed: false })), 'signed-out');
	assert.equal(P.preloadVerdict(env({ authed: false, attested: true })), 'signed-out', 'a local tick without sign-in is still not enough');
	assert.equal(P.preloadVerdict(env({ attested: false })), 'unattested');
	assert.equal(P.preloadVerdict(env({ saveData: true })), 'save-data');
	assert.equal(P.preloadVerdict(env({ effectiveType: '2g' })), 'slow-connection');
	assert.equal(P.preloadVerdict(env({ effectiveType: 'slow-2g' })), 'slow-connection');
	assert.equal(P.preloadVerdict(env({ effectiveType: undefined })), 'ok', 'no connection API: allowed');
	assert.equal(P.preloadVerdict(env({ hidden: true })), 'hidden');
	assert.equal(P.PRELOAD_CAP_BYTES, 60 * 1024 * 1024);
});

test('only READY tapes are ever warmed: legacy, archived, pending, none and unknown never', () => {
	const keys = P.warmTargets([
		{ matchKey: 'a', tape: 'ready' }, { matchKey: 'b', tape: 'legacy' }, { matchKey: 'c', tape: 'archived' }, { matchKey: 'd', tape: 'pending' },
		{ matchKey: 'e', tape: 'none' }, { matchKey: 'f', tape: undefined }, { matchKey: 'a', tape: 'ready' }, { matchKey: '', tape: 'ready' }, { matchKey: 'g', tape: 'ready' }
	]);
	assert.deepEqual(keys, ['a', 'g']);
});

const man = (files) => ({ files: files.map(([name, bytes]) => ({ name, url: `/rr/packs/${name}`, bytes, sha256: undefined })), total_bytes: files.reduce((a, f) => a + f[1], 0) });

test('runWarm: one moment at a time, in order, until the cap, an abort, or a change of heart', async () => {
	const seen = [];
	const deps = { manifest: async (k) => { seen.push(k); return man([[k, 10]]); }, warm: async (m, o) => { o.budget.left -= 10; return { networkBytes: 10, cachedFiles: 0 }; } };
	let r = await P.runWarm(['a', 'b', 'c'], { deps, cap: 1000 });
	assert.deepEqual([r.warmed, r.networkBytes, r.stopped], [['a', 'b', 'c'], 30, undefined]);
	assert.deepEqual(seen, ['a', 'b', 'c']);
	// the cap: a third moment does not start once the allowance is spent
	seen.length = 0;
	r = await P.runWarm(['a', 'b', 'c'], { deps, cap: 20 });
	assert.deepEqual([r.warmed, r.stopped, seen], [['a', 'b'], 'cap', ['a', 'b']]);
	// abort before and during
	const ctl = new AbortController();
	ctl.abort();
	seen.length = 0;
	r = await P.runWarm(['a'], { deps, signal: ctl.signal });
	assert.deepEqual([r.warmed, r.stopped, seen], [[], 'abort', []]);
	// the viewer goes Save-Data / hidden mid-way: it stops before the next moment
	let n = 0;
	seen.length = 0;
	r = await P.runWarm(['a', 'b'], { deps, recheck: () => (n++ < 1 ? 'ok' : 'save-data') });
	assert.deepEqual([r.warmed, r.stopped], [['a'], 'abort']);
	// a failure is quiet: it stops and reports, never throws
	r = await P.runWarm(['a'], { deps: { manifest: async () => { throw new Error('403'); }, warm: deps.warm } });
	assert.equal(r.stopped, 'error');
});

function fakeCaches() {
	const store = new Map();
	globalThis.caches = { open: async () => ({ match: async (k) => store.get(k), put: async (k, r) => void store.set(k, r) }) };
	return store;
}

test('warmPack: shared files are fetched once, the cap stops it cleanly, an abort stops it', async () => {
	const store = fakeCaches();
	const fetched = [];
	globalThis.fetch = async (url, init) => {
		if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
		fetched.push(url);
		return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(100).buffer };
	};
	const common = [['common/a', 100], ['common/b', 100]];
	const budget = { left: 1000 };
	let r = await PK.warmPack(man([...common, ['chars/x', 100]]), { budget });
	assert.deepEqual([r.networkBytes, r.cachedFiles, r.stopped], [300, 0, undefined]);
	// the second moment shares the common part: only its own file is fetched
	fetched.length = 0;
	r = await PK.warmPack(man([...common, ['chars/y', 100]]), { budget });
	assert.deepEqual(fetched, ['/rr/packs/chars/y']);
	assert.deepEqual([r.networkBytes, r.cachedFiles], [100, 2]);
	assert.equal(store.size, 4);
	// the cap
	fetched.length = 0;
	r = await PK.warmPack(man([['d/1', 100], ['d/2', 100], ['d/3', 100]]), { budget: { left: 150 }, concurrency: 1 });
	assert.deepEqual([fetched.length, r.stopped], [1, 'cap']);
	// abort
	const ctl = new AbortController();
	ctl.abort();
	fetched.length = 0;
	r = await PK.warmPack(man([['e/1', 100]]), { budget: { left: 1000 }, signal: ctl.signal });
	assert.deepEqual([fetched.length, r.stopped], [0, 'abort']);
	// no Cache Storage (private mode): nothing to warm into, nothing thrown
	delete globalThis.caches;
	r = await PK.warmPack(man([['f/1', 100]]), { budget: { left: 1000 } });
	assert.equal(r.stopped, 'error');
});

test('the page warms only after the data is in, tears down with the page, and the embed skips the prompt when allowed', () => {
	const p = rd('routes/season/[id]/+page.svelte');
	assert.ok(p.includes('warmTargets(items)') && p.includes('preloadVerdict(env(attested)) !== \'ok\'') && p.includes('onDestroy(() => warmStop?.())'));
	assert.ok(p.includes("document.addEventListener('visibilitychange', onVis)") && p.includes("addEventListener('pagehide', stop)"));
	assert.ok(p.includes('!!ownsLocal() || (await getAttest())'));
	const w = rd('lib/finale/watch.ts');
	assert.ok(w.includes('if (!auth.authed) return false;') && w.includes('!!ownsLocal() || (await getAttest())'), 'autoart only for a signed-in viewer with ownership on file');
});
