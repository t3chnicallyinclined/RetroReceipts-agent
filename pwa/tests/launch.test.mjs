// Season launch: the announcement card, the join strip, registration, and the "new season started" notice.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const L = await import('$lib/launch');
const { seasons } = await import('$lib/stores/seasons.svelte');
const { SeasonRegStore } = await import('$lib/stores/seasonreg.svelte');
const { auth } = await import('$lib/stores/auth.svelte');
const { invalidate } = await import('$lib/net.svelte');

const DAY = 86_400_000;
const T = 1_794_000_000_000; // season 0 ends here
const table = (extra = []) => ({
	current: 'beta-s1',
	seasons: [
		{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: T },
		{ id: 'beta-s1', label: 'Beta Season 1', start_ms: T, end_ms: null },
		...extra
	]
});
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const none = new Set();

beforeEach(() => {
	invalidate();
	seasons.table = null;
	seasons.selected = null;
	seasons.status = 'idle';
	seasons.changed = false;
	auth.token = null;
	auth.steamid = null;
});

// ── the announcement card ──
test('announcement: shown for 21 days after a season ends, with the new season open', () => {
	const a = L.announcementFor(table(), T + 5 * DAY, none);
	assert.equal(a.ended.label, 'Season Zero');
	assert.equal(a.open.label, 'Beta Season 1');
	assert.ok(L.announcementFor(table(), T + 21 * DAY, none)); // the last day still counts
	assert.equal(L.announcementFor(table(), T + 21 * DAY + 1, none), null);
	assert.equal(L.announcementFor(table(), T + 60 * DAY, none), null);
	assert.equal(L.announcementFor(table(), T - 1000, none), null); // not ended yet
});

test('announcement: never on an old server, a single-season server, or when dismissed', () => {
	assert.equal(L.announcementFor(null, T + DAY, none), null);
	assert.equal(L.announcementFor({ current: 'season0', seasons: [{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: null }] }, T + DAY, none), null);
	assert.equal(L.announcementFor(table(), T + DAY, new Set(['season0'])), null);
	assert.ok(L.announcementFor(table(), T + DAY, new Set(['something-else'])));
});

test('announcement: with three seasons it announces the one that just ended', () => {
	const t3 = {
		current: 's2',
		seasons: [
			{ id: 's0', label: 'Zero', start_ms: 0, end_ms: T },
			{ id: 's1', label: 'One', start_ms: T, end_ms: T + 40 * DAY },
			{ id: 's2', label: 'Two', start_ms: T + 40 * DAY, end_ms: null }
		]
	};
	const a = L.announcementFor(t3, T + 45 * DAY, none);
	assert.deepEqual([a.ended.id, a.open.id], ['s1', 's2']);
	assert.equal(L.announcementFor(t3, T + 45 * DAY, new Set(['s1'])), null); // dismissal is per ended season
});

test('dismissal is remembered in localStorage and survives broken storage', () => {
	const mem = new Map();
	globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
	assert.equal(L.readDismissed().size, 0);
	L.writeDismissed(new Set(['season0']));
	assert.deepEqual([...L.readDismissed()], ['season0']);
	mem.set('rr:season-announce:dismissed', 'not json');
	assert.equal(L.readDismissed().size, 0);
	globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
	assert.equal(L.readDismissed().size, 0);
	assert.doesNotThrow(() => L.writeDismissed(new Set(['x'])));
	delete globalThis.localStorage;
});

// ── the join strip ──
const base = { current: true, authed: true, known: true, registered: false, busy: false, justJoined: false, refusal: null };
test('join strip states', () => {
	assert.equal(L.joinStripState({ ...base, current: false }), 'hidden'); // a finished season never offers it
	assert.equal(L.joinStripState({ ...base, authed: false }), 'signin');
	assert.equal(L.joinStripState({ ...base }), 'join');
	assert.equal(L.joinStripState({ ...base, busy: true }), 'busy');
	assert.equal(L.joinStripState({ ...base, registered: true }), 'hidden'); // already registered before this visit
	assert.equal(L.joinStripState({ ...base, registered: true, justJoined: true }), 'done'); // quiet confirmation
	assert.equal(L.joinStripState({ ...base, known: false }), 'hidden'); // never offer Join before the status is known
	assert.equal(L.joinStripState({ ...base, refusal: 'signin' }), 'resign'); // an older sign-in the server will not accept
	assert.equal(L.joinStripState({ ...base, authed: false, known: false }), 'signin');
});

