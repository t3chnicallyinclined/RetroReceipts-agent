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
