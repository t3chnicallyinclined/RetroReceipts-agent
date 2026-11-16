// Unit tests for the seasons store and the stores that read it. Run with `npm test`.
// They load the REAL rune stores (see loader.mjs) and replace only `fetch`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { seasons } = await import('$lib/stores/seasons.svelte');
const { LeaderboardStore } = await import('$lib/stores/leaderboard.svelte');
const { ProfileStore } = await import('$lib/stores/profile.svelte');
const { invalidate } = await import('$lib/net.svelte');
const { parseSeasonTable, withSeason } = await import('$lib/seasons');

const TABLE = {
	ok: true,
	current: 'beta-s1',
	hash: 'abc',
	seasons: [
		{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: 1763100000000 },
		{ id: 'beta-s1', label: 'Beta Season 1', start_ms: 1763100000000, end_ms: null }
	]
};

const player = (steamid, name) => ({ steamid, name, rating: 1000, wins: 1, losses: 0 });
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Install a fake server. `routes` maps a path (no query) to a function(urlObject) -> response. */
function fakeServer(routes) {
	const seen = [];
	globalThis.fetch = async (url) => {
		const u = new URL(String(url), 'http://x');
		seen.push(u.pathname + u.search);
		const h = routes[u.pathname];
		return h ? h(u) : json({}, 404);
	};
	return seen;
}

/** A leaderboard that answers per season with that season's own rows. */
const boardRoute = (u) => {
	const s = u.searchParams.get('season') ?? 'beta-s1';
	return json({ tab: 'wins', season: s, scope: 'ranked', players: [player(`${s}-p1`, `${s} champ`)] });
};

beforeEach(() => {
	invalidate(); // the shared GET cache must not leak between tests
	seasons.table = null;
	seasons.selected = null;
	seasons.status = 'idle';
});

test('parseSeasonTable accepts the server shape and rejects anything untrustworthy', () => {
	assert.equal(parseSeasonTable(TABLE).current, 'beta-s1');
	assert.equal(parseSeasonTable(null), null);
	assert.equal(parseSeasonTable({ ok: false }), null);
	assert.equal(parseSeasonTable({ ok: true, current: 'nope', seasons: TABLE.seasons }), null);
	assert.equal(parseSeasonTable({ ok: true, current: 'a', seasons: [{ id: 'a' }] }), null); // no label
	assert.equal(withSeason('/rr/x?a=1', 'season0'), '/rr/x?a=1&season=season0');
	assert.equal(withSeason('/rr/x', 'season0'), '/rr/x?season=season0');
	assert.equal(withSeason('/rr/x', undefined), '/rr/x');
});

test('default season is the current one, and its requests carry no ?season=', async () => {
	const seen = fakeServer({ '/rr/seasons': () => json(TABLE), '/rr/leaderboard': boardRoute });
	await seasons.load();
	assert.equal(seasons.status, 'ready');
	assert.equal(seasons.multiple, true);
	assert.equal(seasons.activeId, 'beta-s1');
	assert.equal(seasons.archived, false);
	assert.equal(seasons.param, undefined);
	assert.equal(seasons.currentLabel, 'Beta Season 1'); // label comes from the server table
	const lb = new LeaderboardStore();
	await lb.load(true);
	const url = seen.find((s) => s.startsWith('/rr/leaderboard'));
	assert.ok(url && !url.includes('season='), url);
	assert.equal(lb.players[0].steamid, 'beta-s1-p1');
});

test('table is loaded once, however many callers ask', async () => {
	const seen = fakeServer({ '/rr/seasons': () => json(TABLE) });
	await Promise.all([seasons.load(), seasons.load()]);
	await seasons.load();
	assert.equal(seen.filter((s) => s === '/rr/seasons').length, 1);
});

test('switching to a past season refetches with ?season= and marks it archived', async () => {
	const seen = fakeServer({ '/rr/seasons': () => json(TABLE), '/rr/leaderboard': boardRoute });
	await seasons.load();
	const lb = new LeaderboardStore();
	await lb.load(true);
	assert.equal(seasons.select('season0'), true);
	assert.equal(seasons.archived, true);
	assert.equal(seasons.param, 'season0');
	await lb.load(true);
	assert.ok(seen.some((s) => s.startsWith('/rr/leaderboard') && s.includes('season=season0')), seen.join('\n'));
	assert.equal(lb.players[0].steamid, 'season0-p1');
	// unknown ids are ignored; picking the current season goes back to "follow current"
	assert.equal(seasons.select('bogus'), false);
	assert.equal(seasons.param, 'season0');
	seasons.select('beta-s1');
	assert.equal(seasons.param, undefined);
	assert.equal(seasons.archived, false);
});

