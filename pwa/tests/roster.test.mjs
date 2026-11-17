// Season roster: who is ON the board versus who is only recorded. Shaping, copy and states.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = await import('$lib/finale/highlights');
const D = await import('$lib/finale/derive');
const U = await import('$lib/finale/unlisted');
const P = await import('$lib/finale/players');
const { shapeSummary } = await import('$lib/seasonFinale');
const { normalizeMine } = await import('$lib/finale/mine');
const { LeaderboardStore } = await import('$lib/stores/leaderboard.svelte');
const { seasons } = await import('$lib/stores/seasons.svelte');
const { invalidate } = await import('$lib/net.svelte');

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const who = (n, name = `Name${n}`) => ({ steamid: `7656${n}`, name, avatar: '', cc: 'US' });
const UNL = {
	ok: true,
	unlisted: {
		count: 530, with_wins: 330, placed: 406,
		top: [
			{ player: who(1, 'kingkells'), rating: 1515, peak: 1540, wins: 193, losses: 55, games: 248, overall_place: 3, tier: 'Galactus' },
			{ player: who(2, 'Mel_PH'), rating: 1443, wins: 125, losses: 23, games: 148, overall_place: 6, tier: 'infinity' },
			{ player: { steamid: '', name: 'no id' }, rating: 1400 }, // dropped
			{ player: who(4, 'zero'), rating: 0 } // dropped
		],
		most_active: [{ player: who(2, 'Mel_PH'), games: 148, days: 30 }, { player: who(5, 'Eno'), games: 3890, days: 50 }]
	}
};

beforeEach(() => {
	invalidate();
	seasons.table = null;
	seasons.selected = null;
	seasons.status = 'idle';
});

test('highlights: the unlisted block is validated; an older server simply has none', () => {
	const h = H.normalizeHighlights(UNL);
	assert.equal(h.unlisted.count, 530);
	assert.equal(h.unlisted.top.length, 2); // rows with no steamid or a zero rating are dropped
	assert.equal(h.unlisted.top[0].overallPlace, 3);
	assert.equal(h.unlisted.top[0].tier, 'galactus');
	assert.deepEqual(h.unlisted.mostActive.map((r) => r.player.name), ['Mel_PH', 'Eno']);
	assert.equal(H.normalizeHighlights({ ok: true, days: 97 }).unlisted, undefined);
	assert.equal(H.normalizeHighlights({ ok: true, unlisted: {} }).unlisted, undefined);
});

test('summary: roster and unlisted counts ride along; absent on an older server', () => {
	const s = shapeSummary({ ok: true, games: { total: 19598 }, players: { played: 566, roster: 36, unlisted: 530, placed: 30 } });
	assert.deepEqual([s.players, s.roster, s.unlisted, s.placed], [566, 36, 530, 30]);
	const old = shapeSummary({ ok: true, games: { total: 19598 }, players: { played: 566, placed: 418 } });
	assert.equal(old.roster, undefined);
});

const sentence = (bits) => bits.map((b) => `${b.n} ${b.n === 1 ? b.one : b.many}${b.tail ? `, against ${b.tail.n} ${b.tail.n === 1 ? b.tail.one : b.tail.many}` : ''}.`).join(' ');

test('hero line: games, days, players on the app against opponents; clauses drop; the older line without a roster', () => {
	const s = shapeSummary({ ok: true, games: { total: 19598, sets: 3051 }, players: { played: 566, roster: 36, unlisted: 530 } });
	const h = H.normalizeHighlights({ ok: true, days: 97 });
	assert.equal(sentence(D.heroBits(s, h)), '19598 games. 97 days. 36 players on the app, against 530 opponents.');
	// a clause drops when its number is absent
	assert.equal(sentence(D.heroBits(shapeSummary({ ok: true, games: { total: 5 }, players: { played: 9, roster: 3 } }), null)), '5 games. 3 players on the app.');
	assert.equal(sentence(D.heroBits(shapeSummary({ ok: true, players: { played: 9, roster: 1, unlisted: 1 } }), h)), '97 days. 1 player on the app, against 1 opponent.');
	// no roster: the older line
	const old = shapeSummary({ ok: true, games: { total: 100, sets: 10 }, players: { played: 50 } });
	assert.equal(D.heroBits(old, h).map((b) => b.many).join('|'), 'games|sets|players|days');
});

