// ── The app-wide replay viewer (ReplaySheet) ─────────────────────────────────────────────────────────
// Anywhere a match is shown outside a list that can expand in place (the set view, the share pages, the
// profile history, a receipt, the season finale), the ReplayAffordance / a finale link opens THIS: one sheet mounted
// once in +layout, exactly like RankInfoModal. `open()` takes the row (for the resolver) and the server-resolved meta
// (for the chrome).
//
// A request may carry a `hash` (`#watch=<match_key>`): the finale uses it so a shared link opens the same replay and the
// browser's Back button closes the sheet. Closing from the sheet (Escape, the close button, the backdrop) walks the
// history back instead of leaving a dead hash; Back itself (popstate) closes it. Every other surface passes no hash and
// behaves exactly as before.
import type { ReplayMeta } from '$lib/components/ReplayEmbed.svelte';
import type { RowLike } from '$lib/replay/source';

export interface ReplayRequest {
	row: RowLike;
	meta: ReplayMeta;
	/** fetch the art automatically (the viewer is signed in and ownership is already on file); never set for a first-time viewer */
	autoart?: boolean;
	/** where "Open the full set" goes (the set page at this game) */
	fullSet?: string;
	/** push this hash while the sheet is open (e.g. `#watch=<key>`) */
	hash?: string;
}

class ReplayViewer {
	current = $state<ReplayRequest | null>(null);
	/** true while we own one history entry pushed for the open sheet */
	private pushed = false;
	open(req: ReplayRequest) {
		this.current = req;
		if (req.hash && typeof history !== 'undefined' && typeof location !== 'undefined' && location.hash !== req.hash) {
			try {
				history.pushState(history.state, '', req.hash);
				this.pushed = true;
			} catch {
				/* a sandboxed frame: the sheet still opens, there is just no hash */
			}
		}
	}
	/** close from the sheet's own controls */
	close() {
		if (this.pushed && typeof history !== 'undefined') {
			this.pushed = false;
			this.current = null;
			history.back(); // pops the hash entry we pushed; the popstate that follows finds nothing to close
			return;
		}
		const had = this.current?.hash;
		this.current = null;
		// opened from a shared #watch= link (nothing pushed): clear the hash so the URL no longer points at a closed sheet
		if (had && typeof history !== 'undefined' && typeof location !== 'undefined' && location.hash === had) {
			try {
				history.replaceState(history.state, '', location.pathname + location.search);
			} catch {
				/* ignore */
			}
		}
	}
	/** close without touching history (a navigation is already leaving the page) */
	dismiss() {
		this.pushed = false;
		this.current = null;
	}
	/** the browser went Back/Forward: the sheet follows the hash */
	onPop(hash: string) {
		const want = this.current?.hash;
		if (this.current && want && hash !== want) {
			this.pushed = false;
			this.current = null;
		}
	}
}

export const replayViewer = new ReplayViewer();
