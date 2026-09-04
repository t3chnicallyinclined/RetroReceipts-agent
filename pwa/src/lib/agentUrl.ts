// ONE resolver for "where do I download the desktop agent" (DownloadAgent's banner + the replay's update nudge).
// The URL comes from the SAME manifest the tray's self-updater reads, so a renamed or moved release asset needs no
// edit here — that held through the metasync-agent → rr-agent rename in 0.3.8. The constant below is only the
// fallback for when that fetch cannot happen (offline, blocked, malformed manifest); it floats to the newest
// release, so only a further FILENAME change would strand it.
import { api } from '$lib/config';

export const WIN_URL_FALLBACK =
	'https://github.com/t3chnicallyinclined/RetroReceipts-agent/releases/latest/download/rr-agent.exe';

let cached: Promise<string> | null = null;

/** The current Windows agent URL (manifest-resolved, cached per session; never throws). */
export function agentWinUrl(): Promise<string> {
	if (!cached) {
		cached = (async () => {
			try {
				const res = await fetch(api('/rr/update/agent-latest.json'), { cache: 'no-store' });
				if (!res.ok) return WIN_URL_FALLBACK;
				const url = (await res.json())?.url;
				// Only trust an absolute https URL — never let a bad manifest point the button somewhere odd.
				return typeof url === 'string' && url.startsWith('https://') ? url : WIN_URL_FALLBACK;
			} catch {
				return WIN_URL_FALLBACK;
			}
		})();
	}
	return cached;
}
