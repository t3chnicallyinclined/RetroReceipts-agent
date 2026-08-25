// Short share links (Tris, 2026-08-25): nobd.net/s/<tail> — the set id's own unique hex suffix, no new
// id minting. The server 302s humans to the full receipt (query string preserved, so the ?p= seat rides
// along) and serves scrapers the receipt's OG card. ⚠ Falls back to the long canonical URL whenever the
// id doesn't decompose — never emit a link that can't resolve.
export function shortSetLink(sessionId: string, seat?: string | null): string {
	const m = /^s_\d{17}_\d{17}_([0-9a-f]{6,16})$/.exec(sessionId);
	const url = m
		? `https://nobd.net/s/${m[1]}`
		: `https://nobd.net/app/r/set/${encodeURIComponent(sessionId)}`;
	return seat ? `${url}?p=${seat}` : url;
}
