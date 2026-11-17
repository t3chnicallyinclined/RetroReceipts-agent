// Season finale: watch a replay RIGHT THERE. Every "Watch..." link on the finale opens the app-wide replay sheet
// (ReplaySheet / replayViewer) instead of navigating to the set page. This module builds the request and owns the
// `#watch=<match_key>` hash. The set page deep link (`?game=`) is unchanged and is the fallback for a plain click
// (middle-click, no script) because the links keep their href.
import { replayViewer, type ReplayRequest } from '$lib/replay/viewer.svelte';
import type { ReplayMeta } from '$lib/components/ReplayEmbed.svelte';
import { getAttest, ownsLocal } from '$lib/replay/pack';
import { auth } from '$lib/stores/auth.svelte';

export interface WatchInfo {
	matchKey: string;
	sessionId?: string;
	ts?: number;
	durationS?: number;
	winner?: { steamid: string; name: string; avatar?: string; cc?: string } | null;
	loser?: { steamid: string; name: string; avatar?: string; cc?: string } | null;
	wteam?: number[];
	lteam?: number[];
}

const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
/** `#watch=<key>` -> the key, or null (anything else, including a malformed or oversized key) */
export function parseWatchHash(hash: string | null | undefined): string | null {
	const m = /^#watch=([^&]*)$/.exec(hash ?? '');
	if (!m) return null;
	let k = m[1];
	try {
		k = decodeURIComponent(k);
	} catch {
		return null;
	}
	return KEY_RE.test(k) ? k : null;
}
export const watchHash = (key: string): string => `#watch=${encodeURIComponent(key)}`;

/** The sheet's chrome comes from the server's overlay on the tape read; this is only the fallback and the identity. */
export function watchRequest(info: WatchInfo, base: string, opts: { autoart?: boolean; hash?: boolean } = {}): ReplayRequest {
	const side = (p: WatchInfo['winner'], team?: number[]) => ({ steamid: p?.steamid ?? '', name: p?.name, avatar: p?.avatar, cc: p?.cc, team });
	const meta: ReplayMeta = {
		a: side(info.winner, info.wteam),
		b: side(info.loser, info.lteam),
		winner: 'a',
		mode: '',
		ts: info.ts ?? 0,
		durationS: info.durationS,
		sessionId: info.sessionId,
		key: info.matchKey
	};
	return {
		row: { match_key: info.matchKey, session_id: info.sessionId, ts: info.ts ?? 0 },
		meta,
		autoart: !!opts.autoart,
		fullSet: info.sessionId ? `${base}/r/set/${encodeURIComponent(info.sessionId)}?game=${encodeURIComponent(info.matchKey)}` : undefined,
		hash: opts.hash === false ? undefined : watchHash(info.matchKey)
	};
}

/** Auto-fetch the art only for a signed-in viewer whose ownership is already on file (local record or server attestation);
 *  a first-time or signed-out viewer ticks the box first, exactly as before. */
export async function artAlreadyAllowed(): Promise<boolean> {
	if (!auth.authed) return false;
	return !!ownsLocal() || (await getAttest());
}

export async function openWatch(info: WatchInfo, base: string, opts: { hash?: boolean } = {}): Promise<void> {
	replayViewer.open(watchRequest(info, base, { autoart: await artAlreadyAllowed(), hash: opts.hash }));
}