test('cache separation: a season switch never shows the other season rows', async () => {
	let release;
	const gate = new Promise((r) => (release = r));
	fakeServer({
		'/rr/seasons': () => json(TABLE),
		'/rr/leaderboard': async (u) => {
			// the past season answers slowly
			if (u.searchParams.get('season') === 'season0') await gate;
			return boardRoute(u);
		}
	});
	await seasons.load();
	const lb = new LeaderboardStore();
	await lb.load(true);
	assert.equal(lb.players[0].steamid, 'beta-s1-p1');

	seasons.select('season0');
	const slow = lb.load(true);
	// while the past season is in flight the current season rows are already gone (never shown under the wrong season)
	assert.deepEqual(lb.players, []);

	// switch back before the slow answer lands: the stale answer must be dropped
	seasons.select('beta-s1');
	await lb.load(true);
	assert.equal(lb.players[0].steamid, 'beta-s1-p1');
	release();
	await slow;
	assert.equal(lb.players[0].steamid, 'beta-s1-p1');

	// and a server that answers with a different season than asked for is never rendered
	seasons.select('season0');
	invalidate();
	fakeServer({ '/rr/leaderboard': () => json({ season: 'beta-s1', scope: 'ranked', players: [player('wrong', 'wrong')] }) });
	await lb.load(true);
	assert.deepEqual(lb.players, []);
});

test('the shared GET cache keys on season (same params, different season = different entry)', async () => {
	const seen = fakeServer({ '/rr/seasons': () => json(TABLE), '/rr/leaderboard': boardRoute });
	await seasons.load();
	const lb = new LeaderboardStore();
	await lb.load(true);
	seasons.select('season0');
	await lb.load(true);
	seasons.select('beta-s1');
	await lb.load(true); // within the 1.5s ttl: served from cache, still the CURRENT season rows
	assert.equal(lb.players[0].steamid, 'beta-s1-p1');
	assert.equal(seen.filter((s) => s.startsWith('/rr/leaderboard')).length, 2); // current once, past once
});

test('old server: /rr/seasons 404 -> no picker, no errors, requests unchanged', async () => {
	const seen = fakeServer({
		'/rr/leaderboard': () => json({ tab: 'wins', players: [player('legacy', 'legacy')] })
	});
	await seasons.load(); // must not throw
	assert.equal(seasons.status, 'absent');
	assert.equal(seasons.available, false);
	assert.equal(seasons.multiple, false);
	assert.equal(seasons.archived, false);
	assert.equal(seasons.param, undefined);
	assert.equal(seasons.currentLabel, null);
	assert.equal(seasons.select('season0'), false);
	const lb = new LeaderboardStore();
	await lb.load(true);
	assert.equal(lb.error, null);
	assert.equal(lb.players[0].steamid, 'legacy');
	const url = seen.find((s) => s.startsWith('/rr/leaderboard'));
	assert.ok(!url.includes('season'), url);
	await seasons.load(); // settled: no second probe
	assert.equal(seen.filter((s) => s === '/rr/seasons').length, 1);
});

test('a transient failure (500) is not remembered as an old server: the next load retries', async () => {
	let calls = 0;
	fakeServer({ '/rr/seasons': () => (++calls === 1 ? json({}, 500) : json(TABLE)) });
	await seasons.load();
	assert.equal(seasons.status, 'idle');
	assert.equal(seasons.available, false);
	await seasons.load();
	assert.equal(seasons.status, 'ready');
	assert.equal(seasons.multiple, true);
});

test('profile: ?season= passes through and the card is dropped on a season change', async () => {
	const seen = fakeServer({
		'/rr/seasons': () => json(TABLE),
		'/rr/profile': (u) => {
			const s = u.searchParams.get('season') ?? 'beta-s1';
			return json({ found: true, steamid: '765', name: 'Mak', season: s, rating: s === 'season0' ? 1500 : 1000, rail: { scope: s, wins: 1 } });
		}
	});
	await seasons.load();
	const pf = new ProfileStore();
	await pf.load('765');
	assert.equal(pf.data.rail.scope, 'beta-s1');
	seasons.select('season0');
	const p = pf.load('765');
	assert.equal(pf.data, null); // current season card is gone while the past one loads
	await p;
	assert.ok(seen.some((s) => s.startsWith('/rr/profile') && s.includes('season=season0')));
	assert.equal(pf.data.rail.scope, 'season0');
	assert.equal(seasons.labelOf(pf.data.rail.scope), 'Season Zero');
});

test('applyUrl: ?season= in a link selects that season; unknown or absent changes nothing', async () => {
	fakeServer({ '/rr/seasons': () => json(TABLE) });
	assert.equal(await seasons.applyUrl(''), false);
	assert.equal(await seasons.applyUrl('?x=1'), false);
	assert.equal(await seasons.applyUrl('?season=nope'), false);
	assert.equal(seasons.param, undefined);
	assert.equal(await seasons.applyUrl('?season=season0'), true);
	assert.equal(seasons.param, 'season0');
	assert.equal(await seasons.applyUrl('?season=season0'), false); // already there
	assert.equal(await seasons.applyUrl('?season=beta-s1'), true); // the current season = follow current
	assert.equal(seasons.param, undefined);
});
