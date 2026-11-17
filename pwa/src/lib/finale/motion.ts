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

/**
 * Reveal every `.rv` element under `root` as it scrolls into view, including ones rendered later (data arrives
 * after the page). Without this the `.anim .rv` rule would leave them hidden. Call only when `.anim` is set.
 */
export function revealAll(root: HTMLElement): () => void {
	if (typeof IntersectionObserver === 'undefined') {
		root.querySelectorAll('.rv').forEach((n) => n.classList.add('in'));
		return () => {};
	}
	const io = new IntersectionObserver(
		(es) => {
			for (const e of es) {
				if (e.isIntersecting) {
					e.target.classList.add('in');
					io.unobserve(e.target);
				}
			}
		},
		{ rootMargin: '0px 0px -6% 0px' }
	);
	const watch = (n: Element) => {
		if (!n.classList.contains('in')) io.observe(n);
	};
	const scan = (el: ParentNode) => el.querySelectorAll('.rv').forEach(watch);
	scan(root);
	const mo = new MutationObserver((ms) => {
		for (const m of ms)
			m.addedNodes.forEach((n) => {
				if (n instanceof Element) {
					if (n.classList.contains('rv')) watch(n);
					scan(n);
				}
			});
	});
	mo.observe(root, { childList: true, subtree: true });
	return () => {
		io.disconnect();
		mo.disconnect();
	};
}

/** Count a number up from zero once, when first visible. The true value stays in the text for screen readers. */
export function countUp(node: HTMLElement, p: { value: number; format: (n: number) => string }) {
	node.textContent = p.format(p.value);
	const root = node.closest('.fin');
	// the value can change after mount (the data arrives in any order): always show the current one
	const update = (np: { value: number; format: (n: number) => string }) => {
		p = np;
		node.textContent = np.format(np.value);
	};
	if (!root || !root.classList.contains('anim') || typeof IntersectionObserver === 'undefined') return { update };
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
	return { update, destroy: () => { io.disconnect(); cancelAnimationFrame(raf); } };
}
