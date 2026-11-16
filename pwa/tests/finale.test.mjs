// Unit tests for the season wrap-up data shaping. Run with `npm test`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { finaleAvailability, shapeLadder, shapeSummary, fetchFinale, fetchLadder, dayLabel } = await import('$lib/seasonFinale');
const { invalidate } = await import('$lib/net.svelte');
const { readFileSync } = await import('node:fs');

const TABLE = {
	current: 'beta-s1',
	seasons: [
		{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: 1763100000000 },
		{ id: 'beta-s1', label: 'Beta Season 1', start_ms: 1763100000000, end_ms: null }
	]
};
const P = (n) => ({ steamid: String(1000 + n), name: `p${n}`, rating: 1500 - n, wins: 1, losses: 0 });
const board = (n) => Array.from({ length: n }, (_, i) => P(i + 1));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => invalidate());

test('availability: only a finished season has a wrap-up', () => {
	const ok = finaleAvailability(TABLE, 'season0');
	assert.equal(ok.state, 'ready');
	assert.equal(ok.next.label, 'Beta Season 1'); // next season label comes from the table
	assert.equal(finaleAvailability(TABLE, 'beta-s1').state, 'unavailable'); // current season
	assert.equal(finaleAvailability(TABLE, 'nope').state, 'unavailable'); // unknown id
	assert.equal(finaleAvailability(null, 'season0').state, 'unavailable'); // old server, no table
	const three = { current: 'c', seasons: [...TABLE.seasons.slice(0, 1), { id: 'b', label: 'B', start_ms: 1763100000000, end_ms: 1773100000000 }, { id: 'c', label: 'C', start_ms: 1773100000000, end_ms: null }] };
	assert.equal(finaleAvailability(three, 'b').next.id, 'c');
	assert.equal(finaleAvailability({ current: 'x', seasons: [{ id: 'x', label: 'X', start_ms: 0, end_ms: 5 }] }, 'x').state, 'unavailable');
});

test('ladder: top 3 podium and places 4 to 8, never more than 8', () => {
	const l = shapeLadder(board(20));
	assert.deepEqual(l.podium.map((p) => p.name), ['p1', 'p2', 'p3']);
	assert.deepEqual(l.rows.map((r) => r.pos), [4, 5, 6, 7, 8]);
	assert.equal(l.rows[0].player.name, 'p4');
	assert.equal(l.rows.at(-1).player.name, 'p8');
});

test('ladder: short boards', () => {
	const l8 = shapeLadder(board(8));
	assert.equal(l8.podium.length, 3);
	assert.equal(l8.rows.length, 5);
	const l5 = shapeLadder(board(5));
	assert.equal(l5.podium.length, 3);
	assert.deepEqual(l5.rows.map((r) => r.pos), [4, 5]);
	const l3 = shapeLadder(board(3));
	assert.equal(l3.podium.length, 3);
	assert.equal(l3.rows.length, 0);
	// fewer than 3: no podium, plain rows from place 1
	const l2 = shapeLadder(board(2));
	assert.equal(l2.podium.length, 0);
	assert.deepEqual(l2.rows.map((r) => r.pos), [1, 2]);
	assert.deepEqual(shapeLadder([]), { podium: [], rows: [] });
	assert.deepEqual(shapeLadder(undefined), { podium: [], rows: [] });
});

test('ladder fetch asks for the season rating board and ignores another season answer', async () => {
	const seen = [];
	globalThis.fetch = async (url) => {
		seen.push(String(url));
		return json({ season: 'season0', players: board(4) });
	};
	assert.equal((await fetchLadder('season0')).length, 4);
	assert.ok(seen[0].includes('tab=rating') && seen[0].includes('season=season0'), seen[0]);
	invalidate();
	globalThis.fetch = async () => json({ season: 'beta-s1', players: board(4) });
	assert.deepEqual(await fetchLadder('season0'), []);
});

