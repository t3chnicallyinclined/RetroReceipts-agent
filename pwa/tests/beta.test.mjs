// The finale as the open season's landing page: the strip, the "{label} is live" block, live numbers, early leaders, /season.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const B = await import('$lib/finale/beta');
const rd = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8').replace(/\r/g, '');
const base = { authed: false, known: false, registered: false, busy: false, justJoined: false, refusal: null };

test('join state: signed out, signed in not joined, joined, 403, busy, and not-yet-known', () => {
	assert.equal(B.joinState({ ...base }), 'signin');
	assert.equal(B.joinState({ ...base, authed: true, known: true }), 'join');
	assert.equal(B.joinState({ ...base, authed: true, known: true, busy: true }), 'busy');
	assert.equal(B.joinState({ ...base, authed: true, known: true, registered: true }), 'in');
	assert.equal(B.joinState({ ...base, authed: true, known: true, justJoined: true, registered: true }), 'in');
	assert.equal(B.joinState({ ...base, authed: true, known: true, refusal: 'signin' }), 'resign', 'a 403: sign in again');
	assert.equal(B.joinState({ ...base, authed: true }), 'unknown', 'never offer Join before the status is read');
	assert.equal(B.joinState({ ...base, authed: true, known: true, refusal: 'error' }), 'join', 'another error leaves Join available');
	assert.equal(B.RESIGN_LINE, 'Please sign in with Steam once more.');
	assert.equal(B.IN_LINE, "You're in ✓");
});

test('copy: the call to action, the block and the hype line', () => {
	assert.equal(B.BLOCK_HEAD('Beta Season 1'), 'Beta Season 1 is live today');
	assert.equal(B.STRIP_SUB, 'New season. Everyone starts fresh at 1000.');
	assert.equal(B.BLOCK_LEAD, 'New season, clean slate. Everyone starts at 1000, five ranked games gets you a rank, and the board is open to anyone running the app.');
	assert.equal(B.STEP_PLAY, "Play five ranked games for a rank. Your games are recorded and you're on the board.");
	assert.equal(B.joinedLine(41), '41 joined');
	assert.equal(B.joinedLine(1234), '1,234 joined');
	assert.equal(B.joinedLine(0), '', 'no count: nothing');
	assert.equal(B.joinedLine(undefined), '');
	assert.equal(B.FEEDBACK_ASK, 'Suggestions or feedback for the new season?');
	assert.equal(B.FEEDBACK_DISCORD, 'Tell us in the NOBD Discord');
	assert.equal(B.FEEDBACK_IDEA, 'Share an idea');
	assert.equal(B.ANNOUNCE_LINE('Beta Season 1'), 'Beta Season 1 is live today. Join now');
});

test('the big button: one label and one action per state', () => {
	const L = 'Beta Season 1';
	assert.deepEqual(B.ctaFor('signin', L), { label: 'Sign in and join Beta Season 1', act: 'signin', disabled: false });
	assert.deepEqual(B.ctaFor('resign', L), { label: 'Sign in and join Beta Season 1', act: 'signin', disabled: false });
	assert.deepEqual(B.ctaFor('join', L), { label: 'Join Beta Season 1', act: 'join', disabled: false });
	assert.deepEqual(B.ctaFor('busy', L), { label: 'Joining…', act: 'join', disabled: true });
	assert.deepEqual(B.ctaFor('in', L), { label: "You're in ✓ · See the live ladder", act: 'ladder', disabled: false });
	assert.equal(B.ctaFor('unknown', L).disabled, true, 'never offer Join before the status is read');
});

test('truthful: joining is never said to be needed for the board or to unlock anything', () => {
	assert.equal(B.JOIN_NOTE, 'Joining adds you to the sign-up count and puts the Registered mark on your profile.');
	for (const f of ['lib/finale/beta.ts', 'lib/components/finale/BetaBlock.svelte', 'lib/components/finale/BetaStrip.svelte']) {
		const s = rd(f).replace(/\/\/.*$/gm, '');
		assert.ok(!/reward|unlock|exclusive|required to (play|be on)|must (join|register)|only (registered|players who joined)|to appear on the board/i.test(s), `${f} over-promises`);
	}
});

