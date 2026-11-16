// Season finale: motion helpers. Reveal and count-up run ONLY when the page root carries `.anim`, which the page
// sets after JS confirms motion is allowed; with reduced motion (or no JS) everything is simply visible.

/** Add `.in` to an element the first time it scrolls into view. */
export function reveal(node: HTMLElement) {
	const root = node.closest('.fin');
	if (!root || !root.classList.contains('anim') || typeof IntersectionObserver === 'undefined') {
		node.classList.add('in');
		return {};
	}
	const io = new IntersectionObserver(
		(es) => {
			if (es.some((e) => e.isIntersecting)) {
				node.classList.add('in');
				io.disconnect();
			}
		},
		{ rootMargin: '0px 0px -8% 0px' }
	);
	io.observe(node);
	return { destroy: () => io.disconnect() };
}

/** Count a number up from zero once, when first visible. The true value stays in the text for screen readers. */
export function countUp(node: HTMLElement, p: { value: number; format: (n: number) => string }) {
	node.textContent = p.format(p.value);
	const root = node.closest('.fin');
	if (!root || !root.classList.contains('anim') || typeof IntersectionObserver === 'undefined') return {};
	let raf = 0;
	const run = () => {
		const t0 = performance.now();
		const tick = (t: number) => {
			const k = Math.min(1, (t - t0) / 800);
			node.textContent = p.format(p.value * (1 - Math.pow(1 - k, 3)));
			if (k < 1) raf = requestAnimationFrame(tick);
			else node.textContent = p.format(p.value);
		};
		node.textContent = p.format(0);
		raf = requestAnimationFrame(tick);
	};
	const io = new IntersectionObserver((es) => {
		if (es.some((e) => e.isIntersecting)) {
			io.disconnect();
			run();
		}
	});
	io.observe(node);
	return { destroy: () => { io.disconnect(); cancelAnimationFrame(raf); } };
}
