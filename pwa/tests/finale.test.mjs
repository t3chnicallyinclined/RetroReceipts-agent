// Unit tests for the season finale data shaping. Run with `npm test`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { finaleAvailability, shapeLadder, shapeSummary, fetchSummary, fetchLadder, dayLabel, saneMs } = await import('$lib/seasonFinale');
const { normalizeHighlights, fetchHighlights, tapeReady } = await import('$lib/finale/highlights');
const D = await import('$lib/finale/derive');
const F = await import('$lib/finale/feedback');
const P = await import('$lib/finale/players');
const { normalizeMine, mineUnranked } = await import('$lib/finale/mine');
const { invalidate } = await import('$lib/net.svelte');

const TABLE = {
	current: 'beta-s1',
	seasons: [
		{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: 1763100000000 },
		{ id: 'beta-s1', label: 'Beta Season 1', start_ms: 1763100000000, end_ms: null }
	]
};
const P1 = (n) => ({ steamid: String(1000 + n), name: `p${n}`, rating: 1500 - n, wins: 1, losses: 0 });
const board = (n) => Array.from({ length: n }, (_, i) => P1(i + 1));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const who = (n) => ({ steamid: `7656${n}`, name: `Name${n}`, avatar: '', cc: 'US' });

beforeEach(() => invalidate());

// ── availability and ladder ──
test('availability: only a finished season has a wrap-up', () => {
	const ok = finaleAvailability(TABLE, 'season0');
	assert.equal(ok.state, 'ready');
	assert.equal(ok.next.label, 'Beta Season 1');
	assert.equal(finaleAvailability(TABLE, 'beta-s1').state, 'unavailable');
	assert.equal(finaleAvailability(TABLE, 'nope').state, 'unavailable');
	assert.equal(finaleAvailability(null, 'season0').state, 'unavailable');
});

test('ladder: champion from one player up, 2nd and 3rd, places 4 to 8, never more than 8', () => {
	const l = shapeLadder(board(20));
	assert.equal(l.champion.name, 'p1');
	assert.deepEqual(l.side.map((p) => p.name), ['p2', 'p3']);
	assert.deepEqual(l.rows.map((r) => r.pos), [4, 5, 6, 7, 8]);
	assert.equal(l.count, 8);
	const one = shapeLadder(board(1));
	assert.equal(one.champion.name, 'p1');
	assert.equal(one.side.length + one.rows.length, 0);
	const two = shapeLadder(board(2));
	assert.equal(two.side.length, 1);
	assert.equal(two.rows.length, 0);
	assert.equal(shapeLadder([]).champion, null);
	assert.equal(shapeLadder(undefined).count, 0);
});

test('ladder fetch asks for the season rating board and ignores another season answer', async () => {
	const seen = [];
	globalThis.fetch = async (url) => (seen.push(String(url)), json({ season: 'season0', players: board(4) }));
	assert.equal((await fetchLadder('season0')).length, 4);
	assert.ok(seen[0].includes('tab=rating') && seen[0].includes('season=season0'));
	invalidate();
	globalThis.fetch = async () => json({ season: 'beta-s1', players: board(4) });
	assert.deepEqual(await fetchLadder('season0'), []);
});

// ── summary ──
test('summary: keeps games, sets, players, modes, busiest day; drops sign-ups, registrations, OCVs, money, regions', () => {
	const s = shapeSummary({
		ok: true,
		games: { total: 1234, sets: 300, by_mode: { ranked: 1000, lobby: 200, tourney: 0, money: 34 } },
		players: { played: 80, placed: 40 },
		activity: { busiest_day: { date: '2026-11-08', games: 77 }, games_per_player: { median: 12 }, first_match_ms: 1786574842, last_match_ms: 1794858407513 },
		accounts: { installs: 70, registered_in_season_with_agent_build: 3, season_registrations: 12 },
		top: { wins: [{ ...who(1), value: 99 }], ocvs: [{ ...who(2), value: 5 }], regions: [{ name: 'SoCal', players: 1 }], perfects: [{ ...who(3), value: 0 }] }
	});
	assert.equal(s.games, 1234);
	assert.deepEqual(s.modes.map((m) => m.key), ['ranked', 'lobby']); // tourney 0 dropped, money never listed
	assert.equal(s.busiestDay.date, '2026-11-08');
	assert.equal(s.firstMs, undefined); // 1786574842 is seconds: treated as missing, never printed as 1970
	assert.equal(s.lastMs, 1794858407513);
	assert.equal(s.top.wins[0].value, 99);
	assert.equal(s.top.ocvs, undefined);
	assert.equal(s.top.perfects, undefined); // a zero row is not a row
	assert.ok(!('accounts' in s) && !JSON.stringify(s).includes('installs'));
	assert.equal(saneMs(1786574842), undefined);
});

