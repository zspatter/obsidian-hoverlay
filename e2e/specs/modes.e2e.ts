import { before, beforeEach, describe, it } from "mocha";
import { browser, expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	HEADER_URL,
	POPOVER,
	dismissPopover,
	hoverAndWaitForPopover,
	restoreSettings,
	setSettings,
	snapshotSettings,
} from "../helpers";

const EXAMPLE_LINK = '.markdown-preview-view a[href="https://example.com/"]';
const VIDEO_LINK = '.markdown-preview-view a[href^="https://www.youtube.com"]';
const ARTICLE_LINK = '.markdown-preview-view a[href^="https://en.wikipedia.org"]';

/** whether the guest actually shows a playable player rather than an error
 *  screen; YouTube serves config errors (153: no referrer, 152: disallowed
 *  embedder) as a normal page load, invisible to load-level assertions */
async function guestPlayerState(): Promise<string> {
	// executeJavaScript throws before the guest's dom-ready; the loading
	// spinner is removed exactly then
	await $(".hoverlay-loading").waitForExist({ reverse: true, timeout: 15000 });
	return browser.execute(async () => {
		const webview = document.querySelector(".hoverlay-webview") as unknown as {
			executeJavaScript(code: string): Promise<unknown>;
		};
		return (await webview.executeJavaScript(`(async () => {
			const until = Date.now() + 12000;
			while (Date.now() < until) {
				const text = document.body ? document.body.innerText : "";
				if (/error\\s*\\d+|configuration error|unavailable/i.test(text))
					return "error: " + text.replace(/\\s+/g, " ").slice(0, 80);
				if (document.querySelector(".html5-main-video, video")) return "player";
				await new Promise((r) => setTimeout(r, 300));
			}
			return "timeout";
		})()`)) as string;
	});
}

describe("preview modes", function () {
	let defaults: string;

	before(async function () {
		await obsidianPage.openFile("Links.md");
		defaults = await snapshotSettings();
	});

	beforeEach(async function () {
		if (await $(POPOVER).isExisting()) await dismissPopover();
		await restoreSettings(defaults);
	});

	it("auto mode uses the live webview", async function () {
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-webview")).toExist();
	});

	it("webview mode shows the history controls", async function () {
		await setSettings({ renderMode: "webview" });
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-webview")).toExist();
		const nav = $(".hoverlay-header-nav");
		await expect(nav).toExist();
		expect(await nav.getAttribute("class")).not.toContain("is-hidden");
	});

	it("card mode renders metadata without loading the page", async function () {
		await setSettings({ renderMode: "card" });
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-card")).toExist();
		await expect($(".hoverlay-webview")).not.toExist();
		await expect($(".hoverlay-card-title")).toHaveText("Example Domain");
		// cards have no history or audio: the nav cluster stays hidden
		expect(await $(".hoverlay-header-nav").getAttribute("class")).toContain("is-hidden");
	});

	it("reader mode extracts the article text", async function () {
		await setSettings({ renderMode: "reader" });
		await hoverAndWaitForPopover(ARTICLE_LINK);
		await expect($(".hoverlay-reader")).toExist();
		await $(".hoverlay-reader-body").waitForExist({ timeout: 15000 });
		await expect($(".hoverlay-webview")).not.toExist();
	});

	it("embeds media links as the provider player, keeping the link URL", async function () {
		this.timeout(90 * 1000); // the player-state probe polls the guest
		await hoverAndWaitForPopover(VIDEO_LINK);
		const webview = $(".hoverlay-webview");
		await expect(webview).toExist();
		expect(await webview.getAttribute("src")).toContain("youtube.com/embed/jNQXAC9IVRw");
		await expect($(HEADER_URL)).toHaveText("https://www.youtube.com/watch?v=jNQXAC9IVRw");
		// deliberate media starts audible, so the speaker offers Mute
		await expect($('.hoverlay-header [aria-label="Mute"]')).toExist();
		// the player must actually load: YouTube serves referrer/embedder
		// rejections (errors 153/152) as a successful page load, so assert
		// against the guest content itself
		expect(await guestPlayerState()).toBe("player");
	});

	it("embeds toggle off loads the raw media page", async function () {
		await setSettings({ enableEmbeds: false });
		await hoverAndWaitForPopover(VIDEO_LINK);
		const src = await $(".hoverlay-webview").getAttribute("src");
		expect(src).toContain("youtube.com/watch");
		expect(src).not.toContain("/embed/");
	});

	it("per-domain overrides beat the global mode", async function () {
		await setSettings({ renderMode: "auto", domainModes: "example.com: card" });
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-card")).toExist();
		await expect($(".hoverlay-webview")).not.toExist();
	});
});
