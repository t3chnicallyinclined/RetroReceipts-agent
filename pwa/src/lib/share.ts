// Short share links (Tris, 2026-08-25): nobd.net/s/<tail> — the set id's own unique hex suffix, no new
// id minting. The server 302s humans to the full receipt and serves scrapers the OG fight card.
// ⚠ NO ?p= seat param (Tris: the copied link must equal the link in the bar — clean beats clever). The
// participant-seat rule makes this safe: a recipient who played the set reads it from THEIR seat, and
// everyone else gets the neutral winner-reads-right view. Falls back to the long canonical URL whenever
// the id doesn't decompose — never emit a link that can't resolve.
export function shortSetLink(sessionId: string): string {
	const m = /^s_\d{17}_\d{17}_([0-9a-f]{6,16})$/.exec(sessionId);
	return m
		? `https://nobd.net/s/${m[1]}`
		: `https://nobd.net/app/r/set/${encodeURIComponent(sessionId)}`;
}

// ── SHARE (LIVE-TAB-V2-SPEC §5) ─────────────────────────────────────────────────────────────────────────────
// One control, two things: COPY LINK is the primary everywhere, and ↗ SHARE appears only where the OS actually
// has a share sheet. No per-network buttons: two of the five networks Tris named (TikTok, Instagram) cannot be
// reached by a link at all — they take video uploads — so a row of five identical-looking buttons would lie
// about two of them. The OS sheet reaches all five honestly, and the desktop fallback is the link, which is
// what gets pasted into a Discord anyway.

/** How long a "Copied" confirmation stands. One number, so six surfaces stop disagreeing (three said 1600). */
export const COPIED_MS = 1800;

/**
 * The link to a match AS SEEN IN THE THEATRE: the short set link plus `?m=<match_key>`, so the recipient lands
 * on the same GAME rather than the top of the set. The query survives the server's 302 from /s/<tail> to the
 * app, which is the only reason this works without a new route.
 */
export function theatreLink(sessionId: string, matchKey?: string): string {
	const base = shortSetLink(sessionId);
	if (!matchKey) return base;
	const sep = base.includes('?') ? '&' : '?';
	return `${base}${sep}m=${encodeURIComponent(matchKey)}`;
}

/**
 * Copy, and SAY WHETHER IT WORKED.
 *
 * The clipboard is refused more often than the old call sites assumed — an insecure origin, a permissions
 * policy, a browser that only allows it inside a user gesture it has already lost track of. Five of the six
 * copy sites in this app silently did nothing in that case, which reads to the user as a dead button. This
 * returns false instead, so the caller can reveal the URL for manual selection (the behaviour WagerRail
 * already had, now available to everyone).
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// last resort for older/locked-down engines: a hidden textarea + execCommand. Deprecated, still the
		// only thing that works in some contexts, and harmless where it does not.
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(ta);
			return ok;
		} catch {
			return false;
		}
	}
}

/** True only where the OS genuinely has a share sheet — the ↗ Share control is not rendered otherwise. */
export function canShare(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * The OS share sheet. On a phone this one control reaches every installed app — Discord, X, Facebook,
 * Instagram, TikTok, Messages — and it was used NOWHERE in this app before.
 *
 * Returns false when the sheet is unavailable OR the user dismissed it; a dismissal is not an error and must
 * never surface as one. The caller falls back to copy.
 */
export async function shareLink(data: { title?: string; text?: string; url: string }): Promise<boolean> {
	if (!canShare()) return false;
	try {
		await navigator.share(data);
		return true;
	} catch {
		return false; // AbortError (the user closed the sheet) included — silence is correct here
	}
}
