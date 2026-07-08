// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseMetadata } from "../src/metadata";

const URL_UNDER_TEST = "https://example.com/articles/post";

const page = (head: string) => `<html><head>${head}</head><body></body></html>`;

describe("parseMetadata", () => {
	it("prefers OpenGraph fields", () => {
		const meta = parseMetadata(
			page(
				`<title>Tab Title</title>
				<meta property="og:title" content="OG Title">
				<meta property="og:description" content="OG description">
				<meta property="og:image" content="https://cdn.example.com/img.png">`
			),
			URL_UNDER_TEST
		);
		expect(meta.title).toBe("OG Title");
		expect(meta.description).toBe("OG description");
		expect(meta.image).toBe("https://cdn.example.com/img.png");
		expect(meta.hostname).toBe("example.com");
	});

	it("falls back to twitter fields, then the title tag and description meta", () => {
		const twitter = parseMetadata(
			page(
				`<meta name="twitter:title" content="Tweet Title">
				<meta name="twitter:description" content="Tweet desc">`
			),
			URL_UNDER_TEST
		);
		expect(twitter.title).toBe("Tweet Title");
		expect(twitter.description).toBe("Tweet desc");

		const plain = parseMetadata(
			page(`<title> Plain Title </title><meta name="description" content="Meta desc">`),
			URL_UNDER_TEST
		);
		expect(plain.title).toBe("Plain Title");
		expect(plain.description).toBe("Meta desc");
	});

	it("uses the url as the title when nothing else exists", () => {
		const meta = parseMetadata(page(""), URL_UNDER_TEST);
		expect(meta.title).toBe(URL_UNDER_TEST);
		expect(meta.description).toBe("");
		expect(meta.image).toBeNull();
	});

	it("resolves relative image and favicon URLs against the page", () => {
		const meta = parseMetadata(
			page(
				`<meta property="og:image" content="/img/cover.jpg">
				<link rel="icon" href="../icons/fav.ico">`
			),
			URL_UNDER_TEST
		);
		expect(meta.image).toBe("https://example.com/img/cover.jpg");
		expect(meta.favicon).toBe("https://example.com/icons/fav.ico");
	});

	it("defaults the favicon to /favicon.ico", () => {
		const meta = parseMetadata(page(""), URL_UNDER_TEST);
		expect(meta.favicon).toBe("https://example.com/favicon.ico");
	});
});