test('the numbers sentences: recorded by the roster, and the games-each average (each game counted once)', () => {
	const s = shapeSummary({ ok: true, games: { total: 19617 }, players: { played: 566, roster: 36, unlisted: 530 } });
	assert.equal(D.recordedBySentence(s), 'Every one of those games was recorded by one of 36 players running Retro Receipts.');
	assert.equal(D.gamesEachSentence(s), 'That is about 545 games each.');
	assert.equal(D.recordedBySentence(shapeSummary({ ok: true, games: { total: 5 }, players: { played: 3 } })), undefined); // older server: nothing
	assert.equal(D.gamesEachSentence(shapeSummary({ ok: true, players: { played: 3, roster: 2 } })), undefined); // no game total: no average
	assert.equal(D.recordedBySentence(shapeSummary({ ok: true, games: { total: 5 }, players: { played: 3, roster: 1 } })), 'Every one of those games was recorded by one of 1 player running Retro Receipts.');
});

test('at a glance: honest counts, with the roster when there is one', () => {
	const s = shapeSummary({ ok: true, games: { total: 19598, sets: 3051 }, players: { played: 566, roster: 36, placed: 30 } });
	const keys = D.glanceTiles(s, H.normalizeHighlights({ ok: true, days: 97, time: { hours: 434.6 } })).map((t) => [t.key, t.label]);
	assert.deepEqual(keys.slice(0, 4), [['games', 'games'], ['roster', 'players on the app'], ['players', 'on the ladder'], ['placed', 'finished with a rank']]);
	const old = D.glanceTiles(shapeSummary({ ok: true, games: { total: 9, sets: 3 }, players: { played: 5 } }), null).map((t) => t.key);
	assert.deepEqual(old, ['games', 'sets', 'players']);
});

test('props cards, wall and the copy', () => {
	const u = H.normalizeHighlights(UNL).unlisted;
	assert.equal(U.propsCards(u).length, 2);
	assert.equal(U.overallText(u.top[0]), 'would have finished 3rd overall');
	assert.equal(U.overallText({ ...u.top[0], overallPlace: undefined }), undefined);
	assert.equal(U.PROPS_LEAD('Season Zero'), 'These players never ran the app. Every one of their games was recorded from the other side of the match, and they still finished among the best in Season Zero.');
	assert.ok(U.ELO_EXPLAINER.startsWith('How that happens: the ladder uses Elo.') && U.ELO_EXPLAINER.includes('someone with a few dozen games against strong opponents can out-rate someone with thousands.'));
	assert.equal(U.RECORD_LEAD(530, 'Season Zero', 'Beta Season 1'), 'If you played someone running Retro Receipts, your games were recorded. 530 players have a Season Zero record and never ran the app. Download the app and just play to get on the board for Beta Season 1, or sign in with Steam to see your stats.');
	// the wall: most active first then top, de-duplicated (Mel_PH is in both), names as stored
	assert.deepEqual(U.wallNames(u).map((p) => p.name), ['Mel_PH', 'Eno', 'kingkells']);
	assert.deepEqual(U.wallNames(undefined), []);
});

test('find your name: only unlisted players, two letters to start, capped, markup stays text', () => {
	const roster = P.normalizeRoster({ ok: true, regular_days: 10, regulars: [], everyone: [
		{ steamid: 'a', name: 'kingkells', on_roster: false }, { steamid: 'b', name: 'Tester', on_roster: true },
		{ steamid: 'c', name: '<#0ff>=A=|Goldwing', on_roster: false }, ...Array.from({ length: 60 }, (_, i) => ({ steamid: `x${i}`, name: `Opp ${i}`, on_roster: false }))
	] });
	const pool = U.unlistedPool(roster);
	assert.equal(pool.length, 62); // the roster player 'Tester' is not in the unlisted pool
	assert.deepEqual(U.findMatches(pool, 'k'), { shown: [], total: 0 }); // one letter: nothing yet
	assert.equal(U.findMatches(pool, 'KING').shown[0].name, 'kingkells');
	assert.equal(U.findMatches(pool, 'goldwing').shown[0].name, '<#0ff>=A=|Goldwing'); // literal text
	const opp = U.findMatches(pool, 'opp');
	assert.equal(opp.total, 60);
	assert.equal(opp.shown.length, U.FIND_CAP);
	assert.deepEqual(U.unlistedPool(null), []);
});

test('the testers: roster rows from a roster-aware server; an older server falls back', () => {
	const aware = P.normalizeRoster({ ok: true, counts: { roster: 2, everyone: 3, regulars: 1 }, regulars: [], everyone: [{ steamid: 'a', name: 'A', on_roster: true }, { steamid: 'b', name: 'B', on_roster: true }, { steamid: 'c', name: 'C', on_roster: false }] });
	assert.equal(U.rosterAware(aware), true);
	assert.deepEqual(U.testers(aware).map((p) => p.name), ['A', 'B']);
	assert.deepEqual(aware.counts, { roster: 2, everyone: 3, regulars: 1 });
	const old = P.normalizeRoster({ ok: true, regulars: [], everyone: [{ steamid: 'a', name: 'A' }] });
	assert.equal(U.rosterAware(old), false);
	assert.deepEqual(U.testers(old), []);
	assert.equal(U.rosterAware(null), false);
});