test('register refusals: an unproven sign-in is told to sign in once more', () => {
	assert.equal(L.registerRefusal('Sign in with Steam to register.'), 'signin');
	assert.equal(L.registerRefusal('Your session expired — sign in again.'), 'signin');
	assert.equal(L.registerRefusal('boom'), 'error');
	assert.equal(L.RESIGN_COPY, 'Please sign in with Steam once more to register.');
});

test('registration store: status, join, refusal, old server', async () => {
	const calls = [];
	let registerReply = () => json({ ok: true, season: 'beta-s1', registered: true });
	let statusReply = (u) => json({ ok: true, season: 'beta-s1', registered: u.includes('steamid=') ? false : false, registered_count: 41 });
	globalThis.fetch = async (url, init) => {
		calls.push([String(url), init?.method ?? 'GET']);
		if (String(url).includes('/rr/season/register')) return registerReply();
		if (String(url).includes('/rr/season/status')) return statusReply(String(url));
		return json({}, 404);
	};
	const s = new SeasonRegStore();
	await s.load(null);
	assert.deepEqual([s.known, s.count, s.registered], [true, 41, false]); // the public count, no steamid needed
	// signed out: refused before any request
	const before = calls.length;
	assert.equal(await s.join(), false);
	assert.equal(s.refusal, 'signin');
	assert.equal(calls.length, before);
	// signed in: joins, count goes up by one, confirmation state
	auth.token = 't';
	auth.steamid = '7656119800000000001';
	s.refusal = null;
	assert.equal(await s.join(), true);
	assert.deepEqual([s.registered, s.justJoined, s.count], [true, true, 42]);
	assert.ok(calls.some((c) => c[0].includes('/rr/season/register') && c[1] === 'POST'));
	// an unproven token: the server says 403
	const s2 = new SeasonRegStore();
	registerReply = () => json({ ok: false, error: 'Sign in with Steam to register.' }, 403);
	assert.equal(await s2.join(), false);
	assert.equal(s2.refusal, 'signin');
	assert.equal(s2.registered, false);
	// any other failure: a sentence, not a sign-in loop
	const s3 = new SeasonRegStore();
	registerReply = () => json({ ok: false, error: 'try later' }, 500);
	await s3.join();
	assert.deepEqual([s3.refusal, s3.message], ['error', 'try later']);
	// signed in and already registered: the status says so (the finale page then shows "Registered")
	statusReply = () => json({ ok: true, registered: true, registered_count: 41 });
	const s4 = new SeasonRegStore();
	await s4.load('7656119800000000001');
	assert.equal(s4.registered, true);
	// old server: nothing known, no error
	globalThis.fetch = async () => json({}, 404);
	const s5 = new SeasonRegStore();
	await s5.load('x');
	assert.deepEqual([s5.known, s5.count], [false, undefined]);
});

