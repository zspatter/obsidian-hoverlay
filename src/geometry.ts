/**
 * Pure popover geometry: positioning, resizing, dragging, maximizing, zoom
 * clamping and flyout anchoring. No DOM; callers read element metrics and
 * apply the results as styles. Extracted so the math is exhaustively
 * unit-testable.
 */

export interface Size {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface EdgeSet {
	left?: boolean;
	right?: boolean;
	top?: boolean;
	bottom?: boolean;
}

export const MIN_WIDTH = 260;
export const MIN_HEIGHT = 180;
export const VIEWPORT_MARGIN = 8;
export const MAXIMIZE_MARGIN = 24;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.05;

export const RESIZE_HANDLES: Array<{ cls: string; edges: EdgeSet }> = [
	{ cls: "e", edges: { right: true } },
	{ cls: "w", edges: { left: true } },
	{ cls: "s", edges: { bottom: true } },
	{ cls: "n", edges: { top: true } },
	{ cls: "se", edges: { right: true, bottom: true } },
	{ cls: "sw", edges: { left: true, bottom: true } },
	{ cls: "ne", edges: { right: true, top: true } },
	{ cls: "nw", edges: { left: true, top: true } },
];

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** below the anchor, flipped above when it would overflow, clamped to view */
export function popoverPosition(
	anchor: { left: number; top: number; bottom: number },
	size: Size,
	viewport: Size,
	margin = VIEWPORT_MARGIN
): { left: number; top: number } {
	let left = anchor.left;
	let top = anchor.bottom + margin;

	if (left + size.width > viewport.width - margin) {
		left = viewport.width - size.width - margin;
	}
	if (top + size.height > viewport.height - margin) {
		top = anchor.top - size.height - margin; // flip above the anchor
	}
	return { left: Math.max(margin, left), top: Math.max(margin, top) };
}

/** the rect during a resize drag: dragged edges follow the pointer within
 *  min-size and viewport limits, opposite edges stay fixed */
export function resizeRect(
	edges: EdgeSet,
	start: Rect,
	delta: Point,
	viewport: Size,
	margin = VIEWPORT_MARGIN
): Rect {
	const next: Rect = { ...start };

	if (edges.right) {
		const maxWidth = viewport.width - start.left - margin;
		next.width = clamp(start.width + delta.x, MIN_WIDTH, maxWidth);
	}
	if (edges.bottom) {
		const maxHeight = viewport.height - start.top - margin;
		next.height = clamp(start.height + delta.y, MIN_HEIGHT, maxHeight);
	}
	if (edges.left) {
		// the left edge moves the origin as well as the size
		const maxWidth = start.left + start.width - margin;
		next.width = clamp(start.width - delta.x, MIN_WIDTH, maxWidth);
		next.left = start.left + start.width - next.width;
	}
	if (edges.top) {
		const maxHeight = start.top + start.height - margin;
		next.height = clamp(start.height - delta.y, MIN_HEIGHT, maxHeight);
		next.top = start.top + start.height - next.height;
	}
	return next;
}

/** header-drag position, clamped fully inside the viewport */
export function dragPosition(
	pointer: Point,
	grabOffset: Point,
	size: Size,
	viewport: Size,
	margin = VIEWPORT_MARGIN
): { left: number; top: number } {
	const maxLeft = Math.max(margin, viewport.width - size.width - margin);
	const maxTop = Math.max(margin, viewport.height - size.height - margin);
	return {
		left: clamp(pointer.x - grabOffset.x, margin, maxLeft),
		top: clamp(pointer.y - grabOffset.y, margin, maxTop),
	};
}

export function maximizedRect(viewport: Size, margin = MAXIMIZE_MARGIN): Rect {
	return {
		left: margin,
		top: margin,
		width: viewport.width - margin * 2,
		height: viewport.height - margin * 2,
	};
}

/** zoom factor clamped to bounds and rounded to two decimals so repeated
 *  steps never accumulate float dust */
export function clampZoom(value: number): number {
	return Math.round(clamp(value, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
}

/** the configured popover size can exceed a small (mobile) viewport, which
 *  would push the header controls off-screen; cap both dimensions to fit */
export function clampSizeToViewport(
	size: Size,
	viewport: Size,
	margin = VIEWPORT_MARGIN
): Size {
	return {
		width: Math.min(size.width, viewport.width - margin * 2),
		height: Math.min(size.height, viewport.height - margin * 2),
	};
}

/**
 * Trim a content box to an embed's natural size: fixed-height cards give up
 * the height below the card; letterboxed players give up whichever dimension
 * the aspect ratio makes dead space. Trims at most one dimension and never
 * grows either.
 */
export function fitEmbedSize(
	content: Size,
	hint: { height?: number; aspectRatio?: number }
): Size {
	if (hint.height !== undefined) {
		return { width: content.width, height: Math.min(content.height, hint.height) };
	}
	if (hint.aspectRatio) {
		const ideal = content.width / hint.aspectRatio;
		if (content.height > ideal + 0.5) {
			return { width: content.width, height: Math.round(ideal) };
		}
		if (content.height < ideal - 0.5) {
			return { width: Math.round(content.height * hint.aspectRatio), height: content.height };
		}
	}
	return content;
}

/** flyout left offset so it centers under a button, clamped to its container */
export function flyoutLeft(
	buttonLeft: number,
	buttonWidth: number,
	flyoutWidth: number,
	containerWidth: number,
	margin = 4
): number {
	const centered = buttonLeft + buttonWidth / 2 - flyoutWidth / 2;
	return Math.max(margin, Math.min(containerWidth - flyoutWidth - margin, centered));
}