test('your season for a recorded player: on_roster and the would-be overall place', () => {
	const m = normalizeMine({ found: true, name: 'kingkells', wins: 193, losses: 55, rating: 1515, on_roster: false, season_card: { place: null, overall_place: 3, of: 36 } });
	assert.equal(m.onRoster, false);
	assert.equal(m.card.overallPlace, 3);
	assert.equal(m.card.place, undefined);
	assert.equal(normalizeMine({ found: true, wins: 6, losses: 1 }).onRoster, undefined); // older server
});

test('Ranks: the default board is the roster; a finished season can show everyone; the open season cannot', async () => {
	const seen = [];
	globalThis.fetch = async (url) => {
		const u = String(url);
		seen.push(u);
		if (u.includes('/rr/seasons')) return json({ ok: true, current: 'beta-s1', seasons: [{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: 1794000000000 }, { id: 'beta-s1', label: 'Beta Season 1', start_ms: 1794000000000, end_ms: null }] });
		const all = u.includes('roster=all');
		return json({ season: u.includes('season=season0') ? 'season0' : 'beta-s1', scope: 'ranked', roster: all ? 'all' : 'season', unlisted: all ? undefined : 530,
			players: [{ steamid: '1', name: 'Listed', rating: 1700, wins: 9, losses: 1, ...(all ? { on_roster: true } : {}) }, ...(all ? [{ steamid: '2', name: 'Recorded', rating: 1500, wins: 5, losses: 1, on_roster: false }] : [])] });
	};
	await seasons.load();
	const lb = new LeaderboardStore();
	await lb.load(true);
	assert.ok(seen.every((u) => !u.includes('roster=all')), 'the default board never asks for everyone');
	assert.equal(lb.unlisted, 530);
	// open season: the toggle does nothing (the open board is registered players only)
	lb.setEveryone(true);
	await new Promise((r) => setTimeout(r, 20));
	assert.ok(!seen.some((u) => u.includes('roster=all')), 'no roster=all on the open season');
	lb.everyone = false;
	// finished season: Show everyone asks for roster=all and rows carry on_roster
	seasons.select('season0');
	await lb.load(true);
	lb.setEveryone(true);
	await new Promise((r) => setTimeout(r, 30));
	assert.ok(seen.some((u) => u.includes('season=season0') && u.includes('roster=all')));
	assert.deepEqual(lb.players.map((p) => p.on_roster), [true, false]);
	assert.equal(lb.unlisted, 530); // the line keeps the default board's count
	lb.setEveryone(false);
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(lb.players.length, 1);
});

// ── copy and page rules ──
const SRC = new URL('../src/', import.meta.url);
const read = (p) => readFileSync(new URL(p, SRC), 'utf8');

test('Ranks copy', () => {
	const ranks = read('routes/ranks/+page.svelte');
	assert.ok(ranks.includes('games this season but') && ranks.includes('not listed.'));
	assert.ok(ranks.includes('Show everyone') && !/Register to appear/.test(ranks) && ranks.includes('Download the app and just play.'));
	assert.ok(read('lib/components/BoardRow.svelte').includes('not on the board'));
});

test('the new sections are in the section nav and the Jump-to sheet, and hide without the new fields', () => {
	const page = read('routes/season/[id]/+page.svelte');
	for (const id of ['props', 'record']) {
		assert.ok(page.includes(`id="${id}"`) || page.includes(`hd('${id}'`), `${id} section`);
		assert.ok(page.includes(`{ id: '${id}', title:`), `${id} in the nav lists`);
	}
	assert.ok(page.includes('const showProps'));
	assert.ok(page.includes("'props'") && page.includes("'record'"));
});

test('the props section celebrates: no wording that reads as a call-out', () => {
	for (const p of ['lib/components/finale/UnlistedProps.svelte', 'lib/components/finale/YourRecord.svelte', 'lib/finale/unlisted.ts']) {
		const s = read(p);
		assert.ok(!/bother|refus|ignore|lazy|didn.?t sign|failed to|should have signed/i.test(s), `${p} reads as a call-out`);
		assert.ok(!/\{@html\b|innerHTML/.test(s), `${p} renders HTML`);
		assert.ok(!/win ?rate|winrate/i.test(s), `${p} shows a win rate`);
	}
});

test('breakable names split after slashes so handles wrap at the slash', () => {
	assert.deepEqual(U.breakable('twitch.tv/gthrillah'), ['twitch.tv/', 'gthrillah']);
	assert.deepEqual(U.breakable('twitch.tv\\ducvader'), ['twitch.tv\\', 'ducvader']);
	assert.deepEqual(U.breakable('NP | Clash'), ['NP |', ' Clash']);
	assert.equal(U.breakable('<#0ff>=x').join(''), '<#0ff>=x');
});
