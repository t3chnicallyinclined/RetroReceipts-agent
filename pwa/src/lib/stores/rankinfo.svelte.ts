// Rank-info legend — open state for the ONE globally-mounted RankInfoModal (see routes/+layout.svelte).
// Every rank title in the app is a trigger, so the modal lives in the layout and is opened through this
// store rather than each call site mounting its own copy.

class RankInfoStore {
	/** slug of the tier the legend opens focused on; null = closed. */
	slug = $state<string | null>(null);

	open(slug: string) {
		this.slug = slug;
	}
	close() {
		this.slug = null;
	}
}

export const rankInfo = new RankInfoStore();

/**
 * Makes an existing rank-title element open the legend: `<span class="rk-{r.s}" use:rankTitle={r.s}>`.
 *
 * This is an action rather than a <RankTitle> wrapper component on purpose. Title sites style themselves
 * with a mix of global (.rk-<tier> colors, app.css) and component-local classes (.rk-t in MyMatch and
 * RegionModal, .tier on the profile hero). Svelte scopes a component's styles to its own markup, so moving
 * the element into a shared component would silently drop those local rules. Decorating the element where
 * it already lives keeps every call site pixel-identical and makes the diff one attribute per site.
 */
export function rankTitle(node: HTMLElement, slug: string) {
	let current = slug;

	const open = (e: Event) => {
		// Titles sit inside rows and plates that may themselves be clickable — the legend is what was asked
		// for, so don't let the click bubble into a row/profile navigation as well.
		e.preventDefault();
		e.stopPropagation();
		rankInfo.open(current);
	};
	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') open(e);
	};

	node.classList.add('rk-click');
	node.setAttribute('role', 'button');
	node.setAttribute('tabindex', '0');
	node.setAttribute('aria-haspopup', 'dialog');
	// Don't clobber a more specific tooltip a call site already set (RankBadge writes tier + ELO).
	if (!node.hasAttribute('title')) node.setAttribute('title', 'What the ranks mean');

	node.addEventListener('click', open);
	node.addEventListener('keydown', onKeydown);

	return {
		update(next: string) {
			current = next;
		},
		destroy() {
			node.removeEventListener('click', open);
			node.removeEventListener('keydown', onKeydown);
		}
	};
}