test('summary: an empty season, a bad body or an old server yields nothing', async () => {
	assert.equal(shapeSummary(null), null);
	assert.equal(shapeSummary({ ok: false }), null);
	assert.equal(shapeSummary({ ok: true, games: { total: 0, by_mode: { ranked: 0 } }, players: { played: 0 }, top: { wins: [] } }), null);
	globalThis.fetch = async () => json({}, 404);
	assert.equal(await fetchSummary('season0'), null);
});

test('dayLabel and dateText never print a 1970 date', () => {
	assert.equal(dayLabel('2026-01-05'), '5 Jan 2026');
	assert.equal(dayLabel('nope'), undefined);
	assert.equal(D.dateText('2026-10-03'), '3 Oct 2026');
	assert.equal(D.dateText('1970-01-21'), undefined);
	assert.equal(D.dateText(1786574842), '12 Aug 2026'); // seconds-era row: normalised
	assert.equal(D.dateText(1786574842000), '12 Aug 2026');
	assert.equal(D.dateText(0), undefined);
	assert.equal(D.toMs(5), 5000);
});

// ── highlights ──
const HL = {
	ok: true, days: 97, every_day: true, time: { hours: 434.6, timed_games: 16247, median_s: 94, longest_s: 333 },
	months: [{ m: '2026-08', games: 4969, new_players: 301, active_players: 301 }, { m: '2026-11', games: 2254, new_players: 29, active_players: 196, partial_through: '2026-11-16' }],
	peak: { hour_utc: 2, weekday: 6 }, habits: { days2: 356, days10: 70, median_games: 14, players100: 66 },
	tiers: { placed: 418, median: 981, min: 523, max: 1740, now: { iron: 89, galactus: 3 }, reached: { gold: 130, galactus: 5 } },
	streaks: { reached10: 40, top: [{ player: who(1), value: 413 }, { player: who(2), value: 141 }] },
	chars: [{ char_id: 52, team_share: 63.3, players: 352 }, { char_id: 255, team_share: 9, players: 1 }, { char_id: 0, team_share: 0.02, players: 3 }],
	teams: { distinct: 949, top: [{ team: '42,52,56', share: 15.2, players: 109 }, { team: '255,1,2', share: 4 }] },
	upset: { winner: who(5), winner_rating: 931, opp_rating: 1612, gap: 681, date: '2026-10-03', over300: 88, session_id: 'abc', tape: 'ready' },
	rivalries: { pairs: 1517, pairs10: 679, most: { a: who(1), b: who(2), games: 170, session_id: 's1', tape: false }, even: { a: who(1), b: who(3), a_wins: 35, b_wins: 35, session_id: 's2', tape: false } },
	sets: { full: 885, scores: [{ score: '10–0', sets: 324 }, { score: '6-4', sets: 125 }, { score: '5-5', sets: 60 }] },
	perfects: { total: 80, players: 27, top: [{ player: who(4), value: 15 }] }, comebacks: { total: 0, top: [] },
	climbers: { since: '2026-09-01', rows: [{ player: who(6), delta: 467, from: 1233, to: 1700 }] },
	world: { known: 214, countries: 23, cross_share: 55.5, top_pair: ['mx', 'us'], top: [{ cc: 'US', players: 124 }, { cc: 'xx1', players: 5 }] },
	trust: { confirmed_share: 74.4, taped: 0 },
	mentions: [{ player: who(9), place: 27, tier: 'Adamantium', boards: [
		{ key: 'wins', label: 'Wins', value: 2423, rank: 2 }, { key: 'games', label: 'Games played', value: 3890, rank: 1 },
		{ key: 'rivalry_most', label: 'Games in the most played rivalry', value: 170, rank: 1 }, { key: 'rivalry_even', label: 'Most even rivalry', value: '35-35', rank: null }] }]
};

