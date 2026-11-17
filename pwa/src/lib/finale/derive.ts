// Season finale: pure display shaping (no DOM, no stores), unit-tested. Formatting, group summaries, the glance
// tiles, notable mentions, tier rows. Every function drops what it cannot say honestly.

import { RANK_TIERS } from '../ranks';
import { charName } from '../chars';
import { dayLabel, type Summary } from '../seasonFinale';
import type { Highlights, Mention, MentionBoard, Valued } from './highlights';

// ── small formatters ────────────────────────────────────────────────────────────────────────────

export const nf = (n: number): string => Math.round(n).toLocaleString('en-US');
export const nf1 = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('en-US');

export function ordinal(n: number): string {
	const m100 = n % 100;
	if (m100 >= 11 && m100 <= 13) return `${n}th`;
	return `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;
}

/** A match timestamp in epoch ms. Old rows carry SECONDS (< 1e11): scale those up. 0 or junk -> undefined. */
export function toMs(ts: unknown): number | undefined {
	if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return undefined;
	return ts < 1e11 ? ts * 1000 : ts;
}

/** A date for display. Accepts "YYYY-MM-DD" or a timestamp; a date before 2020 is never printed (no "1970"). */
export function dateText(v: unknown): string | undefined {
	if (typeof v === 'string') {
		const d = dayLabel(v);
		return d && Number(v.slice(0, 4)) >= 2020 ? d : undefined;
	}
	const ms = toMs(v);
	if (ms === undefined || ms < 1577836800000) return undefined;
	return dayLabel(new Date(ms).toISOString().slice(0, 10));
}

/** 94 -> "1 min 34 s" */
export function durText(s: number): string {
	const t = Math.round(s);
	const m = Math.floor(t / 60);
	return m ? `${m} min ${t % 60} s` : `${t} s`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLong = (m: string): string => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;
export const monthShort = (m: string): string => monthLong(m).slice(0, 3);
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** share of ranked teams: one decimal under 1%, "<0.1%" under 0.05% */
export function shareText(p: number): string {
	if (p < 0.05) return '<0.1%';
	if (p < 1) return `${(Math.round(p * 10) / 10).toFixed(1)}%`;
	return `${Math.round(p)}%`;
}

/** "about 21:00 your time" for a UTC hour, given the viewer's offset in minutes (default: this device) */
export function localHourText(hourUtc: number, offsetMin: number = -new Date().getTimezoneOffset()): string {
	const h = (((hourUtc * 60 + offsetMin) / 60) % 24 + 24) % 24;
	return `${String(Math.floor(h)).padStart(2, '0')}:00`;
}

const regionNames = (() => {
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' });
	} catch {
		return null;
	}
})();
export const countryName = (cc: string): string => {
	try {
		return regionNames?.of(cc.toUpperCase()) ?? cc.toUpperCase();
	} catch {
		return cc.toUpperCase();
	}
};

// ── tiers ───────────────────────────────────────────────────────────────────────────────────────

export const TIER_COLOR: Record<string, string> = {
	iron: '#a7adb8', bronze: '#d59a5f', silver: '#cdd7e4', gold: '#f2c74a', vibranium: '#b98cff',
	adamantium: '#9fd4ef', herald: '#ffb35c', infinity: '#ffe9b0', galactus: '#ff7ae0'
};

export interface TierRow {
	slug: string;
	name: string;
	count: number;
	pct: number;
	lo: number;
	hi: number;
}
/** top-down (Galactus to Iron), only tiers with players; pct is of the placed players */
export function tierRows(h: Highlights, which: 'now' | 'reached'): TierRow[] {
	const t = h.tiers;
	if (!t || !t.placed) return [];
	const src = which === 'now' ? t.now : t.reached;
	return [...RANK_TIERS]
		.reverse()
		.flatMap((tier) => {
			const slug = tier.n.toLowerCase();
			const count = src[slug] ?? 0;
			return count > 0 ? [{ slug, name: tier.n, count, pct: Math.round((count * 100) / t.placed), lo: tier.lo, hi: tier.hi }] : [];
		});
}

export function tierSentence(r: TierRow, which: 'now' | 'reached', placed: number): string {
	if (which === 'reached') return `${r.name} or higher: ${nf(r.count)} players got there at some point in the season, ${r.pct}% of the ${nf(placed)} ranked.`;
	const band = r.hi === Infinity ? `${r.lo}+` : r.slug === 'iron' ? `under ${r.hi}` : `rating ${r.lo} to ${r.hi - 1}`;
	return `${r.name} (${band}): ${nf(r.count)} players finished here, ${r.pct}% of the ${nf(placed)} ranked.`;
}

// ── notable mentions ────────────────────────────────────────────────────────────────────────────

/** Noun phrases (no "Most": the #rank tag carries the ranking). Unknown keys keep the server's label. */
const BOARD_LABEL: Record<string, string> = {
	games: 'Games played',
	wins: 'Wins',
	streak: 'Longest win streak',
	peak: 'Highest rating reached',
	perfects: 'Perfects',
	comebacks: 'Comebacks',
	giant_kills: 'Wins over players rated 200+ above',
	climb: 'Rating gained',
	rivalry_most: 'Games in the most played rivalry',
	rivalry_even: 'Games in the most even rivalry',
	sweeps: '10–0 set sweeps'
};
/** boards that are facts about the player, not a leaderboard place: SERVER sends rank 1 for rivalries, the page shows no #rank */
const UNRANKED = new Set(['rivalry_most', 'rivalry_even', 'sweeps']);

export interface MentionChip {
	key: string;
	value: string;
	label: string;
	rank: number | null;
}
export interface MentionView {
	mention: Mention;
	chips: MentionChip[];
}
export function mentionViews(h: Highlights | null): MentionView[] {
	return (h?.mentions ?? []).slice(0, 4).flatMap((m) => {
		const chips = m.boards.map((b: MentionBoard) => ({
			key: b.key,
			value: typeof b.value === 'number' ? nf(b.value) : b.value.replace('-', '–'),
			// the server's label is the spec's noun phrase; an older "Most ..." label falls back to the table
			label: /^Most /.test(b.label) ? (BOARD_LABEL[b.key] ?? b.label.replace(/^Most /, '')) : b.label,
			rank: UNRANKED.has(b.key) ? null : b.rank
		}));
		// the #1s first, then #2/#3, then the facts
		chips.sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
		return chips.length ? [{ mention: m, chips }] : [];
	});
}

// ── glance, group summaries ─────────────────────────────────────────────────────────────────────

export interface GlanceTile {
	key: string;
	pre?: string;
	n: number;
	/** one decimal place */
	dec?: boolean;
	label: string;
}
export function glanceTiles(s: Summary | null, h: Highlights | null): GlanceTile[] {
	const t: GlanceTile[] = [];
	if (s?.games) t.push({ key: 'games', n: s.games, label: 'games' });
	// with a roster the counts are honest about who is who: players on the app, and everyone recorded on the ladder
	if (s?.roster) {
		t.push({ key: 'roster', n: s.roster, label: s.roster === 1 ? 'player on the app' : 'players on the app' });
		if (s.players) t.push({ key: 'players', n: s.players, label: 'on the ladder' });
	} else {
		if (s?.sets) t.push({ key: 'sets', n: s.sets, label: 'sets' });
		if (s?.players) t.push({ key: 'players', n: s.players, label: 'players' });
	}
	if (s?.placed) t.push({ key: 'placed', n: s.placed, label: 'finished with a rank' });
	if (h?.days) t.push({ key: 'days', n: h.days, label: h.everyDay ? 'days, a game on every one' : 'days' });
	if (h?.time?.hours) t.push({ key: 'hours', pre: 'At least', n: h.time.hours, dec: true, label: 'hours of play' });
	return t;
}

export type GroupId = 'season' | 'ladder' | 'played' | 'moments' | 'world';
const sentence = (parts: (string | undefined)[]): string | undefined => {
	const p = parts.filter((x): x is string => !!x);
	if (!p.length) return undefined;
	const s = p.join(', ');
	return `${s[0].toUpperCase()}${s.slice(1)}.`;
};
const bestStreak = (s: Summary | null, h: Highlights | null): number | undefined => h?.streaks?.top[0]?.value ?? s?.top.best_streak?.[0]?.value;

/** The one-line summary under a closed group's title. A part with no data drops out; no parts, no line. */
export function groupSummary(id: GroupId, s: Summary | null, h: Highlights | null): string | undefined {
	switch (id) {
		case 'season': {
			const bd = s?.busiestDay ? dateText(s.busiestDay.date) : undefined;
			return sentence([h?.days ? `${nf(h.days)} days of play` : undefined, bd ? `busiest day ${bd}` : undefined]);
		}
		case 'ladder': {
			const streak = bestStreak(s, h);
			const climb = h?.climbers?.rows[0]?.delta;
			return sentence([
				h?.tiers?.placed ? `${nf(h.tiers.placed)} ranked players` : undefined,
				streak ? `longest streak ${nf(streak)}` : undefined,
				climb ? `biggest climb +${nf(climb)}` : undefined
			]);
		}
		case 'played': {
			const top = h?.chars[0];
			return sentence([
				top ? `${charName(top.charId)} on ${shareText(top.share)} of teams` : undefined,
				h?.teams?.distinct ? `${nf(h.teams.distinct)} different teams` : undefined
			]);
		}
		case 'moments': {
			const parts = [
				h?.upset ? `a ${nf(h.upset.gap)}-point upset` : undefined,
				h?.rivalries?.most ? `a ${nf(h.rivalries.most.games)}-game rivalry` : undefined,
				h?.perfects?.total ? `${nf(h.perfects.total)} perfects` : undefined
			];
			return sentence(parts) ?? 'Perfects and comebacks.';
		}
		case 'world': {
			const w = h?.world;
			return sentence([w?.countries ? `${nf(w.countries)} countries` : undefined, w?.crossShare ? `${Math.round(w.crossShare)}% of games crossed a border` : undefined]);
		}
	}
}

// ── feats / streaks with the summary fallback ───────────────────────────────────────────────────

export function streakLeaders(s: Summary | null, h: Highlights | null): Valued[] {
	return h?.streaks?.top.length ? h.streaks.top : (s?.top.best_streak ?? []);
}
export function featLeaders(key: 'perfects' | 'comebacks', s: Summary | null, h: Highlights | null): Valued[] {
	return h?.[key]?.top.length ? h[key]!.top : (s?.top[key] ?? []);
}

// ── your season: card values ────────────────────────────────────────────────────────────────────

export interface SeasonCardData {
	place?: number;
	/** for a player who is not on the roster: where they would sit if everyone were listed */
	overallPlace?: number;
	of?: number;
	topPct?: number;
	opponent?: { name: string; steamid?: string; avatar?: string; games: number };
	bestWin?: { oppRating: number; gap: number; date?: string; sessionId?: string; tape: boolean };
	months: { m: string; games: number }[];
}

/** SERVER: the committed handler names the opponent `most_played_opponent` (flat); the spec says `opponent.player`. Accept both. */
export function normalizeSeasonCard(raw: unknown): SeasonCardData | null {
	const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
	if (!o) return null;
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
	const opp = (o.opponent ?? o.most_played_opponent) as Record<string, unknown> | undefined;
	const oppP = (opp && typeof opp.player === 'object' ? (opp.player as Record<string, unknown>) : opp) ?? undefined;
	const name = typeof oppP?.name === 'string' && oppP.name.trim() ? oppP.name : undefined;
	const games = num(opp?.games);
	const bw = o.best_win && typeof o.best_win === 'object' ? (o.best_win as Record<string, unknown>) : null;
	const months = (Array.isArray(o.months) ? o.months : []).flatMap((r) => {
		const x = r as Record<string, unknown>;
		return typeof x?.m === 'string' && /^\d{4}-\d{2}$/.test(x.m) && num(x.games) ? [{ m: x.m, games: x.games as number }] : [];
	});
	const sid = typeof bw?.session_id === 'string' && bw.session_id ? bw.session_id : undefined;
	return {
		place: num(o.place),
		overallPlace: num(o.overall_place),
		of: num(o.of),
		topPct: num(o.top_pct),
		opponent: name && games ? { name, steamid: typeof oppP?.steamid === 'string' ? oppP.steamid : undefined, avatar: typeof oppP?.avatar === 'string' ? oppP.avatar : undefined, games } : undefined,
		bestWin: bw && num(bw.opp_rating) && num(bw.gap) ? { oppRating: bw.opp_rating as number, gap: bw.gap as number, date: dateText(bw.date), sessionId: sid, tape: bw.tape === true || bw.tape === 'ready' } : undefined,
		months
	};
}

// ── the explore groups and which sub-sections have data ─────────────────────────────────────────

export const GROUPS: { id: GroupId; title: string }[] = [
	{ id: 'season', title: 'The season' },
	{ id: 'ladder', title: 'The ladder' },
	{ id: 'played', title: 'What got played' },
	{ id: 'moments', title: 'Moments and rivalries' },
	{ id: 'world', title: 'Around the world' }
];

export interface SubDef {
	id: string;
	title: string;
}
/** The sub-sections of a group that have something to show. A group with none is not rendered. */
export function presentSubs(id: GroupId, s: Summary | null, h: Highlights | null): SubDef[] {
	const out: SubDef[] = [];
	const add = (ok: unknown, sid: string, title: string) => {
		if (ok) out.push({ id: sid, title });
	};
	switch (id) {
		case 'season': {
			const facts = !!(s?.busiestDay || h?.peak || h?.time?.timedGames || h?.time?.medianS || h?.habits?.medianGames || h?.habits?.players100 || (s?.medianGames && (s.players ?? 0) > 1));
			add((s?.modes.length ?? 0) > 1 || facts || (h?.months.length ?? 0) > 1, 'totals', 'Games, time and growth');
			break;
		}
		case 'ladder':
			add(h?.tiers && tierRows(h, 'now').length, 'tiers', 'The shape of the ladder');
			add(streakLeaders(s, h).length, 'streaks', 'The longest run');
			add(h?.climbers?.rows.length, 'climbers', 'Biggest climbers');
			break;
		case 'played':
			add(h?.chars.length, 'characters', 'Who got played');
			add(h?.teams && (h.teams.top.length || h.teams.distinct), 'teams', 'The teams');
			break;
		case 'moments':
			add(h?.upset || h?.texture?.higherRatedWin || h?.texture?.firstHitWin, 'upsets', 'Favourites and giant-killers');
			add(h?.rivalries && (h.rivalries.most || h.rivalries.even || h.sets?.scores.length), 'rivalries', 'Rivalries and sets');
			add(featLeaders('perfects', s, h).length || featLeaders('comebacks', s, h).length || h?.combo, 'feats', 'Perfects, comebacks and combos');
			add(h?.trust, 'replays', 'Where to find replays');
			break;
		case 'world':
			add(h?.world?.top.length, 'countries', 'Players by country');
			break;
	}
	return out;
}

// ── the hero line ───────────────────────────────────────────────────────────────────────────────

export interface HeroBit {
	n: number;
	one: string;
	many: string;
	/** a second figure closing the same sentence ("..., against 530 opponents.") */
	tail?: { n: number; one: string; many: string };
}
/**
 * "{games} games. {days} days. {roster} players on the app, against {unlisted} opponents." The game total is the
 * headline (the roster count makes it more impressive, not less). A clause drops when its number is absent. A server
 * with no roster keeps the older line (games, sets, players, days).
 */
export function heroBits(s: Summary | null, h: Highlights | null): HeroBit[] {
	const out: HeroBit[] = [];
	if (s?.games) out.push({ n: s.games, one: 'game', many: 'games' });
	if (s?.roster) {
		if (h?.days) out.push({ n: h.days, one: 'day', many: 'days' });
		out.push({ n: s.roster, one: 'player on the app', many: 'players on the app', tail: s.unlisted ? { n: s.unlisted, one: 'opponent', many: 'opponents' } : undefined });
		return out;
	}
	if (s?.sets) out.push({ n: s.sets, one: 'set', many: 'sets' });
	if (s?.players) out.push({ n: s.players, one: 'player', many: 'players' });
	if (h?.days) out.push({ n: h.days, one: 'day', many: 'days' });
	return out;
}

/** One plain sentence for the numbers section: every game was recorded by one of the roster players. */
export function recordedBySentence(s: Summary | null): string | undefined {
	return s?.roster ? `Every one of those games was recorded by one of ${nf(s.roster)} ${s.roster === 1 ? 'player' : 'players'} running Retro Receipts.` : undefined;
}
/**
 * "That is about 545 games each": total games divided by the roster. Every game is recorded by at least one roster
 * player, so this attributes each game ONCE (no summing of per-player games, which would double-count games between
 * two roster players). Only with both numbers.
 */
export function gamesEachSentence(s: Summary | null): string | undefined {
	if (!s?.roster || !s.games) return undefined;
	return `That is about ${nf(Math.round(s.games / s.roster))} games each.`;
}