test('summary: real fields become labelled stats; zero and absent items are dropped', () => {
	const f = shapeSummary({
		ok: true,
		games: { total: 1234, counted: 1000, sets: 300, by_mode: { ranked: 1000, lobby: 200, tourney: 0, money: 34 } },
		players: { played: 80, ranked: 60, placed: 40 },
		activity: {
			games_per_player: { average: 30.84, median: 12, max: 410, max_player: { steamid: '7', name: 'Mak' } },
			busiest_day: { date: '2026-11-08', games: 77 }
		},
		accounts: { installs: 70, installs_played: 55, installs_is_lower_bound: true, registered_in_season: 50, registered_in_season_with_agent_build: 0, season_registrations: 12 },
		top: {
			wins: [{ steamid: '7', name: 'Mak', value: 99 }, { steamid: '8', name: 'Zed', value: 0 }],
			perfects: [],
			teams: [{ team: '44,42,52', games: 9, wins: 5 }],
			regions: [{ name: 'SoCal', players: 1 }]
		}
	});
	const t = Object.fromEntries(f.tiles.map((x) => [x.key, x]));
	assert.equal(t.games.value, '1,234');
	assert.equal(t.games.label, 'Games played');
	assert.equal(t.players.value, '80');
	assert.equal(t.avg.value, '30.8');
	assert.equal(t.most.note, 'Mak');
	assert.equal(t.busiest.value, '8 Nov 2026');
	assert.equal(t.signedup.value, 'At least 70'); // lower bound is said out loud
	assert.equal(t.signedup.label, 'players signed up');
	assert.equal(t.signedplayed.value, '55');
	assert.equal(t.signedplayed.label, 'of them played at least one game');
	assert.ok(!f.tiles.some((x) => /install/i.test(x.label)), 'never the word installed');
	assert.equal(t.registered.value, '12');
	const exact = shapeSummary({ ok: true, accounts: { installs: 8, installs_played: 3, installs_is_lower_bound: false, registered_in_season_with_agent_build: 2 } });
	assert.equal(exact.tiles.find((x) => x.key === 'signedup').value, '8');
	assert.ok(exact.tiles.find((x) => x.key === 'withapp').label.includes('desktop app'));
	assert.equal(t.withapp, undefined); // zero is not printed
	assert.deepEqual(f.modes.map((m) => m.label), ['Ranked', 'Lobby', 'Money match']); // tourney 0 dropped
	const wins = f.boards.find((b) => b.key === 'wins');
	assert.equal(wins.rows.length, 1); // the zero row is gone
	assert.equal(f.boards.find((b) => b.key === 'perfects'), undefined); // empty list: no board
	assert.ok(f.boards.find((b) => b.key === 'teams').rows[0].label.includes('/'));
	assert.equal(f.boards.find((b) => b.key === 'regions').rows[0].value, '1 player');
});

test('summary: placeholder character ids (e.g. 255) never show as characters; Ryu (id 0) does', () => {
	const f = shapeSummary({ ok: true, top: { characters: [{ char_id: 255, games: 9 }, { char_id: 0, games: 4 }], teams: [{ team: '255,0,1', games: 5 }, { team: '0,1,2', games: 3 }] } });
	const ch = f.boards.find((b) => b.key === 'characters');
	assert.deepEqual(ch.rows.map((r) => r.label), ['Ryu']);
	assert.equal(f.boards.find((b) => b.key === 'teams').rows.length, 1);
	assert.ok(!JSON.stringify(f).includes('#'));
});

test('summary: an empty season, a bad body or an old server yields nothing, never zeros', () => {
	assert.equal(shapeSummary(null), null);
	assert.equal(shapeSummary('x'), null);
	assert.equal(shapeSummary({ ok: false }), null);
	assert.equal(shapeSummary({ ok: true }), null);
	assert.equal(
		shapeSummary({ ok: true, games: { total: 0, by_mode: { ranked: 0 } }, players: { played: 0 }, activity: { games_per_player: { average: 0, median: 0, max: 0, max_player: null }, busiest_day: null }, accounts: { registered_in_season: 0 }, top: { wins: [], teams: [] } }),
		null
	);
});

test('fetchFinale: 404 (older server) and failures give null, not an error', async () => {
	globalThis.fetch = async () => json({}, 404);
	assert.equal(await fetchFinale('season0'), null);
	invalidate();
	globalThis.fetch = async () => {
		throw new Error('offline');
	};
	assert.equal(await fetchFinale('season0'), null);
	invalidate();
	let url = '';
	globalThis.fetch = async (u) => ((url = String(u)), json({ ok: true, games: { total: 5 } }));
	const f = await fetchFinale('season0');
	assert.ok(url.includes('/rr/season/summary') && url.includes('season=season0'), url);
	assert.equal(f.tiles[0].value, '5');
});

test('dayLabel formats a server date and rejects junk', () => {
	assert.equal(dayLabel('2026-01-05'), '5 Jan 2026');
	assert.equal(dayLabel('nope'), undefined);
});

test('feedback callout: the top link and the bottom block share one anchor id', () => {
	const src = readFileSync(new URL('../src/routes/season/[id]/+page.svelte', import.meta.url), 'utf8');
	const id = /const FEEDBACK_ID = '([^']+)'/.exec(src)?.[1];
	assert.ok(id, 'FEEDBACK_ID constant');
	assert.ok(src.includes('href="#{FEEDBACK_ID}"'), 'callout links to the anchor');
	assert.ok(src.includes('id={FEEDBACK_ID}') && src.includes('tabindex="-1"'), 'the block heading carries the id and is focusable');
	assert.equal(src.split('id={FEEDBACK_ID}').length, 2, 'the id is used exactly once');
});