test('highlights: validates, drops placeholders and zeros, accepts the server variants', () => {
	const h = normalizeHighlights(HL);
	assert.equal(h.days, 97);
	assert.deepEqual(h.chars.map((c) => c.charId), [52, 0]); // 255 is not a roster character
	assert.equal(h.teams.top.length, 1); // the team with a placeholder id is dropped
	assert.equal(h.upset.tape, true); // tape "ready" means a tape
	assert.equal(tapeReady('ready') && tapeReady(true) && !tapeReady('none'), true);
	assert.equal(h.sets.scores[0].score, '10-0'); // en dash normalised
	assert.equal(h.comebacks.top.length, 0);
	assert.equal(h.trust.taped, undefined); // zero taped games is not printed
	assert.deepEqual(h.world.top.map((c) => c.cc), ['US']);
	assert.deepEqual(h.world.topPair, ['MX', 'US']);
	assert.equal(h.mentions[0].tier, 'adamantium');
	assert.equal(normalizeHighlights(null), null);
	assert.equal(normalizeHighlights({ ok: false }), null);
});

test('highlights 404 gives null, not an error', async () => {
	globalThis.fetch = async () => json({}, 404);
	assert.equal(await fetchHighlights('season0'), null);
});

test('mentions: at most four, ranked chips first, rivalry boards carry no #rank, server labels kept', () => {
	const v = D.mentionViews(normalizeHighlights(HL));
	assert.equal(v.length, 1);
	assert.deepEqual(v[0].chips.map((c) => [c.key, c.rank]), [['games', 1], ['wins', 2], ['rivalry_most', null], ['rivalry_even', null]]);
	assert.equal(v[0].chips[0].value, '3,890');
	assert.equal(v[0].chips.find((c) => c.key === 'rivalry_even').value, '35–35');
	assert.equal(D.mentionViews(null).length, 0);
	const many = normalizeHighlights({ ...HL, mentions: Array.from({ length: 6 }, (_, i) => ({ player: who(30 + i), boards: [{ key: 'wins', label: 'Wins', value: 5, rank: 3 }] })) });
	assert.equal(D.mentionViews(many).length, 4);
});

test('group one-line summaries drop missing parts and fall back as the spec says', () => {
	const h = normalizeHighlights(HL);
	const s = shapeSummary({ ok: true, activity: { busiest_day: { date: '2026-08-30', games: 456 } } });
	assert.equal(D.groupSummary('season', s, h), '97 days of play, busiest day 30 Aug 2026.');
	assert.equal(D.groupSummary('season', null, null), undefined);
	assert.equal(D.groupSummary('ladder', null, h), '418 ranked players, longest streak 413, biggest climb +467.');
	assert.equal(D.groupSummary('played', null, h), 'Sentinel on 63% of teams, 949 different teams.');
	assert.equal(D.groupSummary('moments', null, h), 'A 681-point upset, a 170-game rivalry, 80 perfects.');
	assert.equal(D.groupSummary('moments', null, null), 'Perfects and comebacks.');
	assert.equal(D.groupSummary('world', null, h), '23 countries, 56% of games crossed a border.');
	assert.equal(D.groupSummary('world', null, null), undefined);
});

test('presentSubs: a group with nothing in it is not rendered (the highlights-404 state)', () => {
	const s = shapeSummary({ ok: true, games: { total: 9 }, activity: { busiest_day: { date: '2026-08-30', games: 4 } }, top: { best_streak: [{ ...who(1), value: 4 }], perfects: [{ ...who(1), value: 2 }] } });
	assert.deepEqual(D.presentSubs('season', s, null).map((x) => x.id), ['totals']);
	assert.deepEqual(D.presentSubs('ladder', s, null).map((x) => x.id), ['streaks']);
	assert.deepEqual(D.presentSubs('played', s, null), []);
	assert.deepEqual(D.presentSubs('moments', s, null).map((x) => x.id), ['feats']);
	assert.deepEqual(D.presentSubs('world', s, null), []);
	assert.equal(D.presentSubs('ladder', s, normalizeHighlights(HL)).length, 3);
});

