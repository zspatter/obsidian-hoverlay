import { describe, expect, it } from "vitest";
import {
	getBlockedHosts,
	isHostBlocked,
	matchDomainMode,
	modifiersHeld,
	parseDomainModes,
	resolveZoomModifier,
	zoomConflictsWithTriggers,
} from "./rules";

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