test('live numbers: each is hidden when absent or zero', () => {
	assert.deepEqual(B.liveNumbers({ joined: 41, games: 1200, onBoard: 29 }), [{ n: 41, label: 'joined' }, { n: 1200, label: 'games played so far' }, { n: 29, label: 'on the board' }]);
	assert.deepEqual(B.liveNumbers({ joined: 0, games: undefined, onBoard: 5 }), [{ n: 5, label: 'on the board' }]);
	assert.deepEqual(B.liveNumbers({}), []);
	assert.deepEqual(B.liveNumbers({ joined: -3, games: NaN, onBoard: 0 }), []);
});

test('early leaders: the top three placed players, or the empty line', () => {
	const p = (n) => ({ steamid: `7656${n}`, name: `P${n}`, rating: 1000 + n, wins: 1, losses: 0 });
	assert.deepEqual(B.earlyLeaders([p(1), p(2), p(3), p(4)]).map((x) => x.name), ['P1', 'P2', 'P3']);
	assert.equal(B.earlyLeaders([]).length, 0);
	assert.equal(B.earlyLeaders(undefined).length, 0);
	assert.equal(B.earlyLeaders([{ steamid: '', name: 'x' }, p(2)]).length, 1, 'an entry with no id is dropped');
	assert.equal(B.NO_LEADERS, 'Nobody has a rank yet. Be the first.');
});

const table = { current: 'beta-s1', seasons: [{ id: 'season0', label: 'Season Zero', start_ms: 0, end_ms: 1000 }, { id: 'beta-s1', label: 'Beta Season 1', start_ms: 1000, end_ms: null }] };

test('/season lands on the latest finished season and keeps a safe hash', () => {
	assert.equal(B.latestFinished(table, 5000), 'season0');
	assert.equal(B.latestFinished(table, 500), null, 'a season that has not ended yet is not finished');
	assert.equal(B.latestFinished({ current: 'a', seasons: [{ id: 'a', label: 'A', start_ms: 0, end_ms: null }] }, 5000), null);
	assert.equal(B.latestFinished(null, 5000), null);
	const two = { current: 'c', seasons: [{ id: 'a', label: 'A', start_ms: 0, end_ms: 10 }, { id: 'b', label: 'B', start_ms: 10, end_ms: 20 }, { id: 'c', label: 'C', start_ms: 20, end_ms: null }] };
	assert.equal(B.latestFinished(two, 1000), 'b');
	assert.equal(B.seasonLandingPath('/app', table, 5000, '#next'), '/app/season/season0#next');
	assert.equal(B.seasonLandingPath('/app', table, 5000, ''), '/app/season/season0');
	assert.equal(B.seasonLandingPath('/app', table, 5000, '#<script>'), '/app/season/season0', 'an odd hash is dropped');
	assert.equal(B.seasonLandingPath('/app', null, 5000, '#next'), null);
});