test('card value formatting', () => {
	assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 27, 101, 112].map(D.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '27th', '101st', '112th']);
	assert.equal(D.durText(94), '1 min 34 s');
	assert.equal(D.durText(45), '45 s');
	assert.equal(D.shareText(63.3), '63%');
	assert.equal(D.shareText(0.4), '0.4%');
	assert.equal(D.shareText(0.01), '<0.1%');
	assert.equal(D.localHourText(2, 0), '02:00');
	assert.equal(D.localHourText(2, -300), '21:00');
	assert.equal(D.monthLong('2026-10'), 'October');
	assert.equal(D.nf(3890), '3,890');
	const rows = D.tierRows(normalizeHighlights(HL), 'now');
	assert.deepEqual(rows.map((r) => r.slug), ['galactus', 'iron']);
	assert.equal(rows[1].pct, 21);
	assert.equal(D.tierSentence(rows[0], 'now', 418), 'Galactus (1500+): 3 players finished here, 1% of the 418 ranked.');
});

test('season card: accepts both opponent shapes, never invents a missing piece', () => {
	const a = D.normalizeSeasonCard({ place: 187, of: 418, top_pct: 45, opponent: { player: { name: 'Rival', steamid: '9' }, games: 14 }, best_win: { opp_rating: 1204, gap: 192, date: '2026-10-11', session_id: 'x', tape: true }, months: [{ m: '2026-08', games: 12 }, { m: 'bad', games: 3 }] });
	assert.equal(a.opponent.name, 'Rival');
	assert.equal(a.bestWin.date, '11 Oct 2026');
	assert.equal(a.months.length, 1);
	const b = D.normalizeSeasonCard({ place: null, of: 418, most_played_opponent: { name: 'Flat', games: 3 } });
	assert.equal(b.opponent.name, 'Flat');
	assert.equal(b.place, undefined);
	assert.equal(D.normalizeSeasonCard(null), null);
	const m = normalizeMine({ found: true, name: 'Me', wins: 2, losses: 1, rating: 1010, teams: [{ team: '42,52,56' }], season_card: { place: 3, of: 9 } });
	assert.equal(mineUnranked(m), true); // 3 games: a rank needs 5
	assert.deepEqual(m.team, [42, 52, 56]);
	assert.equal(normalizeMine({ found: true, wins: 0, losses: 0 }).found, false);
});

// ── polls ──
const POLL = { id: 'p', q: 'Q?', hint: '', mine: null, options: [{ id: 'a', label: 'A', votes: 3 }, { id: 'b', label: 'B', votes: 1 }] };
const VIEW = (mine, a, b) => ({ ok: true, open: true, polls: [{ ...POLL, mine, options: [{ id: 'a', label: 'A', votes: a }, { id: 'b', label: 'B', votes: b }] }], asked: [] });

