// What's next: the SUPERGUN block copy (fact-checked 2026-11-16, season-finale-design/WHATS-NEXT-COPY.md).
// Rules for editing: always "your own copy"; never say or imply the game is provided; "controller", not "stick";
// no Pi or board mentions; no claim that records, ratings or replays carry over; no dates; no performance numbers.

export const SUPERGUN_PITCH =
	"SUPERGUN is a side project we're testing: a menu and online-play layer for Marvel vs. Capcom 2 that runs from your own copy of the game on Steam. Plug in a controller, pick a team, and get into a match against friends or the lobby, with rollback netcode. It's an early beta and it's meant to grow into the next home for what this app does, so we'd like you to try it and tell us what breaks.";

export const SUPERGUN_POINTS: { label: string; line: string }[] = [
	{ label: 'What it is', line: 'A shell around MvC2 with quick play, a roster of the people you play with, and online lobbies.' },
	{ label: 'How it works', line: "It runs the game's own code from your own installed copy. It is not an emulator, and Steam can stay closed." },
	{ label: 'What you need', line: 'Windows 10/11, the Steam Marvel vs. Capcom Fighting Collection, and a controller.' },
	{ label: 'Where to get it', line: 'One small file from supergun.io. Nothing to install; delete it to remove it. Questions and bug reports go in the SUPERGUN Discord.' }
];

/** "Beta 0.4.29" is static copy and goes stale: left out on purpose. */
export const SUPERGUN_TODAY: string[] = [
	'Quick play: save a team and fight with one press.',
	'A roster of friends, plus a general lobby.',
	'Rollback online play, with invite codes.',
	'Hot swap, which rotates characters and assists every 5 to 10 seconds.',
	'Extra ways to play from your own copy: in a browser on your home network, and from a USB stick on another PC.'
];

export const SUPERGUN_COMING: string[] = [
	'A ranked ladder and seasons.',
	'Match history and replays.',
	'Bringing what this app does into SUPERGUN. How records carry over is not decided yet.'
];

/**
 * Two small, low-key "In testing" cards after the Beta Season 1 card. NO buttons and no links: nothing is linked from
 * the finale until the owner decides how the Live money cards should look. A card renders only when its body is
 * non-empty. Never use: bet, betting, gamble, odds, wager, win money, real money, cash, prize, payout, earn, crypto,
 * or anything about watching and backing a player.
 */
export interface AlsoCard {
	key: string;
	rail: string;
	title: string;
	body: (nextLabel?: string) => string;
	small?: string;
}
export const ALSO_COMING: AlsoCard[] = [
	{
		key: 'arcade',
		rail: 'In testing',
		title: 'Arcade cabinets are coming',
		body: (n) => `We're testing shared arcade cabinets: machines that host your set, referee it, and print the receipt automatically.${n ? ` More will come online as ${n} runs.` : ''}`
	},
	{
		key: 'quarters',
		rail: 'In testing',
		title: 'Quarter matches: put a quarter up',
		body: () => 'Challenge anyone to a first-to-3 for quarters, the free play coins every player starts with. No purchase, no cash-out, nothing to win but bragging rights and the receipt. Still early and still in testing.',
		small: 'Quarters are not tied to seasons, so your balance carries over.'
	}
];
