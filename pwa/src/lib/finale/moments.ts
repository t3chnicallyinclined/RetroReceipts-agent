// Season finale: "link the stats to the replays". A MOMENT is one real game the season's numbers came from (the
// longest game, the biggest comeback...). The server (highlights `moments[]`, plus match_key/tape_state on the upset,
// the combo and the season card's best win) names the game and says what state its tape is in.
//
// WHAT PLAYBACK REALLY NEEDS (checked against the live site, 2026-11-17, see the report):
//   state "ready"    a hot tape: anyone can open it, signed in or not. The viewer confirms they own the game once
//                    (the replay sheet asks); that is the art-pack rule and it is unchanged.
//   state "archived" the tape is in cold storage. Watching needs it pulled back first, and that pull is an
//                    account action (POST /rr/tape/request): signed out there is no way to start it.
//   state "pending"  the upload has not landed yet.  "none": no tape was ever recorded.
//   state "legacy"   recorded before tape v2: the engine cannot open it, so it is never offered as a replay.
// So "Watch the replay" is offered ONLY for "ready"; every other state offers "See the set" (always works) with one
// quiet line saying why. Nothing here weakens the sign-in or ownership rules.
// (self-contained on purpose: highlights.ts and derive.ts import from here, so this file imports neither)
import type { PlayerRef } from './highlights';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
function playerRef(v: unknown): PlayerRef | null {
	const o = obj(v);
	const steamid = text(o?.steamid);
	const name = text(o?.name);
	return o && steamid && name ? { steamid, name, avatar: text(o.avatar), cc: text(o.cc) } : null;
}
const durText = (s: number): string => {
	const t = Math.round(s);
	const m = Math.floor(t / 60);
	return m ? `${m} min ${t % 60} s` : `${t} s`;
};

export type TapeState = 'ready' | 'pending' | 'archived' | 'none' | 'legacy';
export const TAPE_STATES: readonly TapeState[] = ['ready', 'pending', 'archived', 'none', 'legacy'];

/** A tape state string from the server, or undefined when it did not send one (older server). A boolean is not a state. */
export function tapeStateOf(v: unknown): TapeState | undefined {
	return typeof v === 'string' && (TAPE_STATES as readonly string[]).includes(v) ? (v as TapeState) : undefined;
}

export type MomentKind = 'longest_game' | 'biggest_comeback' | 'biggest_combo' | 'biggest_upset' | 'perfect';
/** the order the strip shows them in */
// fastest_game is deliberately NOT a kind here: on real data it is a 10 s row from an old agent sitting on the server's
// 10 s floor with several ties, and short durations read as a measurement artefact. A server that sends it is ignored.
export const MOMENT_ORDER: readonly MomentKind[] = ['longest_game', 'biggest_combo', 'biggest_comeback', 'biggest_upset', 'perfect'];

export interface Moment {
	kind: MomentKind;
	/** the server's own label, used only if a kind has no title here */
	label?: string;
	value: number;
	unit?: string;
	matchKey: string;
	sessionId: string;
	matchIndex?: number;
	durationS?: number;
	tape?: TapeState;
	winner: PlayerRef | null;
	/** only for the kinds that name both players; null when the server leaves the loser out */
	loser: PlayerRef | null;
	wteam: number[];
	lteam: number[];
}

const teamIds = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 256).slice(0, 3) : []);

/** The server's `moments[]` -> typed, ordered, deduplicated by kind. A malformed entry is dropped, never guessed at. */
export function normalizeMoments(v: unknown): Moment[] {
	if (!Array.isArray(v)) return [];
	const byKind = new Map<MomentKind, Moment>();
	for (const e of v) {
		const o = obj(e);
		if (!o) continue;
		const kind = o.kind as MomentKind;
		if (!MOMENT_ORDER.includes(kind) || byKind.has(kind)) continue;
		const matchKey = typeof o.match_key === 'string' ? o.match_key : '';
		const sessionId = typeof o.session_id === 'string' ? o.session_id : '';
		const value = pos(o.value);
		if (!matchKey || !sessionId || value === undefined) continue;
		byKind.set(kind, {
			kind,
			label: typeof o.label === 'string' ? o.label : undefined,
			value,
			unit: typeof o.unit === 'string' ? o.unit : undefined,
			matchKey,
			sessionId,
			matchIndex: typeof o.match_index === 'number' ? o.match_index : undefined,
			durationS: pos(o.duration_s),
			tape: tapeStateOf(o.tape),
			winner: playerRef(o.winner),
			loser: playerRef(o.loser),
			wteam: teamIds(o.wteam),
			lteam: teamIds(o.lteam)
		});
	}
	return MOMENT_ORDER.flatMap((k) => (byKind.has(k) ? [byKind.get(k) as Moment] : []));
}