test('poll state machine: signed-out refusal, vote, change vote, closed', async () => {
	const calls = [];
	const post = async (path, body) => (calls.push([path, body]), { ok: true, data: VIEW(body.option, body.option === 'a' ? 4 : 3, body.option === 'b' ? 2 : 1) });
	// signed out: refused before any request
	assert.deepEqual(await F.submitVote({ signedIn: false, open: true, season: 's', poll: 'p', option: 'a', post }), { ok: false, refusal: 'signin' });
	assert.equal(calls.length, 0);
	let st = F.pollStatus(POLL, { signedIn: false, open: true, showResults: false, refusal: 'signin' });
	assert.equal(st.text, 'Sign in to vote. One vote per account.');
	assert.equal(st.needsSignIn, true);
	assert.equal(F.pollStatus(POLL, { signedIn: false, open: true, showResults: false }).text, 'One vote per signed-in account.');
	// before voting: options only; after: results, with the viewer's pick
	assert.equal(F.pollStatus(POLL, { signedIn: true, open: true, showResults: false }).phase, 'choose');
	assert.equal(F.pollStatus(POLL, { signedIn: true, open: true, showResults: false }).text, 'Tap an answer to vote. Results show after you vote.');
	const v1 = await F.submitVote({ signedIn: true, open: true, season: 's', poll: 'p', option: 'a', post });
	assert.equal(v1.ok, true);
	assert.deepEqual(calls[0], ['/rr/season/feedback/vote', { season: 's', poll: 'p', option: 'a' }]);
	const mineA = v1.view.polls[0];
	assert.equal(mineA.mine, 'a');
	st = F.pollStatus(mineA, { signedIn: true, open: true, showResults: false });
	assert.equal(st.phase, 'results');
	assert.equal(st.text, '5 votes · tap another answer to change yours');
	assert.equal(F.optionPct(mineA, mineA.options[0]), 80);
	// change vote
	const v2 = await F.submitVote({ signedIn: true, open: true, season: 's', poll: 'p', option: 'b', post });
	assert.equal(v2.view.polls[0].mine, 'b');
	// closed: refused client-side, results only
	assert.deepEqual(await F.submitVote({ signedIn: true, open: false, season: 's', poll: 'p', option: 'a', post }), { ok: false, refusal: 'closed' });
	st = F.pollStatus(POLL, { signedIn: true, open: false, showResults: false });
	assert.deepEqual([st.phase, st.text], ['results', 'Voting has closed.']);
	// server refusals map to reasons
	assert.equal(F.refusalOf('sign in with Steam to vote'), 'signin');
	assert.equal(F.refusalOf('voting is closed'), 'closed');
	assert.equal(F.refusalOf('too many vote changes, try again later'), 'limit');
	assert.equal(F.refusalOf('boom'), 'error');
	const refused = await F.submitVote({ signedIn: true, open: true, season: 's', poll: 'p', option: 'a', post: async () => ({ ok: false, error: 'sign in with Steam to vote' }) });
	assert.deepEqual(refused, { ok: false, refusal: 'signin' });
});

test('poll: a signed-in viewer who may not vote sees the reason, not a failed tap', () => {
	const view = F.normalizeFeedback({ ok: true, can_vote: false, can_vote_reason: 'Only players who played Season Zero can vote.', polls: [{ ...POLL }], asked: [] });
	assert.equal(view.blocked, 'Only players who played Season Zero can vote.');
	assert.equal(F.pollStatus(POLL, { signedIn: true, open: true, showResults: false, blocked: view.blocked }).text, view.blocked);
	assert.equal(F.normalizeFeedback({ ok: true, polls: [POLL] }).blocked, undefined);
	assert.equal(F.normalizeFeedback({ ok: true, can_vote: false, polls: [POLL] }).blocked, 'Only players who played this season can vote.');
});

test('feedback: normalised, 404 means hidden; notes: refusals and limits', async () => {
	assert.equal(F.normalizeFeedback(null), null);
	const v = F.normalizeFeedback({ ok: true, open: false, polls: [POLL, { id: 'bad' }], asked: [{ id: 'x', text: 'Thing', status: 'weird' }, { id: 'y', text: '  ' }] });
	assert.equal(v.polls.length, 1);
	assert.equal(v.open, false);
	assert.deepEqual(v.asked.map((a) => a.status), ['asked']);
	globalThis.fetch = async () => json({}, 404);
	assert.equal(await F.fetchFeedback('s', null), null);
	const post = async () => ({ ok: true });
	assert.equal((await F.submitNote({ signedIn: false, season: 's', text: 'hello there', post })).ok, false);
	assert.equal((await F.submitNote({ signedIn: true, season: 's', text: 'hi', post })).ok, false);
	assert.equal((await F.submitNote({ signedIn: true, season: 's', text: 'x'.repeat(281), post })).ok, false);
	assert.deepEqual(await F.submitNote({ signedIn: true, season: 's', text: ' hello there ', post }), { ok: true, message: 'Thanks. Your note was sent.' });
});

// ── special thanks ──
const ROSTER = (n) => ({ ok: true, regular_days: 10, regulars: [{ player: who(1), days: 40, games: 99 }, { player: { steamid: '', name: 'no id' }, days: 12 }], everyone: Array.from({ length: n }, (_, i) => ({ steamid: `id${i}`, name: i === 3 ? '<#0ff>=A=|Goldwing' : `Player ${i}` })).concat([{ steamid: 'id0', name: 'dup' }]) });

