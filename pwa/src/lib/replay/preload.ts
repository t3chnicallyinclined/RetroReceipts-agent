// ── Warm the replay art in the background (season finale) ───────────────────────────────────────────────────────
// A signed-in viewer whose ownership is already on file should press "Watch" and see the picture at once, so while the
// finale sits open we fetch the art for its READY moments into the existing Cache Storage path (pack.ts), one moment at a
// time (the shared parts are cached after the first). Hard rules, each one tested:
//   - only for a SIGNED-IN viewer whose ownership acknowledgement is already on file (a first-time or signed-out viewer
//     ticks the box first, exactly as today; nothing is downloaded on their behalf)
//   - never with Save-Data on, nor on a 2g / slow-2g connection
//   - never more than PRELOAD_CAP_BYTES of network per page view
//   - stops the moment the page is hidden or the page unmounts (the AbortSignal)
//   - only tapes the server calls READY: legacy, archived, pending and none are never warmed
//   - never throws and never blocks the page; the only visible effect is a Watch button that starts faster
import { loadPackManifest, warmPack, type PackManifest } from './pack';

/** about 60 MB of network per page view (shared parts are fetched once, so this is roughly three moments) */
export const PRELOAD_CAP_BYTES = 60 * 1024 * 1024;

export interface PreloadEnv {
	authed: boolean;
	/** ownership is already on file (local record, or the server's attestation) */
	attested: boolean;
	saveData: boolean;
	/** navigator.connection.effectiveType, when the browser has it */
	effectiveType?: string;
	hidden: boolean;
}

export type PreloadVerdict = 'ok' | 'signed-out' | 'unattested' | 'save-data' | 'slow-connection' | 'hidden';

export function preloadVerdict(env: PreloadEnv): PreloadVerdict {
	if (!env.authed) return 'signed-out';
	if (!env.attested) return 'unattested';
	if (env.saveData) return 'save-data';
	if (env.effectiveType === '2g' || env.effectiveType === 'slow-2g') return 'slow-connection';
	if (env.hidden) return 'hidden';
	return 'ok';
}

export interface WarmTarget {
	matchKey: string;
	tape?: string;
}
/** only READY tapes, in the order given, one per match key */
export function warmTargets(items: WarmTarget[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const it of items) {
		if (it.tape !== 'ready' || !it.matchKey || seen.has(it.matchKey)) continue;
		seen.add(it.matchKey);
		out.push(it.matchKey);
	}
	return out;
}

export interface WarmDeps {
	manifest: (matchKey: string) => Promise<PackManifest>;
	warm: (man: PackManifest, opts: { signal?: AbortSignal; budget: { left: number } }) => Promise<{ networkBytes: number; cachedFiles: number; stopped?: 'cap' | 'abort' | 'error' }>;
}
const realDeps: WarmDeps = {
	manifest: (matchKey) => loadPackManifest({ kind: 'server', manifestUrl: `/rr/packs/manifest?key=${encodeURIComponent(matchKey)}`, attested: true }),
	warm: (man, opts) => warmPack(man, opts)
};

export interface WarmReport {
	warmed: string[];
	networkBytes: number;
	stopped?: 'cap' | 'abort' | 'error';
}

/**
 * Warm the art for `keys` (already filtered to ready tapes), one at a time, until the byte cap, an abort, or a failure.
 * `recheck` is asked before each moment so a viewer who goes Save-Data / hidden / signed out mid-way stops the warm-up.
 */
export async function runWarm(keys: string[], opts: { signal?: AbortSignal; cap?: number; recheck?: () => PreloadVerdict; deps?: WarmDeps }): Promise<WarmReport> {
	const deps = opts.deps ?? realDeps;
	const budget = { left: opts.cap ?? PRELOAD_CAP_BYTES };
	const report: WarmReport = { warmed: [], networkBytes: 0 };
	for (const key of keys) {
		if (opts.signal?.aborted) {
			report.stopped = 'abort';
			break;
		}
		if (opts.recheck && opts.recheck() !== 'ok') {
			report.stopped = 'abort';
			break;
		}
		if (budget.left <= 0) {
			report.stopped = 'cap';
			break;
		}
		try {
			const man = await deps.manifest(key);
			const r = await deps.warm(man, { signal: opts.signal, budget });
			report.networkBytes += r.networkBytes;
			if (r.stopped) {
				report.stopped = r.stopped;
				break;
			}
			report.warmed.push(key);
		} catch {
			report.stopped = opts.signal?.aborted ? 'abort' : 'error';
			break;
		}
	}
	return report;
}
