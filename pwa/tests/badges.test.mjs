// Season badges: shaped from the server's `badges` (72d3b58), strongest first, collapsed for phones, hidden when absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const G = await import('$lib/finale/badges');
const { normalizeMine } = await import('$lib/finale/mine');
const rd = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8').replace(/\r/g, '');

// a fixture of the server's shape: ducvader-like (champion + tier + tester + played), in the server's own order
const SERVER = [
	{ season: 'season0', kind: 'champion', label: 'Champion of Season Zero', rank: 1 },
	{ season: 'season0', kind: 'tier', label: 'Galactus', rank: null },
	{ season: 'season0', kind: 'tester', label: 'Ran the app in Season Zero', rank: null },
	{ season: 'season0', kind: 'played', label: 'Played Season Zero', rank: null }
];

test('shaping: kinds and labels kept, junk dropped, duplicates collapsed', () => {
	const out = G.normalizeBadges([...SERVER, SERVER[0], null, 'x', { kind: 'champion', label: 'x' }, { season: 's', kind: 'wizard', label: 'x' }, { season: 's', kind: 'played', label: '  ' }, { season: 's', kind: 'podium', label: '2nd place in S', rank: 2.5 }]);
	assert.deepEqual(out.map((b) => b.kind), ['champion', 'podium', 'tier', 'tester', 'played']);
	assert.equal(out.find((b) => b.kind === 'podium').rank, null, 'a non-integer place is not a place');
	assert.equal(G.normalizeBadges(undefined).length, 0);
	assert.equal(G.normalizeBadges({}).length, 0);
	assert.equal(G.normalizeBadges([]).length, 0);
});

test('ordering: strongest first whatever the server order, then season, then place', () => {
	const shuffled = [...SERVER].reverse();
	assert.deepEqual(G.normalizeBadges(shuffled).map((b) => b.kind), ['champion', 'tier', 'tester', 'played']);
	const all = G.normalizeBadges([
		{ season: 'a', kind: 'played', label: 'Played A', rank: null }, { season: 'a', kind: 'made_rank', label: 'Made rank without the app', rank: 5 },
		{ season: 'a', kind: 'top8', label: 'Top 8 in A', rank: 6 }, { season: 'a', kind: 'podium', label: '3rd place in A', rank: 3 }, { season: 'a', kind: 'tester', label: 'Ran the app in A', rank: null },
		{ season: 'a', kind: 'tier', label: 'Gold', rank: null }, { season: 'a', kind: 'champion', label: 'Champion of A', rank: 1 }
	]);
	assert.deepEqual(all.map((b) => b.kind), ['champion', 'podium', 'top8', 'tier', 'made_rank', 'tester', 'played']);
	// two seasons: the same kind sorts by season
	const two = G.normalizeBadges([{ season: 'b', kind: 'played', label: 'Played B' }, { season: 'a', kind: 'played', label: 'Played A' }]);
	assert.deepEqual(two.map((b) => b.season), ['a', 'b']);
});

test('the +N collapse: phones show fewer, nothing is lost', () => {
	const list = G.normalizeBadges(SERVER);
	assert.deepEqual([G.collapseBadges(list, 3).shown.length, G.collapseBadges(list, 3).more], [3, 1]);
	assert.deepEqual([G.collapseBadges(list, 6).shown.length, G.collapseBadges(list, 6).more], [4, 0]);
	assert.deepEqual([G.collapseBadges(list, 1).shown.map((b) => b.kind), G.collapseBadges(list, 1).more], [['champion'], 3]);
	assert.equal(G.collapseBadges(list, 0).shown.length, 1, 'never zero');
	assert.deepEqual(G.collapseBadges([], 3), { shown: [], more: 0 });
});

test('gold is the champion alone; every badge has a one-line legend', () => {
	for (const k of G.BADGE_ORDER) assert.equal(G.isGold({ kind: k }), k === 'champion');
	for (const k of G.BADGE_ORDER) assert.ok(G.BADGE_LEGEND[k].length > 10 && G.BADGE_LEGEND[k].endsWith('.'));
	assert.equal(G.badgeTitle({ kind: 'tester', label: 'Ran the app in Season Zero' }), 'Ran the app in Season Zero. Ran the app during the season.');
	const css = rd('lib/components/finale/BadgeRow.svelte');
	const style = css.slice(css.indexOf('<style>')).replace(/\.bd\.gold \{[^}]*\}/, '').replace(/:focus-visible[^}]*\}/g, '');
	assert.ok(!/--gold/.test(style), 'gold only on the champion rule (and the focus ring)');
	assert.ok(css.includes('.bd.gold {'));
});

test('this season only, for the finale card', () => {
	const list = G.normalizeBadges([...SERVER, { season: 'beta-s1', kind: 'played', label: 'Played Beta Season 1', rank: null }]);
	assert.deepEqual(G.badgesFor(list, 'season0').map((b) => b.kind), ['champion', 'tier', 'tester', 'played']);
	assert.equal(G.badgesFor(list, 'nope').length, 0);
	assert.equal(G.badgesFor(undefined, 'season0').length, 0);
});

test('Mine carries the badges; a server without the field gives none', () => {
	assert.equal(normalizeMine({ found: true, wins: 3, losses: 1, badges: SERVER }).badges.length, 4);
	assert.deepEqual(normalizeMine({ found: true, wins: 3, losses: 1 }).badges, []);
	assert.deepEqual(normalizeMine({ found: true, wins: 3, losses: 1, badges: 'nope' }).badges, []);
});

test('wiring: profile header row, the record card row, hidden when absent, nothing computed client-side', () => {
	const page = rd('routes/u/[steamid]/+page.svelte');
	assert.ok(page.includes('{#if badgeList.length}<BadgeRow badges={badgeList} phone={3} />{/if}') && page.includes('normalizeBadges(p?.badges)'));
	const card = rd('lib/components/finale/SeasonCard.svelte');
	assert.ok(card.includes('{#if myBadges.length}') && card.includes('Your {label} badges') && card.includes('badgesFor(mine?.badges, season)'));
	const row = rd('lib/components/finale/BadgeRow.svelte');
	assert.ok(row.includes('{#if badges.length}') && row.includes('+{view.more}') && row.includes('What do these mean?'));
	const lib = rd('lib/finale/badges.ts').replace(/\/\/.*$/gm, '');
	assert.ok(!/rating|wins|losses|steamid/.test(lib), 'no rank, rating or place is computed here: badges come from the server');
});
