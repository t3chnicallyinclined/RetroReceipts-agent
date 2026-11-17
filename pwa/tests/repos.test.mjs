// The finale's "Check out the code" block: exactly five public repos, nothing private, plus the feedback lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const R = await import('$lib/finale/repos');
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => { const f = d + '/' + n; return statSync(f).isDirectory() ? walk(f) : [f]; });

test('exactly the five public repos, with the agreed copy', () => {
	assert.deepEqual(R.REPOS.map((r) => r.url), [
		'https://github.com/t3chnicallyinclined/RetroReceipts-agent',
		'https://github.com/t3chnicallyinclined/supergun-releases',
		'https://github.com/t3chnicallyinclined/mvc2-skin-studio',
		'https://github.com/t3chnicallyinclined/GP2040-CE-NOBD',
		'https://github.com/t3chnicallyinclined/finger-gap-tester'
	]);
	assert.deepEqual(R.REPOS.map((r) => [r.name, r.line]), [
		['Retro Receipts app and site', 'The desktop app and this website.'],
		['SUPERGUN downloads', 'Signed Windows downloads of SUPERGUN and release notes.'],
		['MvC2 Skin Studio', 'Edit character sprites and colors for your own copy of the game.'],
		['NOBD stick firmware', 'Firmware for the NOBD fight stick.'],
		['Finger gap tester', 'Measure how evenly your buttons press together.']
	]);
	assert.equal(R.REPOS_LEAD, 'Retro Receipts is a side project, and a lot of it is open. If you build things too, have a look.');
	assert.equal(R.SUPERGUN_FEEDBACK, 'Tried SUPERGUN? Tell us what worked and what broke in the SUPERGUN Discord, or report a problem from the pause menu in the app.');
	assert.equal(R.CLOSE_FEEDBACK, 'Ideas, bugs or suggestions? Tell us in the NOBD Discord.');
});

test('the block renders those links in new tabs, and is wired into the page, the Jump-to sheet, the SUPERGUN block and the close', () => {
	const blk = readFileSync(SRC + 'lib/components/finale/CodeBlock.svelte', 'utf8');
	assert.ok(blk.includes('href={r.url} target="_blank" rel="noopener"') && blk.includes('{#each REPOS as r (r.url)}'));
	assert.ok(!/stargazers|stars|forks|api\.github/i.test(blk), 'no live numbers');
	const page = readFileSync(SRC + 'routes/season/[id]/+page.svelte', 'utf8');
	assert.ok(page.includes('<CodeBlock />') && page.includes("id: 'code', title: 'Check out the code'") && page.includes("'next', 'code'"));
	assert.ok(page.includes('{CLOSE_FEEDBACK}') && page.includes('Join the NOBD Discord'));
	assert.ok(page.indexOf('<SupergunBlock />') < page.indexOf('<CodeBlock />'), 'after the SUPERGUN block');
	assert.ok(readFileSync(SRC + 'lib/components/finale/SupergunBlock.svelte', 'utf8').includes('{SUPERGUN_FEEDBACK}'));
});

test('no private repo URL anywhere: every GitHub repo the app links is one of the public ones; the built bundle has no server repo', () => {
	const ok = new Set(['RetroReceipts-agent', 'supergun-releases', 'mvc2-skin-studio', 'GP2040-CE-NOBD', 'finger-gap-tester']);
	for (const f of walk(SRC).filter((x) => /\.(svelte|ts)$/.test(x))) {
		for (const m of readFileSync(f, 'utf8').matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) assert.ok(ok.has(m[2]), `${f} links ${m[0]}`);
	}
	const built = fileURLToPath(new URL('../build/_app', import.meta.url));
	if (existsSync(built)) {
		for (const f of walk(built).filter((x) => /\.(js|css|html)$/.test(x))) {
			const s = readFileSync(f, 'utf8');
			assert.ok(!/RetroReceipts-server/.test(s), `${f} mentions the server repo`);
			for (const m of s.matchAll(/github\.com\/[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)/g)) assert.ok(ok.has(m[1]), `${f} links ${m[0]}`);
		}
	}
});
