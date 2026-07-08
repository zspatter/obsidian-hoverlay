import { describe, expect, it } from "vitest";
import {
	MIN_HEIGHT,
	MIN_WIDTH,
	RESIZE_HANDLES,
	VIEWPORT_MARGIN,
	ZOOM_MAX,
	ZOOM_MIN,
	clampSizeToViewport,
	clampZoom,
	dragPosition,
	fitEmbedSize,
	flyoutLeft,
	maximizedRect,
	popoverPosition,
	resizeRect,
} from "../src/geometry";
import type { EdgeSet } from "../src/geometry";

const VIEWPORT = { width: 1280, height: 800 };
const SIZE = { width: 480, height: 340 };

describe("popoverPosition", () => {
	it("sits below the anchor when everything fits", () => {
		const pos = popoverPosition({ left: 100, top: 200, bottom: 220 }, SIZE, VIEWPORT);
		expect(pos).toEqual({ left: 100, top: 220 + VIEWPORT_MARGIN });
	});

	it("flips above the anchor when below would overflow", () => {
		const pos = popoverPosition({ left: 100, top: 700, bottom: 720 }, SIZE, VIEWPORT);
		expect(pos.top).toBe(700 - SIZE.height - VIEWPORT_MARGIN);
	});

	it("never leaves the viewport for any anchor position", () => {
		// sweep anchors across and beyond the viewport, including sizes that fit
		for (const left of [-200, 0, 100, 640, 1200, 1500]) {
			for (const top of [-100, 0, 300, 760, 900]) {
				const pos = popoverPosition({ left, top, bottom: top + 20 }, SIZE, VIEWPORT);
				expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
				expect(pos.left + SIZE.width).toBeLessThanOrEqual(
					VIEWPORT.width - VIEWPORT_MARGIN
				);
				expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
			}
		}
	});
});