const TITLES: Record<MomentKind, string> = {
	longest_game: 'Longest game',
	biggest_comeback: 'Comeback of the season',
	biggest_combo: 'Biggest combo',
	biggest_upset: 'Biggest upset',
	perfect: 'Perfect win over the top opponent'
};
export const momentTitle = (m: Pick<Moment, 'kind' | 'label'>): string => TITLES[m.kind] ?? m.label ?? 'Moment';

const nf = (n: number) => Math.round(n).toLocaleString('en-US');

/** The figure for a moment: "5 min 33 s", "148 hits", "681 points apart". */
export function momentFigure(m: Pick<Moment, 'kind' | 'value'>): string {
	switch (m.kind) {
		case 'longest_game':
			return durText(m.value);
		case 'biggest_combo':
			return `${nf(m.value)} ${m.value === 1 ? 'hit' : 'hits'}`;
		case 'biggest_upset':
			return `${nf(m.value)} points apart`;
		case 'biggest_comeback':
			// the server's value is a count of CHARACTERS down (the data only has 1 and 2), never health
			return m.value === 1 ? 'From one character down' : m.value === 2 ? 'From two characters down' : `From ${nf(m.value)} characters down`;
		case 'perfect':
			return `over a ${nf(m.value)}-rated player`;
	}
}

/** The one-line caption under the figure: who, in the server's words. Winner-only kinds never name the loser. */
export function momentWho(m: Pick<Moment, 'winner' | 'loser'>): string {
	if (m.winner && m.loser) return `${m.winner.name} beat ${m.loser.name}`;
	return m.winner ? m.winner.name : '';
}

/** `/r/set/<session>?game=<match_key>`; `p` pins the receipt to the winner's seat so a shared link reads the same for everyone. */
export function gameLink(base: string, sessionId: string, matchKey?: string, perspective?: string): string {
	const q: string[] = [];
	if (matchKey) q.push(`game=${encodeURIComponent(matchKey)}`);
	if (perspective && /^\d{17}$/.test(perspective)) q.push(`p=${perspective}`);
	return `${base}/r/set/${encodeURIComponent(sessionId)}${q.length ? `?${q.join('&')}` : ''}`;
}

export interface MomentAction {
	/** "watch" = the link opens the replay itself; "set" = it opens the set page at that game */
	kind: 'watch' | 'set';
	label: string;
	/** a quiet line saying why there is no Watch button; empty when nothing needs saying */
	reason: string;
}

/**
 * One honest primary action per moment. `state` undefined = the server did not say (an older server): the plain
 * set link, no claim either way.
 */
export function momentAction(state: TapeState | undefined, signedIn: boolean): MomentAction {
	switch (state) {
		case 'ready':
			return { kind: 'watch', label: 'Watch the replay', reason: '' };
		case 'archived':
			return { kind: 'set', label: 'See the set', reason: signedIn ? 'This replay is in the archive. Open the set to request it.' : 'This replay is in the archive. Sign in to request it.' };
		case 'pending':
			return { kind: 'set', label: 'See the set', reason: 'This replay is still being uploaded.' };
		case 'none':
			return { kind: 'set', label: 'See the set', reason: 'No replay was recorded for this game.' };
		case 'legacy':
			return { kind: 'set', label: 'See the set', reason: "Recorded by an older version of the app; this replay can't be played." };
		default:
			return { kind: 'set', label: 'See the set', reason: '' };
	}
}

/** The moment of a kind, if the server sent it. */
export const momentOf = (ms: Moment[] | undefined, kind: MomentKind): Moment | undefined => ms?.find((m) => m.kind === kind);

/** Index of the game with this key in a set's games (the set page's `?game=`), or -1. */
export function gameIndex(games: { match_key?: string }[] | undefined, key: string | null | undefined): number {
	if (!key || !games) return -1;
	return games.findIndex((g) => g.match_key === key);
}
