import { describe, expect, it } from "vitest";
import { shouldDismiss } from "../src/dismissal";
import type { DismissalEvent, DismissalState, StickyMode } from "../src/dismissal";

const base: DismissalState = {
	mode: "hover",
	pinned: false,
	maximized: false,
	guestFocused: false,
	closeOnEscape: true,
};

const state = (overrides: Partial<DismissalState>): DismissalState => ({
	...base,
	...overrides,
});

const EVENTS: DismissalEvent[] = [
	"pointer-leave",
	"outside-click",
	"outside-wheel",
	"modifier-release",
	"escape",
	"close-button",
];

describe("shouldDismiss: explicit cases", () => {
	it("plain hover popover closes when the pointer leaves", () => {
		expect(shouldDismiss(state({}), "pointer-leave")).toBe(true);
	});

	it("sticky mode ignores pointer-leave; outside click is its dismissal", () => {
		expect(shouldDismiss(state({ mode: "sticky" }), "pointer-leave")).toBe(false);
		expect(shouldDismiss(state({ mode: "sticky" }), "outside-click")).toBe(true);
	});

	it("a pinned popover survives outside clicks in both modes (the forum complaint)", () => {
		expect(shouldDismiss(state({ pinned: true }), "outside-click")).toBe(false);
		expect(shouldDismiss(state({ mode: "sticky", pinned: true }), "outside-click")).toBe(
			false
		);
	});

	it("a pinned popover survives scrolling and typing in the note", () => {
		expect(shouldDismiss(state({ pinned: true }), "outside-wheel")).toBe(false);
		expect(shouldDismiss(state({ pinned: true }), "modifier-release")).toBe(false);
		expect(shouldDismiss(state({ pinned: true }), "pointer-leave")).toBe(false);
	});

	it("Escape and the X close a pinned popover", () => {
		expect(shouldDismiss(state({ pinned: true }), "escape")).toBe(true);
		expect(shouldDismiss(state({ pinned: true }), "close-button")).toBe(true);
	});

	it("the Escape toggle disables Escape but never the X", () => {
		expect(shouldDismiss(state({ closeOnEscape: false }), "escape")).toBe(false);
		expect(
			shouldDismiss(state({ closeOnEscape: false, pinned: true }), "escape")
		).toBe(false);
		expect(shouldDismiss(state({ closeOnEscape: false }), "close-button")).toBe(true);
	});

	it("typing into the guest suspends hover wind-down and modifier release", () => {
		expect(shouldDismiss(state({ guestFocused: true }), "pointer-leave")).toBe(false);
		expect(shouldDismiss(state({ guestFocused: true }), "modifier-release")).toBe(false);
	});

	it("clicking back into the note still closes an unpinned guest-focused popover", () => {
		expect(shouldDismiss(state({ guestFocused: true }), "outside-click")).toBe(true);
		expect(shouldDismiss(state({ guestFocused: true }), "outside-wheel")).toBe(true);
	});

	it("maximize suspends hover wind-down but not outside clicks", () => {
		expect(shouldDismiss(state({ maximized: true }), "pointer-leave")).toBe(false);
		expect(shouldDismiss(state({ maximized: true }), "outside-click")).toBe(true);
	});
});

describe("shouldDismiss: invariants across the full matrix", () => {
	const modes: StickyMode[] = ["hover", "sticky"];
	const bools = [false, true];

	it("holds for every state x event combination", () => {
		for (const mode of modes) {
			for (const pinned of bools) {
				for (const maximized of bools) {
					for (const guestFocused of bools) {
						for (const closeOnEscape of bools) {
							const s: DismissalState = {
								mode,
								pinned,
								maximized,
								guestFocused,
								closeOnEscape,
							};
							for (const event of EVENTS) {
								const verdict = shouldDismiss(s, event);

								// the X always closes; no state may trap the popover open
								if (event === "close-button") expect(verdict).toBe(true);
								// Escape tracks its setting and nothing else
								if (event === "escape") expect(verdict).toBe(closeOnEscape);
								// pin means only explicit closes remain
								if (pinned && event !== "escape" && event !== "close-button") {
									expect(verdict).toBe(false);
								}
								// hover wind-down happens only for a plain hover popover
								if (event === "pointer-leave") {
									expect(verdict).toBe(
										mode === "hover" &&
											!pinned &&
											!maximized &&
											!guestFocused
									);
								}
								// click and wheel outside agree, and only pin stops them
								if (event === "outside-click" || event === "outside-wheel") {
									expect(verdict).toBe(!pinned);
								}
								// modifier release is a hover-flow gesture: pin or guest
								// focus each retire it
								if (event === "modifier-release") {
									expect(verdict).toBe(!pinned && !guestFocused);
								}
								// the mode only ever influences pointer-leave
								if (event !== "pointer-leave") {
									expect(verdict).toBe(
										shouldDismiss({ ...s, mode: "sticky" }, event)
									);
								}
							}
						}
					}
				}
			}
		}
	});
});