test('wiring: the strip under the hero, the block after the record section, #next is the block, nav entries, announcement link, /season route', () => {
	const page = rd('routes/season/[id]/+page.svelte');
	assert.ok(page.indexOf('<BetaStrip') > page.indexOf('<FinaleBanner') && page.indexOf('<BetaStrip') < page.indexOf('<!-- the open season'), 'the strip sits right under the hero');
	assert.ok(page.indexOf('<BetaBlock') > page.indexOf('<YourRecord') && page.indexOf('<BetaBlock') < page.indexOf('<!-- explore the season -->'), 'directly after the record section');
	assert.ok(page.includes("if (target === 'next') target = next ? 'beta' : 'whats-next'"), '#next lands on the block');
	assert.equal((page.match(/\{ id: 'beta', title:/g) ?? []).length, 2, 'one entry in the Jump-to sheet and one in the wide nav');
	assert.ok(page.includes('id="whats-next"') && !page.includes('id="next"'), "What's next keeps a distinct id");
	assert.ok(!page.includes('<span class="rail">Open now</span>'), "the old What's next card is gone");
	assert.ok(page.includes('{#if !next}'), 'the "More seasons" card remains only when nothing is open');
	assert.ok(page.includes('fetchSummary(open)') && page.includes('fetchLadder(open)'));
	const strip = rd('lib/components/finale/BetaStrip.svelte');
	assert.ok(strip.includes('BLOCK_HEAD(label)') && strip.includes('STRIP_SUB') && strip.includes('joinedLine(seasonReg.count)') && strip.includes('seasonReg.join()') && strip.includes('label="Get the app"') && strip.includes('class="bigjoin"'));
	const block = rd('lib/components/finale/BetaBlock.svelte');
	for (const t of ['Get the app', 'Join {label}', '<b>Play</b>', 'Early leaders', 'See the live ladder', '<GetTheApp showSignin={false} />', 'seasonReg.join()', 'class="bigjoin"', '{FEEDBACK_ASK}', '{FEEDBACK_DISCORD}', '{FEEDBACK_IDEA}', "onjump('feedback')", 'target="_blank" rel="noopener"']) assert.ok(block.includes(t), t);
	assert.ok(block.includes('{#if nums.length}') && block.includes('{#if top.length}'), 'numbers and leaders hide when empty');
	const ann = rd('lib/components/SeasonAnnouncement.svelte');
	assert.ok(ann.includes('href="{base}/season#next"><b>{ANNOUNCE_LINE(a.open.label)}</b></a>'));
	assert.ok(existsSync(new URL('../src/routes/season/+page.svelte', import.meta.url)));
	const route = rd('routes/season/+page.svelte');
	assert.ok(route.includes('seasonLandingPath(base, seasons.table, Date.now(), location.hash)') && route.includes('replaceState: true'));
});

test('Steam-only copy: the app is for MvC2 on Steam; SUPERGUN is the pointer, and nothing claims other versions', () => {
	assert.equal(B.STEAM_ONLY_LINE, 'For MvC2 on Steam (Marvel vs. Capcom Fighting Collection) on Windows, Linux and Steam Deck.');
	assert.equal(B.STEP1_LINE, 'The app works with MvC2 in the Marvel vs. Capcom Fighting Collection on Steam, on Windows, Linux and Steam Deck.');
	assert.equal(B.SUPERGUN_POINTER_BEFORE + 'SUPERGUN' + B.SUPERGUN_POINTER_AFTER, 'Playing another version, or want PC and browser players in the same lobby? That\u2019s where SUPERGUN is headed.');
	const get = rd('lib/components/GetTheApp.svelte');
	assert.ok(get.includes('{STEAM_ONLY_LINE}') && get.includes('{LINUX_CMD}'), 'the line sits with the download; the Linux command stays');
	assert.ok(get.indexOf('{STEAM_ONLY_LINE}') > get.indexOf('class={secondary'), 'under the Download button');
	const block = rd('lib/components/finale/BetaBlock.svelte');
	assert.ok(block.includes('{STEP1_LINE}') && block.includes('href="#whats-next"') && block.includes("onjump('whats-next')"));
	assert.ok(block.indexOf('{SUPERGUN_POINTER_BEFORE}') > block.indexOf('</ol>'), 'after the steps');
	const next = rd('lib/finale/nextCopy.ts');
	assert.ok(next.includes('runs from your own copy of the game on Steam') && next.includes('PC and browser players in the same lobbies'));
	assert.ok(rd('lib/components/DownloadAgent.svelte').includes('on the Steam version.'));
	// no copy claims support for another version of the game
	for (const f of ['lib/finale/beta.ts', 'lib/finale/nextCopy.ts', 'lib/components/GetTheApp.svelte', 'lib/components/finale/BetaBlock.svelte', 'lib/components/finale/SupergunBlock.svelte']) {
		const s = rd(f).replace(/\/\/.*$/gm, '');
		assert.ok(!/(works|runs|supports?|plays?) (with|on) (fightcade|flycast|dreamcast|console|emulat|ps[2-5]|xbox|switch)/i.test(s), `${f} claims another version`);
		assert.ok(!/(fightcade|flycast|dreamcast).{0,40}(supported|works|compatible)/i.test(s), `${f} claims another version`);
	}
});
