import { describe, expect, it } from "vitest";
import {
	getBlockedHosts,
	isHostBlocked,
	matchDomainMode,
	modifiersHeld,
	parseDomainModes,
	resolveZoomModifier,
	webviewPartition,
	zoomConflictsWithTriggers,
} from "../src/rules";
import type { ModifierKey, ZoomModifier } from "../src/rules";

const ALL_MODIFIERS: ModifierKey[] = ["ctrl", "alt", "shift", "meta"];
const ZOOM_OPTIONS: ZoomModifier[] = ["ctrl", "alt", "shift"];

/** every subset of the given array (powerset) */
function subsets<T>(items: T[]): T[][] {
	return [...Array(1 << items.length).keys()].map((mask) =>
		items.filter((_, index) => mask & (1 << index))
	);
}

const state = (overrides: Partial<Parameters<typeof modifiersHeld>[0]> = {}) => ({
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	metaKey: false,
	...overrides,
});

describe("modifiersHeld", () => {
	it("always passes when nothing is required", () => {
		expect(modifiersHeld(state(), [])).toBe(true);
		expect(modifiersHeld(state({ ctrlKey: true }), [])).toBe(true);
	});

	it("requires every selected modifier", () => {
		expect(modifiersHeld(state({ ctrlKey: true }), ["ctrl"])).toBe(true);
		expect(modifiersHeld(state({ ctrlKey: true }), ["ctrl", "shift"])).toBe(false);
		expect(modifiersHeld(state({ ctrlKey: true, shiftKey: true }), ["ctrl", "shift"])).toBe(true);
		expect(modifiersHeld(state({ altKey: true }), ["meta"])).toBe(false);
	});
});

describe("modifier permutations (exhaustive)", () => {
	it("modifiersHeld matches subset semantics for all 256 combinations", () => {
		for (const required of subsets(ALL_MODIFIERS)) {
			for (const held of subsets(ALL_MODIFIERS)) {
				const state = {
					ctrlKey: held.includes("ctrl"),
					altKey: held.includes("alt"),
					shiftKey: held.includes("shift"),
					metaKey: held.includes("meta"),
				};
				expect(modifiersHeld(state, required)).toBe(
					required.every((mod) => held.includes(mod))
				);
			}
		}
	});

	it("resolveZoomModifier never yields a conflicting key; null only when all conflict", () => {
		for (const triggers of subsets(ALL_MODIFIERS)) {
			for (const preferred of ZOOM_OPTIONS) {
				for (const closeOnRelease of [false, true]) {
					const result = resolveZoomModifier(preferred, triggers, closeOnRelease);

					if (!closeOnRelease || triggers.length === 0) {
						expect(result).toBe(preferred);
						continue;
					}
					const allConflict = ZOOM_OPTIONS.every((option) =>
						zoomConflictsWithTriggers(option, triggers)
					);
					if (allConflict) {
						expect(result).toBeNull();
					} else {
						expect(result).not.toBeNull();
						expect(zoomConflictsWithTriggers(result!, triggers)).toBe(false);
						if (!zoomConflictsWithTriggers(preferred, triggers)) {
							expect(result).toBe(preferred);
						}
					}
				}
			}
		}
	});
});

describe("resolveZoomModifier", () => {
	it("keeps the preferred key when close-on-release is off, even with overlap", () => {
		expect(resolveZoomModifier("ctrl", ["ctrl"], false)).toBe("ctrl");
	});

	it("keeps the preferred key when no trigger modifiers are set", () => {
		expect(resolveZoomModifier("ctrl", [], true)).toBe("ctrl");
	});

	it("keeps a non-conflicting preferred key", () => {
		expect(resolveZoomModifier("alt", ["ctrl"], true)).toBe("alt");
		expect(resolveZoomModifier("ctrl", ["alt", "shift"], true)).toBe("ctrl");
	});

	it("migrates a conflicting key to the first free one", () => {
		expect(resolveZoomModifier("ctrl", ["ctrl"], true)).toBe("alt");
		expect(resolveZoomModifier("shift", ["shift", "ctrl"], true)).toBe("alt");
	});

	it("treats a meta trigger as conflicting with the ctrl option", () => {
		expect(zoomConflictsWithTriggers("ctrl", ["meta"])).toBe(true);
		expect(resolveZoomModifier("ctrl", ["meta"], true)).toBe("alt");
	});

	it("returns null when every option conflicts (zoom disabled)", () => {
		expect(resolveZoomModifier("ctrl", ["ctrl", "alt", "shift"], true)).toBeNull();
		expect(resolveZoomModifier("alt", ["meta", "alt", "shift"], true)).toBeNull();
	});

	it("Off always resolves to null and never conflicts", () => {
		for (const triggers of subsets(ALL_MODIFIERS)) {
			for (const closeOnRelease of [false, true]) {
				expect(resolveZoomModifier("none", triggers, closeOnRelease)).toBeNull();
				expect(zoomConflictsWithTriggers("none", triggers)).toBe(false);
			}
		}
	});
});

describe("per-domain modes", () => {
	it("parses host: mode lines, ignoring malformed or unknown entries", () => {
		const rules = parseDomainModes(
			"Example.com: Card\n\nyoutube.com:webview\nbad line\nfoo.com: bogus\n: card\nvimeo.com: embed"
		);
		expect(rules).toEqual([
			{ host: "example.com", mode: "card" },
			{ host: "youtube.com", mode: "webview" },
			{ host: "vimeo.com", mode: "embed" },
		]);
	});

	it("matches subdomains with the most specific entry winning", () => {
		const rules = parseDomainModes("example.com: card\ndocs.example.com: reader");
		expect(matchDomainMode("example.com", rules)).toBe("card");
		expect(matchDomainMode("www.example.com", rules)).toBe("card");
		expect(matchDomainMode("docs.example.com", rules)).toBe("reader");
		expect(matchDomainMode("deep.docs.example.com", rules)).toBe("reader");
		expect(matchDomainMode("other.org", rules)).toBeNull();
	});
});

describe("blocklist", () => {
	it("parses one host per line, trimming and lowercasing", () => {
		expect(getBlockedHosts(" Example.com \n\n  foo.ORG\n")).toEqual(["example.com", "foo.org"]);
	});

	it("matches exact hosts and subdomains, not lookalikes", () => {
		const blocked = ["example.com"];
		expect(isHostBlocked("example.com", blocked)).toBe(true);
		expect(isHostBlocked("sub.example.com", blocked)).toBe(true);
		expect(isHostBlocked("notexample.com", blocked)).toBe(false);
		expect(isHostBlocked("example.com.evil.net", blocked)).toBe(false);
	});
});

describe("webviewPartition", () => {
	it("uses an in-memory jar by default and a persistent one on opt-in", () => {
		expect(webviewPartition(false)).toBe("hoverlay");
		expect(webviewPartition(true)).toBe("persist:hoverlay");
	});

	it("never resolves to the app-wide default session (empty string)", () => {
		for (const persist of [false, true]) {
			expect(webviewPartition(persist)).not.toBe("");
		}
	});
});
