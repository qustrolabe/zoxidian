/**
 * Format a frecency score for display.
 * Always render with one decimal place for stable badge width.
 */
export function formatScore(n: number): string {
	return n.toFixed(1);
}

export function appendFileIcon(parent: HTMLElement): void {
	const svg = parent.createSvg("svg", {
		attr: {
			viewBox: "0 0 24 24",
			width: "14",
			height: "14",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
		},
	});

	svg.createSvg("path", { attr: { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" } });
	svg.createSvg("polyline", { attr: { points: "14 2 14 8 20 8" } });
}

export function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return function (this: unknown, ...args: Parameters<T>) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), ms);
	} as T;
}
