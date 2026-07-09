import { describe, expect, it } from "vitest";
import { EMBED_REFERRER, choosePresentation } from "../src/presentation";
import { parseDomainModes } from "../src/rules";
import type { PresentationInput } from "../src/presentation";
import type { RenderMode } from "../src/rules";

const EMBEDDABLE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const EMBED_RESULT = "https://www.youtube.com/embed/dQw4w9WgXcQ";
const PLAIN = "https://example.com/article";

const base: PresentationInput = {
	url: PLAIN,
	renderMode: "auto",
	enableEmbeds: true,
	domainRules: [],
	isDesktop: true,
};

const choose = (overrides: Partial<PresentationInput>) =>
	choosePresentation({ ...base, ...overrides });

describe("choosePresentation: explicit cases", () => {
	it("auto on desktop uses the webview", () => {
		expect(choose({})).toEqual({ kind: "webview", loadUrl: PLAIN, isEmbed: false });
	});

	it("auto on desktop embeds media links", () => {
		expect(choose({ url: EMBEDDABLE })).toEqual({
			kind: "webview",
			loadUrl: EMBED_RESULT,
			isEmbed: true,
			embedHint: { aspectRatio: 16 / 9 },
			referrer: EMBED_REFERRER,
		});
	});

	it("embeds toggle off loads the raw media page", () => {
		expect(choose({ url: EMBEDDABLE, enableEmbeds: false })).toEqual({
			kind: "webview",
			loadUrl: EMBEDDABLE,
			isEmbed: false,
		});
	});

	it("auto and webview modes fall back to the card off desktop", () => {
		expect(choose({ isDesktop: false }).kind).toBe("card");
		expect(choose({ renderMode: "webview", isDesktop: false }).kind).toBe("card");
		expect(choose({ url: EMBEDDABLE, isDesktop: false }).kind).toBe("card");
	});

	it("reader mode works on both platforms", () => {
		expect(choose({ renderMode: "reader" }).kind).toBe("reader");
		expect(choose({ renderMode: "reader", isDesktop: false }).kind).toBe("reader");
	});

	it("card mode is card everywhere", () => {
		expect(choose({ renderMode: "card" }).kind).toBe("card");
	});

	it("per-domain webview forces the raw page for media links", () => {
		const rules = parseDomainModes("youtube.com: webview");
		expect(choose({ url: EMBEDDABLE, domainRules: rules })).toEqual({
			kind: "webview",
			loadUrl: EMBEDDABLE,
			isEmbed: false,
		});
	});

	it("per-domain embed forces the player even with embeds globally off", () => {
		const rules = parseDomainModes("youtube.com: embed");
		expect(choose({ url: EMBEDDABLE, enableEmbeds: false, domainRules: rules })).toEqual({
			kind: "webview",
			loadUrl: EMBED_RESULT,
			isEmbed: true,
			embedHint: { aspectRatio: 16 / 9 },
			referrer: EMBED_REFERRER,
		});
	});

	it("embeds declare Obsidian as the embedding site, never the provider", () => {
		const { referrer } = choose({ url: EMBEDDABLE });
		expect(referrer).toBe(EMBED_REFERRER);
		// a provider-origin referrer draws YouTube error 152 (embedding
		// disallowed); the declared embedder must be a third-party origin
		expect(new URL(EMBED_REFERRER).hostname.endsWith("youtube.com")).toBe(false);
		// plain pages navigate like a browser address bar: no referrer
		expect(choose({}).referrer).toBeUndefined();
	});

	it("per-domain overrides beat the global mode in both directions", () => {
		expect(
			choose({ renderMode: "webview", domainRules: parseDomainModes("example.com: card") })
				.kind
		).toBe("card");
		expect(
			choose({ renderMode: "card", domainRules: parseDomainModes("example.com: auto") }).kind
		).toBe("webview");
		expect(
			choose({ domainRules: parseDomainModes("example.com: reader") }).kind
		).toBe("reader");
	});

	it("the most specific per-domain entry wins", () => {
		const rules = parseDomainModes("example.com: card\nwww.example.com: reader");
		expect(choose({ url: "https://www.example.com/x", domainRules: rules }).kind).toBe(
			"reader"
		);
		expect(choose({ url: "https://docs.example.com/x", domainRules: rules }).kind).toBe(
			"card"
		);
	});

	it("unparseable URLs keep the global mode and never embed", () => {
		expect(choose({ url: "not a url" })).toEqual({
			kind: "webview",
			loadUrl: "not a url",
			isEmbed: false,
		});
	});
});

describe("choosePresentation: invariants across the full matrix", () => {
	const urls = [EMBEDDABLE, PLAIN];
	const renderModes: RenderMode[] = ["auto", "webview", "reader", "card"];
	const domainEntries = [null, "auto", "webview", "reader", "card", "embed"];

	it("holds for every combination of url, mode, override, toggle and platform", () => {
		for (const url of urls) {
			for (const renderMode of renderModes) {
				for (const enableEmbeds of [true, false]) {
					for (const isDesktop of [true, false]) {
						for (const entry of domainEntries) {
							const domainRules = entry
								? parseDomainModes(
										`youtube.com: ${entry}\nexample.com: ${entry}`
									)
								: [];
							const result = choose({
								url,
								renderMode,
								enableEmbeds,
								isDesktop,
								domainRules,
							});

							// webviews only exist on desktop
							if (!isDesktop) expect(result.kind).not.toBe("webview");
							// embeds are always webviews loading the transformed URL
							if (result.isEmbed) {
								expect(result.kind).toBe("webview");
								expect(url).toBe(EMBEDDABLE);
								expect(result.loadUrl).toBe(EMBED_RESULT);
							} else {
								expect(result.loadUrl).toBe(url);
							}
							// sizing hints and the referrer exist exactly for embeds
							if (result.isEmbed) {
								expect(result.embedHint).toBeDefined();
								expect(result.referrer).toBe(EMBED_REFERRER);
							} else {
								expect(result.embedHint).toBeUndefined();
								expect(result.referrer).toBeUndefined();
							}
							// per-domain webview always means the raw page
							if (entry === "webview") expect(result.isEmbed).toBe(false);
							// per-domain embed always wins for media on desktop
							if (entry === "embed" && url === EMBEDDABLE && isDesktop) {
								expect(result.isEmbed).toBe(true);
							}
							// reader override is honored everywhere
							if (entry === "reader") expect(result.kind).toBe("reader");
						}
					}
				}
			}
		}
	});
});
