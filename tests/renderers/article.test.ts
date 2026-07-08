// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { absolutizeArticleUrls, sanitizeArticleFragment } from "../../src/renderers/article";

const BASE = "https://example.com/blog/post";

/** the fragment serialized back to markup, for containment assertions */
function sanitized(html: string): string {
	const el = document.createElement("div");
	el.appendChild(sanitizeArticleFragment(html));
	return el.innerHTML;
}

describe("sanitizeArticleFragment", () => {
	it("strips executable and embeddable content", () => {
		const dirty =
			`<p>keep me</p>` +
			`<script>alert(1)</script>` +
			`<iframe src="https://evil.example"></iframe>` +
			`<object data="x"></object>` +
			`<form><input value="x"></form>` +
			`<video src="v.mp4"></video>` +
			`<style>body { display: none; }</style>`;
		const clean = sanitized(dirty);
		expect(clean).toContain("keep me");
		for (const forbidden of ["<script", "<iframe", "<object", "<form", "<input", "<video", "<style"]) {
			expect(clean).not.toContain(forbidden);
		}
	});

	it("strips event handlers, javascript urls and inline styles", () => {
		const clean = sanitized(
			`<a href="javascript:alert(1)" onclick="alert(2)" style="color:red">link</a>` +
				`<img src="x.png" onerror="alert(3)" srcset="big.png 2x">`
		);
		expect(clean).not.toContain("javascript:");
		expect(clean).not.toContain("onclick");
		expect(clean).not.toContain("onerror");
		expect(clean).not.toContain("style=");
		expect(clean).not.toContain("srcset");
		expect(clean).toContain("link");
	});
});

describe("absolutizeArticleUrls", () => {
	function container(html: string): HTMLElement {
		const el = document.createElement("div");
		el.innerHTML = html;
		return el;
	}

	it("resolves relative image and link URLs against the article", () => {
		const root = container(`<img src="/img/a.png"><a href="ref/next">next</a>`);
		absolutizeArticleUrls(root, BASE);
		expect(root.querySelector("img")?.getAttribute("src")).toBe(
			"https://example.com/img/a.png"
		);
		expect(root.querySelector("a")?.getAttribute("href")).toBe(
			"https://example.com/blog/ref/next"
		);
	});

	it("leaves absolute URLs untouched", () => {
		const root = container(`<a href="https://other.example/x">x</a>`);
		absolutizeArticleUrls(root, BASE);
		expect(root.querySelector("a")?.getAttribute("href")).toBe("https://other.example/x");
	});

	it("removes images without a usable source and strips empty link targets", () => {
		const root = container(`<img><a href="">text stays</a>`);
		absolutizeArticleUrls(root, BASE);
		expect(root.querySelector("img")).toBeNull();
		const anchor = root.querySelector("a");
		expect(anchor?.hasAttribute("href")).toBe(false);
		expect(anchor?.textContent).toBe("text stays");
	});
});
