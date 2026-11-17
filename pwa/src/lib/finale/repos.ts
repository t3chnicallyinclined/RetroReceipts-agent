// The owner's PUBLIC repos that matter to these players, for the finale's "Check out the code" block. Exactly these five,
// on purpose: nothing private, no star counts or other live numbers (a test pins the URLs and that no other repo appears).
export interface Repo {
	name: string;
	line: string;
	url: string;
}
export const REPOS_LEAD = 'Retro Receipts is a side project, and a lot of it is open. If you build things too, have a look.';
export const REPOS: readonly Repo[] = [
	{ name: 'Retro Receipts app and site', line: 'The desktop app and this website.', url: 'https://github.com/t3chnicallyinclined/RetroReceipts-agent' },
	{ name: 'SUPERGUN downloads', line: 'Signed Windows downloads of SUPERGUN and release notes.', url: 'https://github.com/t3chnicallyinclined/supergun-releases' },
	{ name: 'MvC2 Skin Studio', line: 'Edit character sprites and colors for your own copy of the game.', url: 'https://github.com/t3chnicallyinclined/mvc2-skin-studio' },
	{ name: 'NOBD stick firmware', line: 'Firmware for the NOBD fight stick.', url: 'https://github.com/t3chnicallyinclined/GP2040-CE-NOBD' },
	{ name: 'Finger gap tester', line: 'Measure how evenly your buttons press together.', url: 'https://github.com/t3chnicallyinclined/finger-gap-tester' }
];
export const SUPERGUN_FEEDBACK = 'Tried SUPERGUN? Tell us what worked and what broke in the SUPERGUN Discord, or report a problem from the pause menu in the app.';
export const CLOSE_FEEDBACK = 'Ideas, bugs or suggestions? Tell us in the NOBD Discord.';
