// ── PLAYBACK PACING ─────────────────────────────────────────────────────────────────────────────────────────
// THE REQUIREMENT, in one line: refresh rate may change how many TIMES a frame is shown; it may never change
// WHICH frames are shown, HOW FAST the match plays, or what any of them look like.
//
// The tape is a fixed 60 fps of GAME time, so elapsed wall-clock is the only correct authority for SPEED — that
// principle was already in ReplayEmbed and survives here untouched. What was broken was the per-refresh
// CADENCE: the old loop re-decided it every refresh with
//
//     acc += now - last;  advance = Math.floor(acc / interval)
//
// and on a 60 Hz panel `acc` sits exactly on the threshold, so ordinary vsync noise — not real time — chose
// between "repeat this frame" and "skip one". MEASURED against that code with a synthetic refresh train
// (600–900 refreshes, symmetric jitter):
//
//     60 Hz  ±0.5 ms →  8 repeats + 8 skips per 840 frames
//     60 Hz  ±2   ms → 24 repeats + 26 skips  (~6% of frames disturbed)
//     59.94  ±3   ms → 27 repeats + 31 skips
//
// Average fps stayed 59.94–60.00 the whole time, which is why this reads as "the camera shakes" while the
// recorded data and the playback speed are both provably fine. A 0 immediately followed by a 2 is a frame shown
// twice and then one never shown at all.
//
// THE FIX IS CADENCE, NOT BUFFERING. A deeper buffer cannot smooth an uneven presentation cadence; it only
// delays the start. So:
//
//   1. estimate the display period from a MEDIAN of recent refresh deltas (median, so one hitch cannot move it)
//      and only adopt a new estimate when it differs materially, so an adaptive-refresh phone does not flap;
//   2. refreshesPerSource = sourceFramePeriod / displayPeriod  (60 Hz → 1, 120 → 2, 144 → 2.4, 90 → 1.5);
//   3. advance on a Bresenham accumulator driven by that RATIO, not by measured time — so an integer ratio
//      holds every frame for exactly the same number of refreshes, and a non-integer ratio produces a fixed
//      repeating pattern (144 Hz → 2,2,3,2,3…). The eye reads a stable pattern as smooth and a random one as
//      judder, which is the entire point;
//   4. correct long-run DRIFT slowly — panels are rarely exactly 60.000 Hz (59.94 is ~0.1%, about 10 frames
//      across a three-minute match) — by nudging ONE frame when cumulative drift exceeds a threshold, never
//      per-frame, which would just reintroduce the jitter this exists to remove;
//   5. fall back to the honest wall-clock path when the display cannot keep up (50 Hz, a throttled tab, a slow
//      machine, or any speed that needs more than one source frame per refresh) and drop frames openly.
//
// Note what is NOT done: locking to "one frame per refresh". That would play a 120 Hz panel at double speed.
// Every rate goes through the same ratio maths, and so does every non-1× speed via the `speed` term.

/** refresh deltas kept for the median. ~0.5 s at 60 Hz — long enough to be stable, short enough to adapt. */
const WINDOW = 31;
/** a new period estimate must differ by more than this fraction before it is adopted (anti-flap hysteresis). */
const PERIOD_HYSTERESIS = 0.08;
/** how far cumulative drift may go, in source frames, before ONE correcting frame is inserted or dropped. */
const DRIFT_TOLERANCE = 2.5;
/** ratios within this of a whole number are treated as that integer (59.94 Hz is not exactly 1.000). */
const INT_TOLERANCE = 0.035;
/** a hitch longer than this many source frames is a stall, not drift: resync instead of catching up. */
const STALL_FRAMES = 4;

export interface PacerDebug {
	displayHz: number;
	refreshesPerSource: number;
	locked: boolean;
	drift: number;
}

/**
 * Decides how many SOURCE frames to advance on each refresh.
 *
 * Pure with respect to its inputs: given the same sequence of timestamps and speeds it returns the same
 * sequence of advances, which is what makes it testable against a synthetic clock at 60/90/120/144 Hz without
 * needing four physical panels.
 */
export class Pacer {
	#deltas: number[] = [];
	#times: number[] = [];
	#period = 0; // adopted display period estimate, ms
	#last = 0;
	#credit = 0; // Bresenham accumulator, in source frames
	#startedAt = 0;
	#shown = 0; // source frames advanced since the last resync
	#speed = 60;
	#accMs = 0; // wall-clock accumulator for the fallback path

	constructor(now = 0, speed = 60) {
		this.reset(now, speed);
	}

	reset(now: number, speed = 60): void {
		this.#deltas = [];
		this.#times = [now];
		this.#period = 0;
		this.#last = now;
		this.#credit = 0;
		this.#startedAt = now;
		this.#shown = 0;
		this.#speed = speed;
		this.#accMs = 0;
	}

	get debug(): PacerDebug {
		const src = 1000 / this.#speed;
		return {
			displayHz: this.#period > 0 ? 1000 / this.#period : 0,
			refreshesPerSource: this.#period > 0 ? src / this.#period : 0,
			locked: this.#period > 0,
			drift: this.#drift(this.#last)
		};
	}

