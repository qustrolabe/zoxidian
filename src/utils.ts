/**
 * Format a frecency score for display.
 * Whole numbers are shown without decimals; others show one decimal place.
 */
export function formatScore(n: number): string {
	return n.toFixed(1);
}

export const FILE_ICON_SVG =
	`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ` +
	`stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
	`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>` +
	`<polyline points="14 2 14 8 20 8"/></svg>`;

export function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return function (this: unknown, ...args: Parameters<T>) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), ms);
	} as T;
}