// ── a season change while the tab is open ──
test('season change notice: flagged when the current season changes, not before, throttled, quiet on blips', async () => {
	assert.equal(L.seasonChanged('beta-s1', 'beta-s1'), false);
	assert.equal(L.seasonChanged('beta-s1', 'beta-s2'), true);
	assert.equal(L.seasonChanged(null, 'beta-s2'), false);
	let reply = () => json({ ok: true, ...table() });
	let n = 0;
	globalThis.fetch = async () => (n++, reply());
	await seasons.load();
	assert.equal(n, 1);
	assert.equal(await seasons.recheck(1_000_000), false); // same season: no notice
	assert.equal(n, 2);
	await seasons.recheck(1_000_500); // inside the one-minute gap: no request
	assert.equal(n, 2);
	reply = () => { throw new Error('offline'); };
	assert.equal(await seasons.recheck(1_100_000), false); // a blip changes nothing
	reply = () => json({}, 404);
	assert.equal(await seasons.recheck(1_200_000), false); // an old server changes nothing
	reply = () => json({ ok: true, ...table([{ id: 'beta-s2', label: 'Beta Season 2', start_ms: T + 30 * DAY, end_ms: null }].map((x) => x)), current: 'beta-s2' });
	// the previous season must be closed for a valid table
	reply = () => json({ ok: true, current: 'beta-s2', seasons: [
		{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: T },
		{ id: 'beta-s1', label: 'Beta Season 1', start_ms: T, end_ms: T + 30 * DAY },
		{ id: 'beta-s2', label: 'Beta Season 2', start_ms: T + 30 * DAY, end_ms: null }] });
	assert.equal(await seasons.recheck(1_300_000), true);
	assert.equal(seasons.changed, true);
	assert.equal(seasons.currentLabel, 'Beta Season 2');
});

// ── copy rules ──
const SRC = new URL('../src/', import.meta.url);
const pieces = ['lib/launch.ts', 'lib/components/SeasonAnnouncement.svelte', 'lib/components/SeasonChangeNotice.svelte', 'lib/components/JoinStrip.svelte', 'lib/stores/seasonreg.svelte.ts'];
test('registration is a flag: no copy says or implies unregistered games do not count', () => {
	for (const p of pieces) {
		const src = readFileSync(new URL(p, SRC), 'utf8');
		assert.ok(!/(don.?t|do not|won.?t|will not|not) count|only registered|unregistered|required to play|must register/i.test(src), `${p} implies registration gates games`);
	}
});

test('the exact copy', () => {
	const ann = readFileSync(new URL('lib/components/SeasonAnnouncement.svelte', SRC), 'utf8');
	assert.ok(ann.includes('is closed.') && ann.includes('See the final standings and the season in numbers.'));
	assert.ok(ann.includes('is open: sign in and register.'));
	const notice = readFileSync(new URL('lib/components/SeasonChangeNotice.svelte', SRC), 'utf8');
	assert.ok(notice.includes('A new season has started. Refresh to see the new ladder.'));
	const strip = readFileSync(new URL('lib/components/JoinStrip.svelte', SRC), 'utf8');
	assert.ok(strip.includes('Sign in to register for {label}.') && strip.includes("You’re registered for {label}."));
});

test('comment plates: no "1000 Civilian" for an author with no rank in the current season', async () => {
	const { commentPlateRating } = await import('$lib/commentPlate');
	assert.equal(commentPlateRating({ rating: 1000, games: 0 }), null); // fresh season: name and avatar only
	assert.equal(commentPlateRating({ rating: 1012, games: 4 }), null); // placements: not ranked yet
	assert.equal(commentPlateRating({ rating: 1337, games: 5 }), 1337);
});

test('announcement card stays off the LIVE tab and the finale', () => {
	assert.equal(L.announcementHiddenOn('/match'), true);
	assert.equal(L.announcementHiddenOn('/app/match', '/app'), true);
	assert.equal(L.announcementHiddenOn('/season/season0'), true);
	assert.equal(L.announcementHiddenOn('/app/season/season0', '/app'), true);
	assert.equal(L.announcementHiddenOn('/ranks'), false);
	assert.equal(L.announcementHiddenOn('/u/765'), false);
	assert.equal(L.announcementHiddenOn('/app/r/set/s_1', '/app'), false);
});

test('count-up numbers follow their value when the data arrives after mount (no stale "97 games")', () => {
	const motion = readFileSync(new URL('lib/finale/motion.ts', SRC), 'utf8');
	assert.ok(motion.includes('const update = (np') && motion.includes('return { update'), 'countUp action has an update hook');
	const banner = readFileSync(new URL('lib/components/finale/FinaleBanner.svelte', SRC), 'utf8');
	assert.ok(banner.includes('{#each bits as b (b.one)}'), 'the lead sentences are keyed by their label, not their position');
});