test('roster: normalised, de-duplicated, null when empty or malformed', () => {
	const r = P.normalizeRoster(ROSTER(5));
	assert.equal(r.regulars.length, 1);
	assert.equal(r.everyone.length, 5);
	assert.equal(r.regularDays, 10);
	assert.equal(P.normalizeRoster({ ok: true, regulars: [], everyone: [] }), null);
	assert.equal(P.normalizeRoster(null), null);
});

test('name filter: case-insensitive, by name as stored, markup stays text', () => {
	const r = P.normalizeRoster(ROSTER(600));
	assert.equal(P.filterNames(r.everyone, '').length, 600);
	assert.equal(P.filterNames(r.everyone, '  player 599 ').length, 1);
	assert.equal(P.filterNames(r.everyone, 'PLAYER 1').length > 1, true);
	assert.deepEqual(P.filterNames(r.everyone, 'goldwing').map((p) => p.name), ['<#0ff>=A=|Goldwing']);
	assert.equal(P.filterNames(r.everyone, 'zzz').length, 0);
	assert.equal(P.filterNames(r.everyone, '<#0ff>')[0].name.startsWith('<#0ff>'), true); // matched as plain text
});

test('name list window: first screenful for a long list, everything for a short one or while filtering', () => {
	const long = Array.from({ length: 566 }, (_, i) => i);
	assert.deepEqual([P.windowNames(long, false, false).shown.length, P.windowNames(long, false, false).hidden], [60, 506]);
	assert.equal(P.windowNames(long, true, false).hidden, 0);
	assert.equal(P.windowNames(long, false, true).shown.length, 566);
	const tiny = Array.from({ length: 14 }, (_, i) => i);
	assert.deepEqual([P.windowNames(tiny, false, false).shown.length, P.windowNames(tiny, false, false).hidden], [14, 0]); // no "Show all"
});

test('find me: index in the full list, -1 when signed out or absent', () => {
	const r = P.normalizeRoster(ROSTER(100));
	assert.equal(P.findMe(r.everyone, 'id77'), 77);
	assert.equal(P.findMe(r.everyone, null), -1);
	assert.equal(P.findMe(r.everyone, 'nobody'), -1);
	// a hidden row is found in the FULL list, so the caller expands before scrolling
	assert.equal(P.windowNames(r.everyone, false, false).shown.some((p) => p.steamid === 'id77'), false);
});

// ── static checks on the page and its components ──
const FIN = new URL('../src/lib/components/finale/', import.meta.url);
const files = [...readdirSync(FIN).map((f) => new URL(f, FIN)), new URL('../src/routes/season/[id]/+page.svelte', import.meta.url)];

test('no finale component renders server data as HTML', () => {
	for (const f of files) {
		const src = readFileSync(f, 'utf8');
		assert.ok(!/\{@html\b/.test(src), `${f.pathname} uses {@html}`);
		assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src), `${f.pathname} writes raw HTML`);
	}
});

test('deep links: every sub-section id the groups promise exists as an element id, and sections have headings', () => {
	const bodies = readFileSync(new URL('GroupBodies.svelte', FIN), 'utf8');
	const page = readFileSync(new URL('../src/routes/season/[id]/+page.svelte', import.meta.url), 'utf8');
	for (const id of ['totals', 'tiers', 'streaks', 'climbers', 'characters', 'teams', 'upsets', 'rivalries', 'feats', 'replays', 'countries']) {
		assert.ok(bodies.includes(`id="${id}"`) && bodies.includes(`id="${id}-h"`), `${id} anchor and heading`);
	}
	for (const id of ['top', 'podium', 'mentions', 'glance', 'you', 'explore', 'next', 'thanks', 'feedback', 'close']) {
		assert.ok(page.includes(`id="${id}"`) || page.includes(`hd('${id}'`) || readFileSync(new URL('FinaleBanner.svelte', FIN), 'utf8').includes(`id="${id}"`), `${id} section id`);
	}
	assert.ok(page.includes("'thanks'") && page.includes('Special thanks'));
});