	/** expected source frames by now, minus those actually advanced. Positive = we are behind. */
	#drift(now: number): number {
		if (this.#startedAt === 0) return 0;
		return (now - this.#startedAt) / (1000 / this.#speed) - this.#shown;
	}

	/**
	 * One refresh. Returns the number of source frames to advance (0 or more).
	 *
	 * @param now    the rAF timestamp, ms
	 * @param speed  source frames per second — 60 is real time, 30 is the half-speed watchdog, and any
	 *               user-chosen rate goes through the same maths rather than a special case
	 */
	tick(now: number, speed: number): number {
		if (speed !== this.#speed) {
			// a speed change re-bases everything: the old drift and credit were measured against a different
			// source period and would otherwise be spent all at once as a jump.
			const p = this.#period;
			const d = this.#deltas.slice();
			this.reset(now, speed);
			this.#period = p; // the DISPLAY has not changed, only our reading of the tape
			this.#deltas = d;
			return 0;
		}

		const dt = now - this.#last;
		this.#last = now;
		if (dt <= 0) return 0;

		const srcPeriod = 1000 / speed;

		// a long stall (tab hidden, GC pause, a slow first decode) is not drift to be made up — catching it up
		// would fast-forward the match. Resync the clock and show one frame.
		if (dt > srcPeriod * STALL_FRAMES) {
			this.#deltas = [];
			this.#times = [now];
			this.#period = 0;
			this.#credit = 0;
			this.#accMs = 0;
			this.#startedAt = now;
			this.#shown = 0;
			return 1;
		}

		// ── display period estimate ──
		// A median of raw deltas is not accurate enough on its own: at 240 Hz the period is 4.17 ms, so ±0.5 ms
		// of ordinary vsync jitter is ±12% — enough to miss the integer ratio entirely and leave the drift
		// correction papering over it with visible double-holds (measured: 240 Hz held frames for 3/4/7/8
		// refreshes instead of a uniform 4).
		//
		// So: use the median only to COUNT how many refresh slots the window spans, then divide the window's
		// total span by that count. Averaging over ~30 refreshes shrinks the jitter by about √30, and counting
		// slots rather than samples keeps it correct when the browser misses a vsync entirely.
		this.#deltas.push(dt);
		this.#times.push(now);
		if (this.#deltas.length > WINDOW) this.#deltas.shift();
		if (this.#times.length > WINDOW + 1) this.#times.shift();
		if (this.#deltas.length >= 12) {
			const sorted = [...this.#deltas].sort((a, b) => a - b);
			const med = sorted[sorted.length >> 1];
			const span = this.#times[this.#times.length - 1] - this.#times[0];
			const slots = Math.max(1, Math.round(span / med));
			const est = span / slots;
			if (this.#period === 0 || Math.abs(est - this.#period) / this.#period > PERIOD_HYSTERESIS) {
				this.#period = est;
				this.#credit = 0; // the cadence is about to change; do not carry a stale fraction across
			} else {
				// same display, better reading: track it smoothly so long-run drift stays small without the
				// cadence ever jumping.
				this.#period += (est - this.#period) * 0.05;
			}
		}

		// ── not enough samples yet, or the display cannot keep up: the honest wall-clock path ──
		// refreshesPerSource < 1 means each refresh must cover MORE than one source frame (a 50 Hz panel, a
		// throttled tab, 2× speed on 60 Hz). There is no cadence to stabilise there — frames must be dropped,
		// and dropping them by elapsed time is exactly right.
		const rps = this.#period > 0 ? srcPeriod / this.#period : 0;
		if (rps < 1 - INT_TOLERANCE) {
			this.#accMs += dt;
			let advance = Math.floor(this.#accMs / srcPeriod);
			if (advance > 0) {
				this.#accMs -= advance * srcPeriod;
				this.#shown += advance;
			}
			return advance;
		}

		// ── the deterministic cadence ──
		// credit grows by a FIXED amount per refresh — the ratio, not the measured delta — so the pattern is
		// decided by arithmetic and cannot be perturbed by vsync noise. An integer ratio yields a perfectly
		// uniform hold; 2.4 yields the repeating 2,2,3,2,3.
		const per = this.#nearInt(rps);
		this.#credit += 1 / per;
		let advance = Math.floor(this.#credit + 1e-9);
		this.#credit -= advance;

		// ── slow drift correction ──
		// The ratio is only as good as the period estimate, and a 59.94 Hz panel read as 60.00 drifts ~0.1%.
		// Correct by ONE frame at a time, and only once the error is visible in frames rather than microseconds.
		const drift = this.#drift(now) - advance;
		if (drift > DRIFT_TOLERANCE) advance += 1;
		else if (drift < -DRIFT_TOLERANCE && advance > 0) advance -= 1;

		this.#shown += advance;
		return advance;
	}

	/**
	 * Snap a ratio to a whole number when it is within tolerance — 59.94 Hz must still read as 1:1.
	 *
	 * The tolerance is RELATIVE, not absolute. An absolute one gives a ratio of 1 a 3.5% window but a ratio of 4
	 * (a 240 Hz panel) only 0.875%, so 240 Hz missed the integer, ran the Bresenham path at ~3.976 and held
	 * frames for 3 or 4 refreshes instead of a uniform 4 — measured as a 0.6% speed error and a visibly uneven
	 * hold before this was made proportional.
	 */
	#nearInt(r: number): number {
		const n = Math.round(r);
		return n >= 1 && Math.abs(r - n) / n <= INT_TOLERANCE ? n : r;
	}
}

// DEV-only test hook: the smoke harness drives the REAL class from a synthetic clock at 60/90/120/144/240 Hz
// (scripts/smoke-replay.mjs --pacer), because this is exactly the class of bug that hides on the developer's
// own monitor — one panel can only ever prove one refresh rate.
// `import.meta.env?.` — optional so this module can also be imported by a plain node harness, where Vite's
// env shim does not exist.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
	(window as unknown as Record<string, unknown>).__rrPacer = Pacer;
}
