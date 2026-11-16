export interface NavItem {
	id: string;
	title: string;
	summary?: string;
	subs?: { id: string; title: string }[];
}

// Shared prop types for the finale chart components.
import type { PlayerRef } from './highlights';

export interface Col {
	label: string;
	value: number;
	/** the sentence written to the read-out (and the button's accessible name) */
	msg: string;
	partial?: boolean;
}
export interface Bar {
	key: string;
	label?: string;
	value: number;
	/** the figure printed beside the bar, rendered as PLAIN TEXT (never as HTML) */
	text: string;
	/** a small second figure, e.g. a percentage, also plain text */
	sub?: string;
	/** `up` colours the figure good-green (climbers) */
	tone?: 'up';
	color?: string;
	msg?: string;
	/** a named player for this row (rendered by the row snippet) */
	ref?: PlayerRef;
}
