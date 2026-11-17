// Season finale moments: link building, which action each tape state gets, shaping, and the set page deep link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('$lib/finale/moments');
const H = await import('$lib/finale/highlights');
const D = await import('$lib/finale/derive');

const who = (n, name = `Name${n}`) => ({ steamid: `7656119800000000${n}`.slice(0, 17), name, avatar: '', cc: 'US' });
const mk = (kind, o = {}) => ({
	kind, label: kind, value: 100, unit: 'x', match_key: `k_${kind}`, session_id: `s_${kind}`, match_index: 3, ts: 1, duration_s: 60,
	tape: 'ready', winner: who(1, 'ducvader'), loser: null, wteam: [23, 49, 52], lteam: [], ...o
});

test('tape states: only the five server strings count; a boolean is not a state', () => {
	for (const s of ['ready', 'pending', 'archived', 'none']) assert.equal(M.tapeStateOf(s), s);
	for (const v of [true, false, 'READY', 'gone', null, undefined, 1]) assert.equal(M.tapeStateOf(v), undefined);
});

test('the action: Watch only for a ready tape; every other state is See the set with an honest reason', () => {
	assert.deepEqual(M.momentAction('ready', false), { kind: 'watch', label: 'Watch the replay', reason: '' });
	assert.deepEqual(M.momentAction('ready', true), { kind: 'watch', label: 'Watch the replay', reason: '' });
	const arch = M.momentAction('archived', false);
	assert.equal(arch.kind, 'set');
	assert.equal(arch.label, 'See the set');
	assert.equal(arch.reason, 'This replay is in the archive. Sign in to request it.');
	assert.equal(M.momentAction('archived', true).reason, 'This replay is in the archive. Open the set to request it.');
	assert.equal(M.momentAction('pending', false).reason, 'This replay is still being uploaded.');
	assert.equal(M.momentAction('none', true).reason, 'No replay was recorded for this game.');
	// an older server that sends no state: the plain link and no claim at all
	assert.deepEqual(M.momentAction(undefined, true), { kind: 'set', label: 'See the set', reason: '' });
	// the reason lines never promise a Watch button the viewer cannot use
	for (const s of ['archived', 'pending', 'none']) assert.notEqual(M.momentAction(s, true).kind, 'watch');
});

test('links: the set page at that game, pinned to the winner\'s seat when it is a real id', () => {
	assert.equal(M.gameLink('/app', 's_1', 'k_9', '76561198790842085'), '/app/r/set/s_1?game=k_9&p=76561198790842085');
	assert.equal(M.gameLink('', 's_1', 'k 9&x', undefined), '/r/set/s_1?game=k%209%26x');
	assert.equal(M.gameLink('', 's_1'), '/r/set/s_1');
	assert.equal(M.gameLink('', 's_1', 'k', 'not-an-id'), '/r/set/s_1?game=k');
	assert.equal(M.gameLink('', 'a/b', 'k'), '/r/set/a%2Fb?game=k');
});

test('figures', () => {
	assert.equal(M.momentFigure({ kind: 'longest_game', value: 333 }), '5 min 33 s');
	assert.equal(M.momentFigure({ kind: 'fastest_game', value: 42 }), '42 s');
	assert.equal(M.momentFigure({ kind: 'biggest_combo', value: 148 }), '148 hits');
	assert.equal(M.momentFigure({ kind: 'biggest_upset', value: 681 }), '681 points apart');
	assert.equal(M.momentFigure({ kind: 'biggest_comeback', value: 1500 }), 'back from 1,500 down');
	assert.equal(M.momentFigure({ kind: 'perfect', value: 1742 }), 'over a 1,742-rated player');
});

test('normalizeMoments: known kinds in order, one per kind, malformed entries dropped, not guessed', () => {
	const out = M.normalizeMoments([
		mk('biggest_upset', { value: 681 }),
		mk('longest_game', { value: 333, loser: who(2, 'Wenzel') }),
		mk('longest_game', { value: 999 }), // duplicate kind: the first one wins
		mk('mystery_kind'), // unknown kind
		mk('perfect', { match_key: '' }), // no key
		mk('biggest_combo', { session_id: '' }), // no session
		mk('fastest_game', { value: 0 }), // no figure
		mk('biggest_comeback', { tape: 'weird', winner: { steamid: '', name: 'x' }, wteam: [23, 999, 'a', 52, 1, 2] }),
		null, 'x', 7
	]);
	assert.deepEqual(out.map((m) => m.kind), ['longest_game', 'biggest_comeback', 'biggest_upset']);
	assert.equal(out[0].value, 333);
	assert.equal(out[0].loser?.name, 'Wenzel');
	assert.equal(out[1].tape, undefined); // an unknown state is "not said", never "ready"
	assert.equal(out[1].winner, null);
	assert.deepEqual(out[1].wteam, [23, 52, 1]);
	assert.deepEqual(M.normalizeMoments(undefined), []);
	assert.deepEqual(M.normalizeMoments({}), []);
	assert.equal(M.momentWho(out[0]), 'ducvader beat Wenzel');
	assert.equal(M.momentWho(out[2]), 'ducvader'); // winner-only kinds never name a loser
});