describe("resizeRect", () => {
	const START = { left: 300, top: 200, width: 480, height: 340 };
	const DELTAS = [-10000, -200, -1, 0, 1, 200, 10000];

	it("holds its invariants for every handle and delta", () => {
		for (const { edges } of RESIZE_HANDLES) {
			for (const dx of DELTAS) {
				for (const dy of DELTAS) {
					const next = resizeRect(edges, START, { x: dx, y: dy }, VIEWPORT);

					// untouched axes never change
					if (!edges.left && !edges.right) {
						expect(next.width).toBe(START.width);
						expect(next.left).toBe(START.left);
					}
					if (!edges.top && !edges.bottom) {
						expect(next.height).toBe(START.height);
						expect(next.top).toBe(START.top);
					}
					// dragging left/top keeps the opposite edge pinned
					if (edges.left) {
						expect(next.left + next.width).toBe(START.left + START.width);
					}
					if (edges.top) {
						expect(next.top + next.height).toBe(START.top + START.height);
					}
					if (edges.right) expect(next.left).toBe(START.left);
					if (edges.bottom) expect(next.top).toBe(START.top);
					// min sizes respected (the start rect leaves room for them)
					expect(next.width).toBeGreaterThanOrEqual(MIN_WIDTH);
					expect(next.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
					// viewport respected
					expect(next.left + next.width).toBeLessThanOrEqual(
						VIEWPORT.width - VIEWPORT_MARGIN
					);
					expect(next.top + next.height).toBeLessThanOrEqual(
						VIEWPORT.height - VIEWPORT_MARGIN
					);
					expect(next.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
					expect(next.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
				}
			}
		}
	});

	it("grows exactly with the pointer inside the limits", () => {
		const edges: EdgeSet = { right: true, bottom: true };
		const next = resizeRect(edges, START, { x: 50, y: -30 }, VIEWPORT);
		expect(next.width).toBe(START.width + 50);
		expect(next.height).toBe(START.height - 30);
	});
});

describe("dragPosition", () => {
	it("clamps to the viewport for any pointer position", () => {
		for (const x of [-500, 0, 400, 1300, 5000]) {
			for (const y of [-500, 0, 400, 900, 5000]) {
				const pos = dragPosition({ x, y }, { x: 40, y: 10 }, SIZE, VIEWPORT);
				expect(pos.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
				expect(pos.left).toBeLessThanOrEqual(
					VIEWPORT.width - SIZE.width - VIEWPORT_MARGIN
				);
				expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
				expect(pos.top).toBeLessThanOrEqual(
					VIEWPORT.height - SIZE.height - VIEWPORT_MARGIN
				);
			}
		}
	});

	it("tracks the pointer minus the grab offset when unclamped", () => {
		expect(dragPosition({ x: 500, y: 400 }, { x: 40, y: 10 }, SIZE, VIEWPORT)).toEqual({
			left: 460,
			top: 390,
		});
	});
});

describe("maximizedRect", () => {
	it("fills the viewport minus the margin", () => {
		expect(maximizedRect(VIEWPORT, 24)).toEqual({
			left: 24,
			top: 24,
			width: 1280 - 48,
			height: 800 - 48,
		});
	});
});

describe("clampSizeToViewport", () => {
	it("caps both dimensions to the viewport minus margins, never grows", () => {
		const sizes = [
			{ width: 260, height: 180 },
			{ width: 480, height: 340 },
			{ width: 1200, height: 900 },
			{ width: 5000, height: 5000 },
		];
		const viewports = [
			{ width: 360, height: 780 }, // phone
			{ width: 768, height: 1024 }, // tablet
			{ width: 1280, height: 800 }, // desktop
		];
		for (const size of sizes) {
			for (const viewport of viewports) {
				const clamped = clampSizeToViewport(size, viewport);
				expect(clamped.width).toBeLessThanOrEqual(viewport.width - VIEWPORT_MARGIN * 2);
				expect(clamped.height).toBeLessThanOrEqual(
					viewport.height - VIEWPORT_MARGIN * 2
				);
				expect(clamped.width).toBeLessThanOrEqual(size.width);
				expect(clamped.height).toBeLessThanOrEqual(size.height);
			}
		}
	});

	it("leaves a size that already fits untouched", () => {
		expect(clampSizeToViewport({ width: 480, height: 340 }, VIEWPORT)).toEqual({
			width: 480,
			height: 340,
		});
	});

	it("caps the default width on a phone screen so header controls fit", () => {
		expect(clampSizeToViewport({ width: 480, height: 340 }, { width: 360, height: 780 }))
			.toEqual({ width: 360 - VIEWPORT_MARGIN * 2, height: 340 });
	});
});

describe("fitEmbedSize", () => {
	it("trims at most one dimension and never grows, across the grid", () => {
		const sizes = [
			{ width: 260, height: 180 },
			{ width: 480, height: 308 },
			{ width: 480, height: 600 },
			{ width: 900, height: 300 },
			{ width: 1200, height: 900 },
		];
		const hints = [{}, { height: 352 }, { height: 232 }, { aspectRatio: 16 / 9 }, { aspectRatio: 1 }];
		for (const size of sizes) {
			for (const hint of hints) {
				const fitted = fitEmbedSize(size, hint);
				expect(fitted.width).toBeLessThanOrEqual(size.width);
				expect(fitted.height).toBeLessThanOrEqual(size.height);
				const changed =
					(fitted.width !== size.width ? 1 : 0) +
					(fitted.height !== size.height ? 1 : 0);
				expect(changed).toBeLessThanOrEqual(1);
			}
		}
	});

	it("fixed-height cards trim only the height", () => {
		expect(fitEmbedSize({ width: 480, height: 600 }, { height: 352 })).toEqual({
			width: 480,
			height: 352,
		});
		// a popover shorter than the card is left alone
		expect(fitEmbedSize({ width: 480, height: 300 }, { height: 352 })).toEqual({
			width: 480,
			height: 300,
		});
	});

	it("letterboxed players trim whichever side is dead space", () => {
		// too tall: height gives
		expect(fitEmbedSize({ width: 800, height: 600 }, { aspectRatio: 16 / 9 })).toEqual({
			width: 800,
			height: 450,
		});
		// too wide: width gives
		expect(fitEmbedSize({ width: 800, height: 300 }, { aspectRatio: 16 / 9 })).toEqual({
			width: 533,
			height: 300,
		});
		// already exact: untouched
		expect(fitEmbedSize({ width: 800, height: 450 }, { aspectRatio: 16 / 9 })).toEqual({
			width: 800,
			height: 450,
		});
	});
});

describe("clampZoom", () => {
	it("clamps and rounds across the whole range", () => {
		for (const value of [-1, 0, 0.24, 0.25, 0.3000000004, 1, 1.4999, 1.5, 99]) {
			const zoom = clampZoom(value);
			expect(zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
			expect(zoom).toBeLessThanOrEqual(ZOOM_MAX);
			expect(zoom).toBe(Math.round(zoom * 100) / 100);
		}
		expect(clampZoom(0.65 + 0.05)).toBe(0.7);
	});
});

describe("flyoutLeft", () => {
	it("centers under the button and clamps at both container edges", () => {
		// centered: button at 100..124, flyout 34 wide -> center 112 - 17
		expect(flyoutLeft(100, 24, 34, 480)).toBe(95);
		// clamped left
		expect(flyoutLeft(0, 10, 34, 480)).toBe(4);
		// clamped right
		expect(flyoutLeft(470, 24, 34, 480)).toBe(480 - 34 - 4);
	});
});
