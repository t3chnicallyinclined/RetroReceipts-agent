// ── The app-wide replay viewer (ReplaySheet) ─────────────────────────────────────────────────────────
// Anywhere a match is shown outside a list that can expand in place (the set view, the share pages, the
// profile history, a receipt), the ReplayAffordance opens THIS: one sheet mounted once in +layout, exactly
// like RankInfoModal. `open()` takes the row (for the resolver) and the server-resolved meta (for the chrome).
import type { ReplayMeta } from '$lib/components/ReplayEmbed.svelte';
import type { RowLike } from '$lib/replay/source';

export interface ReplayRequest {
	row: RowLike;
	meta: ReplayMeta;
}

class ReplayViewer {
	current = $state<ReplayRequest | null>(null);
	open(req: ReplayRequest) {
		this.current = req;
	}
	close() {
		this.current = null;
	}
}

export const replayViewer = new ReplayViewer();
