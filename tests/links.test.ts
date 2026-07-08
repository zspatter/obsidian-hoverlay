import { describe, expect, it } from "vitest";
import { findLinkAtOffset, normalizeUrl, sameCanonicalUrl } from "../src/links";

describe("normalizeUrl", () => {
	it("passes through http/https URLs", () => {
		expect(normalizeUrl("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
		expect(normalizeUrl("http://example.com")).toBe("http://example.com");
	});

	it("rejects other schemes", () => {
		expect(normalizeUrl("obsidian://open?vault=x")).toBeNull();
		expect(normalizeUrl("mailto:a@b.com")).toBeNull();
		expect(normalizeUrl("app://obsidian.md/www.foo.com")).toBeNull();
	});

	it("prepends https to bare domains", () => {
		expect(normalizeUrl("www.example.com")).toBe("https://www.example.com");
		expect(normalizeUrl("example.com/path?q=1")).toBe("https://example.com/path?q=1");
	});

	it("rejects non-domain text", () => {
		expect(normalizeUrl("just some words")).toBeNull();
		expect(normalizeUrl("notes")).toBeNull();
		expect(normalizeUrl("")).toBeNull();
	});

	it("never treats file extensions or unknown TLDs as domains", () => {
		expect(normalizeUrl("readme.md")).toBeNull();
		expect(normalizeUrl("folder/note.md")).toBeNull();
		expect(normalizeUrl("file.txt")).toBeNull();
		expect(normalizeUrl("meeting.notes")).toBeNull();
	});

	it("accepts known-TLD targets without a www prefix", () => {
		expect(normalizeUrl("github.com/zspatter")).toBe("https://github.com/zspatter");
	});

	it("defers to the vault resolver for ambiguous targets", () => {
		const inVault = (target: string) => target === "todo.app";
		expect(normalizeUrl("todo.app", inVault)).toBeNull();
		expect(normalizeUrl("other.app", inVault)).toBe("https://other.app");
		// full URLs are never checked against the vault
		expect(normalizeUrl("https://todo.app", () => true)).toBe("https://todo.app");
	});
});

describe("sameCanonicalUrl", () => {
	it("matches across browser canonicalization", () => {
		expect(sameCanonicalUrl("https://www.example.com/", "https://www.example.com")).toBe(true);
		expect(sameCanonicalUrl("https://Example.com:443/a", "https://example.com/a")).toBe(true);
	});

	it("distinguishes genuinely different URLs", () => {
		expect(sameCanonicalUrl("https://example.com/a", "https://example.com/b")).toBe(false);
		expect(sameCanonicalUrl("https://example.com/", "https://example.com/?q=1")).toBe(false);
	});

	it("falls back to string equality for non-URLs", () => {
		expect(sameCanonicalUrl("not a url", "not a url")).toBe(true);
		expect(sameCanonicalUrl("not a url", "other")).toBe(false);
	});
});

describe("findLinkAtOffset", () => {
	const line = "before [label](https://example.com/x) middle https://raw.example.org after";

	it("extracts the URL from a markdown link when hovering anywhere in it", () => {
		const start = line.indexOf("[label]");
		const end = line.indexOf(")") + 1;
		for (const offset of [start, start + 3, end - 1]) {
			expect(findLinkAtOffset(line, offset)).toBe("https://example.com/x");
		}
	});

	it("extracts raw URLs", () => {
		const at = line.indexOf("https://raw");
		expect(findLinkAtOffset(line, at + 5)).toBe("https://raw.example.org");
	});

	it("returns null outside any link", () => {
		expect(findLinkAtOffset(line, 0)).toBeNull();
		expect(findLinkAtOffset(line, line.length - 1)).toBeNull();
	});

	it("handles scheme-less markdown targets and www text", () => {
		const text = "see [site](www.foo.com) or www.bar.com today";
		expect(findLinkAtOffset(text, text.indexOf("[site]") + 2)).toBe("www.foo.com");
		expect(findLinkAtOffset(text, text.indexOf("www.bar") + 2)).toBe("www.bar.com");
	});

	it("ignores wikilinks", () => {
		const text = "a [[Some Note]] here";
		expect(findLinkAtOffset(text, text.indexOf("Some"))).toBeNull();
	});

	it("finds bare domains with known TLDs in plain text", () => {
		const text = "check github.com/zspatter for the code";
		expect(findLinkAtOffset(text, text.indexOf("github") + 3)).toBe("github.com/zspatter");
	});

	it("ignores bare-domain lookalikes", () => {
		const files = "open file.txt and meeting.notes now";
		expect(findLinkAtOffset(files, files.indexOf("file") + 2)).toBeNull();
		expect(findLinkAtOffset(files, files.indexOf("meeting") + 2)).toBeNull();
	});

	it("ignores the domain part of email addresses", () => {
		const text = "mail zach@example.com today";
		expect(findLinkAtOffset(text, text.indexOf("example") + 2)).toBeNull();
	});

	it("never captures backticks around code-span urls", () => {
		const text = "run `https://example.com/path` or `github.com/user` locally";
		expect(findLinkAtOffset(text, text.indexOf("https") + 2)).toBe("https://example.com/path");
		expect(findLinkAtOffset(text, text.indexOf("github") + 2)).toBe("github.com/user");
	});
});