test('highlights carry the moments, and the game key and tape state on the upset, combo and best win', () => {
	const h = H.normalizeHighlights({
		ok: true,
		moments: [mk('longest_game', { value: 333, tape: 'archived' })],
		upset: { winner: who(1, 'Wenzel'), winner_rating: 1184, opp_rating: 1742, gap: 558, session_id: 's_u', tape: false, match_key: 'k_u', tape_state: 'ready' },
		combo: { hits: 148, session_id: 's_c', tape: false, match_key: 'k_c', tape_state: 'none' }
	});
	assert.equal(h.moments.length, 1);
	assert.equal(h.moments[0].tape, 'archived');
	assert.deepEqual([h.upset.matchKey, h.upset.tapeState, h.upset.sessionId], ['k_u', 'ready', 's_u']);
	assert.deepEqual([h.combo.matchKey, h.combo.tapeState], ['k_c', 'none']);
	// a server that does not send them yet: nothing new appears
	const old = H.normalizeHighlights({ ok: true, upset: { winner: who(1, 'Wenzel'), winner_rating: 1184, opp_rating: 1742, gap: 558, session_id: 's_u', tape: true } });
	assert.equal(old.moments, undefined);
	assert.equal(old.upset.matchKey, undefined);
	assert.equal(old.upset.tapeState, undefined);
	assert.equal(D.presentSubs('moments', null, old).some((s) => s.id === 'moment-replays'), false);
	assert.equal(D.presentSubs('moments', null, h).some((s) => s.id === 'moment-replays'), true);
	const card = D.normalizeSeasonCard({ best_win: { opp_rating: 1500, gap: 300, session_id: 's_b', match_key: 'k_b', tape_state: 'pending' } });
	assert.deepEqual([card.bestWin.matchKey, card.bestWin.tapeState], ['k_b', 'pending']);
	assert.equal(D.normalizeSeasonCard({ best_win: { opp_rating: 1500, gap: 300, session_id: 's_b' } }).bestWin.matchKey, undefined);
});

test('the deep link: a known key finds its game, an unknown or missing one finds nothing', () => {
	const games = [{ match_key: 'a' }, { match_key: 'b' }, {}];
	assert.equal(M.gameIndex(games, 'b'), 1);
	assert.equal(M.gameIndex(games, 'zzz'), -1);
	assert.equal(M.gameIndex(games, ''), -1);
	assert.equal(M.gameIndex(games, null), -1);
	assert.equal(M.gameIndex(undefined, 'a'), -1);
});

test('wiring: the set page passes ?game=, the receipt marks the row and opens a replay only for a ready tape', () => {
	const SRC = new URL('../src/', import.meta.url);
	const page = readFileSync(new URL('routes/r/set/[id]/+page.svelte', SRC), 'utf8');
	assert.ok(page.includes("focusGame={page.url.searchParams.get('game')}"));
	const rec = readFileSync(new URL('lib/components/SetReceipt.svelte', SRC), 'utf8');
	assert.ok(rec.includes("(await availability(replayRow(g))) === 'ready'"), 'same availability check as the row button');
	assert.ok(rec.includes('el?.focus({ preventScroll: true })') && rec.includes('scrollIntoView'));
	assert.ok(rec.includes('id={g.match_key ? `game-${g.match_key}` : undefined}'));
	const link = readFileSync(new URL('lib/components/finale/SetLink.svelte', SRC), 'utf8');
	assert.ok(link.includes('momentAction(tapeState, auth.authed)') && link.includes('gameLink('));
	const bodies = readFileSync(new URL('lib/components/finale/GroupBodies.svelte', SRC), 'utf8');
	assert.ok(!/signed in to watch/i.test(bodies), 'no false "sign in to watch" claim');
	assert.ok(bodies.includes('{#if h?.moments?.length}'), 'the strip hides when the server sends no moments');
});
